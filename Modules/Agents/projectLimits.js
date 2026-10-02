const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');

// How many agents may work in a project at once, and whether agents are paused there. Both only hold an agent
// back: a limit delays a claim, a pause refuses claims and agent changes. Neither touches what people do.

const AT_ONCE = Object.freeze({ MIN: 1, MAX: 20 });
const DEFAULTS = Object.freeze({ atOnce: 3, paused: false });

const REASON = Object.freeze({
    PAUSED: 'agents are paused in this project, so no agent takes work or changes anything here until a person resumes them',
});

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const isId = (value) => OBJECT_ID.test(String(value || ''));
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const inRange = (value) => Number.isInteger(value) && value >= AT_ONCE.MIN && value <= AT_ONCE.MAX;

const clean = (kept) => {
    const given = kept && typeof kept === 'object' ? kept : {};
    return { atOnce: inRange(given.atOnce) ? given.atOnce : DEFAULTS.atOnce, paused: given.paused === true };
};

const stored = async (companyId, projectId) => {
    const project = isId(projectId)
        ? await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PROJECTS, data: [{ _id: oid(projectId) }, { agentLimits: 1 }] }, 'findOne')
        : null;
    return (project && project.agentLimits) || null;
};

const read = async (companyId, projectId) => clean(await stored(companyId, projectId));

const PAUSED_READ = 500;

/* The projects where agents are paused: all of the company's, or those among `projectIds`. Asked on every agent
 * write, so it is one read that in most companies finds nothing. */
const pausedAmong = async (companyId, projectIds) => {
    const ids = projectIds === undefined ? null : [...new Set(projectIds.map(String).filter(isId))];
    if (ids && !ids.length) return [];
    const rows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECTS, data: [{ 'agentLimits.paused': true, ...(ids ? { _id: { $in: ids.map(oid) } } : {}) }, { agentLimits: 1 }, { limit: PAUSED_READ }],
    }, 'find');
    return (Array.isArray(rows) ? rows : []).filter((row) => row && clean(row.agentLimits).paused && (!ids || ids.includes(String(row._id)))).map((row) => String(row._id).toLowerCase());
};

const validated = (given) => {
    const sent = given && typeof given === 'object' ? given : {};
    const named = ['atOnce', 'paused'].filter((key) => sent[key] !== undefined);
    if (!named.length) return { error: 'Send atOnce, paused or both.' };
    if (sent.atOnce !== undefined && !inRange(sent.atOnce)) return { error: `atOnce must be a whole number from ${AT_ONCE.MIN} to ${AT_ONCE.MAX}.` };
    if (sent.paused !== undefined && typeof sent.paused !== 'boolean') return { error: 'paused must be true or false.' };
    return { values: Object.fromEntries(named.map((key) => [key, sent[key]])) };
};

/* Answers the project as it reads afterwards, with what it held before, or the reason nothing was saved. */
const save = async (companyId, projectId, given, updatedBy) => {
    const check = validated(given);
    if (check.error) return { error: check.error, status: 400 };
    const was = await stored(companyId, projectId);
    const from = clean(was);
    const to = { ...from, ...check.values };
    const now = new Date();
    const pausedNow = to.paused && !from.paused;
    const pause = pausedNow ? { pausedBy: String(updatedBy), pausedAt: now } : { pausedBy: (was && was.pausedBy) || null, pausedAt: (was && was.pausedAt) || null };
    const agentLimits = { ...to, ...(to.paused ? pause : {}), updatedBy: String(updatedBy), updatedAt: now };
    const project = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECTS, data: [{ _id: oid(projectId) }, { $set: { agentLimits } }, { returnDocument: 'after' }],
    }, 'findOneAndUpdate');
    if (!project) return { error: 'Project not found.', status: 404 };
    return { from, to, project, agentLimits, pausedNow };
};

module.exports = { AT_ONCE, DEFAULTS, REASON, read, pausedAmong, save };
