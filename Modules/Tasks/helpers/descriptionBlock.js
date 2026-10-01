/* A task description as the editor stores it, built from plain text or simple markdown, with nothing required so the
 * web app can share it. The task panel reads `descriptionBlock`; `rawDescription` is the plain text beside it that
 * search reads. The editor puts a block's text on the page as HTML, so every character of the source is escaped and the
 * only markup written here is a link to an http or https address, shown as that address. */

const EDITOR_VERSION = '2.30.7';
const MAX_BLOCKS = 1000;

const BULLET = /^\s*[-*+•]\s+(.*)$/;
const NUMBERED = /^\s*\d{1,3}[.)]\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const NAMED_LINK = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;
const ADDRESS = /https?:\/\/[^\s<>"'`]+/g;
const TRAILING = /[.,;:!?)\]]+$/;

const escapeHtml = (value) => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const hrefOf = (address) => {
    try {
        const url = new URL(address);
        return ['http:', 'https:'].includes(url.protocol) && url.hostname ? address : '';
    } catch (_error) {
        return '';
    }
};

const anchor = (address) => {
    const href = hrefOf(address);
    return href ? `<a href="${escapeHtml(href)}">${escapeHtml(address)}</a>` : escapeHtml(address);
};

/* A link never hides where it goes: "[the spec](https://…)" reads "the spec (https://…)". */
const linked = (text) => {
    const plain = text.replace(NAMED_LINK, (_whole, label, address) => (label.trim() === address ? address : `${label} (${address})`));
    let html = '';
    let last = 0;
    for (const match of plain.matchAll(ADDRESS)) {
        const address = match[0].replace(TRAILING, '');
        html += escapeHtml(plain.slice(last, match.index)) + anchor(address);
        last = match.index + address.length;
    }
    return html + escapeHtml(plain.slice(last));
};

const listBlock = (style, items) => ({ type: 'list', data: { style, items: items.map((content) => ({ content, items: [] })) } });

const blocksFrom = (text, inline) => {
    const blocks = [];
    let list = null;
    const closeList = () => {
        if (list) blocks.push(listBlock(list.style, list.items));
        list = null;
    };
    const listItem = (style, content) => {
        if (!list || list.style !== style) closeList();
        list = list || { style, items: [] };
        list.items.push(inline(content.trim()));
    };
    text.split(/\r?\n/).forEach((line) => {
        const bullet = BULLET.exec(line);
        const numbered = NUMBERED.exec(line);
        const heading = HEADING.exec(line);
        if (bullet && bullet[1].trim()) return listItem('unordered', bullet[1]);
        if (numbered && numbered[1].trim()) return listItem('ordered', numbered[1]);
        closeList();
        if (!line.trim()) return undefined;
        if (heading && heading[2].trim()) return blocks.push({ type: 'header', data: { text: inline(heading[2].trim()), level: heading[1].length } });
        return blocks.push({ type: 'paragraph', data: { text: inline(line.trim()) } });
    });
    closeList();
    return blocks.slice(0, MAX_BLOCKS);
};

/* `links: false` leaves addresses as text: for words a stranger sent in, where a ready link is a lure. */
const descriptionBlockFrom = (text, { links = true } = {}) => {
    const body = typeof text === 'string' ? text : '';
    if (!body.trim()) return {};
    return { time: Date.now(), version: EDITOR_VERSION, blocks: blocksFrom(body, links ? linked : escapeHtml) };
};

const hasBlocks = (block) => Boolean(block) && typeof block === 'object' && Array.isArray(block.blocks) && block.blocks.length > 0;

const hasText = (value) => typeof value === 'string' && value.trim() !== '';

/* Whether the panel has a description to show without help: an editor document, or the text form older tasks hold in
 * `descriptionBlock` or `description`. */
const showsDescription = (task) => hasBlocks(task.descriptionBlock) || hasText(task.descriptionBlock) || hasText(task.description);

/* The document for a description held as text alone, or null when the task needs none. A task with an `origin` was
 * filed from outside (an email, a public form, a webhook). */
const descriptionBlockFor = (task) => (!task || showsDescription(task) || !hasText(task.rawDescription)
    ? null
    : descriptionBlockFrom(task.rawDescription, { links: !task.origin }));

/* Every new task document passes through here, so an importer, an inbound email or any later creator that brings only
 * text still shows its description. */
const withDescriptionBlock = (task) => {
    const block = descriptionBlockFor(task);
    if (block) task.descriptionBlock = block;
    return task;
};

module.exports = { EDITOR_VERSION, descriptionBlockFrom, descriptionBlockFor, withDescriptionBlock, hasBlocks };
