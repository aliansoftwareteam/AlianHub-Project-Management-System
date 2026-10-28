const mongoose = require('mongoose');
const hostingMode = require('../../Config/hostingMode');
const logger = require('../../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { SEAT_ACTIVE } = require('../../Config/seatStatus');
const { ROLE_ADMIN } = require('../../Config/roleTypes');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { removeCache } = require('../../utils/commonFunctions');
const { STATE_IDS, readState, writeState } = require('./platformState');
const { PURPOSE, signInLink, auditIn } = require('./ownerLinks');

const SUPPORT_EMAIL = 'support@alianhub.com';
const SUPPORT_NAME = 'AlianHub Support';
const MAX_SESSION_MS = 24 * 60 * 60 * 1000;
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const globalDb = (type, data, method) => MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type, data }, method);
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const conflict = (message) => Object.assign(new Error(message), { statusCode: 409 });

let active = null;
let timer = null;

const isLive = (session, now = Date.now()) => Boolean(session && session.userId && !session.endedAt && new Date(session.expiresAt).getTime() > now);

const isSupportSessionLive = (userId, now = Date.now()) => isLive(active, now) && String(active.userId) === String(userId);

/* Every audit row the support account writes names the person behind it (Modules/Audit/recorder.js). */
const supportActorLabel = (actorId) => (active && actorId && String(active.userId) === String(actorId) ? `${SUPPORT_NAME} (${active.staffName})` : null);

function validateSupportSession(body = {}, now = Date.now()) {
    const errors = {};
    const staffEmail = String(body.staffEmail || '').trim().toLowerCase();
    const staffName = String(body.staffName || '').trim().slice(0, 80);
    const expiresAt = new Date(body.expiresAt);
    if (!EMAIL_RX.test(staffEmail)) errors.staffEmail = 'invalid';
    if (!staffName) errors.staffName = 'required';
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= now) errors.expiresAt = 'invalid';
    else if (expiresAt.getTime() - now > MAX_SESSION_MS) errors.expiresAt = 'too_far';
    return { valid: !Object.keys(errors).length, errors, data: { staffEmail, staffName, expiresAt } };
}

const liveCompanyIds = async () => ((await globalDb(SCHEMA_TYPE.COMPANIES, [{ deletingAt: { $exists: false } }, { _id: 1 }], 'find')) || []).map((row) => String(row._id));

async function supportAccount() {
    const existing = await globalDb(SCHEMA_TYPE.USERS, [{ Employee_Email: SUPPORT_EMAIL }, { isSupportUser: 1 }], 'findOne');
    if (existing && !existing.isSupportUser) throw conflict(`${SUPPORT_EMAIL} is a customer account on this instance.`);
    if (existing) return String(existing._id);
    const { addUserMongodbV2 } = require('../Auth/controller/createUser');
    const created = await addUserMongodbV2({ firstName: 'AlianHub', lastName: 'Support', email: SUPPORT_EMAIL, password: null, isInvitation: true });
    return String(created.statusText._id);
}

const forgetMembership = (userId, companyId) => {
    removeCache(`company_users:${companyId}`);
    require('../../Config/jwt').invalidateMembershipCache(userId, companyId);
};

async function seatIn(companyId, userId) {
    await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.COMPANY_USERS,
        data: [{ userId }, { $set: { companyId, userId, userEmail: SUPPORT_EMAIL, roleType: ROLE_ADMIN, status: SEAT_ACTIVE, isDelete: false, isSupportUser: true, designation: 0 } }, { upsert: true }],
    }, 'updateOne');
    forgetMembership(userId, companyId);
}

function scheduleEnd(session) {
    clearTimeout(timer);
    timer = null;
    if (!isLive(session)) return;
    const wait = Math.min(new Date(session.expiresAt).getTime() - Date.now(), 2 ** 31 - 1);
    timer = setTimeout(() => endSupportSession({ reason: 'expired' }).catch((error) => logger.error(`[platform] support session end failed: ${error.message}`)), Math.max(0, wait));
    if (timer.unref) timer.unref();
}

const announce = (session) => {
    const { SUPPORT_EVENT, broadcast } = require('../../socket/controller/instanceSocket');
    broadcast(SUPPORT_EVENT, isLive(session) ? { active: true, expiresAt: session.expiresAt } : { active: false });
};

/* Never the owner or a customer: one flagged account, an admin seat in every workspace for the session,
 * and a 60-second sign-in link for the staff member the back office names. */
async function startSupportSession({ staffEmail, staffName, expiresAt }, now = new Date()) {
    const userId = await supportAccount();
    const companyIds = await liveCompanyIds();
    await globalDb(SCHEMA_TYPE.USERS, [{ _id: oid(userId) }, {
        $set: { isSupportUser: true, isActive: true, isEmailVerified: true, Employee_FName: 'AlianHub', Employee_LName: 'Support', Employee_Name: SUPPORT_NAME, AssignCompany: companyIds, supportSession: { staffEmail, staffName, expiresAt, startedAt: now } },
    }], 'updateOne');
    for (const companyId of companyIds) await seatIn(companyId, userId);
    const session = await writeState(STATE_IDS.SUPPORT, { userId, staffEmail, staffName, expiresAt, startedAt: now, endedAt: null, companyIds });
    active = { userId, staffEmail, staffName, expiresAt, startedAt: now, companyIds };
    scheduleEnd(active);
    auditIn(companyIds, { action: 'platform.support_session_started', entityType: 'user', entityId: userId, entityName: SUPPORT_NAME, meta: { staffName, staffEmail, expiresAt } });
    announce(active);
    const link = await signInLink(userId, now.getTime());
    return { userId, expiresAt: session.expiresAt || expiresAt, loginUrl: link.loginUrl, loginExpiresAt: link.expiresAt };
}

async function endSupportSession({ reason = 'ended' } = {}, now = new Date()) {
    const session = active || (await readState(STATE_IDS.SUPPORT));
    clearTimeout(timer);
    timer = null;
    if (!session || !session.userId || session.endedAt) {
        active = null;
        return { ended: false };
    }
    const userId = String(session.userId);
    const companyIds = [...new Set([...(session.companyIds || []), ...(await liveCompanyIds())])];
    for (const companyId of companyIds) {
        await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.COMPANY_USERS, data: [{ userId, isSupportUser: true }] }, 'deleteMany')
            .catch((error) => logger.error(`[platform] support seat in ${companyId} not removed: ${error.message}`));
        forgetMembership(userId, companyId);
    }
    await globalDb(SCHEMA_TYPE.USERS, [{ _id: oid(userId) }, { $set: { AssignCompany: [], isOnline: false }, $unset: { supportSession: 1 } }], 'updateOne');
    await globalDb(SCHEMA_TYPE.USER_AUTH, [{ _id: oid(userId) }, { $unset: { [`oneTimeTokens.${PURPOSE.LOGIN}`]: 1 } }], 'updateOne');
    await globalDb(SCHEMA_TYPE.SESSIONS, [{ userId }], 'deleteMany');
    removeCache(`session:${userId}:`, true);
    await writeState(STATE_IDS.SUPPORT, { endedAt: now, reason });
    auditIn(session.companyIds || companyIds, { action: 'platform.support_session_ended', entityType: 'user', entityId: userId, entityName: SUPPORT_NAME, meta: { staffName: session.staffName || '', reason } });
    active = null;
    announce(null);
    return { ended: true, reason };
}

/* Backstop for the timer: a restart in between, or a clock that jumped. */
async function expireDueSupportSession(now = Date.now()) {
    if (!hostingMode.isManaged()) return { ended: false };
    const session = active || (await readState(STATE_IDS.SUPPORT));
    if (!session || !session.userId || session.endedAt) return { ended: false };
    if (new Date(session.expiresAt).getTime() > now) return { ended: false };
    active = active || session;
    return endSupportSession({ reason: 'expired' });
}

async function loadSupportSession() {
    const session = await readState(STATE_IDS.SUPPORT);
    active = isLive(session) ? { ...session, userId: String(session.userId) } : null;
    scheduleEnd(active);
    if (session && session.userId && !session.endedAt && !active) await expireDueSupportSession();
    return active;
}

const supportAccess = () => (isLive(active)
    ? { active: true, expiresAt: active.expiresAt, staffName: active.staffName, portalUrl: hostingMode.portalUrl() }
    : { active: false, portalUrl: hostingMode.portalUrl() });

module.exports = {
    SUPPORT_EMAIL, SUPPORT_NAME, MAX_SESSION_MS,
    validateSupportSession, startSupportSession, endSupportSession, expireDueSupportSession, loadSupportSession,
    supportActorLabel, isSupportSessionLive, supportAccess,
    _resetForTests: () => { clearTimeout(timer); timer = null; active = null; },
};
