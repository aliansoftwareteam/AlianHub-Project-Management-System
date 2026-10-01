'use strict';

const sanitizeHtml = require('sanitize-html');
const { LINK_SCHEMES, LINK_URL, WEB_URL, IMAGE_URL, LINK_TARGET, LINK_REL, cleanStyle, isKnownFrame, profiles } = require('./richTextAllowlist');

/* Rich text is held to the lists in richTextAllowlist.js when it is saved, so a reader that is not the web app (the
 * API, an agent, a share page, an export) gets the same text the web app would draw. `cleanBlocks` takes the document
 * the block editor stores, `cleanHtml` a string of HTML. The result is written the way a browser writes HTML, so a
 * document the editor made comes back as it went in. */

const LIMITS = Object.freeze({ blocks: 5000, items: 20000, depth: 12, tagDepth: 100, textLength: 1024 * 1024 });

const REFUSALS = Object.freeze({
    blocks: `Text can hold up to ${LIMITS.blocks} blocks.`,
    items: `Text can hold up to ${LIMITS.items} list items and table cells.`,
    depth: `Text can be nested up to ${LIMITS.depth} levels deep.`,
    tagDepth: `Formatting can be nested up to ${LIMITS.tagDepth} tags deep.`,
    textLength: `One piece of text can be up to ${LIMITS.textLength} characters long.`,
});

class RichTextLimitError extends Error {
    constructor(limit) {
        super(REFUSALS[limit]);
        this.name = 'RichTextLimitError';
        this.limit = limit;
        this.statusCode = 400;
    }
}

// A tag that is not kept goes with everything inside it when what is inside is not words to read.
const NON_TEXT_TAGS = [
    'script', 'style', 'textarea', 'option', 'noscript', 'iframe', 'noembed', 'noframes', 'xmp', 'plaintext',
    'svg', 'math', 'template', 'title', 'head', 'audio', 'video', 'object',
];
const LINK_ATTRIBUTES = ['href', 'target', 'rel'];
const NBSP = /\u00a0/g;
const VOID_END = /(<[a-z][a-z0-9]*(?:\s[^<>]*?)?) \/>/g;
const READ_AS_HTML = /[<>&\u00a0]/;

const heldAttributes = (tagName, given, profile) => {
    const attribs = { ...given };
    if (attribs.class !== undefined && profile.classes) {
        const kept = attribs.class.split(/\s+/).filter((name) => profile.classes.includes(name));
        if (kept.length) attribs.class = kept.join(' ');
        else delete attribs.class;
    }
    if (attribs.style !== undefined) {
        const style = cleanStyle(attribs.style, profile.styleProperties);
        if (style) attribs.style = style;
        else delete attribs.style;
    }
    if (tagName === 'a') {
        const href = String(attribs.href || '').trim();
        if (LINK_URL.test(href)) Object.assign(attribs, { href, target: LINK_TARGET, rel: LINK_REL });
        else LINK_ATTRIBUTES.forEach((name) => delete attribs[name]);
    }
    if (tagName === 'img') {
        const src = String(attribs.src || '').trim();
        if (IMAGE_URL.test(src)) attribs.src = src;
        else delete attribs.src;
    }
    return attribs;
};

const optionsFor = (profile, tags, textFilter) => ({
    allowedTags: [...tags],
    allowedAttributes: {
        a: LINK_ATTRIBUTES.filter((name) => profile.attributes.includes(name)),
        ...(profile.images ? { img: ['src'] } : {}),
        '*': [
            ...profile.attributes.filter((name) => !LINK_ATTRIBUTES.includes(name) && name !== 'src'),
            ...(profile.ariaAttributes ? ['aria-*'] : []),
        ],
    },
    allowedSchemes: [],
    allowedSchemesByTag: { a: [...LINK_SCHEMES], img: ['http', 'https', 'data'] },
    allowProtocolRelative: false,
    parseStyleAttributes: false,
    nonTextTags: NON_TEXT_TAGS,
    transformTags: { '*': (tagName, attribs) => ({ tagName, attribs: heldAttributes(tagName, attribs, profile) }) },
    ...(textFilter ? { textFilter } : {}),
});

/* sanitize-html closes a void tag as XHTML does and writes a non-breaking space as the character; a browser writes
 * `<br>` and `&nbsp;`. A `<` comes out escaped everywhere but at the start of a tag, and a `>` in every attribute
 * value, so the first pattern matches a whole tag and nothing else. */
const asBrowserWrites = (html) => html.replace(VOID_END, '$1>').replace(NBSP, '&nbsp;');

const TAG_START = /<(\/?)([a-z][a-z0-9]*)/gi;
// A tag with no end, or one the next of its kind closes, so text written without end tags is not counted as nested.
const NEVER_NESTS = [
    'br', 'hr', 'img', 'col', 'input', 'meta', 'link', 'area', 'base', 'wbr', 'embed', 'source', 'track', 'param',
    'p', 'li', 'tr', 'td', 'th', 'dt', 'dd', 'option',
];

/* The parser keeps its open tags in a list it shifts on every tag, so its work grows with the square of the nesting. */
const tagDepthOf = (html) => {
    let depth = 0;
    let deepest = 0;
    for (const [, closing, name] of html.matchAll(TAG_START)) {
        if (NEVER_NESTS.includes(name.toLowerCase())) continue;
        depth = closing ? Math.max(0, depth - 1) : depth + 1;
        deepest = Math.max(deepest, depth);
    }
    return deepest;
};

const cleanerOf = (options) => (value) => {
    if (value.length > LIMITS.textLength) throw new RichTextLimitError('textLength');
    if (!READ_AS_HTML.test(value)) return value;
    if (tagDepthOf(value) > LIMITS.tagDepth) throw new RichTextLimitError('tagDepth');
    return asBrowserWrites(sanitizeHtml(value, options));
};

// A description held as text may be markdown, where a line that starts with `>` is a quote.
const keepQuoteMark = (text) => text.replace(/&gt;/g, '>');

const CLEANERS = Object.freeze(Object.fromEntries(Object.entries(profiles).map(([name, profile]) => [name, {
    profile,
    inline: cleanerOf(optionsFor(profile, profile.inlineTags)),
    text: cleanerOf(optionsFor(profile, [...profile.blockTags, ...profile.inlineTags], name === 'strict' ? keepQuoteMark : null)),
}])));

const cleanersFor = (profileName) => {
    const cleaners = CLEANERS[profileName];
    if (!cleaners) throw new Error(`Unknown rich text profile: ${profileName}`);
    return cleaners;
};

const cleanHtml = (value, profileName = 'strict') => (value === undefined || value === null
    ? value
    : cleanersFor(profileName).text(String(value)));

const BLOCK_TYPE = /^[A-Za-z][\w-]{0,39}$/;
const BLOCK_ID = /^[\w-]{1,64}$/;
const KEY = /^[A-Za-z_][\w-]{0,63}$/;
const UNSAFE_KEYS = ['__proto__', 'prototype', 'constructor'];
const MARKUP = /[<>]/;
const ADDRESS_KEYS = ['url', 'src', 'href', 'source', 'link'];

const HTML_FIELDS = Object.freeze({
    quote: ['text', 'caption'],
    warning: ['title', 'message'],
    embed: ['caption'],
});
const DEFAULT_HTML_FIELDS = ['text'];
// What the app's own tools read and write as plain text, and code, which the editor sets as a text area's value.
const TEXT_FIELDS = Object.freeze({
    code: ['code'],
    image: ['caption'],
    task: ['title'],
    taskList: ['projectName'],
});
// What the editor's tools read without checking that it is there.
const ALWAYS = Object.freeze({
    paragraph: () => ({ text: '' }),
    header: () => ({ text: '' }),
    list: () => ({ items: [] }),
    checklist: () => ({ items: [] }),
    table: () => ({ content: [] }),
});
const ITEM_ALWAYS = Object.freeze({
    list: () => ({ content: '', items: [] }),
    checklist: () => ({ text: '' }),
});
const nothing = () => ({});

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const keysOf = (record) => Object.keys(record).filter((key) => KEY.test(key) && !UNSAFE_KEYS.includes(key));
const withMissing = (record, missing) => ({ ...record, ...Object.fromEntries(Object.entries(missing).filter(([key]) => !(key in record))) });

const escapeText = (value) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttribute = (value) => escapeText(value).replace(/"/g, '&quot;');

const walkerOf = (cleaners) => {
    const address = cleaners.profile.images ? IMAGE_URL : WEB_URL;
    let items = 0;

    const html = (value) => (typeof value === 'string' ? cleaners.inline(value) : '');

    const text = (value) => {
        if (typeof value !== 'string') return '';
        if (value.length > LIMITS.textLength) throw new RichTextLimitError('textLength');
        return value;
    };

    const counted = (list) => {
        items += list.length;
        if (items > LIMITS.items) throw new RichTextLimitError('items');
        return list;
    };

    const deeper = (depth) => {
        if (depth > LIMITS.depth) throw new RichTextLimitError('depth');
        return depth + 1;
    };

    /* A value no tool here is known to draw is kept only when it cannot carry markup; `undefined` drops its key. */
    const plain = (value, key, depth) => {
        if (value === null || typeof value === 'boolean') return value;
        if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
        if (typeof value === 'string') {
            if (value.length > LIMITS.textLength) throw new RichTextLimitError('textLength');
            if (ADDRESS_KEYS.includes(key)) return address.test(value.trim()) ? value.trim() : '';
            return MARKUP.test(value) ? undefined : value;
        }
        if (Array.isArray(value)) {
            const next = deeper(depth);
            return counted(value).map((entry) => plain(entry, '', next)).filter((entry) => entry !== undefined);
        }
        return isRecord(value) ? plainRecord(value, deeper(depth)) : undefined;
    };

    const plainRecord = (record, depth, known = () => undefined) => {
        const kept = {};
        keysOf(record).forEach((key) => {
            const value = known(key, record[key]);
            const held = value === undefined ? plain(record[key], key, depth) : value;
            if (held !== undefined) kept[key] = held;
        });
        return kept;
    };

    const listItems = (list, depth, always) => {
        if (!Array.isArray(list)) return [];
        const next = deeper(depth);
        return counted(list).map((item) => {
            if (typeof item === 'string') return html(item);
            if (!isRecord(item)) return always();
            return withMissing(plainRecord(item, next, (key, value) => {
                if (key === 'content' || key === 'text') return html(value);
                return key === 'items' ? listItems(value, next, always) : undefined;
            }), always());
        });
    };

    const tableRows = (rows) => (Array.isArray(rows) ? rows : []).map((row) => (Array.isArray(row) ? counted(row).map(html) : []));

    const blockData = (type, data) => {
        const htmlFields = HTML_FIELDS[type] || DEFAULT_HTML_FIELDS;
        const textFields = TEXT_FIELDS[type] || [];
        return withMissing(plainRecord(data, 1, (key, value) => {
            if (htmlFields.includes(key)) return html(value);
            if (textFields.includes(key)) return text(value);
            if (key === 'items') return listItems(value, 1, ITEM_ALWAYS[type] || nothing);
            if (key === 'content' && type === 'table') return tableRows(value);
            // Held to the frames the editor builds before a block reaches here.
            if (key === 'embed' && type === 'embed') return value;
            return undefined;
        }), (ALWAYS[type] || nothing)());
    };

    /* A frame to anywhere else is not kept; the address it was made from stays as a link. */
    const sourceLink = (given, source) => {
        const address = typeof source === 'string' ? source.trim() : '';
        const link = CLEANERS.strict.inline(`<a href="${escapeAttribute(address)}">${escapeText(address)}</a>`);
        if (!link.includes('href=')) return null;
        return { ...(typeof given.id === 'string' && BLOCK_ID.test(given.id) ? { id: given.id } : {}), type: 'paragraph', data: { text: link } };
    };

    const block = (given) => {
        if (!isRecord(given) || typeof given.type !== 'string' || !BLOCK_TYPE.test(given.type)) return null;
        const data = isRecord(given.data) ? given.data : {};
        if (given.type === 'embed' && !isKnownFrame(data.embed)) return sourceLink(given, data.source);
        const kept = plainRecord(given, 1, (key) => {
            if (key === 'type') return given.type;
            return key === 'data' ? blockData(given.type, data) : undefined;
        });
        return kept.data ? kept : { ...kept, data: blockData(given.type, {}) };
    };

    const blocks = (list) => {
        if (list.length > LIMITS.blocks) throw new RichTextLimitError('blocks');
        return list.map(block).filter(Boolean);
    };

    const document = (given) => plainRecord(given, 0, (key, value) => (key === 'blocks' && Array.isArray(value) ? blocks(value) : undefined));

    return { blocks, document };
};

/* The document the block editor stores, or its list of blocks, or the text an older description holds in its place. */
const cleanBlocks = (given, profileName = 'strict') => {
    const cleaners = cleanersFor(profileName);
    if (typeof given === 'string') return cleaners.text(given);
    if (Array.isArray(given)) return walkerOf(cleaners).blocks(given);
    return isRecord(given) ? walkerOf(cleaners).document(given) : given;
};

const ENTITIES = { '&nbsp;': ' ', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&amp;': '&' };
const readable = (html) => String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(NBSP, ' ')
    .replace(/&(nbsp|lt|gt|quot|#39|amp);/g, (entity) => ENTITIES[entity])
    .trim();

const wordsOf = (value) => (typeof value === 'string' ? readable(value) : '');

const itemLines = (items, depth = 0) => (Array.isArray(items) && depth < LIMITS.depth ? items : []).flatMap((item) => {
    const line = `${'  '.repeat(depth)}- ${wordsOf(isRecord(item) ? (item.content || item.text) : item)}`;
    return [line, ...itemLines(isRecord(item) ? item.items : null, depth + 1)];
});

const blocksIn = (document) => {
    if (Array.isArray(document)) return document;
    return isRecord(document) && Array.isArray(document.blocks) ? document.blocks : [];
};

/* The words of a document, for the plain text a description keeps beside it. */
const plainTextOf = (document, max = 10000) => blocksIn(document).filter(isRecord).flatMap((block) => {
    const data = isRecord(block.data) ? block.data : {};
    if (Array.isArray(data.items)) return itemLines(data.items);
    if (block.type === 'table') return (Array.isArray(data.content) ? data.content : []).map((row) => (Array.isArray(row) ? row : []).map(wordsOf).join(' | '));
    if (block.type === 'code') return [typeof data.code === 'string' ? data.code : ''];
    return [wordsOf(data.text), wordsOf(data.caption)];
}).filter(Boolean).join('\n').slice(0, max);

const DESCRIPTION_FIELDS = Object.freeze(['description', 'descriptionBlock', 'rawDescription']);

/* The description a task or project is about to store, held to the strict list where it stands. `rawDescription` is
 * plain text and stays as sent while it says what the document says; when cleaning took words out of the document it
 * is read again from what was kept. */
const cleanDescription = (fields) => {
    if (!isRecord(fields)) return fields;
    if (typeof fields.description === 'string') fields.description = cleanHtml(fields.description, 'strict');
    if (fields.rawDescription !== undefined && fields.rawDescription !== null) {
        if (typeof fields.rawDescription !== 'string') fields.rawDescription = '';
        if (fields.rawDescription.length > LIMITS.textLength) throw new RichTextLimitError('textLength');
    }
    if (fields.descriptionBlock !== undefined && fields.descriptionBlock !== null) {
        const sent = fields.descriptionBlock;
        fields.descriptionBlock = cleanBlocks(sent, 'strict');
        const mirrored = typeof fields.rawDescription === 'string' && blocksIn(sent).length > 0;
        if (mirrored && plainTextOf(sent) !== plainTextOf(fields.descriptionBlock)) fields.rawDescription = plainTextOf(fields.descriptionBlock);
    }
    return fields;
};

/* The body a doc page is about to store, in the forms it is given in. */
const cleanPageContent = (content) => {
    if (!isRecord(content)) return {};
    return {
        ...(content.html !== undefined && content.html !== null ? { html: cleanHtml(content.html, 'doc') } : {}),
        ...(content.blocks !== undefined && content.blocks !== null ? { blocks: cleanBlocks(content.blocks, 'doc') } : {}),
    };
};

module.exports = { LIMITS, DESCRIPTION_FIELDS, RichTextLimitError, cleanBlocks, cleanHtml, cleanDescription, cleanPageContent, plainTextOf };
