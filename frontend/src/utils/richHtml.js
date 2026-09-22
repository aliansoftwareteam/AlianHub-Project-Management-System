import DOMPurify from "dompurify";

const ALLOWED_TAGS = [
    "p", "br", "div", "span", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li",
    "strong", "b", "em", "i", "u", "s", "strike", "del", "mark", "sub", "sup", "code", "pre", "blockquote",
    "a", "img", "figure", "figcaption", "aside", "hr",
    "table", "thead", "tbody", "tfoot", "tr", "th", "td", "colgroup", "col",
];

const ALLOWED_ATTR = [
    "href", "target", "rel", "src", "alt", "title", "class", "style", "colspan", "rowspan", "width", "height",
    "spellcheck", "data-list", "data-checked", "data-tone", "data-task-id", "data-project-id", "data-status-type", "data-service",
];

const LINK_URL = /^(https?:|mailto:)/i;
const IMAGE_URL = /^(https?:|data:image\/(png|gif|jpe?g|webp|bmp);)/i;

/* Quill writes colour, highlight and alignment as inline styles; nothing else in a style survives, and a value
 * must be a plain colour or keyword so no url(), expression() or escape can ride along. */
const STYLE_PROPS = ["color", "background-color", "text-align"];
const STYLE_VALUE = /^(#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)|[a-z]+)$/i;

const cleanStyle = (css) => String(css).split(";").map((part) => {
    const at = part.indexOf(":");
    if (at < 0) return "";
    const prop = part.slice(0, at).trim().toLowerCase();
    const value = part.slice(at + 1).trim();
    return STYLE_PROPS.includes(prop) && STYLE_VALUE.test(value) ? `${prop}:${value}` : "";
}).filter(Boolean).join(";");

const purifier = DOMPurify(window);

purifier.addHook("afterSanitizeAttributes", (node) => {
    if (node.hasAttribute("style")) {
        const style = cleanStyle(node.getAttribute("style"));
        if (style) node.setAttribute("style", style);
        else node.removeAttribute("style");
    }
    if (node.tagName === "A") {
        const href = (node.getAttribute("href") || "").trim();
        if (!LINK_URL.test(href)) node.removeAttribute("href");
        node.setAttribute("rel", "noopener noreferrer");
        if (node.hasAttribute("target") && node.getAttribute("target") !== "_blank") node.removeAttribute("target");
    }
    if (node.tagName === "IMG") {
        const src = (node.getAttribute("src") || "").trim();
        if (!IMAGE_URL.test(src)) node.removeAttribute("src");
    }
});

const CONFIG = { ALLOWED_TAGS, ALLOWED_ATTR, ALLOW_DATA_ATTR: false, ALLOW_UNKNOWN_PROTOCOLS: false };

export const richHtml = (value) => {
    if (value === undefined || value === null) return "";
    return purifier.sanitize(String(value), CONFIG);
};
