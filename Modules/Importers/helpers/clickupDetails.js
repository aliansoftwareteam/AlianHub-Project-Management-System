/* The Comments, Checklists and Attachments cells of a ClickUp export. ClickUp's help pages name these columns without fixing
 * their shape, so each reader takes the JSON shapes ClickUp is known to write and falls back to plain text. Pure, no I/O. */
const { parseDate } = require('./csvRules');
const { safeHref } = require('../../CustomField/fieldTypes/url');

const MAX_COMMENTS = 200;
const MAX_COMMENT_LENGTH = 10000;
const MAX_CHECKLIST_ITEMS = 200;
const MAX_ITEM_LENGTH = 500;
const MAX_LINKS = 50;
const MAX_URL_LENGTH = 2000;
const MAX_LABEL_LENGTH = 200;
const DEFAULT_CHECKLIST = 'Checklist';

const HTTP_URL = /^https?:\/\/\S+$/i;
const URL_IN_TEXT = /https?:\/\/[^\s"'<>\]]+/gi;
const EPOCH_MILLIS = /^\d{11,14}$/;

const trimmed = (value) => (value === undefined || value === null ? '' : String(value).trim());
const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const firstText = (source, keys) => keys.map((key) => source[key]).map((value) => (typeof value === 'string' || typeof value === 'number' ? trimmed(value) : '')).find(Boolean) || '';

const readJson = (raw) => {
    const text = trimmed(raw);
    if (!/^[[{]/.test(text)) return undefined;
    try {
        return JSON.parse(text);
    } catch (_error) {
        return undefined;
    }
};

const bareList = (raw) => trimmed(raw).replace(/^\[|\]$/g, '').split(/[,;]/).map((entry) => entry.trim().replace(/^["']|["']$/g, '')).filter(Boolean);

const parseClickUpDate = (raw) => {
    const text = trimmed(raw);
    if (!text) return null;
    if (EPOCH_MILLIS.test(text)) {
        const date = new Date(Number(text));
        return Number.isNaN(date.getTime()) ? null : date;
    }
    const direct = parseDate(text);
    if (direct) return direct;
    const cleaned = text.replace(/^[A-Za-z]+day,\s*/i, '').replace(/(\d+)(st|nd|rd|th)\b/gi, '$1');
    const parsed = new Date(cleaned);
    if (!Number.isNaN(parsed.getTime())) return parsed;
    const dayOnly = new Date(cleaned.split(',')[0]);
    return Number.isNaN(dayOnly.getTime()) ? null : dayOnly;
};

const instantOf = (value) => {
    const date = parseClickUpDate(value);
    return date ? date.toISOString() : null;
};

const personOf = (value) => {
    if (isPlainObject(value)) {
        const email = firstText(value, ['email']).toLowerCase();
        return { author: firstText(value, ['username', 'name', 'fullName']) || email, email: email.includes('@') ? email : '' };
    }
    const text = trimmed(value);
    return { author: text, email: text.includes('@') && !/\s/.test(text) ? text.toLowerCase() : '' };
};

const commentOf = (entry) => {
    if (typeof entry === 'string') return { text: entry.trim(), author: '', email: '', at: null };
    if (!isPlainObject(entry)) return null;
    const person = personOf(['by', 'user', 'author', 'creator'].map((key) => entry[key]).find((value) => value !== undefined && value !== null && value !== ''));
    return {
        text: firstText(entry, ['text', 'comment_text', 'comment', 'message']),
        author: person.author,
        email: person.email || (firstText(entry, ['email']).includes('@') ? firstText(entry, ['email']).toLowerCase() : ''),
        at: instantOf(['date', 'date_created', 'created', 'timestamp'].map((key) => entry[key]).find((value) => value !== undefined && value !== null && value !== '')),
    };
};

/* Only text, author and time are read: a comment never brings a file with it, whatever the cell names. */
const parseComments = (raw) => {
    const text = trimmed(raw);
    if (!text) return [];
    const parsed = readJson(text);
    const entries = parsed === undefined ? [text] : [].concat(parsed);
    const comments = entries.map(commentOf)
        .filter((comment) => comment && comment.text)
        .slice(0, MAX_COMMENTS)
        .map((comment) => ({ ...comment, text: comment.text.slice(0, MAX_COMMENT_LENGTH) }));
    return comments.every((comment) => comment.at)
        ? comments.map((comment, index) => ({ comment, index })).sort((a, b) => a.comment.at.localeCompare(b.comment.at) || a.index - b.index).map(({ comment }) => comment)
        : comments;
};

const DONE_KEYS = ['resolved', 'checked', 'done', 'completed', 'isChecked'];
const isDone = (item) => DONE_KEYS.some((key) => item[key] === true || trimmed(item[key]).toLowerCase() === 'true');

const itemOf = (entry) => {
    if (typeof entry === 'string' || typeof entry === 'number') return { name: trimmed(entry), isChecked: false };
    if (!isPlainObject(entry)) return null;
    return { name: firstText(entry, ['name', 'text', 'title']), isChecked: isDone(entry) };
};

const checklistOf = (name, entries) => ({
    name: trimmed(name).slice(0, MAX_ITEM_LENGTH) || DEFAULT_CHECKLIST,
    items: (Array.isArray(entries) ? entries : []).map(itemOf).filter((item) => item && item.name).map((item) => ({ ...item, name: item.name.slice(0, MAX_ITEM_LENGTH) })),
});

const checklistsIn = (parsed) => {
    if (Array.isArray(parsed)) {
        const named = parsed.filter((entry) => isPlainObject(entry) && Array.isArray(entry.items));
        return named.length ? named.map((entry) => checklistOf(firstText(entry, ['name', 'title']), entry.items)) : [checklistOf('', parsed)];
    }
    if (isPlainObject(parsed)) return Object.entries(parsed).map(([name, items]) => checklistOf(name, items));
    return [];
};

const parseChecklists = (raw) => {
    const text = trimmed(raw);
    if (!text) return [];
    const parsed = readJson(text);
    let left = MAX_CHECKLIST_ITEMS;
    return checklistsIn(parsed === undefined ? bareList(text) : parsed)
        .map((checklist) => {
            const items = checklist.items.slice(0, left);
            left -= items.length;
            return { ...checklist, items };
        })
        .filter((checklist) => checklist.items.length);
};

const fileNameOf = (url) => {
    try {
        return decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || '');
    } catch (_error) {
        return '';
    }
};

const linkOf = (entry) => {
    const url = typeof entry === 'string' ? entry.trim() : (isPlainObject(entry) ? firstText(entry, ['url', 'link', 'href']) : '');
    if (!HTTP_URL.test(url) || url.length > MAX_URL_LENGTH || !safeHref(url)) return null;
    const title = isPlainObject(entry) ? firstText(entry, ['title', 'name', 'filename']) : '';
    return { url, label: (title || fileNameOf(url) || url).slice(0, MAX_LABEL_LENGTH) };
};

/* An attachment arrives as its name and its address in ClickUp. It becomes a link: nothing is fetched or stored. The
 * task panel's Links list draws a link when `safeHref` accepts its address, so only those are kept. */
const parseAttachmentLinks = (raw) => {
    const text = trimmed(raw);
    if (!text) return [];
    const parsed = readJson(text);
    const entries = parsed === undefined ? (text.match(URL_IN_TEXT) || []) : [].concat(parsed);
    const seen = new Set();
    return entries.map(linkOf).filter((link) => link && !seen.has(link.url) && seen.add(link.url)).slice(0, MAX_LINKS);
};

module.exports = { DEFAULT_CHECKLIST, parseClickUpDate, parseComments, parseChecklists, parseAttachmentLinks };
