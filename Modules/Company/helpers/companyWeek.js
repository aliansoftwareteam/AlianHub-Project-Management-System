const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const logger = require('../../../Config/loggerConfig');
const { getCompanyDataFun } = require('../controller/updateCompany');
const { workingDaysFor, weekendDaysFor } = require('./workingDays');

const OBJECT_ID = /^[a-f0-9]{24}$/i;

/* A week that cannot be read falls back to the default one: capacity and timesheets stay readable, and the failure is logged. */
const companyOf = async (companyId) => {
    try {
        const [company] = await getCompanyDataFun([String(companyId)]);
        return company || null;
    } catch (error) {
        logger.error(`companyWeek: company ${companyId} could not be read: ${(error && error.message) || error}`);
        return null;
    }
};

const projectOf = async (companyId, projectId) => {
    if (!OBJECT_ID.test(String(projectId || ''))) return null;
    try {
        return await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PROJECTS,
            data: [{ _id: new mongoose.Types.ObjectId(String(projectId)) }, { workingDays: 1 }],
        }, 'findOne');
    } catch (error) {
        logger.error(`companyWeek: project ${projectId} could not be read: ${(error && error.message) || error}`);
        return null;
    }
};

const workingDaysOf = async (companyId, projectId) => workingDaysFor(await companyOf(companyId), projectId ? await projectOf(companyId, projectId) : null);

const weekendOf = (workingDays) => weekendDaysFor({ workingDays });

const companyWorkingDays = (companyId) => workingDaysOf(companyId);
const companyWeekendDays = async (companyId) => weekendOf(await workingDaysOf(companyId));

module.exports = { workingDaysOf, weekendOf, companyWorkingDays, companyWeekendDays };
