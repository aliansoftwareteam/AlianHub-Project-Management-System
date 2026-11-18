const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const socketEmitter = require('../../event/socketEventEmitter');
const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
const { canReadTask } = require('../Tasks/helpers/taskReadAccess');
const { canUsePage } = require('../Pages/helpers/pageAccess');
const audit = require('./agentAudit');
const registry = require('./registry');
const { isAgent, userAgentAccount } = require('./actor');
const { toolNameOf, VIA_PERSONAL } = require('./actingAgent');

/* A change a person's connected agent applied without waiting for approval is told to that person, who reads one
 * line about it here. The signal carries the id alone; this read answers the person the agent acted for and nobody else. */

const KIND = 'change';
const MAX_IDS = 50;
const OBJECT_ID = /^[0-9a-fA-F]{24}$/;
const TASK_FIELDS = { ProjectID: 1, sprintId: 1, mainChat: 1, AssigneeUserId: 1, TaskName: 1 };
const PAGE_FIELDS = { visibility: 1, createdBy: 1, ProjectID: 1, sharedWith: 1, deletedStatusKey: 1, title: 1 };

/* A token the person made or an app they allowed. A workspace agent's run has neither, and the live strip shows it. */
const throughAConnection = (actor) => isAgent(actor) && Boolean(actor.userId) && Boolean(actor.tokenId || actor.grantId);

const announce = (companyId, actor, auditId) => {
    if (!auditId || !throughAConnection(actor)) return;
    socketEmitter.emit('update', {
        type: 'update', module: 'agent', companyId: String(companyId), data: { kind: KIND, userId: String(actor.userId), auditId: String(auditId) },
        updatedFields: { kind: KIND }, actor: { kind: 'agent' }, depth: 1,
    });
};

const findRow = (companyId, type, id, fields) => MongoDbCrudOpration(companyId, { type, data: [{ _id: new mongoose.Types.ObjectId(String(id)) }, fields] }, 'findOne');

/* The row keeps the token's name; the tool a personal token stands for is on the token or the person's account. */
const agentNameOf = async (companyId, uid, meta) => {
    if (meta.viaAccount !== VIA_PERSONAL) return toolNameOf({ viaAccount: meta.viaAccount, agentName: meta.agentName });
    const token = OBJECT_ID.test(String(meta.tokenId || '')) ? await findRow(companyId, SCHEMA_TYPE.API_TOKENS, meta.tokenId, { agentAccount: 1 }) : null;
    const account = await userAgentAccount(uid);
    const provider = (token && token.agentAccount && token.agentAccount.provider) || (account && account.provider) || null;
    return toolNameOf({ viaAccount: VIA_PERSONAL, agentName: meta.agentName, provider });
};

/* What the change touched, as the person may open it now. null: they cannot, and are told nothing of the change.
 * Only a task and a doc are named; anything else is described by what was done to it. */
const subjectOf = async (companyId, uid, row) => {
    const id = OBJECT_ID.test(String(row.entityId || '')) ? String(row.entityId) : '';
    if (!id) return { taskId: '', name: '' };
    if (row.entityType === 'task') {
        const task = await findRow(companyId, SCHEMA_TYPE.TASKS, id, TASK_FIELDS);
        return task && await canReadTask(companyId, uid, task) ? { taskId: id, name: task.TaskName || '' } : null;
    }
    if (row.entityType === 'page') {
        const page = await findRow(companyId, SCHEMA_TYPE.PAGES, id, PAGE_FIELDS);
        return page && await canUsePage(companyId, page, uid) ? { taskId: '', name: page.title || '' } : null;
    }
    return { taskId: '', name: '' };
};

const ownAppliedChange = (row, uid) => Boolean(row && row.action === audit.ACTION_DONE && row.meta
    && row.meta.actorType === 'agent' && row.meta.state === audit.STATE.APPLIED && (row.meta.tokenId || row.meta.grantId)
    && String(row.meta.onBehalfOf || '') === uid);

const describeOne = async (companyId, uid, auditId, undoContext) => {
    const row = await audit.findById(companyId, auditId);
    if (!ownAppliedChange(row, uid)) return null;
    const subject = await subjectOf(companyId, uid, row);
    if (!subject) return null;
    const undo = require('./undo');
    const meta = row.meta;
    const action = registry.get(meta.action);
    const state = await undo.undoStateOf(companyId, row, { kind: 'human', userId: uid }, await undoContext());
    const parts = meta.undo && meta.undo.kind === 'batch' ? (meta.undo.auditIds || []).map(String) : [];
    return {
        auditId: String(row._id), agentName: await agentNameOf(companyId, uid, meta), action: String(meta.action || ''), label: (action && action.label) || '',
        taskId: subject.taskId, name: subject.name, undoable: state.undoable === true, parts,
    };
};

/* `canList` says whether the person may open the audit log, the one place that lists every agent change. */
const describe = async (companyId, uid, auditIds) => {
    const person = String(uid || '');
    const ids = [...new Set((Array.isArray(auditIds) ? auditIds : []).map(String))].slice(0, MAX_IDS).filter((id) => OBJECT_ID.test(id));
    let shared = null;
    const undoContext = () => { shared = shared || require('./undo').undoContext(companyId, { userId: person }); return shared; };
    const changes = [];
    for (const id of ids) {
        // eslint-disable-next-line no-await-in-loop
        const change = await describeOne(companyId, person, id, undoContext);
        if (change) changes.push(change);
    }
    return { changes, canList: isPrivileged(await getRoleType(companyId, person)) };
};

module.exports = { KIND, MAX_IDS, announce, describe };
