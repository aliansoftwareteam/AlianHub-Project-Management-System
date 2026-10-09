const goalRequests = require('../Agents/goalRequests');
const goalTokens = require('../Goals/goalTokens');
const { GRANT } = require('./manageFlag');
const v2 = require('./v2Flag');
const cursor = require('./cursor');

// Goals, as the person behind the token has them in the web app: each tool runs the goal routes' own handlers
// (Modules/Agents/goalRequests.js), and a token kept to some projects is held to the rule in
// Modules/Goals/goalTokens.js. No tool here creates, archives or deletes a goal.

const NO_GOAL = Object.freeze({ error: 'That goal was not found. Ask the person which goal they mean.' });
const FROM_GOALS = 'A goal belongs to no project, so the project filter has nothing to judge: the goal routes decide who reads it, and Modules/Goals/goalTokens.js what a token kept to some projects is given.';

const str = (v, max = 500) => String(v === undefined || v === null ? '' : v).slice(0, max);
const ID = Object.freeze({ type: 'string', pattern: '^[a-fA-F0-9]{24}$' });
const REASON = Object.freeze({ reason: { type: 'string', maxLength: 500, description: 'Why, in one line. It is kept in the record of changes.' } });
const input = (properties, required) => ({ type: 'object', additionalProperties: false, properties, required });

const TARGET = Object.freeze({ ...ID, description: 'A target of the goal (see goal.get)' });
const SOURCE_KIND = Object.freeze({ type: 'string', enum: ['list', 'task'], description: 'Whether sourceId is a list or a task' });
const SOURCE = Object.freeze({ ...ID, description: 'The list or task' });
const sourceParams = (args) => ({ goalId: str(args.goalId, 40), targetId: str(args.targetId, 40), kind: str(args.kind, 10), sourceId: str(args.sourceId, 40) });
const writeTarget = () => ({ ...goalTokens.WRITE_TARGET });

const REFUSALS = 'A refusal starts with its code: source_not_found (you cannot open it), source_not_shared (not every reader of the goal can open it).';

const TOOLS = [
    {
        name: 'goals.list',
        action: 'goals.list',
        description: 'Shows the goals the person can read, as the Goals page lists them: each with its progress and its targets. A target counted from tasks names the lists and tasks the person can open. mine keeps the goals the person owns or is named on. Changes nothing.',
        input: input({ mine: { type: 'boolean' }, archived: { type: 'boolean', description: 'The archived goals instead of the live ones' }, limit: { type: 'integer', minimum: 1, maximum: cursor.PAGE_MAX } }, []),
        visibility: 'none',
        visibilityReason: FROM_GOALS,
        strict: true,
        paginated: true,
        readParams: () => ({}),
        run: async (ctx, args) => {
            const listed = await goalRequests.listFor({ companyId: ctx.companyId, uid: ctx.userId, mine: args.mine === true, archived: args.archived === true });
            const readable = await goalTokens.readableIds(ctx.companyId, listed.map((goal) => goal._id), ctx.projectIds);
            const all = listed.filter((goal) => readable.has(goal._id));
            const slice = ({ skip, limit }) => all.slice(skip, skip + limit);
            const { rows, nextCursor } = v2.enabled()
                ? await cursor.page(ctx, 'goals.list', args, slice)
                : { rows: slice({ skip: 0, limit: cursor.pageSize(args.limit) }) };
            return { goals: rows, ...(nextCursor ? { nextCursor } : {}) };
        },
    },
    {
        name: 'goal.get',
        action: 'goal.get',
        description: 'Shows one goal the person can read, with its targets, their values and progress. Changes nothing.',
        input: input({ goalId: ID }, ['goalId']),
        visibility: 'none',
        visibilityReason: FROM_GOALS,
        strict: true,
        readParams: () => ({}),
        run: async (ctx, args) => {
            const goal = await goalRequests.goalFor({ companyId: ctx.companyId, uid: ctx.userId, goalId: args.goalId });
            if (!goal || !(await goalTokens.readableIds(ctx.companyId, [goal._id], ctx.projectIds)).has(goal._id)) return { ...NO_GOAL };
            return { goal };
        },
    },
    {
        name: 'goal.target.set',
        action: 'goal.target.set',
        visibility: 'filtered',
        strict: true,
        grant: GRANT,
        filedUnder: GRANT,
        target: writeTarget,
        description: 'Reports the current value of a target set by hand on a goal the person can edit: a number for a number or currency target, true or false for a yes-or-no one. A target counted from tasks is refused with counted_from_tasks.',
        input: input({ goalId: ID, targetId: TARGET, value: { type: ['number', 'boolean'] }, ...REASON }, ['goalId', 'targetId', 'value']),
        params: (args) => ({ goalId: str(args.goalId, 40), targetId: str(args.targetId, 40), value: args.value }),
    },
    {
        name: 'goal.target.sources.add',
        action: 'goal.target.sources.add',
        visibility: 'filtered',
        strict: true,
        grant: GRANT,
        filedUnder: GRANT,
        target: writeTarget,
        description: `Counts one more list or task toward a target counted from tasks, on a goal the person can edit. It is counted at once. ${REFUSALS}`,
        input: input({ goalId: ID, targetId: TARGET, kind: SOURCE_KIND, sourceId: SOURCE, ...REASON }, ['goalId', 'targetId', 'kind', 'sourceId']),
        params: sourceParams,
    },
    {
        name: 'goal.target.sources.remove',
        action: 'goal.target.sources.remove',
        visibility: 'filtered',
        strict: true,
        grant: GRANT,
        filedUnder: GRANT,
        target: writeTarget,
        description: 'Stops counting one list or task toward a target counted from tasks, on a goal the person can edit.',
        input: input({ goalId: ID, targetId: TARGET, kind: SOURCE_KIND, sourceId: SOURCE, ...REASON }, ['goalId', 'targetId', 'kind', 'sourceId']),
        params: sourceParams,
    },
];

const READ_SCOPES = Object.freeze({ 'goals.list': 'projects:read', 'goal.get': 'projects:read' });

module.exports = { TOOLS, READ_SCOPES };
