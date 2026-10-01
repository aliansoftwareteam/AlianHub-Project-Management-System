const { evaluatePermission, isWritable } = require('../../../Config/permissionGuard');
const logger = require('../../../Config/loggerConfig');
const { normaliseAiConfig, AiConfigError } = require('../aiFields/config');
const { cleanTaskTypeList, MAX_TASK_TYPES } = require('./fieldTaskTypes');
const { cleanPastFuture, PAST, FUTURE } = require('./datePastFuture');
const { MODULE_FIELD_TYPES, typeModuleOf } = require('../fieldTypes');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const SETTINGS_PERMISSION = 'settings.settings_custom_field';
const MAX_LINKED_PROJECTS = 500;

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

const checkedTitle = (value) => {
    if (typeof value !== 'string' || !value.trim()) throw new FieldWriteError('A custom field needs a name.');
    return value.trim();
};

const OPTIONAL_TEXT = ['fieldPlaceholder', 'fieldDescription'];

const hasLabelledOption = (options) => Array.isArray(options)
    && options.some((option) => option && typeof option.label === 'string' && option.label.trim());

const checkedPastFuture = (value) => {
    const allowed = cleanPastFuture(value);
    if (!allowed) throw new FieldWriteError(`fieldPastFuture must be a list of ${PAST} and ${FUTURE}.`);
    return allowed;
};

/* A new field takes its type's settings with their defaults. An update names its type only when it changes it, so a setting sent
   on its own is checked by the type that owns it. */
const checkedTypeSettings = (updateObject) => {
    const named = typeModuleOf(updateObject.fieldType);
    const modules = named ? [named] : MODULE_FIELD_TYPES.map(typeModuleOf);
    return modules.reduce((checked, type) => {
        const { settings, error } = type.settings(updateObject);
        if (error) throw new FieldWriteError(error);
        const owned = Object.keys(settings).filter((name) => named || name in updateObject);
        return { ...checked, ...Object.fromEntries(owned.map((name) => [name, settings[name]])) };
    }, {});
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
    if (insert || 'fieldTitle' in updateObject) updateObject.fieldTitle = checkedTitle(updateObject.fieldTitle);
    OPTIONAL_TEXT.forEach((name) => {
        if (name in updateObject && typeof updateObject[name] !== 'string') throw new FieldWriteError(`${name} must be text.`);
    });
    if (updateObject.fieldType === 'dropdown' && (insert || 'fieldOptions' in updateObject) && !hasLabelledOption(updateObject.fieldOptions)) {
        throw new FieldWriteError('A dropdown field needs at least one option.');
    }
    if ('fieldAi' in updateObject) updateObject.fieldAi = checkedAiConfig(updateObject);
    if ('fieldTaskTypes' in updateObject) updateObject.fieldTaskTypes = checkedTaskTypes(updateObject.fieldTaskTypes);
    if ('fieldPastFuture' in updateObject) updateObject.fieldPastFuture = checkedPastFuture(updateObject.fieldPastFuture);
    return Object.assign(updateObject, checkedTypeSettings(updateObject));
};

const fieldInsertFrom = (updateObject) => checkProperties(updateObject, { insert: true });

const checkedProjects = (body, name) => {
    const value = body[name];
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > MAX_LINKED_PROJECTS || !isIdList(value)) throw new FieldWriteError(`${name} must be a list of at most ${MAX_LINKED_PROJECTS} project ids.`);
    return value;
};

/* The projects a field is linked to are changed by name, beside the properties `updateObject` sets. */
const checkProjectLinks = (body) => {
    const add = checkedProjects(body, 'addProjects');
    const remove = checkedProjects(body, 'removeProjects');
    const update = isPlainObject(body.updateObject) ? body.updateObject : {};
    const kept = [...add, ...(Array.isArray(update.projectId) ? update.projectId : [])];
    if (remove.some((id) => kept.includes(id))) throw new FieldWriteError('A project cannot be both added and taken off.');
    if (update.global === true && add.length) throw new FieldWriteError('A company-wide field is not linked to projects.');
    return add.length + remove.length > 0;
};

const fieldUpdateFrom = (body) => {
    const { key, id } = body;
    if (key !== '$set') throw new FieldWriteError('A custom field is updated with $set only.');
    if (typeof id !== 'string' || !OBJECT_ID.test(id)) throw new FieldWriteError('Id is Required');
    const links = checkProjectLinks(body);
    if (links && (body.updateObject === undefined || (isPlainObject(body.updateObject) && !Object.keys(body.updateObject).length))) {
        body.updateObject = {};
        return body.updateObject;
    }
    return checkProperties(body.updateObject, { insert: false });
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

const keptBesideTheTask = (fieldType) => Boolean((typeModuleOf(fieldType) || {}).sideStored);

/* A relationship or a voting field keeps its values beside the tasks and a marker or a count on them, so a field never
   becomes one or stops being one: what its tasks already carry would be read as the other kind's. */
const requireSameKind = (readStored) => async (req, res, next) => {
    const refuse = (statusCode, statusText) => res.status(statusCode).json({ status: false, statusText, message: statusText });
    try {
        const wanted = req.body.updateObject.fieldType;
        if (wanted === undefined) return next();
        const stored = await readStored(req);
        const held = stored ? stored.fieldType : undefined;
        if (held === wanted || (!keptBesideTheTask(held) && !keptBesideTheTask(wanted))) return next();
        return refuse(400, 'A field cannot be changed to or from a relationship or a voting field.');
    } catch (error) {
        logger.error(`requireSameKind: ${error.message || error}`);
        return refuse(500, 'The field could not be checked.');
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
    requireSameKind,
    checkFieldWrite,
};
