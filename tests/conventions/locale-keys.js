const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', '..', 'frontend', 'src');

// Locale files are ES modules of one object literal; evaluating the literal is
// enough to read them from Jest without a bundler.
function loadLocale(file) {
    const code = fs.readFileSync(file, 'utf8').replace(/^export default/m, 'module.exports =');
    const sandbox = { module: { exports: {} } };
    vm.runInNewContext(code, sandbox, { filename: file });
    return sandbox.module.exports;
}

function flatten(obj, prefix = '', out = {}) {
    for (const [key, value] of Object.entries(obj)) {
        const full = prefix ? `${prefix}.${key}` : key;
        if (value && typeof value === 'object' && !Array.isArray(value)) flatten(value, full, out);
        else out[full] = value;
    }
    return out;
}

function walk(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== 'node_modules' && entry.name !== 'locales') walk(full, out);
        } else if (/\.(vue|js)$/.test(entry.name)) out.push(full);
    }
    return out;
}

const KEY_CALL = /(?:\$t|\bte|\bt|i18n\.global\.t)\(\s*['"]([A-Za-z][A-Za-z0-9_]*\.[A-Za-z0-9_.]+)['"]/g;
const QUOTED_V2 = /['"`]([A-Za-z]+V2)\.[A-Za-z0-9_]/g;

// Every string key passed to t()/te()/$t() with a literal first argument, and
// every quoted `<Namespace>V2.` prefix, by file.
function scanSources(srcDir = SRC) {
    const keys = [];
    const v2 = [];
    for (const file of walk(srcDir)) {
        const text = fs.readFileSync(file, 'utf8');
        const rel = path.relative(srcDir, file);
        for (const m of text.matchAll(KEY_CALL)) keys.push({ key: m[1], file: rel });
        for (const m of text.matchAll(QUOTED_V2)) v2.push({ namespace: m[1], file: rel });
    }
    return { keys, v2 };
}

// `t('Inbox.tab_' + kind)` reaches the regex as a prefix; it resolves when any key
// starts with it.
const resolves = (flat, key) => key in flat || Object.keys(flat).some((k) => k.startsWith(key.endsWith('.') || key.endsWith('_') ? key : `${key}.`));

module.exports = { SRC, loadLocale, flatten, scanSources, resolves };
