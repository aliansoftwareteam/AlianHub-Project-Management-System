import { escapeHtml } from "./notificationHtml";

/* Stored comment text is either what the web app sent (already entity-escaped) or raw text from an API
 * caller. Decoding the app's entities once and escaping everything again renders both the same way,
 * without showing "&lt;" to readers of older comments. */
const ENTITIES = {
    "&lt;": "<",
    "&gt;": ">",
    "&amp;": "&",
    "&quot;": "\"",
    "&#39;": "'",
    "&#039;": "'",
    "&#96;": "`",
    "&#40;": "(",
    "&#41;": ")"
};
const ENTITY_PATTERN = /&(?:lt|gt|amp|quot|#0?39|#96|#40|#41);/g;
const MENTION_PATTERN = /@\[([\w ]+?)\]\(\w{4,30}\)/g;
const URL_PATTERN = /https?:\/\/[^\s/$.?#<>"'`][^\s<>"'`]*/gi;

export const decodeCommentText = (value) => String(value == null ? "" : value)
    .replace(ENTITY_PATTERN, (entity) => ENTITIES[entity]);

const mentionsHtml = (escaped, mentionMarkup) => escaped.replace(
    MENTION_PATTERN,
    (whole, name) => (mentionMarkup ? `<b class="mentioned">@${name}</b>` : `@${name}`)
);

const textHtml = (text, mentionMarkup) => mentionsHtml(escapeHtml(text), mentionMarkup);

const linkHtml = (url) => {
    const safe = escapeHtml(url);
    return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${safe}</a>`;
};

export const commentHtml = (value, { links = false, mentionMarkup = true } = {}) => {
    const text = decodeCommentText(value);
    if (!links) return textHtml(text, mentionMarkup);
    let html = "";
    let last = 0;
    for (const match of text.matchAll(URL_PATTERN)) {
        html += textHtml(text.slice(last, match.index), mentionMarkup) + linkHtml(match[0]);
        last = match.index + match[0].length;
    }
    return html + textHtml(text.slice(last), mentionMarkup);
};

export const commentPlainText = (value) => decodeCommentText(value).replace(MENTION_PATTERN, "@$1");
