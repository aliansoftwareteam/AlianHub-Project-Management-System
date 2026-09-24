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

const initial = () => ({
    state: AI_STATE.UNKNOWN,
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

/* Unknown counts as usable so entry points do not flicker away while the read is in flight; the
 * server refuses any call while AI is off whatever the screen shows. */
export const aiUsable = computed(() => aiAvailability.state === AI_STATE.ON || aiAvailability.state === AI_STATE.UNKNOWN);

export function applyAiAvailability(data = {}) {
    Object.assign(aiAvailability, data || {});
}

export function resetAiAvailability() {
    Object.assign(aiAvailability, initial());
}

export async function loadAiAvailability(companyId) {
    try {
        const res = await apiRequest("get", env.AI_SWITCH);
        if (res?.data?.status) applyAiAvailability({ ...res.data.data, companyId: companyId || null });
    } catch (error) {
        applyAiAvailability({ state: AI_STATE.UNKNOWN, companyId: companyId || null });
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
