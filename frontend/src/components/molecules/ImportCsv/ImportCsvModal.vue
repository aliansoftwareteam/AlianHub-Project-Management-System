<template>
    <div v-if="modelValue" class="cimport__overlay" @click.self="$emit('update:modelValue', false)">
        <div class="cimport__card">
            <div class="d-flex align-items-center justify-content-between cimport__head">
                <span class="font-size-16 font-weight-700">{{ $t('Projects.import_csv') }}</span>
                <span class="cursor-pointer font-size-16 cimport__close" @click="$emit('update:modelValue', false)">&#10005;</span>
            </div>

            <div class="font-size-12 gray81 cimport__hint">{{ $t('Projects.import_csv_hint') }}</div>

            <span class="font-size-12 cimport__sample" @click="downloadSample">&#8595; {{ $t('Projects.download_sample') }}</span>

            <input ref="fileEl" type="file" accept=".csv,.xlsx" class="font-size-13 cimport__file" @change="parseFile" />

            <div v-if="rows.length" class="font-size-13 cimport__preview">
                {{ $t('Projects.import_rows_found', { count: rows.length }) }}
            </div>

            <!-- Column mapping (defaults auto-detected; editable) -->
            <div v-if="rows.length" class="cimport__map">
                <div class="font-size-13 font-weight-600 mb-5px">{{ $t('Projects.map_columns') }}</div>
                <div v-for="field in mapFields" :key="field.key" class="d-flex align-items-center cimport__map-row">
                    <span class="font-size-13 cimport__map-label">{{ $t(field.label) }}<span v-if="field.required" class="red"> *</span></span>
                    <select v-model="mapping[field.key]" class="cimport__select font-size-13">
                        <option value="">{{ $t('Projects.col_none') }}</option>
                        <option v-for="h in headers" :key="field.key + h" :value="h">{{ h }}</option>
                    </select>
                </div>
            </div>

            <div class="d-flex align-items-center cimport__controls" v-if="rows.length">
                <span class="font-size-13 font-weight-500 mr-10px">{{ $t('Projects.select_sprint') }}:</span>
                <select v-model="selectedSprintId" class="cimport__select font-size-13">
                    <option v-for="sprint in sprintOptions" :key="'csv-'+sprint.id" :value="sprint.id">
                        {{ sprint.folderName ? sprint.folderName + ' / ' : '' }}{{ sprint.name }}
                    </option>
                </select>
                <button class="btn-primary font-size-13 ml-10px" :disabled="isImporting || !selectedSprintId || !mapping.taskName" @click="startImport">
                    {{ isImporting ? $t('Projects.importing') : $t('Projects.start_import') }}
                </button>
            </div>

            <div v-if="resultText" class="font-size-13 cimport__result">{{ resultText }}</div>
        </div>
    </div>
</template>

<script setup>
import { computed, defineProps, inject, ref, watch } from "vue";
import * as XLSX from "xlsx";
import { useToast } from "vue-toast-notification";
import { useI18n } from "vue-i18n";
import { apiRequest } from '@/services';
import { useGetterFunctions } from "@/composable";

const { t } = useI18n();
const $toast = useToast();
const { getUser } = useGetterFunctions();
const userId = inject('$userId');

const props = defineProps({
    projectData: { type: Object, required: true },
    modelValue: { type: Boolean, default: false },
});
defineEmits(['update:modelValue']);

const fileEl = ref(null);
const rows = ref([]);
const selectedSprintId = ref('');
const isImporting = ref(false);
const resultText = ref('');
const mapping = ref({ taskName: '', status: '', priority: '', dueDate: '', description: '' });

const mapFields = [
    { key: 'taskName', label: 'Projects.col_task_name', required: true },
    { key: 'status', label: 'Projects.col_status' },
    { key: 'priority', label: 'Projects.col_priority' },
    { key: 'dueDate', label: 'Projects.col_due' },
    { key: 'description', label: 'Projects.col_description' },
];
const CANDIDATES = {
    taskName: ['task name', 'summary', 'title', 'name'],
    status: ['status', 'state'],
    priority: ['priority'],
    dueDate: ['due date', 'duedate', 'due', 'end date'],
    description: ['description', 'desc', 'notes'],
};

const headers = computed(() => Object.keys(rows.value[0] || {}));

const sprintOptions = computed(() => {
    const options = [];
    Object.values(props.projectData?.sprintsObj || {}).forEach((sprint) => {
        if (sprint?.id) options.push({ id: sprint.id, name: sprint.name || 'Sprint' });
    });
    Object.values(props.projectData?.sprintsfolders || {}).forEach((folder) => {
        Object.values(folder?.sprintsObj || {}).forEach((sprint) => {
            if (sprint?.id) options.push({ id: sprint.id, name: sprint.name || 'Sprint', folderName: folder.folderName || '', folderId: folder.folderId });
        });
    });
    return options;
});

watch(() => props.modelValue, (open) => {
    if (open) {
        rows.value = [];
        resultText.value = '';
        mapping.value = { taskName: '', status: '', priority: '', dueDate: '', description: '' };
        if (fileEl.value) fileEl.value.value = '';
        if (!selectedSprintId.value && sprintOptions.value.length) {
            selectedSprintId.value = sprintOptions.value[0].id;
        }
    }
});

function autoDetect() {
    const cols = headers.value;
    const next = { taskName: '', status: '', priority: '', dueDate: '', description: '' };
    Object.keys(CANDIDATES).forEach((field) => {
        const hit = cols.find((col) => CANDIDATES[field].includes(String(col).trim().toLowerCase()));
        next[field] = hit || '';
    });
    mapping.value = next;
}

function parseFile(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (loadEvent) => {
        try {
            const workbook = XLSX.read(loadEvent.target.result, { type: 'array' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            rows.value = XLSX.utils.sheet_to_json(sheet, { defval: '' });
            resultText.value = '';
            if (!rows.value.length) {
                $toast.error(t('Projects.import_no_rows'), { position: 'top-right' });
                return;
            }
            autoDetect();
        } catch (error) {
            console.error('ERROR parsing CSV import file: ', error);
            $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
        }
    };
    reader.readAsArrayBuffer(file);
}

function triggerDownload(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function downloadSample() {
    const csv = [
        'Task Name,Status,Priority,Due Date,Description',
        'Design login screen,To Do,High,2026-06-25,Create the Figma mockups for the login flow',
        'Implement auth API,In Progress,High,2026-06-28,JWT-based login plus refresh tokens',
        'Write unit tests,To Do,Medium,2026-07-02,Cover the auth controller and helpers',
    ].join('\n');
    triggerDownload('alianhub-sample-import.csv', csv, 'text/csv;charset=utf-8;');
}

function startImport() {
    if (!rows.value.length || isImporting.value || !mapping.value.taskName) return;
    isImporting.value = true;
    resultText.value = '';
    const user = getUser(userId.value);
    const sprint = sprintOptions.value.find((option) => option.id === selectedSprintId.value);
    const cleanMapping = Object.fromEntries(Object.entries(mapping.value).filter(([, v]) => v));
    apiRequest('post', '/api/v2/imports/csv', {
        rows: rows.value,
        mapping: cleanMapping,
        projectId: props.projectData._id,
        sprintId: selectedSprintId.value,
        sprintName: sprint?.name || '',
        folderId: sprint?.folderId || null,
        folderName: sprint?.folderName || '',
        userData: { id: user.id, Employee_Name: user.Employee_Name },
    }).then((response) => {
        if (response.data?.status) {
            resultText.value = response.data.statusText;
            $toast.success(response.data.statusText, { position: 'top-right' });
        } else {
            resultText.value = response.data?.statusText || t('Toast.something_went_wrong');
            $toast.error(resultText.value, { position: 'top-right' });
        }
    }).catch((error) => {
        console.error('ERROR in csv import: ', error);
        $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
    }).finally(() => {
        isImporting.value = false;
    });
}
</script>

<style scoped>
.cimport__overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.35); z-index: 1000; display: flex; align-items: center; justify-content: center; }
.cimport__card { background: #fff; border-radius: 10px; width: min(540px, 92vw); padding: 16px 20px; box-shadow: 0 8px 30px rgba(0, 0, 0, 0.18); max-height: 90vh; overflow-y: auto; }
.cimport__head { margin-bottom: 8px; }
.cimport__close { color: #9a9a9a; }
.cimport__close:hover { color: #e84a4a; }
.cimport__hint { margin-bottom: 12px; }
.cimport__sample { display: inline-block; margin-bottom: 12px; color: #2f3990; text-decoration: underline; cursor: pointer; }
.cimport__sample:hover { opacity: 0.8; }
.cimport__file { margin-bottom: 12px; }
.cimport__preview { margin-bottom: 10px; }
.cimport__map { margin-bottom: 12px; padding: 10px 12px; background: #f7f9fc; border-radius: 8px; }
.cimport__map-row { margin-bottom: 6px; }
.cimport__map-label { min-width: 120px; }
.cimport__controls { margin-top: 4px; }
.cimport__select { border: 1px solid #e0e0e0; border-radius: 6px; padding: 6px 8px; background: #fff; min-width: 200px; }
.cimport__result { margin-top: 12px; padding: 8px 10px; background: #f7f9fc; border-radius: 6px; }
</style>
