import { reactive } from "vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";

export const INCLUDE_PARTS = ["description", "checklist", "subtasks", "subtaskAssignees", "type", "priority", "tags", "estimate", "points", "customFields", "dates"];

export const templateDialog = reactive({ open: false, mode: "apply", task: null, project: null });

export function openTemplateDialog({ mode = "apply", task = null, project = null } = {}) {
    Object.assign(templateDialog, { open: true, mode, task, project });
}

export function closeTemplateDialog() {
    Object.assign(templateDialog, { open: false, task: null, project: null });
}

const pad = (n) => String(n).padStart(2, "0");

export function localDay(date = new Date()) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/* The server counts template dates from the caller's own day, not the server's. */
export function applyContext(date = new Date()) {
    return { applyDate: localDay(date), tzOffsetMinutes: date.getTimezoneOffset() };
}

export function dayFromOffset(offset, from = new Date()) {
    if (offset === null || offset === undefined || offset === "" || !Number.isFinite(Number(offset))) return "";
    return localDay(new Date(from.getFullYear(), from.getMonth(), from.getDate() + Number(offset)));
}

export function renderTitle(pattern, { title = "", date = "" } = {}) {
    if (!pattern) return String(title || "");
    return String(pattern).replace(/\{title\}/g, title || "").replace(/\{date\}/g, date || "").replace(/\s+/g, " ").trim();
}

export const defaultTemplateOf = (templates) => (templates || []).find((template) => template.isDefault) || null;

const listOf = (response) => (response?.data?.status && Array.isArray(response.data.data) ? response.data.data : []);

export function listTemplates(projectId = "") {
    const url = projectId ? `${env.TASK_TEMPLATES}?projectId=${encodeURIComponent(projectId)}` : env.TASK_TEMPLATES;
    return apiRequest("get", url).then(listOf);
}

export const saveTemplate = (body) => apiRequest("post", env.TASK_TEMPLATES, body).then((response) => response?.data || {});

export const applyTemplate = (templateId, body) => apiRequest("post", `${env.TASK_TEMPLATES}/${templateId}/apply`, body).then((response) => response?.data || {});

export const renameTemplate = (templateId, name) => apiRequest("patch", `${env.TASK_TEMPLATES}/${templateId}`, { name }).then((response) => response?.data || {});

export const deleteTemplate = (templateId) => apiRequest("delete", `${env.TASK_TEMPLATES}/${templateId}`).then((response) => response?.data || {});

export const setDefaultTemplate = (projectId, templateId) => apiRequest("put", `${env.TASK_TEMPLATES}/default`, { projectId, templateId: templateId || null })
    .then((response) => response?.data || {});

export const errorText = (error, fallback) => error?.response?.data?.statusText || fallback;
