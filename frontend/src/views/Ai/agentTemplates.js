// The new-agent templates as data. Every skill key resolves in Modules/Agents/skills and
// every action in Modules/Agents/registry: a template is never a promise the engine
// cannot keep. A template whose capability does not exist yet names it in `blockedBy`
// and stays visible but cannot be picked. Names and descriptions are i18n keys:
// AgentCatalogue.tpl_<slug>_name / _about.
//
// CommonJS so tests/agent-catalogue-templates.test.js can hold it to the server's registry.

const CATALOGUE_CATEGORIES = Object.freeze(["projects", "personal", "tasks", "scheduling", "product", "meetings", "knowledge", "research", "digests"]);

const READ = ["task.get", "tasks.search"];
const REPORT = [...READ, "task.comment"];
const BREAK_DOWN = [...READ, "subtask.create", "task.comment"];
// Registered while MCP_TOOLS_DATA is on; the wizard drops an action the registry does not offer.
const PAGE_READS = ["pages.search", "page.get"];

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

const CATALOGUE_TEMPLATES = Object.freeze([
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
    template("field_filler", ["tasks"], ["fields.fill"], [...READ, "aifield.fill"], { needs: ["ai_field"] }),
    template("mentions_digest", ["personal", "digests"], [], READ, scheduled("daily", { report: "mentions_digest", every: "weekdays", at: "16:00" })),
    template("wiki_upkeep", ["knowledge"], ["wiki.upkeep"], [...REPORT, ...PAGE_READS]),
    template("prd_writer", ["product"], ["prd.draft"], [...REPORT, "page.draft", ...PAGE_READS, "project.get"])
]);

module.exports = { CATALOGUE_CATEGORIES, CATALOGUE_TEMPLATES, SUGGESTS, SCHEDULED, DRAFT_MAX_AUTONOMY };
