const mongoose = require('mongoose');
const ctrl = require('./controller');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { requireProjectAccess } = require('../../Config/projectAccess');

const CUSTOM_FIELD_EDIT = [['project.project_custom_field', 'task.task_custom_field']];
const OBJECT_ID = /^[a-f0-9]{24}$/i;

const projectsOf = (field) => (field && field.global !== true && field.projectId ? [].concat(field.projectId) : []);

const insertedFieldProjects = (req) => projectsOf(req.body && req.body.updateObject);

const updatedFieldProjects = async (req) => {
    const { id, updateObject } = req.body || {};
    const incoming = projectsOf(updateObject && { ...updateObject, global: updateObject.global === true });
    if (!OBJECT_ID.test(String(id || ''))) return incoming;
    const stored = await MongoDbCrudOpration(req.headers['companyid'], {
        type: SCHEMA_TYPE.CUSTOM_FIELDS,
        data: [{ _id: new mongoose.Types.ObjectId(String(id)) }, { global: 1, projectId: 1 }],
    }, 'findOne');
    return [...projectsOf(stored), ...incoming];
};

exports.init = (app) => {
    app.get('/api/v1/customField', ctrl.getCustomField)
    app.put('/api/v1/customField', requireProjectAccess({ projectIds: updatedFieldProjects, permissions: () => CUSTOM_FIELD_EDIT }), ctrl.updateCustomField)
    app.post('/api/v1/customField', requireProjectAccess({ projectIds: insertedFieldProjects, permissions: () => CUSTOM_FIELD_EDIT }), ctrl.insertCustomField)
    app.get('/api/v2/custom-fields/formula/scope', ctrl.formulaScope)
    app.post('/api/v2/custom-fields/formula/validate', ctrl.validateFormula)
    app.post('/api/v2/custom-fields/compute', ctrl.computeFields)
}
