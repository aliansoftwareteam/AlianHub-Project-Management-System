const mongoose = require('mongoose');
const ctrl = require('./controller');
const aiFields = require('./aiFields/controller');
const fieldLinks = require('./fieldLinksController');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { requireProjectAccess } = require('../../Config/projectAccess');
const { requireTaskWritePermission } = require('../../Config/permissionGuard');
const { TASK_ACTIONS } = require('../../Config/taskWritePermissions');
const { fieldInsertFrom, fieldUpdateFrom, isCompanyWide, widensToCompany, requireFieldSettings, requireSameKind, checkFieldWrite } = require('./helpers/fieldWrite');
const { linkPlan, listOf } = require('./helpers/fieldProjects');

const CUSTOM_FIELD_EDIT = [['project.project_custom_field', 'task.task_custom_field']];

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

const updateTouchesCompanyWide = async (req) => {
    const stored = await storedField(req);
    return widensToCompany(req.body.updateObject) || isCompanyWide(stored) || leavesNoProject(stored, req.body);
};

exports.init = (app) => {
    app.get('/api/v1/customField', ctrl.getCustomField)
    app.put('/api/v1/customField',
        checkFieldWrite(fieldUpdateFrom),
        requireProjectAccess({ projectIds: updatedFieldProjects, permissions: () => CUSTOM_FIELD_EDIT }),
        requireFieldSettings(updateTouchesCompanyWide),
        requireSameKind(storedField),
        ctrl.updateCustomField)
    app.post('/api/v1/customField',
        checkFieldWrite(({ updateObject }) => fieldInsertFrom(updateObject)),
        requireProjectAccess({ projectIds: insertedFieldProjects, permissions: () => CUSTOM_FIELD_EDIT }),
        requireFieldSettings(insertIsCompanyWide),
        ctrl.insertCustomField)
    app.get('/api/v2/custom-fields/formula/scope', ctrl.formulaScope)
    app.post('/api/v2/custom-fields/formula/validate', ctrl.validateFormula)
    app.post('/api/v2/custom-fields/compute', requireTaskWritePermission(COMPUTED_VALUES), ctrl.computeFields)
    app.post('/api/v2/custom-fields/links/resolve', fieldLinks.resolve)
    app.post('/api/v2/custom-fields/:fieldId/vote', fieldLinks.vote)
    app.post('/api/v2/custom-fields/:fieldId/ai/preview', aiFields.preview)
    app.post('/api/v2/custom-fields/:fieldId/ai/apply', aiFields.apply)
    app.post('/api/v2/custom-fields/:fieldId/ai/jobs', aiFields.startJob)
    app.get('/api/v2/custom-fields/ai/jobs/:jobId', aiFields.readJob)
}
