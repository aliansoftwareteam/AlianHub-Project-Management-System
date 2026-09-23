const { default: mongoose } = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const logger = require('../../../Config/loggerConfig');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { HandleHistory } = require('./helper');
const { escapeText } = require('./taskWriteFields');
const { fieldValueText, customFieldDefinitionOf } = require('../../CustomField/helpers/customFieldText');

const HISTORY = Object.freeze({
    CUSTOM_FIELD_VALUE: 'Project_Category',
    TASK_TAG: 'task',
    PROJECT_TAG: 'Project_Name',
});

const SERVER_BUILT_HISTORY = [HISTORY.CUSTOM_FIELD_VALUE, HISTORY.TASK_TAG].map((key) => ({ type: 'task', key }));

const OBJECT_ID = /^[a-f0-9]{24}$/i;

const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);

const describeCustomFieldValue = ({ actor, definition, next, previous }) => {
    if (!definition || !next) return null;
    const shown = fieldValueText(definition, next);
    if (previous && fieldValueText(definition, previous) === shown) return null;
    return {
        key: HISTORY.CUSTOM_FIELD_VALUE,
        message: `<b>${actor.Employee_Name}</b> has added value in <b> ${escapeText(definition.fieldTitle)}</b> Custom Field as <b>${escapeText(shown)}</b>.`,
    };
};

const describeTaskTag = ({ actor, tag, taskName, operation, held }) => {
    if (!tag || (operation === 'add') === Boolean(held) || !['add', 'remove'].includes(operation)) return null;
    const A = actor.Employee_Name;
    const N = escapeText(tag.tagName);
    const T = escapeText(taskName);
    if (operation === 'add') {
        return {
            task: { key: HISTORY.TASK_TAG, message: `<b>${A}</b> has added the <b> ${N} Tag </b>` },
            project: { key: HISTORY.PROJECT_TAG, message: `<b>${A}</b> has added the <b> ${N} Tag </b> in <b>${T}</b> Task` },
        };
    }
    return {
        task: { key: HISTORY.TASK_TAG, message: `<b>${A}</b> has removed the Tag <b> ${N} </b> Tag` },
        project: { key: HISTORY.PROJECT_TAG, message: `<b>${A}</b> has removed the Tag <b> ${N}</b> in <b>${T}</b> task.` },
    };
};

const projectTagsOf = async (companyId, projectId) => {
    if (!OBJECT_ID.test(String(projectId))) return [];
    const project = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PROJECTS, data: [{ _id: new mongoose.Types.ObjectId(String(projectId)) }, { tagsArray: 1 }] }, 'findOne').catch(() => null);
    return (project && plain(project).tagsArray) || [];
};

const logFailure = (what) => (error) => logger.error(`${what}: ${(error && error.message) || JSON.stringify(error)}`);

const recordCustomFieldValue = async ({ companyId, task, customFieldId, updateDetail, actor }) => {
    const stored = plain(task);
    const definition = await customFieldDefinitionOf(companyId, customFieldId);
    const entry = describeCustomFieldValue({ actor, definition, next: updateDetail, previous: stored.customField && stored.customField[customFieldId] });
    if (!entry) return;
    await HandleHistory('task', companyId, String(stored.ProjectID), String(stored._id), entry, actor).catch(logFailure('custom field value history'));
};

const recordTaskTag = async ({ companyId, task, tagId, operation, actor }) => {
    const stored = plain(task);
    const tags = await projectTagsOf(companyId, stored.ProjectID);
    const tag = tags.find((candidate) => candidate && String(candidate.uid) === String(tagId));
    const held = (stored.tagsArray || []).map(String).includes(String(tagId));
    const entry = describeTaskTag({ actor, tag, taskName: stored.TaskName, operation, held });
    if (!entry) return;
    const projectId = String(stored.ProjectID);
    await Promise.all([
        HandleHistory('task', companyId, projectId, String(stored._id), entry.task, actor).catch(logFailure('task tag history')),
        HandleHistory('project', companyId, projectId, null, entry.project, actor).catch(logFailure('project tag history')),
    ]);
};

module.exports = {
    HISTORY,
    SERVER_BUILT_HISTORY,
    describeCustomFieldValue,
    describeTaskTag,
    recordCustomFieldValue,
    recordTaskTag,
};
