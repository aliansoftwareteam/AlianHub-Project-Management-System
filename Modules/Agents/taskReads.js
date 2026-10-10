const mongoose = require('mongoose');
const logger = require('../../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { isAgent } = require('./actor');
const marks = require('./workMarks');

// "Changed since you read it". An agent that read a task and then changes it is refused when the task changed in
// between, whoever changed it, and has to read it again. What is compared is the task's own `updatedAt`, kept as the
// agent last saw it: `seen` from a task.get, `listed` from a row of a task list it was shown. A row shows only some of
// a task, so `listed` counts only for a change that adds to the task or touches what a row shows (listSafe). An agent
// that never read the task has nothing to compare and is not held here. A change a person approved is the person's
// own decision and is not held either.

const TURN = 'turn';
const TURN_MS = 60 * 1000;
const NOT_A_TASK_CHANGE = new Set(['queue.claim', 'queue.release', 'tasks.batch']);
const LIST_SAFE_ACTIONS = new Set(['task.comment', 'comment.create', 'task.status.set', 'task.status.change', 'task.link', 'task.relation.add', 'task.relation.remove', 'timelog.start', 'timelog.stop', 'timelog.create']);
const LIST_SAFE_FIELDS = new Set(['Task_Priority', 'DueDate', 'totalEstimatedTime']);
const LISTED_MAX = 100;

const REFUSAL = Object.freeze({
    CHANGED: 'changed since you read it: this task was changed after you last read it. Read it again, then decide whether your change still fits.',
    BUSY: 'changed since you read it: another agent is changing this task right now. Read it again, then decide whether your change still fits.',
    CHANGED_UNSHOWN: 'changed since you read it: this task was changed after you last read it in full, and a task list does not show what this change touches. Read it with task.get, then decide whether your change still fits.',
});

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const isId = (value) => OBJECT_ID.test(String(value || ''));
const readScope = (taskId) => `read:${String(taskId).toLowerCase()}`;
const time = (value) => (value ? new Date(value).getTime() : 0);
const quietly = (what) => (e) => logger.error(`[task-reads] ${what}: ${e.message}`);

const listSafe = (action, params) => {
    if (LIST_SAFE_ACTIONS.has(action)) return true;
    const fields = action === 'task.edit' && params && params.fields && typeof params.fields === 'object' ? Object.keys(params.fields) : [];
    return fields.length > 0 && fields.every((name) => LIST_SAFE_FIELDS.has(name));
};

const stampOf = async (companyId, taskId) => {
    const task = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [{ _id: new mongoose.Types.ObjectId(String(taskId)) }, { updatedAt: 1 }] }, 'findOne');
    return task && task.updatedAt ? new Date(task.updatedAt) : null;
};

/* Take `stamp` before the task is read: a change that lands during the read then counts as one the agent has not seen. */
const saw = async (companyId, actor, taskId, stamp, level = 'seen') => {
    const reader = isAgent(actor) ? marks.readerOf(actor) : '';
    if (!reader || !isId(taskId)) return;
    const at = stamp ? new Date(stamp) : await stampOf(companyId, taskId);
    if (!at) return;
    const scope = readScope(taskId);
    await marks.take(companyId, scope, reader, await marks.markAt(companyId, scope, reader), { [level]: at, at: new Date() });
};

/* A list of tasks the agent was shown moves `listed` on for each, as of the row it was shown. Only a read the agent
 * already holds is moved on: a task it never read is not held, so a list writes nothing for it. */
const sawRows = async (companyId, actor, rows) => {
    const reader = isAgent(actor) ? marks.readerOf(actor) : '';
    const shown = new Map((Array.isArray(rows) ? rows : []).slice(0, LISTED_MAX)
        .filter((row) => row && isId(row._id) && row.updatedAt)
        .map((row) => [readScope(row._id), new Date(row.updatedAt)]));
    if (!reader || !shown.size) return;
    const held = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENT_WORK_MARKS, data: [{ scope: { $in: [...shown.keys()] }, key: reader }] }, 'find') || [];
    const ops = held
        .filter((row) => time(shown.get(row.scope)) > Math.max(time(row.seen), time(row.listed)))
        .map((row) => ({ updateOne: { filter: { _id: row._id, rev: Number(row.rev || 0) }, update: { $set: { listed: shown.get(row.scope), at: new Date() }, $inc: { rev: 1 } } } }));
    if (ops.length) await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENT_WORK_MARKS, data: [ops, { ordered: false }] }, 'bulkWrite');
};

/* Which of the agent's reads of a task is current for this change: 'seen', 'listed', or '' when neither is. */
const currentLevel = (read, stamp, safe) => {
    if (!read) return '';
    if (read.seen && time(stamp) <= time(read.seen)) return 'seen';
    return safe && read.listed && time(stamp) <= time(read.listed) ? 'listed' : '';
};

const currentReads = async (companyId, reader, ids, safe) => {
    const out = [];
    for (const id of ids) {
        // eslint-disable-next-line no-await-in-loop
        const level = currentLevel(await marks.markAt(companyId, readScope(id), reader), await stampOf(companyId, id), safe);
        if (level) out.push({ id, level });
    }
    return out;
};

/* After its own change a read that was current is kept current, at the level it had, as of what that change wrote: a
 * stamp later than the moment the change finished is someone else's, and leaves the read behind. This assumes the
 * process that wrote the change stamps updatedAt from the same clock as `changedAt`. */
const keepReads = (companyId, actor, kept, reader, changedAt) => Promise.all(kept.map(async ({ id, level }) => {
    const stamp = await stampOf(companyId, id);
    if (!stamp || time(stamp) > time(changedAt)) return;
    await saw(companyId, actor, id, stamp, level);
})).catch(quietly(`the reads kept by ${reader} were not written`));

const NOT_HELD = Object.freeze({ refusal: '', end: async () => {} });

/* The turn to change the task, or the reason this agent may not. `end(changedAt)` gives the turn back, and after a
 * change keeps the task as the agent now knows it, so its own change is not what holds its next one. `edited` is an
 * approval that changed what the agent asked for: the change is then the person's, and no read is kept current. */
const turnFor = async ({ companyId, actor, action, params, approved = false, edited = false, now = new Date() }) => {
    const taskId = params && params.taskId;
    const reader = isAgent(actor) && isId(taskId) && !NOT_A_TASK_CHANGE.has(action) ? marks.readerOf(actor) : '';
    if (!reader) return NOT_HELD;
    const safe = listSafe(action, params);
    const others = edited ? [] : await currentReads(companyId, reader, [params.relatedTaskId].filter(isId), true);
    const read = await marks.markAt(companyId, readScope(taskId), reader);
    if (approved || !read || !(read.seen || read.listed)) {
        const level = approved && !edited ? currentLevel(read, await stampOf(companyId, taskId), safe) : '';
        const kept = level ? [{ id: taskId, level }, ...others] : others;
        return kept.length ? { refusal: '', end: async (changedAt) => { if (changedAt) await keepReads(companyId, actor, kept, reader, changedAt); } } : NOT_HELD;
    }

    const key = String(taskId).toLowerCase();
    const was = await marks.markAt(companyId, TURN, key);
    const taken = was && was.by && was.by !== reader && time(was.until) > now.getTime();
    const turn = taken ? null : await marks.take(companyId, TURN, key, was, { by: reader, until: new Date(now.getTime() + TURN_MS) });
    if (!turn) return { refusal: REFUSAL.BUSY, end: NOT_HELD.end };

    const giveBack = () => marks.giveUp(companyId, { scope: TURN, key, by: reader });
    const stamp = await stampOf(companyId, taskId);
    const level = currentLevel(read, stamp, safe);
    if (!level) {
        await giveBack();
        const listedCovers = read.listed && time(stamp) <= time(read.listed);
        return { refusal: listedCovers ? REFUSAL.CHANGED_UNSHOWN : REFUSAL.CHANGED, end: NOT_HELD.end };
    }
    return {
        refusal: '',
        end: async (changedAt) => {
            if (changedAt) await keepReads(companyId, actor, [{ id: taskId, level }, ...others], reader, changedAt);
            await giveBack().catch(quietly(`the turn on ${key} was not given back`));
        },
    };
};

module.exports = { REFUSAL, TURN_MS, saw, sawRows, stampOf, turnFor };
