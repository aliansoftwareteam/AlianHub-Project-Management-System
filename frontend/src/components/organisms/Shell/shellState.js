import { reactive, watch } from "vue";
import { apiRequestWithoutCompnay } from "@/services";
import * as env from "@/config/env";

const THEME_KEY = "ah.theme";
const CONTRAST_KEY = "ah.contrast";
const CONTRAST_CHOICES = ["auto", "standard", "high"];
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
    contrast: CONTRAST_CHOICES.includes(localStorage.getItem(CONTRAST_KEY)) ? localStorage.getItem(CONTRAST_KEY) : "auto",
    nav: { pinned: localPinsOf(signedInUserId()) },
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

export function initTheme() {
    document.documentElement.setAttribute("data-theme", resolveTheme(shellState.theme));
    paintContrast();
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

export function openPanel(name) {
    shellState.moreOpen = false;
    shellState.profileOpen = false;
    shellState[name] = true;
}

export function closePopovers() {
    shellState.moreOpen = false;
    shellState.profileOpen = false;
}
