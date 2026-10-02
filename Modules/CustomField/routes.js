const mongoose = require('mongoose');
const ctrl = require('./controller');
const aiFields = require('./aiFields/controller');
const fieldLinks = require('./fieldLinksController');
const fieldRemoval = require('./fieldRemovalController');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { requireProjectAccess } = require('../../Config/projectAccess');
const { requireTaskWritePermission } = require('../../Config/permissionGuard');
const { TASK_ACTIONS } = require('../../Config/taskWritePermissions');
const { fieldInsertFrom, fieldUpdateFrom, isCompanyWide, widensToCompany, requireFieldSettings, requireSameKind, checkFieldWrite } = require('./helpers/fieldWrite');
const { linkPlan, listOf } = require('./helpers/fieldProjects');
const { agentsRefused } = require('../Agents/guard');

const CUSTOM_FIELD_EDIT = [['project.project_custom_field', 'task.task_custom_field']];

/* An agent proposes a field through its MCP tool; a person approves it, and it is then made here as that person. */
const fieldsByPeople = agentsRefused('fields.create');

/* Storing a computed value on a task is held to what editing a field value on it is held to. */
const COMPUTED_VALUES = Object.freeze({ needs: TASK_ACTIONS.updateTaskCustomField.needs, tasks: [['taskIds', '*']] });

const projectsOf = (field) => (field && field.global !== true && field.projectId ? [].concat(field.projectId) : []);

const storedField = (req) => MongoDbCrudOpration(req.headers['companyid'], {
    type: SCHEMA_TYPE.CUSTOM_FIELDS,
    data: [{ _id: new mongoose.Types.ObjectId(String(req.body.id)) }, { global: 1, projectId: 1, fieldType: 1 }],
}, 'findOne');

const insertedFieldProjects = (req) => projectsOf(req.body.updateObject);

const updatedFieldProjects = async (req) => {
    const { updateObject } = req.body;
    const incoming = projectsOf({ ...updateObject, global: updateObject.global === true });
    return [...projectsOf(await storedField(req)), ...incoming, ...listOf(req.body.addProjects), ...listOf(req.body.removeProjects)];
};

/* A field with no project left shows nowhere a project member manages it, so only the company-wide gate covers it. */
const leavesNoProject = (stored, body) => {
    const plan = linkPlan(stored, body);
    return !plan.clears && plan.remove.length > 0 && plan.result.length === 0;
};

const insertIsCompanyWide = (req) => isCompanyWide(req.body.updateObject);

/* A field and its values are taken away for good by a person alone; an agent's token is refused and that is recorded. */
const deletedByPeople = agentsRefused('fields.delete');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const requireFieldId = (req, res, next) => (OBJECT_ID.test(String(req.params.fieldId || ''))
    ? next()
    : res.status(400).json({ status: false, statusText: 'fieldId must be an id.', message: 'fieldId must be an id.' }));

const namedField = (req) => MongoDbCrudOpration(req.headers['companyid'], {
    type: SCHEMA_TYPE.CUSTOM_FIELDS,
    data: [{ _id: new mongoose.Types.ObjectId(String(req.params.fieldId)) }, { global: 1, projectId: 1 }],
}, 'findOne');

/* Whoever may change the field: the field setting for a company-wide one, the field permission in each of its projects otherwise. */
const managesNamedField = [
    requireFieldId,
    requireProjectAccess({ projectIds: async (req) => projectsOf(await namedField(req)), permissions: () => CUSTOM_FIELD_EDIT }),
    requireFieldSettings(async (req) => isCompanyWide(await namedField(req))),
];

const updateTouchesCompanyWide = async (req) => {
    const stored = await storedField(req);
    return widensToCompany(req.body.updateObject) || isCompanyWide(stored) || leavesNoProject(stored, req.body);
};

exports.init = (app) => {
    app.get('/api/v1/customField', ctrl.getCustomField)
    app.put('/api/v1/customField',
        fieldsByPeople,
        checkFieldWrite(fieldUpdateFrom),
        requireProjectAccess({ projectIds: updatedFieldProjects, permissions: () => CUSTOM_FIELD_EDIT }),
        requireFieldSettings(updateTouchesCompanyWide),
        requireSameKind(storedField),
        ctrl.updateCustomField)
    app.post('/api/v1/customField',
        fieldsByPeople,
        checkFieldWrite(({ updateObject }) => fieldInsertFrom(updateObject)),
        requireProjectAccess({ projectIds: insertedFieldProjects, permissions: () => CUSTOM_FIELD_EDIT }),
        requireFieldSettings(insertIsCompanyWide),
        ctrl.insertCustomField)
    app.get('/api/v2/custom-fields/formula/scope', ctrl.formulaScope)
    app.post('/api/v2/custom-fields/formula/validate', ctrl.validateFormula)
    app.post('/api/v2/custom-fields/compute', requireTaskWritePermission(COMPUTED_VALUES), ctrl.computeFields)
    app.get('/api/v2/custom-fields/:fieldId/usage', ...managesNamedField, fieldRemoval.fieldUsage)
    app.post('/api/v2/custom-fields/:fieldId/delete', deletedByPeople, ...managesNamedField, fieldRemoval.deleteCustomField)
    app.post('/api/v2/custom-fields/links/resolve', fieldLinks.resolve)
    app.post('/api/v2/custom-fields/:fieldId/vote', fieldLinks.vote)
    app.post('/api/v2/custom-fields/:fieldId/ai/preview', agentsRefused('ai.spend'), aiFields.preview)
    app.post('/api/v2/custom-fields/:fieldId/ai/apply', aiFields.apply)
    app.post('/api/v2/custom-fields/:fieldId/ai/jobs', agentsRefused('ai.spend'), aiFields.startJob)
    app.get('/api/v2/custom-fields/ai/jobs/:jobId', aiFields.readJob)
}
