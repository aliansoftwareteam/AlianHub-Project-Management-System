import { computed, reactive } from "vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";

export const AI_STATE = Object.freeze({
    UNKNOWN: "unknown",
    ON: "on",
    OFF_INSTANCE: "off_instance",
    OFF_WORKSPACE: "off_workspace",
    UNCONFIGURED: "unconfigured",
});

export const AI_ACCESS = Object.freeze({
    UNKNOWN: "unknown",
    OFF: "off",
    UNCONFIGURED: "unconfigured",
    NOT_PERMITTED: "not_permitted",
    USABLE: "usable",
});

const initial = () => ({
    state: AI_STATE.UNKNOWN,
    loaded: false,
    planAllowsAi: null,
    companyId: null,
    instanceEnabled: true,
    workspaceEnabled: true,
    provider: null,
    embeddings: false,
    canManageWorkspace: false,
    canConfigureInstance: false,
});

/* One copy for the whole app: the shell loads it per workspace and every AI entry point reads it. */
export const aiAvailability = reactive(initial());

/* A read that failed leaves the state unknown but loaded: the server still refuses every model
 * call while AI is off, so entry points then follow the permissions rather than vanishing. */
function serverAccess() {
    const { state, loaded } = aiAvailability;
    if (state === AI_STATE.OFF_INSTANCE || state === AI_STATE.OFF_WORKSPACE) return AI_ACCESS.OFF;
    if (state === AI_STATE.UNCONFIGURED) return AI_ACCESS.UNCONFIGURED;
    if (state === AI_STATE.ON || loaded) return AI_ACCESS.USABLE;
    return AI_ACCESS.UNKNOWN;
}

const hasAiApp = (project) => Array.isArray(project?.apps) && project.apps.some((app) => app === "AI" || app?.key === "AI");

/* `permitted` is the caller's own role permission for the feature; `project`, when passed, must
 * have the AI app switched on. Leaving either out skips that check. */
export function aiAccessFor(context = {}) {
    const server = serverAccess();
    if (server !== AI_ACCESS.USABLE) return server;
    if (aiAvailability.planAllowsAi === null) return AI_ACCESS.UNKNOWN;
    if (!aiAvailability.planAllowsAi || context.permitted === false) return AI_ACCESS.NOT_PERMITTED;
    if ("project" in context && !hasAiApp(context.project)) return AI_ACCESS.NOT_PERMITTED;
    return AI_ACCESS.USABLE;
}

export const canUseAi = (context) => aiAccessFor(context) === AI_ACCESS.USABLE;

/* Model availability alone, for entry points whose own files still decide plan and role. */
export const aiUsable = computed(() => serverAccess() === AI_ACCESS.USABLE);

/* The AI screens explain a missing provider themselves, so only off, or not yet known, hides the links into them. */
export const aiReachable = computed(() => {
    const server = serverAccess();
    return server !== AI_ACCESS.OFF && server !== AI_ACCESS.UNKNOWN;
});

export const aiOff = computed(() => serverAccess() === AI_ACCESS.OFF);

export function applyAiAvailability(data = {}) {
    Object.assign(aiAvailability, data || {});
}

export function resetAiAvailability() {
    Object.assign(aiAvailability, initial());
}

export function trackAiPlan(planFeature) {
    applyAiAvailability({ planAllowsAi: planFeature ? Boolean(planFeature.aiPermission) : null });
}

export async function loadAiAvailability(companyId) {
    try {
        const res = await apiRequest("get", env.AI_SWITCH);
        applyAiAvailability(res?.data?.status ? { ...res.data.data, companyId: companyId || null, loaded: true } : { loaded: true });
    } catch (error) {
        applyAiAvailability({ state: AI_STATE.UNKNOWN, companyId: companyId || null, loaded: true });
    }
    return aiAvailability;
}

export async function setWorkspaceAi(enabled) {
    const res = await apiRequest("put", env.AI_SWITCH, { enabled: Boolean(enabled) });
    if (res?.data?.status) applyAiAvailability(res.data.data);
    return res;
}

/* The heading, the sentence and the route of the one action this person can take, if any. */
export function messageKeysFor({ state, canConfigureInstance = false, canManageWorkspace = false } = {}) {
    if (state === AI_STATE.OFF_INSTANCE) {
        return { title: "AiAvailability.off_title", body: "AiAvailability.off_instance", action: canConfigureInstance ? "InstanceSettings" : null };
    }
    if (state === AI_STATE.OFF_WORKSPACE) {
        return canManageWorkspace
            ? { title: "AiAvailability.off_title", body: "AiAvailability.off_workspace_manager", action: "Setting" }
            : { title: "AiAvailability.off_title", body: "AiAvailability.off_workspace_member", action: null };
    }
    if (state === AI_STATE.UNCONFIGURED) {
        return canConfigureInstance
            ? { title: "AiAvailability.unconfigured_title", body: "AiAvailability.unconfigured_owner", action: "InstanceSettings" }
            : { title: "AiAvailability.unavailable_title", body: "AiAvailability.unconfigured_member", action: null };
    }
    return null;
}
