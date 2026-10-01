// The new-agent catalogue: finding, blocking and pre-filling the templates in ./agentTemplates.
import { skillLabel } from "./plainLabels";
import { NEW_AGENT_DEFAULTS } from "./useAgents";
import { CATALOGUE_CATEGORIES, CATALOGUE_TEMPLATES, SUGGESTS, SCHEDULED, DRAFT_MAX_AUTONOMY } from "./agentTemplates";

export { CATALOGUE_CATEGORIES, CATALOGUE_TEMPLATES };

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
