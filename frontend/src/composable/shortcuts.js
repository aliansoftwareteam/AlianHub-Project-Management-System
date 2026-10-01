import { reactive } from "vue";

export function isMacPlatform(nav = typeof navigator === "undefined" ? undefined : navigator) {
    const platform = (nav && ((nav.userAgentData && nav.userAgentData.platform) || nav.platform)) || "";
    return /mac|iphone|ipad|ipod/i.test(platform);
}

export const SHORTCUT_GROUPS = ["general", "navigation", "task", "inbox", "create", "palette", "docs"];
export const SHORTCUT_SCOPES = ["global", "task", "inbox", "create", "palette", "docs"];

/* The one registry of keyboard shortcuts: the "?" sheet, the key chips and aria-keyshortcuts are
 * all drawn from it. Keys are steps pressed in turn; "mod" is Cmd on macOS and Ctrl elsewhere.
 * A scope is where the keys act, and a combination is bound once per scope. Only single-key
 * entries with a bound handler run through handleShortcutKey; the rest are handled where they
 * live, reading their key from here where they can, and are listed to be shown. */
export const SHORTCUTS = [
    { id: "palette", scope: "global", group: "general", keys: ["mod+k"], label: "Shortcuts.palette" },
    { id: "search", scope: "global", group: "general", keys: ["/"], label: "Shortcuts.search" },
    { id: "create-task", scope: "global", group: "general", keys: ["c"], label: "Shortcuts.create_task" },
    { id: "help", scope: "global", group: "general", keys: ["?"], label: "Shortcuts.help" },
    { id: "undo", scope: "global", group: "general", keys: ["mod+z"], label: "Shortcuts.undo" },
    { id: "go-home", scope: "global", group: "navigation", keys: ["g", "h"], label: "Shortcuts.go_home", nav: "home" },
    { id: "go-inbox", scope: "global", group: "navigation", keys: ["g", "i"], label: "Shortcuts.go_inbox", nav: "inbox" },
    { id: "go-projects", scope: "global", group: "navigation", keys: ["g", "p"], label: "Shortcuts.go_projects", nav: "projects" },
    { id: "go-time", scope: "global", group: "navigation", keys: ["g", "t"], label: "Shortcuts.go_time", nav: "time" },
    { id: "task-next", scope: "task", group: "task", keys: ["j"], label: "Shortcuts.task_next" },
    { id: "task-prev", scope: "task", group: "task", keys: ["k"], label: "Shortcuts.task_prev" },
    { id: "task-close", scope: "task", group: "task", keys: ["Escape"], label: "Shortcuts.task_close" },
    { id: "inbox-next", scope: "inbox", group: "inbox", keys: ["j"], label: "Shortcuts.inbox_next" },
    { id: "inbox-prev", scope: "inbox", group: "inbox", keys: ["k"], label: "Shortcuts.inbox_prev" },
    { id: "inbox-open", scope: "inbox", group: "inbox", keys: ["Enter"], label: "Shortcuts.inbox_open" },
    { id: "inbox-clear", scope: "inbox", group: "inbox", keys: ["e"], label: "Shortcuts.inbox_clear" },
    { id: "inbox-snooze", scope: "inbox", group: "inbox", keys: ["s"], label: "Shortcuts.inbox_snooze" },
    { id: "inbox-reply", scope: "inbox", group: "inbox", keys: ["r"], label: "Shortcuts.inbox_reply" },
    { id: "inbox-send-reply", scope: "inbox", group: "inbox", keys: ["mod+Enter"], label: "Shortcuts.inbox_send_reply" },
    { id: "create-submit", scope: "create", group: "create", keys: ["Enter"], label: "Shortcuts.create_submit" },
    { id: "create-another", scope: "create", group: "create", keys: ["shift+Enter"], label: "Shortcuts.create_another" },
    { id: "create-open", scope: "create", group: "create", keys: ["mod+Enter"], label: "Shortcuts.create_open" },
    { id: "palette-next", scope: "palette", group: "palette", keys: ["ArrowDown"], label: "Shortcuts.palette_next" },
    { id: "palette-prev", scope: "palette", group: "palette", keys: ["ArrowUp"], label: "Shortcuts.palette_prev" },
    { id: "palette-run", scope: "palette", group: "palette", keys: ["Enter"], label: "Shortcuts.palette_run" },
    { id: "palette-new-tab", scope: "palette", group: "palette", keys: ["mod+Enter"], label: "Shortcuts.palette_new_tab" },
    { id: "palette-actions", scope: "palette", group: "palette", keys: ["Tab"], label: "Shortcuts.palette_actions" },
    { id: "palette-close", scope: "palette", group: "palette", keys: ["Escape"], label: "Shortcuts.palette_close" },
    { id: "doc-save", scope: "docs", group: "docs", keys: ["mod+s"], label: "Shortcuts.doc_save" }
];

const byId = (id) => SHORTCUTS.find((entry) => entry.id === id);

export function platformKeys(entry, mac = isMacPlatform()) {
    return entry.keys.map((step) => step.split("+").map((token) => {
        if (token !== "mod") return token;
        return mac ? "meta" : "ctrl";
    }));
}

/* The letter or named key a handler compares event.key against. */
export function shortcutKey(id) {
    const entry = byId(id);
    return entry ? entry.keys[entry.keys.length - 1].split("+").pop() : "";
}

const CAP_SYMBOLS = { meta: "⌘", ArrowUp: "↑", ArrowDown: "↓" };
const CAP_LABELS = {
    ctrl: "Shortcuts.key_ctrl",
    shift: "Shortcuts.key_shift",
    Enter: "Shortcuts.key_enter",
    Escape: "Shortcuts.key_escape",
    Tab: "Shortcuts.key_tab"
};

function capOf(token, t) {
    if (CAP_SYMBOLS[token]) return CAP_SYMBOLS[token];
    if (CAP_LABELS[token]) return t(CAP_LABELS[token]);
    return token.length === 1 ? token.toUpperCase() : token;
}

export function shortcutCaps(id, t, mac = isMacPlatform()) {
    const entry = byId(id);
    return entry ? platformKeys(entry, mac).map((step) => step.map((token) => capOf(token, t))) : [];
}

const SINGLE_KEYS_STORAGE = "ah.shortcuts.singleKeys";
const SEQUENCE_WINDOW_MS = 1500;

function storedSingleKeys() {
    try {
        return localStorage.getItem(SINGLE_KEYS_STORAGE) !== "off";
    } catch {
        return true;
    }
}

export const shortcutPrefs = reactive({ singleKeys: storedSingleKeys() });
export const shortcutSheet = reactive({ open: false });

export function openShortcutSheet() {
    shortcutSheet.open = true;
}

export function closeShortcutSheet() {
    shortcutSheet.open = false;
}

export function setSingleKeyShortcuts(on) {
    shortcutPrefs.singleKeys = on !== false;
    try {
        localStorage.setItem(SINGLE_KEYS_STORAGE, shortcutPrefs.singleKeys ? "on" : "off");
    } catch {
        /* storage may be unavailable */
    }
}

export function syncShortcutPreferences(stored) {
    setSingleKeyShortcuts(!(stored && stored.singleKeyShortcuts === false));
}

const isSingleKeyEntry = (entry) => entry.keys.every((step) => !step.includes("+") && step.length === 1);
const isLive = (entry) => Boolean(entry) && (shortcutPrefs.singleKeys || !isSingleKeyEntry(entry));

/* The text of a key chip: "⌘K" on macOS, "Ctrl+K" elsewhere, and nothing for a key that is switched off. */
export function shortcutHint(id, t, mac = isMacPlatform()) {
    if (!isLive(byId(id))) return "";
    return shortcutCaps(id, t, mac)
        .map((step) => step.reduce((text, cap, i) => text + (i && step[i - 1] !== CAP_SYMBOLS.meta ? "+" : "") + cap, ""))
        .join(" ");
}

const ARIA_KEYS = { meta: "Meta", ctrl: "Control", shift: "Shift" };

export function ariaKeyShortcuts(id, mac = isMacPlatform()) {
    const entry = byId(id);
    if (!isLive(entry)) return null;
    return platformKeys(entry, mac)
        .map((step) => step.map((token) => ARIA_KEYS[token] || (token.length === 1 ? token.toUpperCase() : token)).join("+"))
        .join(" ");
}

const NON_TEXT_INPUTS = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image"]);

export function isEditableTarget(target) {
    if (!target || typeof target.closest !== "function") return false;
    if (target.isContentEditable || target.closest("[contenteditable=\"\"], [contenteditable=\"true\"], .codex-editor")) return true;
    const tag = String(target.tagName || "").toLowerCase();
    if (tag === "textarea" || tag === "select") return true;
    if (tag === "input") return !NON_TEXT_INPUTS.has(String(target.getAttribute("type") || "").toLowerCase());
    return false;
}

const OPEN_LAYERS = "[aria-modal=\"true\"], dialog[open], .ah-sheet__backdrop, .swal2-container";

export function hasOpenDialog(doc = typeof document === "undefined" ? null : document) {
    return Boolean(doc && doc.querySelector(OPEN_LAYERS));
}

const isLetter = (key) => /^[a-z]$/i.test(key);

export function acceptsSingleKey(event, { dialogOpen = hasOpenDialog() } = {}) {
    if (!event || !shortcutPrefs.singleKeys) return false;
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.repeat) return false;
    if (event.metaKey || event.ctrlKey || event.altKey) return false;
    // Shift is part of "?" (and of "/" on some layouts), but never of a letter shortcut.
    if (event.shiftKey && isLetter(event.key)) return false;
    return !dialogOpen && !isEditableTarget(event.target);
}

const bindings = new Map();
const pending = { key: "", at: 0 };
let listening = false;

const bound = (entry) => bindings.has(entry.id) && isSingleKeyEntry(entry);

function run(entry, event) {
    if (bindings.get(entry.id)(event) === false) return null;
    if (typeof event.preventDefault === "function") event.preventDefault();
    return entry.id;
}

export function handleShortcutKey(event, options = {}) {
    if (!acceptsSingleKey(event, options)) {
        pending.key = "";
        return null;
    }
    const key = event.key;
    const prefix = pending.key && Date.now() - pending.at <= SEQUENCE_WINDOW_MS ? pending.key : "";
    pending.key = "";
    if (prefix) {
        const second = SHORTCUTS.find((s) => bound(s) && s.keys.length === 2 && s.keys[0] === prefix && s.keys[1] === key);
        return second ? run(second, event) : null;
    }
    const single = SHORTCUTS.find((s) => bound(s) && s.keys.length === 1 && s.keys[0] === key);
    if (single) return run(single, event);
    if (SHORTCUTS.some((s) => bound(s) && s.keys.length === 2 && s.keys[0] === key)) {
        pending.key = key;
        pending.at = Date.now();
    }
    return null;
}

const onDocumentKey = (event) => handleShortcutKey(event);

export function bindShortcut(id, handler) {
    bindings.set(id, handler);
    if (!listening && typeof document !== "undefined") {
        document.addEventListener("keydown", onDocumentKey);
        listening = true;
    }
    return () => {
        if (bindings.get(id) !== handler) return;
        bindings.delete(id);
        if (!bindings.size && listening) {
            document.removeEventListener("keydown", onDocumentKey);
            listening = false;
        }
    };
}
