import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createI18n } from 'vue-i18n';
import { createLocaleLoader, LAZY_LOCALES, START_TIMEOUT_MS, RETRY_DELAYS_MS } from '@/locales/loader';

const SRC = path.resolve(__dirname, '../../src');
const LOCALES_DIR = path.join(SRC, 'locales');

const EN = { Greeting: { hello: 'Hello', only_english: 'English only' } };
const FR = { Greeting: { hello: 'Bonjour' } };
const HI = { Greeting: { hello: 'नमस्ते' } };

const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
};

const setup = (importers) => {
    const i18n = createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages: { en: EN }, missingWarn: false, fallbackWarn: false });
    return { i18n, t: i18n.global.t, current: () => i18n.global.locale.value, ...createLocaleLoader(i18n, { importers }) };
};

beforeEach(() => {
    localStorage.clear();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('the language chosen at start', () => {
    it('starts in English at once when nothing is stored', async () => {
        const importers = { fr: vi.fn(() => Promise.resolve({ default: FR })) };
        const { applyStoredLocale, current } = setup(importers);

        expect(await applyStoredLocale()).toBe('en');
        expect(current()).toBe('en');
        expect(importers.fr).not.toHaveBeenCalled();
    });

    it('waits for a stored language other than English', async () => {
        localStorage.setItem('language', 'fr');
        const file = deferred();
        const importers = { fr: vi.fn(() => file.promise) };
        const { applyStoredLocale, current, t } = setup(importers);

        let ready = false;
        const start = applyStoredLocale().then((code) => { ready = true; return code; });
        await Promise.resolve();
        await Promise.resolve();
        expect(ready).toBe(false);
        expect(current()).toBe('en');

        file.resolve({ default: FR });
        expect(await start).toBe('fr');
        expect(current()).toBe('fr');
        expect(t('Greeting.hello')).toBe('Bonjour');
        expect(t('Greeting.only_english')).toBe('English only');
    });

    it('falls back to English for a code it does not know', async () => {
        localStorage.setItem('language', 'xx');
        const importers = { fr: vi.fn(() => Promise.resolve({ default: FR })) };
        const { applyStoredLocale, current, t } = setup(importers);

        expect(await applyStoredLocale()).toBe('en');
        expect(current()).toBe('en');
        expect(t('Greeting.hello')).toBe('Hello');
        expect(importers.fr).not.toHaveBeenCalled();
    });

    it('stops waiting after the timeout, then switches when the file arrives', async () => {
        vi.useFakeTimers();
        localStorage.setItem('language', 'fr');
        const file = deferred();
        const importers = { fr: vi.fn(() => file.promise) };
        const { applyStoredLocale, current, t } = setup(importers);

        const start = applyStoredLocale();
        await vi.advanceTimersByTimeAsync(START_TIMEOUT_MS);
        expect(await start).toBe('en');
        expect(t('Greeting.hello')).toBe('Hello');

        file.resolve({ default: FR });
        await vi.advanceTimersByTimeAsync(0);
        expect(current()).toBe('fr');
        expect(importers.fr).toHaveBeenCalledTimes(1);
    });

    it('starts in English when the file fails, and tries again in the background', async () => {
        vi.useFakeTimers();
        localStorage.setItem('language', 'fr');
        const importers = {
            fr: vi.fn()
                .mockImplementationOnce(() => Promise.reject(new Error('ChunkLoadError: Loading chunk locale-fr failed')))
                .mockImplementation(() => Promise.resolve({ default: FR }))
        };
        const { applyStoredLocale, current, t } = setup(importers);

        expect(await applyStoredLocale()).toBe('en');
        expect(t('Greeting.hello')).toBe('Hello');
        expect(importers.fr).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]);
        expect(importers.fr).toHaveBeenCalledTimes(2);
        expect(current()).toBe('fr');
        expect(t('Greeting.hello')).toBe('Bonjour');
    });

    it('gives up after its last retry', async () => {
        vi.useFakeTimers();
        localStorage.setItem('language', 'fr');
        const importers = { fr: vi.fn(() => Promise.reject(new Error('offline'))) };
        const { applyStoredLocale, current } = setup(importers);

        expect(await applyStoredLocale()).toBe('en');
        await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS.reduce((sum, ms) => sum + ms, 0) * 2);
        expect(importers.fr).toHaveBeenCalledTimes(RETRY_DELAYS_MS.length + 1);
        expect(current()).toBe('en');
    });

    it('drops a background retry once another language has been chosen', async () => {
        vi.useFakeTimers();
        localStorage.setItem('language', 'fr');
        const importers = {
            fr: vi.fn(() => Promise.reject(new Error('offline'))),
            hi: vi.fn(() => Promise.resolve({ default: HI }))
        };
        const { applyStoredLocale, switchLocale, current } = setup(importers);

        await applyStoredLocale();
        await switchLocale('hi');
        localStorage.setItem('language', 'hi');
        await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]);

        expect(importers.fr).toHaveBeenCalledTimes(1);
        expect(current()).toBe('hi');
    });

    it('follows the stored language back to English without a fetch', async () => {
        const importers = { fr: vi.fn(() => Promise.resolve({ default: FR })) };
        const { applyStoredLocale, switchLocale, current } = setup(importers);
        await switchLocale('fr');

        localStorage.setItem('language', 'en');
        expect(await applyStoredLocale()).toBe('en');
        expect(current()).toBe('en');
        expect(importers.fr).toHaveBeenCalledTimes(1);
    });
});

describe('switching language', () => {
    it('loads the language, then sets it', async () => {
        const file = deferred();
        const importers = { fr: vi.fn(() => file.promise) };
        const { switchLocale, current, t } = setup(importers);

        const switching = switchLocale('fr');
        await Promise.resolve();
        expect(current()).toBe('en');

        file.resolve({ default: FR });
        await switching;
        expect(current()).toBe('fr');
        expect(t('Greeting.hello')).toBe('Bonjour');
    });

    it('leaves the current language when the file cannot be loaded, and asks again next time', async () => {
        const importers = {
            fr: vi.fn(() => Promise.resolve({ default: FR })),
            hi: vi.fn()
                .mockImplementationOnce(() => Promise.reject(new Error('offline')))
                .mockImplementation(() => Promise.resolve({ default: HI }))
        };
        const { switchLocale, current, t } = setup(importers);
        await switchLocale('fr');

        await expect(switchLocale('hi')).rejects.toThrow('offline');
        expect(current()).toBe('fr');
        expect(t('Greeting.hello')).toBe('Bonjour');

        await switchLocale('hi');
        expect(current()).toBe('hi');
        expect(importers.hi).toHaveBeenCalledTimes(2);
    });

    it('refuses a code it does not know and keeps the current language', async () => {
        const { switchLocale, current } = setup({ fr: vi.fn(() => Promise.resolve({ default: FR })) });

        await expect(switchLocale('xx')).rejects.toThrow();
        expect(current()).toBe('en');
    });

    it('fetches a language once however often it is asked for', async () => {
        const importers = {
            fr: vi.fn(() => Promise.resolve({ default: FR })),
            hi: vi.fn(() => Promise.resolve({ default: HI }))
        };
        const { switchLocale, loadLocale, current } = setup(importers);

        await Promise.all([switchLocale('fr'), switchLocale('fr'), loadLocale('fr')]);
        await switchLocale('hi');
        await switchLocale('fr');

        expect(current()).toBe('fr');
        expect(importers.fr).toHaveBeenCalledTimes(1);
        expect(importers.hi).toHaveBeenCalledTimes(1);
    });

    it('never fetches English', async () => {
        const importers = { en: vi.fn(() => Promise.resolve({ default: {} })), fr: vi.fn(() => Promise.resolve({ default: FR })) };
        const { switchLocale, loadLocale, current, t } = setup(importers);

        await switchLocale('fr');
        await switchLocale('en');
        await loadLocale('en');

        expect(current()).toBe('en');
        expect(t('Greeting.hello')).toBe('Hello');
        expect(importers.en).not.toHaveBeenCalled();
        expect(LAZY_LOCALES).not.toContain('en');
    });
});

describe('the locale files in the bundle', () => {
    const NOT_LOCALES = ['main.js', 'loader.js'];
    const localeCodes = fs.readdirSync(LOCALES_DIR)
        .filter((file) => /^[a-zA-Z]+\.js$/.test(file) && !NOT_LOCALES.includes(file))
        .map((file) => file.replace(/\.js$/, ''));
    const lazyCodes = localeCodes.filter((code) => code !== 'en');

    const sourceFiles = (dir, found = []) => {
        fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) sourceFiles(full, found);
            else if (/\.(js|ts|vue)$/.test(entry.name)) found.push(full);
        });
        return found;
    };
    const relative = (file) => path.relative(SRC, file);
    const loaderFile = path.join(LOCALES_DIR, 'loader.js');
    const isLocaleFile = (file) => path.dirname(file) === LOCALES_DIR && !NOT_LOCALES.includes(path.basename(file));
    const modules = sourceFiles(SRC).filter((file) => file !== loaderFile && !isLocaleFile(file));

    it('gives every language but English a chunk of its own, named after its code', () => {
        const loader = fs.readFileSync(loaderFile, 'utf8');

        expect([...LAZY_LOCALES].sort()).toEqual([...lazyCodes].sort());
        lazyCodes.forEach((code) => {
            expect(loader).toContain(`import(/* webpackChunkName: "locale-${code}" */ "./${code}")`);
        });
        expect(loader).not.toMatch(/^import .*from\s+["']\.\/(?!en["'])/m);
    });

    it('lets no module but the loader import a language other than English', () => {
        const codes = lazyCodes.join('|');
        const byAlias = new RegExp(`locales/(?:${codes})(?:\\.js)?["'\`]`);
        const computed = /locales\/\$\{/;
        const sibling = new RegExp(`["'\`]\\./(?:${codes})(?:\\.js)?["'\`]`);

        const offenders = modules.filter((file) => {
            const text = fs.readFileSync(file, 'utf8');
            if (byAlias.test(text) || computed.test(text)) return true;
            return path.dirname(file) === LOCALES_DIR && sibling.test(text);
        });
        expect(offenders.map(relative)).toEqual([]);
    });

    it('keeps the review lists (*.pending.json) out of the app', () => {
        const offenders = [...modules, loaderFile].filter((file) => /pending\.json/.test(fs.readFileSync(file, 'utf8')));
        expect(offenders.map(relative)).toEqual([]);
    });

    it('creates the instance with English only and mounts after the stored language is applied', () => {
        const instance = fs.readFileSync(path.join(LOCALES_DIR, 'main.js'), 'utf8');
        expect(instance).toMatch(/messages:\s*\{\s*en\s*\}/);

        const entry = fs.readFileSync(path.join(SRC, 'main.js'), 'utf8');
        expect(entry).toMatch(/applyStoredLocale\(\)\.then\(mountApp\)/);
        expect(entry.match(/app\.mount\(/g)).toHaveLength(1);
    });
});
