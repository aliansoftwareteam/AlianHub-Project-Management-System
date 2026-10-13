const logger = require('../../../Config/loggerConfig');
const { employeeNameOf, escapeText } = require('../../Tasks/helpers/taskWriteFields');
/* Tasks/helpers/helper and the custom field controller require each other, so the history writer is loaded when a row is written. */
const handleHistory = (...args) => require('../../Tasks/helpers/helper').HandleHistory(...args);

const HISTORY_KEY = 'Project_CustomField';

/* Company-wide fields are managed in settings and were never written to a project's history. */
const projectsOf = (field) => (field && field.global !== true && field.projectId ? [].concat(field.projectId).map(String).filter(Boolean) : []);

const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);

const describeFieldCreated = ({ actor, field }) => ({
    key: HISTORY_KEY,
    message: `<b>${actor.Employee_Name}</b> has Created <b> Custom Field </b> as <b>${escapeText(field.fieldTitle)}</b> for ${escapeText(field.type)}.`,
});

const describeFieldRenamed = ({ actor, previous, next }) => {
    if (!next || !Object.hasOwn(next, 'fieldTitle') || String(next.fieldTitle) === String(previous.fieldTitle)) return null;
    return {
        key: HISTORY_KEY,
        message: `<b>${actor.Employee_Name}</b> has Edited <b> Custom Field </b> from <b>${escapeText(previous.fieldTitle)}</b> to <b>${escapeText(next.fieldTitle)}</b> for ${escapeText(previous.type)}.`,
    };
};

const recordFor = async ({ companyId, field, actorId, describe }) => {
    const projects = projectsOf(field);
    if (!projects.length) return;
    const actor = { id: String(actorId), Employee_Name: escapeText(await employeeNameOf(String(actorId))) };
    const entry = describe(actor);
    if (!entry) return;
    await Promise.all(projects.map((projectId) => handleHistory('project', companyId, projectId, null, entry, actor)
        .catch((error) => logger.error(`custom field history: ${(error && error.message) || JSON.stringify(error)}`))));
};

const recordFieldCreated = ({ companyId, field, actorId }) => {
    const stored = plain(field);
    return recordFor({ companyId, field: stored, actorId, describe: (actor) => describeFieldCreated({ actor, field: stored }) });
};

const recordFieldRenamed = ({ companyId, previous, next, actorId }) => {
    const stored = plain(previous);
    return recordFor({ companyId, field: stored, actorId, describe: (actor) => describeFieldRenamed({ actor, previous: stored, next }) });
};

module.exports = { HISTORY_KEY, describeFieldCreated, describeFieldRenamed, recordFieldCreated, recordFieldRenamed };
