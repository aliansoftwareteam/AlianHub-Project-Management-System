const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const OPEN_DROPDOWN = /<DropDown(?=[\s>/])/g;
const MODE_ATTR = /(?:^|\s)(?::|v-bind:)?mode\s*=/;
const BUTTON_SLOT = /(?:^|\s)(?:#button|v-slot:button)(?=[\s=>]|$)/;

// Attribute values may hold `>` (`:z-index="a > b ? 1 : 2"`), so the tag ends at the first `>` outside quotes.
function endOfTag(source, from) {
    let quote = null;
    for (let i = from; i < source.length; i++) {
        const ch = source[i];
        if (quote) {
            if (ch === quote) quote = null;
        } else if (ch === '"' || ch === "'") {
            quote = ch;
        } else if (ch === '>') {
            return i;
        }
    }
    return source.length;
}

function closingIndex(source, from, name) {
    const pattern = new RegExp(`<${name}(?=[\\s>/])|</${name}\\s*>`, 'g');
    pattern.lastIndex = from;
    let depth = 1;
    let match;
    while ((match = pattern.exec(source))) {
        if (match[0].startsWith('</')) {
            depth -= 1;
            if (depth === 0) return match.index;
        } else if (source[endOfTag(source, match.index) - 1] !== '/') {
            depth += 1;
        }
    }
    return source.length;
}

function ownTriggerSlot(body) {
    const nested = /<DropDown(?=[\s>/])/.exec(body);
    const own = nested ? body.slice(0, nested.index) : body;
    const templates = /<template(?=[\s>])/g;
    let match;
    while ((match = templates.exec(own))) {
        const tagEnd = endOfTag(body, match.index);
        const attrs = body.slice(match.index + '<template'.length, tagEnd);
        if (BUTTON_SLOT.test(attrs)) {
            return { attrs, content: body.slice(tagEnd + 1, closingIndex(body, tagEnd + 1, 'template')) };
        }
    }
    return null;
}

function findDropDownUses(source) {
    const uses = [];
    let match;
    OPEN_DROPDOWN.lastIndex = 0;
    while ((match = OPEN_DROPDOWN.exec(source))) {
        const tagEnd = endOfTag(source, match.index);
        const attrs = source.slice(match.index + '<DropDown'.length, tagEnd);
        const selfClosing = source[tagEnd - 1] === '/';
        const body = selfClosing ? '' : source.slice(tagEnd + 1, closingIndex(source, tagEnd + 1, 'DropDown'));
        const slot = ownTriggerSlot(body);
        uses.push({
            line: source.slice(0, match.index).split('\n').length,
            hasMode: MODE_ATTR.test(attrs),
            nestsButton: Boolean(slot && /<button(?=[\s>])/i.test(slot.content) && !/\btriggerAttrs\b/.test(slot.attrs)),
        });
    }
    return uses;
}

function vueFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return vueFiles(full);
        return entry.name.endsWith('.vue') ? [full] : [];
    });
}

function usesByFile(root) {
    return vueFiles(root).map((file) => ({
        file: path.relative(REPO, file).split(path.sep).join('/'),
        uses: findDropDownUses(fs.readFileSync(file, 'utf8')),
    }));
}

function countUsesWithoutMode(root) {
    const counts = {};
    for (const { file, uses } of usesByFile(root)) {
        const missing = uses.filter((use) => !use.hasMode).length;
        if (missing) counts[file] = missing;
    }
    return counts;
}

function findNestedTriggerButtons(root) {
    return usesByFile(root).flatMap(({ file, uses }) => uses.filter((use) => use.hasMode && use.nestsButton).map((use) => `${file}:${use.line}`));
}

module.exports = { findDropDownUses, countUsesWithoutMode, findNestedTriggerButtons };
