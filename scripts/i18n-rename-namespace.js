#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'frontend', 'src');
const EN = path.join(SRC, 'locales', 'en.js');
const NS_INDENT = '    ';
const KEY_INDENT = '        ';

function walk(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== 'node_modules' && entry.name !== 'locales') walk(full, out);
        } else if (/\.(vue|js)$/.test(entry.name)) out.push(full);
    }
    return out;
}

function blockRange(lines, name) {
    const start = lines.findIndex((l) => l === `${NS_INDENT}${name}: {`);
    if (start === -1) return null;
    for (let i = start + 1; i < lines.length; i += 1) {
        if (/^ {4}\},?$/.test(lines[i])) return { start, end: i };
    }
    throw new Error(`unterminated block ${name}`);
}

// Entries are the 8-space-indented keys of a namespace; a multi-line value belongs
// to the key above it.
function entries(lines, range) {
    const result = [];
    for (let i = range.start + 1; i < range.end; i += 1) {
        const m = lines[i].match(new RegExp(`^${KEY_INDENT}([A-Za-z0-9_$]+|'[^']*'|"[^"]*"):`));
        if (m) result.push({ key: m[1], lines: [lines[i]] });
        else if (result.length) result[result.length - 1].lines.push(lines[i]);
        else result.push({ key: null, lines: [lines[i]] });
    }
    return result;
}

function mergeNamespace(lines, from, to) {
    const fromRange = blockRange(lines, from);
    if (!fromRange) return { lines, moved: 0, merged: false };
    const toRange = blockRange(lines, to);
    if (!toRange) {
        lines[fromRange.start] = `${NS_INDENT}${to}: {`;
        return { lines, moved: 0, merged: false, renamed: true };
    }
    const fromEntries = entries(lines, fromRange);
    const fromKeys = new Set(fromEntries.map((e) => e.key));
    const kept = entries(lines, toRange).filter((e) => e.key === null || !fromKeys.has(e.key));
    const body = [...kept, ...fromEntries].flatMap((e) => e.lines);
    const closing = lines[toRange.end];
    const rebuilt = [lines[toRange.start], ...body, closing];
    const first = Math.min(fromRange.start, toRange.start);
    const second = Math.max(fromRange.start, toRange.start);
    const firstRange = first === fromRange.start ? fromRange : toRange;
    const secondRange = second === fromRange.start ? fromRange : toRange;
    const out = [
        ...lines.slice(0, firstRange.start),
        ...(firstRange === toRange ? rebuilt : []),
        ...lines.slice(firstRange.end + 1, secondRange.start),
        ...(secondRange === toRange ? rebuilt : []),
        ...lines.slice(secondRange.end + 1)
    ];
    return { lines: out, moved: fromEntries.length, merged: true };
}

function rewriteSources(from, to) {
    const re = new RegExp(`(['"\`])${from}\\.`, 'g');
    let files = 0;
    let hits = 0;
    for (const file of walk(SRC)) {
        const text = fs.readFileSync(file, 'utf8');
        const count = (text.match(re) || []).length;
        if (!count) continue;
        fs.writeFileSync(file, text.replace(re, `$1${to}.`));
        files += 1;
        hits += count;
    }
    return { files, hits };
}

function renameNamespace(from, to) {
    let lines = fs.readFileSync(EN, 'utf8').split('\n');
    const result = mergeNamespace(lines, from, to);
    fs.writeFileSync(EN, result.lines.join('\n'));
    const sources = rewriteSources(from, to);
    const how = result.merged ? `merged ${result.moved} keys into ${to}` : result.renamed ? `renamed block to ${to}` : 'no block in en.js';
    console.log(`${from} -> ${to}: ${how}; ${sources.hits} references in ${sources.files} files`);
}

function v2Namespaces() {
    return fs.readFileSync(EN, 'utf8').split('\n')
        .map((l) => l.match(/^ {4}([A-Za-z0-9_]+V2): \{$/))
        .filter(Boolean)
        .map((m) => m[1]);
}

function main(argv) {
    if (argv[0] === '--all') {
        for (const ns of v2Namespaces()) renameNamespace(ns, ns.replace(/V2$/, ''));
        return 0;
    }
    if (argv.length !== 2) {
        process.stderr.write('usage: node scripts/i18n-rename-namespace.js <FromNamespace> <ToNamespace> | --all\n');
        return 2;
    }
    renameNamespace(argv[0], argv[1]);
    return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { mergeNamespace, entries, blockRange, v2Namespaces };
