import { reactive, watch } from "vue";

const THEME_KEY = "ah.theme";
const NAV_KEY = "ah.nav";

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

watch(() => shellState.nav, (val) => localStorage.setItem(NAV_KEY, JSON.stringify(val)), { deep: true });

export function openPanel(name) {
    shellState.moreOpen = false;
    shellState.profileOpen = false;
    shellState[name] = true;
}

export function closePopovers() {
    shellState.moreOpen = false;
    shellState.profileOpen = false;
}
