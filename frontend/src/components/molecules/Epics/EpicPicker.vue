<template>
    <div class="epic-picker d-flex align-items-center">
        <span class="font-size-14 font-weight-700 epic-picker__label">{{ $t('Projects.epics') }}</span>
        <span class="position-re">
            <span class="epic-picker__current font-size-13 cursor-pointer" @click.stop="toggleOpen">
                <template v-if="currentEpic">
                    <span class="epic-picker__dot" :style="{background: currentEpic.color || '#7b68ee'}"></span>{{ currentEpic.name }}
                </template>
                <template v-else>{{ $t('Projects.select_epic') }}</template>
            </span>
            <span v-if="isOpen" class="epic-picker__overlay" @click.stop="isOpen = false"></span>
            <div v-if="isOpen" class="epic-picker__panel">
                <div
                    v-for="epic in epics"
                    :key="'pick-epic-'+epic._id"
                    class="d-flex align-items-center cursor-pointer epic-picker__row font-size-13"
                    :class="{'epic-picker__row--active': String(task.epicId) === String(epic._id)}"
                    @click="assign(epic._id)"
                >
                    <span class="epic-picker__dot" :style="{background: epic.color || '#7b68ee'}"></span>
                    <span class="epic-picker__name">{{ epic.name }}</span>
                </div>
                <div v-if="task.epicId" class="cursor-pointer epic-picker__row font-size-13 red" @click="assign(null)">
                    {{ $t('Projects.remove_from_epic') }}
                </div>
                <div v-if="!epics.length" class="gray81 font-size-12 epic-picker__row">{{ $t('Projects.no_epics') }}</div>
            </div>
        </span>
    </div>
</template>

<script setup>
// PACKAGES
import { computed, defineProps, inject, ref } from "vue";

// UTILS
import { apiRequest } from '@/services';
import { useGetterFunctions } from "@/composable";

const { getUser } = useGetterFunctions();
const userId = inject('$userId');

const props = defineProps({
    task: {
        type: Object,
        required: true
    }
});

const isOpen = ref(false);
const epics = ref([]);
const localEpicId = ref(null);
const loadedFor = ref('');

const currentEpic = computed(() => {
    const id = localEpicId.value !== null ? localEpicId.value : props.task.epicId;
    if (!id) return null;
    return epics.value.find((epic) => String(epic._id) === String(id)) || null;
});

function toggleOpen() {
    isOpen.value = !isOpen.value;
    if (isOpen.value && loadedFor.value !== String(props.task.ProjectID)) {
        fetchEpics();
    }
}

function fetchEpics() {
    apiRequest('get', `/api/v2/epics?projectId=${props.task.ProjectID}`)
    .then((response) => {
        if (response.data?.status) {
            epics.value = response.data.data || [];
            loadedFor.value = String(props.task.ProjectID);
        }
    })
    .catch((error) => console.error('ERROR in fetch epics: ', error));
}

function assign(epicId) {
    isOpen.value = false;
    const user = getUser(userId.value);
    apiRequest('post', '/api/v2/epics/assign', {
        taskId: props.task._id,
        epicId,
        userData: { id: user.id, Employee_Name: user.Employee_Name },
    }).then((response) => {
        if (response.data?.status) {
            localEpicId.value = epicId || '';
        }
    }).catch((error) => console.error('ERROR in assign epic: ', error));
}

// Seed the epic list early so the current epic name renders without opening.
if (props.task?.ProjectID) {
    fetchEpics();
}
</script>

<style scoped>
.epic-picker { margin-top: 10px; }
.epic-picker__label { margin-right: 12px; }
.epic-picker__current {
    border: 1px solid #e0e0e0;
    border-radius: 6px;
    padding: 4px 10px;
    display: inline-flex;
    align-items: center;
}
.epic-picker__dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    margin-right: 6px;
    display: inline-block;
    flex: none;
}
.epic-picker__overlay { position: fixed; inset: 0; z-index: 19; }
.epic-picker__panel {
    position: absolute;
    top: 30px;
    left: 0;
    z-index: 20;
    min-width: 220px;
    max-height: 240px;
    overflow-y: auto;
    background: #fff;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
    padding: 4px 0;
}
.epic-picker__row { padding: 7px 12px; min-width: 0; }
.epic-picker__row:hover { background: #f7f9fc; }
.epic-picker__row--active { background: #f3f0ff; }
.epic-picker__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
