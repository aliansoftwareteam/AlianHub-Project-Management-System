// What a skill needs on the task before a run can do anything. The answer comes
// from the skill manifest the server sends — `requires` on each skill entry —
// so there is no table here to fall out of step with the engine.
// Pure: components turn the codes into text with $t('Ai.req_<code>').

import agentWork from "@agentWork";

const work = agentWork.default || agentWork;

export const REQUIREMENT_CODES = Object.freeze([...work.INPUT_CODES]);
export const DEFAULT_REQUIREMENT = "task";

export const skillKeyOf = work.skillKeyOf;
export const indexSkills = work.indexSkills;
export const requiresOf = work.requiresOf;

export const requirementOf = (skill, index = null) => requiresOf(skill, index)?.code || DEFAULT_REQUIREMENT;

export const enabledSkillsOf = (agent) => {
    const skills = Array.isArray(agent?.skills) ? agent.skills : [];
    return skills.filter((s) => typeof s === "string" || s.enabled !== false);
};

/* Distinct requirements across an agent's enabled skills, first skill first. */
export const requirementsOf = (agent, index = null) => [...new Set(enabledSkillsOf(agent).map((s) => requirementOf(s, index)))];
