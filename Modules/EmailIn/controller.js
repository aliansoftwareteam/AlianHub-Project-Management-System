const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { removeCache } = require('../../utils/commonFunctions');
const logger = require('../../Config/loggerConfig');
const { taskMongo } = require('../Tasks/helpers/task_class_Mongo'); // canonical task create
const R = require('./helpers/emailInRules');

// AUTO-01 — email-to-task. An inbox doc lives in the GLOBAL db (keyed by token)
// so the unauthenticated inbound webhook can resolve token -> company without
// auth. At inbox-creation time we snapshot project / sprint / user (exactly like
// RecurringTasks) so the inbound handler can call taskMongo.create with no
// re-loading. Management endpoints are companyId-scoped + JWT (setMiddleware).

const GLOBAL = SCHEMA_TYPE.GOLBAL;
const DOMAIN = process.env.EMAIL_IN_DOMAIN || 'inbox.alianhub.com';
const companyOf = (req) => req.headers['companyid'] || (req.body && req.body.companyId) || (req.query && req.query.companyId);
const oid = (id) => { try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return null; } };

const withAddress = (doc) => {
    if (!doc) return doc;
    const o = doc.toObject ? doc.toObject() : { ...doc };
    o.address = R.inboxAddress(o.token, DOMAIN);
    return o;
};

// The task template stored on the inbox (mirrors RecurringTasks buildTemplateFromBody
// so taskMongo.create accepts it). TaskName is filled per-email from the subject.
const buildTemplate = (b, companyId) => {
    const project = b.projectData || {};
    return {
        TaskName: '', TaskKey: '-', AssigneeUserId: Array.isArray(b.assignees) ? b.assignees : [], watchers: [],
        DueDate: '', dueDateDeadLine: [], TaskType: b.taskType || 'task', TaskTypeKey: Number(b.taskTypeKey) || 1,
        ParentTaskId: '', ProjectID: project._id, CompanyId: project.CompanyId || companyId,
        status: { text: 'To Do', key: 1, type: 'default_active' }, isParentTask: true,
        Task_Leader: (b.userData && b.userData.id) || '', Task_Priority: b.priority || 'MEDIUM',
        deletedStatusKey: 0, statusType: 'default_active', statusKey: 1, points: null,
        rawDescription: '', descriptionBlock: {},
    };
};

// POST /api/v1/email-in/inboxes
exports.createInbox = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const b = req.body || {};
        if (!companyId || !b.projectData || !b.projectData._id) {
            return res.send({ status: false, statusText: 'companyId and projectData (with _id) are required.' });
        }
        const token = R.generateInboxToken();
        const doc = {
            _id: new mongoose.Types.ObjectId(),
            token,
            companyId: String(companyId),
            name: b.name || (b.projectData.ProjectName ? `${b.projectData.ProjectName} inbox` : 'Email inbox'),
            ProjectID: oid(b.projectData._id),
            sprintId: b.sprintId || (b.sprintArray && (b.sprintArray.id || b.sprintArray._id)) || '',
            templateSnapshot: buildTemplate(b, companyId),
            projectSnapshot: {
                _id: b.projectData._id, CompanyId: b.projectData.CompanyId || companyId,
                ProjectCode: b.projectData.ProjectCode, ProjectName: b.projectData.ProjectName,
            },
            userSnapshot: {
                id: b.userData && b.userData.id, Employee_Name: b.userData && b.userData.Employee_Name,
                companyOwnerId: b.userData && b.userData.companyOwnerId,
            },
            sprintArray: b.sprintArray || {},
            enabled: true,
            createdBy: (b.userData && b.userData.id) || '',
            receivedCount: 0,
            deletedStatusKey: 0,
        };
        const saved = await MongoDbCrudOpration(GLOBAL, { type: SCHEMA_TYPE.EMAIL_INBOXES, data: doc }, 'save');
        removeCache(`email_inboxes:${companyId}`);
        return res.send({ status: true, statusText: 'Inbox created.', data: withAddress(saved) });
    } catch (e) { logger.error(`createInbox: ${e.message}`); return res.send({ status: false, statusText: e.message }); }
};

// GET /api/v1/email-in/inboxes?projectId=
exports.listInboxes = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.send({ status: false, statusText: 'companyId is required.' });
        const q = { companyId: String(companyId), deletedStatusKey: { $ne: 1 } };
        if (req.query && req.query.projectId && oid(req.query.projectId)) q.ProjectID = oid(req.query.projectId);
        const rows = await MongoDbCrudOpration(GLOBAL, { type: SCHEMA_TYPE.EMAIL_INBOXES, data: [q, {}, { sort: { createdAt: -1 } }] }, 'find');
        return res.send({ status: true, data: (rows || []).map(withAddress) });
    } catch (e) { logger.error(`listInboxes: ${e.message}`); return res.send({ status: false, statusText: e.message }); }
};

// PUT /api/v1/email-in/inboxes/:id  { enabled?, name? }
exports.updateInbox = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.send({ status: false, statusText: 'companyId is required.' });
        const set = {};
        if (req.body.enabled !== undefined) set.enabled = !!req.body.enabled;
        if (req.body.name !== undefined) set.name = String(req.body.name).slice(0, 120);
        if (!Object.keys(set).length) return res.send({ status: false, statusText: 'Nothing to update.' });
        const updated = await MongoDbCrudOpration(GLOBAL, {
            type: SCHEMA_TYPE.EMAIL_INBOXES,
            data: [{ _id: oid(req.params.id), companyId: String(companyId) }, { $set: set }, { returnDocument: 'after' }],
        }, 'findOneAndUpdate');
        if (!updated) return res.send({ status: false, statusText: 'Not found.' });
        removeCache(`email_inboxes:${companyId}`);
        return res.send({ status: true, statusText: 'Inbox updated.', data: withAddress(updated) });
    } catch (e) { logger.error(`updateInbox: ${e.message}`); return res.send({ status: false, statusText: e.message }); }
};

// DELETE /api/v1/email-in/inboxes/:id
exports.deleteInbox = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.send({ status: false, statusText: 'companyId is required.' });
        await MongoDbCrudOpration(GLOBAL, {
            type: SCHEMA_TYPE.EMAIL_INBOXES,
            data: [{ _id: oid(req.params.id), companyId: String(companyId) }, { $set: { deletedStatusKey: 1, enabled: false } }],
        }, 'updateOne');
        removeCache(`email_inboxes:${companyId}`);
        return res.send({ status: true, statusText: 'Inbox removed.' });
    } catch (e) { logger.error(`deleteInbox: ${e.message}`); return res.send({ status: false, statusText: e.message }); }
};

// POST /api/v1/email-in/:token — PUBLIC, provider-agnostic inbound webhook.
// Body: { from, subject, text, html, to } (any inbound-parse provider).
exports.receiveEmail = async (req, res) => {
    try {
        const token = String(req.params.token || '').toLowerCase();
        if (!R.isInboxToken(token)) return res.status(400).json({ status: false, statusText: 'Invalid inbox token.' });
        const inbox = await MongoDbCrudOpration(GLOBAL, { type: SCHEMA_TYPE.EMAIL_INBOXES, data: [{ token }] }, 'findOne');
        if (!inbox || inbox.deletedStatusKey === 1 || inbox.enabled === false) {
            return res.status(404).json({ status: false, statusText: 'Inbox not found.' });
        }
        const parsed = R.parseInbound(req.body || {});
        const tmpl = (inbox.templateSnapshot && (inbox.templateSnapshot.toObject ? inbox.templateSnapshot.toObject() : inbox.templateSnapshot)) || {};
        const data = Object.assign({}, tmpl, {
            _id: new mongoose.Types.ObjectId(),
            TaskKey: '-',
            TaskName: parsed.taskName,
            rawDescription: parsed.description,
            ProjectID: inbox.ProjectID,
            CompanyId: inbox.companyId,
            sprintId: inbox.sprintId,
            sprintArray: inbox.sprintArray || tmpl.sprintArray,
            deletedStatusKey: 0,
            startDate: new Date(),
        });
        const indexObj = { indexName: 'groupByStatusIndex', searchKey: 'statusKey', searchValue: String(data.statusKey || 1) };
        const result = await taskMongo.create({
            data,
            user: inbox.userSnapshot || { id: inbox.createdBy, Employee_Name: '', companyOwnerId: '' },
            projectData: inbox.projectSnapshot || { _id: inbox.ProjectID, CompanyId: inbox.companyId },
            indexObj,
        });
        if (!result || !result.status) {
            return res.status(202).json({ status: false, statusText: 'Accepted but task not created.', detail: result && result.message });
        }
        await MongoDbCrudOpration(GLOBAL, {
            type: SCHEMA_TYPE.EMAIL_INBOXES,
            data: [{ token }, { $set: { lastEmailFrom: parsed.senderEmail, lastTaskId: String(result.id), lastReceivedAt: new Date() }, $inc: { receivedCount: 1 } }],
        }, 'updateOne').catch(() => {});
        return res.json({ status: true, statusText: 'Task created.', data: { taskId: result.id } });
    } catch (e) { logger.error(`receiveEmail: ${e.message}`); return res.status(500).json({ status: false, statusText: e.message }); }
};
