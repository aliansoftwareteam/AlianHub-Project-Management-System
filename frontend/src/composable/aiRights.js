import { computed } from "vue";
import { useStore } from "vuex";
import { isOwnerOrAdmin } from "@/utils/roles";

// Mirrors Config/aiRights.js. These rows are company-wide, so they are read from the company rules, never a project's.
export const AI_RIGHT = Object.freeze({
    ASSISTANT: "ai_assistant",
    AGENT_USE: "ai_agent_use",
    AGENTS: "ai_agents",
    SKILLS: "ai_skills",
    SKILL_RISK: "ai_skill_risk",
    CONNECTORS: "ai_connectors",
    EXTERNAL_CLIENTS: "ai_external_clients",
});

const SECTION = "artificial_intelligence";
const RISK_ORDER = ["low", "medium", "high"];
const RISK_LEVELS = { 1: "low", 2: "medium", 3: "high" };

export const isWritable = (value) => value === true || value === 1 || value === 2;
export const isReadable = (value) => value !== null && value !== undefined && value !== 0;

export const riskWithin = (cap, risk) => Boolean(cap) && RISK_ORDER.indexOf(risk || "low") <= RISK_ORDER.indexOf(cap);

/* What a role holds on one AI row of the arranged company rules; owners and admins hold everything. */
export const aiRightOf = (rules, roleType, key) => {
    if (isOwnerOrAdmin(Number(roleType))) return true;
    const rule = rules && rules[SECTION] && rules[SECTION][key];
    const entry = rule && Array.isArray(rule.roles) ? rule.roles.find((role) => Number(role.key) === Number(roleType)) : null;
    return entry ? entry.permission : null;
};

export function useAiRights() {
    const { getters } = useStore();
    const roleType = computed(() => getters["settings/companyUserDetail"]?.roleType);
    const privileged = computed(() => isOwnerOrAdmin(Number(roleType.value)));
    const raw = (key) => aiRightOf(getters["settings/rules"], roleType.value, key);

    const mayUse = (key) => computed(() => isWritable(raw(key)));
    const maySee = (key) => computed(() => isReadable(raw(key)));
    const skillRiskCap = computed(() => {
        const value = raw(AI_RIGHT.SKILL_RISK);
        return value === true ? "high" : RISK_LEVELS[value] || null;
    });

    return { privileged, mayUse, maySee, skillRiskCap };
}
