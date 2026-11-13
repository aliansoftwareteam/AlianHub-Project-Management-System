const mongoose = require('mongoose');
const hostingMode = require('../../Config/hostingMode');
const logger = require('../../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { ACTIVE_SEAT } = require('../../Config/seatStatus');
const { ROLE_GUEST, ROLE_OWNER, ROLE_ADMIN, isPrivileged } = require('../../Config/roleTypes');
const { getRoleType, evaluatePermission } = require('../../Config/permissionGuard');
const { arrangeRules, rolePermission } = require('../../Config/rulePermissions');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { removeCache } = require('../../utils/commonFunctions');
const { canAssignTrackerSeat, unlimited } = require('../Entitlements/checks');
const { refusalBody } = require('../Entitlements/answers');
const { trackerAccess } = require('./access');

const TRACKER_PERMISSION = 'time_tracking.desktop_tracker';
const TRACKER_RULE_KEYS = Object.freeze(['time_tracking', 'desktop_tracker']);
const ROLE_REFUSAL = 'tracker_role';
const NOT_A_MEMBER = 'tracker_not_member';
const MESSAGES = Object.freeze({
    [ROLE_REFUSAL]: 'Your role does not include the desktop time tracker. Ask an admin to turn it on in Security & Permissions.',
    [NOT_A_MEMBER]: 'Only a member of this workspace can use the desktop time tracker.',
});

const ALLOWED = Object.freeze({ allowed: true });
const refused = (refusal) => ({ allowed: false, refusal });

const companyUsers = (companyId, data, method) => MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.COMPANY_USERS, data }, method);

/* Hosted plans carry the tracker as an add-on whose seats are counted per person across the instance;
 * self-hosted keeps the per-workspace planFeature limit, which is empty (unlimited) unless set. */
async function seatPolicy(companyId) {
    if (hostingMode.isManaged()) {
        const tracker = require('../Entitlements/entitlements').feature('timeTracker');
        return { enabled: tracker.enabled, limit: tracker.seats, scope: 'instance' };
    }
    const company = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, {
        type: SCHEMA_TYPE.COMPANIES,
        data: [{ _id: new mongoose.Types.ObjectId(String(companyId)) }, { planFeature: 1 }],
    }, 'findOne');
    return { enabled: true, limit: trackerAccess(company && company.planFeature).seatLimit, scope: 'company' };
}

const limited = (policy) => policy.enabled && !unlimited(policy.limit);

async function holderIds(companyId) {
    const rows = await companyUsers(companyId, [{ ...ACTIVE_SEAT, isTrackerUser: true }, { userId: 1 }], 'find');
    return [...new Set((Array.isArray(rows) ? rows : []).map((row) => String(row.userId || '')).filter(Boolean))];
}

async function seatUse(companyId, policy) {
    if (policy.scope === 'instance') {
        const snapshot = await require('../Entitlements/seats').seatSnapshot({ fresh: true });
        return { used: snapshot.trackerUsers, holders: snapshot.trackerIds };
    }
    const holders = new Set(await holderIds(companyId));
    return { used: holders.size, holders };
}

async function syncTrackerCount(companyId) {
    const { updateCompanyFun } = require('../Company/controller/updateCompany');
    const count = (await holderIds(companyId)).length;
    await updateCompanyFun(SCHEMA_TYPE.GOLBAL, {
        type: SCHEMA_TYPE.COMPANIES,
        data: [{ _id: new mongoose.Types.ObjectId(String(companyId)) }, { $set: { trackerUsers: count } }, { returnDocument: 'after' }],
    }, 'findOneAndUpdate', String(companyId), true);
    return count;
}

async function afterSeatChange(companyId) {
    removeCache(`company_users:${companyId}`);
    require('../Entitlements/seats').forgetSeats();
    await syncTrackerCount(companyId);
}

const setSeat = (companyId, userId, held) => companyUsers(companyId, [{ userId: String(userId), ...ACTIVE_SEAT }, { $set: { isTrackerUser: held } }], 'updateOne');

/* Whether this person may run the desktop tracker now: their role must allow it, and on a plan that
 * limits tracker seats they must hold one or one must be free. `claim` takes the free seat. */
async function trackerAccessFor(companyId, userId, { claim = false } = {}) {
    if (await getRoleType(companyId, userId) === null) return refused({ code: NOT_A_MEMBER });
    if (await evaluatePermission(companyId, userId, TRACKER_PERMISSION) !== true) return refused({ code: ROLE_REFUSAL });
    const policy = await seatPolicy(companyId);
    if (!policy.enabled) return refused(canAssignTrackerSeat({ used: 0, limit: 0, enabled: false }));
    if (!limited(policy)) return ALLOWED;

    const use = await seatUse(companyId, policy);
    if (use.holders.has(String(userId))) return ALLOWED;
    const verdict = canAssignTrackerSeat({ used: use.used, limit: policy.limit });
    if (!verdict.ok) return refused(verdict);
    if (!claim) return ALLOWED;

    await setSeat(companyId, userId, true);
    const after = await seatUse(companyId, policy);
    if (after.used > Number(policy.limit)) {
        await setSeat(companyId, userId, false);
        await afterSeatChange(companyId);
        return refused(canAssignTrackerSeat({ used: Number(policy.limit), limit: policy.limit }));
    }
    await afterSeatChange(companyId);
    return ALLOWED;
}

const refusalAnswer = (refusal) => (MESSAGES[refusal.code]
    ? { status: false, statusText: MESSAGES[refusal.code], message: MESSAGES[refusal.code], code: refusal.code, statusCode: 403 }
    : refusalBody(refusal));

/* The desktop tracker reads this answer and shows its no-access screen on isPermissionDenied. */
const answerTrackerRefusal = (res, refusal) => res.send({ ...refusalAnswer(refusal), isPermissionDenied: true });

async function releaseTrackerSeat(companyId, userId) {
    await setSeat(companyId, userId, false);
    await afterSeatChange(companyId);
}

/* A seat is held only while the holder's role still allows the tracker. Runs after the rules or a
 * member's role change. */
async function releaseSeatsWithoutAccess(companyId) {
    const rows = await companyUsers(companyId, [{ ...ACTIVE_SEAT, isTrackerUser: true }, { userId: 1, roleType: 1 }], 'find') || [];
    if (!rows.length) return 0;
    const { fetchRules } = require('../settings/securityPermissions/controller');
    const arranged = arrangeRules(await fetchRules(companyId));
    const lost = rows.filter((row) => !isPrivileged(row.roleType) && rolePermission(arranged, row.roleType, TRACKER_PERMISSION) !== true);
    if (!lost.length) return 0;
    await companyUsers(companyId, [{ _id: { $in: lost.map((row) => row._id) } }, { $set: { isTrackerUser: false } }], 'updateMany');
    await afterSeatChange(companyId);
    return lost.length;
}

const releaseSeatsLater = (companyId) => {
    releaseSeatsWithoutAccess(companyId).catch((error) => logger.error(`releaseSeatsWithoutAccess ${companyId}: ${error.message || error}`));
};

const startsWithTracker = (roleKey) => typeof roleKey === 'number' && ![ROLE_GUEST, ROLE_OWNER, ROLE_ADMIN].includes(roleKey);

/* A role created after the tracker rows exist starts with the tracker on, like Member. */
async function grantTrackerToNewRoles(companyId, roleKeys) {
    const keys = (roleKeys || []).filter(startsWithTracker);
    if (!keys.length) return 0;
    const rules = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.RULES, data: [{ key: { $in: [...TRACKER_RULE_KEYS] }, projectId: { $exists: false } }] }, 'find') || [];
    let granted = 0;
    for (const rule of rules) {
        const missing = keys.filter((key) => !(rule.roles || []).some((role) => role && role.key === key));
        if (!missing.length) continue;
        const roles = [...(rule.roles || []), ...missing.map((key) => ({ key, permission: true }))];
        // eslint-disable-next-line no-await-in-loop
        await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.RULES, data: [{ _id: rule._id }, { $set: { roles } }] }, 'updateOne');
        granted += missing.length;
    }
    if (granted) removeCache(`rules:${companyId}`);
    return granted;
}

module.exports = {
    TRACKER_PERMISSION,
    TRACKER_RULE_KEYS,
    ROLE_REFUSAL,
    NOT_A_MEMBER,
    seatPolicy,
    seatHolderIds: holderIds,
    trackerAccessFor,
    answerTrackerRefusal,
    releaseTrackerSeat,
    releaseSeatsWithoutAccess,
    releaseSeatsLater,
    syncTrackerCount,
    grantTrackerToNewRoles,
};
