'use strict';

const EDITOR_VERSION = '2.30.7';

const escapeHtml = (value) => String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const stripTags = (html) => String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

const emptyEditorData = () => ({
    time: Date.now(),
    blocks: [],
    version: EDITOR_VERSION,
});

const listItemContent = (item) => {
    if (item == null) return '';
    if (typeof item === 'string') return item;
    return String(item.content || item.text || '');
};

const listItemChildren = (item) => {
    if (!item || typeof item !== 'object') return [];
    return Array.isArray(item.items) ? item.items : [];
};

function listItemsToHtml(items, ordered) {
    const tag = ordered ? 'ol' : 'ul';
    const inner = (items || []).map((item) => {
        const children = listItemChildren(item);
        const nested = children.length ? listItemsToHtml(children, ordered) : '';
        return `<li>${escapeHtml(listItemContent(item))}${nested}</li>`;
    }).join('');
    return `<${tag}>${inner}</${tag}>`;
}

function blockToHtml(block) {
    if (!block || typeof block !== 'object') return '';
    const data = block.data || {};
    switch (block.type) {
        case 'header': {
            const level = Math.min(6, Math.max(1, Number(data.level) || 2));
            return `<h${level}>${data.text || ''}</h${level}>`;
        }
        case 'paragraph':
            return `<p>${data.text || ''}</p>`;
        case 'list':
            return listItemsToHtml(data.items || [], data.style === 'ordered');
        case 'checklist': {
            const items = (data.items || []).map((item) => {
                const mark = item && item.checked ? 'x' : ' ';
                return `<li>[${mark}] ${escapeHtml(item && item.text)}</li>`;
            }).join('');
            return `<ul>${items}</ul>`;
        }
        case 'code':
            return `<pre><code>${escapeHtml(data.code)}</code></pre>`;
        case 'quote':
            return `<blockquote>${data.text || ''}</blockquote>`;
        case 'table': {
            const rows = (data.content || []).map((row) => {
                const cells = (row || []).map((cell) => `<td>${cell || ''}</td>`).join('');
                return `<tr>${cells}</tr>`;
            }).join('');
            return `<table>${rows}</table>`;
        }
        default:
            return data.text ? `<p>${data.text}</p>` : '';
    }
}

function blocksToHtml(editorData) {
    const blocks = Array.isArray(editorData)
        ? editorData
        : (editorData && Array.isArray(editorData.blocks) ? editorData.blocks : []);
    return blocks.map(blockToHtml).join('');
}

function blocksToRawText(editorData, max = 5000) {
    return stripTags(blocksToHtml(editorData)).slice(0, max);
}

function htmlToBlocks(html) {
    const source = String(html || '').trim();
    if (!source) return [];
    const chunks = source
        .replace(/<\/(h[1-6]|p|li|blockquote|pre)>/gi, '</$1>\n')
        .split(/\n+/)
        .map((chunk) => chunk.trim())
        .filter(Boolean);
    const blocks = [];
    chunks.forEach((chunk) => {
        const heading = chunk.match(/^<h([1-6])[^>]*>([\s\S]*)<\/h[1-6]>$/i);
        if (heading) {
            blocks.push({
                type: 'header',
                data: { text: heading[2], level: Number(heading[1]) },
            });
            return;
        }
        const pre = chunk.match(/^<pre[^>]*><code[^>]*>([\s\S]*)<\/code><\/pre>$/i)
            || chunk.match(/^<pre[^>]*>([\s\S]*)<\/pre>$/i);
        if (pre) {
            blocks.push({ type: 'code', data: { code: stripTags(pre[1]) } });
            return;
        }
        const quote = chunk.match(/^<blockquote[^>]*>([\s\S]*)<\/blockquote>$/i);
        if (quote) {
            blocks.push({ type: 'quote', data: { text: quote[1] } });
            return;
        }
        const text = chunk.startsWith('<') ? chunk.replace(/^<p[^>]*>/i, '').replace(/<\/p>$/i, '') : escapeHtml(chunk);
        if (stripTags(text)) {
            blocks.push({ type: 'paragraph', data: { text } });
        }
    });
    if (!blocks.length && source) {
        blocks.push({ type: 'paragraph', data: { text: source } });
    }
    return blocks;
}

function markdownToBlocks(markdown) {
    const text = String(markdown || '').replace(/\r\n/g, '\n');
    if (!text.trim()) return [];
    const lines = text.split('\n');
    const blocks = [];
    let paragraph = [];
    let list = null;
    let code = null;

    const flushParagraph = () => {
        const body = paragraph.join('\n').trim();
        paragraph = [];
        if (body) blocks.push({ type: 'paragraph', data: { text: escapeHtml(body).replace(/\n/g, '<br>') } });
    };
    const flushList = () => {
        if (!list) return;
        blocks.push({
            type: 'list',
            data: {
                style: list.ordered ? 'ordered' : 'unordered',
                items: list.items.map((item) => ({ content: escapeHtml(item), items: [] })),
            },
        });
        list = null;
    };

    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (code) {
            if (/^```/.test(line.trim())) {
                blocks.push({ type: 'code', data: { code: code.join('\n') } });
                code = null;
            } else {
                code.push(line);
            }
            continue;
        }
        if (/^```/.test(line.trim())) {
            flushParagraph();
            flushList();
            code = [];
            continue;
        }
        const heading = line.match(/^(#{1,6})\s+(.*)$/);
        if (heading) {
            flushParagraph();
            flushList();
            blocks.push({
                type: 'header',
                data: { text: escapeHtml(heading[2].trim()), level: heading[1].length },
            });
            continue;
        }
        const unordered = line.match(/^\s*[-*+]\s+(.*)$/);
        if (unordered) {
            flushParagraph();
            if (!list || list.ordered) {
                flushList();
                list = { ordered: false, items: [] };
            }
            list.items.push(unordered[1]);
            continue;
        }
        const ordered = line.match(/^\s*\d+\.\s+(.*)$/);
        if (ordered) {
            flushParagraph();
            if (!list || !list.ordered) {
                flushList();
                list = { ordered: true, items: [] };
            }
            list.items.push(ordered[1]);
            continue;
        }
        if (!line.trim()) {
            flushParagraph();
            flushList();
            continue;
        }
        flushList();
        paragraph.push(line);
    }
    if (code) blocks.push({ type: 'code', data: { code: code.join('\n') } });
    flushParagraph();
    flushList();
    return blocks;
}

function markdownToEditorData(markdown) {
    return {
        time: Date.now(),
        blocks: markdownToBlocks(markdown),
        version: EDITOR_VERSION,
    };
}

function contentToEditorData(content) {
    if (!content) return emptyEditorData();
    if (Array.isArray(content.blocks)) {
        return { time: Date.now(), blocks: content.blocks, version: EDITOR_VERSION };
    }
    if (content.blocks && Array.isArray(content.blocks.blocks)) {
        return content.blocks;
    }
    const html = content.html || '';
    return {
        time: Date.now(),
        blocks: htmlToBlocks(html),
        version: EDITOR_VERSION,
    };
}

const AI_ACTIONS = ['draft', 'expand', 'summarize', 'outline', 'rewrite'];

function isAiAction(action) {
    return AI_ACTIONS.includes(String(action || '').toLowerCase());
}

module.exports = {
    EDITOR_VERSION,
    AI_ACTIONS,
    isAiAction,
    emptyEditorData,
    escapeHtml,
    stripTags,
    blocksToHtml,
    blocksToRawText,
    htmlToBlocks,
    markdownToBlocks,
    markdownToEditorData,
    contentToEditorData,
};
