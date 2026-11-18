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
/* A doc or a task named in a comment: "@[Title](doc_<id>)". Applied to escaped text, so the title is already safe. */
const REFERENCE_PATTERN = /@\[([^\]]{1,300})\]\((doc|task)_([a-f0-9]{24})\)/gi;

export const decodeCommentText = (value) => String(value == null ? "" : value)
    .replace(ENTITY_PATTERN, (entity) => ENTITIES[entity]);

const mentionsHtml = (escaped, mentionMarkup) => escaped.replace(
    MENTION_PATTERN,
    (whole, name) => (mentionMarkup ? `<b class="mentioned">@${name}</b>` : `@${name}`)
);

const referencesHtml = (escaped) => escaped.replace(
    REFERENCE_PATTERN,
    (whole, title, type, id) => `<span class="mention" data-mention="${type.toLowerCase()}" data-id="${id.toLowerCase()}" role="link" tabindex="0">@${title}</span>`
);

const textHtml = (text, mentionMarkup, refs) => {
    const escaped = escapeHtml(text);
    return mentionsHtml(refs ? referencesHtml(escaped) : escaped, mentionMarkup);
};

const linkHtml = (url) => {
    const safe = escapeHtml(url);
    return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${safe}</a>`;
};

export const commentHtml = (value, { links = false, mentionMarkup = true, refs = false } = {}) => {
    const text = decodeCommentText(value);
    if (!links) return textHtml(text, mentionMarkup, refs);
    let html = "";
    let last = 0;
    for (const match of text.matchAll(URL_PATTERN)) {
        html += textHtml(text.slice(last, match.index), mentionMarkup, refs) + linkHtml(match[0]);
        last = match.index + match[0].length;
    }
    return html + textHtml(text.slice(last), mentionMarkup, refs);
};

export const commentPlainText = (value) => decodeCommentText(value)
    .replace(REFERENCE_PATTERN, "@$1")
    .replace(MENTION_PATTERN, "@$1");
