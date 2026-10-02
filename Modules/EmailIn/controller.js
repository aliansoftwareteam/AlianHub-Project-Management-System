const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { removeCache } = require('../../utils/commonFunctions');
const logger = require('../../Config/loggerConfig');
const { taskMongo } = require('../Tasks/helpers/task_class_Mongo'); // canonical task create
const R = require('./helpers/emailInRules');
const { pinSessionTenant } = require('../../Config/tenant');
const { canEditProject } = require('../../Config/projectAccess');
const { listOf } = require('../Tasks/helpers/taskWritePlacement');
const { hiddenSprintFilter } = require('../Sprints/helpers/sprintVisibility');

const CREATES_TASKS = ['task.task_create'];
const PROJECT_NOT_FOUND = 'Project not found.';

/* An inbox makes tasks in one list of one project, so it is made, listed, switched and removed by a person who can
 * create tasks in that project and see that list. */
const opensPlace = async (companyId, uid, projectId, sprintId) => (await canEditProject(companyId, uid, String(projectId), CREATES_TASKS)).allowed === true
    && Boolean(await listOf(companyId, uid, String(projectId), String(sprintId)));
const opensInbox = (companyId, uid, inbox) => opensPlace(companyId, uid, inbox.ProjectID, inbox.sprintId);

const liveInbox = (companyId, id) => (oid(id)
    ? MongoDbCrudOpration(GLOBAL, { type: SCHEMA_TYPE.EMAIL_INBOXES, data: [{ _id: oid(id), companyId: String(companyId), deletedStatusKey: { $ne: 1 } }] }, 'findOne')
    : null);

// AUTO-01 — email-to-task. An inbox doc lives in the GLOBAL db (keyed by token)
// so the unauthenticated inbound webhook can resolve token -> company without
// auth. At inbox-creation time we snapshot project / sprint / user (exactly like
// RecurringTasks) so the inbound handler can call taskMongo.create with no
// re-loading. Management endpoints are companyId-scoped + JWT (setMiddleware).

const GLOBAL = SCHEMA_TYPE.GOLBAL;
const DOMAIN = process.env.EMAIL_IN_DOMAIN || 'inbox.alianhub.com';
const oid = (id) => { try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return null; } };

/* The lists of the project `uid` does not see, as a clause on the list rows. */
const hiddenSprintFilterById = async (companyId, uid, projectId) => {
    const hidden = (await hiddenSprintFilter(companyId, uid, [String(projectId)])).sprintId;
    return hidden ? { _id: hidden } : {};
};

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

// Pick the project's first usable sprint (top-level first, then inside folders) so
// the inbound task has a real target. Read from the sprints collection: a project
// document's sprintsObj is a legacy copy that no sprint write maintains, so a
// project whose sprints were created through the API embeds none of them.
const resolveDefaultSprint = async (companyId, projectId, uid) => {
    const pid = oid(projectId);
    if (!pid) return null;
    const rows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.SPRINTS,
        data: [{ projectId: pid, deletedStatusKey: { $ne: 1 }, ...(uid ? await hiddenSprintFilterById(companyId, uid, projectId) : {}) }],
    }, 'find').catch(() => []);
    const sprints = Array.isArray(rows) ? rows : [];
    const sprint = sprints.find((s) => s && !s.folderId) || sprints[0];
    if (!sprint) return null;

    const sid = String(sprint._id);
    const out = { sprintId: sid, sprintArray: { id: sid, name: sprint.name || 'Sprint' } };
    if (sprint.folderId) {
        const folder = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.FOLDERS,
            data: [{ _id: sprint.folderId }],
        }, 'findOne').catch(() => null);
        out.folderObjId = String(sprint.folderId);
        out.sprintArray.folderId = out.folderObjId;
        out.sprintArray.folderName = (folder && folder.name) || '';
    }
    return out;
};

// POST /api/v1/email-in/inboxes  { projectId | projectData:{_id}, userData, name? }
// Loads the project (company DB) for code/name + resolves a default sprint, so the
// caller only needs to pick a project.
exports.createInbox = async (req, res) => {
    try {
        const companyId = pinSessionTenant(req, res);
        if (!companyId) return undefined;
        const b = req.body || {};
        const creatorId = String(req.uid || '');
        if (!creatorId) return res.status(401).send({ status: false, statusText: 'A signed-in user is required.' });
        const claimedCreator = b.userData && b.userData.id;
        if (claimedCreator && String(claimedCreator) !== creatorId) {
            return res.status(403).send({ status: false, statusText: 'An inbox can only create tasks as you.' });
        }
        const projectId = (b.projectData && b.projectData._id) || b.projectId;
        if (!projectId || !oid(projectId)) {
            return res.send({ status: false, statusText: 'A valid projectId is required.' });
        }
        const project = (await canEditProject(companyId, creatorId, String(projectId), CREATES_TASKS)).allowed
            ? await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PROJECTS, data: [{ _id: oid(projectId) }] }, 'findOne').catch(() => null)
            : null;
        if (!project) return res.send({ status: false, statusText: PROJECT_NOT_FOUND });
        const projObj = project.toObject ? project.toObject() : project;

        // Sprint: a client-supplied sprintArray wins; otherwise resolve the project's first sprint.
        let sprintId = (b.sprintArray && (b.sprintArray.id || b.sprintArray._id)) || b.sprintId || '';
        let sprintArray = (b.sprintArray && (b.sprintArray.id || b.sprintArray._id)) ? b.sprintArray : null;
        let folderObjId = '';
        if (!sprintId || !sprintArray) {
            const def = await resolveDefaultSprint(companyId, projectId, creatorId);
            if (!def) return res.send({ status: false, statusText: 'This project has no list to receive tasks — create a list first.' });
            sprintId = def.sprintId; sprintArray = def.sprintArray; folderObjId = def.folderObjId || '';
        } else if (!(await listOf(companyId, creatorId, String(projectId), String(sprintId)))) {
            return res.send({ status: false, statusText: PROJECT_NOT_FOUND });
        }

        const tmpl = buildTemplate(b, companyId);
        tmpl.ProjectID = projObj._id;
        tmpl.CompanyId = companyId;
        tmpl.sprintId = sprintId;
        tmpl.sprintArray = sprintArray;
        if (folderObjId) tmpl.folderObjId = folderObjId;

        const token = R.generateInboxToken();
        const doc = {
            _id: new mongoose.Types.ObjectId(),
            token,
            companyId: String(companyId),
            name: b.name || (projObj.ProjectName ? `${projObj.ProjectName} inbox` : 'Email inbox'),
            ProjectID: oid(projectId),
            sprintId,
            sprintArray,
            templateSnapshot: tmpl,
            projectSnapshot: { _id: projObj._id, CompanyId: companyId, ProjectCode: projObj.ProjectCode, ProjectName: projObj.ProjectName },
            userSnapshot: {
                id: creatorId, Employee_Name: b.userData && b.userData.Employee_Name,
                companyOwnerId: b.userData && b.userData.companyOwnerId,
            },
            enabled: true,
            createdBy: creatorId,
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
        const companyId = pinSessionTenant(req, res);
        if (!companyId) return undefined;
        const q = { companyId: String(companyId), deletedStatusKey: { $ne: 1 } };
        if (req.query && req.query.projectId && oid(req.query.projectId)) q.ProjectID = oid(req.query.projectId);
        const rows = await MongoDbCrudOpration(GLOBAL, { type: SCHEMA_TYPE.EMAIL_INBOXES, data: [q, {}, { sort: { createdAt: -1 } }] }, 'find');
        const open = [];
        for (const row of rows || []) {
            if (await opensInbox(companyId, String(req.uid || ''), row)) open.push(row);
        }
        return res.send({ status: true, data: open.map(withAddress) });
    } catch (e) { logger.error(`listInboxes: ${e.message}`); return res.send({ status: false, statusText: e.message }); }
};

// PUT /api/v1/email-in/inboxes/:id  { enabled?, name? }
exports.updateInbox = async (req, res) => {
    try {
        const companyId = pinSessionTenant(req, res);
        if (!companyId) return undefined;
        const set = {};
        if (req.body.enabled !== undefined) set.enabled = !!req.body.enabled;
        if (req.body.name !== undefined) set.name = String(req.body.name).slice(0, 120);
        if (!Object.keys(set).length) return res.send({ status: false, statusText: 'Nothing to update.' });
        const inbox = await liveInbox(companyId, req.params.id);
        if (!inbox || !(await opensInbox(companyId, String(req.uid || ''), inbox))) return res.send({ status: false, statusText: 'Not found.' });
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
        const companyId = pinSessionTenant(req, res);
        if (!companyId) return undefined;
        const inbox = await liveInbox(companyId, req.params.id);
        if (!inbox || !(await opensInbox(companyId, String(req.uid || ''), inbox))) return res.send({ status: false, statusText: 'Not found.' });
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
            origin: { kind: 'email', ref: R.originRef(req.body || {}, new Date()) },
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
