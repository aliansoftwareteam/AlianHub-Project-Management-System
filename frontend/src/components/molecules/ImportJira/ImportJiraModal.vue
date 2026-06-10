<template>
    <div v-if="modelValue" class="jimport__overlay" @click.self="$emit('update:modelValue', false)">
        <div class="jimport__card">
            <div class="d-flex align-items-center justify-content-between jimport__head">
                <span class="font-size-16 font-weight-700">{{ $t('Projects.import_jira') }}</span>
                <span class="cursor-pointer font-size-16 jimport__close" @click="$emit('update:modelValue', false)">&#10005;</span>
            </div>

            <div class="font-size-12 gray81 jimport__hint">{{ $t('Projects.import_jira_hint') }}</div>

            <input ref="fileEl" type="file" accept=".csv,.xlsx" class="font-size-13 jimport__file" @change="parseFile" />

            <div v-if="rows.length" class="font-size-13 jimport__preview">
                {{ $t('Projects.import_rows_found', { count: rows.length }) }}
            </div>

            <div class="d-flex align-items-center jimport__controls" v-if="rows.length">
                <span class="font-size-13 font-weight-500 mr-10px">{{ $t('Projects.select_sprint') }}:</span>
                <select v-model="selectedSprintId" class="jimport__select font-size-13">
                    <option v-for="sprint in sprintOptions" :key="'ji-'+sprint.id" :value="sprint.id">
                        {{ sprint.folderName ? sprint.folderName + ' / ' : '' }}{{ sprint.name }}
                    </option>
                </select>
                <button class="btn-primary font-size-13 ml-10px" :disabled="isImporting || !selectedSprintId" @click="startImport">
                    {{ isImporting ? $t('Projects.importing') : $t('Projects.start_import') }}
                </button>
            </div>

            <div v-if="resultText" class="font-size-13 jimport__result">{{ resultText }}</div>
        </div>
    </div>
</template>

<script setup>
// PACKAGES
import { computed, defineProps, inject, ref, watch } from "vue";
import * as XLSX from "xlsx";
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
            if (sprint?.id) options.push({ id: sprint.id, name: sprint.name || 'Sprint', folderName: folder.folderName || '', folderId: folder.folderId });
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
            const workbook = XLSX.read(loadEvent.target.result, { type: 'array' });
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
    background: rgba(0, 0, 0, 0.35);
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
}
.jimport__card {
    background: #fff;
    border-radius: 10px;
    width: min(520px, 92vw);
    padding: 16px 20px;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.18);
}
.jimport__head { margin-bottom: 8px; }
.jimport__close { color: #9a9a9a; }
.jimport__close:hover { color: #e84a4a; }
.jimport__hint { margin-bottom: 12px; }
.jimport__file { margin-bottom: 12px; }
.jimport__preview { margin-bottom: 10px; }
.jimport__select {
    border: 1px solid #e0e0e0;
    border-radius: 6px;
    padding: 6px 8px;
    background: #fff;
    min-width: 200px;
}
.jimport__result {
    margin-top: 12px;
    padding: 8px 10px;
    background: #f7f9fc;
    border-radius: 6px;
}
</style>
