import { apiRequest } from "@/services";

const BASE = "/api/v2/assignment-rules/dispatcher";

const dataOf = (response) => response?.data?.data;

export const fetchDispatcher = (projectId) => apiRequest("get", `${BASE}/project/${projectId}`, undefined).then(dataOf);

export const saveDispatcher = (projectId, body) => apiRequest("put", `${BASE}/project/${projectId}`, body).then(dataOf);

export const addRoutingRule = (projectId, rule) => apiRequest("post", `${BASE}/project/${projectId}/rules`, rule).then(dataOf);

export const fetchTaskRouting = (taskId) => apiRequest("get", `${BASE}/task/${taskId}`, undefined).then(dataOf);

export const actOnRouting = (taskId, decisionId, action, body = {}) => apiRequest("post", `${BASE}/task/${taskId}/decisions/${decisionId}/${action}`, body).then(dataOf);
