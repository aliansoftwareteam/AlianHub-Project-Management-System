const path = require('path');
const { SRC, loadLocale, flatten, scanSources, resolves } = require('./locale-keys');

const en = loadLocale(path.join(SRC, 'locales', 'en.js'));
const flat = flatten(en);
const { keys, v2 } = scanSources();

describe('i18n namespaces', () => {
    it('scans something (the regexes still match the source)', () => {
        expect(keys.length).toBeGreaterThan(1000);
    });

    it('have no V2 twin in en.js (node scripts/i18n-rename-namespace.js --all)', () => {
        expect(Object.keys(en).filter((ns) => /V2$/.test(ns))).toEqual([]);
    });

    it('are never referenced through a V2 name in the source', () => {
        expect([...new Set(v2.map((h) => `${h.namespace} <- ${h.file}`))]).toEqual([]);
    });

    it('resolve every static t() key to an entry in en.js', () => {
        const missing = [...new Set(keys.filter(({ key }) => !resolves(flat, key)).map(({ key, file }) => `${key} <- ${file}`))];
        expect(missing).toEqual([]);
    });
});
