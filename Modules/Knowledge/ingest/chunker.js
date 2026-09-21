const crypto = require('crypto');
const { blocksToHtml } = require('../../Pages/helpers/pageContent');

// Chunks follow the page's own structure: a section per heading, split on paragraph
// boundaries only when a section outgrows a chunk. The title opens the first chunk and no
// other, so a word in the title matches one chunk instead of every chunk of the page.

const MAX_CHUNK_CHARS = 1200;
const HEADING = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi;
const BLOCK_END = /<\/(?:p|li|pre|blockquote|tr|div|ul|ol|table|figure|figcaption)\s*>|<br\s*\/?>/gi;
const ENTITIES = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'" };

const decode = (text) => text.replace(/&(?:nbsp|amp|lt|gt|quot|#39|#x27);/gi, (entity) => ENTITIES[entity.toLowerCase()]);

const inlineText = (html) => decode(String(html || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

const paragraphsOf = (html) => String(html || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(BLOCK_END, '\n')
    .split('\n')
    .map(inlineText)
    .filter(Boolean);

const escapeHtml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* Plain text as the chunker's html, reading markdown headings: an agent draft is saved as text. */
const textToHtml = (text) => String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    return heading ? `<h${heading[1].length}>${escapeHtml(heading[2])}</h${heading[1].length}>` : `<p>${escapeHtml(line)}</p>`;
}).join('');

/* The full body when there is one. rawText is cut at 5,000 characters for list previews on a page
 * written in the editor, so it is only read for a page saved without a body, as agent drafts are. */
const htmlOf = (page) => {
    const content = page && page.content;
    if (typeof content === 'string' && content.trim()) return content;
    if (content && typeof content.html === 'string' && content.html.trim()) return content.html;
    if (content && Array.isArray(content.blocks) && content.blocks.length) return blocksToHtml(content);
    return textToHtml(page && page.rawText);
};

const sectionsOf = (html) => {
    const sections = [{ level: 0, heading: '', start: 0, end: html.length }];
    for (const match of html.matchAll(HEADING)) {
        sections[sections.length - 1].end = match.index;
        sections.push({ level: Number(match[1]), heading: inlineText(match[2]), start: match.index + match[0].length, end: html.length });
    }
    return sections.map((section) => ({ ...section, paragraphs: paragraphsOf(html.slice(section.start, section.end)) }));
};

const splitWords = (line, maxChars) => {
    const out = [];
    let current = '';
    line.split(' ').forEach((word) => {
        if (word.length > maxChars) {
            if (current) out.push(current);
            current = '';
            for (let at = 0; at < word.length; at += maxChars) out.push(word.slice(at, at + maxChars));
            return;
        }
        const next = current ? `${current} ${word}` : word;
        if (next.length > maxChars) {
            out.push(current);
            current = word;
        } else {
            current = next;
        }
    });
    if (current) out.push(current);
    return out;
};

const pack = (lines, maxChars) => {
    const out = [];
    let current = [];
    let size = 0;
    lines.flatMap((line) => (line.length > maxChars ? splitWords(line, maxChars) : [line])).forEach((line) => {
        if (current.length && size + 1 + line.length > maxChars) {
            out.push(current.join('\n'));
            current = [];
            size = 0;
        }
        size += (current.length ? 1 : 0) + line.length;
        current.push(line);
    });
    if (current.length) out.push(current.join('\n'));
    return out;
};

const contentHashOf = (headingPath, text) => crypto.createHash('sha256').update(JSON.stringify([headingPath, text])).digest('hex');

const chunkHtml = (rawTitle, html, maxChars) => {
    const title = inlineText(rawTitle);
    const [intro, ...sections] = sectionsOf(html);
    const open = [];
    const pieces = [];
    const add = (headingPath, lines) => pack(lines.filter(Boolean), maxChars).forEach((text) => pieces.push({ headingPath, text }));

    add([title], [title, ...intro.paragraphs]);
    sections.forEach((section) => {
        while (open.length && open[open.length - 1].level >= section.level) open.pop();
        open.push(section);
        add([title, ...open.map((s) => s.heading).filter(Boolean)], [section.heading, ...section.paragraphs]);
    });

    return pieces.map((piece, ordinal) => ({ ordinal, ...piece, contentHash: contentHashOf(piece.headingPath, piece.text) }));
};

const chunkPage = (page, { maxChars = MAX_CHUNK_CHARS } = {}) => chunkHtml(page && page.title, htmlOf(page), maxChars);

/* Markdown and extracted file text go the way an agent draft does: headings open sections. */
const chunkText = (title, text, { maxChars = MAX_CHUNK_CHARS } = {}) => chunkHtml(escapeHtml(String(title || '')), textToHtml(text), maxChars);

const MENTION = /\[([^\]]*)\]\([0-9a-fA-F]{24}\)/g;

const piecesOf = (headingPath, lines, maxChars) => pack(lines.filter(Boolean), maxChars)
    .map((text, ordinal) => ({ ordinal, headingPath, text, contentHash: contentHashOf(headingPath, text) }));

/* A mention is stored as "[Name](userId)"; the name is what a question would use. */
const chunkComment = (comment, { maxChars = MAX_CHUNK_CHARS } = {}) => {
    const message = String((comment && comment.message) || '').replace(MENTION, '@$1');
    return piecesOf([], paragraphsOf(message.replace(/\r?\n/g, '<br>')), maxChars);
};

const linesOf = (text) => String(text || '').split(/\r?\n/).map((line) => line.replace(/\s+/g, ' ').trim());

const actionItemText = (item) => (item && typeof item === 'object' ? [item.title, item.owner].filter(Boolean).join(' · ') : String(item || ''));

/* No synthetic section headings: a word like "summary" would otherwise match every call. */
const chunkTranscript = (call, { maxChars = MAX_CHUNK_CHARS } = {}) => {
    const title = String((call && call.title) || '').trim() || 'Call notes';
    const items = Array.isArray(call && call.actionItems) ? call.actionItems.map(actionItemText) : [];
    return piecesOf([title], [title, ...linesOf(call && call.summary), ...items, ...linesOf(call && call.transcript)], maxChars);
};

module.exports = { MAX_CHUNK_CHARS, chunkPage, chunkText, chunkComment, chunkTranscript, contentHashOf, htmlOf };
