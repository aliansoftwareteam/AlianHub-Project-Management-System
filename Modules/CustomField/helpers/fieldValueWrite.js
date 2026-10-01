const { typeModuleOf } = require('../fieldTypes');
const { idsOf } = require('../fieldTypes/people');
const { nonMembersOf, NOT_A_MEMBER } = require('../../../Config/companyMembers');
const { canReadProject } = require('../../../Config/projectAccess');

const CANNOT_OPEN_PROJECT = 'A person named here cannot open this project.';

class FieldValueRefused extends Error {}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);

const heldValue = (task, fieldId) => {
    const entry = task && task.customField && task.customField[fieldId];
    return isPlainObject(entry) ? entry.fieldValue : undefined;
};

/* A person already on the field stays, as an assignee does, so the rest of the list can still be changed after their seat ends. */
const onlyPeopleOfTheProject = async ({ companyId, task, fieldId, ids }) => {
    const held = new Set(idsOf(heldValue(task, fieldId)).map((id) => id.toLowerCase()));
    const named = ids.filter((id) => !held.has(id));
    if (!named.length) return;
    if ((await nonMembersOf(companyId, named)).length) throw new FieldValueRefused(NOT_A_MEMBER);
    for (const id of named) {
        const access = await canReadProject(companyId, id, String(task.ProjectID));
        if (!access.allowed) throw new FieldValueRefused(CANNOT_OPEN_PROJECT);
    }
};

const SERVER_CHECKS = Object.freeze({
    people: ({ companyId, task, fieldId, value }) => onlyPeopleOfTheProject({ companyId, task, fieldId, ids: value }),
});

/* What is stored for a field one of the type modules handles: its checked value and nothing else. Other types are stored as sent. */
const checkedFieldDetail = async ({ companyId, definition, task, updateDetail }) => {
    const type = typeModuleOf(definition && definition.fieldType);
    if (!type) return updateDetail;
    if (!isPlainObject(updateDetail)) throw new FieldValueRefused('updateDetail must be an object with a fieldValue.');
    const { value, error } = type.parse(updateDetail.fieldValue, definition);
    if (error) throw new FieldValueRefused(error);
    const fieldId = String(definition._id);
    if (SERVER_CHECKS[type.type]) await SERVER_CHECKS[type.type]({ companyId, task, fieldId, value });
    return { fieldValue: value, _id: fieldId };
};

module.exports = { FieldValueRefused, checkedFieldDetail };
