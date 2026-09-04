<template>
    <transition name="ah-fade">
        <div v-if="open" class="iw__scrim ah-page" role="dialog" aria-modal="true" :aria-label="$t('Import.title')" @click.self="close">
            <div class="iw">
                <header class="iw__head">
                    <div>
                        <div class="iw__title">{{ $t('Import.title') }}<span v-if="fileName"> · {{ fileName }}</span></div>
                        <div class="iw__sub">{{ headline }}</div>
                    </div>
                    <div class="iw__steps">
                        <button
                            v-for="(label, index) in stepLabels"
                            :key="label"
                            type="button"
                            class="iw__step"
                            :class="{ 'is-active': step === index, 'is-done': index < step }"
                            :disabled="index >= step"
                            @click="goTo(index)"
                        >{{ index + 1 }} {{ label }}</button>
                    </div>
                    <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm iw__close" :aria-label="$t('Import.close')" @click="close">
                        <ShellIcon name="x" :size="16" />
                    </button>
                </header>

                <div class="iw__body" :class="{ 'iw__body--split': step === 2 }">
                    <div class="iw__pane">
                        <template v-if="step === 0">
                            <label
                                class="iw__drop"
                                :class="{ 'is-over': dragging }"
                                @dragover.prevent="dragging = true"
                                @dragleave.prevent="dragging = false"
                                @drop.prevent="onDrop"
                            >
                                <ShellIcon name="file" :size="26" />
                                <span class="iw__drop-title">{{ $t('Import.drop_title') }}</span>
                                <span>{{ $t('Import.drop_hint') }}</span>
                                <input type="file" accept=".csv,text/csv" class="ah-sr-only" @change="onPick" />
                            </label>
                            <p v-if="fileError" class="ah-field__error">{{ fileError }}</p>
                            <p class="iw__hint">{{ $t('Import.file_note') }}</p>
                        </template>

                        <template v-else-if="step === 1">
                            <div class="ah-label">{{ $t('Import.header_row') }}</div>
                            <div class="iw__rows">
                                <div
                                    v-for="(row, index) in rawRows.slice(0, 8)"
                                    :key="'raw' + index"
                                    class="iw__rowline"
                                    :class="{ 'is-skipped': index < headerRowIndex }"
                                >
                                    <span class="iw__rowline-no">{{ index + 1 }}</span>
                                    <span class="iw__rowline-name">{{ row.slice(0, 4).join(' · ') }}</span>
                                    <span>
                                        <button type="button" class="ah-btn ah-btn--sm" :class="headerRowIndex === index ? 'ah-btn--outline' : 'ah-btn--secondary'" @click="setHeaderRow(index)">
                                            {{ headerRowIndex === index ? $t('Import.header_is_this') : $t('Import.header_use_this') }}
                                        </button>
                                    </span>
                                </div>
                            </div>
                            <p class="iw__hint">{{ $t('Import.header_note') }}</p>
                        </template>

                        <template v-else-if="step === 2">
                            <div class="ah-label">{{ $t('Import.columns_found', { found: headers.length, mapped: mappedCount }) }}</div>
                            <div class="iw__map">
                                <div
                                    v-for="column in headers"
                                    :key="column"
                                    class="iw__col"
                                    :class="{ 'is-mapped': !!columnTarget[column], 'is-skipped': !columnTarget[column], 'is-error': !!columnErrors[column] }"
                                >
                                    <div>
                                        <div class="iw__col-name" :title="column">{{ column }}</div>
                                        <div class="iw__col-sample">{{ sampleOf(column) }}</div>
                                    </div>
                                    <span class="iw__arrow" aria-hidden="true">→</span>
                                    <select v-model="columnTarget[column]" class="ah-input iw__select" :aria-label="$t('Import.map_column', { column })">
                                        <option value="">{{ $t('Import.skip_column') }}</option>
                                        <option v-for="target in targets" :key="target.key" :value="target.key" :disabled="takenBy(target.key, column)">{{ target.label }}</option>
                                    </select>
                                    <p v-if="columnErrors[column]" class="iw__col-error">{{ columnErrors[column] }}</p>
                                </div>
                            </div>
                            <div class="iw__note" v-if="unmappedCount">
                                <strong>{{ $t('Import.unmapped_count', { count: unmappedCount }) }}</strong> {{ $t('Import.unmapped_note') }}
                            </div>
                        </template>

                        <template v-else>
                            <div class="ah-label">{{ $t('Import.review') }}</div>
                            <div class="iw__summary">
                                <div class="iw__stat">
                                    <span class="iw__stat-value">{{ report.importable }}</span>
                                    <span class="iw__stat-label">{{ $t('Import.stat_importable') }}</span>
                                </div>
                                <div class="iw__stat">
                                    <span class="iw__stat-value">{{ report.skipped }}</span>
                                    <span class="iw__stat-label">{{ $t('Import.stat_skipped') }}</span>
                                </div>
                                <div class="iw__stat">
                                    <span class="iw__stat-value">{{ report.issues.length }}</span>
                                    <span class="iw__stat-label">{{ $t('Import.stat_rows_with_errors') }}</span>
                                </div>
                            </div>

                            <div v-if="running || result" class="iw__progress" :aria-label="$t('Import.progress')">
                                <div class="iw__progress-fill" :style="{ width: progress + '%' }"></div>
                            </div>
                            <div v-if="result" class="iw__note" :class="{ 'iw__note--ok': !result.failed }">{{ result.message }}</div>

                            <div v-if="report.issues.length" class="iw__rows">
                                <div v-for="issue in report.issues.slice(0, 100)" :key="'iss' + issue.row" class="iw__rowline" :class="{ 'is-skipped': issue.errors.some((e) => e.fatal) }">
                                    <span class="iw__rowline-no">{{ issue.row }}</span>
                                    <span class="iw__rowline-name">{{ titleOfRow(issue.row) }}</span>
                                    <span class="iw__rowline-err">{{ issue.errors.map((e) => e.message).join(' ') }}</span>
                                </div>
                            </div>
                            <div v-else class="ah-empty">{{ $t('Import.no_issues') }}</div>
                        </template>
                    </div>

                    <div v-if="step === 2" class="iw__side">
                        <div>
                            <div class="ah-label" style="margin-bottom: 7px">{{ $t('Import.statuses_heading', { from: sourceStatuses.length, to: projectStatuses.length }) }}</div>
                            <div class="iw__group">
                                <div v-for="source in sourceStatuses" :key="'st' + source.value" class="iw__pair">
                                    <span class="iw__pair-src" :title="source.value">{{ source.value }} ({{ source.count }})</span>
                                    <span class="iw__arrow" aria-hidden="true">→</span>
                                    <span class="iw__pair-dst">
                                        <select v-model="statusMap[source.value]" class="ah-input">
                                            <option value="">{{ createMissingStatuses ? $t('Import.create_missing') : $t('Import.status_default') }}</option>
                                            <option v-for="status in projectStatuses" :key="status" :value="status">{{ status }}</option>
                                        </select>
                                    </span>
                                </div>
                                <div v-if="!sourceStatuses.length" class="ah-small ah-muted">{{ $t('Import.no_status_column') }}</div>
                            </div>
                            <label class="ah-small" style="display: flex; gap: 6px; align-items: center; margin-top: 7px">
                                <input v-model="createMissingStatuses" type="checkbox" class="ah-check" />
                                {{ $t('Import.create_missing_statuses') }}
                            </label>
                        </div>

                        <div>
                            <div class="ah-label" style="margin-bottom: 7px">{{ $t('Import.people_heading', { from: sourcePeople.length, matched: matchedPeopleCount }) }}</div>
                            <div class="iw__group">
                                <div v-for="person in sourcePeople" :key="'pp' + person.value" class="iw__pair">
                                    <span class="iw__pair-src" :title="person.value">{{ person.value }}</span>
                                    <span class="iw__arrow" aria-hidden="true">→</span>
                                    <span class="iw__pair-dst">
                                        <select v-model="userMap[person.value]" class="ah-input">
                                            <option value="">{{ $t('Import.leave_unassigned') }}</option>
                                            <option v-for="user in users" :key="user._id || user.id" :value="user._id || user.id">{{ user.Employee_Name || user.name }}</option>
                                        </select>
                                    </span>
                                </div>
                                <div v-if="!sourcePeople.length" class="ah-small ah-muted">{{ $t('Import.no_people_column') }}</div>
                            </div>
                        </div>

                        <div v-if="columnTargetHasTags">
                            <div class="ah-label" style="margin-bottom: 7px">{{ $t('Import.tags_heading') }}</div>
                            <div class="iw__group">
                                <label class="ah-small" style="display: flex; gap: 6px; align-items: center">
                                    <input v-model="createMissingTags" type="checkbox" class="ah-check" />
                                    {{ $t('Import.create_missing_tags') }}
                                </label>
                            </div>
                        </div>

                        <p class="iw__hint">{{ $t('Import.preset_note') }}</p>
                    </div>
                </div>

                <footer class="iw__foot">
                    <span class="iw__foot-note">{{ step === 3 ? $t('Import.foot_review') : $t('Import.foot_nothing_written') }}</span>
                    <div class="iw__foot-actions">
                        <button type="button" class="ah-btn ah-btn--secondary" :disabled="running" @click="back">{{ $t('Import.back') }}</button>
                        <button type="button" class="ah-btn ah-btn--primary" :disabled="!canAdvance || running" @click="next">{{ primaryLabel }}</button>
                    </div>
                </footer>
            </div>
        </div>
    </transition>
</template>

<script setup>
import { computed, inject, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useToast } from "vue-toast-notification";
import * as XLSX from "xlsx";
import * as env from "@/config/env";
import { apiRequest } from "@/services";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";

defineOptions({ name: "ImportWizard" });

const props = defineProps({
    showImportModal: { type: Boolean, default: false },
    projectId: { type: String, default: "" },
    taskStatus: { type: Array, default: () => [] },
    users: { type: Array, default: () => [] },
    sprint: { type: Object, default: () => ({}) }
});
const emit = defineEmits(["toggle-import-modal", "imported"]);

const CHUNK_SIZE = 200;
const MAX_ROWS = 2000;

const { t } = useI18n();
const $toast = useToast();
const { getters } = useStore();
const userId = inject("$userId");

const open = ref(false);
const step = ref(0);
const dragging = ref(false);
const fileName = ref("");
const fileError = ref("");
const rawRows = ref([]);
const headerRowIndex = ref(0);
const columnTarget = reactive({});
const statusMap = reactive({});
const userMap = reactive({});
const createMissingStatuses = ref(false);
const createMissingTags = ref(true);
const targets = ref([
    { key: "taskName", label: t("Import.target_task_title"), required: true },
    { key: "description", label: t("Import.target_description") },
    { key: "status", label: t("Import.target_status") },
    { key: "priority", label: t("Import.target_priority") },
    { key: "assignee", label: t("Import.target_assignee") },
    { key: "dueDate", label: t("Import.target_due_date") },
    { key: "startDate", label: t("Import.target_start_date") },
    { key: "estimate", label: t("Import.target_estimate") },
    { key: "loggedTime", label: t("Import.target_logged_time") },
    { key: "tags", label: t("Import.target_tags") }
]);
const report = ref({ total: 0, importable: 0, skipped: 0, issues: [], unknownStatuses: [], unknownUsers: [] });
const running = ref(false);
const progress = ref(0);
const result = ref(null);

const stepLabels = computed(() => [t("Import.step_file"), t("Import.step_header"), t("Import.step_map"), t("Import.step_review")]);

const headers = computed(() => (rawRows.value[headerRowIndex.value] || []).map((cell, index) => String(cell || `Column ${index + 1}`).trim()));
const dataRows = computed(() => rawRows.value
    .slice(headerRowIndex.value + 1)
    .map((row) => headers.value.reduce((entry, header, index) => { entry[header] = row[index] === undefined ? "" : row[index]; return entry; }, {}))
    .filter((entry) => Object.values(entry).some((value) => String(value).trim() !== "")));

const project = computed(() => ((getters["projectData/allProjects"] || {}).data || []).find((entry) => entry._id === props.projectId) || {});
const projectStatuses = computed(() => (props.taskStatus || []).map((status) => status.name).filter(Boolean));

const headline = computed(() => {
    if (!rawRows.value.length) return t("Import.headline_empty");
    const name = project.value.ProjectName || props.sprint?.name || "";
    return t("Import.headline", { rows: dataRows.value.length, target: name });
});

const mapping = computed(() => {
    const out = {};
    targets.value.forEach((target) => { out[target.key] = ""; });
    Object.keys(columnTarget).forEach((column) => {
        const target = columnTarget[column];
        if (target) out[target] = column;
    });
    if (!createMissingTags.value) out.tags = "";
    return out;
});

const mappedCount = computed(() => Object.values(columnTarget).filter(Boolean).length);
const unmappedCount = computed(() => headers.value.length - mappedCount.value);
const columnTargetHasTags = computed(() => Object.values(columnTarget).includes("tags"));

const columnOf = (targetKey) => Object.keys(columnTarget).find((column) => columnTarget[column] === targetKey) || "";

const columnErrors = computed(() => {
    const out = {};
    (report.value.issues || []).slice(0, 200).forEach((issue) => {
        issue.errors.forEach((error) => {
            const column = columnOf(error.column);
            if (column && !out[column]) out[column] = error.message;
        });
    });
    return out;
});

const distinctValues = (targetKey) => {
    const column = columnOf(targetKey);
    if (!column) return [];
    const counts = new Map();
    dataRows.value.forEach((row) => {
        const value = String(row[column] === undefined ? "" : row[column]).trim();
        if (!value) return;
        counts.set(value, (counts.get(value) || 0) + 1);
    });
    return [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count).slice(0, 12);
};

const sourceStatuses = computed(() => distinctValues("status"));
const sourcePeople = computed(() => distinctValues("assignee"));
const matchedPeopleCount = computed(() => sourcePeople.value.filter((person) => !!userMap[person.value]).length);

const canAdvance = computed(() => {
    if (step.value === 0) return dataRows.value.length > 0;
    if (step.value === 2) return !!columnOf("taskName");
    if (step.value === 3) return report.value.importable > 0 && !result.value;
    return true;
});

const primaryLabel = computed(() => {
    if (step.value === 2) return t("Import.review_rows", { count: dataRows.value.length });
    if (step.value === 3) return running.value ? t("Import.importing") : t("Import.import_rows", { count: report.value.importable });
    return t("Import.next");
});

const sampleOf = (column) => {
    const hit = dataRows.value.find((row) => String(row[column] === undefined ? "" : row[column]).trim() !== "");
    const value = hit ? String(hit[column]).trim() : "";
    const filled = dataRows.value.filter((row) => String(row[column] === undefined ? "" : row[column]).trim() !== "").length;
    return value ? `"${value.slice(0, 40)}" · ${t("Import.filled", { count: filled })}` : t("Import.empty_column");
};

const takenBy = (targetKey, column) => Object.keys(columnTarget).some((entry) => entry !== column && columnTarget[entry] === targetKey);

const titleOfRow = (rowNumber) => {
    const column = columnOf("taskName");
    const row = dataRows.value[rowNumber - 1];
    return column && row ? String(row[column] || "").slice(0, 60) : `${t("Import.row")} ${rowNumber}`;
};

function reset() {
    step.value = 0;
    fileName.value = "";
    fileError.value = "";
    rawRows.value = [];
    headerRowIndex.value = 0;
    Object.keys(columnTarget).forEach((key) => delete columnTarget[key]);
    Object.keys(statusMap).forEach((key) => delete statusMap[key]);
    Object.keys(userMap).forEach((key) => delete userMap[key]);
    report.value = { total: 0, importable: 0, skipped: 0, issues: [], unknownStatuses: [], unknownUsers: [] };
    result.value = null;
    progress.value = 0;
}

function close() {
    open.value = false;
    reset();
    emit("toggle-import-modal", false);
}

function readFile(file) {
    fileError.value = "";
    if (!file) return;
    if (!/\.csv$/i.test(file.name) && file.type !== "text/csv") {
        fileError.value = t("Import.error_not_csv");
        return;
    }
    fileName.value = file.name;
    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const workbook = XLSX.read(event.target.result, { type: "binary", codepage: 65001 });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
            if (!rows.length) { fileError.value = t("Import.error_empty"); return; }
            if (rows.length - 1 > MAX_ROWS) { fileError.value = t("Import.error_too_many", { max: MAX_ROWS }); return; }
            rawRows.value = rows.map((row) => (Array.isArray(row) ? row : []));
            headerRowIndex.value = 0;
            autoMap();
            step.value = 1;
        } catch (error) {
            fileError.value = t("Import.error_unreadable");
        }
    };
    reader.readAsBinaryString(file);
}

function onPick(event) { readFile(event.target.files && event.target.files[0]); }
function onDrop(event) { dragging.value = false; readFile(event.dataTransfer?.files && event.dataTransfer.files[0]); }

function setHeaderRow(index) {
    headerRowIndex.value = index;
    autoMap();
}

function autoMap() {
    Object.keys(columnTarget).forEach((key) => delete columnTarget[key]);
    const guesses = {
        taskName: ["task name", "summary", "title", "name"],
        description: ["description", "desc", "notes"],
        status: ["status", "state"],
        priority: ["priority"],
        assignee: ["assignee", "assigned to", "owner"],
        dueDate: ["due date", "duedate", "due", "end date"],
        startDate: ["start date", "startdate", "start"],
        estimate: ["estimate", "story points", "original estimate"],
        loggedTime: ["time spent", "logged time", "worklog"],
        tags: ["tags", "labels"]
    };
    headers.value.forEach((header) => {
        const key = Object.keys(guesses).find((target) => guesses[target].includes(header.trim().toLowerCase()) && !takenBy(target, header));
        columnTarget[header] = key || "";
    });
}

async function loadPreview() {
    const response = await apiRequest("post", env.IMPORT_CSV_PREVIEW, {
        rows: dataRows.value,
        mapping: mapping.value,
        projectId: props.projectId,
        options: {
            statusMap: { ...statusMap },
            userMap: { ...userMap },
            createMissingStatuses: createMissingStatuses.value,
            loggedTimeDivisor: 1,
            estimateDivisor: 1
        }
    });
    const data = response?.data;
    if (!data?.status) {
        $toast.error(data?.statusText || t("Toast.something_went_wrong"), { position: "top-right" });
        return false;
    }
    report.value = { issues: [], unknownStatuses: [], unknownUsers: [], ...data.data };
    (data.data.matchedUsers || []).forEach((user) => {
        [user.email, user.name].filter(Boolean).forEach((key) => {
            const source = sourcePeople.value.find((person) => person.value.toLowerCase() === String(key).toLowerCase());
            if (source && !userMap[source.value]) userMap[source.value] = user.id;
        });
    });
    return true;
}

// The importer endpoint is synchronous, so a large file is submitted in chunks:
// the dialog keeps responding and each chunk reports its own result.
async function runImport() {
    running.value = true;
    progress.value = 0;
    const rows = dataRows.value;
    let created = 0;
    let skipped = 0;
    let failure = "";
    const userData = { id: userId?.value || "", Employee_Name: getters["users/currentUser"]?.Employee_Name || "" };

    for (let start = 0; start < rows.length; start += CHUNK_SIZE) {
        const chunk = rows.slice(start, start + CHUNK_SIZE);
        // eslint-disable-next-line no-await-in-loop
        const response = await apiRequest("post", env.IMPORT_CSV, {
            rows: chunk,
            mapping: mapping.value,
            projectId: props.projectId,
            sprintId: props.sprint?._id || props.sprint?.id || "",
            sprintName: props.sprint?.name || "",
            folderId: props.sprint?.folderId || "",
            folderName: props.sprint?.folderName || "",
            userData,
            options: {
                statusMap: { ...statusMap },
                userMap: { ...userMap },
                createMissingStatuses: createMissingStatuses.value,
                createMissingTags: createMissingTags.value
            }
        }).catch((error) => ({ data: { status: false, statusText: error?.message } }));

        const data = response?.data;
        if (!data?.status) { failure = data?.statusText || t("Toast.something_went_wrong"); break; }
        created += data.data?.created || 0;
        skipped += data.data?.skipped || 0;
        progress.value = Math.round(Math.min(start + CHUNK_SIZE, rows.length) / rows.length * 100);
    }

    running.value = false;
    if (failure) {
        result.value = { failed: true, message: t("Import.import_failed", { reason: failure }) };
        return;
    }
    progress.value = 100;
    result.value = { failed: false, message: t("Import.import_done", { created, skipped }) };
    emit("imported", { created, skipped });
}

async function next() {
    if (step.value === 0 && dataRows.value.length) { step.value = 1; return; }
    if (step.value === 1) { step.value = 2; return; }
    if (step.value === 2) {
        const ok = await loadPreview();
        if (ok) step.value = 3;
        return;
    }
    if (step.value === 3) await runImport();
}

function back() {
    if (step.value === 0) { close(); return; }
    step.value -= 1;
    result.value = null;
}

function goTo(index) { if (index < step.value) { step.value = index; result.value = null; } }

watch(() => props.showImportModal, (value) => {
    if (value) { reset(); open.value = true; }
    else open.value = false;
});
</script>

<style scoped>
@import "./style.css";
</style>
