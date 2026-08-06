// Inbox — the header bell and the @ mention dropdown, on one page.
//
// Purpose, and the whole design constraint: once this is live, those two dropdowns get
// hidden. So it must do what they do — no more. The reads below are the SAME queries
// app-notification/controller.js runs, and the only write is the same mark-read.
//
// It owns no collection and no state. Deleting this module would leave the existing
// sidebars behaving identically, because nothing here reaches into them.
const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const { Notification_key } = require('../../Config/notificationKey.js');
const R = require('./helpers/inboxRules');

const LOG_PREFIX = '[inbox]';

const companyOf = (req) => String(req.headers.companyid || req.headers.companyId || '');
// From the JWT middleware, never from the request body — a userId a caller can choose is
// a userId a caller can use to read someone else's inbox.
const userOf = (req) => String(req.uid || '');

const oid = (id) => { try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return null; } };

const fail = (res, statusText) => res.send({ status: false, statusText });

/**
 * The bell's notifications.
 *
 * Match copied verbatim from getNotificationMessages: addressed to this user, not a
 * mention row (those come from the mentions collection instead — counting them from both
 * would double every mention), push/null type only. `notSeen` holds the recipients who
 * have NOT read it, so membership is unread and absence is archived.
 */
const readNotifications = async (companyId, userId, { limit, skip, read }) => {
    const query = [
        {
            $match: {
                $and: [
                    { assigneeUsers: { $in: [userId] } },
                    { key: { $ne: Notification_key.COMMENTS_IM_MENTIONS_IN } },
                    { $or: [{ notificationType: 'push' }, { notificationType: null }] },
                    { receiverID: userId },
                    read ? { notSeen: { $nin: [userId] } } : { notSeen: { $in: [userId] } },
                ],
            },
        },
        { $sort: { createdAt: -1, _id: 1 } },
        { $skip: skip },
        { $limit: limit },
    ];
    const rows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.NOTIFICATIONS,
        data: [query],
    }, 'aggregate').catch((e) => {
        logger.error(`${LOG_PREFIX} notification read failed: ${e.message}`);
        return [];
    });
    return (rows || []).map((r) => ({
        sourceType: 'notification',
        sourceId: String(r._id),
        key: r.key || '',
        message: R.cleanMessage(r.message),
        taskId: String(r.taskId || ''),
        projectId: String(r.projectId || ''),
        sprintId: String(r.sprintId || ''),
        folderId: String(r.folderId || ''),
        actorName: r.Employee_Name || r.User_Employee_Name || '',
        actorImage: r.Employee_profileImage || r.User_Employee_profileImage || '',
        unread: Array.isArray(r.notSeen) && r.notSeen.map(String).includes(userId),
        createdAt: r.createdAt,
    }));
};

/** The @ dropdown's mentions — the same `mentionIds` filter it uses. */
const readMentions = async (companyId, userId, { limit, skip, read }) => {
    const filter = { mentionIds: { $in: [userId] } };
    if (read) filter.notSeen = { $nin: [userId] };

    const rows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.MENTIONS,
        data: [filter, {}, { sort: { createdAt: -1 }, limit, skip }],
    }, 'find').catch((e) => {
        logger.error(`${LOG_PREFIX} mention read failed: ${e.message}`);
        return [];
    });
    return (rows || []).map((r) => ({
        sourceType: 'mention',
        sourceId: String(r._id),
        key: 'mention',
        // A mention can be an attachment with no text, so the filename stands in —
        // otherwise the row renders blank and looks broken.
        message: R.cleanMessage(r.comment_message || r.comment_reply_message || r.comment_mediaName || ''),
        taskId: String(r.taskId || ''),
        projectId: String(r.projectId || ''),
        sprintId: String(r.sprintId || ''),
        folderId: String(r.folderId || ''),
        actorName: '',
        actorImage: '',
        unread: Array.isArray(r.notSeen) && r.notSeen.map(String).includes(userId),
        createdAt: r.createdAt,
    }));
};

/** Task names for the rows on this page — the sources carry an id but no title. */
const readTaskNames = async (companyId, items) => {
    const ids = [...new Set(items.map((i) => i.taskId).filter(Boolean))].map(oid).filter(Boolean);
    if (!ids.length) return new Map();
    const rows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS,
        data: [{ _id: { $in: ids } }, { TaskName: 1 }],
    }, 'find').catch((e) => {
        logger.error(`${LOG_PREFIX} task name read failed: ${e.message}`);
        return [];
    });
    return new Map((rows || []).map((r) => [String(r._id), String(r.TaskName || '')]));
};

/**
 * GET /api/v1/inbox — one tab, newest first.
 *
 * A flat list, exactly as the sidebars show it. Both sources are read at the page size
 * and merged, so a page can hold up to 2×limit before trimming — the alternative is
 * interleaving two cursors, which is a lot of machinery for a dropdown replacement.
 */
exports.list = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const userId = userOf(req);
        if (!companyId || !userId) return fail(res, 'companyId and an authenticated user are required.');

        const tab = R.normalizeTab(req.query.tab);
        const limit = R.normalizeLimit(req.query.limit);
        const skip = R.normalizeSkip(req.query.skip);
        const plan = R.planFor(tab);
        const now = new Date();

        const [notifications, mentions] = await Promise.all([
            plan.notifications ? readNotifications(companyId, userId, { limit, skip, read: plan.read }) : [],
            plan.mentions ? readMentions(companyId, userId, { limit, skip, read: plan.read }) : [],
        ]);

        const merged = R.dedupeItems([...notifications, ...mentions])
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        const page = merged.slice(0, limit);

        const names = await readTaskNames(companyId, page);
        for (const i of page) {
            i.taskName = names.get(i.taskId) || '';
            i.dateGroup = R.dateGroupOf(i.createdAt, now);
        }

        return res.send({
            status: true,
            data: {
                tab,
                items: page,
                // Either source returning a full page means there is more behind it.
                hasMore: notifications.length >= limit || mentions.length >= limit,
                nextSkip: skip + limit,
            },
        });
    } catch (e) {
        logger.error(`${LOG_PREFIX} list: ${e.message}`);
        return fail(res, e.message);
    }
};

/**
 * GET /api/v1/inbox/counts — the unread number per tab.
 *
 * Counted with countDocuments rather than by fetching rows, because a badge only needs
 * the number and the sidebars already show these same totals.
 */
exports.counts = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const userId = userOf(req);
        if (!companyId || !userId) return fail(res, 'companyId and an authenticated user are required.');

        const count = async (type, filter) => MongoDbCrudOpration(companyId, {
            type, data: [filter],
        }, 'countDocuments').catch((e) => {
            logger.error(`${LOG_PREFIX} count failed: ${e.message}`);
            return 0;
        });

        const [notifications, mentions] = await Promise.all([
            count(SCHEMA_TYPE.NOTIFICATIONS, {
                assigneeUsers: { $in: [userId] },
                key: { $ne: Notification_key.COMMENTS_IM_MENTIONS_IN },
                $or: [{ notificationType: 'push' }, { notificationType: null }],
                receiverID: userId,
                notSeen: { $in: [userId] },
            }),
            count(SCHEMA_TYPE.MENTIONS, { mentionIds: { $in: [userId] }, notSeen: { $in: [userId] } }),
        ]);

        return res.send({
            status: true,
            data: {
                all: notifications + mentions,
                notifications,
                mentions,
                // Archive is read rows; a badge there would count things already dealt with.
                archive: 0,
            },
        });
    } catch (e) {
        logger.error(`${LOG_PREFIX} counts: ${e.message}`);
        return fail(res, e.message);
    }
};

/** The items an action applies to, filtered to the two shapes that exist. */
const readItemList = (req) => {
    const raw = Array.isArray(req.body && req.body.items) ? req.body.items : [];
    return raw
        .map((i) => ({
            sourceType: String((i && i.sourceType) || ''),
            sourceId: String((i && i.sourceId) || ''),
        }))
        .filter((i) => ['notification', 'mention'].includes(i.sourceType) && i.sourceId);
};

/**
 * POST /api/v1/inbox/read — mark items read, or unread.
 *
 * Byte-for-byte the write app-notification's updateMarkRead performs. Anything else here
 * would desync the header bell's count from this page.
 */
exports.markRead = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const userId = userOf(req);
        if (!companyId || !userId) return fail(res, 'companyId and an authenticated user are required.');

        const items = readItemList(req);
        if (!items.length) return fail(res, 'No inbox items were given.');

        const read = String(req.body.read) !== 'false';
        let done = 0;
        for (const item of items) {
            const id = oid(item.sourceId);
            if (!id) continue;
            const isNotification = item.sourceType === 'notification';
            const patch = read
                ? (isNotification
                    ? { $set: { notificationStatus: 'completed' }, $pull: { notSeen: userId } }
                    : { $pull: { notSeen: userId } })
                : { $addToSet: { notSeen: userId } };
            await MongoDbCrudOpration(companyId, {
                type: isNotification ? SCHEMA_TYPE.NOTIFICATIONS : SCHEMA_TYPE.MENTIONS,
                data: [{ _id: id }, patch],
            }, 'updateOne').catch((e) => {
                logger.error(`${LOG_PREFIX} mark ${read ? 'read' : 'unread'} ${item.sourceId}: ${e.message}`);
                return null;
            });
            done++;
        }
        return res.send({
            status: true,
            statusText: read ? 'Marked as read.' : 'Marked as unread.',
            data: { count: done },
        });
    } catch (e) {
        logger.error(`${LOG_PREFIX} markRead: ${e.message}`);
        return fail(res, e.message);
    }
};

/**
 * POST /api/v1/inbox/read-all — the sidebars' "Mark all as read".
 *
 * One updateMany per source rather than a loop, and scoped to the tab so marking all on
 * Mentions cannot silently clear the notification list too.
 */
exports.markAllRead = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const userId = userOf(req);
        if (!companyId || !userId) return fail(res, 'companyId and an authenticated user are required.');

        const tab = R.normalizeTab(req.body && req.body.tab);
        if (tab === 'archive') return fail(res, 'Those are already read.');
        const plan = R.planFor(tab);

        if (plan.notifications) {
            await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.NOTIFICATIONS,
                data: [
                    {
                        assigneeUsers: { $in: [userId] },
                        key: { $ne: Notification_key.COMMENTS_IM_MENTIONS_IN },
                        receiverID: userId,
                        notSeen: { $in: [userId] },
                    },
                    { $set: { notificationStatus: 'completed' }, $pull: { notSeen: userId } },
                ],
            }, 'updateMany');
        }
        if (plan.mentions) {
            await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.MENTIONS,
                data: [
                    { mentionIds: { $in: [userId] }, notSeen: { $in: [userId] } },
                    { $pull: { notSeen: userId } },
                ],
            }, 'updateMany');
        }
        return res.send({ status: true, statusText: 'Marked all as read.', data: { tab } });
    } catch (e) {
        logger.error(`${LOG_PREFIX} markAllRead: ${e.message}`);
        return fail(res, e.message);
    }
};

exports.__internals = { readItemList };
