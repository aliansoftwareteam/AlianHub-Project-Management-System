// What each executable skill needs on the task before a run can do anything —
// mirrors the gather() checks in Modules/Agents/skills. A run without the input
// is skipped, so the wizard and the pickers state the requirement up front.
// Pure: components turn the codes into text with $t('Ai.req_<code>').

const REQUIREMENT_BY_SKILL = Object.freeze({
    "qa-review": "public_url",
    "pr.summary": "pr_link",
    "risk.flags": "pr_link",
    "brief.parse": "brief",
    "project.plan": "brief",
    "digest.ceo": "project_task",
    "risk.today": "project_task"
});

export const REQUIREMENT_CODES = Object.freeze([...new Set(Object.values(REQUIREMENT_BY_SKILL))]);

export const skillKeyOf = (skill) => {
    if (!skill) return "";
    if (typeof skill === "string") return skill;
    return String(skill.key || skill.slug || skill.name || "");
};

export const requirementOf = (skill) => REQUIREMENT_BY_SKILL[skillKeyOf(skill)] || "task";

/* Distinct requirements across an agent's enabled skills, first skill first. */
export const requirementsOf = (agent) => {
    const skills = Array.isArray(agent?.skills) ? agent.skills : [];
    const enabled = skills.filter((s) => typeof s === "string" || s.enabled !== false);
    return [...new Set(enabled.map(requirementOf))];
};
