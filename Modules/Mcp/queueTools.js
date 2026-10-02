const actions = require('../Agents/actions');
const projectPolicy = require('../Agents/projectPolicy');
const workQueue = require('../Agents/manager/workQueue');
const { RULE } = require('../Agents/manager/rules');
const { HANDED_OVER, ASKED_IN_CHAT } = require('../Agents/manager/findings');
const { WHERE } = require('../Agents/manager/chatQuestions');
const { CHAT_SCOPE } = require('../../Config/mcpOAuth');
const scopes = require('./scopes');

// The work queue a connected agent pulls from (Modules/Agents/manager/workQueue.js). Listing reads through the
// caller's filter; taking and giving back are registry writes, so the project's policy is asked like for any other.
// Where the project holds a connected agent's writes for a person, a claim is refused instead of filed: a marker
// waiting in the Inbox would ask a person to approve twice, once for the claim and once for the change itself.
// A question the person asked this AI in chat is given with its own text whatever the connection may read: the person
// wrote it to the AI, and only words its author wrote are given. No other message comes with it, and what else of the
// chat a connection reads is the chat tools' rule.

const NO_ITEM = Object.freeze({ ok: false, error: workQueue.REFUSAL.NO_ITEM });
const OBJECT_ID = /^[a-f0-9]{24}$/i;

const str = (v, max = 500) => String(v === undefined || v === null ? '' : v).slice(0, max);
const ID = Object.freeze({ type: 'string', pattern: '^[a-fA-F0-9]{24}$' });
const ITEM = Object.freeze({ ...ID, description: 'An item id from queue.list' });
const REASON = Object.freeze({ reason: { type: 'string', maxLength: 500, description: 'Why, in one line. It is kept in the record of changes.' } });
const input = (properties, required) => ({ type: 'object', additionalProperties: false, properties, required });

const WHY = Object.freeze({
    [ASKED_IN_CHAT]: () => 'The person named you in a chat message. The question is what they wrote to you.',
    [HANDED_OVER]: () => 'A person handed this task to an agent.',
    [RULE.UNTRIAGED]: (facts) => `It came in by ${facts.origin === 'form' ? 'a form' : 'email'} and has no owner and no estimate.`,
    [RULE.OVERLOADED]: (facts) => `One person has ${facts.plannedHours} hours planned this week, and the week holds ${facts.capacityHours}.`,
    [RULE.NO_OWNER]: () => 'The task is open and nobody owns it.',
    [RULE.NO_ESTIMATE]: () => 'The task is open and has no estimate.',
});

const ASKED = Object.freeze({
    [ASKED_IN_CHAT]: 'Answer the person who asked, or make the change they asked for with the usual tools. You cannot write in chat, so give them the answer yourself.',
    [HANDED_OVER]: 'Do what the task asks.',
    [RULE.UNTRIAGED]: 'Give it a type, a priority, an estimate and an owner.',
    [RULE.OVERLOADED]: 'Give one of that person\'s tasks to someone else, or move it. This task is the largest.',
    [RULE.NO_OWNER]: 'Choose an owner.',
    [RULE.NO_ESTIMATE]: 'Add an estimate.',
});

const readsChat = (ctx) => scopes.grantedScopes(ctx.token).includes(CHAT_SCOPE);

const AROUND = Object.freeze({
    CHANNEL: 'chat.messages.list with this channelId shows the messages around it.',
    NO_CHAT: `This connection is not allowed to read chat (it needs ${CHAT_SCOPE}), so only the question is given.`,
    CONVERSATION: 'A conversation between people is never read by a connection, so only the question is given.',
});

const aroundOf = (ctx, where) => {
    if (where.kind === WHERE.CONVERSATION) return AROUND.CONVERSATION;
    return readsChat(ctx) ? AROUND.CHANNEL : AROUND.NO_CHAT;
};

const held = (claim) => (claim ? { yours: true, claimedUntil: new Date(claim.until).toISOString() } : {});

const questionRow = (ctx, { row, question, claim }) => ({
    itemId: String(row._id),
    kind: row.rule,
    messageId: question.messageId,
    question: question.text,
    askedBy: question.askedBy,
    where: question.where,
    ...(question.replyTo ? { replyTo: question.replyTo } : {}),
    around: aroundOf(ctx, question.where),
    why: WHY[row.rule](),
    asked: ASKED[row.rule],
    waitingSince: row.openedAt || null,
    ...held(claim),
});

const taskRow = ({ row, task, claim, project }) => ({
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
    ...held(claim),
});

const itemRow = (ctx) => (item) => (item.question ? questionRow(ctx, item) : taskRow(item));

/* The connection's own limits for chat, which no task filter judges: a channel in a project is inside them as the
 * project and the list are, and chat outside every project only for a connection that is not kept to some projects. */
const reachOf = (ctx, vis) => ({
    allowsProject: vis.allowsProject, allowsSprint: vis.allowsSprint, keptToProjects: Array.isArray(ctx.projectIds) && ctx.projectIds.length > 0,
});

const HELD = 'so no item is claimed here. Work from queue.list without a claim: each change you file waits for a person';

/* Names the item's task and project for the checks every write meets; an id the caller cannot read answers as a missing one. */
const named = (action) => async (ctx, args, vis) => {
    const item = await workQueue.itemFor({
        companyId: ctx.companyId, uid: ctx.userId, itemId: args.itemId, allowsProject: vis.allowsProject, allowsTask: vis.allowsTask, reach: reachOf(ctx, vis), asAgent: true,
    });
    if (!item) return { answer: { ...NO_ITEM } };
    const params = { itemId: String(item.row._id), ...(item.projectId ? { projectId: item.projectId } : {}) };
    const rule = await projectPolicy.ask({ companyId: ctx.companyId, actor: ctx.actor, action, params });
    if (rule.decision !== projectPolicy.DECISION.ACT) {
        throw await actions.refusal(ctx.companyId, ctx.actor, { action, params, reason: rule.paused ? rule.reason : `${rule.reason}, ${HELD}`, ip: ctx.ip, taint: ctx.taint });
    }
    return { args: { ...args, ...params, ...(item.task ? { taskId: String(item.row.taskId) } : {}) } };
};

/* A question names no task: it is held to its project where it was asked in one, and to nothing where it was not. */
const inProject = (args) => (args.projectId ? { projectId: str(args.projectId, 40) } : {});
const itemTarget = (args) => (args.taskId ? { taskId: str(args.taskId, 40) } : inProject(args));

const TOOLS = [
    {
        name: 'queue.list',
        action: 'queue.list',
        description: 'Shows work waiting for an agent: questions the person asked you by name in chat, tasks a person handed over, and things the daily check found that need a decision '
            + '(a task with no owner or no estimate, a new task nobody sorted, a person with too much planned). Work in a project is shown only where its project manager is switched on; a question asked outside every project needs no switch. '
            + 'It shows only items about tasks the person can open, and leaves out items another agent holds. '
            + 'A question comes with its own text as the person last wrote it, where it was asked and who asked; it brings no other message of the chat. '
            + 'Take one with queue.claim before you work on it. Changes nothing.',
        input: input({ projectId: { ...ID, description: 'Only this project' }, limit: { type: 'integer', minimum: 1, maximum: workQueue.LISTED_MAX } }, []),
        visibility: 'filtered',
        strict: true,
        readParams: (args) => (OBJECT_ID.test(String(args.projectId || '')) ? { projectId: String(args.projectId) } : {}),
        run: async (ctx, args, vis) => {
            const items = await workQueue.itemsFor({
                companyId: ctx.companyId, uid: ctx.userId, connection: workQueue.connectionOf(ctx.actor), projectId: args.projectId,
                allowsProject: vis.allowsProject, allowsTask: vis.allowsTask, reach: reachOf(ctx, vis), limit: args.limit,
            });
            return { items: items.map(itemRow(ctx)), claimMinutes: workQueue.CLAIM_MINUTES };
        },
    },
    {
        name: 'queue.claim',
        action: 'queue.claim',
        visibility: 'filtered',
        strict: true,
        target: itemTarget,
        description: `Takes one item from queue.list, so no other agent works on it. It is yours for ${workQueue.CLAIM_MINUTES} minutes; claim it again to keep it longer. `
            + 'Taking an item gives you no extra rights: make the change with the usual tools, which are checked and approved as always. The person can take the item back at any time.',
        input: input({ itemId: ITEM, ...REASON }, ['itemId']),
        prepare: named('queue.claim'),
        params: (args) => ({ itemId: str(args.itemId, 40), ...inProject(args) }),
    },
    {
        name: 'queue.release',
        action: 'queue.release',
        visibility: 'filtered',
        strict: true,
        target: itemTarget,
        description: 'Gives back an item you hold. With finished true it leaves the queue: you made the change, or sent it to a person to approve. Without it the item is free for another agent.',
        input: input({ itemId: ITEM, finished: { type: 'boolean', description: 'True when your part is done' }, ...REASON }, ['itemId']),
        prepare: named('queue.release'),
        params: (args) => ({ itemId: str(args.itemId, 40), ...inProject(args), finished: args.finished === true }),
    },
];

const READ_SCOPES = Object.freeze({ 'queue.list': 'tasks:read' });

module.exports = { TOOLS, READ_SCOPES, NO_ITEM };
