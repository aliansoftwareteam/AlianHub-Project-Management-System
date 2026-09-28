const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { canEditProject, DELETE_OR_CLOSE } = require('../../Config/projectAccess');
const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
const { canSeeSprintById } = require('../Sprints/helpers/sprintVisibility');
const logger = require('../../Config/loggerConfig');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const NO_PROJECT = Object.freeze({ allowed: false, statusCode: 404, missing: true });

const storedRecord = (companyId, type, id, fields) => MongoDbCrudOpration(companyId, {
    type,
    data: [{ _id: new mongoose.Types.ObjectId(id) }, fields],
}, 'findOne');

/* Each kind needs what deleting it needed, in the project the stored record belongs to. */
const RESTORABLE = {
    projects: {
        permission: DELETE_OR_CLOSE,
        locate: async (companyId, id) => ({ projectId: id }),
    },
    lists: {
        permission: ['project.sprint_delete'],
        locate: async (companyId, id) => {
            const sprint = await storedRecord(companyId, SCHEMA_TYPE.SPRINTS, id, { projectId: 1 });
            return sprint && { projectId: sprint.projectId, sprintId: id };
        },
    },
    tasks: {
        permission: ['task.task_delete'],
        locate: async (companyId, id) => {
            const task = await storedRecord(companyId, SCHEMA_TYPE.TASKS, id, { ProjectID: 1, sprintId: 1 });
            return task && { projectId: task.ProjectID, sprintId: task.sprintId };
        },
    },
};

const notFound = (res) => res.status(404).json({ status: false, statusText: 'Not found.', error: 'Not Found' });

const refuse = (res, decision) => (decision.statusCode === 404 ? notFound(res) : res.status(403).json({
    status: false,
    statusText: 'You do not have permission to perform this action.',
    error: 'Forbidden',
    ...(decision.permission ? { permission: decision.permission } : {}),
}));

/* Docs go to restorePage, which checks the doc itself; an id with no record behind it restores nothing. */
const requireRestoreAccess = async (req, res, next) => {
    try {
        const companyId = String(req.headers['companyid'] || '');
        const { kind, id } = req.params;
        const restorable = RESTORABLE[kind];
        if (!restorable || !OBJECT_ID.test(String(id || ''))) return next();
        const place = await restorable.locate(companyId, String(id));
        if (!place) return next();

        const privileged = isPrivileged(await getRoleType(companyId, String(req.uid || '')));
        const decision = place.projectId
            ? await canEditProject(companyId, req.uid, String(place.projectId), [restorable.permission])
            : NO_PROJECT;
        // Chat channels share the sprint and task collections, and their container is not a project.
        if (decision.missing && kind !== 'projects' && privileged) return next();
        if (!decision.allowed) return refuse(res, decision);
        if (!privileged && !(await canSeeSprintById(companyId, req.uid, place.sprintId))) return notFound(res);
        return next();
    } catch (error) {
        logger.error(`requireRestoreAccess error: ${error.message || error}`);
        return res.status(403).json({ status: false, statusText: 'Permission check failed.', error: 'Forbidden' });
    }
};

module.exports = { requireRestoreAccess };
