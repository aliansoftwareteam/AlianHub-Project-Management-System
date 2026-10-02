import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { ownAiMentionKey } from "@/utils/agentMention";
import { AI_ACCESS, aiAccessFor } from "@/composable/aiAvailability";

/* An in-product agent needs a model on the server; with AI off or no model set up it would start and fail. */
const inProductAgentsCanRun = () => ![AI_ACCESS.OFF, AI_ACCESS.UNCONFIGURED].includes(aiAccessFor());

/* Empty on any failure: the pickers then look as they did before agents could be chosen there. */
export async function fetchRunnableAgents(taskId) {
    if (!taskId || !inProductAgentsCanRun()) return [];
    try {
        const res = await apiRequest("get", `${env.AGENTS_RUNNABLE}?taskId=${encodeURIComponent(taskId)}`);
        return res?.data?.status ? res.data.data || [] : [];
    } catch (error) {
        return [];
    }
}

export async function assignAgent(agentId, taskId) {
    const res = await apiRequest("post", env.AGENT_RUNS, { agentId, taskId, trigger: "assignment" });
    if (!res?.data?.status) throw new Error(res?.data?.statusText || "");
    return res.data.data;
}

const asPickerRow = (entry) => ({
    _id: `own_${entry.ownerId}`, name: entry.name, connected: true, ownerId: entry.ownerId, shownAs: entry.shownAs, mentionKey: ownAiMentionKey(entry.ownerId)
});

/* The person's own connected AI, when this task may be handed to it. Empty on any failure, like the agents above. */
export async function fetchOwnAi(taskId) {
    if (!taskId) return [];
    try {
        const res = await apiRequest("get", `${env.AGENTS_CONNECTED}?taskId=${encodeURIComponent(taskId)}`);
        return res?.data?.status ? (res.data.data || []).map(asPickerRow) : [];
    } catch (error) {
        return [];
    }
}

/* The connected AIs of the people this person sees as members. */
export async function fetchConnectedAgents() {
    try {
        const res = await apiRequest("get", env.AGENTS_CONNECTED);
        return res?.data?.status ? res.data.data || [] : [];
    } catch (error) {
        return [];
    }
}

/* The task joins that AI's work queue; its assignees are not touched. */
export async function handToOwnAi(taskId, ownerId) {
    const res = await apiRequest("post", `${env.AGENT_WORK_QUEUE}/task/${encodeURIComponent(taskId)}/hand-over`, { to: ownerId });
    if (!res?.data?.status) throw new Error(res?.data?.statusText || "");
    return res.data.data;
}

export async function pickAgent(option, taskId) {
    if (option.connected) {
        await handToOwnAi(taskId, option.ownerId);
        return { handed: true };
    }
    await assignAgent(option.agentId, taskId);
    return { handed: false };
}

/* The agents the caller may @name in a chat conversation; with no conversation, the ones they may message. */
export async function fetchChatAgents({ projectId = "", sprintId = "", taskId = "" } = {}) {
    const query = projectId
        ? `?projectId=${encodeURIComponent(projectId)}&sprintId=${encodeURIComponent(sprintId)}&taskId=${encodeURIComponent(taskId)}`
        : "";
    try {
        const res = await apiRequest("get", `${env.AGENTS_CHAT_USABLE}${query}`);
        return res?.data?.status ? res.data.data || [] : [];
    } catch (error) {
        return [];
    }
}

export async function openAgentConversation(agentId) {
    const res = await apiRequest("post", env.AGENTS_CHAT_DIRECT, { agentId });
    if (!res?.data?.status) throw new Error(res?.data?.statusText || "");
    return res.data.data;
}
