const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const chainRules = require('./helpers/chainRules');
const rules = require('./helpers/redactRules');
const { normalizeAuditEntry } = require('./helpers/auditRules');
const chain = require('./chain');

const REDACTED_ACTION = 'audit.person_redacted';
const BATCH_SIZE = 500;
const OBJECT_ID = /^[a-f0-9]{24}$/i;

const { AUDIT_LOGS, AUDIT_REDACTIONS, USERS, GOLBAL } = SCHEMA_TYPE;

const db = (database, type, data, method) => MongoDbCrudOpration(String(database), { type, data }, method);
const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);

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

const readMarker = async (companyId, pseudonym) => plain(await db(companyId, AUDIT_REDACTIONS, [{ _id: pseudonym }], 'findOne'));

const saveMarker = (companyId, pseudonym, $set) => db(companyId, AUDIT_REDACTIONS, [{ _id: pseudonym }, { $set }, { upsert: true }], 'updateOne');

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

const recordRedaction = async (companyId, { by, reason, pseudonym, rows, fields, startedAt }) => {
    const { entry } = normalizeAuditEntry({
        actorId: by, action: REDACTED_ACTION, entityType: 'user', entityId: pseudonym, entityName: pseudonym,
        meta: { reason, rows, fields, startedAt },
    });
    const saved = plain(await chain.saveAuditRow(companyId, entry));
    return saved && saved._id ? String(saved._id) : null;
};

/*
 * Replaces the person's personal fields in every audit row of the company with a pseudonym. Only fields outside
 * the hash are written, so every chain still verifies; the redaction itself is recorded as one new audit row
 * (chained while AUDIT_CHAIN is on). Rows are read in _id order a batch at a time, and a marker keyed by the
 * pseudonym keeps the position and counts, so a run that stops partway resumes there and records one row.
 */
const redactPerson = async (companyId, userId, { by = '', reason = '', batchSize = BATCH_SIZE } = {}) => {
    const company = String(companyId || '');
    const person = String(userId || '');
    if (!company || !person) throw new Error('audit redaction needs a company id and a user id');
    const pseudonym = pseudonymOf(person);
    const emails = await emailsOf(person);

    const marker = await readMarker(company, pseudonym);
    const resuming = Boolean(marker && !marker.finishedAt);
    let after = resuming ? String(marker.after || '') : '';
    let rows = resuming ? Number(marker.rows) || 0 : 0;
    let fields = resuming ? Number(marker.fields) || 0 : 0;
    const startedAt = resuming && marker.startedAt ? marker.startedAt : new Date();
    if (!resuming) await saveMarker(company, pseudonym, { after, rows, fields, by: String(by), reason: String(reason), startedAt, finishedAt: null, recordedRowId: '' });

    for (;;) {
        const filter = after ? { _id: { $gt: new mongoose.Types.ObjectId(after) } } : {};
        const batch = ((await db(company, AUDIT_LOGS, [filter, {}, { sort: { _id: 1 }, limit: batchSize, lean: true }], 'find')) || []).map(plain);
        for (const row of batch) {
            const paths = rules.personalPaths(row, person, { emails });
            if (!paths.length) continue;
            assertOutsideHash(company, row, paths, pseudonym);
            if (await redactRow(company, row, paths, pseudonym)) {
                rows += 1;
                fields += paths.length;
            }
        }
        if (!batch.length) break;
        after = String(batch[batch.length - 1]._id);
        await saveMarker(company, pseudonym, { after, rows, fields });
        if (batch.length < batchSize) break;
    }

    const recorded = rows > 0 ? await recordRedaction(company, { by: String(by), reason: String(reason), pseudonym, rows, fields, startedAt }) : null;
    await saveMarker(company, pseudonym, { finishedAt: new Date(), recordedRowId: recorded || '' });
    return { rows, fields, pseudonym, recorded };
};

module.exports = { REDACTED_ACTION, BATCH_SIZE, pseudonymOf, redactPerson };
