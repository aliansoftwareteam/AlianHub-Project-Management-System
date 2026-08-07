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
const { updateUnReadCommentsCountFun } = require('../notification-count/controller');
const R = require('./helpers/inboxRules');

// The per-user counters document behind the header's red dot. `key` selects the field:
// 5 is notification_counts, 4 is mention_counts.
const COUNT_KEY = { notification: 5, mention: 4 };

const LOG_PREFIX = '[inbox]';

const companyOf = (req) => String(req.headers.companyid || req.headers.companyId || '');
// From the JWT middleware, never from the request body — a userId a caller can choose is
// a userId a caller can use to read someone else's inbox.
const userOf = (req) => String(req.uid || '');

const oid = (id) => { try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return null; } };

/**
 * An id for the route payload: stringified when present, ABSENT when absent.
 *
 * Not `String(x || '')`. openRoute spreads these straight into route params, and Vue Router
 * treats a missing param and an empty one differently — so a row with no sprint (a general
 * reminder) has to produce the same object the sidebar produces from the raw document, or
 * the two navigate differently from identical data.
 */
const routeId = (v) => (v === undefined || v === null ? undefined : String(v));

const fail = (res, statusText) => res.send({ status: false, statusText });

/**
 * The bell's notifications.
 *
 * Match copied verbatim from getNotificationMessages: addressed to this user, not a
 * mention row (those come from the mentions collection instead — counting them from both
 * would double every mention), push/null type only. `notSeen` holds the recipients who
 * have NOT read it, so membership is unread and absence is archived.
 */
// No `skip`: paging happens on the merged list, never inside a source. See list().
const readNotifications = async (companyId, userId, { limit, read, sort }) => {
    const dir = R.sortDirection(sort);
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
        { $sort: { createdAt: dir, _id: 1 } },
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
        taskId: routeId(r.taskId),
        projectId: routeId(r.projectId),
        sprintId: routeId(r.sprintId),
        folderId: routeId(r.folderId),
        // Forwarded under their SOURCE names for openRoute (Header/helper.js) — the same
        // function the bell already navigates with. It reads the raw row, so renaming
        // anything here would silently send the click somewhere else.
        //
        // `Key` is the capitalised one it branches on for the TimeLog and project-create
        // routes. It is passed through exactly as stored, which on every row in this
        // database is absent — those branches are dead for the bell too, and making them
        // live here would be a behaviour change, not parity.
        type: String(r.type || ''),
        Key: r.Key,
        companyId: String(r.companyId || ''),
        // WHO did this, as an id — resolved to a name and picture on the client through
        // getUser(), exactly as the bell dropdown does it.
        //
        // NOT the Employee_* / User_Employee_* fields stored on the row. Those are
        // denormalised copies written at send time and they do not hold the actor: rows
        // written by one person were rendering with the reader's own photo. The live
        // company-user record is the only place the right face comes from, and it also
        // stays right when someone changes their picture.
        actorId: String(r.userId || ''),
        unread: Array.isArray(r.notSeen) && r.notSeen.map(String).includes(userId),
        createdAt: r.createdAt,
    }));
};

/**
 * The @ dropdown's mentions — the same `mentionIds` filter it uses, plus a read filter.
 *
 * The read filter is the one thing here that the @ sidebar does NOT do: getMentionsMessages
 * has no `notSeen` clause at all, so it lists read and unread together. That is fine for a
 * dropdown with no archive, but wrong here — the Inbox has an explicit Archive tab, so a
 * read mention showing on both Mentions and Archive is the same row in two places, and the
 * unread badge then disagrees with the list beside it (a count of 1 above six rows).
 *
 * Mirroring readNotifications instead: membership in `notSeen` is unread, absence is
 * archived.
 */
const readMentions = async (companyId, userId, { limit, read, sort }) => {
    const filter = {
        mentionIds: { $in: [userId] },
        notSeen: read ? { $nin: [userId] } : { $in: [userId] },
    };

    const rows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.MENTIONS,
        data: [filter, {}, { sort: { createdAt: R.sortDirection(sort) }, limit }],
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
        taskId: routeId(r.taskId),
        projectId: routeId(r.projectId),
        sprintId: routeId(r.sprintId),
        folderId: routeId(r.folderId),
        // Same contract as above, for the mention half of openRoute:
        //   comment_id → the #hash that scrolls the task to THAT comment
        //   mainChat   → this mention came from a chat channel, not a task, so it opens
        //                the channel instead. Without it a channel mention opens a task.
        type: String(r.type || ''),
        comment_id: String(r.comment_id || ''),
        mainChat: !!r.mainChat,
        // The commenter. A mention row carries no denormalised name at all, which is why
        // the @ dropdown resolves this id too rather than reading the row.
        actorId: String(r.userId || ''),
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
        // Narrows Archive to one kind. Ignored on the tabs that already are one kind.
        const source = R.normalizeSource(req.query.source);
        const limit = R.normalizeLimit(req.query.limit);
        const skip = R.normalizeSkip(req.query.skip);
        const sort = R.normalizeSort(req.query.sort);
        const plan = R.planFor(tab, source);
        const now = new Date();

        // Each source is read from the TOP through the end of the requested page, not from
        // `skip`. Skipping inside each source loses rows: page 1 fetches 10 of each, merges
        // 20 and shows the best 10 — so 10 already-fetched rows lost the merge. Page 2 then
        // skips past those same 10 in each source, and they are never shown at all.
        //
        // Re-reading the head of each source per page is the cost of merging two cursors,
        // and at a 10-row page in a dropdown replacement it is not a real cost.
        //
        // One row past the window is read but never shown: it is what makes hasMore exact.
        // Asking for exactly the window cannot tell "there are more" from "that was the
        // last one", so a source whose total lands on the window boundary leaves a Load
        // more button that adds nothing when clicked.
        const window = skip + limit;
        const probe = window + 1;
        const [notifications, mentions] = await Promise.all([
            plan.notifications ? readNotifications(companyId, userId, { limit: probe, read: plan.read, sort }) : [],
            plan.mentions ? readMentions(companyId, userId, { limit: probe, read: plan.read, sort }) : [],
        ]);

        // The two sources arrive already sorted; this only re-orders the merge of them,
        // and it must land on the SAME order the queries used.
        //
        // `a - b`, not `b - a`. `dir` is the Mongo direction (-1 for newest first), so
        // multiplying it into a comparator that is itself written descending flips the sign
        // twice and sorts ascending — the archive listed June above August, and because the
        // page was sliced from the head while the fetch window grew toward older rows, every
        // "Load more" re-served the same ten rows.
        const dir = R.sortDirection(sort);
        const merged = R.dedupeItems([...notifications, ...mentions])
            .sort((a, b) => dir * (new Date(a.createdAt) - new Date(b.createdAt)));
        const page = merged.slice(skip, window);

        const names = await readTaskNames(companyId, page);
        for (const i of page) {
            i.taskName = names.get(i.taskId) || '';
            i.dateGroup = R.dateGroupOf(i.createdAt, now);
        }

        return res.send({
            status: true,
            data: {
                tab,
                source,
                sort,
                items: page,
                // Two ways there is more: the merge itself has rows past this page, or a
                // source handed back the probe row and so still has rows behind it.
                hasMore: merged.length > window
                    || notifications.length > window
                    || mentions.length > window,
                nextSkip: window,
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

        /**
         * Counted with $group, not countDocuments.
         *
         * The source collections contain duplicate rows — one comment can produce two
         * mention records — and the list already collapses them on read. A plain count
         * would say 2 next to a list showing 1, which reads as the list being broken.
         * Grouping on the same fields the read-time dedupe uses keeps the two agreed.
         */
        const count = async (type, match, keyFields) => {
            const rows = await MongoDbCrudOpration(companyId, {
                type,
                data: [[
                    { $match: match },
                    { $group: { _id: keyFields } },
                    { $count: 'n' },
                ]],
            }, 'aggregate').catch((e) => {
                logger.error(`${LOG_PREFIX} count failed: ${e.message}`);
                return [];
            });
            return (rows && rows[0] && rows[0].n) || 0;
        };

        const [notifications, mentions] = await Promise.all([
            count(SCHEMA_TYPE.NOTIFICATIONS, {
                assigneeUsers: { $in: [userId] },
                key: { $ne: Notification_key.COMMENTS_IM_MENTIONS_IN },
                $or: [{ notificationType: 'push' }, { notificationType: null }],
                receiverID: userId,
                notSeen: { $in: [userId] },
            }, {
                key: '$key',
                taskId: '$taskId',
                message: '$message',
                at: { $dateTrunc: { date: '$createdAt', unit: 'second' } },
            }),
            count(SCHEMA_TYPE.MENTIONS, {
                mentionIds: { $in: [userId] },
                notSeen: { $in: [userId] },
            }, {
                taskId: '$taskId',
                message: '$comment_message',
                at: { $dateTrunc: { date: '$createdAt', unit: 'second' } },
            }),
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

/**
 * Adjust the unread counter the header's red dot reads.
 *
 * Pulling `notSeen` marks the ROW read; it does not touch the counters document, which is
 * a separate per-user record kept live over a socket. Marking something read in the inbox
 * without this left the dot lit with nothing unread behind it.
 *
 * Exactly what the header dropdown does after its own mark-read (Header.vue), just called
 * server-side so it cannot be skipped: readAll clears the field, otherwise ±1 per row.
 * Best-effort — a counter that fails to move must not fail the read itself.
 */
const bumpCount = async (companyId, userId, sourceType, { read, readAll }) => {
    const key = COUNT_KEY[sourceType];
    if (!key) return;
    try {
        await updateUnReadCommentsCountFun({
            headers: { companyid: companyId },
            body: { companyId, key, userIds: [userId], readAll: !!readAll, read: !!read },
        });
    } catch (e) {
        logger.error(`${LOG_PREFIX} unread count update failed (${sourceType}): ${(e && (e.statusText || e.message)) || e}`);
    }
};

/** The items an action applies to, filtered to the two shapes that exist. */
const readItemList = (req) => {
    const raw = Array.isArray(req.body && req.body.items) ? req.body.items : [];
    const out = [];
    for (const i of raw) {
        const sourceType = String((i && i.sourceType) || '');
        if (!['notification', 'mention'].includes(sourceType)) continue;
        // The row the user clicked, plus every duplicate collapsed into it. One comment
        // can produce two rows; marking only the visible one read leaves its twin unread
        // and the mention never clears.
        const ids = [String((i && i.sourceId) || ''), ...(Array.isArray(i && i.duplicateIds) ? i.duplicateIds : [])];
        for (const sourceId of ids) {
            if (sourceId) out.push({ sourceType, sourceId: String(sourceId) });
        }
    }
    return out;
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
            // The state test lives in the FILTER, so the update only matches a row that
            // is actually changing.
            //
            // `modifiedCount` cannot be used for this: every schema here declares
            // `timestamps: true`, so Mongoose adds `updatedAt` to each update and the
            // document always counts as modified — a second mark-read reports 1 exactly
            // like the first. `matchedCount` is not affected by that, so it is the only
            // honest signal, and it costs no extra read.
            const filter = read
                ? { _id: id, notSeen: userId }
                : { _id: id, notSeen: { $ne: userId } };

            const wrote = await MongoDbCrudOpration(companyId, {
                type: isNotification ? SCHEMA_TYPE.NOTIFICATIONS : SCHEMA_TYPE.MENTIONS,
                data: [filter, patch],
            }, 'updateOne').catch((e) => {
                logger.error(`${LOG_PREFIX} mark ${read ? 'read' : 'unread'} ${item.sourceId}: ${e.message}`);
                return null;
            });
            // Nothing matched ⇒ the row was already in that state. Moving the counter
            // anyway is what drives it below zero and leaves the dot stuck.
            if (!wrote || Number(wrote.matchedCount) === 0) continue;

            await bumpCount(companyId, userId, item.sourceType, { read, readAll: false });
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
            // readAll clears the counter outright rather than decrementing per row —
            // nothing is left unread, so the exact previous number does not matter.
            await bumpCount(companyId, userId, 'notification', { read: true, readAll: true });
        }
        if (plan.mentions) {
            await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.MENTIONS,
                data: [
                    { mentionIds: { $in: [userId] }, notSeen: { $in: [userId] } },
                    { $pull: { notSeen: userId } },
                ],
            }, 'updateMany');
            await bumpCount(companyId, userId, 'mention', { read: true, readAll: true });
        }
        return res.send({ status: true, statusText: 'Marked all as read.', data: { tab } });
    } catch (e) {
        logger.error(`${LOG_PREFIX} markAllRead: ${e.message}`);
        return fail(res, e.message);
    }
};

exports.__internals = { readItemList };
