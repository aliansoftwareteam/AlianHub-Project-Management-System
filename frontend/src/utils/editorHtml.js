import DOMPurify from "dompurify";
import markdownit from "markdown-it";

/* What a stored editor document may put on the page. Editor.js tools write a block's text with innerHTML, and Editor.js
   sets the HTML it is handed on an element before its own cleaning runs, so a document, and the text form of a
   description, pass through here first. A description is words and structure: no image, frame, script, style or
   handler, and a link goes to an http, https or mailto address only. A doc page keeps what its preview keeps. */

const INLINE_TAGS = ["b", "strong", "i", "em", "u", "s", "del", "mark", "code", "a", "br", "sub", "sup"];
const BLOCK_TAGS = ["p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "pre", "hr", "table", "thead", "tbody", "tr", "th", "td"];
const ALLOWED_ATTR = ["href", "target", "rel", "class", "colspan", "rowspan"];
// The classes the editor's inline code and marker tools put on their tags.
const CLASSES = ["inline-code", "cdx-marker"];
const LINK_URL = /^(https?:|mailto:)/i;

const purifier = DOMPurify(window);

purifier.addHook("afterSanitizeAttributes", (node) => {
    if (node.hasAttribute("class")) {
        const kept = node.getAttribute("class").split(/\s+/).filter((name) => CLASSES.includes(name));
        if (kept.length) node.setAttribute("class", kept.join(" "));
        else node.removeAttribute("class");
    }
    if (node.tagName !== "A") return;
    const href = (node.getAttribute("href") || "").trim();
    if (LINK_URL.test(href)) {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
    } else {
        ["href", "target", "rel"].forEach((name) => node.removeAttribute(name));
    }
});

const BASE = { ALLOWED_ATTR, ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false, ALLOW_UNKNOWN_PROTOCOLS: false };
const TEXT_CONFIG = { ...BASE, ALLOWED_TAGS: [...BLOCK_TAGS, ...INLINE_TAGS] };
const INLINE_CONFIG = { ...BASE, ALLOWED_TAGS: INLINE_TAGS };

// Older descriptions hold markdown, or HTML the app wrote itself (the AI sidebar's rendered answer, two merged
// descriptions joined by a line break), so raw HTML is read and then held to the list above rather than escaped.
const markdown = markdownit({ html: true }).disable("image");
markdown.renderer.rules.code_inline = (tokens, idx) => `<code class="inline-code">${markdown.utils.escapeHtml(tokens[idx].content)}</code>`;

// The editor's bold and italic tools keep <b> and <i> and drop the other spelling of each.
const EDITOR_TAGS = [[/<(\/?)strong>/g, "<$1b>"], [/<(\/?)em>/g, "<$1i>"]];

/* The text form of a description, as the HTML the editor turns into blocks. */
export const descriptionTextHtml = (value) => EDITOR_TAGS.reduce(
    (html, [tag, kept]) => html.replace(tag, kept),
    purifier.sanitize(markdown.render(String(value ?? "")), TEXT_CONFIG)
);

const strictInline = (value) => purifier.sanitize(value, INLINE_CONFIG);

// The frames the embed tool builds for the services it knows; a gist is a script from gist.github.com in a data: frame.
const EMBED_HOSTS = [
    "player.vimeo.com", "www.youtube.com", "coub.com", "vine.co", "imgur.com", "gfycat.com", "player.twitch.tv", "music.yandex.ru",
    "codepen.io", "www.instagram.com", "platform.twitter.com", "assets.pinterest.com", "www.facebook.com", "www.aparat.com", "miro.com"
];
const GIST_FRAME = /^data:text\/html;charset=utf-8,<head><base target="_blank" \/><\/head><body><script src="https:\/\/gist\.github\.com\/[\w.-]+\/[0-9a-f]+\.js" ><\/script><\/body>$/;

const isKnownFrame = (address) => {
    if (typeof address !== "string") return false;
    if (GIST_FRAME.test(address)) return true;
    try {
        const url = new URL(address);
        return url.protocol === "https:" && EMBED_HOSTS.includes(url.hostname);
    } catch (error) {
        return false;
    }
};

/* A frame to anywhere else is not drawn; the address it was made from stays as a link. */
const sourceLink = (address) => {
    const link = document.createElement("a");
    link.setAttribute("href", String(address || ""));
    link.textContent = String(address || "");
    const text = strictInline(link.outerHTML);
    return text.includes("href=") ? { type: "paragraph", data: { text } } : null;
};

const cleanerOf = (clean) => {
    const inline = (value) => (typeof value === "string" ? clean(value) : "");
    const listItems = (items) => (Array.isArray(items) ? items : []).map((item) => (typeof item === "string"
        ? inline(item)
        : { ...item, content: inline(item?.content), items: listItems(item?.items) }));
    return {
        paragraph: (data) => ({ ...data, text: inline(data.text) }),
        header: (data) => ({ ...data, text: inline(data.text) }),
        list: (data) => ({ ...data, items: listItems(data.items) }),
        checklist: (data) => ({ ...data, items: (Array.isArray(data.items) ? data.items : []).map((item) => ({ ...item, text: inline(item?.text) })) }),
        table: (data) => ({ ...data, content: (Array.isArray(data.content) ? data.content : []).map((row) => (Array.isArray(row) ? row.map(inline) : [])) }),
        embed: (data) => ({ ...data, caption: inline(data.caption) })
    };
};

const safeBlock = (block, blocks) => {
    if (!block || typeof block !== "object") return null;
    const data = block.data && typeof block.data === "object" ? block.data : {};
    if (block.type === "embed" && !isKnownFrame(data.embed)) return sourceLink(data.source);
    return blocks[block.type] ? { ...block, data: blocks[block.type](data) } : block;
};

/* A stored document with the text of every block the stock Editor.js tools draw held to a list: the short one above
   by default, or the caller's own cleaner (`inline`), as a doc page passes the one its preview uses. A block type with
   a tool of the app's own is left to that tool, which cleans what it draws, and a code block is set as a text area's
   value. */
export const safeEditorDocument = (stored, { inline = strictInline } = {}) => {
    if (!stored || !Array.isArray(stored.blocks)) return stored;
    const blocks = cleanerOf(inline);
    return { ...stored, blocks: stored.blocks.map((block) => safeBlock(block, blocks)).filter(Boolean) };
};
