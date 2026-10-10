const mongoose = require('mongoose');
const logger = require('../../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { isAgent } = require('./actor');
const marks = require('./workMarks');

// "Changed since you read it". An agent that read a task and then changes it is refused when the task changed in
// between, whoever changed it, and has to read it again. What is compared is the task's own `updatedAt`, kept as the
// agent last saw it, from a task.get or from a row of a task list it was shown. An agent that never read the task has
// nothing to compare and is not held here. A change a person approved is the person's own decision and is not held
// either.

const TURN = 'turn';
const TURN_MS = 60 * 1000;
const NOT_A_TASK_CHANGE = new Set(['queue.claim', 'queue.release', 'tasks.batch']);

const REFUSAL = Object.freeze({
    CHANGED: 'changed since you read it: this task was changed after you last read it. Read it again, then decide whether your change still fits.',
    BUSY: 'changed since you read it: another agent is changing this task right now. Read it again, then decide whether your change still fits.',
});

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const isId = (value) => OBJECT_ID.test(String(value || ''));
const readScope = (taskId) => `read:${String(taskId).toLowerCase()}`;
const time = (value) => (value ? new Date(value).getTime() : 0);
const quietly = (what) => (e) => logger.error(`[task-reads] ${what}: ${e.message}`);

const stampOf = async (companyId, taskId) => {
    const task = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [{ _id: new mongoose.Types.ObjectId(String(taskId)) }, { updatedAt: 1 }] }, 'findOne');
    return task && task.updatedAt ? new Date(task.updatedAt) : null;
};

/* Take `stamp` before the task is read: a change that lands during the read then counts as one the agent has not seen. */
const saw = async (companyId, actor, taskId, stamp) => {
    const reader = isAgent(actor) ? marks.readerOf(actor) : '';
    if (!reader || !isId(taskId)) return;
    const seen = stamp ? new Date(stamp) : await stampOf(companyId, taskId);
    if (!seen) return;
    const scope = readScope(taskId);
    await marks.take(companyId, scope, reader, await marks.markAt(companyId, scope, reader), { seen, at: new Date() });
};

/* A list of tasks the agent was shown is a read of each, as of the row it was shown. Only a read the agent already
 * holds is moved on: a task it never read is not held, so a search writes nothing for it. */
const sawRows = async (companyId, actor, rows) => {
    const reader = isAgent(actor) ? marks.readerOf(actor) : '';
    const shown = new Map((Array.isArray(rows) ? rows : [])
        .filter((row) => row && isId(row._id) && row.updatedAt)
        .map((row) => [readScope(row._id), new Date(row.updatedAt)]));
    if (!reader || !shown.size) return;
    const held = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENT_WORK_MARKS, data: [{ scope: { $in: [...shown.keys()] }, key: reader }] }, 'find') || [];
    await Promise.all(held.map((row) => {
        const seen = shown.get(row.scope);
        return time(seen) > time(row.seen) ? marks.take(companyId, row.scope, reader, row, { seen, at: new Date() }) : null;
    }));
};

/* The other task a change writes onto beside its own: the far end of a link. */
const alsoTouched = (params) => [params && params.relatedTaskId].filter(isId);

/* The tasks of a change whose read is current: after the change they are kept as the agent now knows them, so its own
 * change is not what holds its next one. A read that was already behind stays behind. */
const currentReads = async (companyId, reader, ids) => {
    const out = [];
    for (const id of ids) {
        // eslint-disable-next-line no-await-in-loop
        const read = await marks.markAt(companyId, readScope(id), reader);
        // eslint-disable-next-line no-await-in-loop
        if (read && read.seen && time(await stampOf(companyId, id)) <= time(read.seen)) out.push(id);
    }
    return out;
};

const keepReads = (companyId, actor, ids, reader) => Promise.all(ids.map((id) => saw(companyId, actor, id)
    .catch(quietly(`the read of ${String(id).toLowerCase()} by ${reader} was not kept`))));

const NOT_HELD = Object.freeze({ refusal: '', end: async () => {} });

/* The turn to change the task, or the reason this agent may not. `end(changed)` gives the turn back, and after a
 * change keeps the task as the agent now knows it, so its own change is not what holds its next one. */
const turnFor = async ({ companyId, actor, action, params, approved = false, now = new Date() }) => {
    const taskId = params && params.taskId;
    const reader = isAgent(actor) && isId(taskId) && !NOT_A_TASK_CHANGE.has(action) ? marks.readerOf(actor) : '';
    if (!reader) return NOT_HELD;
    const others = await currentReads(companyId, reader, alsoTouched(params));
    const read = await marks.markAt(companyId, readScope(taskId), reader);
    // A change a person approved is not held, but the agent's own approved change does not hold its next one either.
    if (approved || !read || !read.seen) {
        const kept = approved && read && read.seen && time(await stampOf(companyId, taskId)) <= time(read.seen) ? [taskId, ...others] : others;
        return kept.length ? { refusal: '', end: async (changed) => { if (changed) await keepReads(companyId, actor, kept, reader); } } : NOT_HELD;
    }

    const key = String(taskId).toLowerCase();
    const was = await marks.markAt(companyId, TURN, key);
    const taken = was && was.by && was.by !== reader && time(was.until) > now.getTime();
    const turn = taken ? null : await marks.take(companyId, TURN, key, was, { by: reader, until: new Date(now.getTime() + TURN_MS) });
    if (!turn) return { refusal: REFUSAL.BUSY, end: NOT_HELD.end };

    const giveBack = () => marks.giveUp(companyId, { scope: TURN, key, by: reader });
    if (time(await stampOf(companyId, taskId)) > time(read.seen)) {
        await giveBack();
        return { refusal: REFUSAL.CHANGED, end: NOT_HELD.end };
    }
    return {
        refusal: '',
        end: async (changed) => {
            if (changed) await keepReads(companyId, actor, [taskId, ...others], reader);
            await giveBack().catch(quietly(`the turn on ${key} was not given back`));
        },
    };
};

module.exports = { REFUSAL, TURN_MS, saw, sawRows, stampOf, turnFor };
