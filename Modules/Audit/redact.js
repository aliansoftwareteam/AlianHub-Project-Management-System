const crypto = require('crypto');
const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const chainRules = require('./helpers/chainRules');
const rules = require('./helpers/redactRules');
const { normalizeAuditEntry } = require('./helpers/auditRules');
const chain = require('./chain');

const REDACTED_ACTION = 'audit.person_redacted';
const CODE_RUNNING = 'redaction_running';
const BATCH_SIZE = 500;
const LEASE_MS = 60 * 1000;
const OBJECT_ID = /^[a-f0-9]{24}$/i;

const { AUDIT_LOGS, AUDIT_REDACTIONS, COMPANY_USERS, USERS, GOLBAL } = SCHEMA_TYPE;

const db = (database, type, data, method) => MongoDbCrudOpration(String(database), { type, data }, method);
const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);

class RedactionRunningError extends Error {
    constructor(detail = 'another run is redacting this person in this workspace') {
        super(`${CODE_RUNNING}: ${detail}`);
        this.name = 'RedactionRunningError';
        this.code = CODE_RUNNING;
        this.status = 409;
    }
}

/* Keyed so a pseudonym cannot be matched back to a known user id; JWT_SECRET only when the chain has no key. */
const pseudonymOf = (userId) => rules.pseudonymFor(chainRules.chainConfig().key || process.env.JWT_SECRET || '', String(userId));

const emailsOf = async (userId) => {
    if (!OBJECT_ID.test(userId)) return [];
    try {
        const user = plain(await db(GOLBAL, USERS, [{ _id: userId }, { Employee_Email: 1 }], 'findOne'));
        return user && user.Employee_Email ? [String(user.Employee_Email)] : [];
    } catch (error) {
        logger.error(`audit redaction: reading the person's email failed: ${error.message}`);
        return [];
    }
};

/* member.update rows name the member document, not the user. */
const memberIdsOf = async (companyId, userId) => {
    const userIds = OBJECT_ID.test(userId) ? [userId, new mongoose.Types.ObjectId(userId)] : [userId];
    const seats = (await db(companyId, COMPANY_USERS, [{ userId: { $in: userIds } }, { _id: 1 }], 'find')) || [];
    return seats.map((seat) => String(plain(seat)._id));
};

const acquire = async (companyId, pseudonym, owner) => {
    const now = new Date();
    try {
        return plain(await db(companyId, AUDIT_REDACTIONS, [
            { _id: pseudonym, $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: null }, { leaseUntil: { $lt: now } }] },
            { $set: { owner, leaseUntil: new Date(now.getTime() + LEASE_MS) } },
            { upsert: true, new: true },
        ], 'findOneAndUpdate'));
    } catch (error) {
        if (error && error.code === 11000) throw new RedactionRunningError();
        throw error;
    }
};

const saveMarker = async (companyId, pseudonym, owner, $set, { release = false } = {}) => {
    const leaseUntil = release ? null : new Date(Date.now() + LEASE_MS);
    const result = await db(companyId, AUDIT_REDACTIONS, [{ _id: pseudonym, owner }, { $set: { ...$set, leaseUntil } }], 'updateOne');
    if (!result || !(result.matchedCount > 0)) throw new RedactionRunningError('this run lost its lease to another');
};

const assertOutsideHash = (companyId, row, paths, pseudonym) => {
    const before = chainRules.canonical(chainRules.hashedContent(companyId, row));
    const after = chainRules.canonical(chainRules.hashedContent(companyId, rules.withValues(row, paths, pseudonym)));
    if (before !== after) throw new Error(`refused to redact audit row ${row._id}: ${paths.map((p) => p.path).join(', ')} is inside the hash`);
};

/* The stored value is part of the filter, so a row that changed since it was read is left for the next run. */
const redactRow = async (companyId, row, paths, pseudonym) => {
    const filter = { _id: row._id };
    const $set = {};
    paths.forEach(({ path, value }) => {
        filter[path] = value;
        $set[path] = pseudonym;
    });
    const result = await db(companyId, AUDIT_LOGS, [filter, { $set }], 'updateOne');
    return Boolean(result && result.matchedCount > 0);
};

const rowById = async (companyId, id) => (OBJECT_ID.test(String(id))
    ? plain(await db(companyId, AUDIT_LOGS, [{ _id: new mongoose.Types.ObjectId(String(id)) }], 'findOne'))
    : null);

/* The key names the run, so a run that stopped after recording its row finds that row instead of writing another. */
const recordOnce = async (companyId, { by, reason, pseudonym, rows, fields, startedAt, runId }) => {
    const idempotencyKey = `${REDACTED_ACTION}:${pseudonym}:${runId}`;
    const existing = plain(await db(companyId, AUDIT_LOGS, [{ action: REDACTED_ACTION, entityType: 'user', entityId: pseudonym, 'meta.idempotencyKey': idempotencyKey }, { _id: 1 }], 'findOne'));
    if (existing) return String(existing._id);
    const { entry } = normalizeAuditEntry({
        actorId: by, action: REDACTED_ACTION, entityType: 'user', entityId: pseudonym, entityName: pseudonym,
        meta: { reason, rows, fields, startedAt, idempotencyKey },
    });
    const saved = plain(await chain.saveAuditRow(companyId, entry));
    return saved && saved._id ? String(saved._id) : null;
};

const run = async (company, person, pseudonym, owner, marker, { by, reason, batchSize, identity }) => {
    const resuming = Boolean(marker && marker.startedAt && !marker.finishedAt);
    const state = resuming
        ? {
            after: String(marker.after || ''), rows: Number(marker.rows) || 0, fields: Number(marker.fields) || 0,
            startedAt: marker.startedAt, runId: marker.runId || new Date(marker.startedAt).toISOString(),
        }
        : { after: '', rows: 0, fields: 0, startedAt: new Date(), runId: crypto.randomUUID() };
    const save = ($set, options) => saveMarker(company, pseudonym, owner, $set, options);
    if (!resuming) await save({ ...state, by: String(by), reason: String(reason), finishedAt: null, recordedRowId: '', pending: null });

    // A row written just before a crash is already pseudonymised, so the rescan would not count it.
    const pending = resuming && marker.pending && marker.pending.id ? marker.pending : null;
    if (pending) {
        const row = await rowById(company, pending.id);
        if (row && !rules.personalPaths(row, person, identity).length) {
            state.rows += 1;
            state.fields += Number(pending.fields) || 0;
            state.after = String(pending.id);
        }
        await save({ after: state.after, rows: state.rows, fields: state.fields, pending: null });
    }

    for (;;) {
        const filter = state.after ? { _id: { $gt: new mongoose.Types.ObjectId(state.after) } } : {};
        const batch = ((await db(company, AUDIT_LOGS, [filter, {}, { sort: { _id: 1 }, limit: batchSize, lean: true }], 'find')) || []).map(plain);
        for (const row of batch) {
            const paths = rules.personalPaths(row, person, identity);
            if (!paths.length) continue;
            assertOutsideHash(company, row, paths, pseudonym);
            await save({ pending: { id: String(row._id), fields: paths.length } });
            if (await redactRow(company, row, paths, pseudonym)) {
                state.rows += 1;
                state.fields += paths.length;
            }
            state.after = String(row._id);
            await save({ after: state.after, rows: state.rows, fields: state.fields, pending: null });
        }
        if (!batch.length) break;
        state.after = String(batch[batch.length - 1]._id);
        await save({ after: state.after, rows: state.rows, fields: state.fields });
        if (batch.length < batchSize) break;
    }

    const recorded = state.rows > 0 ? await recordOnce(company, { by: String(by), reason: String(reason), pseudonym, ...state }) : null;
    await save({ finishedAt: new Date(), recordedRowId: recorded || '' }, { release: true });
    return { rows: state.rows, fields: state.fields, pseudonym, recorded };
};

const redactPerson = async (companyId, userId, { by = '', reason = '', batchSize = BATCH_SIZE } = {}) => {
    const company = String(companyId || '');
    const person = String(userId || '');
    if (!company || !person) throw new Error('audit redaction needs a company id and a user id');
    const pseudonym = pseudonymOf(person);
    const [emails, ids] = await Promise.all([emailsOf(person), memberIdsOf(company, person)]);
    const owner = crypto.randomUUID();
    const marker = await acquire(company, pseudonym, owner);
    try {
        return await run(company, person, pseudonym, owner, marker, { by, reason, batchSize, identity: { emails, ids } });
    } catch (error) {
        await db(company, AUDIT_REDACTIONS, [{ _id: pseudonym, owner }, { $set: { leaseUntil: null } }], 'updateOne')
            .catch((e) => logger.error(`audit redaction: releasing the lease failed: ${e.message}`));
        throw error;
    }
};

module.exports = { REDACTED_ACTION, CODE_RUNNING, BATCH_SIZE, LEASE_MS, RedactionRunningError, pseudonymOf, redactPerson };
