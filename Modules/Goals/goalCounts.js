const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { idForms } = require('../../utils/mongo-handler/objectIdKeys');
const logger = require('../../Config/loggerConfig');
const { isClosedTask } = require('../Tasks/helpers/taskSignals');
const { TASKS } = require('./helpers/goalRules');
const { withProgress } = require('./helpers/goalProgress');
const { LIVE, crud, announce, writeAtRevision } = require('./goalStore');
const sources = require('./goalSources');

const STALE_AFTER_MS = 10 * 60 * 1000;
const RECOUNT_GAP_MS = 30 * 1000;
const WRITE_ATTEMPTS = 3;
const STORE_UNAVAILABLE = 'unavailable';
const COUNT_ERROR = 'error';

/* A task's deletedStatusKey: 0 is live, and 5 and 8 are a task as it stood when its list or its project was
 * closed. Closing finished work must not empty the goal that counted it, so those are counted; a task that
 * is deleted or archived, on its own or with its parent, list, folder or project, is not. */
const COUNTED_STATES = Object.freeze([0, 5, 8]);

const oids = (ids) => ids.map((id) => new mongoose.Types.ObjectId(String(id)));

/* A list counts its top-level tasks, as the reports do; a task named on its own counts whatever its
 * level. One $or at the root, so each branch is planned on its own index ({ sprintId, deletedStatusKey }
 * and _id) and a task that is both in a counted list and named is counted once. The groups come back
 * by status type because "done" is decided by isClosedTask, not restated in the pipeline. */
const countPipeline = ({ sprintIds, taskIds }) => [
    {
        $match: {
            $or: [
                ...(sprintIds.length ? [{ sprintId: { $in: idForms(sprintIds) }, deletedStatusKey: { $in: COUNTED_STATES }, isParentTask: true, mainChat: { $ne: true } }] : []),
                ...(taskIds.length ? [{ _id: { $in: oids(taskIds) }, deletedStatusKey: { $in: COUNTED_STATES }, mainChat: { $ne: true } }] : []),
            ],
        },
    },
    { $group: { _id: { statusType: '$statusType', type: '$status.type' }, n: { $sum: 1 } } },
];

const tally = async (companyId, counted) => {
    if (!counted.sprintIds.length && !counted.taskIds.length) return { done: 0, total: 0 };
    const groups = (await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [countPipeline(counted)] }, 'aggregate')) || [];
    const closed = (group) => isClosedTask({ statusType: group._id && group._id.statusType, status: { type: group._id && group._id.type } });
    return {
        done: groups.filter(closed).reduce((sum, group) => sum + group.n, 0),
        total: groups.reduce((sum, group) => sum + group.n, 0),
    };
};

const stampOf = (target, key) => (target.counted && target.counted[key] ? new Date(target.counted[key]).getTime() : null);
const countedAt = (target) => stampOf(target, 'at');

/* A count is made again when it was never made, when it is ten minutes old (which heals an event
 * that never arrived), or when a task changed and the last count is at least thirty seconds old.
 * One that failed waits those thirty seconds too, so a read is never told a count is on its way for ever. */
const isDue = (target, now = new Date()) => {
    if (target.kind !== TASKS) return false;
    const failedAt = stampOf(target, 'failedAt');
    if (failedAt !== null && now.getTime() - failedAt < RECOUNT_GAP_MS) return false;
    const at = countedAt(target);
    if (at === null) return true;
    const age = now.getTime() - at;
    return age >= STALE_AFTER_MS || (target.dirty === true && age >= RECOUNT_GAP_MS);
};

const hasDue = (goal, now) => goal.deletedStatusKey === LIVE && (goal.targets || []).some((target) => isDue(target, now));

/* Always a full count. A source that some reader of the goal can no longer open is left out and kept in `skipped`. */
const recounted = async (companyId, goal, { now = new Date(), only = () => true } = {}) => {
    const due = (goal.targets || []).filter((target) => target.kind === TASKS && only(target));
    if (!due.length) return goal.targets || [];
    const audience = await sources.audienceOf(companyId, goal);
    const fresh = new Map();
    for (const target of due) {
        const { counted, skipped } = await sources.judge(companyId, audience, sources.sourcesOf(target));
        fresh.set(target.id, { ...target, counted: { ...(await tally(companyId, counted)), at: now, skipped }, dirty: false });
    }
    return (goal.targets || []).map((target) => fresh.get(target.id) || target);
};

/* Only the kind of failure is stored: an error's own text can carry what it was reading. */
const reasonOf = (error) => (/timeout|network|selection|notconnected/i.test(String((error && error.name) || '')) ? STORE_UNAVAILABLE : COUNT_ERROR);

const failed = (goal, due, now, failedCode) => (goal.targets || [])
    .map((target) => (due(target) ? { ...target, counted: { ...(target.counted || {}), failedAt: now, failedCode } } : target));

const refresh = async (companyId, goalId) => {
    let failure = null;
    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
        const now = new Date();
        const goal = await crud(companyId, [{ _id: new mongoose.Types.ObjectId(String(goalId)), deletedStatusKey: LIVE }, null, { lean: true }], 'findOne');
        if (!goal || !hasDue(goal, now)) return false;
        const due = (target) => isDue(target, now);
        failure = null;
        const targets = await recounted(companyId, goal, { now, only: due }).catch((error) => { failure = error; return null; });
        const set = failure ? { targets: failed(goal, due, now, reasonOf(failure)) } : withProgress(targets, now);
        if (await writeAtRevision(companyId, goal, set)) {
            announce('update', companyId);
            if (failure) throw failure;
            return true;
        }
    }
    if (failure) throw failure;
    return false;
};

/* One recount at a time in a company, and a goal waits in line once however many reads ask for it. */
const lanes = new Map();

const recountSoon = (companyId, goalId) => {
    const lane = lanes.get(companyId) || { tail: Promise.resolve(), waiting: new Set() };
    lanes.set(companyId, lane);
    const id = String(goalId);
    if (lane.waiting.has(id)) return;
    lane.waiting.add(id);
    const run = lane.tail
        .then(() => refresh(companyId, id))
        .catch((error) => logger.error(`goals recount ${id} in company ${companyId}: ${error.message || error}`))
        .then(() => {
            lane.waiting.delete(id);
            if (lane.tail === run && !lane.waiting.size) lanes.delete(companyId);
        });
    lane.tail = run;
};

const idle = async () => {
    while (lanes.size) await Promise.all([...lanes.values()].map((lane) => lane.tail));
};

module.exports = { STALE_AFTER_MS, RECOUNT_GAP_MS, COUNTED_STATES, STORE_UNAVAILABLE, COUNT_ERROR, countPipeline, tally, isDue, hasDue, recounted, refresh, recountSoon, idle };
