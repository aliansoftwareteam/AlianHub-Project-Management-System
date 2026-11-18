import DOMPurify from "dompurify";
import { LINK_URL, IMAGE_URL, LINK_REL, LINK_TARGET, cleanStyle, profiles } from "@richTextAllowlist";

/* What a doc page's preview keeps: the lists the API holds a page to when it is saved. Quill wrote colour, highlight
 * and alignment as inline styles; nothing else in a style survives. */
const { inlineTags: ALLOWED_TAGS, attributes: ALLOWED_ATTR, ariaAttributes } = profiles.doc;

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
        node.setAttribute("rel", LINK_REL);
        if (node.hasAttribute("target") && node.getAttribute("target") !== LINK_TARGET) node.removeAttribute("target");
    }
    if (node.tagName === "IMG") {
        const src = (node.getAttribute("src") || "").trim();
        if (!IMAGE_URL.test(src)) node.removeAttribute("src");
    }
});

const CONFIG = { ALLOWED_TAGS: [...ALLOWED_TAGS], ALLOWED_ATTR: [...ALLOWED_ATTR], ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: ariaAttributes, ALLOW_UNKNOWN_PROTOCOLS: false };

export const richHtml = (value) => {
    if (value === undefined || value === null) return "";
    return purifier.sanitize(String(value), CONFIG);
};
