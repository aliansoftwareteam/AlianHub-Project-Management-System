import pageContent from "@pageContent";

export const STARTERS = Object.freeze([
    { key: "status", icon: "reports" },
    { key: "task", icon: "plus" },
    { key: "urgent", icon: "alert" },
    { key: "message", icon: "mail" }
]);

export const MAX_CONTEXT = 8;
export const MENU_LIMIT = 8;
export const MENTION_MIN = 2;

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

export function mentionResults(data) {
    const found = data || {};
    const rows = (list, limit, pick) => (Array.isArray(list) ? list : []).slice(0, limit).map(pick);
    return [
        ...rows(found.projects, 3, (p) => ({ kind: "project", id: String(p._id || ""), title: p.ProjectName || "" })),
        ...rows(found.tasks, 4, (task) => ({ kind: "task", id: String(task._id || ""), title: task.TaskName || "", sub: task.TaskKey || "" })),
        ...rows(found.pages, 3, (page) => ({ kind: "page", id: String(page._id || ""), title: page.title || "" }))
    ].filter((item) => item.id && item.title);
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
