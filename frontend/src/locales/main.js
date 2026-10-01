import { createI18n } from "vue-i18n";
import en from "./en";
import { createLocaleLoader, FALLBACK_LOCALE } from "@/utils/localeLoader";
import { bootLocaleDirection } from "@/views/Settings/Language/localePrefs";

// Text direction has to be on <html> before the first paint, not after a page
// mounts, or the shell renders left-to-right and then jumps.
bootLocaleDirection();

/* Only English ships with the instance. The stored language arrives through the loader, and the
 * locale stays English until its file is in: te() and t() then never see a language with no messages. */
export const i18n = createI18n({
    legacy: false,
    globalInjection: true, // REQUIRED
    locale: FALLBACK_LOCALE,
    fallbackLocale: FALLBACK_LOCALE,
    messages: { en },
});

export const { loadLocale, switchLocale, applyStoredLocale } = createLocaleLoader(i18n);
