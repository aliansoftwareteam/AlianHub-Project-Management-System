import { reactive } from "vue";

export const SHORTCUT_GROUPS = ["general", "navigation", "task", "inbox", "create"];

/* The one list the "?" sheet is drawn from. Keys are steps pressed in turn; "mod" is Cmd on
 * macOS and Ctrl elsewhere. Only single-key entries with a bound handler run through
 * handleShortcutKey; the rest are handled where they live and are listed here to be shown. */
export const SHORTCUTS = [
    { id: "palette", group: "general", keys: ["mod+k"], label: "Shortcuts.palette" },
    { id: "search", group: "general", keys: ["/"], label: "Shortcuts.search" },
    { id: "create-task", group: "general", keys: ["c"], label: "Shortcuts.create_task" },
    { id: "help", group: "general", keys: ["?"], label: "Shortcuts.help" },
    { id: "undo", group: "general", keys: ["mod+z"], label: "Shortcuts.undo" },
    { id: "go-home", group: "navigation", keys: ["g", "h"], label: "Shortcuts.go_home", nav: "home" },
    { id: "go-inbox", group: "navigation", keys: ["g", "i"], label: "Shortcuts.go_inbox", nav: "inbox" },
    { id: "go-projects", group: "navigation", keys: ["g", "p"], label: "Shortcuts.go_projects", nav: "projects" },
    { id: "go-time", group: "navigation", keys: ["g", "t"], label: "Shortcuts.go_time", nav: "time" },
    { id: "task-next", group: "task", keys: ["j"], label: "Shortcuts.task_next" },
    { id: "task-prev", group: "task", keys: ["k"], label: "Shortcuts.task_prev" },
    { id: "task-close", group: "task", keys: ["Escape"], label: "Shortcuts.task_close" },
    { id: "inbox-next", group: "inbox", keys: ["j"], label: "Shortcuts.inbox_next" },
    { id: "inbox-prev", group: "inbox", keys: ["k"], label: "Shortcuts.inbox_prev" },
    { id: "inbox-open", group: "inbox", keys: ["Enter"], label: "Shortcuts.inbox_open" },
    { id: "inbox-clear", group: "inbox", keys: ["e"], label: "Shortcuts.inbox_clear" },
    { id: "inbox-snooze", group: "inbox", keys: ["s"], label: "Shortcuts.inbox_snooze" },
    { id: "inbox-reply", group: "inbox", keys: ["r"], label: "Shortcuts.inbox_reply" },
    { id: "create-submit", group: "create", keys: ["Enter"], label: "Shortcuts.create_submit" },
    { id: "create-another", group: "create", keys: ["shift+Enter"], label: "Shortcuts.create_another" },
    { id: "create-open", group: "create", keys: ["mod+Enter"], label: "Shortcuts.create_open" }
];

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

const NON_TEXT_INPUTS = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image"]);

export function isEditableTarget(target) {
    if (!target || typeof target.closest !== "function") return false;
    if (target.isContentEditable || target.closest("[contenteditable=\"\"], [contenteditable=\"true\"]")) return true;
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

const isSingleKeyEntry = (entry) => entry.keys.every((step) => !step.includes("+") && step.length === 1);
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
