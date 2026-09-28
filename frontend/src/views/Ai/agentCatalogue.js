// The new-agent catalogue. Every skill key resolves in Modules/Agents/skills and
// every action in Modules/Agents/registry: a template is never a promise the
// engine cannot keep. A template whose capability does not exist yet names it in
// `blockedBy` and stays visible but cannot be picked. Names and descriptions are
// i18n keys: AgentCatalogue.tpl_<slug>_name / _about.
import { skillLabel } from "./plainLabels";
import { NEW_AGENT_DEFAULTS } from "./useAgents";

export const CATALOGUE_CATEGORIES = Object.freeze(["projects", "personal", "tasks", "scheduling", "product", "meetings", "knowledge", "research", "digests"]);

const READ = ["task.get", "tasks.search"];
const REPORT = [...READ, "task.comment"];
const BREAK_DOWN = [...READ, "subtask.create", "task.comment"];

const SUGGESTS = 1;
const SCHEDULED = 3;
// Mirrors the server's ceiling in Modules/Agents/builder.js.
const DRAFT_MAX_AUTONOMY = SUGGESTS;

const template = (slug, categories, skills, actions, extra = {}) => Object.freeze({
    slug,
    categories: Object.freeze(categories),
    skills: Object.freeze(skills),
    actions: Object.freeze(actions),
    autonomy: SUGGESTS,
    cadence: null,
    schedule: null,
    needs: Object.freeze(extra.needs || []),
    blockedBy: null,
    ...extra
});

// A template with a `schedule` offers it in the wizard: kept, it saves the agent at L3 with that
// schedule running the read-only report of the same name (Modules/Agents/schedules/reports.js).
const scheduled = (cadence, schedule) => ({ cadence, schedule: Object.freeze(schedule) });

export const CATALOGUE_TEMPLATES = Object.freeze([
    template("status_reporter", ["projects", "digests"], ["digest.ceo"], REPORT, scheduled("weekly", { report: "weekly_status", every: "weekly", weekday: 5, at: "16:00" })),
    template("priorities_manager", ["projects"], ["digest.ceo"], REPORT),
    template("daily_briefing", ["personal", "digests", "scheduling"], ["digest.ceo"], REPORT, scheduled("daily", { report: "daily_briefing", every: "weekdays", at: "08:30" })),
    template("work_breakdown", ["tasks"], ["brief.parse"], BREAK_DOWN),
    template("triage_new_tasks", ["tasks"], ["brief.parse"], BREAK_DOWN, { needs: ["rule"] }),
    template("deadline_watch", ["scheduling", "digests"], ["digest.ceo"], REPORT, scheduled("daily", { report: "deadline_watch", every: "weekdays", at: "09:00", days: 3 })),
    template("release_notes", ["product"], ["pr.summary"], [...REPORT, "task.link"]),
    template("qa_reviewer", ["product"], ["qa-review"], BREAK_DOWN),
    template("action_extractor", ["meetings"], ["brief.parse"], BREAK_DOWN),
    template("task_insights", ["research", "knowledge"], ["project.guide"], BREAK_DOWN, { needs: ["guide", "mention"] }),
    template("field_filler", ["tasks"], [], [...READ, "task.update"], { blockedBy: "ai_fields" }),
    template("mentions_digest", ["personal", "digests"], [], READ, scheduled("daily", { report: "mentions_digest", every: "weekdays", at: "16:00" })),
    template("wiki_upkeep", ["knowledge"], [], READ, { blockedBy: "pages" }),
    template("prd_writer", ["product"], [], [...READ, "page.draft"], { blockedBy: "doc_drafting" })
]);

export const templateName = (t, tpl) => t(`AgentCatalogue.tpl_${tpl.slug}_name`);
export const templateAbout = (t, tpl) => t(`AgentCatalogue.tpl_${tpl.slug}_about`);

const haystackOf = (t, tpl) => [templateName(t, tpl), templateAbout(t, tpl), ...tpl.skills.map((key) => skillLabel(t, key))].join(" ").toLowerCase();

export const filterTemplates = (t, templates, { query = "", category = "" } = {}) => {
    const words = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
    return templates.filter((tpl) => {
        if (category && !tpl.categories.includes(category)) return false;
        if (!words.length) return true;
        const hay = haystackOf(t, tpl);
        return words.every((w) => hay.includes(w));
    });
};

/* Why a template cannot be picked here: its own missing capability, or a skill the
 * workspace's manifest does not list or marks unavailable. An unloaded manifest blocks nothing. */
export const blockOf = (tpl, manifest = []) => {
    if (tpl.blockedBy) return tpl.blockedBy;
    if (!manifest.length) return null;
    const usable = tpl.skills.every((key) => {
        const skill = manifest.find((s) => s.key === key || (s.aliases || []).includes(key));
        return skill && !skill.unavailable && skill.enabled !== false;
    });
    return usable ? null : "unavailable";
};

export const selectableTemplates = (manifest = []) => CATALOGUE_TEMPLATES.filter((tpl) => !blockOf(tpl, manifest));

export const templateToPrefill = (t, tpl) => ({
    source: "template",
    slug: tpl.slug,
    name: templateName(t, tpl),
    description: templateAbout(t, tpl),
    skills: [...tpl.skills],
    allowedActions: [...tpl.actions],
    autonomy: tpl.autonomy,
    projectIds: [],
    spendCapUsd: NEW_AGENT_DEFAULTS.spendCapUsd,
    cadence: tpl.cadence,
    schedule: tpl.schedule ? { ...tpl.schedule } : null,
    scheduledAutonomy: tpl.schedule ? SCHEDULED : null,
    why: {},
    adjusted: []
});

const listOf = (value) => (Array.isArray(value) ? value.map(String).filter(Boolean) : []);

/* The server already narrows a draft; this repeats the ceilings so the wizard never opens above them. */
export const draftToPrefill = (draft = {}) => {
    const adjusted = new Set(listOf(draft.adjusted));
    const asked = Number(draft.autonomy);
    const autonomy = Number.isInteger(asked) && asked >= 0 && asked <= DRAFT_MAX_AUTONOMY ? asked : SUGGESTS;
    if (autonomy !== asked) adjusted.add("autonomy");
    const cap = Number(draft.spendCapUsd);
    const spendCapUsd = Number.isFinite(cap) && cap > 0 ? Math.min(cap, NEW_AGENT_DEFAULTS.spendCapUsd) : NEW_AGENT_DEFAULTS.spendCapUsd;
    if (Number.isFinite(cap) && cap !== spendCapUsd) adjusted.add("spendCap");
    const why = draft.why && typeof draft.why === "object" ? draft.why : {};
    return {
        source: "builder",
        slug: "",
        name: String(draft.name || ""),
        description: String(draft.description || ""),
        skills: listOf(draft.skills),
        allowedActions: listOf(draft.allowedActions),
        autonomy,
        projectIds: listOf(draft.projectIds),
        spendCapUsd,
        cadence: ["daily", "weekly"].includes(draft.cadence) ? draft.cadence : null,
        schedule: null,
        scheduledAutonomy: null,
        why: Object.fromEntries(Object.entries(why).filter(([field, line]) => !adjusted.has(field) && typeof line === "string" && line)),
        adjusted: [...adjusted]
    };
};
