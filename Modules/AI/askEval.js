const { readIntent } = require('./askIntent');
const { taskClauses } = require('./askStructured');
const { deriveState } = require('../Sprints/scrumRules');
const SET = require('./evals/askIntent.cases.json');

/* The held-out structured-Ask questions, answered by the live intent reader and task clauses against the
 * set's own tasks in memory: no database, no model, the same result every run. Follows the steps of
 * askStructured.structuredTasks; the jest suite runs the same set through the full Ask path. */

const SUITE = 'ask_intent';
const DAY = 86400000;
const ACTIVE_SPRINT_STATES = ['active', 'overdue'];

const at = (now, days) => (days === null || days === undefined ? null : new Date(now.getTime() + days * DAY));
const same = (value, wanted) => String(value) === String(wanted);
const comparable = (v) => (v instanceof Date ? v.getTime() : v);

const OPERATORS = {
    $in: (value, list) => list.some((wanted) => (Array.isArray(value) ? value.some((v) => same(v, wanted)) : same(value, wanted))),
    $nin: (value, list) => !OPERATORS.$in(value, list),
    $ne: (value, wanted) => (wanted === null ? value !== null && value !== undefined : !equals(value, wanted)),
    $gte: (value, bound) => value != null && comparable(value) >= comparable(bound),
    $lt: (value, bound) => value != null && comparable(value) < comparable(bound),
    $size: (value, n) => Array.isArray(value) && value.length === n,
};

function equals(value, wanted) {
    if (wanted === null) return value === null || value === undefined;
    if (Array.isArray(value)) return value.some((v) => same(v, wanted));
    return same(value, wanted);
}

const isOperatorObject = (condition) => condition && typeof condition === 'object' && !(condition instanceof Date)
    && Object.keys(condition).length > 0 && Object.keys(condition).every((key) => key in OPERATORS);

/* Just the operators taskClauses writes; an unknown one fails the case rather than passing it. */
const matches = (doc, filter) => Object.entries(filter).every(([key, condition]) => {
    if (key === '$and') return condition.every((part) => matches(doc, part));
    if (key === '$or') return condition.some((part) => matches(doc, part));
    if (isOperatorObject(condition)) return Object.entries(condition).every(([op, arg]) => OPERATORS[op](doc[key], arg));
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) throw new Error(`askEval: unsupported condition on ${key}`);
    return equals(doc[key], condition);
});

const contextOf = (set, now) => {
    const visible = set.projects.filter((p) => p.visible);
    const visibleIds = new Set(visible.map((p) => p.id));
    const byCode = Object.fromEntries(set.projects.map((p) => [p.code, p]));
    const byFirst = Object.fromEntries(set.members.map((m) => [m.first, m]));
    const sprintByName = Object.fromEntries(set.sprints.map((s) => [s.name, s]));
    const statusByKey = Object.fromEntries(set.statuses.map((s) => [s.key, s]));
    const statuses = set.statuses.map((s) => ({ key: s.key, name: s.name, type: s.type }));
    return {
        selfId: set.asker,
        projects: visible.map((p) => ({ id: p.id, name: p.name, code: p.code, statuses, people: [] })),
        members: set.members.map((m) => ({ id: m.id, name: `${m.first} ${m.last}`, first: m.first, last: m.last })),
        sprints: set.sprints
            .filter((s) => visibleIds.has(byCode[s.project].id))
            .map((s) => ({
                id: s.id, name: s.name, projectId: byCode[s.project].id,
                active: ACTIVE_SPRINT_STATES.includes(deriveState({ isScrum: s.isScrum, state: s.state, endDate: at(now, s.endInDays) }, now)),
            })),
        tasks: set.tasks.map((t) => {
            const status = statusByKey[t.status];
            return {
                ref: t.key, ProjectID: byCode[t.project].id, deletedStatusKey: 0,
                statusKey: status.key, statusType: status.type,
                AssigneeUserId: t.assignee ? [byFirst[t.assignee].id] : [], DueDate: at(now, t.dueInDays),
                sprintId: t.sprint ? sprintByName[t.sprint].id : undefined,
            };
        }),
    };
};

const answer = (question, ctx, now) => {
    const quick = readIntent(question, { selfId: ctx.selfId, projects: ctx.projects.map((p) => ({ id: p.id, name: p.name })) });
    if (!quick.needsContext) return [];
    const intent = readIntent(question, ctx);
    if (!intent.filtered) return [];
    const scopeIds = intent.projectIds.length ? intent.projectIds : ctx.projects.map((p) => p.id);
    const clauses = taskClauses(intent, { now, timeZone: 'UTC' });
    const filter = { deletedStatusKey: { $ne: 1 }, ProjectID: { $in: scopeIds }, ...(clauses.length ? { $and: clauses } : {}) };
    return ctx.tasks.filter((task) => matches(task, filter)).map((task) => task.ref).sort();
};

const runHeldOut = ({ cases } = {}) => {
    const now = new Date(SET.now);
    const ctx = contextOf(SET, now);
    const list = cases || SET.cases;
    const failures = [];
    list.forEach((c) => {
        const expected = [...c.expect].sort();
        let got;
        try {
            got = answer(c.question, ctx, now);
        } catch (error) {
            got = [`error: ${error.message}`];
        }
        if (JSON.stringify(got) !== JSON.stringify(expected)) failures.push({ question: c.question, expected, got });
    });
    return { suite: SUITE, total: list.length, passed: list.length - failures.length, failures };
};

module.exports = { SUITE, runHeldOut };
