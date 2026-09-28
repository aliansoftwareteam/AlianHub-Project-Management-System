const mongoose = require('mongoose');
const ctrl = require('./controller');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { requireProjectAccess } = require('../../Config/projectAccess');
const { fieldInsertFrom, fieldUpdateFrom, isCompanyWide, widensToCompany, requireFieldSettings, checkFieldWrite } = require('./helpers/fieldWrite');

const CUSTOM_FIELD_EDIT = [['project.project_custom_field', 'task.task_custom_field']];

const projectsOf = (field) => (field && field.global !== true && field.projectId ? [].concat(field.projectId) : []);

const storedField = (req) => MongoDbCrudOpration(req.headers['companyid'], {
    type: SCHEMA_TYPE.CUSTOM_FIELDS,
    data: [{ _id: new mongoose.Types.ObjectId(String(req.body.id)) }, { global: 1, projectId: 1 }],
}, 'findOne');

const insertedFieldProjects = (req) => projectsOf(req.body.updateObject);

const updatedFieldProjects = async (req) => {
    const { updateObject } = req.body;
    const incoming = projectsOf({ ...updateObject, global: updateObject.global === true });
    return [...projectsOf(await storedField(req)), ...incoming];
};

const insertIsCompanyWide = (req) => isCompanyWide(req.body.updateObject);

const updateTouchesCompanyWide = async (req) => widensToCompany(req.body.updateObject) || isCompanyWide(await storedField(req));

exports.init = (app) => {
    app.get('/api/v1/customField', ctrl.getCustomField)
    app.put('/api/v1/customField',
        checkFieldWrite(fieldUpdateFrom),
        requireProjectAccess({ projectIds: updatedFieldProjects, permissions: () => CUSTOM_FIELD_EDIT }),
        requireFieldSettings(updateTouchesCompanyWide),
        ctrl.updateCustomField)
    app.post('/api/v1/customField',
        checkFieldWrite(({ updateObject }) => fieldInsertFrom(updateObject)),
        requireProjectAccess({ projectIds: insertedFieldProjects, permissions: () => CUSTOM_FIELD_EDIT }),
        requireFieldSettings(insertIsCompanyWide),
        ctrl.insertCustomField)
    app.get('/api/v2/custom-fields/formula/scope', ctrl.formulaScope)
    app.post('/api/v2/custom-fields/formula/validate', ctrl.validateFormula)
    app.post('/api/v2/custom-fields/compute', ctrl.computeFields)
}
