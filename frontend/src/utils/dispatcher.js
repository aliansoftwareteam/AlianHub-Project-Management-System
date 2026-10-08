import { onBeforeUnmount, watch } from "vue";
import { useStore } from "vuex";
import { apiRequest } from "@/services";

const BASE = "/api/v2/assignment-rules/dispatcher";

const dataOf = (response) => response?.data?.data;

export const fetchDispatcher = (projectId) => apiRequest("get", `${BASE}/project/${projectId}`, undefined).then(dataOf);

export const saveDispatcher = (projectId, body) => apiRequest("put", `${BASE}/project/${projectId}`, body).then(dataOf);

export const addRoutingRule = (projectId, rule) => apiRequest("post", `${BASE}/project/${projectId}/rules`, rule).then(dataOf);

export const fetchNeedsRouting = (projectId) => apiRequest("get", `${BASE}/project/${projectId}/needs-routing`, undefined).then(dataOf);

export const fetchTaskRouting = (taskId) => apiRequest("get", `${BASE}/task/${taskId}`, undefined).then(dataOf);

export const actOnRouting = (taskId, decisionId, action, body = {}) => apiRequest("post", `${BASE}/task/${taskId}/decisions/${decisionId}/${action}`, body).then(dataOf);

export const DISPATCHER_CHANGED_EVENT = "dispatcherChanged";

/* Calls `onChange` whenever the dispatcher's decisions or settings change in the company; the socket is replaced on reconnect. */
export function useDispatcherChanges(onChange) {
    const store = useStore();
    let listening = null;
    const listenOn = (socket) => {
        if (listening) listening.off(DISPATCHER_CHANGED_EVENT, onChange);
        listening = socket && typeof socket.on === "function" ? socket : null;
        if (listening) listening.on(DISPATCHER_CHANGED_EVENT, onChange);
    };
    watch(() => store?.getters?.["settings/getSocketInstance"], listenOn, { immediate: true });
    onBeforeUnmount(() => listenOn(null));
}

const CONDITION_KEYS = Object.freeze({ type: "taskTypeKeys", tag: "tags", priority: "priorities", status: "statusKeys", list: "sprintIds" });
const NUMBER_KINDS = Object.freeze(["type", "status"]);
export const CONDITION_KINDS = Object.freeze([...Object.keys(CONDITION_KEYS), "field"]);

/* A rule as the card edits it: one condition and one role. */
export const ruleToRow = (rule) => {
    const when = rule?.when || {};
    if (Array.isArray(when.fields) && when.fields.length) return { kind: "field", fieldId: when.fields[0].id, value: String(when.fields[0].value ?? ""), role: rule.role };
    const kind = Object.keys(CONDITION_KEYS).find((name) => Array.isArray(when[CONDITION_KEYS[name]]) && when[CONDITION_KEYS[name]].length) || "type";
    return { kind, fieldId: "", value: String((when[CONDITION_KEYS[kind]] || [""])[0] ?? ""), role: rule?.role || "" };
};

export const rowToRule = (row) => {
    if (row.kind === "field") return { role: row.role, when: { fields: [{ id: row.fieldId, value: row.value }] } };
    const value = NUMBER_KINDS.includes(row.kind) ? Number(row.value) : row.value;
    return { role: row.role, when: { [CONDITION_KEYS[row.kind]]: [value] } };
};

export const rowIsComplete = (row) => Boolean(row.role && String(row.value).trim() && (row.kind !== "field" || String(row.fieldId).trim())
    && (!NUMBER_KINDS.includes(row.kind) || Number.isFinite(Number(row.value))));
