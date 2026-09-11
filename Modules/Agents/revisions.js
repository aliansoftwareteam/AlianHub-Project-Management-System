const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');

// An agent revision is an immutable snapshot of everything on the agent record
// that shapes a run. A run pins the live revision's number at start and the
// engine reads its configuration from that snapshot, so a run can always name
// the exact configuration that produced it. Promote and rollback move the
// `live` pointer; rollback copies the target forward so history stays append-only.

const STATE = Object.freeze({ DRAFT: 'draft', CANDIDATE: 'candidate', LIVE: 'live', SUPERSEDED: 'superseded' });
const PROMOTABLE = [STATE.DRAFT, STATE.CANDIDATE];
const SOURCE = Object.freeze({ SAVE: 'save', CREATE: 'create', DRAFT: 'draft', PROMOTE: 'promote', ROLLBACK: 'rollback', MIGRATION: 'migration', BOOTSTRAP: 'bootstrap' });
const RUN_FIELDS = Object.freeze(['name', 'description', 'skills', 'allowedActions', 'projectIds', 'autonomy', 'spendCapUsd', 'account', 'model', 'schedule', 'rateLimitPerDay', 'trigger']);
const SYNTHETIC_ZERO = Object.freeze({ n: 0, state: STATE.LIVE, synthetic: true, snapshot: null, serves: [], skillRefs: [] });
const NOTE_MAX = 500;
const T = SCHEMA_TYPE.AGENT_REVISIONS;

const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const isDuplicateKey = (e) => Boolean(e && (e.code === 11000 || /duplicate key/i.test(e.message || '')));

const snapshotOf = (agent) => {
    const a = plain(agent) || {};
    const out = {};
    RUN_FIELDS.forEach((f) => { if (a[f] !== undefined) out[f] = clone(a[f]); });
    return out;
};

const sameSnapshot = (a, b) => JSON.stringify(snapshotOf({ ...a })) === JSON.stringify(snapshotOf({ ...b }));

const skillKeyOf = (skill) => {
    if (!skill) return null;
    if (typeof skill === 'string') return skill;
    return skill.key || skill.slug || skill.name || null;
};

const skillKeysOf = (snapshot) => [...new Set(((snapshot && snapshot.skills) || []).map(skillKeyOf).filter(Boolean))];

/* A code skill has no revision number: its identity is the slug plus a hash of
 * the module file, which changes with the prompt. A data skill pins its version as `n`. */
let skillHashes = null;
const SKILLS_DIR = path.join(__dirname, 'skills');
const loadSkillHashes = () => {
    if (skillHashes) return skillHashes;
    skillHashes = new Map();
    let files = [];
    try { files = fs.readdirSync(SKILLS_DIR).filter((f) => f.endsWith('.js') && f !== 'index.js'); } catch (e) { return skillHashes; }
    for (const file of files) {
        try {
            const full = path.join(SKILLS_DIR, file);
            const hash = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex').slice(0, 16);
            // eslint-disable-next-line global-require
            const mod = require(full);
            [mod.slug, ...(mod.aliases || [])].filter(Boolean).forEach((key) => skillHashes.set(String(key), hash));
        } catch (e) { logger.error(`[agent-revisions] skill ${file} not hashed: ${e.message}`); }
    }
    return skillHashes;
};

const skillRefOf = (key) => ({ key: String(key), hash: loadSkillHashes().get(String(key)) || null, n: null });
const skillRefsOf = (snapshot) => skillKeysOf(snapshot).map(skillRefOf);

const listFor = (companyId, agentId) => MongoDbCrudOpration(companyId, { type: T, data: [{ agentId: String(agentId) }, {}, { sort: { n: 1 } }] }, 'find');

const getRevision = (companyId, agentId, n) => MongoDbCrudOpration(companyId, { type: T, data: [{ agentId: String(agentId), n: Number(n) }] }, 'findOne');

const findLive = (companyId, agentId) => MongoDbCrudOpration(companyId, { type: T, data: [{ agentId: String(agentId), state: STATE.LIVE }] }, 'findOne');

const nextN = async (companyId, agentId) => {
    const last = await MongoDbCrudOpration(companyId, { type: T, data: [{ agentId: String(agentId) }, 'n', { sort: { n: -1 }, limit: 1 }] }, 'find');
    return (Array.isArray(last) && last[0] ? Number(last[0].n) : 0) + 1;
};

/* Inserts n+1 and lets the unique index arbitrate a race: the loser retries with the next number. */
const createRevision = async (companyId, agentId, { snapshot, state, createdBy, source, note, rollbackOf }) => {
    const base = {
        agentId: String(agentId), state: state || STATE.DRAFT, snapshot: clone(snapshot),
        serves: skillKeysOf(snapshot), skillRefs: skillRefsOf(snapshot),
        source: source || SOURCE.SAVE, createdBy: createdBy ? String(createdBy) : null,
        ...(note ? { note: String(note).slice(0, NOTE_MAX) } : {}),
        ...(rollbackOf ? { rollbackOf: Number(rollbackOf) } : {}),
        ...(state === STATE.LIVE ? { promotedAt: new Date(), promotedBy: createdBy ? String(createdBy) : null } : {}),
    };
    for (let attempt = 0; attempt < 3; attempt += 1) {
        // eslint-disable-next-line no-await-in-loop
        const n = await nextN(companyId, agentId);
        try {
            // eslint-disable-next-line no-await-in-loop
            return plain(await MongoDbCrudOpration(companyId, { type: T, data: { ...base, n } }, 'save'));
        } catch (e) { if (!isDuplicateKey(e) || attempt === 2) throw e; }
    }
    return null;
};

const setState = (companyId, revisionId, $set) => MongoDbCrudOpration(companyId, { type: T, data: [{ _id: revisionId }, { $set }] }, 'updateOne');

const supersedeLive = async (companyId, agentId, exceptN) => {
    const live = await findLive(companyId, agentId);
    if (!live || Number(live.n) === Number(exceptN)) return live || null;
    await setState(companyId, live._id, { state: STATE.SUPERSEDED, supersededAt: new Date() });
    return live;
};

const audit = async (companyId, actor, entry) => {
    try {
        // eslint-disable-next-line global-require
        await require('./agentAudit').recordRevisionChange(companyId, actor, entry);
    } catch (e) { logger.error(`[agent-revisions] audit row not written: ${e.message}`); }
};

const emitAgent = (companyId, data) => {
    // eslint-disable-next-line global-require
    try { require('./runs').emitAgent(companyId, data); } catch (e) { logger.error(`[agent-revisions] emit failed: ${e.message}`); }
};

/* The live revision for an agent, written on first sight from the record for
 * agents the migration has not reached (a test fixture, a row created out of band). */
const liveFor = async (companyId, agent) => {
    const a = plain(agent);
    if (!a || !a._id) return null;
    const live = await findLive(companyId, a._id);
    if (live) return plain(live);
    return createRevision(companyId, a._id, { snapshot: snapshotOf(a), state: STATE.LIVE, createdBy: a.ownerId || null, source: SOURCE.BOOTSTRAP });
};

const pinnedSkillRef = async (companyId, key) => {
    try {
        // eslint-disable-next-line global-require
        const skill = await require('./skillRecord').getSkill(companyId, key);
        if (skill && skill.source === 'data') return { key: String(key), hash: null, n: Number(skill.version) };
    } catch (e) { logger.error(`[agent-revisions] skill ${key} not resolved: ${e.message}`); }
    return skillRefOf(key);
};

/* What a run pins at start. */
const pinFor = async (companyId, agent, skillKey) => {
    const live = await liveFor(companyId, agent);
    const key = skillKey || skillKeysOf(live && live.snapshot)[0] || null;
    return { agentRevision: live ? Number(live.n) : 0, skillRevision: key ? await pinnedSkillRef(companyId, key) : null };
};

/* Runs from before revisions carry no number and resolve to a synthetic zero. */
const forRun = async (companyId, run) => {
    const r = plain(run);
    const n = Number(r && r.agentRevision);
    if (!r || !Number.isFinite(n) || n < 1) return { ...SYNTHETIC_ZERO };
    const rev = await getRevision(companyId, r.agentId, n);
    return rev ? plain(rev) : { ...SYNTHETIC_ZERO, n, missing: true };
};

/* The agent as the pinned revision saw it. Fields outside the snapshot (spend
 * month, paused, owner) stay live: a cap reached after the pin still counts. */
const applyRevision = (agent, revision) => {
    const a = plain(agent) || {};
    if (!revision || !revision.snapshot) return a;
    return { ...a, ...clone(revision.snapshot) };
};

const recordCreate = (companyId, agent, { actor } = {}) => {
    const a = plain(agent);
    return createRevision(companyId, a._id, { snapshot: snapshotOf(a), state: STATE.LIVE, createdBy: actor && actor.userId, source: SOURCE.CREATE });
};

/* A settings save keeps today's behaviour: the new configuration is live at once.
 * That is n+1 as live, the previous live superseded, one audit row. A save that
 * changes nothing a run reads (spend month, pause) writes no revision. */
const recordSave = async (companyId, before, after, { actor, ip } = {}) => {
    const prev = plain(before);
    const next = plain(after);
    if (sameSnapshot(prev, next)) {
        const live = await findLive(companyId, next._id);
        if (live) return { revision: plain(live), changed: false };
    }
    const from = await supersedeLive(companyId, next._id, -1);
    const revision = await createRevision(companyId, next._id, { snapshot: snapshotOf(next), state: STATE.LIVE, createdBy: actor && actor.userId, source: SOURCE.SAVE });
    await audit(companyId, actor, { kind: SOURCE.SAVE, agentId: String(next._id), agentName: next.name, from: from ? Number(from.n) : null, to: Number(revision.n), ip });
    emitAgent(companyId, { agentId: String(next._id), revision: Number(revision.n) });
    return { revision, changed: true, from: from ? Number(from.n) : null };
};

/* A draft or candidate: reachable only here, never through the plain save. */
const createDraft = async (companyId, agent, { fields, state, note, actor } = {}) => {
    const a = plain(agent);
    const target = state === STATE.CANDIDATE ? STATE.CANDIDATE : STATE.DRAFT;
    const live = await liveFor(companyId, a);
    const snapshot = { ...clone((live && live.snapshot) || snapshotOf(a)), ...snapshotOf(fields || {}) };
    return createRevision(companyId, a._id, { snapshot, state: target, createdBy: actor && actor.userId, source: SOURCE.DRAFT, note });
};

const applyToAgent = async (companyId, agentId, snapshot) => {
    const updated = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENTS, data: [{ _id: agentId }, { $set: clone(snapshot) }, { returnDocument: 'after' }] }, 'findOneAndUpdate');
    return plain(updated);
};

const oidOf = (id) => {
    // eslint-disable-next-line global-require
    const mongoose = require('mongoose');
    try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return String(id); }
};

/* Pointer move: :n becomes live, the previous live is superseded, and the agent
 * record is written from the snapshot so everything that reads the record agrees. */
const promote = async (companyId, agent, n, { actor, ip, kind } = {}) => {
    const a = plain(agent);
    const target = await getRevision(companyId, a._id, n);
    if (!target) return { error: 'Revision not found.', status: 404 };
    if (target.state === STATE.LIVE) return { revision: plain(target), from: Number(target.n), unchanged: true };
    if (!PROMOTABLE.includes(target.state)) return { error: `Revision ${target.n} is ${target.state}; roll back to it instead.`, status: 409 };
    const from = await supersedeLive(companyId, a._id, n);
    await setState(companyId, target._id, { state: STATE.LIVE, promotedAt: new Date(), promotedBy: actor && actor.userId ? String(actor.userId) : null });
    const updatedAgent = await applyToAgent(companyId, oidOf(a._id), target.snapshot);
    await audit(companyId, actor, { kind: kind || SOURCE.PROMOTE, agentId: String(a._id), agentName: (updatedAgent || a).name, from: from ? Number(from.n) : null, to: Number(target.n), ip });
    emitAgent(companyId, { agentId: String(a._id), revision: Number(target.n), agent: updatedAgent || undefined });
    return { revision: { ...plain(target), state: STATE.LIVE }, from: from ? Number(from.n) : null, agent: updatedAgent };
};

/* Rollback never rewrites :n. It copies :n forward as n+1 (draft), then promotes
 * the copy, so the history still reads in order and the old row stays as it was. */
const rollback = async (companyId, agent, n, { actor, ip, note } = {}) => {
    const a = plain(agent);
    const target = await getRevision(companyId, a._id, n);
    if (!target) return { error: 'Revision not found.', status: 404 };
    if (target.state === STATE.LIVE) return { error: `Revision ${target.n} is already live.`, status: 409 };
    const copy = await createRevision(companyId, a._id, { snapshot: target.snapshot, state: STATE.DRAFT, createdBy: actor && actor.userId, source: SOURCE.ROLLBACK, rollbackOf: Number(target.n), note });
    const out = await promote(companyId, a, copy.n, { actor, ip, kind: SOURCE.ROLLBACK });
    return { ...out, rollbackOf: Number(target.n) };
};

module.exports = {
    STATE, SOURCE, RUN_FIELDS, SYNTHETIC_ZERO, PROMOTABLE,
    snapshotOf, sameSnapshot, skillKeysOf, skillRefOf, skillRefsOf, loadSkillHashes,
    listFor, getRevision, findLive, liveFor, pinFor, forRun, applyRevision,
    createRevision, recordCreate, recordSave, createDraft, promote, rollback,
};
