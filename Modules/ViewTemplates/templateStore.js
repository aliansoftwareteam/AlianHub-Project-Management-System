const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { fitSettings } = require('./templateRules');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const LIVE = { deletedStatusKey: 0 };

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const crud = (companyId, type, data, method) => MongoDbCrudOpration(companyId, { type, data }, method);

const liveTemplate = (companyId, id) => (OBJECT_ID.test(String(id || ''))
    ? crud(companyId, SCHEMA_TYPE.VIEW_TEMPLATES, [{ _id: oid(id), ...LIVE }], 'findOne')
    : Promise.resolve(null));

const liveTemplates = async (companyId) => (await crud(companyId, SCHEMA_TYPE.VIEW_TEMPLATES, [{ ...LIVE }], 'find')) || [];

const countTemplates = async (companyId) => Number(await crud(companyId, SCHEMA_TYPE.VIEW_TEMPLATES, [{ ...LIVE }], 'countDocuments')) || 0;

const usedInProject = (field, projectId) => field.global === true || [].concat(field.projectId || []).map(String).includes(String(projectId));

const projectFieldIds = async (companyId, projectId) => {
    const fields = await crud(companyId, SCHEMA_TYPE.CUSTOM_FIELDS, [{ isDelete: { $ne: false } }, { global: 1, projectId: 1 }], 'find');
    return new Set((fields || []).filter((field) => usedInProject(field, projectId)).map((field) => String(field._id)));
};

const fitToProject = async (companyId, project, template) => fitSettings(template.settings, {
    fieldIds: await projectFieldIds(companyId, project._id),
    statusKeys: new Set((project.taskStatusData || []).map((status) => String(status && status.key))),
});

const catalogueView = (companyId, keyName) => crud(companyId, SCHEMA_TYPE.PROJECT_TAB_COMPONENTS, [{ keyName }], 'findOne');

module.exports = { OBJECT_ID, oid, crud, liveTemplate, liveTemplates, countTemplates, fitToProject, catalogueView };
