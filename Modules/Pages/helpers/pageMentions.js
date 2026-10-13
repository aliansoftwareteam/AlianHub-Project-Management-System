'use strict';

const { escapeHtml, stripTags } = require('./pageContent');
const { safeRelativePath } = require('../../../utils/uploadConfig');

const MENTION_TYPES = Object.freeze(['user', 'doc', 'task']);
const OBJECT_ID = /^[a-f\d]{24}$/i;
const LABEL_MAX = 120;
const EXCERPT_MAX = 200;
const MENTION_ELEMENT = /<span\b([^>]*\bdata-mention\s*=[^>]*)>([\s\S]*?)<\/span>/gi;
const IMAGE_KEY = /^Pages\/[a-f\d]{24}\/[^/]+$/i;

const attributeOf = (attrs, name) => {
    const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attrs);
    return match ? (match[1] ?? match[2] ?? match[3] ?? '') : '';
};

const decodeEntities = (text) => text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, '&');

const labelText = (inner) => decodeEntities(String(inner || '').replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, LABEL_MAX);

const mentionHtml = ({ type, id, label }) => `<span class="mention" data-mention="${type}" data-id="${id}">${escapeHtml(label)}</span>`;

/* Stored markup is never trusted: every mention element is rebuilt from its type, id and text. */
const normalizeMentionHtml = (html) => String(html == null ? '' : html).replace(MENTION_ELEMENT, (whole, attrs, inner) => {
    const type = attributeOf(attrs, 'data-mention');
    const id = attributeOf(attrs, 'data-id');
    const label = labelText(inner);
    if (!MENTION_TYPES.includes(type) || !OBJECT_ID.test(id)) return escapeHtml(label);
    return mentionHtml({ type, id: id.toLowerCase(), label });
});

const mapItems = (items, fn) => (Array.isArray(items) ? items.map((item) => {
    if (typeof item === 'string') return fn(item);
    if (!item || typeof item !== 'object') return item;
    const next = { ...item };
    if (typeof next.content === 'string') next.content = fn(next.content);
    if (typeof next.text === 'string') next.text = fn(next.text);
    if (Array.isArray(next.items)) next.items = mapItems(next.items, fn);
    return next;
}) : items);

/* Every inline-html field a block can carry: text, list and checklist items, table cells. */
const mapBlockText = (block, fn) => {
    if (!block || typeof block !== 'object' || !block.data || typeof block.data !== 'object') return block;
    const data = { ...block.data };
    if (typeof data.text === 'string') data.text = fn(data.text);
    if (Array.isArray(data.items)) data.items = mapItems(data.items, fn);
    if (block.type === 'table' && Array.isArray(data.content)) {
        data.content = data.content.map((row) => (Array.isArray(row) ? row.map((cell) => (typeof cell === 'string' ? fn(cell) : cell)) : row));
    }
    return { ...block, data };
};

const blocksOf = (editorData) => {
    if (Array.isArray(editorData)) return editorData;
    return editorData && Array.isArray(editorData.blocks) ? editorData.blocks : [];
};

const normalizeImageKey = (key) => {
    const value = String(key || '');
    return IMAGE_KEY.test(value) && safeRelativePath(value) === value ? value : '';
};

const normalizeImage = (block) => {
    if (!block || block.type !== 'image' || !block.data) return block;
    return { ...block, data: { ...block.data, key: normalizeImageKey(block.data.key), url: String(block.data.url || '') } };
};

const normalizeBlockMentions = (editorData) => {
    const blocks = blocksOf(editorData).map((block) => normalizeImage(mapBlockText(block, normalizeMentionHtml)));
    return Array.isArray(editorData) ? blocks : { ...(editorData || {}), blocks };
};

const mentionsInHtml = (html) => Array.from(String(html || '').matchAll(MENTION_ELEMENT), ([, attrs]) => ({
    type: attributeOf(attrs, 'data-mention'),
    id: attributeOf(attrs, 'data-id').toLowerCase(),
})).filter(({ type, id }) => MENTION_TYPES.includes(type) && OBJECT_ID.test(id));

const textsOf = (editorData) => blocksOf(editorData).map((block) => {
    const texts = [];
    mapBlockText(block, (text) => { texts.push(text); return text; });
    return texts;
});

const mentionsIn = (editorData) => {
    const seen = new Set();
    return textsOf(editorData).flat().flatMap(mentionsInHtml).filter(({ type, id }) => {
        const key = `${type}:${id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};

const userMentionIds = (editorData) => mentionsIn(editorData).filter(({ type }) => type === 'user').map(({ id }) => id);

const newUserMentions = (before, after) => {
    const earlier = new Set(userMentionIds(before));
    return userMentionIds(after).filter((id) => !earlier.has(id));
};

const mentionExcerpt = (editorData, userId, max = EXCERPT_MAX) => {
    const id = String(userId || '').toLowerCase();
    const text = textsOf(editorData).flat().find((html) => mentionsInHtml(html).some((m) => m.type === 'user' && m.id === id));
    return text ? stripTags(text).slice(0, max) : '';
};

module.exports = {
    MENTION_TYPES,
    normalizeMentionHtml,
    normalizeBlockMentions,
    normalizeImageKey,
    mentionsIn,
    userMentionIds,
    newUserMentions,
    mentionExcerpt,
};
