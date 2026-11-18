import pageContent from "@pageContent";

export const STARTERS = Object.freeze([
    { key: "status", icon: "reports" },
    { key: "task", icon: "plus" },
    { key: "urgent", icon: "alert" },
    { key: "message", icon: "mail" }
]);

export const MAX_CONTEXT = 8;
export const MENU_LIMIT = 8;
export const MENTION_KINDS = Object.freeze(["project", "list", "task", "page", "person"]);
export const RECENT_LIMIT = 8;
const RECENT_KEY = "ask.recentMentions";

export function starterPrompt(key, { t, projectName = "" }) {
    if (key === "status") return projectName ? t("Ask.starter_status_prompt", { project: projectName }) : t("Ask.starter_status_prompt_all");
    return t(`Ask.starter_${key}_prompt`);
}

/* The skill filter while the whole box is a `/word`; null once it holds anything else. */
export function slashQuery(text) {
    const match = /^\/(\S*)$/.exec(String(text == null ? "" : text));
    return match ? match[1] : null;
}

/* The `@word` that ends at the caret, when it starts a word; an address like me@example.com is not one. */
export function mentionAt(text, caret) {
    const value = String(text == null ? "" : text);
    const end = Number.isInteger(caret) ? caret : value.length;
    const match = /(^|\s)@([^\s@]{0,40})$/.exec(value.slice(0, end));
    if (!match) return null;
    return { query: match[2], start: match.index + match[1].length, end };
}

export function filterSkills(skills, query) {
    const q = String(query || "").toLowerCase();
    return (skills || [])
        .filter((skill) => skill && skill.key)
        .filter((skill) => !q || String(skill.name || "").toLowerCase().includes(q) || String(skill.key).toLowerCase().includes(q))
        .slice(0, MENU_LIMIT)
        .map((skill) => ({ kind: "skill", id: String(skill.key), title: skill.name || skill.key, sub: skill.description || "" }));
}

/* The server's picker rows, kept to the kinds the box knows. */
export function mentionItems(data) {
    const rows = Array.isArray(data && data.items) ? data.items : [];
    return rows
        .filter((row) => row && MENTION_KINDS.includes(row.kind) && row.id && row.title)
        .map((row) => ({ kind: row.kind, id: String(row.id), title: String(row.title), sub: String(row.sub || "") }));
}

const sameItem = (a, b) => a.kind === b.kind && a.id === b.id;

/* Rows grouped by kind in picker order, without repeats or what is already attached; `first` (recent picks)
 * lead their group when they match the query, and `apps` (from connectorResults) come before every group.
 * Each row keeps its place in the flat list for the keyboard. */
export function groupMentions(items, { first = [], taken = [], query = "", apps = [] } = {}) {
    const q = String(query || "").toLowerCase();
    const leading = (first || []).filter((item) => !q || String(item.title || "").toLowerCase().includes(q));
    const flat = [];
    [...leading, ...(items || [])].forEach((item) => {
        if (!item || !MENTION_KINDS.includes(item.kind)) return;
        if (flat.some((kept) => sameItem(kept, item)) || (taken || []).some((chip) => sameItem(chip, item))) return;
        flat.push(item);
    });
    const ordered = [...(apps || []).filter((app) => app && app.kind === "connector"), ...MENTION_KINDS.flatMap((kind) => flat.filter((item) => item.kind === kind))];
    const groups = ["connector", ...MENTION_KINDS]
        .map((kind) => ({ kind, items: ordered.map((item, index) => ({ item, index })).filter(({ item }) => item.kind === kind) }))
        .filter((group) => group.items.length);
    return { items: ordered, groups };
}

const CONTEXT_KINDS = Object.freeze([...MENTION_KINDS, "connector"]);

/* What the stream route takes for the attached chips: kind and id only. */
export function contextPayload(chips) {
    return (chips || []).filter((chip) => chip && CONTEXT_KINDS.includes(chip.kind) && chip.id).slice(0, MAX_CONTEXT).map(({ kind, id }) => ({ kind, id: String(id) }));
}

const storeOf = (storage) => {
    if (storage !== undefined) return storage;
    try {
        return typeof localStorage === "undefined" ? null : localStorage;
    } catch {
        return null;
    }
};

/* Picks kept in this browser, per company: a convenience, so a storage that fails reads as empty. */
export function recentMentions(companyId, storage) {
    const store = storeOf(storage);
    if (!store || !companyId) return [];
    try {
        const all = JSON.parse(store.getItem(RECENT_KEY) || "{}");
        const list = Array.isArray(all[companyId]) ? all[companyId] : [];
        return list.filter((item) => item && MENTION_KINDS.includes(item.kind) && item.id && item.title).slice(0, RECENT_LIMIT);
    } catch {
        return [];
    }
}

export function rememberMention(companyId, item, storage) {
    const store = storeOf(storage);
    if (!store || !companyId || !item || !MENTION_KINDS.includes(item.kind)) return;
    try {
        const all = JSON.parse(store.getItem(RECENT_KEY) || "{}");
        const kept = { kind: item.kind, id: String(item.id), title: String(item.title || ""), sub: String(item.sub || "") };
        const list = Array.isArray(all[companyId]) ? all[companyId] : [];
        all[companyId] = [kept, ...list.filter((other) => !(other && sameItem(other, kept)))].slice(0, RECENT_LIMIT);
        store.setItem(RECENT_KEY, JSON.stringify(all));
    } catch {
        /* a full or blocked storage only loses the recent list */
    }
}

export const CONNECTOR_LIMIT = 6;
const NAME_MIN = 2;
const WORD_EDGE = "[\\p{L}\\p{N}_]";
/* A reference only one app owns names that app as its name would (decision 25 of task 056). */
const OWNED_REFS = Object.freeze({
    github: [/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/i, /(?:^|[^\w./-])[\w-]+\/[\w.-]+#\d+(?!\d)/]
});

const escapeRx = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const sameChip = (a, b) => a.kind === b.kind && a.id === b.id;

export function connectorsOf(data, label = (id) => id) {
    const found = data || {};
    const held = new Set((Array.isArray(found.connections) ? found.connections : []).filter((c) => c && c.connected).map((c) => c.provider));
    return (Array.isArray(found.providers) ? found.providers : [])
        .filter((p) => p && typeof p.provider === "string" && p.provider)
        .map((p) => ({ id: p.provider, name: String(label(p.provider) || p.provider), connected: held.has(p.provider) }));
}

export function connectorResults(connectors, query, taken = []) {
    const q = String(query || "").toLowerCase();
    const listed = (connectors || [])
        .filter((c) => c && c.id && c.name && !taken.some((chip) => sameChip(chip, { kind: "connector", id: c.id })))
        .filter((c) => !q || c.name.toLowerCase().includes(q) || c.id.includes(q));
    return [...listed.filter((c) => c.connected), ...listed.filter((c) => !c.connected)]
        .slice(0, CONNECTOR_LIMIT)
        .map((c) => ({ kind: "connector", id: c.id, title: c.name, connected: Boolean(c.connected) }));
}

export function namedConnectors(text, connectors) {
    const value = String(text == null ? "" : text);
    return (connectors || [])
        .filter((c) => c && c.connected && c.id)
        .filter((c) => (String(c.name || "").trim().length >= NAME_MIN && new RegExp(`(?<!${WORD_EDGE})${escapeRx(c.name.trim())}(?!${WORD_EDGE})`, "iu").test(value))
            || (OWNED_REFS[c.id] || []).some((rx) => rx.test(value)))
        .map((c) => c.id);
}

const NOTE_KEYS = Object.freeze({
    not_connected: "Ask.connector_not_connected",
    broken: "Ask.connector_broken",
    provider_off: "Ask.connector_off",
    scope_missing: "Ask.connector_scope_missing",
    session_only: "Ask.connector_session_only",
    unknown_tool: "Ask.connector_unknown_tool",
    bad_input: "Ask.connector_bad_input",
    too_many: "Ask.connector_too_many",
    char_cap: "Ask.connector_char_cap",
    pick_failed: "Ask.connector_pick_failed",
    nothing_read: "Ask.connector_nothing_read",
    not_allowed: "Ask.connector_not_allowed",
    failed: "Ask.connector_failed"
});

export const connectorNoteKey = (code) => (Object.prototype.hasOwnProperty.call(NOTE_KEYS, code) ? NOTE_KEYS[code] : "");

/* A chip added by typing goes when the name is no longer typed; one the asker removed stays removed until the box is reset. */
export function withNamedChips(chips, text, connectors, dismissed = []) {
    const named = namedConnectors(text, connectors);
    const kept = (chips || []).filter((chip) => !(chip.auto && !named.includes(chip.id)));
    const added = named
        .filter((id) => !dismissed.includes(id) && !kept.some((chip) => sameChip(chip, { kind: "connector", id })))
        .map((id) => ({ kind: "connector", id, title: connectors.find((c) => c.id === id).name, auto: true }));
    return [...kept, ...added.slice(0, Math.max(0, MAX_CONTEXT - kept.length))];
}

const CITE = /\[([^\]\n]{1,80})\](?!\()/g;
const LINK = /\[([^\]\n]+)\]\([^)\n]*\)/g;
const MARKS = /\*\*|__|`/g;
const ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.+)$/;
const ISO_DAY = /\b(\d{4}-\d{2}-\d{2})\b/;
const DUE_PHRASE = /\b(?:due(?:\s+(?:on|by))?|by|deadline)\s*:?\s*\d{4}-\d{2}-\d{2}\b|\b\d{4}-\d{2}-\d{2}\b/i;
const NAME = "\\p{L}[\\p{L}'.-]*(?:\\s\\p{Lu}[\\p{L}'.-]*)?";
const OWNER_PHRASE = new RegExp(`\\b(?:owner|assignee|assigned to|assign to)\\s*:?\\s*(${NAME})`, "iu");
const AT_NAME = new RegExp(`(?:^|[\\s(])@(${NAME})`, "u");

const tidy = (text) => text
    .replace(/\(\s*\)/g, "")
    .replace(MARKS, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\s—–\-,;:.]+|[\s—–\-,;:.(]+$/g, "")
    .trim();

/* The list items of an answer as tasks to be: a title, and a due day or an owner when the item names one. */
export function workItemsOf(markdown) {
    const items = [];
    String(markdown == null ? "" : markdown).split("\n").forEach((line) => {
        const match = ITEM.exec(line);
        if (!match) return;
        let rest = match[1].replace(LINK, "$1").replace(CITE, "");
        const due = (ISO_DAY.exec(rest) || [])[1] || "";
        rest = rest.replace(DUE_PHRASE, "");
        const owner = OWNER_PHRASE.exec(rest) || AT_NAME.exec(rest);
        const who = owner ? owner[1].trim() : "";
        if (owner) rest = rest.replace(owner[0].replace(/^[\s(]/, ""), " ");
        const title = tidy(rest).slice(0, 250);
        if (title.length >= 3) items.push({ title, due, who });
    });
    return items;
}

export function matchMember(who, members) {
    const wanted = String(who || "").replace(/\s+/g, " ").trim().toLowerCase();
    if (!wanted) return "";
    const list = (members || []).filter((m) => m && m.id && m.name);
    const exact = list.find((m) => m.name.toLowerCase() === wanted);
    if (exact) return exact.id;
    const partial = list.filter((m) => m.name.toLowerCase().split(/\s+/).includes(wanted) || m.name.toLowerCase().startsWith(wanted));
    return partial.length === 1 ? partial[0].id : "";
}

/* The answer as editor blocks for a page: citations keep their key as plain text and inline marks go. */
export function answerBlocks(markdown) {
    const text = String(markdown == null ? "" : markdown).replace(LINK, "$1").replace(CITE, "$1").replace(MARKS, "");
    return pageContent.markdownToBlocks(text);
}

export function docTitleOf(markdown, question = "") {
    const heading = String(markdown || "").split("\n").map((line) => /^#{1,6}\s+(.+)$/.exec(line.trim())).find(Boolean);
    const raw = heading ? heading[1] : question || String(markdown || "").split("\n").find((line) => line.trim()) || "";
    return tidy(raw.replace(CITE, "")).slice(0, 120);
}

/* The end of a local day, which is what the task dialog stores for a due date picked as a day. */
export function endOfDayIso(day) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ""));
    if (!match) return "";
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 23, 59, 59, 999).toISOString();
}
