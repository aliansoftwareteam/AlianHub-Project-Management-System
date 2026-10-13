const { escapeHtml } = require('../../../utils/escapeHtml');

const TEXT_FIELDS = ['message', 'reply_message'];
const ENTITIES = {
    '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#39;': "'", '&#039;': "'", '&#96;': '`', '&#40;': '(', '&#41;': ')',
};
const ENTITY_PATTERN = /&(?:lt|gt|amp|quot|#0?39|#96|#40|#41);/g;
const MENTION_PATTERN = /@\[([\w ]+?)\]\(\w{4,30}\)/g;

/* The web app escapes comment text before sending it, so text still holding "<" or ">" came from another
 * caller; escaping it the same way keeps one stored shape for every writer. */
const escapeCommentText = (value) => {
    if (typeof value !== 'string' || !/[<>]/.test(value)) return value;
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
};

const escapeCommentFields = (data) => {
    if (!data || typeof data !== 'object') return data;
    const escaped = { ...data };
    for (const field of TEXT_FIELDS) {
        if (field in escaped) escaped[field] = escapeCommentText(escaped[field]);
    }
    return escaped;
};

/* Mirrors the web app's commentHtml: stored text is either entity-escaped by the app or raw from an API caller,
 * so decoding once and escaping everything again renders both the same way. */
const decodeCommentText = (value) => String(value === undefined || value === null ? '' : value)
    .replace(ENTITY_PATTERN, (entity) => ENTITIES[entity]);

const commentHtml = (value) => escapeHtml(decodeCommentText(value))
    .replace(MENTION_PATTERN, (whole, name) => `<b class="mentioned">@${name}</b>`);

const commentPlainText = (value) => decodeCommentText(value).replace(MENTION_PATTERN, '@$1');

module.exports = { escapeCommentText, escapeCommentFields, decodeCommentText, commentHtml, commentPlainText };
