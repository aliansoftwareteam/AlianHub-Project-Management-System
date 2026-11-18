/* A notification's stored message is HTML its writer assembled, and several writers put names, comments, file
 * names and other user text into it unescaped. So the Inbox never trusts it: everything is escaped, and then
 * only the markup the app's own notification templates add is turned back into tags. That markup is bold,
 * paragraphs, line breaks and the colour chips, whose style may name only a few properties with plain values. */

export const escapeHtml = (value) => String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const STYLE_PROPS = ["background-color", "color", "padding-left", "padding-right", "border-radius", "font-weight"];
const STYLE_VALUE = /^(#[0-9a-f]{3,8}|rgb\(\s*\d{1,3}(\s*,?\s*\d{1,3}){2}\s*\)|\d{1,3}px|[1-9]00)$/i;
const BARE_TAGS = ["strong", "b", "p", "span", "i", "em"];

const cleanStyle = (css) => {
    const declarations = String(css).split(";").map((part) => part.trim()).filter(Boolean);
    const kept = [];
    for (const declaration of declarations) {
        const at = declaration.indexOf(":");
        if (at < 0) return null;
        const prop = declaration.slice(0, at).trim().toLowerCase();
        const value = declaration.slice(at + 1).trim();
        if (!STYLE_PROPS.includes(prop) || !STYLE_VALUE.test(value)) return null;
        kept.push(`${prop}:${value}`);
    }
    return kept.join(";");
};

const unescapeAttr = (value) => value.replace(/&quot;/g, "\"").replace(/&#039;/g, "'").replace(/&amp;/g, "&");

/* Runs on the escaped text, so every "<" in it is "&lt;": a tag comes back only when it is one of these exact
 * shapes, and a styled tag only when its whole style passes. */
const restoreAppMarkup = (escaped) => escaped
    .replace(/&lt;br\s*\/?&gt;/gi, "<br>")
    .replace(/&lt;(\/?)([a-z]+)&gt;/gi, (whole, close, tag) => (BARE_TAGS.includes(tag.toLowerCase()) ? `<${close}${tag.toLowerCase()}>` : whole))
    .replace(/&lt;(span|strong)\s+style=(&quot;|&#039;)([^<>]*?)\2\s*&gt;/gi, (whole, tag, quote, css) => {
        const style = cleanStyle(unescapeAttr(css));
        return style === null ? whole : `<${tag.toLowerCase()} style="${style}">`;
    });

export const notificationHtml = (message) => restoreAppMarkup(escapeHtml(message));
