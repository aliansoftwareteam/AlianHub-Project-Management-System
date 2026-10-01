const { evaluatePermission, isWritable } = require('../../../Config/permissionGuard');
const logger = require('../../../Config/loggerConfig');
const { normaliseAiConfig, AiConfigError } = require('../aiFields/config');
const { cleanTaskTypeList, MAX_TASK_TYPES } = require('./fieldTaskTypes');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const SETTINGS_PERMISSION = 'settings.settings_custom_field';

// The field forms differ per field type, and every property they name is a fieldXxx one.
const DEFINITION_PROPERTY = /^field[A-Z][A-Za-z]*$/;
const SHARED_PROPERTIES = ['formulaExpression', 'rollupSourceFieldId', 'rollupFunction', 'rollupScope', 'type', 'isDelete', 'global', 'projectId', 'updatedAt'];
const INSERT_ONLY_PROPERTIES = ['userId', 'createdAt'];

class FieldWriteError extends Error {}

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isIdList = (value) => (Array.isArray(value) ? value : [value]).every((id) => typeof id === 'string' && OBJECT_ID.test(id));

const checkedAiConfig = ({ fieldAi, fieldType }) => {
    if (fieldAi && fieldAi.enabled === false) return { enabled: false };
    if (!fieldType) throw new FieldWriteError('An AI field is saved together with its field type.');
    try {
        return normaliseAiConfig(fieldAi, fieldType);
    } catch (error) {
        if (error instanceof AiConfigError) throw new FieldWriteError(error.message);
        throw error;
    }
};

const checkedTaskTypes = (value) => {
    const keys = cleanTaskTypeList(value);
    if (!keys) throw new FieldWriteError(`fieldTaskTypes must be a list of at most ${MAX_TASK_TYPES} task type keys.`);
    return keys;
};

const checkProperties = (updateObject, { insert }) => {
    if (!isPlainObject(updateObject) || !Object.keys(updateObject).length) throw new FieldWriteError('Update Object is required');
    const allowed = insert ? [...SHARED_PROPERTIES, ...INSERT_ONLY_PROPERTIES] : SHARED_PROPERTIES;
    const refused = Object.keys(updateObject).filter((name) => !DEFINITION_PROPERTY.test(name) && !allowed.includes(name));
    if (refused.length) throw new FieldWriteError(`A custom field cannot set ${refused.join(', ')}.`);
    ['global', 'isDelete'].forEach((name) => {
        if (name in updateObject && typeof updateObject[name] !== 'boolean') throw new FieldWriteError(`${name} must be true or false.`);
    });
    if ('projectId' in updateObject && !isIdList(updateObject.projectId)) throw new FieldWriteError('projectId must be a list of project ids.');
    if ('fieldAi' in updateObject) updateObject.fieldAi = checkedAiConfig(updateObject);
    if ('fieldTaskTypes' in updateObject) updateObject.fieldTaskTypes = checkedTaskTypes(updateObject.fieldTaskTypes);
    return updateObject;
};

const fieldInsertFrom = (updateObject) => checkProperties(updateObject, { insert: true });

const fieldUpdateFrom = ({ key, id, updateObject }) => {
    if (key !== '$set') throw new FieldWriteError('A custom field is updated with $set only.');
    if (typeof id !== 'string' || !OBJECT_ID.test(id)) throw new FieldWriteError('Id is Required');
    return checkProperties(updateObject, { insert: false });
};

const hasNoProjects = (field) => !(Array.isArray(field.projectId) ? field.projectId : [field.projectId]).some(Boolean);

const isCompanyWide = (field) => Boolean(field) && (field.global === true || hasNoProjects(field));

const widensToCompany = (updateObject) => updateObject.global === true || ('projectId' in updateObject && hasNoProjects(updateObject));

/* A hard gate whatever the enforcement mode: a company-wide field shows on every project and task. */
const requireFieldSettings = (touchesCompanyWide) => async (req, res, next) => {
    const refuse = (statusText) => res.status(403).json({ status: false, statusText, message: statusText, permission: SETTINGS_PERMISSION });
    try {
        if (!(await touchesCompanyWide(req))) return next();
        const allowed = isWritable(await evaluatePermission(req.headers['companyid'], req.uid, SETTINGS_PERMISSION, { strict: true }));
        return allowed ? next() : refuse('You do not have permission to manage company-wide custom fields.');
    } catch (error) {
        logger.error(`requireFieldSettings: ${error.message || error}`);
        return refuse('Permission check failed.');
    }
};

const checkFieldWrite = (readWrite) => (req, res, next) => {
    try {
        readWrite(req.body || {});
        return next();
    } catch (error) {
        if (!(error instanceof FieldWriteError)) throw error;
        return res.status(400).json({ status: false, statusText: error.message, message: error.message });
    }
};

module.exports = {
    FieldWriteError,
    fieldInsertFrom,
    fieldUpdateFrom,
    isCompanyWide,
    widensToCompany,
    requireFieldSettings,
    checkFieldWrite,
};
