const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { dbCollections } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { jitProvisionUser } = require('../SSO/provisioning');
const { domainOfEmail, isVerifiedDomain } = require('../SSO/helpers/ssoRules');
const { removeCache } = require('../../utils/commonFunctions');
const logger = require('../../Config/loggerConfig');
const { SEAT_ACTIVE, SEAT_CANCELLED } = require('../../Config/seatStatus');
const { ROLE_OWNER } = require('../../Config/roleTypes');
const knowledgeEvents = require('../Knowledge/ingest/events');
const { sharedRecordVisible } = require('./helpers/scimRules');

// scimRules.isActive reads this back as "not active"; isDelete is what keeps the seat out of the guards.
const SCIM_DEACTIVATED = 0;
const OBJECT_ID = /^[a-f0-9]{24}$/i;

let invalidateRoleCache = () => {};
try { ({ invalidateRoleCache } = require('../../Config/permissionGuard')); } catch (e) { /* optional */ }

/* A SCIM id is the member's userId, or the member row's own _id while an invitation has no account behind it yet. */
const getCompanyUser = async (companyId, id) => {
    const byUser = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.COMPANY_USERS, data: [{ userId: String(id) }] }, 'findOne');
    if (byUser || !OBJECT_ID.test(String(id))) return byUser;
    return MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.COMPANY_USERS, data: [{ _id: new mongoose.Types.ObjectId(String(id)) }],
    }, 'findOne');
};

const getCompanyUserByEmail = (companyId, email) =>
    MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.COMPANY_USERS, data: [{ userEmail: String(email).toLowerCase() }] }, 'findOne');

const getGlobalUser = (uid) => {
    if (!OBJECT_ID.test(String(uid || ''))) return Promise.resolve(null);
    return MongoDbCrudOpration(dbCollections.GLOBAL, {
        type: SCHEMA_TYPE.USERS, data: [{ _id: new mongoose.Types.ObjectId(String(uid)) }],
    }, 'findOne');
};

const getGlobalUsersByIds = (uids) => {
    const ids = (uids || []).filter((u) => OBJECT_ID.test(String(u || ''))).map((u) => new mongoose.Types.ObjectId(String(u)));
    if (!ids.length) return Promise.resolve([]);
    return MongoDbCrudOpration(dbCollections.GLOBAL, {
        type: SCHEMA_TYPE.USERS, data: [{ _id: { $in: ids } }],
    }, 'find');
};

const holdsSeat = (row) => Boolean(row) && Number(row.status) === SEAT_ACTIVE && row.isDelete !== true;

// The members screen publishes these too; without them the knowledge index would keep a deprovisioned
// member's private pages until its next periodic re-check.
const announceSeatChange = (companyId, uid, before, active) => {
    if (!active) knowledgeEvents.publishMemberDeparted(companyId, uid);
    else if (!holdsSeat(before)) knowledgeEvents.publishMemberActivated(companyId, uid);
};

const clearUserCaches = (companyId, uid) => {
    try {
        removeCache(`company_users:${companyId}`);
        removeCache(`UserData:${uid}`, false);
        removeCache(`UserAllData:${companyId}`);
        invalidateRoleCache(companyId, uid);
    } catch (e) { /* cache is best-effort */ }
};

const updateRow = (companyId, row, set) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.COMPANY_USERS,
    data: [{ _id: row._id }, { $set: set }],
}, 'updateOne');

const scimFields = ({ externalId, firstName, lastName }) => {
    const set = {};
    if (externalId) set.scimExternalId = String(externalId);
    if (firstName !== undefined && firstName !== null) set.scimGivenName = String(firstName);
    if (lastName !== undefined && lastName !== null) set.scimFamilyName = String(lastName);
    return set;
};

const onVerifiedDomain = async (companyId, email) => {
    const ssoConfig = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.SSO_CONFIGS, data: [{ deletedStatusKey: 0 }] }, 'findOne');
    return isVerifiedDomain(ssoConfig, domainOfEmail(email));
};

/* SCIM before #911 left a deactivated seat for any address it was sent, so a deactivated row proves that
 * someone was one of the company's people only when they came in through an invitation or own the company. */
const wasMemberBeforeDeactivation = (row) => Boolean(row) && Number(row.status) === SCIM_DEACTIVATED
    && (row.sendInvitationTime != null || Number(row.roleType) === ROLE_OWNER);

/* A SCIM token speaks for its company's own people only: a member it deactivated earlier, or an address on
 * a domain the company verified for SSO. Everyone else gets the invitation any admin would send. */
const mayProvisionDirectly = async (companyId, email, existingRow) => {
    if (existingRow && existingRow.userId && (holdsSeat(existingRow) || wasMemberBeforeDeactivation(existingRow))) return true;
    return onVerifiedDomain(companyId, email);
};

const mayReactivate = async (companyId, row) => Number(row.status) !== SCIM_DEACTIVATED
    || wasMemberBeforeDeactivation(row) || onVerifiedDomain(companyId, row.userEmail);

// Create or reactivate a SCIM-managed membership. Reuses the SSO JIT path so a
// user provisioned by SCIM and a user who later logs in via SSO are the SAME
// global user (matched by email). Returns { uid, created }.
const provision = async (companyId, { email, firstName, lastName, externalId, active, defaultRoleType }) => {
    const existing = await getCompanyUserByEmail(companyId, email);
    const uid = await jitProvisionUser({
        companyId, email, firstName, lastName, externalId,
        defaultRoleType: defaultRoleType || 3, autoProvision: true,
    });
    const set = {
        status: active === false ? SCIM_DEACTIVATED : SEAT_ACTIVE,
        isDelete: active === false,
        userEmail: String(email).toLowerCase(),
        ...scimFields({ externalId, firstName, lastName }),
    };
    await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.COMPANY_USERS,
        data: [{ userId: String(uid) }, { $set: set }],
    }, 'updateOne');
    clearUserCaches(companyId, uid);
    announceSeatChange(companyId, uid, existing, active !== false);
    return { uid, created: !existing };
};

const invite = async (companyId, { email, firstName, lastName, externalId, defaultRoleType }) => {
    const { sendInvitationEmailFun } = require('../Auth/controller/sendInvitation');
    const company = await MongoDbCrudOpration(dbCollections.GLOBAL, {
        type: SCHEMA_TYPE.COMPANIES, data: [{ _id: new mongoose.Types.ObjectId(String(companyId)) }],
    }, 'findOne');
    let sent;
    try {
        sent = await sendInvitationEmailFun({
            email: String(email).toLowerCase(), companyId: String(companyId), companyName: (company && company.Cst_CompanyName) || '',
            role: Number(defaultRoleType) || 3, designation: 0,
        });
    } catch (e) {
        throw new Error(String((e && (e.statusText || e.message)) || e));
    }
    const row = sent && sent.data;
    if (!row || !row._id) throw new Error('The invitation could not be created.');
    if (!sent.status) logger.info(`scim invite ${companyId}: invitation saved, mail not sent (${sent.statusText})`);
    const set = scimFields({ externalId, firstName, lastName });
    if (Object.keys(set).length) await updateRow(companyId, row, set);
    clearUserCaches(companyId, row.userId);
    return getCompanyUser(companyId, row._id);
};

// THIS company only: the global user may belong to other companies. An invitation that was never accepted
// can be withdrawn here but not turned into a seat; only its invitee can do that.
const setActive = async (companyId, id, active) => {
    const cu = await getCompanyUser(companyId, id);
    if (!cu) return null;
    if (!sharedRecordVisible(cu)) {
        if (!active) await updateRow(companyId, cu, { status: SEAT_CANCELLED, isDelete: true });
        clearUserCaches(companyId, cu.userId);
        return getCompanyUser(companyId, cu._id);
    }
    if (active && !(await mayReactivate(companyId, cu))) return cu;
    await updateRow(companyId, cu, { status: active ? SEAT_ACTIVE : SCIM_DEACTIVATED, isDelete: !active });
    clearUserCaches(companyId, cu.userId);
    announceSeatChange(companyId, cu.userId, cu, active);
    return getCompanyUser(companyId, cu._id);
};

const updateName = async (companyId, id, { givenName, familyName }) => {
    if (givenName === undefined && familyName === undefined) return;
    const cu = await getCompanyUser(companyId, id);
    if (!cu) return;
    await updateRow(companyId, cu, scimFields({ firstName: givenName, lastName: familyName }));
    clearUserCaches(companyId, cu.userId);
};

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
    mayProvisionDirectly, provision, invite, setActive, updateName, listMembers, logger,
};
