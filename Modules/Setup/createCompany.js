const { ensureNotificationDefaults } = require('../notification/defaults');
const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { dbCollections } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const iCtr = require('../ImportSettings/controller');
const { addAndRemoveUserInMongodbNotificationCount } = require('../Auth/controller');
const createUserRef = require('../Auth/controller/createUser');
const { updateCompanyFun } = require('../Company/controller/updateCompany');
const { updateUserFun } = require('../Users/controller');
const { storeRefferalCode } = require('../Affiliate/controller');
const { planObj } = require('./defaultSubscriptionData');
const { createDemoProject } = require('./demoProject');
const { handleCreateCompanyDataStorageFun } = require(`../../common-storage/common-${process.env.STORAGE_TYPE}.js`);

const importSettings = (payload) => new Promise((resolve, reject) => {
    iCtr.importSettingsFunction({ body: payload }, (result) => (result?.status
        ? resolve()
        : reject(new Error(result?.statusText || 'Settings import failed'))));
});

async function createOwner({ firstName, lastName, email, password }) {
    const created = await createUserRef.addUserMongodbV2({ firstName, lastName, email, password, isInvitation: false, isProductOwner: true });
    const ownerId = String(created.statusText._id);
    // The person running setup is the operator and mail is rarely configured yet, so the
    // verification gate in generateTokenV2Fun would lock them out of the account they just made.
    await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, {
        type: dbCollections.USERS,
        data: [{ _id: ownerId }, { $set: { isEmailVerified: true, verificationToken: '' } }],
    }, 'findOneAndUpdate');
    return ownerId;
}

/* The company details the wizard does not ask for. The schema requires them, and the
 * owner can fill them in under Settings > Company. */
const COMPANY_DEFAULTS = {
    Cst_Phone: 'N/A',
    Cst_Country: 'N/A',
    Cst_City: '',
    Cst_State: '',
    Cst_DialCode: { name: '', dialCode: '', code: '' },
    Cst_LogTimeDays: '8',
};

async function createFirstCompany({ userId, email, companyName, teamFocus = '', sampleData = true, onStep = () => {} }) {
    const companyMongoId = new mongoose.Types.ObjectId();
    const companyId = String(companyMongoId);
    const company = {
        ...COMPANY_DEFAULTS,
        _id: companyMongoId,
        userId,
        teamFocus,
        Cst_CompanyName: companyName,
        totalProjects: 0,
        isInactive: false,
        isFree: true,
        subscriptionData: { storage: 0, trackers: 0, users: 5 },
        totalData: { storage: 0, trackers: 0, users: 1 },
        companyData: [{ users: 1 }],
    };

    onStep('company');
    await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type: SCHEMA_TYPE.COMPANIES, data: company }, 'save');

    onStep('settings');
    const side = await Promise.allSettled([
        handleCreateCompanyDataStorageFun({ companyName }, companyId),
        addAndRemoveUserInMongodbNotificationCount(companyId, userId, 'Add'),
        importSettings({ companyId, uid: userId, email }),
        ensureNotificationDefaults(companyId, userId),
    ]);
    side.filter((r) => r.status === 'rejected').forEach((r) => logger.error(`setup: company side step failed: ${r.reason?.message || r.reason}`));

    await updateUserFun(SCHEMA_TYPE.GOLBAL, {
        type: SCHEMA_TYPE.USERS,
        data: [{ _id: userId }, { $push: { AssignCompany: companyId } }, false],
    }, 'findOneAndUpdate', companyId, userId);
    await updateCompanyFun(SCHEMA_TYPE.GOLBAL, {
        type: dbCollections.COMPANIES,
        data: [{ _id: companyId }, { planFeature: planObj }],
    }, 'findOneAndUpdate', companyId);
    await storeRefferalCode(companyId, userId);

    if (sampleData) {
        onStep('sample');
        // Runs after planFeature is written: the sample sprint reads it and used to throw otherwise.
        await createDemoProject(companyId, userId, teamFocus);
    }
    return companyId;
}

module.exports = { createOwner, createFirstCompany, COMPANY_DEFAULTS };
