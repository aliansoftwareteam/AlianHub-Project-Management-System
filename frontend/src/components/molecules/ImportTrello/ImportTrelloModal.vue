<template>
    <div v-if="modelValue" class="timport__overlay" @click.self="$emit('update:modelValue', false)">
        <div class="timport__card">
            <div class="d-flex align-items-center justify-content-between timport__head">
                <span class="font-size-16 font-weight-700">{{ $t('Projects.import_trello') }}</span>
                <span class="cursor-pointer font-size-16 timport__close" @click="$emit('update:modelValue', false)">&#10005;</span>
            </div>

            <div class="font-size-12 gray81 timport__hint">{{ $t('Projects.import_trello_hint') }}</div>

            <span class="font-size-12 timport__sample" @click="downloadSample">&#8595; {{ $t('Projects.download_sample') }}</span>

            <input ref="fileEl" type="file" accept=".json,application/json" class="font-size-13 timport__file" @change="parseFile" />

            <div v-if="board" class="font-size-13 timport__preview">
                {{ $t('Projects.import_trello_found', { lists: listCount, cards: cardCount }) }}
            </div>

            <div class="d-flex align-items-center timport__controls" v-if="board && cardCount">
                <span class="font-size-13 font-weight-500 mr-10px">{{ $t('Projects.select_sprint') }}:</span>
                <select v-model="selectedSprintId" class="timport__select font-size-13">
                    <option v-for="sprint in sprintOptions" :key="'tr-'+sprint.id" :value="sprint.id">
                        {{ sprint.folderName ? sprint.folderName + ' / ' : '' }}{{ sprint.name }}
                    </option>
                </select>
                <button class="btn-primary font-size-13 ml-10px" :disabled="isImporting || !selectedSprintId" @click="startImport">
                    {{ isImporting ? $t('Projects.importing') : $t('Projects.start_import') }}
                </button>
            </div>

            <div v-if="resultText" class="font-size-13 timport__result">{{ resultText }}</div>
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
const board = ref(null);
const selectedSprintId = ref('');
const isImporting = ref(false);
const resultText = ref('');

const listCount = computed(() => (board.value?.lists || []).filter((l) => l && !l.closed).length);
const cardCount = computed(() => (board.value?.cards || []).filter((c) => c && !c.closed && String(c.name || '').trim()).length);

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
        board.value = null;
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
            if (!parsed || !Array.isArray(parsed.cards)) {
                board.value = null;
                $toast.error(t('Projects.import_trello_invalid'), { position: 'top-right' });
                return;
            }
            board.value = parsed;
            resultText.value = '';
            if (!cardCount.value) $toast.error(t('Projects.import_no_rows'), { position: 'top-right' });
        } catch (error) {
            console.error('ERROR parsing Trello export: ', error);
            board.value = null;
            $toast.error(t('Projects.import_trello_invalid'), { position: 'top-right' });
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
    const board = {
        name: 'Sample Trello Board',
        lists: [
            { id: 'list-todo', name: 'To Do', closed: false },
            { id: 'list-doing', name: 'In Progress', closed: false },
            { id: 'list-done', name: 'Done', closed: false },
        ],
        cards: [
            { name: 'Set up project repo', desc: 'Init repo and CI pipeline', due: '2026-06-24T10:00:00.000Z', idList: 'list-todo', closed: false },
            { name: 'Build landing page', desc: 'Hero, features and pricing sections', due: null, idList: 'list-doing', closed: false },
            { name: 'QA regression pass', desc: '', due: '2026-07-01T10:00:00.000Z', idList: 'list-todo', closed: false },
        ],
    };
    triggerDownload('alianhub-trello-sample.json', JSON.stringify(board, null, 2), 'application/json');
}

function startImport() {
    if (!board.value || !cardCount.value || isImporting.value) return;
    isImporting.value = true;
    resultText.value = '';
    const user = getUser(userId.value);
    const sprint = sprintOptions.value.find((option) => option.id === selectedSprintId.value);
    apiRequest('post', '/api/v2/imports/trello', {
        board: board.value,
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
        console.error('ERROR in trello import: ', error);
        $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
    }).finally(() => {
        isImporting.value = false;
    });
}
</script>

<style scoped>
.timport__overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.35); z-index: 1000; display: flex; align-items: center; justify-content: center; }
.timport__card { background: #fff; border-radius: 10px; width: min(520px, 92vw); padding: 16px 20px; box-shadow: 0 8px 30px rgba(0, 0, 0, 0.18); }
.timport__head { margin-bottom: 8px; }
.timport__close { color: #9a9a9a; }
.timport__close:hover { color: #e84a4a; }
.timport__hint { margin-bottom: 12px; }
.timport__sample { display: inline-block; margin-bottom: 12px; color: #2f3990; text-decoration: underline; cursor: pointer; }
.timport__sample:hover { opacity: 0.8; }
.timport__file { margin-bottom: 12px; }
.timport__preview { margin-bottom: 10px; }
.timport__controls { margin-top: 4px; }
.timport__select { border: 1px solid #e0e0e0; border-radius: 6px; padding: 6px 8px; background: #fff; min-width: 200px; }
.timport__result { margin-top: 12px; padding: 8px 10px; background: #f7f9fc; border-radius: 6px; }
</style>
