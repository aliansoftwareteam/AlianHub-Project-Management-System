/* Past this many cells the comparison table costs more than the answer is worth; the two sides are shown whole. */
const MAX_CELLS = 1000000;

const ENTITIES = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#039;': "'" };

const plainText = (html) => String(html == null ? '' : html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:nbsp|amp|lt|gt|quot|#0?39);/g, (entity) => ENTITIES[entity])
    .replace(/[^\S\n]+/g, ' ')
    .trim();

const itemLines = (items) => (Array.isArray(items) ? items : []).flatMap((item) => {
    if (typeof item === 'string') return [plainText(item)];
    if (!item || typeof item !== 'object') return [];
    return [plainText(item.content || item.text), ...itemLines(item.items)];
});

export function blockText(block) {
    const data = (block && block.data) || {};
    switch (block && block.type) {
        case 'list':
            return itemLines(data.items).join('\n');
        case 'checklist':
            return (data.items || []).map((item) => `[${item && item.checked ? 'x' : ' '}] ${plainText(item && item.text)}`).join('\n');
        case 'code':
            return String(data.code || '');
        case 'table':
            return (data.content || []).map((row) => (row || []).map(plainText).join(' | ')).join('\n');
        case 'image':
            return plainText(data.caption);
        case 'embed':
            return plainText(data.caption || data.source || data.embed);
        case 'task':
            return `${data.taskKey || ''} ${plainText(data.title)}`.trim();
        case 'taskList':
            return plainText(data.projectName);
        default:
            return plainText(data.text);
    }
}

/* Lengths of the longest common run of `a[i:]` and `b[j:]`, or null when the table would be too large. */
function commonLengths(a, b, same) {
    const width = b.length + 1;
    if ((a.length + 1) * width > MAX_CELLS) return null;
    const table = new Uint32Array((a.length + 1) * width);
    for (let i = a.length - 1; i >= 0; i -= 1) {
        for (let j = b.length - 1; j >= 0; j -= 1) {
            table[i * width + j] = same(a[i], b[j])
                ? table[(i + 1) * width + j + 1] + 1
                : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
        }
    }
    return (i, j) => table[i * width + j];
}

/* Steps from `a` to `b`: a pair kept on both sides, an item only in `a`, or an item only in `b`. */
function steps(a, b, same) {
    const lengths = commonLengths(a, b, same);
    if (!lengths) return [...a.map((before) => ({ before })), ...b.map((after) => ({ after }))];
    const out = [];
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
        if (same(a[i], b[j])) {
            out.push({ before: a[i], after: b[j] });
            i += 1;
            j += 1;
        } else if (lengths(i + 1, j) >= lengths(i, j + 1)) {
            out.push({ before: a[i] });
            i += 1;
        } else {
            out.push({ after: b[j] });
            j += 1;
        }
    }
    for (; i < a.length; i += 1) out.push({ before: a[i] });
    for (; j < b.length; j += 1) out.push({ after: b[j] });
    return out;
}

/* A word travels with the space before it, so the pieces join back into the text. */
const wordsOf = (text) => String(text || '').match(/\s*\S+/g) || [];
const sameWord = (a, b) => a.trim() === b.trim();

export function diffWords(before, after) {
    const a = wordsOf(before);
    const b = wordsOf(after);
    let head = 0;
    while (head < a.length && head < b.length && sameWord(a[head], b[head])) head += 1;
    let tail = 0;
    while (tail < a.length - head && tail < b.length - head && sameWord(a[a.length - 1 - tail], b[b.length - 1 - tail])) tail += 1;

    const segments = [];
    const push = (kind, text) => {
        const last = segments[segments.length - 1];
        if (last && last.kind === kind) last.text += text;
        else segments.push({ kind, text });
    };
    b.slice(0, head).forEach((word) => push('same', word));
    steps(a.slice(head, a.length - tail), b.slice(head, b.length - tail), sameWord).forEach((step) => {
        if (step.before !== undefined && step.after !== undefined) push('same', step.after);
        else if (step.before !== undefined) push('removed', step.before);
        else push('added', step.after);
    });
    b.slice(b.length - tail).forEach((word) => push('same', word));
    return segments;
}

const canonical = (value) => JSON.stringify(value, (key, inner) => (inner && typeof inner === 'object' && !Array.isArray(inner)
    ? Object.fromEntries(Object.keys(inner).sort().map((name) => [name, inner[name]]))
    : inner));

const contentOf = (block) => `${block.type}:${canonical(block.data || {})}`;
/* A block keeps its id for life; one from the old history has none and is known by what it says. */
const identityOf = (block) => (block.id ? `id:${block.id}` : `content:${contentOf(block)}`);

const listOf = (blocks) => {
    const list = Array.isArray(blocks) ? blocks : ((blocks && blocks.blocks) || []);
    return list.filter((block) => block && typeof block === 'object');
};

const changedRow = (before, after) => {
    const from = blockText(before);
    const to = blockText(after);
    return { kind: 'changed', before, after, words: diffWords(from, to), textChanged: from !== to };
};

/* Blocks without ids that were swapped for the same kind of block read as one changed block, not a pair. */
function pairUnidentified(rows) {
    const out = [];
    for (let at = 0; at < rows.length;) {
        let end = at;
        while (end < rows.length && rows[end].kind === 'removed') end += 1;
        const removed = rows.slice(at, end);
        let stop = end;
        while (stop < rows.length && rows[stop].kind === 'added') stop += 1;
        const added = rows.slice(end, stop);
        if (!removed.length || !added.length) {
            out.push(rows[at]);
            at += 1;
        } else {
            const pairs = Math.min(removed.length, added.length);
            const pairable = (i) => !removed[i].before.id && !added[i].after.id && removed[i].before.type === added[i].after.type;
            for (let i = 0; i < pairs; i += 1) {
                if (pairable(i)) out.push(changedRow(removed[i].before, added[i].after));
                else out.push(removed[i]);
            }
            for (let i = 0; i < pairs; i += 1) if (!pairable(i)) out.push(added[i]);
            out.push(...removed.slice(pairs), ...added.slice(pairs));
            at = stop;
        }
    }
    return out;
}

export function diffBlocks(before, after) {
    const rows = steps(listOf(before), listOf(after), (a, b) => identityOf(a) === identityOf(b)).map((step) => {
        if (step.before === undefined) return { kind: 'added', after: step.after };
        if (step.after === undefined) return { kind: 'removed', before: step.before };
        return contentOf(step.before) === contentOf(step.after) ? { kind: 'same', before: step.before, after: step.after } : changedRow(step.before, step.after);
    });
    return pairUnidentified(rows);
}

export function diffSummary(rows) {
    const count = (kind) => (rows || []).filter((row) => row.kind === kind).length;
    return { added: count('added'), removed: count('removed'), changed: count('changed') };
}
