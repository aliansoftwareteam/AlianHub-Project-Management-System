#!/usr/bin/env node
/* Fills every locale with the keys en.js has. Missing values are machine
   translated when TRANSLATE_API_KEY (Google Translate v2) is set, otherwise
   copied from English; either way the key lands in <locale>.pending.json so
   a reviewer can find it. Rewrites the locale in en.js key order and drops
   keys en.js no longer has.
   Usage: node scripts/i18n-backfill.js [--dry-run] [--only=fr,ge] */
const fs = require('fs');
const path = require('path');
const { loadLocale, flatten, localeFiles, SOURCE_LOCALE, LOCALES_DIR } = require('./i18n-check');

const API_KEY = process.env.TRANSLATE_API_KEY || '';
const ENDPOINT = 'https://translation.googleapis.com/language/translate/v2';
/* Locale codes as the files name them, mapped to what the translation API expects. */
const TARGET = { ch: 'zh', ge: 'de', gr: 'el', spa: 'es', gu: 'gu', hi: 'hi', ptBr: 'pt', ja: 'ja', ko: 'ko', ru: 'ru', it: 'it', fr: 'fr', ar: 'ar' };

function unflatten(flat) {
    const out = {};
    Object.keys(flat).forEach((full) => {
        const parts = full.split('.');
        let node = out;
        parts.slice(0, -1).forEach((part) => {
            if (!node[part] || typeof node[part] !== 'object') node[part] = {};
            node = node[part];
        });
        node[parts[parts.length - 1]] = flat[full];
    });
    return out;
}

const serialize = (obj) => `export default ${JSON.stringify(obj, null, 4)};\n`;

async function translateBatch(texts, target) {
    const response = await fetch(`${ENDPOINT}?key=${API_KEY}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ q: texts, source: 'en', target, format: 'text' })
    });
    if (!response.ok) throw new Error(`translate ${target}: HTTP ${response.status}`);
    const body = await response.json();
    return (body.data && body.data.translations || []).map((t) => t.translatedText);
}

async function translateAll(texts, target) {
    if (!API_KEY || !target) return texts.slice();
    const out = [];
    for (let i = 0; i < texts.length; i += 100) {
        // eslint-disable-next-line no-await-in-loop
        out.push(...await translateBatch(texts.slice(i, i + 100), target));
    }
    return out;
}

function pendingPath(code) { return path.join(LOCALES_DIR, `${code}.pending.json`); }

function readPending(code) {
    try { return JSON.parse(fs.readFileSync(pendingPath(code), 'utf8')); } catch (_) { return { locale: code, keys: {} }; }
}

/* A locale that spreads en.js over itself already has every key; rewriting it
   would inline the whole catalogue. */
const inheritsSource = (file) => /^\s*import\s+\w+\s+from\s+["']\.\/en["']/m.test(fs.readFileSync(file, 'utf8'));

async function backfillLocale(locale, sourceFlat, dryRun) {
    if (inheritsSource(locale.file)) return { code: locale.code, filled: 0, dropped: 0, pending: 0, inherits: true };
    const ownFlat = flatten(loadLocale(locale.file));
    const pending = readPending(locale.code);
    const missing = Object.keys(sourceFlat).filter((k) => !(k in ownFlat));
    const obsolete = Object.keys(ownFlat).filter((k) => !(k in sourceFlat));
    const translatable = missing.filter((k) => typeof sourceFlat[k] === 'string');
    const translated = await translateAll(translatable.map((k) => sourceFlat[k]), TARGET[locale.code]);

    const next = {};
    Object.keys(sourceFlat).forEach((k) => {
        if (k in ownFlat) { next[k] = ownFlat[k]; return; }
        const at = translatable.indexOf(k);
        next[k] = at === -1 ? sourceFlat[k] : translated[at];
        pending.keys[k] = sourceFlat[k];
    });
    Object.keys(pending.keys).forEach((k) => { if (!(k in sourceFlat)) delete pending.keys[k]; });

    if (!dryRun && (missing.length || obsolete.length)) {
        fs.writeFileSync(locale.file, serialize(unflatten(next)));
    }
    if (!dryRun && missing.length) {
        fs.writeFileSync(pendingPath(locale.code), `${JSON.stringify({ locale: locale.code, machineTranslated: !!(API_KEY && TARGET[locale.code]), updatedAt: new Date().toISOString(), keys: pending.keys }, null, 2)}\n`);
    }
    return { code: locale.code, filled: missing.length, dropped: obsolete.length, pending: Object.keys(pending.keys).length };
}

async function main(argv) {
    const dryRun = argv.includes('--dry-run');
    const only = (argv.find((a) => a.startsWith('--only=')) || '').replace('--only=', '').split(',').filter(Boolean);
    const locales = localeFiles();
    const source = locales.find((l) => l.code === SOURCE_LOCALE);
    const sourceFlat = flatten(loadLocale(source.file));
    const targets = locales.filter((l) => l.code !== SOURCE_LOCALE && (!only.length || only.includes(l.code)));
    console.log(`${API_KEY ? 'Machine translating' : 'Copying English'} for ${targets.length} locale(s)${dryRun ? ' (dry run)' : ''}`);
    for (const locale of targets) {
        // eslint-disable-next-line no-await-in-loop
        const r = await backfillLocale(locale, sourceFlat, dryRun);
        console.log(r.inherits
            ? `  ${r.code.padEnd(5)} inherits en.js — left as is`
            : `  ${r.code.padEnd(5)} filled ${String(r.filled).padStart(5)}  dropped ${String(r.dropped).padStart(4)}  pending review ${r.pending}`);
    }
}

module.exports = { unflatten, serialize, backfillLocale, pendingPath };

if (require.main === module) {
    main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exit(1); });
}
