const { default: mongoose } = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { memberProfiles } = require('../../../utils/companyMembers');
const { typeModuleOf } = require('../fieldTypes');
const { idsOf } = require('../fieldTypes/people');

const OBJECT_ID = /^[a-f0-9]{24}$/i;

const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);

const instantOf = (value) => {
    if (value === undefined || value === null || value === '') return null;
    const millis = new Date(value).getTime();
    return Number.isNaN(millis) ? null : millis;
};

/* The web app printed the value it was handed; a date becomes DATE_ so the activity log shows it in the reader's format. */
const fieldValueText = (definition, detail, context = {}) => {
    const value = detail ? detail.fieldValue : undefined;
    const type = typeModuleOf(definition.fieldType);
    if (type) return type.text(value, definition, context);
    switch (definition.fieldType) {
        case 'dropdown': {
            const chosen = [].concat(value === undefined || value === null ? [] : value).map(String);
            return (definition.fieldOptions || [])
                .filter((option) => option && chosen.includes(String(option.id)))
                .map((option) => option.value || option.label || '')
                .join(', ');
        }
        case 'date': {
            const millis = instantOf(value);
            return millis === null ? '' : `DATE_${millis}`;
        }
        case 'checkbox':
            return String(value === true || value === 'true');
        case 'phone':
            return [detail && detail.fieldCode, value].filter(Boolean).join(' ');
        default:
            return value === undefined || value === null ? '' : String(value);
    }
};

/* What a type's text needs beside the value: a people field stores ids, and the activity log names the people. */
const fieldValueContext = async (companyId, definition, details) => {
    if (!definition || definition.fieldType !== 'people') return {};
    const ids = details.flatMap((detail) => idsOf(detail && detail.fieldValue));
    const profiles = await memberProfiles(companyId, ids, { Employee_Name: 1 }).catch(() => []);
    const names = new Map((profiles || []).map((user) => [String(user._id), user.Employee_Name || '']));
    return { userName: (id) => names.get(id) || '' };
};

/* Project-level definitions live in the company database, the ones shared by every company in the global one. */
const customFieldDefinitionOf = async (companyId, fieldId) => {
    if (!OBJECT_ID.test(String(fieldId))) return null;
    const filter = { _id: new mongoose.Types.ObjectId(String(fieldId)) };
    for (const database of [companyId, 'global']) {
        const found = await MongoDbCrudOpration(database, { type: SCHEMA_TYPE.CUSTOM_FIELDS, data: [filter] }, 'findOne').catch(() => null);
        if (found) return plain(found);
    }
    return null;
};

/* The definitions of several fields at once, by id. `known` is carried across a batch, with null for an id that names no field. */
const customFieldDefinitionsOf = async (companyId, fieldIds, known = new Map()) => {
    let wanted = [...new Set(fieldIds.map(String))].filter((id) => OBJECT_ID.test(id) && !known.has(id));
    for (const database of [companyId, 'global']) {
        if (!wanted.length) break;
        const filter = { _id: { $in: wanted.map((id) => new mongoose.Types.ObjectId(id)) } };
        const found = await MongoDbCrudOpration(database, { type: SCHEMA_TYPE.CUSTOM_FIELDS, data: [filter] }, 'find').catch(() => []);
        (found || []).map(plain).forEach((definition) => known.set(String(definition._id), definition));
        wanted = wanted.filter((id) => !known.has(id));
    }
    wanted.forEach((id) => known.set(id, null));
    return known;
};

module.exports = { fieldValueText, fieldValueContext, customFieldDefinitionOf, customFieldDefinitionsOf };
