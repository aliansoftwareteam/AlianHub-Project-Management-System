// Inbox — the header bell and the @ mention dropdown on one page, plus snooze and clear.
//
// Reads the same rows those two read. Every write is filtered to the caller's own rows:
// a notification by its receiverID, a mention by the reader's id in mentionIds (or in
// clearedFor, once cleared), with the caller always taken from req.uid.
const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const { updateUnReadCommentsCountFun } = require('../notification-count/controller');
const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
const R = require('./helpers/inboxRules');
const S = require('./helpers/inboxState');

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

// Notices rendered from their values through i18n rather than from message (Inbox.vue renderNotice).
const STRUCTURED_CHANGES = ['agent_alert', 'agent_session_assigned', 'oauth_client_approval'];

const fail = (res, statusText) => res.send({ status: false, statusText });

/**
 * The bell's notifications: addressed to this user, not a mention row (those come from the
 * mentions collection instead, counting both would double every mention), push/null type
 * only. `notSeen` holds the recipients who have NOT read it, so membership is unread.
 */
// No `skip`: paging happens on the merged list, never inside a source. See list().
const readNotifications = async (companyId, userId, { limit, sort, match }) => {
    const dir = R.sortDirection(sort);
    const query = [
        { $match: match || R.notificationMatch(userId, { tab: 'all' }) },
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
        changeType: String(r.changeType || ''),
        changeData: STRUCTURED_CHANGES.includes(r.changeType) && r.changeData && typeof r.changeData === 'object' ? r.changeData : undefined,
        // Rows an agent wrote carry an agent type or key; a person never does.
        agent: String(r.type || '').toLowerCase() === 'agent' || /^agent[_-]/i.test(String(r.key || '')),
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
        snoozedUntil: r.snoozedUntil || null,
        snoozeUntilChange: !!r.snoozeUntilChange,
        clearedAt: r.clearedAt || null,
        createdAt: r.createdAt,
    }));
};

const entryFor = (list, userId) => (Array.isArray(list) ? list.filter((e) => e && String(e.userId) === userId).pop() : null) || null;

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
const readMentions = async (companyId, userId, { limit, sort, match }) => {
    const filter = match || R.mentionMatch(userId, { tab: 'all' });

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
        ...mentionStateFor(r, userId),
        createdAt: r.createdAt,
    }));
};

const mentionStateFor = (r, userId) => {
    const snooze = entryFor(r.snoozes, userId);
    const cleared = entryFor(r.clearedFor, userId);
    return {
        snoozedUntil: (snooze && snooze.until) || null,
        snoozeUntilChange: !!(snooze && snooze.untilChange),
        clearedAt: (cleared && cleared.at) || null,
    };
};

/**
 * Time-off requests waiting on this user. Only an owner or admin can decide
 * them (Modules/Pto), so nobody else sees them; a person's own request is
 * never something they approve.
 */
/* Pending agent proposals (Modules/Agents). The handoff puts "asking permission" in
 * this Inbox; until now they lived only under AI › Inbox and the owner never saw them. */
const readProposals = async (companyId, userId) => {
    try {
        const roleType = await getRoleType(companyId, userId);
        if (!isPrivileged(roleType)) return [];
        const rows = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AGENT_PROPOSALS,
            data: [{ status: 'pending' }, {}, { sort: { createdAt: -1 }, limit: 20 }],
        }, 'find');
        return (rows || []).map((r) => ({
            sourceType: 'proposal',
            sourceId: String(r._id),
            proposalId: String(r._id),
            kind: 'proposal',
            agentName: r.agentName || 'Agent',
            agentId: r.agentId ? String(r.agentId) : '',
            what: r.what || '',
            why: r.why || '',
            changes: Array.isArray(r.changes) ? r.changes.length : 0,
            cost: r.cost || null,
            gate: r.gate || null,
            taskId: r.taskId ? String(r.taskId) : '',
            projectId: r.projectId ? String(r.projectId) : '',
            createdAt: r.createdAt,
            unread: true,
        }));
    } catch (e) {
        logger.error(`${LOG_PREFIX} readProposals: ${e.message}`);
        return [];
    }
};

const readApprovals = async (companyId, userId) => {
    try {
        const roleType = await getRoleType(companyId, userId);
        if (!isPrivileged(roleType)) return [];
        const rows = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PTO_ENTRIES,
            data: [
                { status: 'pending', deletedStatusKey: { $ne: 1 }, userId: { $ne: userId } },
                {},
                { sort: { createdAt: -1 }, limit: 20 },
            ],
        }, 'find');
        return (rows || []).map((r) => ({
            sourceType: 'approval',
            sourceId: String(r._id),
            key: 'pto_request',
            approvalType: 'pto',
            ptoType: String(r.type || ''),
            startDate: r.startDate,
            endDate: r.endDate,
            reason: String(r.reason || ''),
            actorId: String(r.userId || ''),
            unread: true,
            createdAt: r.createdAt,
        }));
    } catch (e) {
        logger.error(`${LOG_PREFIX} approval read failed: ${e.message}`);
        return [];
    }
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
        const kind = R.normalizeKind(req.query.kind);
        const limit = R.normalizeLimit(req.query.limit);
        const skip = R.normalizeSkip(req.query.skip);
        const sort = R.normalizeSort(req.query.sort);
        const plan = R.planFor(tab, source, kind);
        const now = new Date();
        await S.wakeDue(companyId, userId, now);
        const scope = { tab, source, kind, now };

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
        const wantApprovals = tab === 'primary' && skip === 0 && (kind === 'all' || kind === 'approval');
        const [notifications, mentions, approvals, proposals] = await Promise.all([
            plan.notifications && kind !== 'approval' ? readNotifications(companyId, userId, { sort, limit: probe, match: R.notificationMatch(userId, scope) }) : [],
            plan.mentions && kind !== 'approval' ? readMentions(companyId, userId, { sort, limit: probe, match: R.mentionMatch(userId, scope) }) : [],
            wantApprovals ? readApprovals(companyId, userId) : [],
            wantApprovals ? readProposals(companyId, userId) : [],
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
            i.kind = R.kindOf(i);
        }
        for (const a of approvals) a.kind = 'approval';

        return res.send({
            status: true,
            data: {
                tab,
                source,
                kind,
                sort,
                items: page,
                approvals,
                proposals,
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

        const now = new Date();
        await S.wakeDue(companyId, userId, now);
        const notificationGroup = {
            key: '$key',
            taskId: '$taskId',
            message: '$message',
            at: { $dateTrunc: { date: '$createdAt', unit: 'second' } },
        };
        const mentionGroup = {
            taskId: '$taskId',
            message: '$comment_message',
            at: { $dateTrunc: { date: '$createdAt', unit: 'second' } },
        };
        const [notifications, mentions, other, laterNotifications, laterMentions, approvals, proposals, nextWakeAt] = await Promise.all([
            count(SCHEMA_TYPE.NOTIFICATIONS, R.notificationMatch(userId, { tab: 'primary', now }), notificationGroup),
            count(SCHEMA_TYPE.MENTIONS, R.mentionMatch(userId, { tab: 'primary', now }), mentionGroup),
            count(SCHEMA_TYPE.NOTIFICATIONS, R.notificationMatch(userId, { tab: 'other', now }), notificationGroup),
            count(SCHEMA_TYPE.NOTIFICATIONS, R.notificationMatch(userId, { tab: 'later', now }), notificationGroup),
            count(SCHEMA_TYPE.MENTIONS, R.mentionMatch(userId, { tab: 'later', now }), mentionGroup),
            readApprovals(companyId, userId).then((rows) => rows.length),
            readProposals(companyId, userId).then((rows) => rows.length),
            S.nextWakeAt(companyId, userId, now),
        ]);

        return res.send({
            status: true,
            data: {
                all: notifications + mentions,
                notifications,
                mentions,
                // Archive is read rows; a badge there would count things already dealt with.
                archive: 0,
                // Done and Cleared hold rows already dealt with, so they carry no badge.
                primary: notifications + mentions + approvals + proposals,
                other,
                approvals,
                proposals,
                later: laterNotifications + laterMentions,
                done: 0,
                cleared: 0,
                nextWakeAt: nextWakeAt ? nextWakeAt.toISOString() : null,
                // The client times its re-check from this, not its own clock, which may be off.
                now: now.toISOString(),
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
 * POST /api/v1/inbox/read-all — marks the unread rows of one tab read. Other stays unread
 * when Primary is marked, and the reverse, so the counter moves by the rows it read.
 */
exports.markAllRead = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const userId = userOf(req);
        if (!companyId || !userId) return fail(res, 'companyId and an authenticated user are required.');

        const tab = R.normalizeTab(req.body && req.body.tab);
        if (['archive', 'done', 'later', 'cleared'].includes(tab)) return fail(res, 'Those are already read.');
        const plan = R.planFor(tab);
        const now = new Date();

        if (plan.notifications) {
            const read = await S.write(companyId, SCHEMA_TYPE.NOTIFICATIONS, 'updateMany',
                R.notificationMatch(userId, { tab, now }),
                { $set: { notificationStatus: 'completed' }, $pull: { notSeen: userId } });
            await S.moveCounter(companyId, userId, 'notification', -read);
        }
        if (plan.mentions) {
            const read = await S.write(companyId, SCHEMA_TYPE.MENTIONS, 'updateMany',
                R.mentionMatch(userId, { tab, now }),
                { $pull: { notSeen: userId } });
            await S.moveCounter(companyId, userId, 'mention', -read);
        }
        return res.send({ status: true, statusText: 'Marked all as read.', data: { tab } });
    } catch (e) {
        logger.error(`${LOG_PREFIX} markAllRead: ${e.message}`);
        return fail(res, e.message);
    }
};

const PURGE_MS = R.CLEARED_RETENTION_SECONDS * 1000;
const UNSNOOZE = { snoozedUntil: '', snoozeUntilChange: '' };
const withUnread = (filter, userId) => ({ ...filter, notSeen: userId });
const withRead = (filter, userId) => ({ ...filter, notSeen: { $ne: userId } });

/**
 * Applies one change to a row, moving the unread counter when the change reads or unreads it.
 * `toRead` is tried first on the row while unread (counter -1), `toUnread` on the row while
 * read (counter +1); `plain` covers the row in whatever state is left.
 */
const changeRow = async (companyId, userId, sourceType, filter, { toRead, toUnread, plain }) => {
    const type = sourceType === 'notification' ? SCHEMA_TYPE.NOTIFICATIONS : SCHEMA_TYPE.MENTIONS;
    if (toRead && await S.write(companyId, type, 'updateOne', withUnread(filter, userId), toRead)) {
        await S.moveCounter(companyId, userId, sourceType, -1);
        return true;
    }
    if (toUnread && await S.write(companyId, type, 'updateOne', withRead(filter, userId), toUnread)) {
        await S.moveCounter(companyId, userId, sourceType, 1);
        return true;
    }
    return !!(plain && await S.write(companyId, type, 'updateOne', filter, plain));
};

const eachItem = (name, perItem) => async (req, res) => {
    try {
        const companyId = companyOf(req);
        const userId = userOf(req);
        if (!companyId || !userId) return fail(res, 'companyId and an authenticated user are required.');
        const items = readItemList(req);
        if (!items.length) return fail(res, 'No inbox items were given.');
        const prepared = perItem.prepare ? perItem.prepare(req.body || {}, new Date()) : { ok: true };
        if (!prepared.ok) return fail(res, prepared.error);

        let count = 0;
        for (const item of items) {
            const id = oid(item.sourceId);
            if (!id) continue;
            const run = item.sourceType === 'notification' ? perItem.notification : perItem.mention;
            if (await run({ companyId, userId, id, now: new Date(), ...prepared })) count++;
        }
        return res.send({ status: true, data: { count } });
    } catch (e) {
        logger.error(`${LOG_PREFIX} ${name}: ${e.message}`);
        return fail(res, e.message);
    }
};

const wantsUnread = (body) => String(body.unread) !== 'false';

/** POST /api/v1/inbox/snooze — into Later until a time, or until the item changes. Read while it waits. */
exports.snooze = eachItem('snooze', {
    prepare: (body, now) => R.parseSnooze(body, now),
    notification: ({ companyId, userId, id, until, untilChange }) => {
        const set = untilChange
            ? { $set: { snoozeUntilChange: true }, $unset: { snoozedUntil: '' } }
            : { $set: { snoozedUntil: until, snoozeUntilChange: false } };
        return changeRow(companyId, userId, 'notification', { _id: id, receiverID: userId, clearedAt: null }, {
            toRead: { ...set, $pull: { notSeen: userId } },
            plain: set,
        });
    },
    mention: async ({ companyId, userId, id, until, untilChange }) => {
        const filter = { _id: id, mentionIds: userId };
        await S.write(companyId, SCHEMA_TYPE.MENTIONS, 'updateOne', filter, { $pull: { snoozes: { userId } } });
        const push = { $push: { snoozes: { userId, until, untilChange } } };
        return changeRow(companyId, userId, 'mention', filter, {
            toRead: { ...push, $pull: { notSeen: userId } },
            plain: push,
        });
    },
});

/** POST /api/v1/inbox/unsnooze — back to Primary, unread unless `unread: false`. */
exports.unsnooze = eachItem('unsnooze', {
    prepare: (body) => ({ ok: true, unread: wantsUnread(body) }),
    notification: ({ companyId, userId, id, unread }) => {
        const filter = { _id: id, receiverID: userId, clearedAt: null, $or: [{ snoozedUntil: { $ne: null } }, { snoozeUntilChange: true }] };
        const unset = { $unset: UNSNOOZE };
        return changeRow(companyId, userId, 'notification', filter, {
            toUnread: unread ? { ...unset, $addToSet: { notSeen: userId } } : null,
            plain: unset,
        });
    },
    mention: ({ companyId, userId, id, unread }) => {
        const filter = { _id: id, mentionIds: userId, 'snoozes.userId': userId };
        const pull = { $pull: { snoozes: { userId } } };
        return changeRow(companyId, userId, 'mention', filter, {
            toUnread: unread ? { ...pull, $addToSet: { notSeen: userId } } : null,
            plain: pull,
        });
    },
});

// A mention nobody reads any more is deleted by the TTL index on purgeAt.
const schedulePurge = (companyId, userId, filter, now) => S.write(companyId, SCHEMA_TYPE.MENTIONS, 'updateMany',
    { ...filter, mentionIds: { $size: 0 }, 'clearedFor.userId': userId, purgeAt: null },
    { $set: { purgeAt: new Date(now.getTime() + PURGE_MS) } });

/** POST /api/v1/inbox/clear — into Cleared for 30 days, then purged. */
exports.clear = eachItem('clear', {
    notification: ({ companyId, userId, id, now }) => {
        const set = { $set: { clearedAt: now }, $unset: UNSNOOZE };
        return changeRow(companyId, userId, 'notification', { _id: id, receiverID: userId, clearedAt: null }, {
            toRead: { ...set, $pull: { notSeen: userId } },
            plain: set,
        });
    },
    mention: async ({ companyId, userId, id, now }) => {
        const cleared = await changeRow(companyId, userId, 'mention', { _id: id, mentionIds: userId }, {
            toRead: { $pull: { mentionIds: userId, notSeen: userId, snoozes: { userId } }, $push: { clearedFor: { userId, at: now } } },
            plain: { $pull: { mentionIds: userId, snoozes: { userId } }, $push: { clearedFor: { userId, at: now } } },
        });
        if (cleared) await schedulePurge(companyId, userId, { _id: id }, now);
        return cleared;
    },
});

/** POST /api/v1/inbox/restore — out of Cleared, back to Primary unread unless `unread: false`. */
exports.restore = eachItem('restore', {
    prepare: (body) => ({ ok: true, unread: wantsUnread(body) }),
    notification: ({ companyId, userId, id, now, unread }) => {
        const unset = { $unset: { clearedAt: '' } };
        return changeRow(companyId, userId, 'notification', { _id: id, receiverID: userId, clearedAt: { $gte: R.clearedCutoff(now) } }, {
            toUnread: unread ? { ...unset, $addToSet: { notSeen: userId } } : null,
            plain: unset,
        });
    },
    mention: ({ companyId, userId, id, now, unread }) => {
        const filter = { _id: id, clearedFor: { $elemMatch: { userId, at: { $gte: R.clearedCutoff(now) } } } };
        const back = { $pull: { clearedFor: { userId } }, $unset: { purgeAt: '' } };
        return changeRow(companyId, userId, 'mention', filter, {
            toUnread: unread ? { ...back, $addToSet: { mentionIds: userId, notSeen: userId } } : null,
            plain: { ...back, $addToSet: { mentionIds: userId } },
        });
    },
});

/** POST /api/v1/inbox/clear-all — clears every row of one tab (narrowed by kind) for the caller. */
exports.clearAll = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const userId = userOf(req);
        if (!companyId || !userId) return fail(res, 'companyId and an authenticated user are required.');
        const tab = String((req.body && req.body.tab) || '');
        if (!R.CLEARABLE_TABS.includes(tab)) return fail(res, 'That tab cannot be cleared.');
        const kind = R.normalizeKind(req.body && req.body.kind);
        if (kind === 'approval') return res.send({ status: true, data: { count: 0 } });

        const now = new Date();
        const plan = R.planFor(tab, 'all', kind);
        const scope = { tab, kind, now };
        let count = 0;

        if (plan.notifications) {
            const match = R.notificationMatch(userId, scope);
            const set = { $set: { clearedAt: now }, $unset: UNSNOOZE };
            const unread = await S.write(companyId, SCHEMA_TYPE.NOTIFICATIONS, 'updateMany',
                { $and: [...match.$and, { notSeen: { $in: [userId] } }] },
                { ...set, $pull: { notSeen: userId } });
            await S.moveCounter(companyId, userId, 'notification', -unread);
            count += unread + await S.write(companyId, SCHEMA_TYPE.NOTIFICATIONS, 'updateMany', match, set);
        }
        if (plan.mentions) {
            const match = R.mentionMatch(userId, scope);
            const push = { $push: { clearedFor: { userId, at: now } } };
            const unread = await S.write(companyId, SCHEMA_TYPE.MENTIONS, 'updateMany',
                { $and: [...match.$and, { notSeen: { $in: [userId] } }] },
                { ...push, $pull: { mentionIds: userId, notSeen: userId, snoozes: { userId } } });
            await S.moveCounter(companyId, userId, 'mention', -unread);
            count += unread + await S.write(companyId, SCHEMA_TYPE.MENTIONS, 'updateMany', match,
                { ...push, $pull: { mentionIds: userId, snoozes: { userId } } });
            await schedulePurge(companyId, userId, {}, now);
        }
        return res.send({ status: true, statusText: 'Cleared.', data: { tab, count } });
    } catch (e) {
        logger.error(`${LOG_PREFIX} clearAll: ${e.message}`);
        return fail(res, e.message);
    }
};

exports.__internals = { readItemList, readProposals, readNotifications };
