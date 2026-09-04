#!/usr/bin/env node
/* i18n discipline, no dependencies.
   - every locale under frontend/src/locales must carry every key en.js has
     (run `npm run i18n:backfill` after adding keys to en.js);
   - .vue templates must not ship bare text, title, placeholder or aria-label
     outside $t(); scripts/i18n-allowlist.json is a per-file baseline that may
     only shrink.
   Usage: node scripts/i18n-check.js [--write-allowlist] [--json] */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LOCALES_DIR = path.join(ROOT, 'frontend', 'src', 'locales');
const SRC_DIR = path.join(ROOT, 'frontend', 'src');
const ALLOWLIST = path.join(__dirname, 'i18n-allowlist.json');
const SOURCE_LOCALE = 'en';

/* Locale modules are `export default {...}` object literals, some spreading a
   sibling they import; evaluating the literal with those siblings injected is
   the only dependency-free way to read them without a transpiler. */
const loaded = new Map();
function loadLocale(file) {
    if (loaded.has(file)) return loaded.get(file);
    const text = fs.readFileSync(file, 'utf8');
    const names = [];
    const values = [];
    const body = text
        .replace(/^\s*import\s+(\w+)\s+from\s+["']\.\/(\w+)["'];?\s*$/gm, (_, name, sibling) => {
            names.push(name);
            values.push(loadLocale(path.join(path.dirname(file), `${sibling}.js`)));
            return '';
        })
        .replace(/^\s*export\s+default\s*/m, 'return ');
    // eslint-disable-next-line no-new-func
    const value = new Function(...names, body)(...values);
    loaded.set(file, value);
    return value;
}

function flatten(obj, prefix = '', out = {}) {
    Object.keys(obj || {}).forEach((key) => {
        const value = obj[key];
        const full = prefix ? `${prefix}.${key}` : key;
        if (value && typeof value === 'object' && !Array.isArray(value)) flatten(value, full, out);
        else out[full] = value;
    });
    return out;
}

function localeFiles() {
    return fs.readdirSync(LOCALES_DIR)
        .filter((name) => /^[a-zA-Z]+\.js$/.test(name) && name !== 'main.js')
        .map((name) => ({ code: name.replace(/\.js$/, ''), file: path.join(LOCALES_DIR, name) }));
}

function checkLocales() {
    const locales = localeFiles();
    const source = locales.find((l) => l.code === SOURCE_LOCALE);
    if (!source) throw new Error(`${SOURCE_LOCALE}.js not found in ${LOCALES_DIR}`);
    const sourceKeys = flatten(loadLocale(source.file));
    const keys = Object.keys(sourceKeys);
    return locales.filter((l) => l.code !== SOURCE_LOCALE).map((l) => {
        const own = flatten(loadLocale(l.file));
        const missing = keys.filter((k) => !(k in own));
        const extra = Object.keys(own).filter((k) => !(k in sourceKeys));
        return { code: l.code, total: keys.length, present: keys.length - missing.length, missing, extra };
    });
}

/* --- hardcoded text in templates --- */
const ATTRS = ['title', 'placeholder', 'placeHolder', 'aria-label'];
const IGNORED_TEXT = /^[\s\d\W_]*$/;
const WORD = /[A-Za-z]{2,}/;

function walk(dir, out = []) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== 'node_modules') walk(full, out);
        } else if (entry.name.endsWith('.vue')) {
            out.push(full);
        }
    });
    return out;
}

function templateOf(source) {
    const start = source.indexOf('<template');
    const end = source.lastIndexOf('</template>');
    if (start === -1 || end === -1) return '';
    return source.slice(source.indexOf('>', start) + 1, end).replace(/<!--[\s\S]*?-->/g, '');
}

const ATTR = new RegExp(`(^|\\s)(${ATTRS.join('|')})=("([^"]*)"|'([^']*)')`, 'g');

/* Walks tags and text by hand: a `>` inside an attribute value (`w > 767`, `=>`)
   must not end the tag, which a regex over the raw template gets wrong. */
function scanTemplate(template) {
    const findings = [];
    const lineOf = (index) => template.slice(0, index).split('\n').length;
    const flag = (index, kind, raw) => {
        const value = raw.replace(/\{\{[\s\S]*?\}\}/g, ' ').replace(/\s+/g, ' ').trim();
        if (value && WORD.test(value) && !IGNORED_TEXT.test(value)) findings.push({ line: lineOf(index), kind, value });
    };

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
            const tag = template.slice(start, i);
            i += 1;
            let m;
            ATTR.lastIndex = 0;
            while ((m = ATTR.exec(tag))) flag(start, m[2], m[4] !== undefined ? m[4] : m[5]);
        } else {
            const start = i;
            while (i < template.length && template[i] !== '<') i += 1;
            flag(start, 'text', template.slice(start, i));
        }
    }
    return findings;
}

function scanHardcoded() {
    const results = {};
    walk(SRC_DIR).forEach((file) => {
        const findings = scanTemplate(templateOf(fs.readFileSync(file, 'utf8')));
        if (findings.length) results[path.relative(ROOT, file)] = findings;
    });
    return results;
}

function readAllowlist() {
    try { return JSON.parse(fs.readFileSync(ALLOWLIST, 'utf8')); } catch (_) { return { files: {} }; }
}

function compareToAllowlist(scan, allowlist) {
    const over = [];
    Object.keys(scan).forEach((file) => {
        const allowed = Number((allowlist.files || {})[file]) || 0;
        if (scan[file].length > allowed) over.push({ file, allowed, found: scan[file].length, samples: scan[file].slice(0, 3) });
    });
    const shrinkable = Object.keys(allowlist.files || {}).filter((file) => ((scan[file] || []).length) < allowlist.files[file]);
    return { over, shrinkable };
}

function writeAllowlist(scan) {
    const files = {};
    Object.keys(scan).sort().forEach((file) => { files[file] = scan[file].length; });
    fs.writeFileSync(ALLOWLIST, `${JSON.stringify({ files }, null, 2)}\n`);
    return files;
}

function main(argv) {
    const json = argv.includes('--json');
    const write = argv.includes('--write-allowlist');
    const locales = checkLocales();
    const scan = scanHardcoded();
    if (write) writeAllowlist(scan);
    const { over, shrinkable } = compareToAllowlist(scan, readAllowlist());
    const hardcodedTotal = Object.values(scan).reduce((n, list) => n + list.length, 0);
    const failing = locales.filter((l) => l.missing.length);

    if (json) {
        console.log(JSON.stringify({ locales: locales.map((l) => ({ code: l.code, present: l.present, total: l.total, missing: l.missing.length, extra: l.extra.length })), hardcoded: { files: Object.keys(scan).length, findings: hardcodedTotal, over } }, null, 2));
    } else {
        console.log('Locale coverage against en.js');
        locales.forEach((l) => console.log(`  ${l.code.padEnd(5)} ${String(l.present).padStart(5)}/${l.total}  missing ${l.missing.length}  obsolete ${l.extra.length}`));
        console.log(`Hardcoded template text: ${hardcodedTotal} finding(s) in ${Object.keys(scan).length} file(s)${write ? ' — allowlist written' : ''}`);
        over.forEach((o) => {
            console.log(`  ${o.file}: ${o.found} > ${o.allowed} allowed`);
            o.samples.forEach((s) => console.log(`      line ${s.line} ${s.kind}: ${JSON.stringify(s.value)}`));
        });
        if (shrinkable.length) console.log(`  ${shrinkable.length} file(s) improved — run with --write-allowlist to lower the baseline`);
    }
    if (failing.length) {
        console.error(`\n${failing.length} locale(s) miss keys that en.js has. Run: npm run i18n:backfill`);
    }
    if (over.length) console.error(`\n${over.length} file(s) added hardcoded text. Wrap it in $t() or, for a deliberate exception, raise scripts/i18n-allowlist.json.`);
    return failing.length || over.length ? 1 : 0;
}

module.exports = { loadLocale, flatten, localeFiles, checkLocales, scanTemplate, scanHardcoded, readAllowlist, compareToAllowlist, writeAllowlist, SOURCE_LOCALE, LOCALES_DIR };

if (require.main === module) process.exit(main(process.argv.slice(2)));
