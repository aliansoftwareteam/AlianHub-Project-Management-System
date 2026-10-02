import { computed, onBeforeUnmount, reactive, unref, watch } from "vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { AGENTS_CHANGED_EVENT, LIMITS_CHANGE } from "@/views/Ai/agentFeed";

/* The project list is read once at start and no project event reaches a browser, so a project object keeps the
 * pause it was loaded with. What a save or a later read says is kept here and wins over it. */
const heard = reactive(new Map());

export const noteAgentsPaused = (projectId, paused) => {
    if (projectId) heard.set(String(projectId), paused === true);
};

export const agentsPausedIn = (project) => {
    const id = String(project?._id || "");
    return heard.has(id) ? heard.get(id) : project?.agentLimits?.paused === true;
};

export const forgetAgentPauses = () => heard.clear();

/* For the page that shows one project at a time. The agents signal says only that some project's limits
 * changed, so the open project is read again, and each project opened later is read once. */
export function useAgentPause(project, socket) {
    const idOf = () => String(unref(project)?._id || "");
    const readSinceSignal = new Set();
    let signalled = false;
    const lastAsk = new Map();

    const read = async (projectId) => {
        if (!projectId) return;
        readSinceSignal.add(projectId);
        const ask = (lastAsk.get(projectId) || 0) + 1;
        lastAsk.set(projectId, ask);
        try {
            const res = await apiRequest("get", `${env.AGENT_PROJECT_LIMITS}/${encodeURIComponent(projectId)}`, undefined, undefined, { background: true });
            // A pause and a resume in quick succession send two signals; the answer to the first read may land last.
            if (lastAsk.get(projectId) === ask && res?.data?.status === true) noteAgentsPaused(projectId, res.data.data?.limits?.paused);
        } catch (e) {
            readSinceSignal.delete(projectId);
        }
    };

    const onAgentsChanged = (change) => {
        if (change?.kind !== LIMITS_CHANGE) return;
        signalled = true;
        readSinceSignal.clear();
        read(idOf());
    };

    watch(() => unref(socket), (next, previous) => {
        previous?.off?.(AGENTS_CHANGED_EVENT, onAgentsChanged);
        next?.on?.(AGENTS_CHANGED_EVENT, onAgentsChanged);
    }, { immediate: true });
    watch(idOf, (projectId) => {
        if (signalled && !readSinceSignal.has(projectId)) read(projectId);
    });
    onBeforeUnmount(() => unref(socket)?.off?.(AGENTS_CHANGED_EVENT, onAgentsChanged));

    return { agentsPaused: computed(() => agentsPausedIn(unref(project))) };
}
