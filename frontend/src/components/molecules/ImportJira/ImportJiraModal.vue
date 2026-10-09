<template>
    <div v-if="modelValue" class="jimport__overlay" @click.self="$emit('update:modelValue', false)">
        <div class="jimport__card">
            <div class="d-flex align-items-center justify-content-between jimport__head">
                <span class="import-jira-modal-font-size-16 import-jira-modal-font-weight-700">{{ $t('Projects.import_jira') }}</span>
                <span class="cursor-pointer import-jira-modal-font-size-16 jimport__close" @click="$emit('update:modelValue', false)">&#10005;</span>
            </div>

            <div class="import-jira-modal-font-size-12 import-jira-modal-gray81 jimport__hint">{{ $t('Projects.import_jira_hint') }}</div>

            <span class="import-jira-modal-font-size-12 jimport__sample" @click="downloadSample">&#8595; {{ $t('Projects.download_sample') }}</span>

            <input ref="fileEl" type="file" accept=".csv,.xlsx" class="import-jira-modal-font-size-13 jimport__file" @change="parseFile" />

            <div v-if="rows.length" class="import-jira-modal-font-size-13 jimport__preview">
                {{ $t('Projects.import_rows_found', { count: rows.length }, rows.length) }}
            </div>

            <div class="d-flex align-items-center jimport__controls" v-if="rows.length">
                <span class="import-jira-modal-font-size-13 import-jira-modal-font-weight-500 mr-10px">{{ $t('Projects.select_sprint') }}:</span>
                <select v-model="selectedSprintId" class="ah-input jimport__select">
                    <option v-for="sprint in sprintOptions" :key="'ji-'+sprint.id" :value="sprint.id">
                        {{ listLabel(sprint) }}
                    </option>
                </select>
                <button class="btn-primary import-jira-modal-font-size-13 ml-10px" :disabled="isImporting || !selectedSprintId" @click="startImport">
                    {{ isImporting ? $t('Projects.importing') : $t('Projects.start_import') }}
                </button>
            </div>

            <div v-if="resultText" class="import-jira-modal-font-size-13 jimport__result">{{ resultText }}</div>
        </div>
    </div>
</template>

<script setup>
// PACKAGES
import { computed, defineProps, inject, ref, watch } from "vue";
import { folderPathLabel, listLabel } from "@/utils/folderTree";
import * as XLSX from "xlsx";
import { textEncodingOf } from "@/components/organisms/WorkspaceImport/readSheet";
import { useToast } from "vue-toast-notification";
import { useI18n } from "vue-i18n";

// UTILS
import { apiRequest } from '@/services';
import { useGetterFunctions } from "@/composable";

const { t } = useI18n();
const $toast = useToast();
const { getUser } = useGetterFunctions();
const userId = inject('$userId');

const props = defineProps({
    projectData: {
        type: Object,
        required: true
    },
    modelValue: {
        type: Boolean,
        default: false
    }
});

defineEmits(['update:modelValue']);

const fileEl = ref(null);
const rows = ref([]);
const selectedSprintId = ref('');
const isImporting = ref(false);
const resultText = ref('');

const sprintOptions = computed(() => {
    const options = [];
    Object.values(props.projectData?.sprintsObj || {}).forEach((sprint) => {
        if (sprint?.id) options.push({ id: sprint.id, name: sprint.name || 'Sprint' });
    });
    Object.values(props.projectData?.sprintsfolders || {}).forEach((folder) => {
        Object.values(folder?.sprintsObj || {}).forEach((sprint) => {
            if (sprint?.id) options.push({ id: sprint.id, name: sprint.name || 'Sprint', folderName: folder.folderName || '', folderPath: folderPathLabel(props.projectData?.sprintsfolders, folder), folderId: folder.folderId });
        });
    });
    return options;
});

watch(() => props.modelValue, (open) => {
    if (open) {
        rows.value = [];
        resultText.value = '';
        if (fileEl.value) fileEl.value.value = '';
        if (!selectedSprintId.value && sprintOptions.value.length) {
            selectedSprintId.value = sprintOptions.value[0].id;
        }
    }
});

function parseFile(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (loadEvent) => {
        try {
            const workbook = XLSX.read(loadEvent.target.result, { type: 'array', ...textEncodingOf(loadEvent.target.result) });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            rows.value = XLSX.utils.sheet_to_json(sheet, { defval: '' });
            resultText.value = '';
            if (!rows.value.length) {
                $toast.error(t('Projects.import_no_rows'), { position: 'top-right' });
            }
        } catch (error) {
            console.error('ERROR parsing import file: ', error);
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
        'Summary,Status,Priority,Due Date,Description',
        'Design login screen,To Do,High,2026-06-25,Create the Figma mockups for the login flow',
        'Implement auth API,In Progress,Highest,2026-06-28,JWT-based login plus refresh tokens',
        'Write unit tests,To Do,Medium,2026-07-02,Cover the auth controller and helpers',
    ].join('\n');
    triggerDownload('alianhub-jira-sample.csv', csv, 'text/csv;charset=utf-8;');
}

function startImport() {
    if (!rows.value.length || isImporting.value) return;
    isImporting.value = true;
    resultText.value = '';
    const user = getUser(userId.value);
    const sprint = sprintOptions.value.find((option) => option.id === selectedSprintId.value);
    apiRequest('post', '/api/v2/imports/jira', {
        rows: rows.value,
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
        console.error('ERROR in jira import: ', error);
        $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
    }).finally(() => {
        isImporting.value = false;
    });
}
</script>

<style scoped>
.jimport__overlay {
    position: fixed;
    inset: 0;
    background: var(--scrim);
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
}
.jimport__card {
    background: var(--surface);
    color: var(--ink);
    color-scheme: var(--scheme);
    border-radius: 10px;
    width: min(520px, 92vw);
    padding: 16px 20px;
    box-shadow: var(--shadow-modal);
}
.jimport__head { margin-bottom: 8px; }
.jimport__close { color: var(--ink-2); }
.jimport__close:hover { color: var(--danger); }
.jimport__hint { margin-bottom: 12px; }
.jimport__sample { display: inline-block; margin-bottom: 12px; color: var(--brand); text-decoration: underline; cursor: pointer; }
.jimport__sample:hover { opacity: 0.8; }
.jimport__file { margin-bottom: 12px; }
.jimport__preview { margin-bottom: 10px; }
.ah-input.jimport__select { width: auto; min-width: 200px; }
.jimport__result {
    margin-top: 12px;
    padding: 8px 10px;
    background: var(--surface-2);
    border-radius: 6px;
}
</style>

<style scoped>
.import-jira-modal-font-weight-500 {
    font-weight: 500 !important;
}
.import-jira-modal-font-weight-700 {
    font-weight: 700 !important;
}
.import-jira-modal-font-size-12 {
    font-size: 12px;
}
.import-jira-modal-font-size-13 {
    font-size: 13px;
}
.import-jira-modal-font-size-16 {
    font-size: 16px;
}
.import-jira-modal-gray81 {
    color: var(--ink-2);
}
</style>
