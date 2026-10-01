<template>
    <teleport to="body">
        <div v-if="!handoff" class="wim__overlay" @click.self="close" @keydown.esc="close">
            <div ref="card" class="wim__card" role="dialog" aria-modal="true" aria-labelledby="wim-title" tabindex="-1">
                <div class="wim__head">
                    <div>
                        <h2 id="wim-title" class="ah-h2 wim__title">{{ $t('WorkspaceImport.title') }}</h2>
                        <p class="ah-muted ah-small wim__lead" data-test="wim-step">{{ $t(`WorkspaceImport.step_${step}`) }}</p>
                    </div>
                    <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :aria-label="$t('WorkspaceImport.close')" :disabled="clickUp.running.value" @click="close">
                        <ShellIcon name="x" :size="16" />
                    </button>
                </div>

                <div v-if="step === 'source'" class="wim__grid" role="list">
                    <button v-for="option in IMPORT_SOURCES" :key="option.key" type="button" role="listitem" class="ah-card wim__source" :data-source="option.key" @click="pickSource(option.key)">
                        <span class="wim__mark" :style="{ background: option.tint }">{{ option.mark }}</span>
                        <span class="wim__text">
                            <strong>{{ $t(`Projects.import_${option.key}_title`) }}</strong>
                            <span class="ah-small ah-muted">{{ $t(`Projects.import_${option.key}_desc`) }}</span>
                        </span>
                        <ShellIcon name="chevronRight" :size="14" class="wim__chev" />
                    </button>
                </div>

                <div v-else-if="step === 'file'" class="wim__body">
                    <ol class="ah-small wim__how">
                        <li>{{ $t('WorkspaceImport.clickup_how_1') }}</li>
                        <li>{{ $t('WorkspaceImport.clickup_how_2') }}</li>
                        <li>{{ $t('WorkspaceImport.clickup_how_3') }}</li>
                        <li>{{ $t('WorkspaceImport.clickup_how_4') }}</li>
                    </ol>
                    <label class="wim__label" for="wim-file">{{ $t('WorkspaceImport.file_label') }}</label>
                    <input id="wim-file" type="file" accept=".csv,.xlsx,.xls" class="wim__file" data-test="wim-file" @change="onFile" />
                    <p v-if="reading" class="ah-small ah-muted" role="status">{{ $t('WorkspaceImport.reading') }}</p>
                    <p v-if="fileError" class="ah-small wim__error" role="alert">{{ fileError }}</p>
                </div>

                <div v-else-if="step === 'target'" class="wim__body">
                    <fieldset v-if="!fixedProject && source === 'clickup'" class="wim__fieldset">
                        <legend class="wim__label">{{ $t('WorkspaceImport.target_legend') }}</legend>
                        <label class="wim__radio">
                            <input v-model="mode" type="radio" value="new" name="wim-mode" :disabled="!canCreateProjects" data-test="wim-mode-new" />
                            <span>
                                <strong>{{ $t('WorkspaceImport.target_new') }}</strong>
                                <span class="ah-small ah-muted">{{ canCreateProjects ? $t('WorkspaceImport.target_new_hint', { count: listCount }) : $t('WorkspaceImport.target_new_denied') }}</span>
                            </span>
                        </label>
                        <label class="wim__radio">
                            <input v-model="mode" type="radio" value="existing" name="wim-mode" data-test="wim-mode-existing" />
                            <span>
                                <strong>{{ $t('WorkspaceImport.target_existing') }}</strong>
                                <span class="ah-small ah-muted">{{ $t('WorkspaceImport.target_existing_hint') }}</span>
                            </span>
                        </label>
                    </fieldset>

                    <template v-if="mode === 'existing' || source !== 'clickup'">
                        <template v-if="!fixedProject">
                            <label class="wim__label" for="wim-project">{{ $t('WorkspaceImport.project_label') }}</label>
                            <select id="wim-project" v-model="projectId" class="wim__select" data-test="wim-project">
                                <option value="" disabled>{{ $t('WorkspaceImport.project_pick') }}</option>
                                <option v-for="option in projectOptions" :key="option._id" :value="option._id">{{ option.ProjectName }}</option>
                            </select>
                        </template>
                        <template v-if="source === 'clickup'">
                            <label class="wim__label" for="wim-sprint">{{ $t('WorkspaceImport.sprint_label') }}</label>
                            <select id="wim-sprint" v-model="sprintId" class="wim__select" :disabled="!sprintOptions.length" data-test="wim-sprint">
                                <option v-for="option in sprintOptions" :key="option.id" :value="option.id">{{ listLabel(option) }}</option>
                            </select>
                            <label class="wim__check">
                                <input v-model="addMissing" type="checkbox" :disabled="cannotAddDetails" data-test="wim-add-missing" />
                                <span>{{ $t('WorkspaceImport.add_missing') }}</span>
                            </label>
                            <p v-if="cannotAddDetails" class="ah-small ah-muted wim__note" data-test="wim-add-denied">{{ $t('WorkspaceImport.add_missing_denied') }}</p>
                        </template>
                    </template>
                    <p v-if="projectOptions.length === 0 && !fixedProject && (mode === 'existing' || source !== 'clickup')" class="ah-small ah-muted">{{ $t('WorkspaceImport.no_projects') }}</p>
                </div>

                <div v-else-if="step === 'preview'" class="wim__body" data-test="wim-preview">
                    <p v-if="!preview" class="ah-small ah-muted" role="status">{{ clickUp.previewError.value || $t('WorkspaceImport.previewing') }}</p>
                    <template v-else>
                        <p class="wim__total">{{ $t('WorkspaceImport.preview_total', { tasks: preview.importable, lists: preview.lists.length }) }}</p>
                        <fieldset v-if="preview.alreadyImported" class="wim__fieldset" data-test="wim-existing">
                            <legend class="wim__label">{{ $t('WorkspaceImport.existing_legend', { count: preview.alreadyImported }) }}</legend>
                            <label class="wim__radio">
                                <input v-model="clickUp.existingMode.value" type="radio" value="skip" name="wim-existing" data-test="wim-existing-skip" @change="reloadPreview" />
                                <span>
                                    <strong>{{ $t('WorkspaceImport.existing_skip') }}</strong>
                                    <span class="ah-small ah-muted">{{ $t('WorkspaceImport.existing_skip_hint') }}</span>
                                </span>
                            </label>
                            <label class="wim__radio">
                                <input v-model="clickUp.existingMode.value" type="radio" value="update" name="wim-existing" data-test="wim-existing-update" @change="reloadPreview" />
                                <span>
                                    <strong>{{ $t('WorkspaceImport.existing_update') }}</strong>
                                    <span class="ah-small ah-muted">{{ $t('WorkspaceImport.existing_update_hint') }}</span>
                                </span>
                            </label>
                        </fieldset>
                        <table class="wim__table">
                            <thead>
                                <tr>
                                    <th scope="col">{{ $t('WorkspaceImport.col_list') }}</th>
                                    <th scope="col">{{ $t('WorkspaceImport.col_tasks') }}</th>
                                    <th scope="col">{{ $t('WorkspaceImport.col_subtasks') }}</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="list in preview.lists" :key="list.key">
                                    <td>
                                        <strong>{{ list.name }}</strong>
                                        <span v-if="list.folder || list.space" class="ah-small ah-muted wim__path">{{ [list.space, list.folder].filter(Boolean).join(' / ') }}</span>
                                    </td>
                                    <td>{{ list.tasks }}</td>
                                    <td>{{ list.subtasks }}</td>
                                </tr>
                            </tbody>
                        </table>
                        <ul class="ah-small wim__facts">
                            <li v-if="preview.newStatuses.length">{{ $t(mode === 'new' ? 'WorkspaceImport.fact_statuses_file' : 'WorkspaceImport.fact_statuses', { names: preview.newStatuses.map((s) => s.name).join(', ') }) }}</li>
                            <li v-if="preview.newTags.length">{{ $t('WorkspaceImport.fact_tags', { names: preview.newTags.join(', ') }) }}</li>
                            <li v-if="preview.customFields.length">{{ $t('WorkspaceImport.fact_fields', { names: preview.customFields.map((f) => f.name).join(', ') }) }}</li>
                            <li v-if="preview.matchedAssignees.length">{{ $t('WorkspaceImport.fact_people', { count: preview.matchedAssignees.length }) }}</li>
                            <li v-if="preview.unmatchedAssignees.length" class="wim__warn">{{ $t('WorkspaceImport.fact_unmatched', { names: preview.unmatchedAssignees.join(', ') }) }}</li>
                            <li v-if="preview.skippedRows.length" class="wim__warn">{{ $t('WorkspaceImport.fact_skipped', { count: preview.skippedRows.length }) }}</li>
                            <li data-test="wim-duplicates-scope">{{ $t('WorkspaceImport.fact_duplicates_scope') }}</li>
                            <li v-if="cannotAddDetails" class="wim__warn" data-test="wim-add-denied-fact">{{ $t('WorkspaceImport.add_missing_denied') }}</li>
                            <li v-for="issue in shownUnreadDates" :key="`${issue.row}-${issue.column}`" class="wim__warn" data-test="wim-unread-date">{{ $t('WorkspaceImport.fact_unread_date', issue) }}</li>
                            <li v-if="unreadDates.length > shownUnreadDates.length" class="wim__warn">{{ $t('WorkspaceImport.fact_unread_dates_more', { count: unreadDates.length - shownUnreadDates.length }) }}</li>
                            <li v-if="unreadColumns.length" data-test="wim-unread-columns">{{ $t('WorkspaceImport.fact_unread_columns', { names: unreadColumns.join(', ') }) }}</li>
                            <li v-if="ignoredColumns.length" data-test="wim-ignored-columns">{{ $t('WorkspaceImport.fact_ignored_columns', { names: ignoredColumns.join(', ') }) }}</li>
                        </ul>
                        <ImportCounts v-if="preview.plan" :summary="preview.plan" planned data-test="wim-plan" />
                    </template>
                </div>

                <div v-else-if="step === 'run'" class="wim__body" role="status" aria-live="polite">
                    <p>{{ $t('WorkspaceImport.running', { done: clickUp.progress.done, total: clickUp.progress.total }) }}</p>
                    <p v-if="clickUp.progress.current" class="ah-small ah-muted">{{ clickUp.progress.current }}</p>
                    <div class="wim__bar" role="progressbar" :aria-valuenow="clickUp.progress.done" aria-valuemin="0" :aria-valuemax="clickUp.progress.total" :aria-label="$t('WorkspaceImport.progress_label')">
                        <span :style="{ width: `${clickUp.progress.total ? Math.round(clickUp.progress.done / clickUp.progress.total * 100) : 0}%` }"></span>
                    </div>
                </div>

                <div v-else-if="step === 'done'" class="wim__body" data-test="wim-summary">
                    <p class="wim__total">{{ $t('WorkspaceImport.summary_created', { count: clickUp.totals.value.created }) }}</p>
                    <p v-if="clickUp.totals.value.updated" class="ah-small wim__note" data-test="wim-updated">{{ $t('WorkspaceImport.summary_updated', { count: clickUp.totals.value.updated }) }}</p>
                    <ul class="ah-small wim__facts">
                        <li v-for="result in clickUp.results.value" :key="result.list" :class="{ wim__warn: !result.ok }">
                            {{ result.ok ? $t('WorkspaceImport.summary_list', { name: result.list, count: result.created || 0 }) : $t('WorkspaceImport.summary_list_failed', { name: result.list, reason: result.message }) }}
                        </li>
                    </ul>
                    <ImportCounts v-if="clickUp.summary.value" :summary="clickUp.summary.value" data-test="wim-counts" />
                    <template v-if="clickUp.skippedRows.value.length">
                        <p class="wim__label">{{ $t('WorkspaceImport.summary_skipped', { count: clickUp.skippedRows.value.length }) }}</p>
                        <ul class="ah-small wim__facts">
                            <li v-for="row in clickUp.skippedRows.value" :key="row.row">{{ $t('WorkspaceImport.summary_skipped_row', { row: row.row, reason: $t(`WorkspaceImport.skip_${row.code}`) }) }}</li>
                        </ul>
                    </template>
                    <template v-if="clickUp.unreadDates.value.length">
                        <p class="wim__label">{{ $t('WorkspaceImport.summary_unread_dates', { count: clickUp.unreadDates.value.length }) }}</p>
                        <ul class="ah-small wim__facts">
                            <li v-for="issue in clickUp.unreadDates.value" :key="`${issue.row}-${issue.column}`">{{ $t('WorkspaceImport.fact_unread_date', issue) }}</li>
                        </ul>
                    </template>
                    <template v-if="clickUp.skippedCells.value.length">
                        <p class="wim__label" data-test="wim-skipped-cells">{{ $t('WorkspaceImport.summary_skipped_cells', { count: clickUp.skippedCells.value.length }) }}</p>
                        <ul class="ah-small wim__facts">
                            <li v-for="(cell, index) in clickUp.skippedCells.value" :key="`${index}-${cell.column}`" data-test="wim-skipped-cell">{{ $t(`WorkspaceImport.skipped_cell_${cell.code}`, cell) }}</li>
                        </ul>
                    </template>
                    <p v-if="clickUp.unmatchedAssignees.value.length" class="ah-small wim__warn">{{ $t('WorkspaceImport.summary_unmatched', { names: clickUp.unmatchedAssignees.value.join(', ') }) }}</p>
                    <ul v-if="adjustedSummary.length" class="ah-small wim__facts" data-test="wim-adjusted">
                        <li v-for="line in adjustedSummary" :key="line.reason" class="wim__warn">{{ line.text }} <span v-if="line.names">{{ line.names }}</span></li>
                    </ul>
                    <ImportUndo v-if="clickUp.undoableJobs.value.length" :job-ids="clickUp.undoableJobs.value" :count="clickUp.totals.value.created" data-test="wim-undo" />
                </div>

                <div class="wim__foot">
                    <button v-if="canGoBack" type="button" class="ah-btn ah-btn--ghost ah-btn--sm" data-test="wim-back" @click="back">{{ $t('WorkspaceImport.back') }}</button>
                    <span class="wim__spacer"></span>
                    <button v-if="step === 'target'" type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="!targetReady" data-test="wim-next" @click="confirmTarget">{{ $t('WorkspaceImport.next') }}</button>
                    <button v-if="step === 'preview'" type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="!toImport" data-test="wim-run" @click="startRun">{{ $t('WorkspaceImport.run', { count: toImport }) }}</button>
                    <button v-if="step === 'done'" type="button" class="ah-btn ah-btn--primary ah-btn--sm" data-test="wim-finish" @click="finish">{{ $t('WorkspaceImport.finish') }}</button>
                </div>
            </div>
        </div>
    </teleport>

    <teleport to="body">
        <ImportSourceModals v-if="handoff" v-model:source="handoffSource" :projectData="chosenProject || {}" :users="users" :sprint="sprintOptions[0] || {}" />
    </teleport>
</template>

<script setup>
import { computed, defineEmits, defineProps, nextTick, onMounted, ref, watch } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import ImportSourceModals from "@/components/organisms/ImportDialog/ImportSourceModals.vue";
import ImportCounts from "./ImportCounts.vue";
import ImportUndo from "./ImportUndo.vue";
import { useCustomComposable } from "@/composable";
import { IMPORT_SOURCES, sprintOptionsOf } from "./workspaceImportState";
import { useClickUpImport, UPDATE_EXISTING } from "./useClickUpImport";
import { readSheet } from "./readSheet";
import { listLabel } from "@/utils/folderTree";
import { adjustedLines } from "@/plugins/importTasks/importTree";

defineOptions({ name: "WorkspaceImportDialog" });

const props = defineProps({
    initialSource: { type: String, default: "" },
    project: { type: Object, default: null }
});
const emit = defineEmits(["close", "imported"]);

const { getters, dispatch } = useStore();
const { t } = useI18n();
const { checkPermission } = useCustomComposable();
const clickUp = useClickUpImport();

const card = ref(null);
const source = ref(props.initialSource);
const step = ref(props.initialSource === "clickup" ? "file" : "source");
const mode = ref("existing");
const projectId = ref(props.project?._id ? String(props.project._id) : "");
const sprintId = ref("");
const addMissing = ref(true);
const reading = ref(false);
const fileError = ref("");
const deniedProject = ref("");
const handoff = ref(false);
const handoffSource = ref("");

const fixedProject = computed(() => Boolean(props.project?._id));
const canCreateProjects = computed(() => checkPermission("project.project_create") === true);
const projectOptions = computed(() => (getters["projectData/projects"]?.data || []).filter((p) => p && p._id && !p.deletedStatusKey));
const chosenProject = computed(() => (fixedProject.value ? props.project : projectOptions.value.find((p) => String(p._id) === String(projectId.value)) || null));
const sprintOptions = computed(() => sprintOptionsOf(chosenProject.value));
const users = computed(() => getters["users/users"] || []);
const preview = computed(() => clickUp.preview.value);
const listCount = computed(() => preview.value?.lists?.length || 0);
const targetProjectId = computed(() => (mode.value === "existing" && chosenProject.value ? String(chosenProject.value._id) : ""));
const cannotAddDetails = computed(() => Boolean(targetProjectId.value) && deniedProject.value === targetProjectId.value);
const MAX_SHOWN_DATES = 5;
const unreadDates = computed(() => preview.value?.unreadDates || []);
const shownUnreadDates = computed(() => unreadDates.value.slice(0, MAX_SHOWN_DATES));
const unreadColumns = computed(() => preview.value?.unreadColumns || []);
const ignoredColumns = computed(() => preview.value?.ignoredColumns || []);
/* A task that is already in the project is created by no import; it counts only when it is to be updated. */
const toImport = computed(() => {
    if (!preview.value) return 0;
    const leftAlone = clickUp.existingMode.value === UPDATE_EXISTING ? 0 : (preview.value.alreadyImported || 0);
    return Math.max(0, preview.value.importable - leftAlone);
});
const adjustedSummary = computed(() => adjustedLines(clickUp.adjusted.value, t, "WorkspaceImport.summary"));

const targetReady = computed(() => {
    if (source.value === "clickup" && mode.value === "new") return canCreateProjects.value;
    if (!chosenProject.value) return false;
    return source.value !== "clickup" || Boolean(sprintId.value);
});
const canGoBack = computed(() => !clickUp.running.value && ["file", "target", "preview"].includes(step.value) && !(fixedProject.value && step.value === "file"));

watch(sprintOptions, (options) => {
    if (!options.some((option) => option.id === sprintId.value)) sprintId.value = options[0]?.id || "";
}, { immediate: true });

watch(handoffSource, (value, previous) => {
    if (previous && !value) emit("close");
});

const focusCard = () => nextTick(() => card.value?.focus());
onMounted(focusCard);
watch(step, focusCard);

function close() {
    if (clickUp.running.value) return;
    emit("close");
}

function pickSource(key) {
    source.value = key;
    mode.value = "existing";
    step.value = key === "clickup" ? "file" : "target";
}

async function onFile(event) {
    const file = event.target?.files?.[0];
    if (!file) return;
    fileError.value = "";
    reading.value = true;
    try {
        clickUp.reset();
        clickUp.rows.value = await readSheet(file);
        if (!clickUp.rows.value.length) {
            fileError.value = t("WorkspaceImport.file_empty");
            return;
        }
        if (!(await clickUp.loadPreview())) {
            fileError.value = clickUp.previewError.value || t("WorkspaceImport.file_unreadable");
            return;
        }
        mode.value = !fixedProject.value && canCreateProjects.value ? "new" : "existing";
        step.value = "target";
    } catch (error) {
        fileError.value = t("WorkspaceImport.file_unreadable");
    } finally {
        reading.value = false;
    }
}

async function confirmTarget() {
    if (!targetReady.value) return;
    if (source.value !== "clickup") {
        handoff.value = true;
        handoffSource.value = source.value;
        emit("imported", { source: source.value });
        return;
    }
    step.value = "preview";
    await clickUp.loadPreview(targetProjectId.value, addMissing.value);
    if (!targetProjectId.value || clickUp.preview.value?.canAddDetails !== false) return;
    // The server refuses an import that adds statuses and tags to a project whose details this person may not edit.
    deniedProject.value = targetProjectId.value;
    if (!addMissing.value) return;
    addMissing.value = false;
    await clickUp.loadPreview(targetProjectId.value, false);
}

const reloadPreview = () => clickUp.loadPreview(targetProjectId.value, addMissing.value);

// The import may have added fields to the project; the task panel reads them from the store.
function reloadFields() {
    const fields = clickUp.summary.value?.fields;
    if (fields?.created.length || fields?.reused.length) dispatch("settings/setfinalCustomFields");
}

async function startRun() {
    step.value = "run";
    const results = await clickUp.run({
        mode: mode.value,
        projectId: mode.value === "existing" ? String(chosenProject.value._id) : "",
        sprintId: sprintId.value,
        addMissing: addMissing.value
    });
    step.value = "done";
    reloadFields();
    if (results.some((result) => result.ok)) emit("imported", { source: "clickup", results });
}

function back() {
    if (step.value === "preview") step.value = "target";
    else if (step.value === "target") step.value = source.value === "clickup" ? "file" : "source";
    else if (step.value === "file") step.value = "source";
}

function finish() {
    emit("close");
}
</script>

<style scoped>
.wim__overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, .35); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 16px; }
.wim__card { background: var(--surface); color: var(--ink); border-radius: var(--r-modal, 12px); width: min(600px, 100%); max-height: calc(100vh - 32px); overflow-y: auto; padding: 20px; box-shadow: var(--shadow-pop); font-family: var(--font-ui); display: flex; flex-direction: column; gap: 14px; }
.wim__card:focus { outline: none; }
.wim__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.wim__title { margin: 0 0 4px; }
.wim__lead { margin: 0; }
.wim__grid { display: grid; gap: 8px; }
.wim__source { display: flex; align-items: center; gap: 12px; width: 100%; padding: 10px 12px; text-align: left; cursor: pointer; color: var(--ink); background: var(--surface); }
.wim__source:hover, .wim__source:focus-visible { border-color: var(--brand); }
.wim__mark { flex: none; width: 34px; height: 34px; border-radius: 8px; color: #fff; display: flex; align-items: center; justify-content: center; font: 700 11px/1 var(--font-ui); }
.wim__text { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.wim__chev { color: var(--ink-2); flex: none; }
.wim__body { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.wim__how { margin: 0; padding-left: 18px; color: var(--ink-2); display: grid; gap: 4px; }
.wim__label { font-weight: 600; font-size: var(--text-small, 13px); margin: 0; }
.wim__file { max-width: 100%; color: var(--ink); }
.wim__error { color: var(--danger-ink, var(--danger)); margin: 0; }
.wim__fieldset { border: 0; padding: 0; margin: 0; display: grid; gap: 8px; }
.wim__radio, .wim__check { display: flex; align-items: flex-start; gap: 8px; cursor: pointer; }
.wim__radio span { display: flex; flex-direction: column; gap: 2px; }
.wim__radio input, .wim__check input { margin-top: 3px; }
.wim__select { width: 100%; border: 1px solid var(--border); border-radius: var(--r-input, 6px); padding: 7px 8px; background: var(--surface); color: var(--ink); }
.wim__total { margin: 0; font-weight: 600; }
.wim__table { width: 100%; border-collapse: collapse; font-size: var(--text-small, 13px); }
.wim__table th, .wim__table td { text-align: left; padding: 6px 4px; border-bottom: 1px solid var(--hairline, var(--border)); vertical-align: top; }
.wim__table th:not(:first-child), .wim__table td:not(:first-child) { text-align: right; white-space: nowrap; }
.wim__path { display: block; }
.wim__facts { margin: 0; padding-left: 18px; display: grid; gap: 4px; overflow-wrap: anywhere; }
.wim__warn { color: var(--warn-ink, var(--ink)); }
.wim__note { margin: 0; }
.wim__bar { height: 8px; border-radius: 4px; background: var(--track, var(--surface-2)); overflow: hidden; }
.wim__bar span { display: block; height: 100%; background: var(--brand); transition: width .2s var(--ease, ease); }
.wim__foot { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.wim__spacer { flex: 1; }
</style>
