const { typeModuleOf } = require('../fieldTypes');
const { idsOf } = require('../fieldTypes/people');
const { nonMembersOf, NOT_A_MEMBER } = require('../../../Config/companyMembers');
const { CANNOT_OPEN_PROJECT, peopleWhoOpen } = require('../../../Config/projectPeople');
const { customFieldDefinitionsOf } = require('./customFieldText');
const { NOT_THIS_FIELD, ownFiles, stampedFiles } = require('./fieldFiles');

const NOT_A_FIELD_OF_THE_TASK = 'This custom field is not one this task has.';
const NOT_A_PLAIN_VALUE = 'A value of this field is text, a number, a yes or no, a flat record of those, or a list of them.';
const TEXT_MAX = 20000;
const LIST_MAX = 200;
const RECORD_KEYS_MAX = 20;
const PLAIN_DETAIL_KEYS = Object.freeze({ phone: ['fieldCode', 'fieldPattern', 'fieldFlag'] });

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
    if ((await peopleWhoOpen(companyId, String(task.ProjectID), named)).length !== named.length) throw new FieldValueRefused(CANNOT_OPEN_PROJECT);
};

const onlyFilesOfTheField = ({ task, fieldId, value, actorId }) => {
    if (ownFiles({ task, fieldId, value }).length !== value.length) throw new FieldValueRefused(NOT_THIS_FIELD);
    return stampedFiles({ task, fieldId, value, actorId });
};

/* What only the server can check about a parsed value. A check that answers a value replaces the parsed one. */
const SERVER_CHECKS = Object.freeze({
    people: ({ companyId, task, fieldId, value }) => onlyPeopleOfTheProject({ companyId, task, fieldId, ids: value }),
    files: onlyFilesOfTheField,
});

const isPlainScalar = (value) => value === null || typeof value === 'boolean' || value instanceof Date
    || (typeof value === 'number' && Number.isFinite(value))
    || (typeof value === 'string' && value.length <= TEXT_MAX);

/* Values stored before the type modules existed are not all scalars: a date is { seconds }, a choice { id, label, color }. */
const isFlatRecord = (value) => isPlainObject(value) && Object.keys(value).length <= RECORD_KEYS_MAX && Object.values(value).every(isPlainScalar);

const isPlainItem = (value) => isPlainScalar(value) || isFlatRecord(value);

const isPlainValue = (value) => isPlainItem(value) || (Array.isArray(value) && value.length <= LIST_MAX && value.every(isPlainItem));

/* A field is the task's when it is a task field kept company-wide or for the task's project; one that names
 * no project is read as company-wide, as fields saved before projects could be named are. */
const isFieldOfTask = (definition, task) => {
    if (!definition || (definition.type || 'task') !== 'task') return false;
    const projects = [].concat(definition.projectId || []).map(String);
    return definition.global === true || !projects.length || projects.includes(String(task && task.ProjectID));
};

/* What is stored for a type with no module of its own: a plain value under the field's own id, and for a
 * phone number its dialling code beside it. `null` when the value is not plain. */
const plainFieldDetail = (definition, detail) => {
    if (!isPlainObject(detail) || !isPlainValue(detail.fieldValue)) return null;
    const extras = (PLAIN_DETAIL_KEYS[definition.fieldType] || []).filter((key) => detail[key] !== undefined);
    if (extras.some((key) => !isPlainScalar(detail[key]))) return null;
    return { fieldValue: detail.fieldValue, ...Object.fromEntries(extras.map((key) => [key, detail[key]])), _id: String(definition._id) };
};

/* What is stored for a field: for a type with a module its checked value and nothing else, for any other its plain value. */
const checkedFieldDetail = async ({ companyId, definition, task, updateDetail, actorId }) => {
    if (!isFieldOfTask(definition, task)) throw new FieldValueRefused(NOT_A_FIELD_OF_THE_TASK);
    const type = typeModuleOf(definition.fieldType);
    if (!type) {
        const plain = plainFieldDetail(definition, updateDetail);
        if (!plain) throw new FieldValueRefused(NOT_A_PLAIN_VALUE);
        return plain;
    }
    if (!isPlainObject(updateDetail)) throw new FieldValueRefused('updateDetail must be an object with a fieldValue.');
    const { value, error } = type.parse(updateDetail.fieldValue, definition);
    if (error) throw new FieldValueRefused(error);
    const fieldId = String(definition._id);
    const checked = SERVER_CHECKS[type.type] ? await SERVER_CHECKS[type.type]({ companyId, task, fieldId, value, actorId }) : undefined;
    return { fieldValue: checked === undefined ? value : checked, _id: fieldId };
};

const peopleWhoMayBeNamed = async ({ companyId, task, value }) => {
    const outside = new Set(await nonMembersOf(companyId, value));
    return peopleWhoOpen(companyId, String(task.ProjectID), value.filter((member) => !outside.has(member)));
};

/* Where a single edit is refused, a write that carries many values keeps the part of one that may be stored. A file
   belongs to one task, so a value copied from another task keeps none of its files. */
const SERVER_NARROWING = Object.freeze({
    people: peopleWhoMayBeNamed,
    files: ({ task, fieldId, value }) => ownFiles({ task, fieldId, value }),
});

const storableDetail = async ({ companyId, definition, type, task, detail }) => {
    const { value, error } = isPlainObject(detail) ? type.parse(detail.fieldValue, definition) : { error: true };
    if (error) return { asSent: false };
    const narrow = SERVER_NARROWING[type.type];
    const kept = narrow && value.length ? await narrow({ companyId, task, value, fieldId: String(definition._id) }) : value;
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
