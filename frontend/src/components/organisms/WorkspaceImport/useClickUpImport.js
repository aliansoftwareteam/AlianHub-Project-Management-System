import { computed, reactive, ref } from "vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { adjustedTotals } from "@/plugins/importTasks/importTree";
import { mergeSummaries } from "./importSummary";

const failure = (error) => error?.response?.data?.statusText || error?.message || "";

export const SKIP_EXISTING = "skip";
export const UPDATE_EXISTING = "update";

/* One request per ClickUp list keeps each call under the server's row limit and gives the run its progress. */
export function useClickUpImport() {
    const rows = ref([]);
    const preview = ref(null);
    const previewError = ref("");
    const running = ref(false);
    const progress = reactive({ done: 0, total: 0, current: "" });
    const results = ref([]);
    const existingMode = ref(SKIP_EXISTING);

    const reset = () => {
        rows.value = [];
        preview.value = null;
        previewError.value = "";
        results.value = [];
        existingMode.value = SKIP_EXISTING;
        Object.assign(progress, { done: 0, total: 0, current: "" });
    };

    /* The server leaves a task that is already in the project alone unless told to update it. */
    const optionsFor = (addMissing) => ({
        createMissingStatuses: addMissing,
        ...(existingMode.value === UPDATE_EXISTING ? { existing: UPDATE_EXISTING } : {})
    });

    const loadPreview = async (projectId = "", addMissing = false) => {
        previewError.value = "";
        try {
            const target = projectId ? { projectId, options: optionsFor(addMissing) } : {};
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

    /* Each list is read on its own, so it is told which date columns the whole file showed to be day first. */
    const importList = (list, { mode, projectId, sprintId, addMissing }) => {
        const listRows = list.rowIndexes.map((index) => rows.value[index]);
        const dayFirst = preview.value?.dayFirstColumns || [];
        return mode === "new"
            ? apiRequest("post", env.IMPORT_CLICKUP_PROJECT, { rows: listRows, listName: list.name })
            : apiRequest("post", env.IMPORT_CLICKUP, { rows: listRows, projectId, sprintId, options: { ...optionsFor(addMissing), ...(dayFirst.length ? { dayFirst } : {}) } });
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
        updated: sum.updated + (result.updated || 0),
        skipped: sum.skipped + (result.skipped || 0),
        failed: sum.failed + (result.ok ? 0 : 1)
    }), { created: 0, updated: 0, skipped: 0, failed: 0 }));

    const skippedRows = computed(() => (preview.value?.skippedRows || []));
    const unreadDates = computed(() => (preview.value?.unreadDates || []));
    const unmatchedAssignees = computed(() => Array.from(new Set(results.value.flatMap((result) => result.unmatchedAssignees || []))));
    const adjusted = computed(() => adjustedTotals(results.value));
    const summary = computed(() => {
        const summaries = results.value.filter((result) => result.ok && result.summary).map((result) => result.summary);
        return summaries.length ? mergeSummaries(summaries) : null;
    });
    const undoableJobs = computed(() => results.value.filter((result) => result.ok && result.jobId && result.created > 0).map((result) => String(result.jobId)));

    return { rows, preview, previewError, running, progress, results, existingMode, totals, skippedRows, unreadDates, unmatchedAssignees, adjusted, summary, undoableJobs, reset, loadPreview, run };
}
