const crypto = require('crypto');
const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { ACTIVE_SEAT } = require('../../Config/seatStatus');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { recordAudit } = require('../Audit/recorder');

const PURPOSE = Object.freeze({ ACTIVATION: 'activation', LOGIN: 'login' });
const ACTIVATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LOGIN_TTL_MS = 60 * 1000;
const PLATFORM_ACTOR = Object.freeze({ actorId: 'platform', actorName: 'AlianHub Cloud' });
const OBJECT_ID = /^[a-f0-9]{24}$/i;

const globalDb = (type, data, method) => MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type, data }, method);
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const hashOf = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
const webUrl = () => String(process.env.WEBURL || '').replace(/\/+$/, '');
const notFound = (message) => Object.assign(new Error(message), { statusCode: 404 });
const badRequest = (message, code) => Object.assign(new Error(message), { statusCode: 400, code });

/* One live token per purpose and account: issuing a new one revokes the last. Only its sha256 is kept. */
async function issueOneTimeToken(userId, purpose, ttlMs, now = Date.now()) {
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(now + ttlMs);
    await globalDb(SCHEMA_TYPE.USER_AUTH, [{ _id: oid(userId) }, { $set: { [`oneTimeTokens.${purpose}`]: { hash: hashOf(token), expiresAt } } }], 'updateOne');
    return { token, expiresAt };
}

const liveTokenFilter = (token, purpose, now) => ({ [`oneTimeTokens.${purpose}.hash`]: hashOf(token), [`oneTimeTokens.${purpose}.expiresAt`]: { $gt: new Date(now) } });

/* The match and the clearing are one write, so two clicks on one link cannot both get in. */
async function consumeOneTimeToken(token, purpose, now = Date.now()) {
    if (!token || typeof token !== 'string') return null;
    const auth = await globalDb(SCHEMA_TYPE.USER_AUTH, [liveTokenFilter(token, purpose, now), { $unset: { [`oneTimeTokens.${purpose}`]: 1 } }], 'findOneAndUpdate');
    return auth && auth._id ? String(auth._id) : null;
}

async function peekOneTimeToken(token, purpose, now = Date.now()) {
    if (!token || typeof token !== 'string') return null;
    const auth = await globalDb(SCHEMA_TYPE.USER_AUTH, [liveTokenFilter(token, purpose, now), { _id: 1 }], 'findOne');
    return auth && auth._id ? String(auth._id) : null;
}

const findUser = (filter, fields) => globalDb(SCHEMA_TYPE.USERS, [filter, fields], 'findOne');

/* The account that holds instance ownership; the support account never does. */
const findOwner = () => globalDb(SCHEMA_TYPE.USERS, [{ isProductOwner: true, isSupportUser: { $ne: true } }, { Employee_Email: 1, Employee_Name: 1, AssignCompany: 1, activationPending: 1 }, { sort: { createdAt: 1 }, limit: 1 }], 'find')
    .then((rows) => (rows && rows[0]) || null);

async function ownerFor(email) {
    const owner = await findOwner();
    if (!owner) throw notFound('This instance has no owner yet.');
    if (email && String(email).trim().toLowerCase() !== String(owner.Employee_Email || '').toLowerCase()) throw badRequest('That address is not the instance owner.', 'not_owner');
    return owner;
}

async function activationLink({ email } = {}, now = Date.now()) {
    const owner = await ownerFor(email);
    const { token, expiresAt } = await issueOneTimeToken(owner._id, PURPOSE.ACTIVATION, ACTIVATION_TTL_MS, now);
    return { userId: String(owner._id), activationUrl: `${webUrl()}/#/activate?token=${token}`, activationExpiresAt: expiresAt };
}

const twoFactorOn = async (userId) => {
    const auth = await globalDb(SCHEMA_TYPE.USER_AUTH, [{ _id: oid(userId) }, { twoFactor: 1 }], 'findOne');
    return Boolean(auth && auth.twoFactor && auth.twoFactor.enabled);
};

/* The link lands on /platform-login, which exchanges it; with two-factor on the exchange refuses and
 * that page opens the normal login with the address filled in. */
async function signInLink(userId, now = Date.now()) {
    const { token, expiresAt } = await issueOneTimeToken(userId, PURPOSE.LOGIN, LOGIN_TTL_MS, now);
    return { userId: String(userId), loginUrl: `${webUrl()}/#/platform-login?token=${token}`, expiresAt, twoFactor: await twoFactorOn(userId) };
}

async function ownerLoginLink(now = Date.now()) {
    const owner = await ownerFor();
    return signInLink(owner._id, now);
}

const companiesOf = (user) => [...new Set(((user && user.AssignCompany) || []).map(String))].filter((id) => OBJECT_ID.test(id));

const auditIn = (companyIds, entry) => companyIds.forEach((companyId) => recordAudit(companyId, { ...PLATFORM_ACTOR, ...entry }));

async function holdsActiveSeat(user) {
    for (const companyId of companiesOf(user)) {
        const seat = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.COMPANY_USERS, data: [{ ...ACTIVE_SEAT, userId: String(user._id), isSupportUser: { $ne: true } }, { _id: 1 }] }, 'findOne').catch(() => null);
        if (seat) return true;
    }
    return false;
}

/* Instance ownership opens the Instance console; it moves only to someone already working here. */
async function transferOwnership({ toEmail } = {}) {
    const email = String(toEmail || '').trim().toLowerCase();
    if (!email) throw badRequest('toEmail is required.', 'invalid');
    const target = await findUser({ Employee_Email: email, isSupportUser: { $ne: true } }, { Employee_Email: 1, Employee_Name: 1, AssignCompany: 1, isProductOwner: 1 });
    if (!target || !(await holdsActiveSeat(target))) throw badRequest('That address holds no active seat on this instance.', 'not_member');
    const previous = await findOwner();
    if (previous && String(previous._id) === String(target._id)) return { userId: String(target._id), previousUserId: String(target._id), changed: false };
    await globalDb(SCHEMA_TYPE.USERS, [{ _id: oid(target._id) }, { $set: { isProductOwner: true } }], 'updateOne');
    if (previous) await globalDb(SCHEMA_TYPE.USERS, [{ _id: oid(previous._id) }, { $set: { isProductOwner: false } }], 'updateOne');
    const meta = { from: previous ? String(previous.Employee_Email || '') : '', to: email };
    auditIn(companiesOf(target), { action: 'platform.owner_transferred', entityType: 'user', entityId: String(target._id), entityName: target.Employee_Name || email, meta });
    if (previous) auditIn(companiesOf(previous), { action: 'platform.owner_transferred', entityType: 'user', entityId: String(previous._id), entityName: previous.Employee_Name || '', meta });
    return { userId: String(target._id), previousUserId: previous ? String(previous._id) : null, changed: true };
}

module.exports = {
    PURPOSE, ACTIVATION_TTL_MS, LOGIN_TTL_MS, PLATFORM_ACTOR, hashOf,
    issueOneTimeToken, consumeOneTimeToken, peekOneTimeToken, findOwner, activationLink, signInLink, ownerLoginLink, twoFactorOn,
    transferOwnership, companiesOf, auditIn,
};
