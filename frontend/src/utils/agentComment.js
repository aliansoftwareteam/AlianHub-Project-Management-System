import markdownit from "markdown-it";
import { decodeCommentText } from "./commentHtml";
import { escapeHtml } from "./notificationHtml";
import { richHtml } from "./richHtml";

// Replies stored by the @Alian mention prototype (feat/alian-mentions) carry this synthetic userId and no actorType.
export const LEGACY_ASSISTANT_ID = "alian";

const PAGE_REF = /\[page:([0-9a-f]{24})\]/gi;
const MENTION = /@\[([\w ]+?)\]\(\w{4,30}\)/g;
// Private-use characters hold each citation's place through markdown, which would otherwise read [page:id] as link syntax.
const SLOT_CHARS = /[]/g;
const SLOT = /(\d+)/g;

const markdown = markdownit({ html: false, linkify: false, breaks: true }).disable("image");

export const agentAuthorOf = (row) => {
    if (!row) return null;
    if (row.actorType === "agent" || row.isAgent === true) return { name: String(row.agentName || ""), assistant: false };
    if (String(row.userId || "") === LEGACY_ASSISTANT_ID) return { name: "", assistant: true };
    return null;
};

export const pageRefIds = (value) => [...new Set(
    [...decodeCommentText(value).matchAll(PAGE_REF)].map((match) => match[1].toLowerCase())
)];

const citationHtml = (id, { pageOf, pageHref, pageLabel, hiddenPageLabel }) => {
    const page = id ? pageOf(id) : null;
    if (!page) return `<span class="comment-cite comment-cite--hidden">${escapeHtml(hiddenPageLabel)}</span>`;
    return `<a class="comment-cite" href="${escapeHtml(pageHref(id))}" target="_blank">${escapeHtml(page.title || pageLabel)}</a>`;
};

export const agentReplyHtml = (value, { pageOf = () => null, pageHref = () => "", pageLabel = "page", hiddenPageLabel = "page" } = {}) => {
    const cited = [];
    const text = decodeCommentText(value)
        .replace(SLOT_CHARS, "")
        .replace(MENTION, "@$1")
        .replace(PAGE_REF, (whole, id) => `${cited.push(id.toLowerCase()) - 1}`);
    const html = markdown.render(text)
        .replace(SLOT, (whole, n) => citationHtml(cited[Number(n)], { pageOf, pageHref, pageLabel, hiddenPageLabel }));
    return richHtml(html);
};
