const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { dbCollections } = require('../../Config/collections');
const { Notification_key: { CONNECTOR_BROKEN } } = require('../../Config/notificationKey');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const socketEmitter = require('../../event/socketEventEmitter');
const logger = require('../../Config/loggerConfig');
const { textHtml } = require('../Template/emailText');
const connections = require('./resolveConnection');
const usage = require('./usage');

// Not a project notification: the row names this scope where a project id would go, as the AI alerts do.
const NOTICE_SCOPE = 'connectors';

let uniqueSeq = 0;
const uniqueId = () => `${Date.now().toString(36)}${(uniqueSeq += 1).toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/* recordHealth arrives with task 066; until then no connection exists, so no call reaches this point outside tests.
 * Bookkeeping that fails must never fail the call it records. */
const record = async (companyId, connectionId, fields) => {
    if (!connections.recordHealth) return;
    try {
        await connections.recordHealth({ companyId: String(companyId), connectionId: String(connectionId), ...fields });
    } catch (e) {
        logger.error(`connector health of ${connectionId} was not saved: ${(e && e.name) || 'Error'}`);
    }
};

const noteUse = (companyId, connectionId) => record(companyId, connectionId, { lastUsedAt: new Date(), lastError: '' });

/* Only the code is kept: a provider's message can echo the request it answers. */
const noteFailure = (companyId, connectionId, code) => record(companyId, connectionId, { lastUsedAt: new Date(), lastError: String(code || 'error') });

const toldToday = async (companyId, userId, provider) => Boolean(await MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.NOTIFICATIONS,
    data: [{ key: CONNECTOR_BROKEN, receiverID: String(userId), 'changeData.provider': provider, createdAt: { $gte: new Date(`${usage.dayOf()}T00:00:00.000Z`) } }, { _id: 1 }],
}, 'findOne'));

const rowOf = (companyId, userId, provider, name) => ({
    key: CONNECTOR_BROKEN, type: NOTICE_SCOPE, changeType: CONNECTOR_BROKEN,
    message: textHtml(`${name} is no longer accepting your connection. Reconnect it on My connections.`),
    changeData: { provider, name },
    projectId: NOTICE_SCOPE, taskId: '', userId: NOTICE_SCOPE, companyId: String(companyId),
    assigneeUsers: [String(userId)], notSeen: [String(userId)], receiverID: String(userId),
    notificationType: 'push', isSchedule: false, isSeen: false, notificationStatus: 'in-process', uniqueId: uniqueId(),
});

/* Every call on a broken connection lands here, so the person is told once a day, not once a call. The same three
 * writes as any in-app notification: the company row, the global copy with its socket event, and the bell counter. */
const tellBroken = async (companyId, userId, provider, name) => {
    try {
        if (await toldToday(companyId, userId, provider)) return;
        const row = rowOf(companyId, userId, provider, name);
        const saved = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.NOTIFICATIONS, collection: dbCollections.NOTIFICATIONS, data: row }, 'save');
        const globalRow = await MongoDbCrudOpration(dbCollections.GLOBAL, { type: dbCollections.NOTIFICATIONS, collection: dbCollections.NOTIFICATIONS, data: { ...row, notificationId: saved && (saved.id || saved._id) } }, 'save');
        socketEmitter.emit('insert', { type: 'insert', data: globalRow, updatedFields: {}, module: 'globalNotification' });
        const { updateUnReadCommentsCountFun } = require('../notification-count/controller');
        await updateUnReadCommentsCountFun({ body: { companyId: String(companyId), key: 5, userIds: [String(userId)], readAll: false } });
    } catch (e) {
        logger.warn(`connector notice for ${provider} was not delivered: ${(e && e.name) || 'Error'}`);
    }
};

module.exports = { noteUse, noteFailure, tellBroken };
