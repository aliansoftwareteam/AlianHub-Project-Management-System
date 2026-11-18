#!/usr/bin/env node
/* Words that must not reach the screen (task 047, S-3): terms a project manager
   would not know, or that the product uses for the wrong thing. Reads only the
   English catalogue; a reworded key is refilled in the other locales by the
   backfill. Keys that still break a rule are listed in plain-words-baseline.json,
   which may only shrink.
   Usage: node scripts/plain-words.js [--prune]
   --prune drops baseline entries that no longer break a rule; it never adds one. */
const fs = require('fs');
const path = require('path');
const { loadLocale, flatten, LOCALES_DIR, SOURCE_LOCALE } = require('./i18n-check');

const BASELINE = path.join(__dirname, 'plain-words-baseline.json');

/* `rightIn` lists key prefixes where the word names the thing itself: a Scrum
   sprint is a sprint, the people directory is a directory. */
const WORDS = [
    { word: 'sprint', say: 'list', pattern: /\bsprints?\b/i, rightIn: ['Scrum.', 'Reports.', 'Dash.', 'PermissionDesc.', 'Docs.template_retro', 'Projects.list_plain_text', 'TaskLists.refusal_scrum_list', 'AuditActions.sprint_scrum', 'AuditActions.sprint_start', 'AuditActions.sprint_complete'] },
    { word: 'directory', say: 'folder', pattern: /\bdirector(?:y|ies)\b/i, rightIn: ['Org.'] },
    { word: 'payload', say: 'content', pattern: /\bpayloads?\b/i },
    { word: 'endpoint', say: 'address', pattern: /\bendpoints?\b/i },
    { word: 'null', say: 'empty', pattern: /\bnull\b/i },
    { word: 'cache', say: 'saved copy', pattern: /\bcach(?:e|es|ed|ing)\b/i },
    { word: 'params', say: 'details', pattern: /\bparams?\b/i },
    { word: 'boolean', say: 'yes or no', pattern: /\bbooleans?\b/i },
    { word: 'enum', say: 'choice', pattern: /\benums?\b/i },
    { word: 'regex', say: 'pattern', pattern: /\bregex(?:es|p)?\b/i },
    { word: 'cron', say: 'schedule', pattern: /\bcron\b/i },
    { word: 'schema', say: 'layout', pattern: /\bschemas?\b/i },
    { word: 'uuid', say: 'id', pattern: /\buuids?\b/i },
    { word: 'backend', say: 'server', pattern: /\bback-?end\b/i },
    { word: 'middleware', say: 'server', pattern: /\bmiddlewares?\b/i },
    { word: 'setting name', say: 'what the setting does', pattern: /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/ }
];

/* Stand-ins the code swaps for a real value before the string is shown. */
const STAND_INS = ['BRAND_NAME', 'PRIORITY_NAME', 'TASK_SPRINT', 'SELECTED_SPRINT_DATA', 'FILE_FORMATS', 'EXIST_VALUE', 'FILE_EXTENSION', 'FILE_SIZE', 'MAX_CHAR'];
const NOT_READ = new RegExp(`\\{[^}]*\\}|https?://\\S+|\\b(?:${STAND_INS.join('|')})\\b`, 'g');

function wordsIn(key, value) {
    if (typeof value !== 'string') return [];
    const read = value.replace(NOT_READ, ' ');
    return WORDS
        .filter((w) => w.pattern.test(read) && !(w.rightIn || []).some((prefix) => key.startsWith(prefix)))
        .map((w) => w.word);
}

function scan(flat) {
    const found = {};
    Object.keys(flat).forEach((key) => {
        const words = wordsIn(key, flat[key]);
        if (words.length) found[key] = words;
    });
    return found;
}

function scanSource() {
    return scan(flatten(loadLocale(path.join(LOCALES_DIR, `${SOURCE_LOCALE}.js`))));
}

function readBaseline() {
    return JSON.parse(fs.readFileSync(BASELINE, 'utf8')).keys;
}

function renderBaseline(keys) {
    const sorted = {};
    Object.keys(keys).sort().forEach((key) => { sorted[key] = keys[key]; });
    return `${JSON.stringify({ keys: sorted }, null, 2)}\n`;
}

/* `added` is a listed word in a string the baseline does not excuse for it;
   `stale` is a baseline entry whose string no longer has the word. */
function compare(found, baseline) {
    const pairs = (map) => Object.keys(map).flatMap((key) => map[key].map((word) => ({ key, word })));
    const has = (map, { key, word }) => (map[key] || []).includes(word);
    return {
        added: pairs(found).filter((pair) => !has(baseline, pair)),
        stale: pairs(baseline).filter((pair) => !has(found, pair))
    };
}

function main(argv) {
    const found = scanSource();
    const baseline = readBaseline();
    const { added, stale } = compare(found, baseline);
    if (argv.includes('--prune')) {
        const kept = {};
        Object.keys(baseline).forEach((key) => {
            const words = baseline[key].filter((word) => (found[key] || []).includes(word));
            if (words.length) kept[key] = words;
        });
        fs.writeFileSync(BASELINE, renderBaseline(kept));
        console.log(`plain words: ${stale.length} baseline entr${stale.length === 1 ? 'y' : 'ies'} removed, ${Object.keys(kept).length} key(s) left`);
    }
    added.forEach(({ key, word }) => {
        const rule = WORDS.find((w) => w.word === word);
        console.log(`${key}: "${word}" — say "${rule.say}"`);
    });
    if (added.length) console.log(`plain words: ${added.length} string(s) use a listed word`);
    return added.length ? 1 : 0;
}

module.exports = { WORDS, STAND_INS, BASELINE, wordsIn, scan, scanSource, readBaseline, renderBaseline, compare };

if (require.main === module) process.exit(main(process.argv.slice(2)));
