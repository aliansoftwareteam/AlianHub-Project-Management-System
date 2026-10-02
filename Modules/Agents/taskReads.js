const mongoose = require('mongoose');
const logger = require('../../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { isAgent } = require('./actor');
const marks = require('./workMarks');

// "Changed since you read it". An agent that read a task and then changes it is refused when the task changed in
// between, whoever changed it, and has to read it again. What is compared is the task's own `updatedAt`, kept as the
// agent last saw it. An agent that never read the task has nothing to compare and is not held here. A change a
// person approved is the person's own decision and is not held either.

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

const NOT_HELD = Object.freeze({ refusal: '', end: async () => {} });

/* The turn to change the task, or the reason this agent may not. `end(changed)` gives the turn back, and after a
 * change keeps the task as the agent now knows it, so its own change is not what holds its next one. */
const turnFor = async ({ companyId, actor, action, params, approved = false, now = new Date() }) => {
    const taskId = params && params.taskId;
    const reader = isAgent(actor) && !approved && isId(taskId) && !NOT_A_TASK_CHANGE.has(action) ? marks.readerOf(actor) : '';
    const read = reader ? await marks.markAt(companyId, readScope(taskId), reader) : null;
    if (!read || !read.seen) return NOT_HELD;

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
            if (changed) await saw(companyId, actor, taskId).catch(quietly(`the read of ${key} by ${reader} was not kept`));
            await giveBack().catch(quietly(`the turn on ${key} was not given back`));
        },
    };
};

module.exports = { REFUSAL, TURN_MS, saw, stampOf, turnFor };
