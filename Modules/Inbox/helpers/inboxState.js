// Snoozed rows are marked read while they wait, so the header's unread dot does not count
// them; waking one makes it unread again and moves the counter back up.
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const logger = require('../../../Config/loggerConfig');
const counter = require('../../notification-count/controller');

const LOG_PREFIX = '[inbox]';
const COUNT_FIELD = { notification: 'notification_counts', mention: 'mention_counts' };

const matchedOf = (result) => Number((result && (result.matchedCount !== undefined ? result.matchedCount : result.n)) || 0);

const moveCounter = (companyId, userId, sourceType, delta) => new Promise((resolve) => {
    const field = COUNT_FIELD[sourceType];
    if (!field || !delta) return resolve();
    try {
        counter.updateCount(companyId, [userId], { $inc: { [field]: delta } }, () => {
            if (delta > 0) return resolve();
            // The same clean-up mark-read runs, so a counter that drifted below zero is cleared.
            counter.updateMentionCount(companyId, [userId], field, () => resolve());
        });
    } catch (e) {
        logger.error(`${LOG_PREFIX} unread count move failed (${sourceType}): ${e.message}`);
        resolve();
    }
});

const write = (companyId, type, method, filter, update) => MongoDbCrudOpration(companyId, { type, data: [filter, update] }, method)
    .then(matchedOf)
    .catch((e) => {
        logger.error(`${LOG_PREFIX} ${method} on ${type} failed: ${e.message}`);
        return 0;
    });

const NOTIFICATION_UNSNOOZE = { $unset: { snoozedUntil: '', snoozeUntilChange: '' } };

// A row someone marked unread while it was snoozed is woken without being counted twice.
const wakeNotifications = async (companyId, userId, filter) => {
    const woke = await write(companyId, SCHEMA_TYPE.NOTIFICATIONS, 'updateMany',
        { ...filter, notSeen: { $ne: userId } },
        { ...NOTIFICATION_UNSNOOZE, $addToSet: { notSeen: userId } });
    await write(companyId, SCHEMA_TYPE.NOTIFICATIONS, 'updateMany', filter, NOTIFICATION_UNSNOOZE);
    await moveCounter(companyId, userId, 'notification', woke);
    return woke;
};

const wakeMentions = async (companyId, userId, filter) => {
    const pull = { $pull: { snoozes: { userId } } };
    const woke = await write(companyId, SCHEMA_TYPE.MENTIONS, 'updateMany',
        { ...filter, notSeen: { $ne: userId } },
        { ...pull, $addToSet: { notSeen: userId } });
    await write(companyId, SCHEMA_TYPE.MENTIONS, 'updateMany', filter, pull);
    await moveCounter(companyId, userId, 'mention', woke);
    return woke;
};

/** Brings back the reader's snoozes whose time has come. Run before every Inbox read, so no cron is needed. */
const wakeDue = async (companyId, userId, now = new Date()) => {
    if (!companyId || !userId) return 0;
    const [notifications, mentions] = await Promise.all([
        wakeNotifications(companyId, userId, { receiverID: userId, snoozedUntil: { $lte: now }, snoozeUntilChange: { $ne: true } }),
        wakeMentions(companyId, userId, { snoozes: { $elemMatch: { userId, untilChange: { $ne: true }, until: { $lte: now } } } }),
    ]);
    return notifications + mentions;
};

/** New activity on a task brings back the reader's "until it changes" snoozes on it. */
const wakeOnActivity = async (companyId, userId, taskId) => {
    if (!companyId || !userId || !taskId) return 0;
    const task = String(taskId);
    const [notifications, mentions] = await Promise.all([
        wakeNotifications(companyId, String(userId), { receiverID: String(userId), taskId: task, snoozeUntilChange: true }),
        wakeMentions(companyId, String(userId), { taskId: task, snoozes: { $elemMatch: { userId: String(userId), untilChange: true } } }),
    ]);
    return notifications + mentions;
};

module.exports = { matchedOf, moveCounter, write, wakeDue, wakeOnActivity };
