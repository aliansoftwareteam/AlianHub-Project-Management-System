import { computed, reactive, ref } from "vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { adjustedTotals } from "@/plugins/importTasks/importTree";
import { mergeSummaries } from "./importSummary";

const failure = (error) => error?.response?.data?.statusText || error?.message || "";

/* One request per ClickUp list keeps each call under the server's row limit and gives the run its progress. */
export function useClickUpImport() {
    const rows = ref([]);
    const preview = ref(null);
    const previewError = ref("");
    const running = ref(false);
    const progress = reactive({ done: 0, total: 0, current: "" });
    const results = ref([]);

    const reset = () => {
        rows.value = [];
        preview.value = null;
        previewError.value = "";
        results.value = [];
        Object.assign(progress, { done: 0, total: 0, current: "" });
    };

    const loadPreview = async (projectId = "", addMissing = false) => {
        previewError.value = "";
        try {
            const target = projectId ? { projectId, options: { createMissingStatuses: addMissing } } : {};
            const { data } = await apiRequest("post", env.IMPORT_CLICKUP_PREVIEW, { rows: rows.value, ...target });
            if (!data?.status) throw new Error(data?.statusText || "");
            preview.value = data.data;
            return true;
        } catch (error) {
            preview.value = null;
            previewError.value = failure(error);
            return false;
        }
    };

    const importList = (list, { mode, projectId, sprintId, addMissing }) => {
        const listRows = list.rowIndexes.map((index) => rows.value[index]);
        return mode === "new"
            ? apiRequest("post", env.IMPORT_CLICKUP_PROJECT, { rows: listRows, listName: list.name })
            : apiRequest("post", env.IMPORT_CLICKUP, { rows: listRows, projectId, sprintId, options: { createMissingStatuses: addMissing } });
    };

    const run = async (target) => {
        const lists = preview.value?.lists || [];
        running.value = true;
        results.value = [];
        Object.assign(progress, { done: 0, total: lists.length, current: "" });
        for (const list of lists) {
            progress.current = list.name;
            try {
                const { data } = await importList(list, target);
                results.value.push({ list: list.name, ok: data?.status === true, message: data?.status ? "" : (data?.statusText || ""), ...(data?.data || {}) });
            } catch (error) {
                results.value.push({ list: list.name, ok: false, message: failure(error) });
            }
            progress.done += 1;
        }
        progress.current = "";
        running.value = false;
        return results.value;
    };

    const totals = computed(() => results.value.reduce((sum, result) => ({
        created: sum.created + (result.created || 0),
        skipped: sum.skipped + (result.skipped || 0),
        failed: sum.failed + (result.ok ? 0 : 1)
    }), { created: 0, skipped: 0, failed: 0 }));

    const skippedRows = computed(() => (preview.value?.skippedRows || []));
    const unmatchedAssignees = computed(() => Array.from(new Set(results.value.flatMap((result) => result.unmatchedAssignees || []))));
    const adjusted = computed(() => adjustedTotals(results.value));
    const summary = computed(() => {
        const summaries = results.value.filter((result) => result.ok && result.summary).map((result) => result.summary);
        return summaries.length ? mergeSummaries(summaries) : null;
    });

    return { rows, preview, previewError, running, progress, results, totals, skippedRows, unmatchedAssignees, adjusted, summary, reset, loadPreview, run };
}
