const { randomUUID } = require('crypto');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { ACTIVE_SEAT } = require('../../../Config/seatStatus');
const { ROLE_OWNER, ROLE_ADMIN } = require('../../../Config/roleTypes');
const logger = require('../../../Config/loggerConfig');

/* Notices that name no project or task, which the shared notification helper does not take: a company row, its
 * global copy with the socket event the bell listens for, and the bell counter. `scope` stands where a project id
 * would go. The Inbox renders each `changeType` from an i18n string and `changeData`, so names travel there as text. */

const ownersAndAdmins = async (companyId) => {
    const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
    const rows = await MongoDbCrudOpration(String(companyId), {
        type: SCHEMA_TYPE.COMPANY_USERS, data: [{ roleType: { $in: [ROLE_OWNER, ROLE_ADMIN] }, ...ACTIVE_SEAT }, { userId: 1 }],
    }, 'find').catch(() => []);
    return [...new Set((rows || []).map((row) => String(row.userId)).filter(Boolean))];
};

const sendNotice = async (companyId, recipients, { key, type, message, changeData, scope, from, label = 'notice' }) => {
    const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
    const { dbCollections } = require('../../../Config/collections');
    const now = new Date();
    for (const receiverID of [...new Set((recipients || []).map(String).filter(Boolean))]) {
        const row = {
            key, type, changeType: key, message, changeData: changeData || {},
            projectId: scope, taskId: '', userId: String(from || ''), companyId: String(companyId),
            assigneeUsers: [receiverID], notSeen: [receiverID], receiverID, uniqueId: randomUUID(),
            notificationType: 'push', isSchedule: false, isSeen: false, notificationStatus: 'in-process', createdAt: now, updatedAt: now,
        };
        try {
            // eslint-disable-next-line no-await-in-loop
            const saved = await MongoDbCrudOpration(String(companyId), { type: SCHEMA_TYPE.NOTIFICATIONS, collection: dbCollections.NOTIFICATIONS, data: row }, 'save');
            // eslint-disable-next-line no-await-in-loop
            const globalRow = await MongoDbCrudOpration(dbCollections.GLOBAL, { type: dbCollections.NOTIFICATIONS, collection: dbCollections.NOTIFICATIONS, data: { ...row, notificationId: saved && (saved.id || saved._id) } }, 'save');
            require('../../../event/socketEventEmitter').emit('insert', { type: 'insert', data: globalRow, updatedFields: {}, module: 'globalNotification' });
            const { updateUnReadCommentsCountFun } = require('../../notification-count/controller');
            // eslint-disable-next-line no-await-in-loop
            await Promise.resolve(updateUnReadCommentsCountFun({ body: { companyId: String(companyId), key: 5, userIds: [receiverID], readAll: false } }))
                .catch((error) => logger.warn(`${label}: notification count for ${receiverID} not bumped: ${error.message || error}`));
        } catch (error) {
            logger.error(`${label}: notification for ${companyId} to ${receiverID} failed: ${error.message || error}`);
        }
    }
};

module.exports = { ownersAndAdmins, sendNotice };
