import { computed } from "vue";
import { useStore } from "vuex";
import { useCustomComposable } from "@/composable";
import { isOwnerOrAdmin } from "@/utils/roles";

// Mirrors Config/aiRights.js. These rows are company-wide, so they are never checked against a project's own rules.
export const AI_RIGHT = Object.freeze({
    ASSISTANT: "ai_assistant",
    AGENT_USE: "ai_agent_use",
    AGENTS: "ai_agents",
    SKILLS: "ai_skills",
    SKILL_RISK: "ai_skill_risk",
    CONNECTORS: "ai_connectors",
    EXTERNAL_CLIENTS: "ai_external_clients",
});

const RISK_ORDER = ["low", "medium", "high"];
const RISK_LEVELS = { 1: "low", 2: "medium", 3: "high" };

export const isWritable = (value) => value === true || value === 1 || value === 2;
export const isReadable = (value) => value !== null && value !== undefined && value !== 0;

export const riskWithin = (cap, risk) => Boolean(cap) && RISK_ORDER.indexOf(risk || "low") <= RISK_ORDER.indexOf(cap);

export function useAiRights() {
    const { getters } = useStore();
    const { checkPermission } = useCustomComposable();
    const roleType = computed(() => getters["settings/companyUserDetail"]?.roleType);
    const rulesLoaded = computed(() => Object.keys(getters["settings/rules"] || {}).length > 0);
    const privileged = computed(() => isOwnerOrAdmin(Number(roleType.value)));

    const raw = (key) => {
        if (privileged.value) return true;
        if (!rulesLoaded.value) return null;
        return checkPermission(`artificial_intelligence.${key}`);
    };

    const mayUse = (key) => computed(() => isWritable(raw(key)));
    const maySee = (key) => computed(() => isReadable(raw(key)));
    const skillRiskCap = computed(() => {
        const value = raw(AI_RIGHT.SKILL_RISK);
        return value === true ? "high" : RISK_LEVELS[value] || null;
    });

    return { privileged, mayUse, maySee, skillRiskCap };
}
