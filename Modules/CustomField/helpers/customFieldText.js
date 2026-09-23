const { default: mongoose } = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');

const OBJECT_ID = /^[a-f0-9]{24}$/i;

const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);

const instantOf = (value) => {
    if (value === undefined || value === null || value === '') return null;
    const millis = new Date(value).getTime();
    return Number.isNaN(millis) ? null : millis;
};

/* The web app printed the value it was handed; a date becomes DATE_ so the activity log shows it in the reader's format. */
const fieldValueText = (definition, detail) => {
    const value = detail ? detail.fieldValue : undefined;
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

module.exports = { fieldValueText, customFieldDefinitionOf };
