const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { removeCache } = require('../../utils/commonFunctions');
const logger = require('../../Config/loggerConfig');
const { taskMongo } = require('../Tasks/helpers/task_class_Mongo'); // canonical task create
const R = require('./helpers/emailInRules');
const { pinSessionTenant } = require('../../Config/tenant');
const { canEditProject, keepVisibleProjectIds } = require('../../Config/projectAccess');
const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
const { sprintIdentities, canSeeSprint } = require('../Sprints/helpers/sprintVisibility');
const { actingUser } = require('../Sprints/helpers/actingUser');
const { activeMemberIds } = require('../notification/activeMembers');
const { peopleWhoOpen, keptOnProject } = require('../../Config/projectPeople');

// AUTO-01 — email-to-task. An inbox doc lives in the GLOBAL db (keyed by token)
// so the unauthenticated inbound webhook can resolve token -> company without
// auth. At inbox-creation time we snapshot project / sprint / user (exactly like
// RecurringTasks) so the inbound handler can call taskMongo.create with no
// re-loading. Management endpoints are companyId-scoped + JWT (setMiddleware).

const GLOBAL = SCHEMA_TYPE.GOLBAL;
const DOMAIN = process.env.EMAIL_IN_DOMAIN || 'inbox.alianhub.com';
const oid = (id) => { try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return null; } };

const withAddress = (doc) => {
    if (!doc) return doc;
    const o = doc.toObject ? doc.toObject() : { ...doc };
    o.address = R.inboxAddress(o.token, DOMAIN);
    return o;
};

// The task template stored on the inbox (mirrors RecurringTasks buildTemplateFromBody
// so taskMongo.create accepts it). TaskName is filled per-email from the subject.
const buildTemplate = (b, companyId, { assignees, creatorId }) => {
    const project = b.projectData || {};
    return {
        TaskName: '', TaskKey: '-', AssigneeUserId: assignees, watchers: [],
        DueDate: '', dueDateDeadLine: [], TaskType: b.taskType || 'task', TaskTypeKey: Number(b.taskTypeKey) || 1,
        ParentTaskId: '', ProjectID: project._id, CompanyId: project.CompanyId || companyId,
        status: { text: 'To Do', key: 1, type: 'default_active' }, isParentTask: true,
        Task_Leader: creatorId, Task_Priority: b.priority || 'MEDIUM',
        deletedStatusKey: 0, statusType: 'default_active', statusKey: 1, points: null,
        rawDescription: '', descriptionBlock: {},
    };
};

const CREATES_TASKS = [['task.task_create']];
const NOT_FOUND = { status: false, statusText: 'Not found.' };

/* The lists of the project an inbox may deliver into: the ones its maker can open.
 * Read from the sprints collection: a project document's sprintsObj is a legacy copy
 * that no sprint write maintains, so a project whose sprints were created through the
 * API embeds none of them. */
const openLists = async (companyId, uid, projectId) => {
    const rows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.SPRINTS,
        data: [{ projectId: oid(projectId), deletedStatusKey: { $ne: 1 } }],
    }, 'find').catch(() => []);
    const sprints = Array.isArray(rows) ? rows : [];
    if (isPrivileged(await getRoleType(companyId, uid))) return sprints;
    const identities = await sprintIdentities(companyId, uid);
    return sprints.filter((sprint) => canSeeSprint(sprint, identities));
};

/* The list named by the request, or the project's first usable one (top-level first, then
 * inside folders); its name and folder come from the stored rows. */
const resolveSprint = async (companyId, uid, projectId, namedId) => {
    const sprints = await openLists(companyId, uid, projectId);
    const sprint = namedId
        ? sprints.find((s) => String(s._id) === String(namedId))
        : (sprints.find((s) => s && !s.folderId) || sprints[0]);
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
        const access = await canEditProject(companyId, creatorId, projectId, CREATES_TASKS);
        if (!access.allowed) {
            return access.statusCode === 404
                ? res.status(404).send({ status: false, statusText: 'Project not found.' })
                : res.status(403).send({ status: false, statusText: 'You do not have permission to perform this action.' });
        }
        const project = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PROJECTS, data: [{ _id: oid(projectId) }] }, 'findOne').catch(() => null);
        if (!project) return res.status(404).send({ status: false, statusText: 'Project not found.' });
        const projObj = project.toObject ? project.toObject() : project;

        const namedSprint = (b.sprintArray && (b.sprintArray.id || b.sprintArray._id)) || b.sprintId || '';
        if (namedSprint && !oid(namedSprint)) return res.status(404).send({ status: false, statusText: 'List not found.' });
        const target = await resolveSprint(companyId, creatorId, projectId, namedSprint);
        if (!target) {
            return namedSprint
                ? res.status(404).send({ status: false, statusText: 'List not found.' })
                : res.send({ status: false, statusText: 'This project has no list to receive tasks — create a list first.' });
        }
        const { sprintId, sprintArray } = target;
        const folderObjId = target.folderObjId || '';

        const creator = await actingUser(req);
        const members = await activeMemberIds(companyId, (Array.isArray(b.assignees) ? b.assignees : []).filter((id) => typeof id === 'string'));
        const assignees = await peopleWhoOpen(companyId, String(projectId), members);
        const tmpl = buildTemplate(b, companyId, { assignees, creatorId });
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
            userSnapshot: { id: creatorId, Employee_Name: (creator && creator.Employee_Name) || '', companyOwnerId: '' },
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

/* The filter of an inbox this person may change: their own, or any of the workspace's for an owner or admin. */
const manageableInbox = async (companyId, uid, id) => {
    if (!oid(id)) return null;
    const filter = { _id: oid(id), companyId: String(companyId), deletedStatusKey: { $ne: 1 } };
    if (!isPrivileged(await getRoleType(companyId, uid))) filter.createdBy = String(uid);
    const inbox = await MongoDbCrudOpration(GLOBAL, { type: SCHEMA_TYPE.EMAIL_INBOXES, data: [filter, { _id: 1 }] }, 'findOne');
    return inbox ? filter : null;
};

// GET /api/v1/email-in/inboxes?projectId=
exports.listInboxes = async (req, res) => {
    try {
        const companyId = pinSessionTenant(req, res);
        if (!companyId) return undefined;
        const q = { companyId: String(companyId), deletedStatusKey: { $ne: 1 } };
        if (req.query && req.query.projectId && oid(req.query.projectId)) q.ProjectID = oid(req.query.projectId);
        const rows = await MongoDbCrudOpration(GLOBAL, { type: SCHEMA_TYPE.EMAIL_INBOXES, data: [q, {}, { sort: { createdAt: -1 } }] }, 'find') || [];
        /* An inbox's address is the key to adding tasks, so it is shown with its project only. */
        const openable = new Set(await keepVisibleProjectIds(companyId, req.uid, rows.map((row) => String(row.ProjectID))));
        const privileged = isPrivileged(await getRoleType(companyId, req.uid));
        const shown = rows.filter((row) => openable.has(String(row.ProjectID)))
            .map((row) => ({ ...withAddress(row), canManage: privileged || String(row.createdBy) === String(req.uid) }));
        return res.send({ status: true, data: shown });
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
        const own = await manageableInbox(companyId, req.uid, req.params.id);
        if (!own) return res.status(404).send(NOT_FOUND);
        const updated = await MongoDbCrudOpration(GLOBAL, {
            type: SCHEMA_TYPE.EMAIL_INBOXES,
            data: [own, { $set: set }, { returnDocument: 'after' }],
        }, 'findOneAndUpdate');
        if (!updated) return res.status(404).send(NOT_FOUND);
        removeCache(`email_inboxes:${companyId}`);
        return res.send({ status: true, statusText: 'Inbox updated.', data: withAddress(updated) });
    } catch (e) { logger.error(`updateInbox: ${e.message}`); return res.send({ status: false, statusText: e.message }); }
};

// DELETE /api/v1/email-in/inboxes/:id
exports.deleteInbox = async (req, res) => {
    try {
        const companyId = pinSessionTenant(req, res);
        if (!companyId) return undefined;
        const own = await manageableInbox(companyId, req.uid, req.params.id);
        if (!own) return res.status(404).send(NOT_FOUND);
        await MongoDbCrudOpration(GLOBAL, {
            type: SCHEMA_TYPE.EMAIL_INBOXES,
            data: [own, { $set: { deletedStatusKey: 1, enabled: false } }],
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
        // The people the inbox names were checked when it was made; each mail keeps the ones who can open the project now.
        const assignees = await keptOnProject(inbox.companyId, String(inbox.ProjectID))(tmpl.AssigneeUserId || []);
        const data = Object.assign({}, tmpl, {
            _id: new mongoose.Types.ObjectId(),
            TaskKey: '-',
            TaskName: parsed.taskName,
            rawDescription: parsed.description,
            origin: { kind: 'email', ref: R.originRef(req.body || {}, new Date()) },
            ProjectID: inbox.ProjectID,
            CompanyId: inbox.companyId,
            AssigneeUserId: assignees,
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
