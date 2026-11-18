import { apiRequest } from "@/services";

const BASE = "/api/v2/assignment-rules";

const dataOf = (response) => response?.data?.data;

export const fetchProjectRules = (projectId) => apiRequest("get", `${BASE}/project/${projectId}`, undefined).then(dataOf);

export const saveProjectRules = (projectId, body) => apiRequest("put", `${BASE}/project/${projectId}`, body).then(dataOf);

export const draftProjectRules = (projectId, userIds) => apiRequest("post", `${BASE}/project/${projectId}/draft`, { userIds }).then(dataOf);

export const fetchTaskSuggestion = (taskId) => apiRequest("get", `${BASE}/task/${taskId}`, undefined).then(dataOf);

export const actOnSuggestion = (taskId, decisionId, action) => apiRequest("post", `${BASE}/task/${taskId}/decisions/${decisionId}/${action}`, {}).then(dataOf);

export const refusalText = (error, fallback) => error?.response?.data?.statusText || error?.response?.data?.message || fallback;
