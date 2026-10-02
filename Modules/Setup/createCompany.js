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
const { COUNTRY_NOT_ASKED } = require('../Company/helpers/companyDetails');
const { updateUserFun } = require('../Users/controller');
const { storeRefferalCode } = require('../Affiliate/controller');
const { planObj } = require('./defaultSubscriptionData');
const { createDemoProject } = require('./demoProject');
const { ensureViewCatalogue } = require('../projectTabs/catalogue');
const vectorStore = require('../Knowledge/vectorStore');
const { handleCreateCompanyDataStorageFun } = require(`../../common-storage/common-${process.env.STORAGE_TYPE}.js`);

const importSettings = (payload) => new Promise((resolve, reject) => {
    iCtr.importSettingsFunction({ body: payload }, (result) => (result?.status
        ? resolve()
        : reject(new Error(result?.statusText || 'Settings import failed'))));
});

const reasonOf = (failure) => failure?.message || failure?.statusText || String(failure?.error || failure);

async function createOwner({ firstName, lastName, email, password }) {
    const created = await createUserRef.addUserMongodbV2({ firstName, lastName, email, password, isInvitation: false });
    const ownerId = String(created.statusText._id);
    // The person running setup is the operator and mail is rarely configured yet, so the
    // verification gate in generateTokenV2Fun would lock them out of the account they just made.
    // Instance ownership is granted only here; the shared signup insert never writes it.
    await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, {
        type: dbCollections.USERS,
        data: [{ _id: ownerId }, { $set: { isProductOwner: true, isEmailVerified: true, verificationToken: '' } }],
    }, 'findOneAndUpdate');
    return ownerId;
}

/* The company details the wizard does not ask for. The owner can fill them in under
 * Settings > General; phone, state and city may stay empty. */
const COMPANY_DEFAULTS = {
    Cst_Phone: '',
    Cst_Country: COUNTRY_NOT_ASKED,
    Cst_City: '',
    Cst_State: '',
    Cst_DialCode: { name: '', dialCode: '', code: '' },
    Cst_LogTimeDays: '8',
};

async function createFirstCompany({ userId, email, companyName, teamFocus = '', sampleData = true, companyFields = {}, onStep = () => {} }) {
    const companyMongoId = new mongoose.Types.ObjectId();
    const companyId = String(companyMongoId);
    const company = {
        ...COMPANY_DEFAULTS,
        ...companyFields,
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
    const steps = [
        { name: 'its storage', needed: true, run: () => handleCreateCompanyDataStorageFun({ companyName }, companyId) },
        { name: 'the unread counter row', needed: false, run: () => addAndRemoveUserInMongodbNotificationCount(companyId, userId, 'Add') },
        { name: "the owner's seat and starting settings", needed: true, run: () => importSettings({ companyId, uid: userId, email }) },
        { name: 'the notification defaults', needed: false, run: () => ensureNotificationDefaults(companyId, userId) },
    ];
    const settled = await Promise.allSettled(steps.map((step) => step.run()));
    const failed = steps.filter((step, index) => settled[index].status === 'rejected');
    failed.forEach((step) => logger.error(`setup: ${step.name} failed: ${reasonOf(settled[steps.indexOf(step)].reason)}`));
    const missing = failed.filter((step) => step.needed).map((step) => step.name);
    if (missing.length) {
        // Left in place, the row would be a company nobody can open, and it would count against the owner's free ones.
        try {
            await updateCompanyFun(SCHEMA_TYPE.GOLBAL, {
                type: dbCollections.COMPANIES,
                data: [{ _id: companyMongoId, userId }],
            }, 'deleteOne', companyId);
        } catch (error) {
            logger.error(`setup: the company row could not be taken back: ${reasonOf(error)}`);
        }
        throw new Error(`The company could not be set up: ${missing.join(' and ')} could not be made.`);
    }
    // The sample project picks its views from the catalogue, so it is completed whatever the import stored of it.
    await ensureViewCatalogue(companyId).catch((error) => logger.error(`setup: project view catalogue failed: ${error.message}`));
    vectorStore.prepareCompany(companyId);

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
