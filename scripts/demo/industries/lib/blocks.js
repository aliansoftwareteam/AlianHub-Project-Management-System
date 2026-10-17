/* The scenario files' text, written as markdown, as the editor blocks a doc or a description stores. The app's own
 * markdownToBlocks escapes everything and knows no tables, so the guide's tables and bold need this. Supported:
 * headings, paragraphs, - and 1. lists, **bold**, | tables | with a header row, and "> " lines as an info callout. */

const escapeHtml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const inline = (text) => escapeHtml(text.trim()).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
const cellsOf = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => inline(cell));
const isSeparator = (line) => /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/.test(line.trim());

function markdownBlocks(markdown) {
    const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
    const blocks = [];
    let paragraph = [];
    let list = null;
    let table = null;
    let callout = [];

    const flushParagraph = () => {
        if (paragraph.length) blocks.push({ type: 'paragraph', data: { text: paragraph.map(inline).join('<br>') } });
        paragraph = [];
    };
    const flushList = () => {
        if (list) blocks.push({ type: 'list', data: { style: list.ordered ? 'ordered' : 'unordered', items: list.items.map((item) => ({ content: inline(item), items: [] })) } });
        list = null;
    };
    const flushTable = () => {
        if (table) blocks.push({ type: 'table', data: { withHeadings: true, content: table } });
        table = null;
    };
    const flushCallout = () => {
        if (callout.length) blocks.push({ type: 'callout', data: { tone: 'info', text: callout.map(inline).join('<br>') } });
        callout = [];
    };
    const flushAll = () => { flushParagraph(); flushList(); flushTable(); flushCallout(); };

    for (const line of lines) {
        const heading = line.match(/^(#{1,6})\s+(.*)$/);
        const bullet = line.match(/^\s*[-*]\s+(.*)$/);
        const numbered = line.match(/^\s*\d+\.\s+(.*)$/);
        const quote = line.match(/^>\s?(.*)$/);
        if (!line.trim()) flushAll();
        else if (heading) {
            flushAll();
            blocks.push({ type: 'header', data: { text: inline(heading[2]), level: heading[1].length } });
        } else if (line.trim().startsWith('|')) {
            if (!table) flushAll();
            if (!isSeparator(line)) (table = table || []).push(cellsOf(line));
        } else if (quote) {
            if (!callout.length) flushAll();
            callout.push(quote[1]);
        } else if (bullet || numbered) {
            const ordered = Boolean(numbered);
            if (!list || list.ordered !== ordered) { flushAll(); list = { ordered, items: [] }; }
            list.items.push((bullet || numbered)[1]);
        } else {
            if (!paragraph.length) flushAll();
            paragraph.push(line);
        }
    }
    flushAll();
    return blocks;
}

module.exports = { markdownBlocks };
