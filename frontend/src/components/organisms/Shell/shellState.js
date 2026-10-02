import { reactive, watch } from "vue";
import { apiRequestWithoutCompnay } from "@/services";
import * as env from "@/config/env";
import { DEFAULT_VARIANT, VARIANT_CHOICES, lookOf } from "./looks";
import { DEFAULT_ACCENT, accentOf } from "./accents";
import { SIMPLE_PLACES, isNavMode, navModeOf } from "./navMode";

export { DEFAULT_VARIANT, VARIANT_CHOICES };

const THEME_KEY = "ah.theme";
const CONTRAST_KEY = "ah.contrast";
const CONTRAST_CHOICES = ["auto", "standard", "high"];
const VARIANT_KEY = "ah.variant";
const VARIANT_OFF = "off";
const ACCENT_KEY = "ah.accent";
const NAV_KEY = "ah.nav";
const NAV_SAVE_DELAY_MS = 800;

const signedInUserId = () => localStorage.getItem("userId") || "";

/* ah.nav is shared by everyone who signs in on this browser, so a local copy counts only for
   the user it is tagged with; an untagged copy predates the tag and belongs to nobody. */
function localPinsOf(userId) {
    try {
        const stored = JSON.parse(localStorage.getItem(NAV_KEY) || "null");
        if (!userId || !stored || stored.uid !== userId || !Array.isArray(stored.pinned)) return [];
        return stored.pinned.filter((id) => typeof id === "string");
    } catch {
        return [];
    }
}

function localModeOf(userId) {
    try {
        const stored = JSON.parse(localStorage.getItem(NAV_KEY) || "null");
        return navModeOf(userId && stored && stored.uid === userId ? stored.mode : "");
    } catch {
        return navModeOf("");
    }
}

export const shellState = reactive({
    notepad: false,
    clips: false,
    reminders: false,
    talkToText: false,
    tour: false,
    tourAsked: false,
    moreOpen: false,
    profileOpen: false,
    sidebarCollapsed: false,
    theme: localStorage.getItem(THEME_KEY) || "light",
    contrast: CONTRAST_CHOICES.includes(localStorage.getItem(CONTRAST_KEY)) ? localStorage.getItem(CONTRAST_KEY) : "auto",
    variant: "",
    accent: DEFAULT_ACCENT,
    nav: { pinned: localPinsOf(signedInUserId()), mode: localModeOf(signedInUserId()) },
    agentsRunning: 0
});

const systemDark = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

export function resolveTheme(theme) {
    if (theme === "system") return systemDark && systemDark.matches ? "dark" : "light";
    return theme;
}

export function applyTheme(theme) {
    shellState.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
    document.documentElement.setAttribute("data-theme", resolveTheme(theme));
}

export function toggleTheme() {
    applyTheme(resolveTheme(shellState.theme) === "dark" ? "light" : "dark");
}

const contrastQuery = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-contrast: more)") : null);

export function resolveContrast(choice) {
    if (choice === "high" || choice === "standard") return choice;
    const query = contrastQuery();
    return query && query.matches ? "high" : "standard";
}

function paintContrast() {
    document.documentElement.classList.toggle("ah-high-contrast", resolveContrast(shellState.contrast) === "high");
}

export function applyContrast(choice) {
    shellState.contrast = CONTRAST_CHOICES.includes(choice) ? choice : "auto";
    localStorage.setItem(CONTRAST_KEY, shellState.contrast);
    paintContrast();
}

const knownVariant = (value) => (VARIANT_CHOICES.includes(value) ? value : "");

export const activeVariant = () => lookOf(shellState.variant);

/* The router is in hash mode, so a shared link carries ?variant= inside the hash; one typed
   by hand usually has it before the hash. */
function variantInUrl() {
    const { search, hash } = window.location;
    const hashQuery = hash.includes("?") ? hash.slice(hash.indexOf("?")) : "";
    return new URLSearchParams(search).get("variant") || new URLSearchParams(hashQuery).get("variant");
}

export function applyVariant(choice) {
    shellState.variant = knownVariant(choice);
    if (shellState.variant) {
        localStorage.setItem(VARIANT_KEY, shellState.variant);
        document.documentElement.setAttribute("data-variant", shellState.variant);
    } else {
        localStorage.removeItem(VARIANT_KEY);
        document.documentElement.removeAttribute("data-variant");
    }
}

function initVariant() {
    const asked = variantInUrl();
    if (asked === VARIANT_OFF || knownVariant(asked)) applyVariant(asked);
    else applyVariant(localStorage.getItem(VARIANT_KEY));
}

/* The default stores nothing and sets no attribute, so this browser keeps following whatever the default is. */
export function applyAccent(choice) {
    shellState.accent = accentOf(choice);
    if (shellState.accent === DEFAULT_ACCENT) {
        localStorage.removeItem(ACCENT_KEY);
        document.documentElement.removeAttribute("data-accent");
    } else {
        localStorage.setItem(ACCENT_KEY, shellState.accent);
        document.documentElement.setAttribute("data-accent", shellState.accent);
    }
}

/* True once this browser holds a choice of theme, contrast, look or accent. */
export function hasChosenLook() {
    void [shellState.theme, shellState.contrast, shellState.variant, shellState.accent];
    try {
        return [THEME_KEY, CONTRAST_KEY, VARIANT_KEY, ACCENT_KEY].some((key) => localStorage.getItem(key) !== null);
    } catch {
        return false;
    }
}

export function initTheme() {
    document.documentElement.setAttribute("data-theme", resolveTheme(shellState.theme));
    paintContrast();
    initVariant();
    applyAccent(localStorage.getItem(ACCENT_KEY));
    if (systemDark && systemDark.addEventListener) {
        systemDark.addEventListener("change", () => {
            if (shellState.theme === "system") document.documentElement.setAttribute("data-theme", resolveTheme("system"));
        });
    }
    const contrast = contrastQuery();
    if (contrast && contrast.addEventListener) contrast.addEventListener("change", paintContrast);
}

const navSync = { userId: null, saved: null, timer: null };
const pinnedBody = (nav) => ({ pinned: [...((nav && nav.pinned) || [])] });

function saveNav() {
    navSync.timer = null;
    const body = pinnedBody(shellState.nav);
    const snapshot = JSON.stringify(body);
    if (snapshot === navSync.saved) return;
    const previous = navSync.saved;
    navSync.saved = snapshot;
    apiRequestWithoutCompnay("put", env.USER_NAV_PREFERENCES, body).catch((error) => {
        // Only the next change retries, so an offline session never loops; the pins stay local meanwhile.
        if (navSync.saved === snapshot) navSync.saved = previous;
        console.warn("nav preferences not saved", error);
    });
}

/* The user record is the source of truth once it arrives; this user's own pins kept only in
   this browser are uploaded the first time. Later refreshes of the same record are ignored
   so they cannot overwrite a change that is still waiting to be saved. */
export function syncNavPreferences(userId, stored) {
    if (!userId || navSync.userId === userId) return;
    clearTimeout(navSync.timer);
    navSync.timer = null;
    navSync.userId = userId;
    shellState.nav.mode = navModeOf(stored && stored.mode);
    if (stored && Array.isArray(stored.pinned)) {
        navSync.saved = JSON.stringify(pinnedBody(stored));
        shellState.nav = { ...shellState.nav, pinned: [...stored.pinned] };
        return;
    }
    const local = localPinsOf(userId);
    navSync.saved = JSON.stringify({ pinned: [] });
    shellState.nav = { ...shellState.nav, pinned: local };
    if (local.length) saveNav();
}

watch(() => shellState.nav, (val) => {
    localStorage.setItem(NAV_KEY, JSON.stringify({ ...val, uid: navSync.userId || signedInUserId() }));
    if (!navSync.userId) return;
    clearTimeout(navSync.timer);
    navSync.timer = setTimeout(saveNav, NAV_SAVE_DELAY_MS);
}, { deep: true });

/* Saved at once and on its own, so a switch never waits behind the kept places. */
export function applyNavMode(choice) {
    if (!isNavMode(choice)) return Promise.resolve(false);
    const previous = shellState.nav.mode;
    if (choice === previous) return Promise.resolve(true);
    shellState.nav.mode = choice;
    return apiRequestWithoutCompnay("put", env.USER_NAV_PREFERENCES, { mode: choice })
        .then((res) => {
            if (!res?.data?.status) throw new Error(res?.data?.message || "refused");
            return true;
        })
        .catch((error) => {
            if (shellState.nav.mode === choice) shellState.nav.mode = previous;
            console.warn("nav mode not saved", error);
            return false;
        });
}

export function keepOnRail(key) {
    const pinned = shellState.nav.pinned || [];
    if (shellState.nav.mode !== "simple" || SIMPLE_PLACES.includes(key) || pinned.includes(key)) return;
    shellState.nav.pinned = [...pinned, key];
}

export function openPanel(name) {
    shellState.moreOpen = false;
    shellState.profileOpen = false;
    shellState[name] = true;
}

export function closePopovers() {
    shellState.moreOpen = false;
    shellState.profileOpen = false;
}
