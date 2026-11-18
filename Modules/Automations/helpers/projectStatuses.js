const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const logger = require('../../../Config/loggerConfig');
const { catalogueOf, stepsNeedStatusCatalogue, normaliseStepConditions } = require('./statusConditions');

/* The statuses of the company's projects, or of `projectIds` when given. */
const loadStatuses = async (companyId, projectIds) => {
    const filter = Array.isArray(projectIds)
        ? { _id: { $in: projectIds.map(String) } }
        : { deletedStatusKey: { $ne: 1 } };
    const projects = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PROJECTS, data: [filter, { taskStatusData: 1 }] }, 'find');
    return catalogueOf(projects || []);
};

/* Condition steps saved before status conditions were keyed still name
 * statuses; they are read the way the matcher reads a rule's own conditions. */
const resolveStepStatuses = async (companyId, steps, scope = {}) => {
    if (!stepsNeedStatusCatalogue(steps)) return steps;
    const statuses = await loadStatuses(companyId).catch((error) => {
        logger.error(`[automation-statuses] could not load statuses for ${companyId}: ${error.message}`);
        return [];
    });
    return normaliseStepConditions(steps, statuses, scope).steps;
};

module.exports = { loadStatuses, resolveStepStatuses };
