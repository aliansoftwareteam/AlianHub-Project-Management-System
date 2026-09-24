// Inbox — the vocabulary: which rows each tab reads, and the rules for snooze and clear.
//
// Reads the same two sources as the header bell and the @ dropdown (notifications and
// mentions). Snooze and clear state lives on those rows: a notification row belongs to one
// reader (receiverID), so it carries the state directly; a mention row serves every reader
// it names, so it carries the state per reader.
const { Notification_key } = require('../../../Config/notificationKey.js');

const MENTION_KEY = Notification_key.COMMENTS_IM_MENTIONS_IN;

//   all / notifications / mentions / archive — the tabs of the first Inbox, still served
//   primary  — unread, not snoozed, not cleared, and not a watched-only update
//   other    — the same, for updates that reached the reader only because they watch the item
//   later    — snoozed rows, until their time comes (or, for "until it changes", new activity)
//   done     — read rows
//   cleared  — rows the reader cleared in the last 30 days
const TABS = Object.freeze(['all', 'notifications', 'mentions', 'archive', 'primary', 'other', 'later', 'done', 'cleared']);
const INBOX_TABS = Object.freeze(['primary', 'other', 'later', 'done', 'cleared']);
const CLEARABLE_TABS = Object.freeze(['primary', 'other', 'later', 'done']);

const DAY_MS = 24 * 60 * 60 * 1000;
const CLEARED_RETENTION_SECONDS = 30 * 24 * 60 * 60;
const clearedCutoff = (now = new Date()) => new Date(now.getTime() - CLEARED_RETENTION_SECONDS * 1000);
const MAX_SNOOZE_MS = 366 * DAY_MS;

const WATCHING = 'watching';
const DIRECT = 'direct';
const reasonFor = (receiverId, directUsers) => {
    if (!Array.isArray(directUsers)) return undefined;
    return directUsers.map(String).includes(String(receiverId)) ? DIRECT : WATCHING;
};

const parseSnooze = (body = {}, now = new Date()) => {
    if (body.untilChange === true || body.untilChange === 'true') return { ok: true, until: null, untilChange: true };
    if (body.until === undefined || body.until === null || body.until === '') {
        return { ok: false, error: 'A snooze needs a time, or "until it changes".' };
    }
    const until = new Date(body.until);
    if (Number.isNaN(until.getTime())) return { ok: false, error: 'That snooze time could not be read.' };
    if (until <= now) return { ok: false, error: 'Pick a snooze time in the future.' };
    if (until.getTime() - now.getTime() > MAX_SNOOZE_MS) return { ok: false, error: 'A snooze can last up to a year.' };
    return { ok: true, until, untilChange: false };
};

// Row kinds the client can filter on. A reminder is a notification the reminder
// scheduler wrote on its due date; everything else from that source is an update.
const KINDS = Object.freeze(['all', 'mention', 'reminder', 'update', 'approval']);
const REMINDER_KEY = 'general_reminder';
const normalizeKind = (kind) => (KINDS.includes(String(kind)) ? String(kind) : 'all');
const kindOf = (item = {}) => {
    if (item.sourceType === 'approval') return 'approval';
    if (item.sourceType === 'mention') return 'mention';
    return item.key === REMINDER_KEY ? 'reminder' : 'update';
};

// The two sidebars both page 10 at a time; matching that keeps the feel identical.
const PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;

// Newest first is the default because an inbox is read from the top. Oldest first is for
// working through a backlog in the order it arrived.
const SORTS = Object.freeze(['newest', 'oldest']);
const normalizeSort = (sort) => (SORTS.includes(String(sort)) ? String(sort) : 'newest');

// Mongo direction for a sort name. Applied in the QUERY, not just to the merged page —
// sorting a newest-first page ascending afterwards would show the newest items in
// reverse, which is not the same thing as the oldest items.
const sortDirection = (sort) => (normalizeSort(sort) === 'oldest' ? 1 : -1);

/**
 * Message text, safe to render.
 *
 * The stored HTML has two problems, both pre-existing and both visible in the sidebars
 * today:
 *
 *   1. 259 notification messages embed an <img> whose URL was written into a `v-if`
 *      attribute instead of `src` — a Vue directive leaked into stored HTML — so the tag
 *      can only ever render as a broken image. They are 10px priority icons, so every
 *      <img> is dropped rather than shown broken.
 *   2. Any tag could carry a script or an event handler, and this is rendered with
 *      v-html. Only inline emphasis survives; everything else is unwrapped to its text.
 *
 * Display-only. The source rows are never modified.
 */
// Inline only. `<p>` is deliberately NOT here even though every message is wrapped in
// one: it is a block element with default margins, and an inbox row is a single
// fixed-height line. Unwrapping it keeps the row on its baseline.
const ALLOWED_TAGS = ['b', 'strong', 'i', 'em', 'span'];

/**
 * The `style` attribute is KEPT, but only these properties survive.
 *
 * Status and priority values render as coloured chips — `<span style="background-color:
 * #6473e835; color:#6473e8; padding: 0 5px; border-radius:5px">In Progress</span>` — and
 * that is the whole visual language of these messages. Stripping every attribute for
 * safety turned them into flat prose and lost the meaning the colour carried.
 *
 * These seven properties can only paint. Nothing here can load a resource, escape its
 * box, or cover the page: no position, no url(), no behavior/expression.
 */
const ALLOWED_STYLE_PROPS = [
    'background-color', 'background', 'color',
    'padding', 'padding-left', 'padding-right',
    'border-radius', 'font-weight',
];

const cleanStyle = (css) => String(css || '')
    .split(';')
    .map((decl) => {
        const at = decl.indexOf(':');
        if (at < 0) return '';
        const prop = decl.slice(0, at).trim().toLowerCase();
        const value = decl.slice(at + 1).trim();
        if (!ALLOWED_STYLE_PROPS.includes(prop)) return '';
        // Colours arrive as #rgb, #rrggbbaa and `rgb(236 238 255)`; sizes as `5px`. A
        // value containing anything that could fetch or execute is dropped whole rather
        // than patched, because a partially-cleaned value is the one that gets through.
        if (/url\s*\(|expression\s*\(|javascript:|[<>\\"']/i.test(value)) return '';
        if (!/^[#a-z0-9 ,.()%-]+$/i.test(value)) return '';
        return `${prop}:${value}`;
    })
    .filter(Boolean)
    .join(';');

const cleanMessage = (raw) => String(raw == null ? '' : raw)
    .replace(/<(script|style|iframe|object|embed)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<(img|br|hr|input|source)\b[^>]*>/gi, ' ')
    .replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (m, rawTag, attrs) => {
        const tag = String(rawTag).toLowerCase();
        if (!ALLOWED_TAGS.includes(tag)) return '';
        if (m.startsWith('</')) return `</${tag}>`;
        // Every attribute is dropped except a sanitised style — which is where the
        // leaked `v-if` directive and the presigned URLs live.
        const style = /style\s*=\s*["']([^"']*)["']/i.exec(attrs || '');
        const safe = style ? cleanStyle(style[1]) : '';
        return safe ? `<${tag} style="${safe}">` : `<${tag}>`;
    })
    .replace(/\s{2,}/g, ' ')
    .trim();

/**
 * A key identifying the same event written twice.
 *
 * The source collections contain real duplicates — 1478 notification groups share a key,
 * task, recipient and second — which is why the @ sidebar shows every mention twice
 * today. The Inbox collapses them on read rather than touching those collections.
 */
const dedupeKeyOf = (item = {}) => [
    item.sourceType,
    item.key || '',
    item.taskId || '',
    String(item.message || '').slice(0, 120),
    new Date(item.createdAt).toISOString().slice(0, 19),
].join('|');

/**
 * Collapse duplicates, but keep the ids of the rows collapsed away.
 *
 * Dropping them outright is not enough. One comment can produce two mention rows, both
 * carrying this user in `notSeen`. If the surviving row alone is marked read, its twin
 * stays unread — the badge counts it again and the mention never clears, no matter how
 * many times it is clicked.
 *
 * So every action carries `duplicateIds` too, and mark-read applies to all of them. The
 * user acts on one row and the whole event is dealt with, which is what they mean.
 */
const dedupeItems = (items = []) => {
    const byKey = new Map();
    for (const i of items) {
        const k = dedupeKeyOf(i);
        const kept = byKey.get(k);
        if (!kept) {
            byKey.set(k, { ...i, duplicateIds: [] });
            continue;
        }
        kept.duplicateIds.push(i.sourceId);
        // A row is unread if ANY of its copies is unread, or marking one read would look
        // like it worked while the badge kept counting the other.
        if (i.unread) kept.unread = true;
    }
    return [...byKey.values()];
};

/** Today / Yesterday / month, in the viewer's own timezone. */
const dateGroupOf = (iso, now = new Date()) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const days = Math.round((startOf(now) - startOf(d)) / 86400000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (d.getFullYear() === now.getFullYear()) return d.toLocaleString('en-US', { month: 'long' });
    return `${d.toLocaleString('en-US', { month: 'long' })} ${d.getFullYear()}`;
};

const normalizeTab = (tab) => (TABS.includes(String(tab)) ? String(tab) : 'all');

// Archive holds both kinds at once, so it is the one tab that needs narrowing. A separate
// parameter rather than more tab keys: the tabs decide READ state, this decides SOURCE,
// and folding the two into one list would mean a key per combination.
const SOURCES = Object.freeze(['all', 'notifications', 'mentions']);
const normalizeSource = (source) => (SOURCES.includes(String(source)) ? String(source) : 'all');

const normalizeLimit = (raw) => {
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) return PAGE_SIZE;
    return Math.min(n, MAX_PAGE_SIZE);
};

const normalizeSkip = (raw) => {
    const n = Number.parseInt(raw, 10);
    return (!Number.isFinite(n) || n < 0) ? 0 : n;
};

/**
 * Which sources a tab reads, and whether it wants read or unread rows.
 *
 * `source` narrows a tab that carries both kinds — only Archive does. It is ignored
 * elsewhere: Notifications and Mentions are already one source each, and narrowing them
 * further could only ever return nothing.
 */
const planFor = (tab, source = 'all', kind = 'all') => {
    const byKind = (plan) => {
        if (kind === 'mention') return { ...plan, notifications: false, mentions: true };
        if (kind === 'reminder') return { ...plan, notifications: true, mentions: false, keyOnly: REMINDER_KEY };
        if (kind === 'update') return { ...plan, notifications: true, mentions: false, keyNot: REMINDER_KEY };
        return plan;
    };
    if (tab === 'notifications') return { notifications: true, mentions: false, read: false };
    if (tab === 'mentions') return { notifications: false, mentions: true, read: false };
    // The bell's archive is its already-read notifications.
    if (tab === 'archive' || tab === 'done') {
        const want = normalizeSource(source);
        return byKind({
            notifications: want !== 'mentions',
            mentions: want !== 'notifications',
            read: true,
        });
    }
    if (tab === 'later' || tab === 'cleared') return byKind({ notifications: true, mentions: true, read: null });
    // A mention is always addressed to the reader, so it is never a watched-only update.
    if (tab === 'other') return { ...byKind({ notifications: true, mentions: false, read: false }), mentions: false };
    return byKind({ notifications: true, mentions: true, read: false });
};

const snoozedNotification = (now) => ({ $or: [{ snoozedUntil: { $gt: now } }, { snoozeUntilChange: true }] });
const snoozedMention = (userId, now) => ({
    snoozes: { $elemMatch: { userId, $or: [{ until: { $gt: now } }, { untilChange: true }] } },
});

/** One reader's notifications on one tab: the match list, counts and clear-all share. */
const notificationMatch = (userId, { tab, source = 'all', kind = 'all', now = new Date() } = {}) => {
    const plan = planFor(tab, source, kind);
    const and = [
        { assigneeUsers: { $in: [userId] } },
        // Mention notices are read from the mentions collection; counting both would double them.
        { key: { $ne: MENTION_KEY } },
        { $or: [{ notificationType: 'push' }, { notificationType: null }] },
        { receiverID: userId },
    ];
    if (tab === 'cleared') and.push({ clearedAt: { $gte: clearedCutoff(now) } });
    else and.push({ clearedAt: null }, tab === 'later' ? snoozedNotification(now) : { $nor: [snoozedNotification(now)] });
    if (tab === 'primary') and.push({ reason: { $ne: WATCHING } });
    if (tab === 'other') and.push({ reason: WATCHING });
    if (plan.read === true) and.push({ notSeen: { $nin: [userId] } });
    if (plan.read === false) and.push({ notSeen: { $in: [userId] } });
    if (plan.keyOnly) and.push({ key: plan.keyOnly });
    if (plan.keyNot) and.push({ key: { $ne: plan.keyNot } });
    return { $and: and };
};

const mentionMatch = (userId, { tab, source = 'all', kind = 'all', now = new Date() } = {}) => {
    const plan = planFor(tab, source, kind);
    const and = [];
    if (tab === 'cleared') and.push({ clearedFor: { $elemMatch: { userId, at: { $gte: clearedCutoff(now) } } } });
    else and.push({ mentionIds: { $in: [userId] } }, tab === 'later' ? snoozedMention(userId, now) : { $nor: [snoozedMention(userId, now)] });
    if (plan.read === true) and.push({ notSeen: { $nin: [userId] } });
    if (plan.read === false) and.push({ notSeen: { $in: [userId] } });
    return { $and: and };
};

module.exports = {
    TABS,
    INBOX_TABS,
    CLEARABLE_TABS,
    MENTION_KEY,
    CLEARED_RETENTION_SECONDS,
    clearedCutoff,
    WATCHING,
    DIRECT,
    reasonFor,
    parseSnooze,
    notificationMatch,
    mentionMatch,
    KINDS,
    REMINDER_KEY,
    normalizeKind,
    kindOf,
    SORTS,
    normalizeSort,
    sortDirection,
    PAGE_SIZE,
    MAX_PAGE_SIZE,
    ALLOWED_TAGS,
    cleanMessage,
    dedupeItems,
    dedupeKeyOf,
    dateGroupOf,
    normalizeTab,
    SOURCES,
    normalizeSource,
    normalizeLimit,
    normalizeSkip,
    planFor,
};
