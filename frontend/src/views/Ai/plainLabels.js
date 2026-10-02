// Built-in skills carry persona names ("Reviewer") in their records, which say
// who rather than what; these keys are named from the i18n map instead.
const BUILT_IN_SKILLS = Object.freeze(["brief.parse", "project.plan", "pr.summary", "risk.flags", "digest.ceo", "risk.today", "project.guide", "qa-review", "fields.fill", "prd.draft", "wiki.upkeep", "slack.summary"]);
// The server names these for the data model, where every list is a "sprint"; the page says what a person sees.
const REWORDED_ACTIONS = Object.freeze(["task.sprint.move"]);
const NEVER_ACTIONS = Object.freeze(["project.delete", "task.delete", "billing.*", "deploy.production", "git.merge", "member.remove", "permissions.edit", "status.set(\"Done\")"]);
const AUTONOMY_LEVELS = Object.freeze([0, 1, 2, 3]);

const DAY_MS = 24 * 60 * 60 * 1000;
export const WAITING_MARK_DAYS = 3;

export const labelSlug = (key) => String(key || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

export const humaniseKey = (key) => {
    const words = String(key || "").replace(/[^A-Za-z0-9]+/g, " ").trim().toLowerCase();
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : "";
};

const keyOf = (item) => (item && typeof item === "object" ? String(item.key || item.slug || item.name || "") : String(item || ""));
const fieldOf = (item, field) => (item && typeof item === "object" ? String(item[field] || "").trim() : "");
const isOwn = (item) => fieldOf(item, "source") === "data";

export const skillLabel = (t, skill) => {
    const key = keyOf(skill);
    const name = fieldOf(skill, "name");
    const named = name && name !== key ? name : "";
    if (named && isOwn(skill)) return named;
    if (BUILT_IN_SKILLS.includes(key)) return t(`Ai.skill_label_${labelSlug(key)}`);
    return named || humaniseKey(key);
};

export const skillAbout = (t, skill) => {
    const key = keyOf(skill);
    const description = fieldOf(skill, "description");
    if (description && isOwn(skill)) return description;
    if (BUILT_IN_SKILLS.includes(key)) return t(`Ai.skill_about_${labelSlug(key)}`);
    return description;
};

export const actionLabel = (t, action, actions = []) => {
    const key = keyOf(action);
    if (REWORDED_ACTIONS.includes(key)) return t(`Ai.action_label_${labelSlug(key)}`);
    const label = fieldOf(action, "label") || fieldOf((actions || []).find((a) => a && a.key === key), "label");
    if (label) return label;
    if (NEVER_ACTIONS.includes(key)) return t(`Ai.never_label_${labelSlug(key)}`);
    return humaniseKey(key);
};

const levelOf = (value) => {
    const level = Number(value);
    return AUTONOMY_LEVELS.includes(level) ? level : 0;
};

export const autonomyName = (t, level) => t(`Ai.autonomy_name_${levelOf(level)}`);
export const autonomyAbout = (t, level) => t(`Ai.autonomy_about_${levelOf(level)}`);
export const autonomyTip = (t, level) => t("Ai.autonomy_tip", { code: `L${levelOf(level)}`, about: autonomyAbout(t, level) });

// The engine writes these titles in English (Modules/Agents/engine/graph.js);
// stored proposals keep them, so they are read back rather than re-fetched.
const CHANGES_ON = /^(\S+): (\d+) change(?:\(s\)|s)? on (.+)$/;
const FINDINGS_ON = /^File (\d+) QA finding(?:\(s\)|s)? on (.+)$/;

// A proposal filed by a caller that had no title to give was stored with the text of that nothing.
const NO_WORDS = Object.freeze(["", "undefined", "null"]);
const wordsOf = (value) => {
    const words = String(value ?? "").trim();
    return NO_WORDS.includes(words) ? "" : words;
};

const titleFromChanges = (t, proposal) => {
    const changes = Array.isArray(proposal && proposal.changes) ? proposal.changes : [];
    const first = wordsOf(changes[0] && changes[0].label);
    if (!first) return t("Ai.proposal_untitled");
    const more = changes.length - 1;
    return more ? t("Ai.proposal_first_and_more", { label: first, n: more }, more) : first;
};

export const proposalTitle = (t, proposal) => {
    const what = wordsOf(proposal && proposal.what);
    if (!what) return titleFromChanges(t, proposal);
    const changes = CHANGES_ON.exec(what);
    if (changes) {
        const n = Number(changes[2]);
        return t("Ai.proposal_changes_on", { skill: skillLabel(t, changes[1]), n, on: changes[3] }, n);
    }
    const findings = FINDINGS_ON.exec(what);
    if (findings) {
        const n = Number(findings[1]);
        return t("Ai.proposal_findings_on", { n, on: findings[2] }, n);
    }
    return what;
};

export const waitingDaysOf = (proposal, now = Date.now()) => {
    if (!proposal || proposal.status !== "pending" || !proposal.createdAt) return 0;
    const age = now - new Date(proposal.createdAt).getTime();
    return age > WAITING_MARK_DAYS * DAY_MS ? Math.floor(age / DAY_MS) : 0;
};

const timeOf = (p) => new Date((p && p.createdAt) || 0).getTime() || 0;

export const sortProposals = (list, order = "newest") => {
    const sign = order === "oldest" ? 1 : -1;
    return [...(list || [])].sort((a, b) => sign * (timeOf(a) - timeOf(b)));
};
