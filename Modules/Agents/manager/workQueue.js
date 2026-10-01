const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const socketEmitter = require('../../../event/socketEventEmitter');
const { idForms } = require('../../../utils/mongo-handler/objectIdKeys');
const { getRoleType, evaluatePermission, isWritable } = require('../../../Config/permissionGuard');
const { ROLE_GUEST } = require('../../../Config/roleTypes');
const { readableTaskIds } = require('../../Tasks/helpers/taskWritePlacement');
const { isClosedTask } = require('../../Tasks/helpers/taskSignals');
const { DeterministicError } = require('../../Automations/engine/tools');
const { toolNameOf, byline } = require('../actingAgent');
const { userAgentAccount } = require('../actor');
const { RULE } = require('./rules');
const findings = require('./findings');

// The work a connected agent pulls: the findings that need judgement and the tasks a person handed over, in
// projects whose project manager is on. An item is a project_findings row, and a claim is a field on it, so
// taking one is a single conditional write. A claim marks who is working; it grants nothing, and whatever
// the agent then changes goes through the usual tools and the project's policy.

const CLAIM_MINUTES = 30;
const MINUTE_MS = 60 * 1000;
const { STATUS, HANDED_OVER, OFFER_NEEDS } = findings;
const QUEUE_RULES = Object.freeze([HANDED_OVER, RULE.UNTRIAGED, RULE.OVERLOADED, RULE.NO_OWNER, RULE.NO_ESTIMATE]);
const LEFT = Object.freeze({ TAKEN_BACK: 'taken_back', FINISHED: 'finished' });
const ROWS_READ = 200;
const PROJECTS_READ = 200;
const LISTED_MAX = 25;
const LISTED_DEFAULT = 10;
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const TASK_FIELDS = Object.freeze({ ProjectID: 1, sprintId: 1, mainChat: 1, AssigneeUserId: 1, TaskName: 1, TaskKey: 1, statusType: 1, status: 1 });

const REFUSAL = Object.freeze({
    NOT_CONNECTED: 'Only a connected agent takes work from the queue.',
    NO_ITEM: 'item not found',
    TAKEN: 'Another agent holds that item. Pick another one.',
    NOT_HELD: 'You do not hold that item. Your claim may have run out, or a person took the item back.',
});

const isId = (value) => OBJECT_ID.test(String(value || ''));
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const plain = (row) => (row && typeof row.toObject === 'function' ? row.toObject() : row);
const find = async (companyId, type, data) => ((await MongoDbCrudOpration(companyId, { type, data }, 'find')) || []).map(plain);
const change = async (companyId, filter, update) => plain(await MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.PROJECT_FINDINGS, data: [filter, update, { returnDocument: 'after' }],
}, 'findOneAndUpdate'));

/* Only the fact of a change goes out, to the company it names (socket/controller/agentSocket.js). Each page reads
 * the held tasks again and is answered with what its person may open. */
const announce = (companyId) => socketEmitter.emit('update', {
    type: 'update', module: 'agent', companyId: String(companyId), data: { kind: 'claim' }, updatedFields: { kind: 'claim' }, actor: { kind: 'agent' }, depth: 1,
});

const waiting = Object.freeze({ status: STATUS.OPEN, rule: { $in: QUEUE_RULES }, proposalId: null, leftQueue: null });

/* One connection acting for one person: a personal token, or an outside client's grant. */
const connectionOf = (actor) => {
    if (actor && actor.grantId) return `grant:${actor.grantId}`;
    return actor && actor.tokenId ? `token:${actor.tokenId}` : '';
};

const nameOf = async (actor) => byline(toolNameOf(actor), actor.personName || ((await userAgentAccount(actor.userId)) || {}).name || 'Member');

const liveClaim = (row, now) => (row && row.claim && new Date(row.claim.until).getTime() > new Date(now).getTime() ? row.claim : null);

const isMember = async (companyId, uid) => {
    const roleType = await getRoleType(companyId, uid);
    return roleType !== null && roleType !== undefined && roleType !== ROLE_GUEST;
};

const projectsOn = (companyId, ids) => find(companyId, SCHEMA_TYPE.PROJECTS, [
    { 'agentManager.on': true, deletedStatusKey: { $ne: 1 }, ...(ids ? { _id: { $in: ids.filter(isId).map(oid) } } : {}) }, { ProjectName: 1 }, { limit: PROJECTS_READ },
]);

/* The rows a person may read, each with its task: every task a row names or counts must be one they can open,
 * by the rule the task list uses, and one the connection's own filter (`allowsTask`) lets through. */
const readableBy = async (companyId, uid, rows, allowsTask = () => true) => {
    const ids = [...new Set(rows.flatMap((row) => (row.taskIds || []).map(String)))];
    if (!ids.length || !(await isMember(companyId, uid))) return [];
    const [readable, tasks] = await Promise.all([
        readableTaskIds(companyId, uid, ids),
        find(companyId, SCHEMA_TYPE.TASKS, [{ _id: { $in: ids.map(oid) }, deletedStatusKey: { $ne: 1 } }, TASK_FIELDS]),
    ]);
    const open = new Set(readable);
    const byId = new Map(tasks.map((task) => [String(task._id), task]));
    const reads = (id) => open.has(String(id)) && byId.has(String(id)) && allowsTask(byId.get(String(id)));
    return rows.filter((row) => (row.taskIds || []).length && row.taskIds.every(reads) && byId.has(String(row.taskId)))
        .map((row) => ({ row, task: byId.get(String(row.taskId)) }));
};

/* The claim that still stands. One whose holder can no longer open the item's tasks is dropped here. */
const heldBy = async (companyId, row, now) => {
    const claim = liveClaim(row, now);
    if (!claim) return null;
    const ids = [...new Set((row.taskIds || []).map(String))];
    if ((await readableTaskIds(companyId, claim.userId, ids)).length === ids.length) return claim;
    await change(companyId, { _id: row._id, 'claim.by': claim.by }, { $unset: { claim: '' } });
    return null;
};

const byUrgency = (a, b) => QUEUE_RULES.indexOf(a.row.rule) - QUEUE_RULES.indexOf(b.row.rule) || new Date(a.row.openedAt) - new Date(b.row.openedAt);

/* What a connection may take or already holds, the most urgent first. Nothing is counted beside the list. */
const itemsFor = async ({ companyId, uid, connection, projectId, allowsProject = () => true, allowsTask, limit, now = new Date() }) => {
    const projects = (await projectsOn(companyId, projectId ? [projectId] : null)).filter((project) => allowsProject(String(project._id)));
    if (!projects.length) return [];
    const names = new Map(projects.map((project) => [String(project._id), project.ProjectName || '']));
    const rows = await find(companyId, SCHEMA_TYPE.PROJECT_FINDINGS, [
        { ...waiting, projectId: { $in: idForms([...names.keys()]) } }, {}, { sort: { openedAt: 1 }, limit: ROWS_READ },
    ]);
    const mine = (await readableBy(companyId, uid, rows, allowsTask)).filter((item) => !isClosedTask(item.task)).sort(byUrgency);
    const most = Math.min(Math.max(Number(limit) || LISTED_DEFAULT, 1), LISTED_MAX);
    const listed = [];
    for (const item of mine) {
        if (listed.length >= most) break;
        // eslint-disable-next-line no-await-in-loop
        const claim = await heldBy(companyId, item.row, now);
        if (!claim || claim.by === connection) listed.push({ ...item, claim, project: names.get(String(item.row.projectId)) || '' });
    }
    return listed;
};

/* One waiting item the person may read, in a project whose manager is on; null for every other id, a hidden one and a missing one alike. */
const itemFor = async ({ companyId, uid, itemId, allowsProject = () => true, allowsTask }) => {
    if (!isId(itemId)) return null;
    const [row] = await find(companyId, SCHEMA_TYPE.PROJECT_FINDINGS, [{ ...waiting, _id: oid(itemId) }]);
    if (!row || !allowsProject(String(row.projectId)) || !(await projectsOn(companyId, [String(row.projectId)])).length) return null;
    const [item] = await readableBy(companyId, uid, [row], allowsTask);
    return item && !isClosedTask(item.task) ? item : null;
};

const entity = (item) => ({ entityId: item.row.taskId, entityName: item.task.TaskName || '' });

const executors = {
    /* Exactly one of two callers wins: the write matches only a row nobody holds, or one the caller holds already. */
    async 'queue.claim'({ companyId, actor, params }) {
        const connection = connectionOf(actor);
        if (!connection) throw new DeterministicError(REFUSAL.NOT_CONNECTED);
        const item = await itemFor({ companyId, uid: actor.userId, itemId: params.itemId });
        if (!item) throw new DeterministicError(REFUSAL.NO_ITEM);
        const now = new Date();
        const held = await heldBy(companyId, item.row, now);
        // A claim kept longer keeps the time it was first taken: a list of tasks shows it as "since".
        const at = held && held.by === connection ? held.at : now;
        const claim = { by: connection, userId: String(actor.userId), name: await nameOf(actor), at, until: new Date(now.getTime() + CLAIM_MINUTES * MINUTE_MS) };
        const taken = await change(companyId, {
            ...waiting, _id: item.row._id, $or: [{ claim: null }, { 'claim.until': { $lte: now } }, { 'claim.by': connection }],
        }, { $set: { claim } });
        if (!taken) throw new DeterministicError(REFUSAL.TAKEN);
        announce(companyId);
        return {
            result: { itemId: String(item.row._id), claimedUntil: claim.until.toISOString(), minutes: CLAIM_MINUTES },
            undo: { kind: 'queueItem', was: 'claimed', itemId: String(item.row._id), taskId: item.row.taskId, by: connection }, ...entity(item),
        };
    },

    async 'queue.release'({ companyId, actor, params }) {
        const connection = connectionOf(actor);
        const item = connection ? await itemFor({ companyId, uid: actor.userId, itemId: params.itemId }) : null;
        const now = new Date();
        const claim = item ? liveClaim(item.row, now) : null;
        if (!claim || claim.by !== connection) throw new DeterministicError(REFUSAL.NOT_HELD);
        const finished = params.finished === true;
        const handedOver = item.row.rule === HANDED_OVER;
        const left = { why: LEFT.FINISHED, userId: String(actor.userId), name: claim.name, at: now };
        const set = finished ? { leftQueue: left, ...(handedOver ? { status: STATUS.CLOSED, closedAt: now } : {}) } : null;
        const released = await change(companyId, { _id: item.row._id, 'claim.by': connection }, { $unset: { claim: '' }, ...(set ? { $set: set } : {}) });
        if (!released) throw new DeterministicError(REFUSAL.NOT_HELD);
        announce(companyId);
        return {
            result: { itemId: String(item.row._id), released: true, finished },
            undo: finished ? { kind: 'queueItem', was: 'finished', itemId: String(item.row._id), taskId: item.row.taskId } : null, ...entity(item),
        };
    },
};

const inverses = {
    async queueItem(companyId, u) {
        const restored = u.was === 'claimed'
            ? await change(companyId, { _id: oid(u.itemId), 'claim.by': u.by }, { $unset: { claim: '' } })
            : await change(companyId, { _id: oid(u.itemId), 'leftQueue.why': LEFT.FINISHED }, { $set: { status: STATUS.OPEN }, $unset: { leftQueue: '', closedAt: '' } });
        if (restored) announce(companyId);
        return { itemId: u.itemId, restored: Boolean(restored) };
    },
};

const holds = async (companyId, uid, key, projectId) => isWritable(await evaluatePermission(companyId, uid, key, { projectId: String(projectId) }));

const mayTakeBack = async (companyId, uid, row, claim) => (claim && String(claim.userId) === String(uid))
    || String((row.facts && row.facts.handedBy) || '') === String(uid)
    || holds(companyId, uid, OFFER_NEEDS[row.rule], row.projectId);

const shown = (claim) => (claim ? { name: claim.name, until: new Date(claim.until).toISOString() } : null);

/* What the web app says about each finding it lists: who holds it, and whether this person may take it back. */
const claimsOf = async (companyId, uid, listed, now = new Date()) => {
    const ids = listed.map((finding) => finding.id).filter(isId);
    const rows = ids.length ? await find(companyId, SCHEMA_TYPE.PROJECT_FINDINGS, [{ _id: { $in: ids.map(oid) } }]) : [];
    const byId = new Map(rows.map((row) => [String(row._id), row]));
    return Promise.all(listed.map(async (finding) => {
        const row = byId.get(String(finding.id));
        const claim = row ? await heldBy(companyId, row, now) : null;
        if (!claim) return finding;
        return { ...finding, claim: shown(claim), canTakeBack: Boolean(await mayTakeBack(companyId, uid, row, claim)) };
    }));
};

/* The holders who can still open what they hold, asked once for each person and not once for each row. Nothing is
 * written here: a claim its holder lost is dropped by the next read of that item (`heldBy`). */
const stillHolding = async (companyId, items) => {
    const idsOf = new Map();
    items.forEach(({ row }) => idsOf.set(String(row.claim.userId), [...(idsOf.get(String(row.claim.userId)) || []), ...row.taskIds.map(String)]));
    const open = new Map(await Promise.all([...idsOf].map(async ([holder, ids]) => [holder, new Set(await readableTaskIds(companyId, holder, ids))])));
    return items.filter(({ row }) => row.taskIds.every((id) => open.get(String(row.claim.userId)).has(String(id))));
};

const byClaimTime = (a, b) => new Date(a.row.claim.at) - new Date(b.row.claim.at);

/* The marks on a list of tasks: each task an agent holds that the person can open, with who holds it and since
 * when. One read of the claims serves any number of rows, and no total is sent beside the list. */
const heldTasks = async (companyId, uid, now = new Date()) => {
    const projects = await projectsOn(companyId);
    if (!projects.length) return [];
    const rows = await find(companyId, SCHEMA_TYPE.PROJECT_FINDINGS, [
        { ...waiting, projectId: { $in: idForms(projects.map((project) => String(project._id))) }, 'claim.until': { $gt: now } }, {}, { limit: ROWS_READ },
    ]);
    const held = await stillHolding(companyId, await readableBy(companyId, uid, rows.filter((row) => liveClaim(row, now))));
    const first = new Map();
    held.sort(byClaimTime).forEach(({ row }) => { if (!first.has(String(row.taskId))) first.set(String(row.taskId), row); });
    return [...first.values()].map((row) => ({ taskId: String(row.taskId), projectId: String(row.projectId), name: row.claim.name, since: new Date(row.claim.at).toISOString() }));
};

const openTask = async (companyId, uid, taskId) => {
    if (!isId(taskId)) return null;
    const [item] = await readableBy(companyId, uid, [{ taskId: String(taskId), taskIds: [String(taskId)] }]);
    return item && item.task.mainChat !== true ? item.task : null;
};

const aboutTaskRows = (companyId, task) => find(companyId, SCHEMA_TYPE.PROJECT_FINDINGS, [
    { ...waiting, projectId: { $in: idForms([String(task.ProjectID)]) }, taskId: String(task._id) },
]);

const NOTHING = Object.freeze({ on: false, canHandOver: false, items: [] });

/* The line a task shows: the items about it that an agent holds or a person handed over. A task the person
 * cannot open, a missing one and one in a project whose manager is off all answer alike. */
const aboutTask = async (companyId, uid, taskId, now = new Date()) => {
    const task = await openTask(companyId, uid, taskId);
    if (!task || !(await projectsOn(companyId, [String(task.ProjectID)])).length) return { ...NOTHING, items: [] };
    const readable = await readableBy(companyId, uid, await aboutTaskRows(companyId, task));
    const items = (await Promise.all(readable.map(async ({ row }) => {
        const claim = await heldBy(companyId, row, now);
        if (!claim && row.rule !== HANDED_OVER) return null;
        return { id: String(row._id), rule: row.rule, claim: shown(claim), canTakeBack: Boolean(await mayTakeBack(companyId, uid, row, claim)) };
    }))).filter(Boolean);
    const handed = readable.some(({ row }) => row.rule === HANDED_OVER);
    return { on: true, canHandOver: !handed && !isClosedTask(task) && await holds(companyId, uid, OFFER_NEEDS[HANDED_OVER], task.ProjectID), items };
};

const handOver = async (companyId, uid, taskId, now = new Date()) => {
    const about = await aboutTask(companyId, uid, taskId, now);
    if (!about.on) return { error: 'This task cannot be handed to an agent.', status: 404 };
    if (!about.canHandOver) return { error: 'You cannot hand this task to an agent.', status: about.items.some((item) => item.rule === HANDED_OVER) ? 409 : 403 };
    const task = await openTask(companyId, uid, taskId);
    const key = `${HANDED_OVER}:${task._id}`;
    const [closed] = await find(companyId, SCHEMA_TYPE.PROJECT_FINDINGS, [{ projectId: { $in: idForms([String(task.ProjectID)]) }, key, status: STATUS.CLOSED }]);
    await findings.open(companyId, String(task.ProjectID), {
        key, rule: HANDED_OVER, taskId: String(task._id), taskIds: [String(task._id)], facts: { taskKey: task.TaskKey || '', taskName: task.TaskName || '', handedBy: String(uid) },
    }, now, closed);
    return { about: await aboutTask(companyId, uid, taskId, now) };
};

/* A person takes an item out of the agents' hands: a handed-over task goes back to people, a finding stays listed for them. */
const takeBack = async (companyId, uid, itemId, now = new Date()) => {
    const item = await itemFor({ companyId, uid, itemId });
    if (!item) return { error: 'Item not found.', status: 404 };
    const { row } = item;
    const claim = await heldBy(companyId, row, now);
    if (!claim && row.rule !== HANDED_OVER) return { error: 'No agent holds this item.', status: 409 };
    if (!(await mayTakeBack(companyId, uid, row, claim))) return { error: 'You cannot take this item back.', status: 403 };
    const left = { why: LEFT.TAKEN_BACK, userId: String(uid), at: now };
    await change(companyId, { _id: row._id, status: STATUS.OPEN }, {
        $unset: { claim: '' }, $set: { leftQueue: left, ...(row.rule === HANDED_OVER ? { status: STATUS.CLOSED, closedAt: now } : {}) },
    });
    announce(companyId);
    return { taskId: row.taskId, projectId: String(row.projectId) };
};

/* A handed-over task that was closed or deleted since leaves the queue with the day's look. */
const closeFinished = async (companyId, projectId, now = new Date()) => {
    const rows = await find(companyId, SCHEMA_TYPE.PROJECT_FINDINGS, [{ projectId: { $in: idForms([String(projectId)]) }, rule: HANDED_OVER, status: STATUS.OPEN }]);
    const ids = rows.map((row) => String(row.taskId)).filter(isId);
    const tasks = ids.length ? await find(companyId, SCHEMA_TYPE.TASKS, [{ _id: { $in: ids.map(oid) }, deletedStatusKey: { $ne: 1 } }, { statusType: 1, status: 1 }]) : [];
    const open = new Set(tasks.filter((task) => !isClosedTask(task)).map((task) => String(task._id)));
    await Promise.all(rows.filter((row) => !open.has(String(row.taskId))).map((row) => findings.settle(companyId, row, STATUS.CLOSED, now)));
};

module.exports = {
    CLAIM_MINUTES, QUEUE_RULES, LEFT, REFUSAL, LISTED_MAX, connectionOf, liveClaim, itemsFor, itemFor, executors, inverses, claimsOf, heldTasks, aboutTask, handOver, takeBack, closeFinished,
};
