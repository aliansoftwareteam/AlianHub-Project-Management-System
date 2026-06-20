const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { dbCollections } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { jitProvisionUser } = require('../SSO/provisioning');
const { removeCache } = require('../../utils/commonFunctions');
const logger = require('../../Config/loggerConfig');

let invalidateRoleCache = () => {};
try { ({ invalidateRoleCache } = require('../../Config/permissionGuard')); } catch (e) { /* optional */ }

const getCompanyUser = (companyId, uid) =>
    MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.COMPANY_USERS, data: [{ userId: String(uid) }] }, 'findOne');

const getCompanyUserByEmail = (companyId, email) =>
    MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.COMPANY_USERS, data: [{ userEmail: String(email).toLowerCase() }] }, 'findOne');

const getGlobalUser = (uid) =>
    MongoDbCrudOpration(dbCollections.GLOBAL, {
        type: SCHEMA_TYPE.USERS, data: [{ _id: new mongoose.Types.ObjectId(String(uid)) }],
    }, 'findOne');

const getGlobalUsersByIds = (uids) => {
    const ids = (uids || []).filter(Boolean).map((u) => new mongoose.Types.ObjectId(String(u)));
    if (!ids.length) return Promise.resolve([]);
    return MongoDbCrudOpration(dbCollections.GLOBAL, {
        type: SCHEMA_TYPE.USERS, data: [{ _id: { $in: ids } }],
    }, 'find');
};

const clearUserCaches = (companyId, uid) => {
    try {
        removeCache(`company_users:${companyId}`);
        removeCache(`UserData:${uid}`, false);
        removeCache(`UserAllData:${companyId}`);
        invalidateRoleCache(companyId, uid);
    } catch (e) { /* cache is best-effort */ }
};

// Create or reactivate a SCIM-managed membership. Reuses the SSO JIT path so a
// user provisioned by SCIM and a user who later logs in via SSO are the SAME
// global user (matched by email). Returns { uid, created }.
const provision = async (companyId, { email, firstName, lastName, externalId, active, defaultRoleType }) => {
    const existing = await getCompanyUserByEmail(companyId, email);
    const uid = await jitProvisionUser({
        companyId, email, firstName, lastName, externalId,
        defaultRoleType: defaultRoleType || 3, autoProvision: true,
    });
    const set = { status: active === false ? 0 : 1, isDelete: active === false, userEmail: String(email).toLowerCase() };
    if (externalId) set.scimExternalId = String(externalId);
    await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.COMPANY_USERS,
        data: [{ userId: String(uid) }, { $set: set }],
    }, 'updateOne');
    clearUserCaches(companyId, uid);
    return { uid, created: !existing };
};

// Activate / deactivate a membership for THIS company only (the global user may
// belong to other companies). Returns the updated membership, or null if absent.
const setActive = async (companyId, uid, active) => {
    const cu = await getCompanyUser(companyId, uid);
    if (!cu) return null;
    await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.COMPANY_USERS,
        data: [{ userId: String(uid) }, { $set: { status: active ? 1 : 0, isDelete: !active } }],
    }, 'updateOne');
    clearUserCaches(companyId, uid);
    return getCompanyUser(companyId, uid);
};

const updateName = async (uid, { givenName, familyName }) => {
    if (givenName === undefined && familyName === undefined) return;
    const cur = await getGlobalUser(uid);
    const fn = givenName !== undefined ? givenName : (cur && cur.Employee_FName) || '';
    const ln = familyName !== undefined ? familyName : (cur && cur.Employee_LName) || '';
    const set = { Employee_Name: `${fn} ${ln}`.trim() };
    if (givenName !== undefined) set.Employee_FName = givenName;
    if (familyName !== undefined) set.Employee_LName = familyName;
    await MongoDbCrudOpration(dbCollections.GLOBAL, {
        type: SCHEMA_TYPE.USERS,
        data: [{ _id: new mongoose.Types.ObjectId(String(uid)) }, { $set: set }],
    }, 'updateOne');
};

// List memberships (optionally filtered by email), newest first, paginated.
const listMembers = async (companyId, email, skip, limit) => {
    const match = email ? { userEmail: String(email).toLowerCase() } : {};
    const pipeline = [
        { $match: match },
        { $sort: { _id: -1 } },
        { $facet: { data: [{ $skip: Math.max(0, skip) }, { $limit: Math.max(1, limit) }], meta: [{ $count: 'total' }] } },
    ];
    const rows = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.COMPANY_USERS, data: [pipeline] }, 'aggregate');
    const members = (rows && rows[0] && rows[0].data) || [];
    const total = (rows && rows[0] && rows[0].meta && rows[0].meta[0] && rows[0].meta[0].total) || 0;
    return { members, total };
};

module.exports = {
    getCompanyUser, getCompanyUserByEmail, getGlobalUser, getGlobalUsersByIds,
    provision, setActive, updateName, listMembers, logger,
};
