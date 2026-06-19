<template>
    <div v-if="modelValue" class="epics__overlay" @click.self="$emit('update:modelValue', false)">
        <div class="epics__card">
            <div class="d-flex align-items-center justify-content-between epics__head">
                <span class="font-size-16 font-weight-700">{{ $t('Projects.epics') }}</span>
                <span class="cursor-pointer font-size-16 epics__close" @click="$emit('update:modelValue', false)">&#10005;</span>
            </div>

            <!-- Create a new epic: name + priority + optional dates -->
            <div class="epics__create">
                <input
                    v-model="newEpicName"
                    type="text"
                    class="epics__input font-size-13"
                    :placeholder="$t('Projects.epic_name_placeholder')"
                    @keydown.enter="createEpic"
                />
                <div class="d-flex align-items-center epics__create-meta">
                    <select v-model="newEpicPriority" class="epics__select font-size-12" :title="$t('Projects.epic_priority')">
                        <option value="low">{{ $t('Projects.priority_low') }}</option>
                        <option value="medium">{{ $t('Projects.priority_medium') }}</option>
                        <option value="high">{{ $t('Projects.priority_high') }}</option>
                    </select>
                    <input v-model="newEpicStartDate" type="date" class="epics__date font-size-12" :title="$t('Projects.epic_start_date')" />
                    <input v-model="newEpicDueDate" type="date" class="epics__date font-size-12" :title="$t('Projects.epic_due_date')" />
                    <button class="btn-primary font-size-13" :disabled="isSaving" @click="createEpic">{{ $t('Projects.add_epic') }}</button>
                </div>
            </div>

            <div v-if="isLoading" class="gray81 font-size-12 epics__empty">{{ $t('Projects.searching') }}</div>
            <div v-else-if="!epics.length" class="gray81 font-size-12 epics__empty">{{ $t('Projects.no_epics') }}</div>
            <div v-else>
                <div v-for="epic in epics" :key="'epic-'+epic._id" class="epics__row">
                    <div class="d-flex align-items-center justify-content-between">
                        <div class="d-flex align-items-center epics__row-main">
                            <span class="epics__dot" :style="{background: epic.color || '#7b68ee'}"></span>
                            <span class="font-size-13 font-weight-600 epics__name">{{ epic.name }}</span>
                            <span v-if="epic.priority" class="epics__badge font-size-10" :class="'epics__badge--'+epic.priority">{{ priorityLabel(epic.priority) }}</span>
                        </div>
                        <div class="d-flex align-items-center epics__row-actions">
                            <select
                                :value="epic.status || 'open'"
                                class="epics__status-select font-size-11"
                                :class="'epics__status-select--'+(epic.status || 'open')"
                                @change="updateEpicStatus(epic, $event.target.value)"
                            >
                                <option value="open">{{ $t('Projects.epic_status_open') }}</option>
                                <option value="in_progress">{{ $t('Projects.epic_status_in_progress') }}</option>
                                <option value="done">{{ $t('Projects.epic_status_done') }}</option>
                            </select>
                            <span class="font-size-11 gray81 epics__count">{{ progressOf(epic) }}% · {{ epic.completedCount || 0 }}/{{ epic.taskCount || 0 }}</span>
                            <span class="cursor-pointer epics__delete" :title="$t('Projects.delete')" @click="deleteEpic(epic)">&#10005;</span>
                        </div>
                    </div>
                    <div class="epics__bar">
                        <div class="epics__bar-fill" :style="{width: progressOf(epic) + '%', background: epic.color || '#7b68ee'}"></div>
                    </div>
                    <div class="d-flex align-items-center flex-wrap epics__meta font-size-11 gray81">
                        <span class="epics__meta-item">{{ $t('Projects.epic_owner') }}: {{ ownerName(epic) }}</span>
                        <span v-if="epic.startDate" class="epics__meta-item">{{ $t('Projects.epic_start_date') }}: {{ formatDate(epic.startDate) }}</span>
                        <span v-if="epic.dueDate" class="epics__meta-item">{{ $t('Projects.epic_due_date') }}: {{ formatDate(epic.dueDate) }}</span>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
// PACKAGES
import { defineProps, inject, ref, watch } from "vue";
import { useToast } from "vue-toast-notification";
import { useI18n } from "vue-i18n";

// UTILS
import { apiRequest } from '@/services';
import { useGetterFunctions } from "@/composable";

const $toast = useToast();
const { t } = useI18n();
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

const epics = ref([]);
const isLoading = ref(false);
const isSaving = ref(false);
const newEpicName = ref('');
const newEpicPriority = ref('medium');
const newEpicStartDate = ref('');
const newEpicDueDate = ref('');

const PRIORITY_KEYS = { low: 'Projects.priority_low', medium: 'Projects.priority_medium', high: 'Projects.priority_high' };

watch(() => props.modelValue, (open) => {
    if (open) fetchEpics();
});

function fetchEpics() {
    isLoading.value = true;
    apiRequest('get', `/api/v2/epics?projectId=${props.projectData._id}`)
    .then((response) => {
        epics.value = response.data?.status ? (response.data.data || []) : [];
    })
    .catch((error) => console.error('ERROR in fetch epics: ', error))
    .finally(() => { isLoading.value = false; });
}

function progressOf(epic) {
    if (!epic.taskCount) return 0;
    return Math.min(100, Math.round(((epic.completedCount || 0) / epic.taskCount) * 100));
}

function priorityLabel(priority) {
    return PRIORITY_KEYS[priority] ? t(PRIORITY_KEYS[priority]) : priority;
}

function ownerName(epic) {
    if (!epic.ownerUserId) return t('Projects.epic_unassigned');
    const user = getUser(epic.ownerUserId);
    return (user && user.Employee_Name) ? user.Employee_Name : t('Projects.epic_unassigned');
}

function formatDate(value) {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString();
}

function createEpic() {
    const name = newEpicName.value.trim();
    if (!name || isSaving.value) return;
    isSaving.value = true;
    const user = getUser(userId.value);
    apiRequest('post', '/api/v2/epics', {
        name,
        projectId: props.projectData._id,
        priority: newEpicPriority.value,
        ownerUserId: user.id,
        startDate: newEpicStartDate.value || undefined,
        dueDate: newEpicDueDate.value || undefined,
        userData: { id: user.id, Employee_Name: user.Employee_Name },
    }).then((response) => {
        if (response.data?.status) {
            newEpicName.value = '';
            newEpicStartDate.value = '';
            newEpicDueDate.value = '';
            newEpicPriority.value = 'medium';
            fetchEpics();
        } else {
            $toast.error(response.data?.statusText || 'Error', { position: 'top-right' });
        }
    }).catch((error) => console.error('ERROR in create epic: ', error))
    .finally(() => { isSaving.value = false; });
}

function updateEpicStatus(epic, status) {
    apiRequest('put', `/api/v2/epics/${epic._id}`, { status })
    .then((response) => {
        if (response.data?.status) {
            epic.status = status;
        } else {
            $toast.error(response.data?.statusText || 'Error', { position: 'top-right' });
        }
    }).catch((error) => console.error('ERROR in update epic status: ', error));
}

function deleteEpic(epic) {
    apiRequest('delete', `/api/v2/epics/${epic._id}`)
    .then((response) => {
        if (response.data?.status) fetchEpics();
    }).catch((error) => console.error('ERROR in delete epic: ', error));
}
</script>

<style scoped>
.epics__overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.35);
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
}
.epics__card {
    background: #fff;
    border-radius: 10px;
    width: min(620px, 94vw);
    max-height: 74vh;
    overflow-y: auto;
    padding: 16px 20px;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.18);
}
.epics__head { margin-bottom: 12px; }
.epics__close { color: #9a9a9a; }
.epics__close:hover { color: #e84a4a; }
.epics__create { margin-bottom: 14px; }
.epics__input {
    width: 100%;
    border: 1px solid #e0e0e0;
    border-radius: 6px;
    padding: 7px 10px;
}
.epics__create-meta { gap: 8px; margin-top: 8px; flex-wrap: wrap; }
.epics__select, .epics__date {
    border: 1px solid #e0e0e0;
    border-radius: 6px;
    padding: 6px 8px;
    background: #fff;
}
.epics__create-meta .btn-primary { margin-left: auto; }
.epics__row { padding: 10px 0; border-bottom: 1px solid #f0f0f0; }
.epics__row-main { min-width: 0; flex: 1; }
.epics__row-actions { gap: 6px; flex: none; }
.epics__dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    margin-right: 8px;
    flex: none;
}
.epics__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.epics__badge {
    margin-left: 8px;
    border-radius: 4px;
    padding: 1px 6px;
    font-weight: 700;
    text-transform: capitalize;
    white-space: nowrap;
}
.epics__badge--low { background: #eef0f3; color: #5b6470; }
.epics__badge--medium { background: #e7f0fb; color: #1565c0; }
.epics__badge--high { background: #fdecea; color: #c0392b; }
.epics__status-select {
    border: 1px solid #e0e0e0;
    border-radius: 12px;
    padding: 2px 6px;
    background: #fff;
    cursor: pointer;
}
.epics__status-select--open { color: #5b6470; }
.epics__status-select--in_progress { color: #b06a00; border-color: #f0d8a8; background: #fff5e6; }
.epics__status-select--done { color: #2e7d32; border-color: #bfe3c4; background: #e9f6ea; }
.epics__count { white-space: nowrap; }
.epics__delete { color: #c9c9c9; padding: 0 4px; }
.epics__delete:hover { color: #e84a4a; }
.epics__bar {
    height: 6px;
    border-radius: 3px;
    background: #f0f0f0;
    margin-top: 8px;
    overflow: hidden;
}
.epics__bar-fill { height: 100%; border-radius: 3px; transition: width 0.2s; }
.epics__meta { gap: 14px; margin-top: 6px; }
.epics__meta-item { white-space: nowrap; }
</style>
