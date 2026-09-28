const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { getRoleType, isPrivileged } = require('../../../Config/permissionGuard');
const { canSeeSprint, sprintIdentities } = require('./sprintVisibility');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const SPRINT_STATUSES = [0, 1, 2, 5];
const FOLDER_STATUSES = [0, 1, 2];
const PEOPLE = ['AssigneeUserId', 'watchers'];
const ONE_PERSON_OPERATORS = ['$addToSet', '$pull'];
const FOLDER_CASCADE_SKIPS = [1, 2, 5];

class ListWriteError extends Error {
    constructor(message, statusCode = 400) {
        super(message);
        this.statusCode = statusCode;
    }
}

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isPerson = (value) => typeof value === 'string' && value.trim() !== '' && !value.startsWith('$');
const oid = (id) => new mongoose.Types.ObjectId(String(id));

const SPRINT_SET_FIELDS = {
    deletedStatusKey: (value) => SPRINT_STATUSES.includes(value),
    private: (value) => typeof value === 'boolean',
    AssigneeUserId: (value) => Array.isArray(value) && value.every(isPerson),
    folderId: (value) => value === null || (typeof value === 'string' && OBJECT_ID.test(value)),
    folderName: (value) => typeof value === 'string',
};

const fieldsOf = (operator, fields) => {
    if (!isPlainObject(fields) || !Object.keys(fields).length) throw new ListWriteError(`${operator} names no field.`);
    return Object.entries(fields);
};

/*
 * The shapes the sprint list sends: the trash key, sharing (private, members) and a move between
 * folders under $set, and one member or watcher at a time under $addToSet / $pull. Anything else
 * is refused before a write, so the route's permissions can be read off what is written.
 */
const sprintUpdateFrom = (updateObject) => {
    if (!isPlainObject(updateObject) || !Object.keys(updateObject).length) throw new ListWriteError('Nothing to update.');
    const update = {};
    Object.entries(updateObject).forEach(([operator, fields]) => {
        if (operator === '$set') {
            fieldsOf(operator, fields).forEach(([field, value]) => {
                if (!SPRINT_SET_FIELDS[field] || !SPRINT_SET_FIELDS[field](value)) throw new ListWriteError(`A sprint update cannot set ${field} to that value.`);
            });
        } else if (ONE_PERSON_OPERATORS.includes(operator)) {
            fieldsOf(operator, fields).forEach(([field, value]) => {
                if (!PEOPLE.includes(field) || !isPerson(value)) throw new ListWriteError(`${operator} takes one member or watcher at a time.`);
            });
        } else {
            throw new ListWriteError(`A sprint update cannot use ${operator}.`);
        }
        update[operator] = { ...fields };
    });
    if (update.$set && 'folderName' in update.$set && !('folderId' in update.$set)) throw new ListWriteError('A folder name moves with its folder id.');
    return update;
};

const writtenStatus = (update) => (update && isPlainObject(update.$set) && 'deletedStatusKey' in update.$set ? update.$set.deletedStatusKey : undefined);

/* What each write needs; watching a sprint yourself needs nothing beyond the project. */
const sprintWriteKinds = (update, uid) => {
    const set = update.$set || {};
    const people = ONE_PERSON_OPERATORS.flatMap((operator) => Object.entries(update[operator] || {}));
    return {
        status: writtenStatus(update),
        moves: 'folderId' in set,
        shares: 'private' in set || 'AssigneeUserId' in set || people.some(([field, value]) => field !== 'watchers' || String(value) !== String(uid)),
    };
};

const folderUpdateFrom = (updateObject) => {
    const set = isPlainObject(updateObject) && Object.keys(updateObject).length === 1 ? updateObject.$set : null;
    if (!isPlainObject(set) || Object.keys(set).length !== 1 || !FOLDER_STATUSES.includes(set.deletedStatusKey)) {
        throw new ListWriteError('A folder update only archives, deletes or restores the folder.');
    }
    return { $set: { deletedStatusKey: set.deletedStatusKey } };
};

const findOne = (companyId, type, filter, fields) => MongoDbCrudOpration(companyId, { type, data: [filter, fields] }, 'findOne');

const mayOpenSprint = async (companyId, uid, sprint) => canSeeSprint(sprint, await sprintIdentities(companyId, uid))
    || isPrivileged(await getRoleType(String(companyId), String(uid)));

/*
 * Builds the write for PATCH /api/v1/sprint/:id type updateSprint from the stored sprint: a private
 * sprint answers 404 to anyone it is not shared with, a move lands only in a folder of the sprint's
 * own project, and the project the cascades run in is the stored one.
 */
const prepareSprintUpdate = async (companyId, uid, sprintId, updateObject) => {
    const update = sprintUpdateFrom(updateObject);
    if (!OBJECT_ID.test(String(sprintId || ''))) throw new ListWriteError('A valid sprint id is required.');
    const sprint = await findOne(companyId, SCHEMA_TYPE.SPRINTS, { _id: oid(sprintId) }, { projectId: 1, private: 1, AssigneeUserId: 1 });
    if (!sprint) return null;
    if (!(await mayOpenSprint(companyId, uid, sprint))) throw new ListWriteError('Sprint not found.', 404);
    const set = update.$set || {};
    if (set.folderId) {
        const folder = await findOne(companyId, SCHEMA_TYPE.FOLDERS, { _id: oid(set.folderId), projectId: sprint.projectId }, { name: 1 });
        if (!folder) throw new ListWriteError('That folder is not in this sprint\'s project.');
        Object.assign(set, { folderId: oid(set.folderId), folderName: folder.name || '' });
    } else if ('folderId' in set) {
        Object.assign(set, { folderId: null, folderName: '' });
    }
    return { update, projectId: String(sprint.projectId) };
};

/* The sprints an archive, delete or restore cascades onto are the folder's own, not the ones the client lists. */
const prepareFolderUpdate = async (companyId, folderId, updateObject) => {
    const update = folderUpdateFrom(updateObject);
    if (!OBJECT_ID.test(String(folderId || ''))) throw new ListWriteError('A valid folder id is required.');
    const folder = await findOne(companyId, SCHEMA_TYPE.FOLDERS, { _id: oid(folderId) }, { projectId: 1 });
    if (!folder) return null;
    const sprints = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.SPRINTS,
        data: [{ folderId: oid(folderId), projectId: folder.projectId, deletedStatusKey: { $nin: FOLDER_CASCADE_SKIPS } }, { _id: 1 }],
    }, 'find');
    return { update, status: update.$set.deletedStatusKey, projectId: String(folder.projectId), sprints: (sprints || []).map((sprint) => String(sprint._id)) };
};

module.exports = { ListWriteError, sprintUpdateFrom, sprintWriteKinds, folderUpdateFrom, writtenStatus, prepareSprintUpdate, prepareFolderUpdate };
