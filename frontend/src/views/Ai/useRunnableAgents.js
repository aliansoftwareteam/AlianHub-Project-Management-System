import { apiRequest } from "@/services";
import * as env from "@/config/env";

/* Empty on any failure: the pickers then look as they did before agents could be chosen there. */
export async function fetchRunnableAgents(taskId) {
    if (!taskId) return [];
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
