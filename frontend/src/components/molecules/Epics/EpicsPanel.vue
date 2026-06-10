<template>
    <div v-if="modelValue" class="epics__overlay" @click.self="$emit('update:modelValue', false)">
        <div class="epics__card">
            <div class="d-flex align-items-center justify-content-between epics__head">
                <span class="font-size-16 font-weight-700">{{ $t('Projects.epics') }}</span>
                <span class="cursor-pointer font-size-16 epics__close" @click="$emit('update:modelValue', false)">&#10005;</span>
            </div>
            <div class="d-flex align-items-center epics__create">
                <input
                    v-model="newEpicName"
                    type="text"
                    class="epics__input font-size-13"
                    :placeholder="$t('Projects.epic_name_placeholder')"
                    @keydown.enter="createEpic"
                />
                <button class="btn-primary font-size-13 ml-10px" :disabled="isSaving" @click="createEpic">{{ $t('Projects.add_epic') }}</button>
            </div>
            <div v-if="isLoading" class="gray81 font-size-12 epics__empty">{{ $t('Projects.searching') }}</div>
            <div v-else-if="!epics.length" class="gray81 font-size-12 epics__empty">{{ $t('Projects.no_epics') }}</div>
            <div v-else>
                <div v-for="epic in epics" :key="'epic-'+epic._id" class="epics__row">
                    <div class="d-flex align-items-center justify-content-between">
                        <div class="d-flex align-items-center epics__row-main">
                            <span class="epics__dot" :style="{background: epic.color || '#7b68ee'}"></span>
                            <span class="font-size-13 font-weight-600 epics__name">{{ epic.name }}</span>
                        </div>
                        <div class="d-flex align-items-center">
                            <span class="font-size-11 gray81 mr-10px">{{ epic.completedCount || 0 }}/{{ epic.taskCount || 0 }}</span>
                            <span class="cursor-pointer epics__delete" :title="$t('Projects.delete')" @click="deleteEpic(epic)">&#10005;</span>
                        </div>
                    </div>
                    <div class="epics__bar">
                        <div class="epics__bar-fill" :style="{width: progressOf(epic) + '%', background: epic.color || '#7b68ee'}"></div>
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

// UTILS
import { apiRequest } from '@/services';
import { useGetterFunctions } from "@/composable";

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

const epics = ref([]);
const isLoading = ref(false);
const isSaving = ref(false);
const newEpicName = ref('');

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

function createEpic() {
    const name = newEpicName.value.trim();
    if (!name || isSaving.value) return;
    isSaving.value = true;
    const user = getUser(userId.value);
    apiRequest('post', '/api/v2/epics', {
        name,
        projectId: props.projectData._id,
        userData: { id: user.id, Employee_Name: user.Employee_Name },
    }).then((response) => {
        if (response.data?.status) {
            newEpicName.value = '';
            fetchEpics();
        } else {
            $toast.error(response.data?.statusText || 'Error', { position: 'top-right' });
        }
    }).catch((error) => console.error('ERROR in create epic: ', error))
    .finally(() => { isSaving.value = false; });
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
    width: min(560px, 92vw);
    max-height: 70vh;
    overflow-y: auto;
    padding: 16px 20px;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.18);
}
.epics__head { margin-bottom: 12px; }
.epics__close { color: #9a9a9a; }
.epics__close:hover { color: #e84a4a; }
.epics__create { margin-bottom: 14px; }
.epics__input {
    flex: 1;
    border: 1px solid #e0e0e0;
    border-radius: 6px;
    padding: 7px 10px;
}
.epics__row { padding: 8px 0; border-bottom: 1px solid #f0f0f0; }
.epics__row-main { min-width: 0; }
.epics__dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    margin-right: 8px;
    flex: none;
}
.epics__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.epics__delete { color: #c9c9c9; padding: 0 4px; }
.epics__delete:hover { color: #e84a4a; }
.epics__bar {
    height: 6px;
    border-radius: 3px;
    background: #f0f0f0;
    margin-top: 6px;
    overflow: hidden;
}
.epics__bar-fill { height: 100%; border-radius: 3px; transition: width 0.2s; }
</style>
