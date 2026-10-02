'use strict';

/* What rich text may hold, read by the web app when it draws stored text and by the API when it stores it, with nothing
 * required so the web bundle can share it. `strict` is a task or project description: words and structure, no image,
 * frame, style or handler. `doc` is a doc page: also pictures, colour, alignment and the marks the app's own blocks
 * and mentions carry. */

const LINK_SCHEMES = Object.freeze(['http', 'https', 'mailto']);
const LINK_URL = new RegExp(`^(${LINK_SCHEMES.join('|')}):`, 'i');
const WEB_URL = /^https?:/i;
const IMAGE_URL = /^(https?:|data:image\/(png|gif|jpe?g|webp|bmp);)/i;
const LINK_TARGET = '_blank';
const LINK_REL = 'noopener noreferrer';

const STRICT = Object.freeze({
    inlineTags: Object.freeze(['b', 'strong', 'i', 'em', 'u', 's', 'del', 'mark', 'code', 'a', 'br', 'sub', 'sup']),
    blockTags: Object.freeze(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td']),
    attributes: Object.freeze(['href', 'target', 'rel', 'class', 'colspan', 'rowspan']),
    // The classes the editor's inline code and marker tools put on their tags.
    classes: Object.freeze(['inline-code', 'cdx-marker']),
    ariaAttributes: false,
    styleProperties: Object.freeze([]),
    images: false,
});

const DOC_TAGS = Object.freeze([
    'p', 'br', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li',
    'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'mark', 'sub', 'sup', 'code', 'pre', 'blockquote',
    'a', 'img', 'figure', 'figcaption', 'aside', 'hr',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'colgroup', 'col',
]);

const DOC = Object.freeze({
    inlineTags: DOC_TAGS,
    blockTags: Object.freeze([]),
    attributes: Object.freeze([
        'href', 'target', 'rel', 'src', 'alt', 'title', 'class', 'style', 'colspan', 'rowspan', 'width', 'height',
        'spellcheck', 'data-list', 'data-checked', 'data-tone', 'data-task-id', 'data-project-id', 'data-status-type', 'data-service',
        'data-mention', 'data-id', 'data-image-key',
    ]),
    classes: null,
    ariaAttributes: true,
    // Colour, highlight and alignment, as the older editor wrote them inline.
    styleProperties: Object.freeze(['color', 'background-color', 'text-align']),
    images: true,
});

/* A plain colour or keyword, so no url(), expression() or escape can ride along. */
const STYLE_VALUE = /^(#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)|[a-z]+)$/i;

const cleanStyle = (css, properties = DOC.styleProperties) => String(css).split(';').map((part) => {
    const at = part.indexOf(':');
    if (at < 0) return '';
    const prop = part.slice(0, at).trim().toLowerCase();
    const value = part.slice(at + 1).trim();
    return properties.includes(prop) && STYLE_VALUE.test(value) ? `${prop}:${value}` : '';
}).filter(Boolean).join(';');

// The frames the embed tool builds for the services it knows; a gist is a script from gist.github.com in a data: frame.
const EMBED_HOSTS = Object.freeze([
    'player.vimeo.com', 'www.youtube.com', 'coub.com', 'vine.co', 'imgur.com', 'gfycat.com', 'player.twitch.tv', 'music.yandex.ru',
    'codepen.io', 'www.instagram.com', 'platform.twitter.com', 'assets.pinterest.com', 'www.facebook.com', 'www.aparat.com', 'miro.com',
]);
const GIST_FRAME = /^data:text\/html;charset=utf-8,<head><base target="_blank" \/><\/head><body><script src="https:\/\/gist\.github\.com\/[\w.-]+\/[0-9a-f]+\.js" ><\/script><\/body>$/;

const isKnownFrame = (address) => {
    if (typeof address !== 'string') return false;
    if (GIST_FRAME.test(address)) return true;
    try {
        const url = new URL(address);
        return url.protocol === 'https:' && EMBED_HOSTS.includes(url.hostname);
    } catch (_error) {
        return false;
    }
};

module.exports = {
    LINK_SCHEMES,
    LINK_URL,
    WEB_URL,
    IMAGE_URL,
    LINK_TARGET,
    LINK_REL,
    STYLE_VALUE,
    EMBED_HOSTS,
    GIST_FRAME,
    cleanStyle,
    isKnownFrame,
    profiles: Object.freeze({ strict: STRICT, doc: DOC }),
};
