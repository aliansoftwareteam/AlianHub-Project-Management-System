<template>
    <div v-if="modelValue" class="aimport__overlay" @click.self="$emit('update:modelValue', false)">
        <div class="aimport__card">
            <div class="d-flex align-items-center justify-content-between aimport__head">
                <span class="font-size-16 font-weight-700">{{ $t('Projects.import_asana') }}</span>
                <span class="cursor-pointer font-size-16 aimport__close" @click="$emit('update:modelValue', false)">&#10005;</span>
            </div>

            <div class="font-size-12 gray81 aimport__hint">{{ $t('Projects.import_asana_hint') }}</div>

            <span class="font-size-12 aimport__sample" @click="downloadSample">&#8595; {{ $t('Projects.download_sample') }}</span>

            <input ref="fileEl" type="file" accept=".json,application/json" class="font-size-13 aimport__file" @change="parseFile" />

            <div v-if="asana" class="font-size-13 aimport__preview">
                {{ $t('Projects.import_asana_found', { tasks: taskCount }) }}
            </div>

            <div class="d-flex align-items-center aimport__controls" v-if="asana && taskCount">
                <span class="font-size-13 font-weight-500 mr-10px">{{ $t('Projects.select_sprint') }}:</span>
                <select v-model="selectedSprintId" class="aimport__select font-size-13">
                    <option v-for="sprint in sprintOptions" :key="'as-'+sprint.id" :value="sprint.id">
                        {{ sprint.folderName ? sprint.folderName + ' / ' : '' }}{{ sprint.name }}
                    </option>
                </select>
                <button class="btn-primary font-size-13 ml-10px" :disabled="isImporting || !selectedSprintId" @click="startImport">
                    {{ isImporting ? $t('Projects.importing') : $t('Projects.start_import') }}
                </button>
            </div>

            <div v-if="resultText" class="font-size-13 aimport__result">{{ resultText }}</div>
        </div>
    </div>
</template>

<script setup>
import { computed, defineProps, inject, ref, watch } from "vue";
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
const asana = ref(null);
const selectedSprintId = ref('');
const isImporting = ref(false);
const resultText = ref('');

// Pull the task list out of the shapes Asana exports can take (mirrors tasksOf
// on the server): a bare array, { tasks }, { data: { tasks } } or { data: [] }.
function tasksOf(parsed) {
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.tasks)) return parsed.tasks;
    if (parsed && parsed.data && Array.isArray(parsed.data.tasks)) return parsed.data.tasks;
    if (parsed && parsed.data && Array.isArray(parsed.data)) return parsed.data;
    return [];
}

const taskCount = computed(() => tasksOf(asana.value).filter((task) => task && String(task.name || '').trim()).length);

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
        asana.value = null;
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
            const parsed = JSON.parse(loadEvent.target.result);
            if (!tasksOf(parsed).length) {
                asana.value = null;
                $toast.error(t('Projects.import_asana_invalid'), { position: 'top-right' });
                return;
            }
            asana.value = parsed;
            resultText.value = '';
            if (!taskCount.value) $toast.error(t('Projects.import_no_rows'), { position: 'top-right' });
        } catch (error) {
            console.error('ERROR parsing Asana export: ', error);
            asana.value = null;
            $toast.error(t('Projects.import_asana_invalid'), { position: 'top-right' });
        }
    };
    reader.readAsText(file);
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
    const project = {
        name: 'Sample Asana Project',
        tasks: [
            { name: 'Set up project repo', notes: 'Init repo and CI pipeline', completed: false, due_on: '2026-06-24', assignee: { name: 'Alex', email: 'alex@example.com' }, memberships: [{ section: { name: 'To Do' } }], custom_fields: [{ name: 'Priority', display_value: 'High' }] },
            { name: 'Build landing page', notes: 'Hero, features and pricing sections', completed: false, due_on: null, memberships: [{ section: { name: 'In Progress' } }] },
            { name: 'QA regression pass', notes: '', completed: true, due_on: '2026-07-01', memberships: [{ section: { name: 'Done' } }] },
        ],
    };
    triggerDownload('alianhub-asana-sample.json', JSON.stringify(project, null, 2), 'application/json');
}

function startImport() {
    if (!asana.value || !taskCount.value || isImporting.value) return;
    isImporting.value = true;
    resultText.value = '';
    const user = getUser(userId.value);
    const sprint = sprintOptions.value.find((option) => option.id === selectedSprintId.value);
    apiRequest('post', '/api/v2/imports/asana', {
        asana: asana.value,
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
        console.error('ERROR in asana import: ', error);
        $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
    }).finally(() => {
        isImporting.value = false;
    });
}
</script>

<style scoped>
.aimport__overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.35); z-index: 1000; display: flex; align-items: center; justify-content: center; }
.aimport__card { background: #fff; border-radius: 10px; width: min(520px, 92vw); padding: 16px 20px; box-shadow: 0 8px 30px rgba(0, 0, 0, 0.18); }
.aimport__head { margin-bottom: 8px; }
.aimport__close { color: #9a9a9a; }
.aimport__close:hover { color: #e84a4a; }
.aimport__hint { margin-bottom: 12px; }
.aimport__sample { display: inline-block; margin-bottom: 12px; color: #2f3990; text-decoration: underline; cursor: pointer; }
.aimport__sample:hover { opacity: 0.8; }
.aimport__file { margin-bottom: 12px; }
.aimport__preview { margin-bottom: 10px; }
.aimport__controls { margin-top: 4px; }
.aimport__select { border: 1px solid #e0e0e0; border-radius: 6px; padding: 6px 8px; background: #fff; min-width: 200px; }
.aimport__result { margin-top: 12px; padding: 8px 10px; background: #f7f9fc; border-radius: 6px; }
</style>
