const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { idForms } = require('../../../utils/mongo-handler/objectIdKeys');
const socketEmitter = require('../../../event/socketEventEmitter');
const tools = require('../../Automations/engine/tools');

const LINKS_MAX = 10;
const FINISHED_STATUS = /close|done|complete/i;
const REVIEW_STATUS = 'In Review';

const escapeText = (text) => String(text == null ? '' : text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const findTasks = async (companyId, projectIds, keys) => {
    if (!projectIds.length || !keys.length) return [];
    const rows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS,
        data: [{ ProjectID: { $in: idForms(projectIds) }, TaskKey: { $in: keys }, deletedStatusKey: 0 }, { TaskKey: 1, TaskName: 1, ProjectID: 1, statusKey: 1, statusType: 1, links: 1 }],
    }, 'find');
    return rows || [];
};

const addLink = async (companyId, task, { url, label }, actingUserId) => {
    const held = Array.isArray(task.links) ? task.links : [];
    if (held.some((link) => link && link.url === url)) return { added: false, reason: 'already_linked' };
    if (held.length >= LINKS_MAX) return { added: false, reason: 'links_full' };
    const link = { _id: new mongoose.Types.ObjectId(), url, kind: 'pr', label: String(label || '').slice(0, 200), addedBy: String(actingUserId), actorType: 'integration', agentId: null, addedAt: new Date() };
    const updated = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS, data: [{ _id: task._id, deletedStatusKey: 0 }, { $push: { links: link } }, { returnDocument: 'after' }],
    }, 'findOneAndUpdate');
    if (!updated) return { added: false, reason: 'task_gone' };
    socketEmitter.emit('update', { type: 'update', module: 'task', companyId, data: updated, updatedFields: { links: updated.links }, actor: { kind: 'automation', userId: null }, depth: 1 });
    return { added: true };
};

const addComment = (companyId, task, text, actingUserId) => tools.addComment(
    companyId, task._id, escapeText(text), { actingUserId: String(actingUserId), ruleName: 'GitHub', auditedByCaller: true },
);

/* Never Done: a task already finished, or already in review, stays where it is. */
const moveToReview = async (companyId, task) => {
    if (FINISHED_STATUS.test(String(task.statusType || ''))) return { moved: false, reason: 'finished' };
    let patch;
    try {
        patch = await tools.resolveStatus(companyId, task.ProjectID, REVIEW_STATUS);
    } catch (error) {
        if (error.deterministic) return { moved: false, reason: 'no_review_status' };
        throw error;
    }
    if (String(task.statusKey) === String(patch.statusKey)) return { moved: false, reason: 'already_there' };
    await tools.updateTask(companyId, task._id, patch, { action: 'app_connection.task_moved', auditedByCaller: true });
    return { moved: true };
};

module.exports = { findTasks, addLink, addComment, moveToReview, escapeText, REVIEW_STATUS };
