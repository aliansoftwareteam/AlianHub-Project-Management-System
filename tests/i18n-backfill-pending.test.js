const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

delete process.env.TRANSLATE_API_KEY;

const BASE_KEYS = {};
['Auth', 'Knowledge', 'Projects', 'Reminders', 'Tasks'].forEach((ns) => {
    for (let i = 0; i < 20; i += 1) BASE_KEYS[`${ns}.key_${String(i).padStart(2, '0')}`] = `${ns} text ${i}`;
});

function nest(flat) {
    const out = {};
    Object.keys(flat).forEach((full) => {
        const [ns, key] = full.split('.');
        out[ns] = out[ns] || {};
        out[ns][key] = flat[full];
    });
    return out;
}

function makeLocales(sourceFlat, ownFlat) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-pending-'));
    fs.writeFileSync(path.join(dir, 'en.js'), `export default ${JSON.stringify(nest(sourceFlat), null, 4)};\n`);
    fs.writeFileSync(path.join(dir, 'fr.js'), `export default ${JSON.stringify(nest(ownFlat), null, 4)};\n`);
    return dir;
}

/* loadLocale caches by path, so each run needs fresh modules to see what the previous run wrote. */
async function backfill(dir) {
    let result;
    await jest.isolateModulesAsync(async () => {
        const { backfillLocale } = require('../scripts/i18n-backfill');
        const { loadLocale, flatten } = require('../scripts/i18n-check');
        const sourceFlat = flatten(loadLocale(path.join(dir, 'en.js')));
        result = await backfillLocale({ code: 'fr', file: path.join(dir, 'fr.js') }, sourceFlat, false);
    });
    return result;
}

const read = (dir, name) => fs.readFileSync(path.join(dir, name), 'utf8');

function copyDir(from) {
    const to = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-pending-'));
    fs.readdirSync(from).forEach((name) => fs.copyFileSync(path.join(from, name), path.join(to, name)));
    return to;
}

function addSourceKey(dir, key, value) {
    const { flatten } = require('../scripts/i18n-check');
    const text = read(dir, 'en.js').replace(/^export default /, '').replace(/;\s*$/, '');
    const flat = flatten(JSON.parse(text));
    flat[key] = value;
    fs.writeFileSync(path.join(dir, 'en.js'), `export default ${JSON.stringify(nest(flat), null, 4)};\n`);
}

function changedBaseLines(base, next) {
    const a = base.split('\n');
    const b = next.split('\n');
    let top = 0;
    while (top < a.length && a[top] === b[top]) top += 1;
    let bottom = 0;
    while (bottom < a.length - top && a[a.length - 1 - bottom] === b[b.length - 1 - bottom]) bottom += 1;
    return { from: top, to: a.length - bottom };
}

describe('pending review files', () => {
    const own = Object.fromEntries(Object.entries(BASE_KEYS).filter(([k]) => !k.startsWith('Knowledge.')));

    test('a second run with no key changes leaves every file byte-identical', async () => {
        const dir = makeLocales(BASE_KEYS, own);
        const first = await backfill(dir);
        expect(first.filled).toBe(20);
        const pending = read(dir, 'fr.pending.json');
        const locale = read(dir, 'fr.js');

        await backfill(dir);
        expect(read(dir, 'fr.pending.json')).toBe(pending);
        expect(read(dir, 'fr.js')).toBe(locale);
        expect(pending).not.toMatch(/updatedAt/);
        expect(pending.endsWith('}\n')).toBe(true);
        const keys = Object.keys(JSON.parse(pending).keys);
        expect(keys).toEqual([...keys].sort());
    });

    test('two branches adding different keys touch disjoint lines and merge cleanly', async () => {
        const base = makeLocales(BASE_KEYS, own);
        await backfill(base);
        const ours = copyDir(base);
        const theirs = copyDir(base);
        addSourceKey(ours, 'Knowledge.key_05b', 'ours');
        addSourceKey(theirs, 'Tasks.key_12b', 'theirs');
        await backfill(ours);
        await backfill(theirs);

        const basePending = read(base, 'fr.pending.json');
        const a = changedBaseLines(basePending, read(ours, 'fr.pending.json'));
        const b = changedBaseLines(basePending, read(theirs, 'fr.pending.json'));
        expect(a.to <= b.from || b.to <= a.from).toBe(true);

        const merge = spawnSync('git', ['merge-file', '-p',
            path.join(ours, 'fr.pending.json'), path.join(base, 'fr.pending.json'), path.join(theirs, 'fr.pending.json')], { encoding: 'utf8' });
        expect(merge.status).toBe(0);

        const both = copyDir(ours);
        addSourceKey(both, 'Tasks.key_12b', 'theirs');
        await backfill(both);
        expect(merge.stdout).toBe(read(both, 'fr.pending.json'));
    });

    test('an old-format or hand-merged file is rewritten in canonical form without losing keys', async () => {
        const dir = makeLocales(BASE_KEYS, own);
        await backfill(dir);
        const canonical = read(dir, 'fr.pending.json');
        const parsed = JSON.parse(canonical);
        const shuffled = Object.fromEntries(Object.entries(parsed.keys).reverse());
        fs.writeFileSync(path.join(dir, 'fr.pending.json'), `${JSON.stringify({ locale: 'fr', machineTranslated: false, updatedAt: '2026-09-23T00:00:00.000Z', keys: shuffled }, null, 2)}\n`);

        await backfill(dir);
        expect(read(dir, 'fr.pending.json')).toBe(canonical);
    });

    test('an unparseable pending file stops the run instead of being emptied', async () => {
        const dir = makeLocales(BASE_KEYS, own);
        await backfill(dir);
        const broken = read(dir, 'fr.pending.json').replace('"keys": {', '"keys": {\n<<<<<<< HEAD');
        fs.writeFileSync(path.join(dir, 'fr.pending.json'), broken);
        await expect(backfill(dir)).rejects.toThrow(SyntaxError);
        expect(read(dir, 'fr.pending.json')).toBe(broken);
    });

    test('the check accepts unsorted keys and rejects broken JSON', () => {
        const { checkPending } = require('../scripts/i18n-check');
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-pending-'));
        fs.writeFileSync(path.join(dir, 'fr.pending.json'), JSON.stringify({ locale: 'fr', keys: { 'Z.b': 'b', 'A.a': 'a' } }));
        expect(checkPending(dir)).toEqual([]);
        fs.writeFileSync(path.join(dir, 'ge.pending.json'), '{ "locale": "ge", "keys": {\n<<<<<<< HEAD\n}}');
        expect(checkPending(dir).map((p) => p.file)).toEqual(['ge.pending.json']);
    });
});
