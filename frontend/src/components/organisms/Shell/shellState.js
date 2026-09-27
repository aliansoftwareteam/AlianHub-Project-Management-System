import { reactive, watch } from "vue";
import { apiRequestWithoutCompnay } from "@/services";
import * as env from "@/config/env";

const THEME_KEY = "ah.theme";
const NAV_KEY = "ah.nav";
const NAV_SAVE_DELAY_MS = 800;

function readJson(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
    } catch {
        return fallback;
    }
}

export const shellState = reactive({
    notepad: false,
    clips: false,
    reminders: false,
    talkToText: false,
    tour: false,
    moreOpen: false,
    profileOpen: false,
    sidebarCollapsed: false,
    theme: localStorage.getItem(THEME_KEY) || "light",
    nav: readJson(NAV_KEY, { pinned: [] }),
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

export function initTheme() {
    document.documentElement.setAttribute("data-theme", resolveTheme(shellState.theme));
    if (systemDark && systemDark.addEventListener) {
        systemDark.addEventListener("change", () => {
            if (shellState.theme === "system") document.documentElement.setAttribute("data-theme", resolveTheme("system"));
        });
    }
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

/* The user record is the source of truth once it arrives; pins kept only in this browser
   from before are uploaded the first time. Later refreshes of the same record are ignored
   so they cannot overwrite a change that is still waiting to be saved. */
export function syncNavPreferences(userId, stored) {
    if (!userId || navSync.userId === userId) return;
    navSync.userId = userId;
    if (stored && Array.isArray(stored.pinned)) {
        navSync.saved = JSON.stringify(pinnedBody(stored));
        shellState.nav = { ...shellState.nav, pinned: [...stored.pinned] };
    } else if (shellState.nav.pinned && shellState.nav.pinned.length) {
        saveNav();
    } else {
        navSync.saved = JSON.stringify(pinnedBody(shellState.nav));
    }
}

watch(() => shellState.nav, (val) => {
    localStorage.setItem(NAV_KEY, JSON.stringify(val));
    if (!navSync.userId) return;
    clearTimeout(navSync.timer);
    navSync.timer = setTimeout(saveNav, NAV_SAVE_DELAY_MS);
}, { deep: true });

export function openPanel(name) {
    shellState.moreOpen = false;
    shellState.profileOpen = false;
    shellState[name] = true;
}

export function closePopovers() {
    shellState.moreOpen = false;
    shellState.profileOpen = false;
}
