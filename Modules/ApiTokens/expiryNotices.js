const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { dbCollections } = require('../../Config/collections');
const { ACTIVE_SEAT } = require('../../Config/seatStatus');
const { Notification_key: { CREDENTIAL_EXPIRING } } = require('../../Config/notificationKey');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const socketEmitter = require('../../event/socketEventEmitter');
const logger = require('../../Config/loggerConfig');
const { textHtml } = require('../Template/emailText');
const oauthConfig = require('../OAuthServer/config');
const oauthStore = require('../OAuthServer/store');
const { EXPIRY_NOTICE_DAYS, expiryNoticeDue } = require('./helpers/apiTokenRules');

const CHANGE_TYPE = CREDENTIAL_EXPIRING;
// Not a project notification: the row names this scope where a project id would go, as the AI alerts do.
const NOTICE_SCOPE = 'credentials';
const KIND = Object.freeze({ TOKEN: 'token', CONNECTION: 'connection' });
const DAY_MS = 24 * 60 * 60 * 1000;
const NAME_MAX = 200;
const COMPANY_CONCURRENCY = 5;
const LOG_PREFIX = '[credential-expiry]';
// The hash and the prefix are never read: a notice is written from the label alone.
const TOKEN_FIELDS = { name: 1, userId: 1, active: 1, expiresAt: 1, createdAt: 1, renewedAt: 1, expiryNoticeAt: 1 };

const windowEnd = (now) => new Date(now.getTime() + EXPIRY_NOTICE_DAYS * DAY_MS);
const ymd = (date) => new Date(date).toISOString().slice(0, 10);

let uniqueSeq = 0;
const uniqueId = () => `${Date.now().toString(36)}${(uniqueSeq += 1).toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/* The Inbox renders the row from changeData through i18n; the message is what a client that does not know the row shows. */
const messageOf = ({ kind, name, expiresAt }) => textHtml(kind === KIND.TOKEN
    ? `Your token "${name}" ends on ${ymd(expiresAt)}. Renew it under AI, Accounts to keep its settings and get a new secret.`
    : `The access you gave "${name}" ends on ${ymd(expiresAt)}. Connect it again from the app to keep it.`);

const rowOf = (companyId, credential) => ({
    key: CREDENTIAL_EXPIRING, type: NOTICE_SCOPE, changeType: CHANGE_TYPE,
    message: messageOf(credential),
    changeData: { kind: credential.kind, name: credential.name, [credential.kind === KIND.TOKEN ? 'tokenId' : 'grantId']: credential.id, expiresAt: new Date(credential.expiresAt) },
    projectId: NOTICE_SCOPE, taskId: '', userId: NOTICE_SCOPE, companyId: String(companyId),
    assigneeUsers: [credential.userId], notSeen: [credential.userId], receiverID: credential.userId,
    notificationType: 'push', isSchedule: false, isSeen: false, notificationStatus: 'in-process', uniqueId: uniqueId(),
});

/* The same three writes as any in-app notification: the company row, the global copy with its socket event, and the
 * bell counter. The Inbox reads the company row, so only a failure to write that one counts as not told. */
const deliver = async (companyId, credential) => {
    const row = rowOf(companyId, credential);
    const saved = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.NOTIFICATIONS, collection: dbCollections.NOTIFICATIONS, data: row }, 'save');
    try {
        const globalRow = await MongoDbCrudOpration(dbCollections.GLOBAL, { type: dbCollections.NOTIFICATIONS, collection: dbCollections.NOTIFICATIONS, data: { ...row, notificationId: saved && (saved.id || saved._id) } }, 'save');
        socketEmitter.emit('insert', { type: 'insert', data: globalRow, updatedFields: {}, module: 'globalNotification' });
        const { updateUnReadCommentsCountFun } = require('../notification-count/controller');
        await updateUnReadCommentsCountFun({ body: { companyId: String(companyId), key: 5, userIds: [credential.userId], readAll: false } });
    } catch (error) {
        logger.warn(`${LOG_PREFIX} ${companyId}: the bell was not updated for ${credential.kind} ${credential.id}: ${error.message || error}`);
    }
};

const holdsSeat = async (companyId, userId) => Boolean(await MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.COMPANY_USERS, data: [{ userId: String(userId), ...ACTIVE_SEAT }, { userId: 1 }],
}, 'findOne'));

/* The mark is taken before the notice is written, so two servers running the job cannot both tell; it is given back
 * only when nothing was written. */
const tellOnce = async (companyId, credential, { claim, release }) => {
    try {
        if (!(await holdsSeat(companyId, credential.userId)) || !(await claim())) return false;
        try {
            await deliver(companyId, credential);
            return true;
        } catch (error) {
            await release().catch(() => {});
            throw error;
        }
    } catch (error) {
        logger.error(`${LOG_PREFIX} ${companyId}: the owner of ${credential.kind} ${credential.id} was not told: ${error.message || error}`);
        return false;
    }
};

const unmarked = (token) => ({ _id: token._id, active: true, expiryNoticeAt: null, expiresAt: new Date(token.expiresAt) });

const tokenNotices = async (companyId, now) => {
    const tokens = (await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.API_TOKENS,
        data: [{ active: true, expiryNoticeAt: null, expiresAt: { $gt: now, $lte: windowEnd(now) } }, TOKEN_FIELDS],
    }, 'find')) || [];
    let told = 0;
    for (const token of tokens.filter((row) => expiryNoticeDue(row, now))) {
        const credential = { kind: KIND.TOKEN, id: String(token._id), name: String(token.name || '').slice(0, NAME_MAX), userId: String(token.userId), expiresAt: token.expiresAt };
        // eslint-disable-next-line no-await-in-loop
        if (await tellOnce(companyId, credential, {
            claim: () => MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.API_TOKENS, data: [unmarked(token), { $set: { expiryNoticeAt: now } }, { projection: TOKEN_FIELDS }] }, 'findOneAndUpdate'),
            release: () => MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.API_TOKENS, data: [{ _id: token._id, expiryNoticeAt: now }, { $unset: { expiryNoticeAt: '' } }] }, 'updateOne'),
        })) told += 1;
    }
    return told;
};

/* A metadata document client has no row of its own; the workspace's approval remembers its name. */
const clientNameOf = async (grant) => {
    const approval = await oauthStore.approvals.find(grant.companyId, grant.clientId).catch(() => null);
    if (approval && approval.clientName) return approval.clientName;
    const client = await oauthStore.clients.find(grant.clientId).catch(() => null);
    return (client && client.name) || grant.clientId;
};

const connectionNotices = async (companyId, now) => {
    if (!oauthConfig.isOn()) return 0;
    let told = 0;
    for (const grant of await oauthStore.grants.endingFor(companyId, now, windowEnd(now))) {
        // eslint-disable-next-line no-await-in-loop
        const credential = { kind: KIND.CONNECTION, id: grant.grantId, name: String(await clientNameOf(grant)).slice(0, NAME_MAX), userId: String(grant.userId), expiresAt: grant.expiresAt };
        // eslint-disable-next-line no-await-in-loop
        if (await tellOnce(companyId, credential, {
            claim: () => oauthStore.grants.markExpiryNotice(grant.grantId, companyId, now),
            release: () => oauthStore.grants.unmarkExpiryNotice(grant.grantId, companyId, now),
        })) told += 1;
    }
    return told;
};

const runForCompany = async (companyId, now = new Date()) => {
    const results = await Promise.allSettled([tokenNotices(companyId, now), connectionNotices(companyId, now)]);
    results.filter((result) => result.status === 'rejected').forEach((result) => logger.error(`${LOG_PREFIX} ${companyId}: ${result.reason && result.reason.message ? result.reason.message : result.reason}`));
    return results.reduce((sum, result) => sum + (result.status === 'fulfilled' ? result.value : 0), 0);
};

const runForAllCompanies = async (now = new Date()) => {
    const companies = (await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type: SCHEMA_TYPE.COMPANIES, data: [{}, '_id'] }, 'find')) || [];
    let told = 0;
    for (let i = 0; i < companies.length; i += COMPANY_CONCURRENCY) {
        // eslint-disable-next-line no-await-in-loop
        const counts = await Promise.all(companies.slice(i, i + COMPANY_CONCURRENCY).map((company) => runForCompany(String(company._id), now)));
        told += counts.reduce((sum, n) => sum + n, 0);
    }
    return told;
};

module.exports = { CHANGE_TYPE, NOTICE_SCOPE, KIND, runForCompany, runForAllCompanies };
