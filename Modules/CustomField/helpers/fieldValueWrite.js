const { typeModuleOf } = require('../fieldTypes');
const { idsOf } = require('../fieldTypes/people');
const { nonMembersOf, NOT_A_MEMBER } = require('../../../Config/companyMembers');
const { canReadProject } = require('../../../Config/projectAccess');
const { customFieldDefinitionsOf } = require('./customFieldText');

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

const peopleWhoMayBeNamed = async ({ companyId, task, value }) => {
    const outside = new Set(await nonMembersOf(companyId, value));
    const allowed = [];
    for (const id of value.filter((member) => !outside.has(member))) {
        if ((await canReadProject(companyId, id, String(task.ProjectID))).allowed) allowed.push(id);
    }
    return allowed;
};

/* Where a single edit is refused, a write that carries many values keeps the part of one that may be stored. */
const SERVER_NARROWING = Object.freeze({ people: peopleWhoMayBeNamed });

const storableDetail = async ({ companyId, definition, type, task, detail }) => {
    const { value, error } = isPlainObject(detail) ? type.parse(detail.fieldValue, definition) : { error: true };
    if (error) return { asSent: false };
    const narrow = SERVER_NARROWING[type.type];
    const kept = narrow && value.length ? await narrow({ companyId, task, value }) : value;
    const emptied = narrow && value.length > 0 && !kept.length;
    return { detail: emptied ? null : { fieldValue: kept, _id: String(definition._id) }, asSent: !narrow || kept.length === value.length };
};

/* The field values a create, a copy, an import or a template may store on `task`. A value that does not fit its field is left
 * out, so one bad value never fails the task; `dropped` names the fields whose value was left out or cut down. `definitions`
 * is carried across a batch so each field is read once. */
const storableFieldValues = async ({ companyId, task, customField = task && task.customField, definitions = new Map() }) => {
    if (!isPlainObject(customField)) return { customField: {}, dropped: [] };
    await customFieldDefinitionsOf(companyId, Object.keys(customField), definitions);
    const kept = {};
    const dropped = [];
    for (const [fieldId, detail] of Object.entries(customField)) {
        const definition = definitions.get(fieldId);
        const type = typeModuleOf(definition && definition.fieldType);
        if (!type) {
            kept[fieldId] = detail;
            continue;
        }
        const stored = await storableDetail({ companyId, definition, type, task, detail });
        if (stored.detail) kept[fieldId] = stored.detail;
        if (!stored.asSent) dropped.push(fieldId);
    }
    return { customField: kept, dropped };
};

module.exports = { FieldValueRefused, checkedFieldDetail, storableFieldValues };
