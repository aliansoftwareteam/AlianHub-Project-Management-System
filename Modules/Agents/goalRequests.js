const tools = require('../Automations/engine/tools');
const { whoOf } = require('./taskRequests');

// Goals an agent reads and changes the way a person does: through the goal routes' own handlers, as the
// person behind the agent, so who may read or edit a goal, what a target may count, the refusal codes and
// the notices when a target is reached are the web app's. The handlers are loaded on first use.

const WORKSPACE = 'workspace';
const KINDS = Object.freeze({ list: 'sprintIds', task: 'taskIds' });
const NOT_COUNTED = 'this target is not counted from tasks, so it has no lists or tasks to change';
const FORBIDDEN = 'You do not have permission to perform this action.';

const refuse = (message) => new tools.DeterministicError(message);
const idOf = (value) => (value === undefined || value === null ? '' : String(value));
const goals = () => require('../Goals/controller');

/* What a goal route answers when it is called as `uid` with no HTTP around it, with the status it set. */
const answerOf = (handler, { companyId, uid, params = {}, query = {}, body }) => new Promise((resolve, reject) => {
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (sent) => { resolve({ statusCode: res.statusCode, ...(sent || {}) }); return res; };
    res.send = res.json;
    Promise.resolve(handler({ uid: idOf(uid), aud: String(companyId), headers: { companyid: String(companyId) }, params, query, body }, res)).catch(reject);
});

/* A refusal keeps the code the route gave it, which is what a caller words its own message from. */
const reasonOf = (answer) => (answer.code ? `${answer.code}: ${answer.message}` : answer.message || answer.statusText || 'the goal was not changed');

const dataOf = async (handler, request) => {
    const answer = await answerOf(handler, request);
    if (answer.status !== true) throw refuse(reasonOf(answer));
    return answer.data;
};

const listFor = ({ companyId, uid, mine = false, archived = false }) => dataOf(goals().listGoals, {
    companyId, uid, query: { ...(mine ? { mine: 'true' } : {}), ...(archived ? { archived: 'true' } : {}) },
});

/* The goal as the web app shows it to `uid`, or null where the route answers that there is no such goal. */
const goalFor = async ({ companyId, uid, goalId }) => {
    const answer = await answerOf(goals().getGoal, { companyId, uid, params: { id: idOf(goalId) } });
    if (answer.status === true) return answer.data;
    if (answer.statusCode === 404) return null;
    throw refuse(reasonOf(answer));
};

const targetIn = async ({ companyId, uid, goalId, targetId }) => {
    const goal = await goalFor({ companyId, uid, goalId });
    if (!goal) throw refuse('Goal not found.');
    const target = (goal.targets || []).find((entry) => entry.id === idOf(targetId));
    if (!target) throw refuse('Target not found.');
    return { goal, target };
};

const afterOf = (goal, targetId) => {
    const target = goal && goal.targets.find((entry) => entry.id === idOf(targetId));
    if (!target) throw refuse('Goal not found.');
    return { goal, target };
};

/* A true-or-false target takes true or false and a measured one a number; a counted one is refused by the route itself. */
const valueBody = (target, value) => (target.kind === 'boolean' ? { done: value } : { current: value });

const setValue = async ({ companyId, uid, goalId, targetId, value }) => {
    const { target } = await targetIn({ companyId, uid, goalId, targetId });
    const previous = target.kind === 'boolean' ? target.done === true : target.current;
    const saved = await dataOf(goals().setTargetValue, { companyId, uid, params: { id: idOf(goalId), targetId: target.id }, body: valueBody(target, value) });
    return { ...afterOf(saved, target.id), previous };
};

/* One list or task is added to, or taken out of, what a target counts: the route is sent the whole set, as the web app sends it. */
const changeSources = async ({ companyId, uid, goalId, targetId, kind, sourceId, operation }) => {
    const key = KINDS[kind];
    if (!key) throw refuse('Say whether it is a list or a task.');
    const { goal, target } = await targetIn({ companyId, uid, goalId, targetId });
    if (target.kind !== 'tasks') throw refuse(NOT_COUNTED);
    if (goal.canEdit !== true) throw refuse(FORBIDDEN);
    const id = idOf(sourceId);
    const held = { sprintIds: [...target.sources.sprintIds], taskIds: [...target.sources.taskIds] };
    const has = held[key].includes(id);
    if (has === (operation === 'add')) return { goal, target, changed: false };
    const sources = { ...held, [key]: operation === 'add' ? [...held[key], id] : held[key].filter((entry) => entry !== id) };
    const saved = await dataOf(goals().editTarget, { companyId, uid, params: { id: goal._id, targetId: target.id }, body: { sources } });
    return { ...afterOf(saved, target.id), changed: true };
};

/* The audit log is read by owners and admins, so it names a goal only while the whole workspace can read that goal. */
const recorded = (goal) => ({ entityType: 'goal', entityId: goal._id, entityName: goal.visibility === WORKSPACE ? goal.name : '' });

const sourceChange = (operation) => async ({ companyId, actor, params }) => {
    const { uid } = whoOf(actor);
    const { goalId, targetId, kind, sourceId } = params;
    const out = await changeSources({ companyId, uid, goalId, targetId, kind, sourceId, operation });
    return {
        result: {
            goalId: out.goal._id, targetId: out.target.id, changed: out.changed, sources: out.target.sources,
            counted: { done: out.target.counted.done, total: out.target.counted.total }, notCounted: out.target.notCounted, progressPct: out.target.progressPct, goalProgressPct: out.goal.progressPct,
        },
        undo: out.changed ? { kind: 'goalSource', goalId: out.goal._id, targetId: out.target.id, sourceKind: idOf(kind), sourceId: idOf(sourceId), operation } : null,
        ...recorded(out.goal),
    };
};

const executors = {
    async 'goal.target.set'({ companyId, actor, params }) {
        const { uid } = whoOf(actor);
        const out = await setValue({ companyId, uid, goalId: params.goalId, targetId: params.targetId, value: params.value });
        return {
            result: { goalId: out.goal._id, targetId: out.target.id, progressPct: out.target.progressPct, reached: Boolean(out.target.reachedAt), goalProgressPct: out.goal.progressPct },
            undo: out.previous === undefined ? null : { kind: 'goalValue', goalId: out.goal._id, targetId: out.target.id, previous: out.previous },
            ...recorded(out.goal),
        };
    },
    'goal.target.sources.add': sourceChange('add'),
    'goal.target.sources.remove': sourceChange('remove'),
};

module.exports = { executors, listFor, goalFor, setValue, changeSources };
