// Public-share rules. Pure (crypto only) — shared by controller, the public
// renderer and tests.

const crypto = require('crypto');

const ENTITY_TYPES = Object.freeze(['sprint', 'report', 'page']);
const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;
// Accept legacy 16-byte (32-hex) tokens and new 32-byte (64-hex) tokens.
const TOKEN_PATTERN = /^[0-9a-f]{32,64}$/;
const MAX_TITLE_LENGTH = 200;
const MAX_TEXT_LENGTH = 5000;
const MAX_NAME_LENGTH = 120;

const isObjectIdString = (id) => OBJECT_ID_PATTERN.test(String(id || ''));

const generateShareToken = () => crypto.randomBytes(32).toString('hex');

const isShareToken = (token) => TOKEN_PATTERN.test(String(token || ''));

/* Validate share creation. Returns { valid, reason }. */
const validateCreateShare = ({ companyId, entityType, entityId }) => {
    if (!companyId) {
        return { valid: false, reason: 'companyId is required.' };
    }
    if (!ENTITY_TYPES.includes(entityType)) {
        return { valid: false, reason: `entityType must be one of: ${ENTITY_TYPES.join(', ')}.` };
    }
    if (!isObjectIdString(entityId)) {
        return { valid: false, reason: 'A valid entityId is required.' };
    }
    return { valid: true, reason: '' };
};

/* Validate a public intake submission. Returns { valid, reason }. */
const validateIntakeSubmission = ({ title, name, email, description }) => {
    if (!title || !String(title).trim() || String(title).length > MAX_TITLE_LENGTH) {
        return { valid: false, reason: `A title up to ${MAX_TITLE_LENGTH} characters is required.` };
    }
    if (name !== undefined && String(name).length > MAX_NAME_LENGTH) {
        return { valid: false, reason: 'Name is too long.' };
    }
    if (email !== undefined && String(email).length > MAX_NAME_LENGTH) {
        return { valid: false, reason: 'Email is too long.' };
    }
    if (description !== undefined && String(description).length > MAX_TEXT_LENGTH) {
        return { valid: false, reason: 'Description is too long.' };
    }
    return { valid: true, reason: '' };
};

/* HTML-escape for the server-rendered public page. */
const escapeHtml = (text) => String(text === null || text === undefined ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/* ── Doc bodies on the public page ─────────────────────────────────────────
 *
 * A shared doc is the one thing here that is rendered as HTML rather than as
 * escaped text — escaping it would show the markup instead of the document.
 * That HTML was written by a member through the editor, so it is trusted about
 * as far as any other member-supplied string: treat it as hostile and rebuild
 * it from an allow-list.
 *
 * Everything not named below is dropped. Tags go but their text stays, so a
 * stripped wrapper never swallows a paragraph.
 */
const ALLOWED_TAGS = new Set([
    'p', 'br', 'hr', 'div', 'span',
    'strong', 'b', 'em', 'i', 'u', 's', 'del', 'ins', 'sub', 'sup', 'mark', 'small',
    'blockquote', 'pre', 'code',
    'ol', 'ul', 'li',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'a', 'img',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption',
]);
const VOID_TAGS = new Set(['br', 'hr', 'img']);
// Removed WITH their contents. Anything else only loses its tags.
const STRIPPED_TAGS = 'script|style|svg|math|iframe|object|embed|template|noscript|form|input|button|select|textarea|link|meta|base';
// Inline styles carry the editor's colours and alignment. Layout and anything
// that can fetch or execute is not on the list.
const ALLOWED_STYLE_PROPS = new Set([
    'color', 'background-color', 'text-align', 'text-decoration', 'font-weight',
    'font-style', 'padding-left', 'padding-right', 'direction',
]);
const SAFE_HREF = /^(?:https?:\/\/|mailto:|#|\/)/i;
const SAFE_IMG_SRC = /^(?:https?:\/\/|data:image\/(?:png|jpe?g|gif|webp);base64,)/i;
const HREF_HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Docs written before the editor started absolutising links hold hrefs like
 * "www.alianhub.com". With no scheme a browser resolves that against the share
 * page itself, so give it https:// — otherwise the link fails SAFE_HREF below
 * and is dropped, leaving text that looks like a link and does nothing.
 *
 * Only a value with NO scheme is touched. Anything carrying one — javascript:,
 * data:, vbscript: — is left exactly as it was, so it still faces SAFE_HREF and
 * is still rejected.
 */
const absoluteHref = (value) => {
    const raw = String(value || '').trim();
    if (!raw || HREF_HAS_SCHEME.test(decodeForSchemeCheck(raw))) return raw;
    if (raw.startsWith('#') || raw.startsWith('/')) return raw;
    return `https://${raw}`;
};

/**
 * Resolve a URL attribute the way a browser would before deciding it is safe.
 *
 * `javascript&#58;alert(1)` and `java\tscript:alert(1)` both reach the parser as
 * `javascript:`, so the scheme has to be checked against the decoded, stripped
 * form rather than against the raw attribute text.
 */
const decodeForSchemeCheck = (value) => String(value || '')
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&colon;/gi, ':')
    .replace(/&Tab;|&NewLine;/gi, '')
    // Control characters, whitespace and DEL are ignored inside a scheme.
    .replace(new RegExp('[\\u0000-\\u0020\\u007f]', 'g'), '')
    .trim();

const attrValue = (value) => String(value === null || value === undefined ? '' : value)
    .replace(/&(?!#?\w+;)/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const cleanStyle = (value) => String(value || '')
    .split(';')
    .map((decl) => {
        const at = decl.indexOf(':');
        if (at === -1) return '';
        const prop = decl.slice(0, at).trim().toLowerCase();
        const val = decl.slice(at + 1).trim();
        if (!ALLOWED_STYLE_PROPS.has(prop)) return '';
        // url() can fetch, expression() could once execute, and a stray brace
        // would let a declaration escape into a new rule.
        if (/url\s*\(|expression\s*\(|javascript:|[{}<>]/i.test(val)) return '';
        return `${prop}: ${val}`;
    })
    .filter(Boolean)
    .join('; ');

// The editor's own classes carry alignment and indent; nothing else is kept, so
// a doc cannot borrow a class from the surrounding page.
const cleanClass = (value) => String(value || '')
    .split(/\s+/)
    .filter((token) => /^(?:ql|ah)[\w-]*$/.test(token))
    .join(' ');

const cleanAttrs = (tag, raw) => {
    const kept = [];
    let hasHref = false;
    const ATTR = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
    let match;
    while ((match = ATTR.exec(raw))) {
        const name = match[1].toLowerCase();
        const value = match[2] !== undefined ? match[2] : (match[3] !== undefined ? match[3] : (match[4] || ''));
        if (name === 'class') {
            const cls = cleanClass(value);
            if (cls) kept.push(`class="${attrValue(cls)}"`);
        } else if (name === 'style') {
            const style = cleanStyle(value);
            if (style) kept.push(`style="${attrValue(style)}"`);
        } else if (name === 'href' && tag === 'a') {
            const href = absoluteHref(value);
            if (SAFE_HREF.test(decodeForSchemeCheck(href))) {
                kept.push(`href="${attrValue(href)}"`);
                hasHref = true;
            }
        } else if (name === 'src' && tag === 'img') {
            if (SAFE_IMG_SRC.test(decodeForSchemeCheck(value))) kept.push(`src="${attrValue(value)}"`);
        } else if ((name === 'alt' || name === 'title') && (tag === 'img' || tag === 'a')) {
            kept.push(`${name}="${attrValue(value)}"`);
        } else if ((name === 'width' || name === 'height') && tag === 'img' && /^\d{1,4}$/.test(value)) {
            kept.push(`${name}="${value}"`);
        }
        // Everything else — including every on* handler — is dropped by omission.
    }
    // A link out of a public page opens away from it and carries nothing back.
    if (tag === 'a' && hasHref) kept.push('target="_blank"', 'rel="noopener noreferrer nofollow"');
    return kept.length ? ` ${kept.join(' ')}` : '';
};

const sanitizeDocHtml = (html) => {
    let working = String(html || '').replace(/<!--[\s\S]*?-->/g, '');

    // Nested openers (`<scr<script>ipt>`) reappear once the inner pair is cut, so
    // keep cutting until a pass changes nothing.
    const blockRe = new RegExp(`<(${STRIPPED_TAGS})\\b[\\s\\S]*?<\\/\\1\\s*>`, 'gi');
    for (let pass = 0; pass < 5; pass += 1) {
        const next = working.replace(blockRe, '');
        if (next === working) break;
        working = next;
    }
    // ...and unclosed ones leave a lone opener behind.
    working = working.replace(new RegExp(`<\\/?(?:${STRIPPED_TAGS})\\b[^>]*>?`, 'gi'), '');

    // Rebuild tag by tag. Text between tags is passed through so entities survive,
    // with any leftover '<' neutralised — the loop has already consumed every
    // well-formed tag, so one here cannot be the start of a real element.
    const text = (chunk) => chunk.replace(/</g, '&lt;');
    const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>])*)>/g;
    let out = '';
    let last = 0;
    let match;
    while ((match = TAG.exec(working))) {
        out += text(working.slice(last, match.index));
        last = TAG.lastIndex;
        const closing = match[1] === '/';
        const tag = match[2].toLowerCase();
        if (!ALLOWED_TAGS.has(tag)) continue;          // drop the tag, keep the text
        if (closing) {
            if (!VOID_TAGS.has(tag)) out += `</${tag}>`;
            continue;
        }
        out += `<${tag}${cleanAttrs(tag, match[3])}>`;
    }
    return out + text(working.slice(last));
};

module.exports = {
    ENTITY_TYPES,
    MAX_TITLE_LENGTH,
    isObjectIdString,
    generateShareToken,
    isShareToken,
    validateCreateShare,
    validateIntakeSubmission,
    escapeHtml,
    sanitizeDocHtml,
};
