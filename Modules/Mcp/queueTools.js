const workQueue = require('../Agents/manager/workQueue');
const { RULE } = require('../Agents/manager/rules');
const { HANDED_OVER } = require('../Agents/manager/findings');

// The work queue a connected agent pulls from (Modules/Agents/manager/workQueue.js). Listing reads through the
// caller's filter; taking and giving back are registry writes, so the project's policy is asked like for any other.

const NO_ITEM = Object.freeze({ ok: false, error: workQueue.REFUSAL.NO_ITEM });
const OBJECT_ID = /^[a-f0-9]{24}$/i;

const str = (v, max = 500) => String(v === undefined || v === null ? '' : v).slice(0, max);
const ID = Object.freeze({ type: 'string', pattern: '^[a-fA-F0-9]{24}$' });
const ITEM = Object.freeze({ ...ID, description: 'An item id from queue.list' });
const REASON = Object.freeze({ reason: { type: 'string', maxLength: 500, description: 'Why, in a line; it is kept in the audit log' } });
const input = (properties, required) => ({ type: 'object', additionalProperties: false, properties, required });

const WHY = Object.freeze({
    [HANDED_OVER]: () => 'A person handed this task to an agent.',
    [RULE.UNTRIAGED]: (facts) => `It came in by ${facts.origin === 'form' ? 'a form' : 'email'} and has no owner and no estimate.`,
    [RULE.OVERLOADED]: (facts) => `One person has ${facts.plannedHours} hours planned this week, and the week holds ${facts.capacityHours}.`,
    [RULE.NO_OWNER]: () => 'The task is open and nobody owns it.',
    [RULE.NO_ESTIMATE]: () => 'The task is open and has no estimate.',
});

const ASKED = Object.freeze({
    [HANDED_OVER]: 'Do what the task asks.',
    [RULE.UNTRIAGED]: 'Give it a type, a priority, an estimate and an owner.',
    [RULE.OVERLOADED]: 'Give one of that person\'s tasks to someone else, or move it. This task is the largest.',
    [RULE.NO_OWNER]: 'Choose an owner.',
    [RULE.NO_ESTIMATE]: 'Add an estimate.',
});

const itemRow = ({ row, task, claim, project }) => ({
    itemId: String(row._id),
    kind: row.rule,
    projectId: String(row.projectId),
    project,
    taskId: String(row.taskId),
    key: task.TaskKey || '',
    title: task.TaskName || '',
    ...(row.rule === RULE.OVERLOADED ? { personId: String(row.userId || '') } : {}),
    ...(row.rule === HANDED_OVER ? { handedOverBy: String((row.facts && row.facts.handedBy) || '') } : {}),
    why: WHY[row.rule](row.facts || {}),
    asked: ASKED[row.rule],
    waitingSince: row.openedAt || null,
    ...(claim ? { yours: true, claimedUntil: new Date(claim.until).toISOString() } : {}),
});

/* Names the item's task and project for the checks every write meets; an id the caller cannot read answers as a missing one. */
const named = async (ctx, args, vis) => {
    const item = await workQueue.itemFor({ companyId: ctx.companyId, uid: ctx.userId, itemId: args.itemId, allowsProject: vis.allowsProject, allowsTask: vis.allowsTask });
    return item
        ? { args: { ...args, itemId: String(item.row._id), taskId: String(item.row.taskId), projectId: String(item.row.projectId) } }
        : { answer: { ...NO_ITEM } };
};

const itemTarget = (args) => ({ taskId: str(args.taskId, 40) });

const TOOLS = [
    {
        name: 'queue.list',
        action: 'queue.list',
        description: 'Work waiting for an agent, in the projects whose project manager is switched on: tasks a person handed over, and what the daily look found that needs judgement '
            + '(a task with no owner or no estimate, a new task nobody sorted, a person with too much planned). It lists only items about tasks you can open, and leaves out the ones another agent holds. '
            + 'Take one with queue.claim before you work on it.',
        input: input({ projectId: { ...ID, description: 'Only this project' }, limit: { type: 'integer', minimum: 1, maximum: workQueue.LISTED_MAX } }, []),
        visibility: 'filtered',
        strict: true,
        readParams: (args) => (OBJECT_ID.test(String(args.projectId || '')) ? { projectId: String(args.projectId) } : {}),
        run: async (ctx, args, vis) => {
            const items = await workQueue.itemsFor({
                companyId: ctx.companyId, uid: ctx.userId, connection: workQueue.connectionOf(ctx.actor), projectId: args.projectId,
                allowsProject: vis.allowsProject, allowsTask: vis.allowsTask, limit: args.limit,
            });
            return { items: items.map(itemRow), claimMinutes: workQueue.CLAIM_MINUTES };
        },
    },
    {
        name: 'queue.claim',
        action: 'queue.claim',
        visibility: 'filtered',
        strict: true,
        target: itemTarget,
        description: `Take one item from queue.list, so no other agent works on it. It is yours for ${workQueue.CLAIM_MINUTES} minutes; claim it again to keep it longer. `
            + 'A claim gives you no extra rights: make the change with the usual tools, which are checked and approved as always. The person can take the item back at any time.',
        input: input({ itemId: ITEM, ...REASON }, ['itemId']),
        prepare: named,
        params: (args) => ({ itemId: str(args.itemId, 40), projectId: str(args.projectId, 40) }),
    },
    {
        name: 'queue.release',
        action: 'queue.release',
        visibility: 'filtered',
        strict: true,
        target: itemTarget,
        description: 'Give back an item you hold. With finished true it leaves the queue: you made the change, or filed it for a person to approve. Without it the item is free for another agent.',
        input: input({ itemId: ITEM, finished: { type: 'boolean', description: 'True when your part is done' }, ...REASON }, ['itemId']),
        prepare: named,
        params: (args) => ({ itemId: str(args.itemId, 40), projectId: str(args.projectId, 40), finished: args.finished === true }),
    },
];

const READ_SCOPES = Object.freeze({ 'queue.list': 'tasks:read' });

module.exports = { TOOLS, READ_SCOPES, NO_ITEM };
