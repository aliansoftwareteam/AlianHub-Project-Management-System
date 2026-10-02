const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { planObj } = require('../defaultSubscriptionData');
const { normaliseFocus } = require('../../createProject/sampleTasks');
const { COUNTRY_NOT_ASKED } = require('./companyDetails');

const NEW_COMPANY_PLAN = () => ({
    totalProjects: 0,
    isInactive: false,
    isFree: true,
    subscriptionData: { storage: 0, trackers: 0, users: 5 },
    totalData: { storage: 0, trackers: 0, users: 1 },
});

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/* The one shape of a workspace's row in the global companies collection: what sign-up writes, and what the
 * repair of the workspaces that were opened without one writes (migrations/071-workspace-company-rows.js). */
const companyRowFor = (companyMongoId, bodyData) => ({
    type: SCHEMA_TYPE.COMPANIES,
    data: {
        userId: bodyData.userId,
        Cst_CompanyName: String(bodyData.companyName).trim(),
        Cst_Phone: bodyData.phoneNumber || "",
        Cst_Country: bodyData.country || COUNTRY_NOT_ASKED,
        Cst_City: bodyData.city || "",
        Cst_State: bodyData.state || "",
        // A Map in the schema: anything but an object fails the save, and sign-up asks for no dial code.
        Cst_DialCode: isPlainObject(bodyData.countryCodeObj) ? bodyData.countryCodeObj : {},
        teamSize: bodyData.teamSize ? String(bodyData.teamSize) : "",
        teamFocus: bodyData.teamFocus ? normaliseFocus(bodyData.teamFocus) : "",
        Cst_LogTimeDays: bodyData.logtimeDays,
        totalProjects: bodyData.totalProjects,
        isInactive: bodyData.isInactive,
        isFree: bodyData.isFree,
        subscriptionData: bodyData.subscriptionData,
        totalData: bodyData.totalData,
        _id: companyMongoId,
        companyData: [{ users: 1 }],
        Cst_stateCode: bodyData.Cst_stateCode,
        Cst_countryCode: bodyData.Cst_countryCode,
        planFeature: planObj,
    }
});

module.exports = { NEW_COMPANY_PLAN, companyRowFor };
