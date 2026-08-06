// Inbox — the vocabulary.
//
// THE INBOX INVENTS NOTHING. It is the header bell and the @ mention dropdown shown on
// one page instead of two, so that once it is live those two can be hidden.
//
// That means it reads exactly what they read, filters exactly how they filter, and acts
// exactly how they act. No importance ranking, no snoozing, no clearing, no grouping —
// none of that exists in the sidebars today, and adding it here would make the Inbox a
// different feature rather than a replacement for them.
//
// It owns NO data of its own. The only write is mark-read, in the same shape
// app-notification/controller.js already uses, so the bell's unread count cannot drift.

// One tab per thing a user already has, plus All to see them together.
//
//   all           — both sources, unread
//   notifications — what the bell shows  (its `filter=unread` list)
//   mentions      — what the @ dropdown shows
//   archive       — what the bell's "View Archive" toggle shows (already read)
const TABS = Object.freeze(['all', 'notifications', 'mentions', 'archive']);

// The two sidebars both page 10 at a time; matching that keeps the feel identical.
const PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;

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
const ALLOWED_TAGS = ['b', 'strong', 'i', 'em', 'span'];

const cleanMessage = (raw) => String(raw == null ? '' : raw)
    .replace(/<(script|style|iframe|object|embed)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<(img|br|hr|input|source)\b[^>]*>/gi, ' ')
    .replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, (m, tag) => {
        if (!ALLOWED_TAGS.includes(String(tag).toLowerCase())) return '';
        return m.startsWith('</') ? `</${tag.toLowerCase()}>` : `<${tag.toLowerCase()}>`;
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

const dedupeItems = (items = []) => {
    const seen = new Set();
    const out = [];
    for (const i of items) {
        const k = dedupeKeyOf(i);
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(i);
    }
    return out;
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

const normalizeLimit = (raw) => {
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) return PAGE_SIZE;
    return Math.min(n, MAX_PAGE_SIZE);
};

const normalizeSkip = (raw) => {
    const n = Number.parseInt(raw, 10);
    return (!Number.isFinite(n) || n < 0) ? 0 : n;
};

/** Which sources a tab reads, and whether it wants read or unread rows. */
const planFor = (tab) => {
    if (tab === 'notifications') return { notifications: true, mentions: false, read: false };
    if (tab === 'mentions') return { notifications: false, mentions: true, read: false };
    // The bell's archive is its already-read notifications.
    if (tab === 'archive') return { notifications: true, mentions: true, read: true };
    return { notifications: true, mentions: true, read: false };
};

module.exports = {
    TABS,
    PAGE_SIZE,
    MAX_PAGE_SIZE,
    ALLOWED_TAGS,
    cleanMessage,
    dedupeItems,
    dedupeKeyOf,
    dateGroupOf,
    normalizeTab,
    normalizeLimit,
    normalizeSkip,
    planFor,
};
