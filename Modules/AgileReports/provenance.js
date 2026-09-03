// Who finished the work in a sprint (29c). Read-only, and every figure comes
// from the completion record the task already carries — no new write path, no
// second source of truth for the badge on the row.
const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const rollup = require('../Tasks/helpers/provenanceRollup');

const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;
const SCOPE_FILTER = { deletedStatusKey: { $in: [0, 2, undefined] }, isParentTask: true };
const TASK_FIELDS = '_id TaskKey TaskName statusType points sprintId ProjectID completion';

const oid = (id) => { try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return null; } };

const loadContract = (companyId, projectId) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.PROJECT_CONTRACTS,
    data: [{ ProjectID: oid(projectId), deletedStatusKey: 0 }, 'blendedCostRateMinor currency currencySymbol'],
}, 'findOne').catch(() => null);

/* GET /api/v1/agile/provenance?sprintId=  |  ?projectId=   (companyId from header) */
exports.getProvenance = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const sprintId = String((req.query && req.query.sprintId) || '');
        const projectId = String((req.query && req.query.projectId) || '');
        const bySprint = OBJECT_ID_PATTERN.test(sprintId);
        if (!companyId || (!bySprint && !OBJECT_ID_PATTERN.test(projectId))) {
            return res.send({ status: false, statusText: 'companyId and a valid sprintId or projectId are required.' });
        }

        const sprint = bySprint
            ? await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.SPRINTS, data: [{ _id: oid(sprintId) }, '_id name projectId'] }, 'findOne')
            : null;
        if (bySprint && !sprint) return res.send({ status: false, statusText: 'Sprint not found.' });

        const scope = bySprint ? { sprintId: oid(sprintId) } : { ProjectID: oid(projectId) };
        const tasks = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS, data: [{ ...scope, ...SCOPE_FILTER }, TASK_FIELDS],
        }, 'find') || [];

        const owningProject = String((sprint && sprint.projectId) || projectId || '');
        const contract = OBJECT_ID_PATTERN.test(owningProject) ? await loadContract(companyId, owningProject) : null;
        const split = rollup.velocitySplit(tasks);
        const margin = rollup.marginSplit({
            tasks,
            blendedCostRateMinor: contract && contract.blendedCostRateMinor ? Number(contract.blendedCostRateMinor) : null,
        });

        return res.send({
            status: true,
            statusText: 'Provenance computed.',
            data: {
                sprint: sprint ? { id: String(sprint._id), name: sprint.name || 'Sprint' } : null,
                projectId: owningProject,
                ...split,
                margin: { ...margin, currencySymbol: (contract && contract.currencySymbol) || '' },
            },
        });
    } catch (error) {
        logger.error(`ERROR in agile provenance: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};
