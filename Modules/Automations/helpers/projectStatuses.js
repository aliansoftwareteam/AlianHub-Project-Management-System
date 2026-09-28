const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { catalogueOf } = require('./statusConditions');

/* The statuses of the company's projects, or of `projectIds` when given. */
const loadStatuses = async (companyId, projectIds) => {
    const filter = Array.isArray(projectIds)
        ? { _id: { $in: projectIds.map(String) } }
        : { deletedStatusKey: { $ne: 1 } };
    const projects = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PROJECTS, data: [filter, { taskStatusData: 1 }] }, 'find');
    return catalogueOf(projects || []);
};

module.exports = { loadStatuses };
