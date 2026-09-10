import { ref } from "vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { i18n } from "@/locales/main";
import { reasonOf } from "./useAgents";

const request = async (type, endpoint, body, fallbackKey) => {
    let res;
    try {
        res = await apiRequest(type, endpoint, body);
    } catch (error) {
        throw new Error(reasonOf(error, fallbackKey));
    }
    if (res?.data?.status !== true) throw new Error(res?.data?.statusText || res?.data?.message || i18n.global.t(fallbackKey));
    return res.data.data;
};

const list = (v) => (Array.isArray(v) ? v : []);
const rowUrl = (id) => `${env.AGENT_MEMORY}/${encodeURIComponent(String(id))}`;

export function useProjectMemory() {
    const guide = ref(null);
    const assumptions = ref([]);
    const rows = ref([]);
    const episodes = ref([]);
    const loading = ref(false);
    const error = ref("");

    const put = (row) => {
        const i = rows.value.findIndex((r) => r.id === row.id);
        rows.value = i === -1 ? [...rows.value, row] : rows.value.map((r, j) => (j === i ? { ...r, ...row } : r));
        return rows.value.find((r) => r.id === row.id);
    };

    const load = async (projectId) => {
        loading.value = true;
        error.value = "";
        try {
            const data = (await request("get", `${env.AGENT_MEMORY_PROJECT}/${projectId}`, undefined, "Memory.load_failed")) || {};
            guide.value = data.guide && typeof data.guide === "object" ? data.guide : null;
            assumptions.value = list(data.assumptions).map((a) => (typeof a === "string" ? { text: a } : a)).filter((a) => a && a.text);
            rows.value = list(data.rows);
            episodes.value = list(data.episodes);
        } catch (e) {
            error.value = e.message;
        } finally {
            loading.value = false;
        }
    };

    const addRow = async (projectId, { kind, text }) => {
        const row = await request("post", `${env.AGENT_MEMORY_PROJECT}/${projectId}`, { kind, text }, "Memory.save_failed");
        return row && row.id ? put(row) : row;
    };

    const updateRow = async (id, { scopeId, text, status }) => {
        const body = { scopeId };
        if (text !== undefined) body.text = text;
        if (status !== undefined) body.status = status;
        const row = await request("put", rowUrl(id), body, "Memory.save_failed");
        return put({ id, ...body, ...(row && typeof row === "object" ? row : {}) });
    };

    const retireRow = (id, scopeId) => updateRow(id, { scopeId, status: "retired" });

    return { guide, assumptions, rows, episodes, loading, error, load, addRow, updateRow, retireRow };
}
