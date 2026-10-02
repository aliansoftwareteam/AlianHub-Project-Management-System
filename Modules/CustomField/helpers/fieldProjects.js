const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { removeCache } = require('../../../utils/commonFunctions');
const socketEmitter = require('../../../event/socketEventEmitter');

const PROJECTS_CHANGED = 'FIELD_PROJECTS_CHANGED';
const PROJECTS_CHANGED_TEXT = 'This field is linked to a project this list leaves out. Read the field again, or name the projects to take off in removeProjects.';

const listOf = (value) => [].concat(value === undefined || value === null ? [] : value).filter(Boolean).map(String);

/* What a request does to the projects a field is linked to. A whole list (`projectId`) can only add: a copy of the
 * field read before someone else linked a project leaves that project out, and the server cannot tell that from
 * wanting it off, so taking a project off is asked for by name. `dropped` are the projects a whole list leaves out
 * without naming them. A field made company-wide lists no projects. */
const linkPlan = (stored, { updateObject, addProjects, removeProjects } = {}) => {
    const update = updateObject || {};
    const held = listOf(stored && stored.projectId);
    if (update.global === true) return { held, add: [], remove: [], dropped: [], result: [], clears: true };
    const remove = [...new Set(listOf(removeProjects))];
    const whole = 'projectId' in update ? listOf(update.projectId) : null;
    const add = [...new Set([...(whole || []), ...listOf(addProjects)])].filter((id) => !held.includes(id));
    const dropped = whole ? held.filter((id) => !whole.includes(id) && !remove.includes(id)) : [];
    return { held, add, remove, dropped, result: [...held.filter((id) => !remove.includes(id)), ...add], clears: false };
};

const update = (companyId, filter, change) => MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.CUSTOM_FIELDS, data: [filter, change] }, 'updateOne');

/* An older field holds its one project as text, or '' for none, which $addToSet and $pull refuse to change. The
 * filter names the value read, so a list written meanwhile is left as it is. */
const asList = async (companyId, field) => {
    if (field.projectId === undefined || Array.isArray(field.projectId)) return;
    await update(companyId, { _id: field._id, projectId: field.projectId }, { $set: { projectId: listOf(field.projectId) } });
};

/* Each list change is one update on the stored list, so two people linking different projects both keep theirs. */
const applyLinks = async (companyId, field, { add, remove }) => {
    if (!add.length && !remove.length) return;
    await asList(companyId, field);
    if (remove.length) await update(companyId, { _id: field._id }, { $pull: { projectId: { $in: remove } } });
    if (add.length) await update(companyId, { _id: field._id }, { $addToSet: { projectId: { $each: add } } });
};

/* Other tabs learn only that the company's definitions changed and read them again: see
 * socket/controller/customFieldSocket.js. */
const announceFields = (companyId, type = 'update') => {
    removeCache(`customField:${companyId}`);
    socketEmitter.emit(type, { type, companyId: String(companyId), module: 'customFields' });
};

module.exports = { PROJECTS_CHANGED, PROJECTS_CHANGED_TEXT, listOf, linkPlan, asList, applyLinks, announceFields };
