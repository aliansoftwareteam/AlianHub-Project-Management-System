#!/usr/bin/env node
/* Style discipline, no dependencies. Colours come from the tokens in
   frontend/src/assets/css/tokens.css; what frontend/src still hard-codes is a
   per-file baseline (scripts/style-baseline.json) that may only shrink.

   Counted per .vue, .css and .scss file:
   - hard-coded colours: hex (#rgb, #rgba, #rrggbb, #rrggbbaa), rgb()/rgba()/
     hsl()/hsla() with literal arguments, and CSS colour names. They are read
     from declaration values only, in stylesheets, <style> blocks and style= /
     :style= attributes. Selectors, comments, strings, url(), var() including
     its fallback, <script>, and svg attributes such as fill= are not read. A
     colour name counts only in a property that takes a colour, or inside a
     string of a :style binding. The token sheet itself is exempt.
   - legacy classes: uses in class= / :class= of a class that a legacy sheet in
     frontend/src/assets/css defines with a hard-coded colour or font value.

   Usage: node scripts/style-check.js [--baseline [--allow-increase]] [--top [n]] [--json] [file ...] */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'frontend', 'src');
const LEGACY_DIR = path.join(SRC_DIR, 'assets', 'css');
const BASELINE = path.join(__dirname, 'style-baseline.json');
const TOKEN_FILES = ['frontend/src/assets/css/tokens.css'];
const KINDS = ['colours', 'legacyClasses'];
const LABEL = { colours: 'hard-coded colours', legacyClasses: 'legacy classes' };

const NAMED_COLOURS = [
    'aliceblue', 'antiquewhite', 'aqua', 'aquamarine', 'azure', 'beige', 'bisque', 'black', 'blanchedalmond', 'blue',
    'blueviolet', 'brown', 'burlywood', 'cadetblue', 'chartreuse', 'chocolate', 'coral', 'cornflowerblue', 'cornsilk',
    'crimson', 'cyan', 'darkblue', 'darkcyan', 'darkgoldenrod', 'darkgray', 'darkgreen', 'darkgrey', 'darkkhaki',
    'darkmagenta', 'darkolivegreen', 'darkorange', 'darkorchid', 'darkred', 'darksalmon', 'darkseagreen',
    'darkslateblue', 'darkslategray', 'darkslategrey', 'darkturquoise', 'darkviolet', 'deeppink', 'deepskyblue',
    'dimgray', 'dimgrey', 'dodgerblue', 'firebrick', 'floralwhite', 'forestgreen', 'fuchsia', 'gainsboro',
    'ghostwhite', 'gold', 'goldenrod', 'gray', 'green', 'greenyellow', 'grey', 'honeydew', 'hotpink', 'indianred',
    'indigo', 'ivory', 'khaki', 'lavender', 'lavenderblush', 'lawngreen', 'lemonchiffon', 'lightblue', 'lightcoral',
    'lightcyan', 'lightgoldenrodyellow', 'lightgray', 'lightgreen', 'lightgrey', 'lightpink', 'lightsalmon',
    'lightseagreen', 'lightskyblue', 'lightslategray', 'lightslategrey', 'lightsteelblue', 'lightyellow', 'lime',
    'limegreen', 'linen', 'magenta', 'maroon', 'mediumaquamarine', 'mediumblue', 'mediumorchid', 'mediumpurple',
    'mediumseagreen', 'mediumslateblue', 'mediumspringgreen', 'mediumturquoise', 'mediumvioletred', 'midnightblue',
    'mintcream', 'mistyrose', 'moccasin', 'navajowhite', 'navy', 'oldlace', 'olive', 'olivedrab', 'orange',
    'orangered', 'orchid', 'palegoldenrod', 'palegreen', 'paleturquoise', 'palevioletred', 'papayawhip', 'peachpuff',
    'peru', 'pink', 'plum', 'powderblue', 'purple', 'rebeccapurple', 'red', 'rosybrown', 'royalblue', 'saddlebrown',
    'salmon', 'sandybrown', 'seagreen', 'seashell', 'sienna', 'silver', 'skyblue', 'slateblue', 'slategray',
    'slategrey', 'snow', 'springgreen', 'steelblue', 'tan', 'teal', 'thistle', 'tomato', 'turquoise', 'violet',
    'wheat', 'white', 'whitesmoke', 'yellow', 'yellowgreen'
];
const LITERAL = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])|\b(?:rgba?|hsla?)\(\s*[-+.\d][^)]*\)?/gi;
const NAMED = new RegExp(`(?<![\\w#.$@-])(?:${NAMED_COLOURS.join('|')})(?![\\w(-])`, 'gi');
const TAKES_COLOUR = /^(?:--|\$|@)|colou?r|background|border|outline|shadow|fill|stroke|decoration|column-rule|caret/;
const TYPOGRAPHY = /^(?:font|font-family|font-size|font-weight|font-style|line-height|letter-spacing)$/;

/* Everything that is masked keeps its length and its newlines, so an index in
   the masked text is still an index in the file. */
const blank = (text) => text.replace(/[^\n]/g, ' ');

function maskVar(text) {
    let out = text;
    let from = 0;
    for (;;) {
        const start = out.indexOf('var(', from);
        if (start === -1) return out;
        let depth = 0;
        let end = start + 3;
        for (; end < out.length; end += 1) {
            if (out[end] === '(') depth += 1;
            else if (out[end] === ')' && (depth -= 1) === 0) break;
        }
        out = out.slice(0, start) + blank(out.slice(start, end + 1)) + out.slice(end + 1);
        from = end;
    }
}

function maskCss(css, { lineComments = false } = {}) {
    let out = css.replace(/\/\*[\s\S]*?\*\//g, blank)
        .replace(/url\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\)/gi, blank)
        .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, blank);
    if (lineComments) out = out.replace(/\/\/[^\n]*/g, blank);
    return maskVar(out.replace(/#\{[^}]*\}/g, blank));
}

function matches(regex, text, offset, out) {
    regex.lastIndex = 0;
    let m;
    while ((m = regex.exec(text))) out.push({ kind: 'colour', index: offset + m.index, value: m[0] });
}

function declarations(masked) {
    const list = [];
    let start = 0;
    const push = (end) => {
        const text = masked.slice(start, end);
        const colon = text.indexOf(':');
        list.push({
            property: colon === -1 ? '' : text.slice(0, colon).trim().toLowerCase(),
            value: text.slice(colon + 1),
            index: start + colon + 1
        });
    };
    for (let i = 0; i < masked.length; i += 1) {
        const c = masked[i];
        if (c === '{') start = i + 1;
        else if (c === ';' || c === '}') { push(i); start = i + 1; }
    }
    push(masked.length);
    return list;
}

function withLines(source, findings) {
    const sorted = findings.sort((a, b) => a.index - b.index);
    let line = 1;
    let at = 0;
    return sorted.map((f) => {
        for (; at < f.index; at += 1) if (source[at] === '\n') line += 1;
        return { kind: f.kind, line, value: f.value };
    });
}

function rawCssFindings(css, options) {
    const out = [];
    declarations(maskCss(css, options)).forEach((d) => {
        matches(LITERAL, d.value, d.index, out);
        if (TAKES_COLOUR.test(d.property)) matches(NAMED, d.value, d.index, out);
    });
    return out;
}

function cssFindings(css, options) {
    return withLines(css, rawCssFindings(css, options));
}

const STRING = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;

function boundStyleFindings(expression) {
    const out = [];
    const masked = maskVar(expression);
    matches(LITERAL, masked, 0, out);
    STRING.lastIndex = 0;
    let m;
    while ((m = STRING.exec(masked))) matches(NAMED, m[0].slice(1, -1), m.index + 1, out);
    return out;
}

function classNames(text, offset, legacy, out) {
    const word = /[^\s\0]+/g;
    let m;
    while ((m = word.exec(text))) {
        const glued = text[m.index - 1] === '\0' || text[m.index + m[0].length] === '\0';
        if (!glued && legacy.has(m[0])) out.push({ kind: 'legacy', index: offset + m.index, value: m[0] });
    }
}

/* A :class expression names classes as string literals and as object keys;
   an identifier anywhere else is a variable, and a string beside a comparison
   is a value being tested, not a class being applied. */
function boundClassFindings(expression, offset, legacy, out) {
    let i = 0;
    let previous = '';
    while (i < expression.length) {
        const c = expression[i];
        if (c === "'" || c === '"') {
            let end = i + 1;
            while (end < expression.length && expression[end] !== c) end += expression[end] === '\\' ? 2 : 1;
            const compared = /[=!]==?\s*$/.test(expression.slice(0, i)) || /^\s*[=!]==?/.test(expression.slice(end + 1));
            if (!compared) classNames(expression.slice(i + 1, end), offset + i + 1, legacy, out);
            i = end + 1;
            previous = c;
        } else if (c === '`') {
            let end = i + 1;
            let literal = '';
            while (end < expression.length && expression[end] !== '`') {
                if (expression.startsWith('${', end)) {
                    let depth = 0;
                    let close = end + 1;
                    for (; close < expression.length; close += 1) {
                        if (expression[close] === '{') depth += 1;
                        else if (expression[close] === '}' && (depth -= 1) === 0) break;
                    }
                    boundClassFindings(expression.slice(end + 2, close), offset + end + 2, legacy, out);
                    literal += '\0'.repeat(close + 1 - end);
                    end = close + 1;
                } else {
                    literal += expression[end];
                    end += 1;
                }
            }
            classNames(literal, offset + i + 1, legacy, out);
            i = end + 1;
            previous = c;
        } else if (/[A-Za-z_$]/.test(c)) {
            let end = i + 1;
            while (end < expression.length && /[\w$]/.test(expression[end])) end += 1;
            const name = expression.slice(i, end);
            const isKey = (previous === '{' || previous === ',') && /^\s*:/.test(expression.slice(end));
            if (isKey && legacy.has(name)) out.push({ kind: 'legacy', index: offset + i, value: name });
            i = end;
            previous = 'a';
        } else {
            if (!/\s/.test(c)) previous = c;
            i += 1;
        }
    }
}

const STYLE_BLOCK = /<style\b([^>]*)>([\s\S]*?)<\/style>/gi;
const ATTRIBUTE = /(?:^|\s)(:|v-bind:)?(style|class)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/* Walks tags by hand for the reason scripts/i18n-check.js does: a `>` inside
   an attribute value must not end the tag and a `<` inside an interpolation
   must not start one. */
function tagsOf(template) {
    const tags = [];
    let i = 0;
    while (i < template.length) {
        if (template[i] === '<') {
            const start = i;
            let quote = null;
            i += 1;
            while (i < template.length) {
                const c = template[i];
                if (quote) { if (c === quote) quote = null; }
                else if (c === '"' || c === "'") quote = c;
                else if (c === '>') break;
                i += 1;
            }
            tags.push({ index: start, text: template.slice(start, i) });
            i += 1;
        } else if (template.startsWith('{{', i)) {
            const close = template.indexOf('}}', i + 2);
            i = close === -1 ? template.length : close + 2;
        } else {
            i += 1;
        }
    }
    return tags;
}

function vueFindings(source, legacy = new Set()) {
    const out = [];
    let m;
    STYLE_BLOCK.lastIndex = 0;
    while ((m = STYLE_BLOCK.exec(source))) {
        if (m[1].trim().endsWith('/')) { STYLE_BLOCK.lastIndex = m.index + m[1].length + 7; continue; }
        const bodyAt = m.index + m[0].indexOf('>') + 1;
        const lineComments = /\blang\s*=\s*["']?(?:scss|sass|less|styl)/i.test(m[1]);
        rawCssFindings(m[2], { lineComments }).forEach((f) => out.push({ ...f, index: f.index + bodyAt }));
    }

    const open = source.indexOf('<template');
    const close = source.lastIndexOf('</template>');
    if (open !== -1 && close > open) {
        const template = source.slice(0, close).replace(/<!--[\s\S]*?-->/g, blank);
        tagsOf(template.slice(open)).forEach((tag) => {
            ATTRIBUTE.lastIndex = 0;
            let a;
            while ((a = ATTRIBUTE.exec(tag.text))) {
                const value = a[3] !== undefined ? a[3] : a[4];
                const at = open + tag.index + a.index + a[0].length - 1 - value.length;
                const found = [];
                if (a[2] === 'style') found.push(...(a[1] ? boundStyleFindings(value) : rawCssFindings(value)));
                else if (a[1]) boundClassFindings(value, 0, legacy, found);
                else classNames(value, 0, legacy, found);
                found.forEach((f) => out.push({ ...f, index: f.index + at }));
            }
        });
    }
    return withLines(source, out);
}

function legacyClassesIn(css) {
    const masked = maskCss(css);
    const names = new Set();
    let start = 0;
    let selector = null;
    for (let i = 0; i < masked.length; i += 1) {
        const c = masked[i];
        if (c === '{') {
            selector = masked.slice(start, i).trim();
            start = i + 1;
        } else if (c === '}') {
            if (selector && !selector.startsWith('@')) {
                const body = declarations(masked.slice(start, i));
                const hardCoded = body.some((d) => {
                    const found = [];
                    matches(LITERAL, d.value, 0, found);
                    if (TAKES_COLOUR.test(d.property)) matches(NAMED, d.value, 0, found);
                    return found.length > 0 || (TYPOGRAPHY.test(d.property) && d.value.trim() !== '');
                });
                if (hardCoded) {
                    selector.split(',').forEach((part) => {
                        const single = /^\.([\w-]+)(?:::?[\w-]+(?:\([^)]*\))?)*$/.exec(part.trim());
                        if (single) names.add(single[1]);
                    });
                }
            }
            selector = null;
            start = i + 1;
        } else if (c === ';') {
            if (selector === null) start = i + 1;
        }
    }
    return [...names].sort();
}

const toPosix = (file) => path.relative(ROOT, file).split(path.sep).join('/');

function legacyClassSet() {
    const names = new Set();
    fs.readdirSync(LEGACY_DIR).filter((name) => name.endsWith('.css')).sort().forEach((name) => {
        const file = path.join(LEGACY_DIR, name);
        if (TOKEN_FILES.includes(toPosix(file))) return;
        legacyClassesIn(fs.readFileSync(file, 'utf8')).forEach((cls) => names.add(cls));
    });
    return names;
}

function walk(dir, out = []) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== 'node_modules') walk(full, out);
        } else if (/\.(vue|css|scss)$/.test(entry.name)) {
            out.push(full);
        }
    });
    return out;
}

function fileFindings(file, legacy) {
    const relative = toPosix(file);
    if (TOKEN_FILES.includes(relative)) return [];
    const source = fs.readFileSync(file, 'utf8');
    if (file.endsWith('.vue')) return vueFindings(source, legacy);
    return cssFindings(source, { lineComments: file.endsWith('.scss') });
}

function scanTree() {
    const legacy = legacyClassSet();
    const counts = {};
    walk(SRC_DIR).forEach((file) => {
        const findings = fileFindings(file, legacy);
        if (!findings.length) return;
        const legacyClasses = findings.filter((f) => f.kind === 'legacy').length;
        counts[toPosix(file)] = { colours: findings.length - legacyClasses, legacyClasses };
    });
    return counts;
}

function readBaseline() {
    try { return JSON.parse(fs.readFileSync(BASELINE, 'utf8')); } catch (_) { return { files: {} }; }
}

const countOf = (entry, kind) => Number((entry || {})[kind]) || 0;

function compareToBaseline(scan, baseline) {
    const allowed = baseline.files || {};
    const over = [];
    const stale = [];
    [...new Set([...Object.keys(scan), ...Object.keys(allowed)])].sort().forEach((file) => {
        KINDS.forEach((kind) => {
            const row = { file, kind, found: countOf(scan[file], kind), allowed: countOf(allowed[file], kind) };
            if (row.found > row.allowed) over.push(row);
            else if (row.found < row.allowed) stale.push(row);
        });
    });
    return { over, stale };
}

function nextBaseline(scan, baseline, { allowIncrease = false } = {}) {
    const allowed = baseline.files || {};
    const { over } = compareToBaseline(scan, baseline);
    const files = {};
    Object.keys(scan).sort().forEach((file) => {
        const entry = {};
        KINDS.forEach((kind) => {
            const found = countOf(scan[file], kind);
            entry[kind] = allowIncrease ? found : Math.min(found, countOf(allowed[file], kind));
        });
        if (KINDS.some((kind) => entry[kind] > 0)) files[file] = entry;
    });
    return { files, refused: allowIncrease ? [] : over, raised: allowIncrease ? over : [] };
}

function formatBaseline(files) {
    const lines = Object.keys(files).sort().map((file) => {
        const counts = KINDS.map((kind) => `"${kind}": ${countOf(files[file], kind)}`).join(', ');
        return `    ${JSON.stringify(file)}: { ${counts} }`;
    });
    return lines.length ? `{\n  "files": {\n${lines.join(',\n')}\n  }\n}\n` : '{\n  "files": {}\n}\n';
}

const row = (r) => `${r.file}: ${r.found} ${LABEL[r.kind]}, baseline ${r.allowed}`;

function describeDrift(over, stale) {
    const parts = [];
    if (over.length) {
        parts.push([
            'Hard-coded colours or legacy classes added:',
            ...over.map((r) => `  ${row(r)}\n      list them: npm run style:check -- ${r.file}`),
            'Use a token from frontend/src/assets/css/tokens.css (var(--surface), var(--ink), var(--brand), ...) or an ah- class.'
        ].join('\n'));
    }
    if (stale.length) {
        parts.push([
            'The baseline is higher than the code now needs:',
            ...stale.map((r) => `  ${row(r)}`),
            'Lower it in the same change: npm run style:baseline'
        ].join('\n'));
    }
    return parts.join('\n\n');
}

const totals = (counts) => KINDS.reduce((sum, kind) => {
    sum[kind] = Object.values(counts).reduce((n, entry) => n + countOf(entry, kind), 0);
    sum[`${kind}Files`] = Object.values(counts).filter((entry) => countOf(entry, kind) > 0).length;
    return sum;
}, {});

function main(argv) {
    const flags = argv.filter((arg) => arg.startsWith('--'));
    const files = argv.filter((arg) => !arg.startsWith('--') && !/^\d+$/.test(arg));
    const scan = scanTree();
    const baseline = readBaseline();

    if (files.length) {
        const legacy = legacyClassSet();
        files.forEach((file) => {
            const findings = fileFindings(path.resolve(ROOT, file), legacy);
            console.log(`${file}: ${findings.length} finding(s)`);
            findings.forEach((f) => console.log(`  line ${String(f.line).padStart(5)}  ${f.kind === 'legacy' ? 'legacy class' : 'colour      '}  ${f.value}`));
        });
        return 0;
    }

    if (flags.includes('--baseline')) {
        const next = nextBaseline(scan, baseline, { allowIncrease: flags.includes('--allow-increase') });
        fs.writeFileSync(BASELINE, formatBaseline(next.files));
        next.raised.forEach((r) => console.log(`raised   ${row(r)}`));
        const sum = totals(next.files);
        console.log(`Baseline written: ${sum.colours} hard-coded colours in ${sum.coloursFiles} file(s), ${sum.legacyClasses} legacy classes in ${sum.legacyClassesFiles} file(s)`);
        if (next.refused.length) {
            console.error(`\nNot raised:\n${next.refused.map((r) => `  ${row(r)}`).join('\n')}\nUse a token instead. A deliberate exception is: npm run style:baseline -- --allow-increase`);
            return 1;
        }
        return 0;
    }

    const { over, stale } = compareToBaseline(scan, baseline);
    const sum = totals(scan);
    if (flags.includes('--json')) {
        console.log(JSON.stringify({ totals: sum, over, stale, files: scan }, null, 2));
    } else {
        console.log(`Hard-coded colours: ${sum.colours} in ${sum.coloursFiles} file(s)`);
        console.log(`Legacy classes:     ${sum.legacyClasses} in ${sum.legacyClassesFiles} file(s)`);
        if (flags.includes('--top')) {
            const n = Number(argv[argv.indexOf('--top') + 1]) || 25;
            KINDS.forEach((kind) => {
                console.log(`\nTop ${n} by ${LABEL[kind]}`);
                Object.keys(scan).sort((a, b) => countOf(scan[b], kind) - countOf(scan[a], kind) || a.localeCompare(b)).slice(0, n)
                    .filter((file) => countOf(scan[file], kind) > 0)
                    .forEach((file) => console.log(`  ${String(countOf(scan[file], kind)).padStart(5)}  ${file}`));
            });
        }
    }
    const drift = describeDrift(over, stale);
    if (drift) console.error(`\n${drift}`);
    return drift ? 1 : 0;
}

module.exports = {
    cssFindings, vueFindings, legacyClassesIn, legacyClassSet, scanTree, readBaseline,
    compareToBaseline, nextBaseline, formatBaseline, describeDrift, BASELINE, TOKEN_FILES, NAMED_COLOURS
};

if (require.main === module) process.exit(main(process.argv.slice(2)));
