import DOMPurify from "dompurify";

// Hooked once: anchors rendered from user content always open safely in a new tab.
let hookInstalled = false;
function ensureAnchorHook() {
    if (hookInstalled) return;
    DOMPurify.addHook("afterSanitizeAttributes", (node) => {
        if (node.tagName === "A") {
            node.setAttribute("rel", "noopener noreferrer");
            if (!node.hasAttribute("target")) {
                node.setAttribute("target", "_blank");
            }
        }
    });
    hookInstalled = true;
}
ensureAnchorHook();

const RICH_TEXT_TAGS = [
    "a", "b", "i", "u", "em", "strong", "s", "strike", "br", "p", "span", "div",
    "ul", "ol", "li", "blockquote", "pre", "code", "h1", "h2", "h3", "h4", "h5", "h6",
    "img", "hr", "table", "thead", "tbody", "tr", "th", "td", "sub", "sup", "mark"
];

const RICH_TEXT_ATTR = ["href", "target", "rel", "src", "alt", "title", "class", "style", "id"];

export function sanitizeHtml(input, options = {}) {
    if (input === null || input === undefined) return "";
    const str = typeof input === "string" ? input : String(input);
    const config = {
        ALLOWED_TAGS: options.allowedTags || RICH_TEXT_TAGS,
        ALLOWED_ATTR: options.allowedAttr || RICH_TEXT_ATTR,
        ALLOW_DATA_ATTR: false,
        FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input", "button"],
        FORBID_ATTR: ["onerror", "onclick", "onload", "onmouseover", "onfocus", "onblur", "onchange", "onsubmit"]
    };
    return DOMPurify.sanitize(str, config);
}

export function sanitizeInline(input) {
    return sanitizeHtml(input, {
        allowedTags: ["a", "b", "i", "u", "em", "strong", "s", "strike", "br", "span", "mark"],
        allowedAttr: ["href", "target", "rel", "class", "title"]
    });
}

export default sanitizeHtml;
