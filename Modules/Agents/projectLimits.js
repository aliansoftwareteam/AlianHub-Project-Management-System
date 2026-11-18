const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');

// How many agents may work in a project at once, how many tasks a connected agent changes there on its own before
// its changes wait (./directChanges), and whether agents are paused there. Each only holds an agent back: a limit
// delays a claim, the count files a change for approval, a pause refuses claims and agent changes. None touches what people do.

const AT_ONCE = Object.freeze({ MIN: 1, MAX: 20 });
const DIRECT_TASKS = Object.freeze({ MIN: 1, MAX: 100 });
const DEFAULTS = Object.freeze({ atOnce: 3, paused: false, directTasks: 10 });

const REASON = Object.freeze({
    PAUSED: 'agents are paused in this project, so nothing can be taken or changed here until a person resumes them',
});

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const isId = (value) => OBJECT_ID.test(String(value || ''));
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const within = (range, value) => Number.isInteger(value) && value >= range.MIN && value <= range.MAX;

const clean = (kept) => {
    const given = kept && typeof kept === 'object' ? kept : {};
    return {
        atOnce: within(AT_ONCE, given.atOnce) ? given.atOnce : DEFAULTS.atOnce,
        paused: given.paused === true,
        directTasks: within(DIRECT_TASKS, given.directTasks) ? given.directTasks : DEFAULTS.directTasks,
    };
};

const stored = async (companyId, projectId) => {
    const project = isId(projectId)
        ? await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PROJECTS, data: [{ _id: oid(projectId) }, { agentLimits: 1 }] }, 'findOne')
        : null;
    return (project && project.agentLimits) || null;
};

const read = async (companyId, projectId) => clean(await stored(companyId, projectId));

/* Whether the company has a project where agents are paused: the one read every agent write starts with, which in
 * most companies finds nothing. */
const anyPaused = async (companyId) => {
    const rows = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PROJECTS, data: [{ 'agentLimits.paused': true }, { _id: 1 }, { limit: 1 }] }, 'find');
    return Array.isArray(rows) && rows.length > 0;
};

/* The projects among `projectIds` where agents are paused. It is asked by id, so however many projects a company
 * has paused, none is left out. */
const pausedAmong = async (companyId, projectIds) => {
    const ids = [...new Set((Array.isArray(projectIds) ? projectIds : []).map((id) => String(id).toLowerCase()).filter(isId))];
    if (!ids.length) return [];
    const rows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECTS, data: [{ 'agentLimits.paused': true, _id: { $in: ids.map(oid) } }, { agentLimits: 1 }],
    }, 'find');
    return (Array.isArray(rows) ? rows : []).map((row) => (row && clean(row.agentLimits).paused ? String(row._id).toLowerCase() : '')).filter((id) => ids.includes(id));
};

const validated = (given) => {
    const sent = given && typeof given === 'object' ? given : {};
    const named = ['atOnce', 'paused', 'directTasks'].filter((key) => sent[key] !== undefined);
    if (!named.length) return { error: 'Send atOnce, paused or directTasks.' };
    if (sent.atOnce !== undefined && !within(AT_ONCE, sent.atOnce)) return { error: `atOnce must be a whole number from ${AT_ONCE.MIN} to ${AT_ONCE.MAX}.` };
    if (sent.directTasks !== undefined && !within(DIRECT_TASKS, sent.directTasks)) return { error: `directTasks must be a whole number from ${DIRECT_TASKS.MIN} to ${DIRECT_TASKS.MAX}.` };
    if (sent.paused !== undefined && typeof sent.paused !== 'boolean') return { error: 'paused must be true or false.' };
    return { values: Object.fromEntries(named.map((key) => [key, sent[key]])) };
};

/* Answers the project as it reads afterwards, with what it held before, or the reason nothing was saved. Only the
 * fields named are written, each on its own, so a save never puts back what another save changed beside it; and a
 * pause is turned on by a write that matches only a project not paused, so who paused it is the one who did. */
const save = async (companyId, projectId, given, updatedBy) => {
    const check = validated(given);
    if (check.error) return { error: check.error, status: 400 };
    const from = await read(companyId, projectId);
    const now = new Date();
    const by = String(updatedBy);
    const named = Object.fromEntries(Object.entries(check.values).map(([key, value]) => [`agentLimits.${key}`, value]));
    const stamped = { ...named, 'agentLimits.updatedBy': by, 'agentLimits.updatedAt': now };
    const write = (filter, update) => MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECTS, data: [{ _id: oid(projectId), ...filter }, update, { returnDocument: 'after' }],
    }, 'findOneAndUpdate');
    const paused = check.values.paused === true
        ? await write({ 'agentLimits.paused': { $ne: true } }, { $set: { ...stamped, 'agentLimits.pausedBy': by, 'agentLimits.pausedAt': now } })
        : null;
    const resumes = check.values.paused === false ? { $unset: { 'agentLimits.pausedBy': '', 'agentLimits.pausedAt': '' } } : {};
    const project = paused || await write({}, { $set: stamped, ...resumes });
    if (!project) return { error: 'Project not found.', status: 404 };
    return { from, to: clean(project.agentLimits), project, agentLimits: project.agentLimits, pausedNow: Boolean(paused) };
};

module.exports = { AT_ONCE, DIRECT_TASKS, DEFAULTS, REASON, read, anyPaused, pausedAmong, save };
