// Language and region preferences (handoff 22d).
//
// Two of these settings change layout rather than wording: text direction and
// numeral system. Direction is applied to <html> so the shell mirrors through
// CSS logical properties; the numeral system is a DISPLAY-ONLY transliteration —
// stored values, ids, and anything sent to the API stay Latin digits.

import { reactive, watch } from "vue";

export const LOCALES = [
    { code: "en", label: "English", english: "English", dir: "ltr" },
    { code: "hi", label: "हिन्दी", english: "Hindi", dir: "ltr" },
    { code: "ar", label: "العربية", english: "Arabic", dir: "rtl" },
    { code: "spa", label: "Español", english: "Spanish", dir: "ltr" },
    { code: "fr", label: "Français", english: "French", dir: "ltr" },
    { code: "ge", label: "Deutsch", english: "German", dir: "ltr" },
    { code: "ptBr", label: "Português", english: "Portuguese (Brazil)", dir: "ltr" },
    { code: "ja", label: "日本語", english: "Japanese", dir: "ltr" },
    { code: "it", label: "Italiano", english: "Italian", dir: "ltr" },
    { code: "gr", label: "Ελληνικά", english: "Greek", dir: "ltr" },
    { code: "ch", label: "中文", english: "Chinese", dir: "ltr" },
    { code: "ru", label: "Русский", english: "Russian", dir: "ltr" },
    { code: "ko", label: "한국어", english: "Korean", dir: "ltr" },
    { code: "gu", label: "ગુજરાતી", english: "Gujarati", dir: "ltr" }
];

export const NUMERAL_SYSTEMS = [
    { key: "latn", sample: "1,25,000.50", digits: "0123456789" },
    { key: "arab", sample: "١٬٢٥٬٠٠٠٫٥٠", digits: "٠١٢٣٤٥٦٧٨٩" },
    { key: "deva", sample: "१,२५,०००.५०", digits: "०१२३४५६७८९" }
];

export const DATE_FORMATS = ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD", "D MMM YYYY"];
export const NUMBER_FORMATS = ["1,250,000.50", "1.250.000,50", "1,25,000.50", "1 250 000,50"];
export const WEEK_STARTS = ["monday", "sunday", "saturday"];

const STORAGE_KEY = "ah_locale_prefs";

const DEFAULTS = {
    language: "en",
    numerals: "latn",
    dateFormat: "DD/MM/YYYY",
    numberFormat: "1,250,000.50",
    weekStart: "monday",
    currency: "USD"
};

const read = () => {
    try {
        return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") };
    } catch (error) {
        return { ...DEFAULTS };
    }
};

export const localePrefs = reactive(read());

export const localeOf = (code) => LOCALES.find((locale) => locale.code === code) || LOCALES[0];

export const directionOf = (code) => localeOf(code).dir;

export function applyDirection(code) {
    const dir = directionOf(code);
    if (typeof document === "undefined") return dir;
    document.documentElement.setAttribute("dir", dir);
    document.documentElement.setAttribute("lang", code === "ptBr" ? "pt-BR" : code === "spa" ? "es" : code === "ge" ? "de" : code === "gr" ? "el" : code === "ch" ? "zh" : code);
    return dir;
}

// Display-only: swaps Latin digits for another script's digits. Never call this
// on a value that will be stored, parsed, or sent to the API.
export function toNumerals(text, system) {
    const entry = NUMERAL_SYSTEMS.find((candidate) => candidate.key === (system || localePrefs.numerals));
    if (!entry || entry.key === "latn") return String(text === undefined || text === null ? "" : text);
    return String(text).replace(/[0-9]/g, (digit) => entry.digits[Number(digit)]);
}

const GROUPING = {
    "1,250,000.50": { group: ",", decimal: ".", indian: false, spacing: false },
    "1.250.000,50": { group: ".", decimal: ",", indian: false, spacing: false },
    "1,25,000.50": { group: ",", decimal: ".", indian: true, spacing: false },
    "1 250 000,50": { group: " ", decimal: ",", indian: false, spacing: true }
};

function groupDigits(whole, style) {
    if (!style.indian) return whole.replace(/\B(?=(\d{3})+(?!\d))/g, style.group);
    if (whole.length <= 3) return whole;
    const head = whole.slice(0, -3);
    return `${head.replace(/\B(?=(\d{2})+(?!\d))/g, style.group)}${style.group}${whole.slice(-3)}`;
}

export function formatNumber(value, prefs = localePrefs) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "";
    const style = GROUPING[prefs.numberFormat] || GROUPING["1,250,000.50"];
    const [whole, fraction = ""] = Math.abs(number).toFixed(2).split(".");
    const body = `${groupDigits(whole, style)}${style.decimal}${fraction}`;
    return toNumerals(`${number < 0 ? "-" : ""}${body}`, prefs.numerals);
}

export function formatDate(value, prefs = localePrefs) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = String(date.getFullYear());
    const shortMonth = date.toLocaleString("en", { month: "short" });
    const table = {
        "DD/MM/YYYY": `${day}/${month}/${year}`,
        "MM/DD/YYYY": `${month}/${day}/${year}`,
        "YYYY-MM-DD": `${year}-${month}-${day}`,
        "D MMM YYYY": `${date.getDate()} ${shortMonth} ${year}`
    };
    return toNumerals(table[prefs.dateFormat] || table["DD/MM/YYYY"], prefs.numerals);
}

export function savePrefs(patch) {
    Object.assign(localePrefs, patch || {});
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...localePrefs }));
    } catch (error) {
        // A blocked storage quota must not stop the setting from taking effect.
    }
    applyDirection(localePrefs.language);
    return { ...localePrefs };
}

watch(() => localePrefs.language, (code) => applyDirection(code));

export function bootLocaleDirection() {
    const stored = read();
    const language = localStorage.getItem("language") || stored.language;
    Object.assign(localePrefs, stored, { language });
    return applyDirection(language);
}
