import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/store/index', () => ({ default: { getters: {} } }));
vi.mock('@/composable', () => ({ useCustomComposable: () => ({}) }));
vi.mock('@/offline', () => ({ clearOffline: vi.fn(), registerReplayer: vi.fn() }));

const STORAGE_KEY = 'ah_locale_prefs';
const SERVER = { language: 'ar', numerals: 'arab', dateFormat: 'YYYY-MM-DD', numberFormat: '1.250.000,50', weekStart: 'saturday', currency: 'AED' };
const LOCAL = { language: 'fr', numerals: 'latn', dateFormat: 'MM/DD/YYYY', numberFormat: '1 250 000,50', weekStart: 'sunday', currency: 'EUR' };

const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
const load = async () => {
    vi.resetModules();
    return import('@/views/Settings/Language/localePrefs');
};

describe('language settings follow the person, not the browser', () => {
    beforeEach(() => {
        localStorage.clear();
        document.documentElement.removeAttribute('dir');
        localStorage.setItem('userId', 'user-b');
    });

    it('a new browser takes the account copy, writes it locally and applies direction and numerals', async () => {
        const prefs = await load();
        const result = prefs.adoptAccountPrefs({ _id: 'user-b', languageCode: 'ar', localePreferences: SERVER });

        expect(result).toEqual({ language: 'ar', upload: null });
        expect({ ...prefs.localePrefs }).toEqual(SERVER);
        expect(stored()).toMatchObject(SERVER);
        expect(document.documentElement.getAttribute('dir')).toBe('rtl');
        expect(prefs.formatNumber(1250)).toBe('١٬٢٥٠٫٠٠');
    });

    it('the account copy wins over what this browser had', async () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(LOCAL));
        const prefs = await load();
        const result = prefs.adoptAccountPrefs({ _id: 'user-b', languageCode: 'ar', localePreferences: SERVER });

        expect(result.upload).toBeNull();
        expect({ ...prefs.localePrefs }).toEqual(SERVER);
        expect(stored()).toMatchObject(SERVER);
    });

    it('the language saved on the profile wins over a stale language in the copy', async () => {
        const prefs = await load();
        const result = prefs.adoptAccountPrefs({ _id: 'user-b', languageCode: 'ja', localePreferences: SERVER });

        expect(result.language).toBe('ja');
        expect(prefs.localePrefs.language).toBe('ja');
        expect(prefs.localePrefs.numerals).toBe('arab');
        expect(document.documentElement.getAttribute('dir')).toBe('ltr');
    });

    it('fills a partial account copy from the defaults, never from this browser', async () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(LOCAL));
        const prefs = await load();
        prefs.adoptAccountPrefs({ _id: 'user-b', languageCode: 'en', localePreferences: { currency: 'INR' } });

        expect(prefs.localePrefs.currency).toBe('INR');
        expect(prefs.localePrefs.dateFormat).toBe('DD/MM/YYYY');
        expect(prefs.localePrefs.weekStart).toBe('monday');
    });

    it('with no account copy it keeps this browser\'s settings and hands them back to send up', async () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(LOCAL));
        const prefs = await load();
        const result = prefs.adoptAccountPrefs({ _id: 'user-b', languageCode: 'fr' });

        expect(result).toEqual({ language: 'fr', upload: LOCAL });
        expect({ ...prefs.localePrefs }).toEqual(LOCAL);
    });

    it('sends nothing up when neither the account nor this browser has settings', async () => {
        const prefs = await load();
        const result = prefs.adoptAccountPrefs({ _id: 'user-b', languageCode: 'en' });

        expect(result.upload).toBeNull();
        expect(stored()).toBeNull();
    });

    it('never adopts or uploads settings this browser saved for someone else', async () => {
        localStorage.setItem('userId', 'user-a');
        const earlier = await load();
        earlier.savePrefs(LOCAL);
        localStorage.setItem('userId', 'user-b');

        const prefs = await load();
        const result = prefs.adoptAccountPrefs({ _id: 'user-b', languageCode: 'en' });

        expect(result.upload).toBeNull();
        expect(prefs.localePrefs.currency).toBe('USD');
        expect(prefs.localePrefs.dateFormat).toBe('DD/MM/YYYY');
    });

    it('keeps the owner stamp out of the settings the page reads and sends', async () => {
        const prefs = await load();
        prefs.savePrefs(LOCAL);

        expect(stored().owner).toBe('user-b');
        const reloaded = await load();
        expect(Object.keys(reloaded.localePrefs).sort()).toEqual(Object.keys(LOCAL).sort());
    });

    it('signing out forgets the settings on this browser', async () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(LOCAL));
        const prefs = await load();
        prefs.forgetLocalePrefs();

        expect(stored()).toBeNull();
        expect(prefs.localePrefs.currency).toBe('USD');
        expect(prefs.localePrefs.numerals).toBe('latn');
    });
});

describe('signing out', () => {
    it('clears the language settings with the rest of the session', async () => {
        vi.resetModules();
        localStorage.setItem('userId', 'user-a');
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...LOCAL, owner: 'user-a' }));
        const { useAuth } = await import('@/services');
        await useAuth().logOut({ withOutRefresh: true });

        expect(localStorage.getItem('userId')).toBeNull();
        expect(stored()).toBeNull();
    });
});
