const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');

/* Until the plan entitlements (064) exist, the plan a company carries in planFeature is the add-on:
 * trackerTimesheet is the switch the web app already hides tracker timesheets behind, and
 * timeTrackerUser the seat limit Modules/trackerUserPermission enforces (0 or empty: no limit). */
const trackerAccess = (planFeature) => {
    const plan = planFeature && typeof planFeature === 'object' ? planFeature : {};
    const limit = Number(plan.timeTrackerUser);
    return {
        enabled: plan.trackerTimesheet !== false,
        seatLimit: Number.isFinite(limit) && limit > 0 ? limit : null,
    };
};

const findCompany = (filter) => MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type: SCHEMA_TYPE.COMPANIES, data: [filter, { _id: 1 }] }, 'findOne');

/* Before sign-in nobody has picked a company yet, so the instance offers the tracker when any of its
 * companies has it. A managed instance writes the same plan into every company it holds. */
const trackerOnInstance = async () => {
    if (await findCompany({ isDisable: { $ne: true }, 'planFeature.trackerTimesheet': { $ne: false } })) return true;
    return !(await findCompany({}));
};

module.exports = { trackerAccess, trackerOnInstance };
