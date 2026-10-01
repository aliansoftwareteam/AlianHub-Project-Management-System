import { reactive } from "vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";

const OBJECT_ID = /^[a-f0-9]{24}$/i;

export const isTaskThread = (taskId) => OBJECT_ID.test(String(taskId || ""));

export const threadStore = reactive({ replies: {}, loaded: {}, added: {}, versions: {} });

const idOf = (row) => String((row && (row._id || row.id)) || "");
const counted = new Set();

export const touchTask = (taskId) => {
    const key = String(taskId || "");
    if (key) threadStore.versions[key] = (threadStore.versions[key] || 0) + 1;
};

export const taskVersion = (taskId) => threadStore.versions[String(taskId || "")] || 0;

export const repliesOf = (parentId) => threadStore.replies[String(parentId)] || [];

export const replyCountOf = (parent) => {
    const id = idOf(parent);
    if (threadStore.loaded[id]) return repliesOf(id).length;
    return Number(parent?.replyCount || 0) + Number(threadStore.added[id] || 0);
};

const upsertReply = (doc) => {
    const parentId = String(doc.parentId);
    const list = threadStore.replies[parentId] || [];
    const at = list.findIndex((row) => idOf(row) === idOf(doc));
    if (doc.isDeleted) {
        if (at > -1) list.splice(at, 1);
        return;
    }
    if (at > -1) {
        list[at] = { ...list[at], ...doc };
        return;
    }
    if (threadStore.loaded[parentId]) {
        threadStore.replies[parentId] = [...list, doc];
    } else if (!counted.has(idOf(doc))) {
        counted.add(idOf(doc));
        threadStore.added[parentId] = (threadStore.added[parentId] || 0) + 1;
    }
};

/* Comment socket events come to the open comment list; a reply belongs to its thread, not the list. */
export const applyCommentEvent = (doc, { inserted = false } = {}) => {
    if (!doc) return false;
    touchTask(doc.taskId);
    if (!doc.parentId) return false;
    if (inserted || threadStore.loaded[String(doc.parentId)] || doc.isDeleted) upsertReply(doc);
    return true;
};

export const loadReplies = async (parentId) => {
    const id = String(parentId);
    const response = await apiRequest("get", `${env.API_COMMENTS}/replies?parentId=${encodeURIComponent(id)}`);
    if (!response?.data?.status) throw new Error(response?.data?.statusText || "replies");
    threadStore.replies[id] = response.data.data || [];
    threadStore.loaded[id] = true;
    threadStore.added[id] = 0;
    return threadStore.replies[id];
};

const escapeText = (text) => String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

export const sendReply = async (parent, text, { onAi = null } = {}) => {
    const message = String(text || "").trim();
    if (!message) return null;
    const response = await apiRequest("post", env.API_COMMENTS, {
        data: {
            parentId: idOf(parent),
            message: escapeText(message),
            type: /https?:\/\//i.test(message) ? "link" : "text",
            project: false,
            isDeleted: false,
            objId: {
                projectId: String(parent.projectId),
                sprintId: String(parent.sprintId),
                taskId: String(parent.taskId),
                ...(parent.folderId ? { folderId: String(parent.folderId) } : {})
            }
        }
    });
    if (!response?.data?.status) throw new Error(response?.data?.statusText || response?.data?.message || "reply");
    const saved = response.data.data;
    applyCommentEvent(saved, { inserted: true });
    if (onAi && response.data.ai) onAi(response.data.ai);
    return saved;
};

const post = async (path, body) => {
    const response = await apiRequest("post", `${env.API_COMMENTS}/${path}`, body);
    if (!response?.data?.status) throw new Error(response?.data?.statusText || response?.data?.message || path);
    applyCommentEvent(response.data.data);
    return response.data.data;
};

export const assignComment = (comment, assigneeId) => post("assign", { id: idOf(comment), assigneeId: assigneeId || "" });

export const resolveComment = (comment, resolved = true) => post("resolve", { id: idOf(comment), resolved });

export const loadActionItems = async ({ projectId, sprintId, taskId }) => {
    const query = new URLSearchParams({ projectId: String(projectId || ""), sprintId: String(sprintId || ""), taskId: String(taskId || "") });
    const response = await apiRequest("get", `${env.API_COMMENTS}/action-items?${query.toString()}`);
    return response?.data?.status ? response.data.data || [] : [];
};

/* The assigned list holds task comments and doc comments; a doc comment names its doc and is resolved on the doc's own route. */
export const isDocComment = (row) => Boolean(row) && row.kind === "doc" && Boolean(row.pageId);

export const resolveDocComment = async (comment, resolved = true) => {
    const response = await apiRequest("put", `${env.PAGES}/${comment.pageId}/comments/${idOf(comment)}/resolve`, { resolved });
    if (!response?.data?.status) throw new Error(response?.data?.statusText || "resolve");
    return response.data.data;
};

export const loadAssignedToMe = async () => {
    const response = await apiRequest("get", `${env.API_COMMENTS}/assigned-to-me`);
    return response?.data?.status ? response.data.data || [] : [];
};
