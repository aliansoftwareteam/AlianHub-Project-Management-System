export const FALLBACK_LOCALE = "en";
export const START_TIMEOUT_MS = 5000;
export const RETRY_DELAYS_MS = [5000, 15000, 60000];

/* One literal import per language: webpack then emits a chunk named locale-<code> for each, and a
 * computed path would pull every file in the locales folder into the lookup, the instance included.
 * This file sits outside that folder because the i18n scripts read every .js there as a language. */
const IMPORTERS = {
    ar: () => import(/* webpackChunkName: "locale-ar" */ "@/locales/ar"),
    ch: () => import(/* webpackChunkName: "locale-ch" */ "@/locales/ch"),
    fr: () => import(/* webpackChunkName: "locale-fr" */ "@/locales/fr"),
    ge: () => import(/* webpackChunkName: "locale-ge" */ "@/locales/ge"),
    gr: () => import(/* webpackChunkName: "locale-gr" */ "@/locales/gr"),
    gu: () => import(/* webpackChunkName: "locale-gu" */ "@/locales/gu"),
    hi: () => import(/* webpackChunkName: "locale-hi" */ "@/locales/hi"),
    it: () => import(/* webpackChunkName: "locale-it" */ "@/locales/it"),
    ja: () => import(/* webpackChunkName: "locale-ja" */ "@/locales/ja"),
    ko: () => import(/* webpackChunkName: "locale-ko" */ "@/locales/ko"),
    ptBr: () => import(/* webpackChunkName: "locale-ptBr" */ "@/locales/ptBr"),
    ru: () => import(/* webpackChunkName: "locale-ru" */ "@/locales/ru"),
    spa: () => import(/* webpackChunkName: "locale-spa" */ "@/locales/spa")
};

export const LAZY_LOCALES = Object.keys(IMPORTERS);

const storedLanguage = () => {
    try {
        return localStorage.getItem("language");
    } catch (error) {
        return null;
    }
};

export function createLocaleLoader(i18n, { importers = IMPORTERS, readStored = storedLanguage } = {}) {
    const inFlight = new Map();

    const isLazy = (code) => code !== FALLBACK_LOCALE && Object.prototype.hasOwnProperty.call(importers, code);
    const isLoaded = (code) => code === FALLBACK_LOCALE || i18n.global.availableLocales.includes(code);
    const activate = (code) => { i18n.global.locale.value = code; };

    function loadLocale(code) {
        if (isLoaded(code)) return Promise.resolve();
        if (!isLazy(code)) return Promise.reject(new Error(`No language file for "${code}"`));
        if (!inFlight.has(code)) {
            const request = importers[code]()
                .then((file) => { i18n.global.setLocaleMessage(code, file.default || file); })
                .finally(() => { inFlight.delete(code); });
            inFlight.set(code, request);
        }
        return inFlight.get(code);
    }

    async function switchLocale(code) {
        await loadLocale(code);
        activate(code);
    }

    /* Resolves when the stored language is on screen, or with English still showing once the file
     * has failed or the wait has run out; either way the file is then followed in the background. */
    function applyStoredLocale({ timeoutMs = START_TIMEOUT_MS, retryDelays = RETRY_DELAYS_MS } = {}) {
        const code = readStored();
        if (!isLazy(code) || isLoaded(code)) {
            activate(isLazy(code) ? code : FALLBACK_LOCALE);
            return Promise.resolve(i18n.global.locale.value);
        }
        return new Promise((resolve) => {
            const stopWaiting = () => resolve(i18n.global.locale.value);
            const timer = setTimeout(stopWaiting, timeoutMs);
            const attempt = (delays) => {
                if (readStored() !== code) return;
                loadLocale(code).then(() => {
                    if (readStored() === code) activate(code);
                    clearTimeout(timer);
                    stopWaiting();
                }, () => {
                    clearTimeout(timer);
                    stopWaiting();
                    if (delays.length) setTimeout(() => attempt(delays.slice(1)), delays[0]);
                });
            };
            attempt(retryDelays);
        });
    }

    return { loadLocale, switchLocale, applyStoredLocale };
}
