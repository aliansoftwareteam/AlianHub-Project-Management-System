const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { idForms } = require('../../../utils/mongo-handler/objectIdKeys');
const { getRoleType, evaluatePermission, isWritable } = require('../../../Config/permissionGuard');
const { ROLE_GUEST } = require('../../../Config/roleTypes');
const { readableTaskIds } = require('../../Tasks/helpers/taskWritePlacement');
const { RULE, MOST_URGENT_FIRST } = require('./rules');

// Stored findings, one row per project and cause. `handled` and `declined` rows are kept so the same change is
// not offered again: handled until the cause is gone, declined for good.
const STATUS = Object.freeze({ OPEN: 'open', HANDLED: 'handled', DECLINED: 'declined', CLOSED: 'closed' });
// A task a person handed to an agent (./workQueue). It is kept as a row here so one list and one rule of who reads it serve both; no rule finds it.
const HANDED_OVER = 'handed_over';
const READ = 200;
const SHOWN = 50;
const DUPLICATE_KEY = 11000;

/* What a person needs to make the change a finding offers; without it they read the finding and are offered nothing. */
const OFFER_NEEDS = Object.freeze({
    [RULE.SLIPPING]: 'task.task_due_date',
    [RULE.BLOCKED]: 'task.task_comment',
    [RULE.STALE]: 'task.task_comment',
    [RULE.OVERLOADED]: 'task.task_assignee',
    [RULE.NO_OWNER]: 'task.task_assignee',
    [RULE.UNTRIAGED]: 'task.task_assignee',
    [RULE.NO_ESTIMATE]: 'task.task_estimated_hours',
    [HANDED_OVER]: 'task.task_assignee',
});

const plain = (row) => (row && typeof row.toObject === 'function' ? row.toObject() : row);
const inProject = (projectId) => ({ projectId: { $in: idForms([String(projectId)]) } });
const find = async (companyId, data) => ((await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PROJECT_FINDINGS, data }, 'find')) || []).map(plain);
const change = (companyId, filter, update) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.PROJECT_FINDINGS, data: [filter, update, { returnDocument: 'after' }],
}, 'findOneAndUpdate');

const described = (finding, now) => ({
    rule: finding.rule, taskId: finding.taskId || '', taskIds: finding.taskIds, userId: finding.userId || '', facts: finding.facts, lastSeenAt: now,
});

/* Every row the look has to weigh: the ones still standing, and any closed one whose cause is found again. */
const standing = (companyId, projectId, keys) => find(companyId, [{
    ...inProject(projectId), rule: { $ne: HANDED_OVER }, $or: [{ status: { $in: [STATUS.OPEN, STATUS.HANDLED, STATUS.DECLINED] } }, { key: { $in: keys } }],
}]);

/* null when another server filed or reopened the same finding first. */
const open = async (companyId, projectId, finding, now, closedRow) => {
    const fields = { ...described(finding, now), status: STATUS.OPEN, openedAt: now };
    if (closedRow) return plain(await change(companyId, { _id: closedRow._id, status: STATUS.CLOSED }, { $set: fields, $unset: { closedAt: '', proposalId: '', claim: '', leftQueue: '' } }));
    try {
        return plain(await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PROJECT_FINDINGS, data: { projectId: String(projectId), key: finding.key, ...fields } }, 'save'));
    } catch (error) {
        if (error && error.code === DUPLICATE_KEY) return null;
        throw error;
    }
};

const refresh = (companyId, row, finding, now) => change(companyId, { _id: row._id }, { $set: described(finding, now) });
const attach = (companyId, row, proposalId) => change(companyId, { _id: row._id }, { $set: { proposalId: String(proposalId) } });
const settle = (companyId, row, status, now) => change(companyId, { _id: row._id, status: row.status }, {
    $set: { status, ...(status === STATUS.CLOSED ? { closedAt: now } : {}) },
});

const openedSince = async (companyId, projectId, since) => (await find(companyId, [{ ...inProject(projectId), rule: { $ne: HANDED_OVER }, openedAt: { $gte: since } }, { _id: 1 }])).length;

const byUrgency = (a, b) => MOST_URGENT_FIRST.indexOf(a.rule) - MOST_URGENT_FIRST.indexOf(b.rule) || new Date(b.openedAt) - new Date(a.openedAt);

/* A finding is read only by a person who can open every task it names or counts, by the rule the task list uses,
 * so a private list's tasks reach nobody outside it, by name or by count. A guest reads none. */
const visibleTo = async (companyId, uid, projectId) => {
    const roleType = await getRoleType(companyId, uid);
    if (roleType === null || roleType === undefined || roleType === ROLE_GUEST) return [];
    const rows = await find(companyId, [{ ...inProject(projectId), status: STATUS.OPEN }, {}, { sort: { openedAt: -1 }, limit: READ }]);
    const readable = new Set(await readableTaskIds(companyId, uid, rows.flatMap((row) => row.taskIds || [])));
    const mine = rows.filter((row) => (row.taskIds || []).every((id) => readable.has(String(id)))).sort(byUrgency).slice(0, SHOWN);
    const holds = new Map();
    const mayMake = (rule) => {
        if (!holds.has(rule)) holds.set(rule, evaluatePermission(companyId, uid, OFFER_NEEDS[rule], { projectId: String(projectId) }).then(isWritable));
        return holds.get(rule);
    };
    return Promise.all(mine.map(async (row) => {
        const canDecide = await mayMake(row.rule);
        return {
            id: String(row._id), rule: row.rule, taskId: row.taskId || '', userId: row.userId || '', facts: row.facts || {}, openedAt: row.openedAt, canDecide,
            ...(canDecide && row.proposalId ? { proposalId: String(row.proposalId) } : {}),
        };
    }));
};

module.exports = { STATUS, HANDED_OVER, OFFER_NEEDS, SHOWN, standing, open, refresh, attach, settle, openedSince, visibleTo };
