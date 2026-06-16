<template>
    <div v-if="modelValue" class="recent-visits__overlay" @click.self="$emit('update:modelValue', false)">
        <div class="recent-visits__card">
            <div class="d-flex align-items-center justify-content-between recent-visits__head">
                <span class="font-size-16 font-weight-700">{{ $t('Projects.recent_tasks') }}</span>
                <span class="cursor-pointer font-size-16 recent-visits__close" @click="$emit('update:modelValue', false)">&#10005;</span>
            </div>
            <div v-if="isLoading" class="gray81 font-size-12 recent-visits__empty">{{ $t('Projects.searching') }}</div>
            <div v-else-if="!items.length" class="gray81 font-size-12 recent-visits__empty">{{ $t('Projects.no_recent_tasks') }}</div>
            <div
                v-else
                v-for="item in items"
                :key="'recent-'+item.task._id"
                class="d-flex align-items-center cursor-pointer recent-visits__row"
                @click="openTask(item.task)"
            >
                <span class="font-size-12 font-weight-600 blue mr-5px">{{ item.task.TaskKey }}</span>
                <span class="font-size-13 recent-visits__name">{{ item.task.TaskName }}</span>
                <span v-if="item.task.status && item.task.status.text" class="font-size-11 recent-visits__status">{{ item.task.status.text }}</span>
            </div>
        </div>
    </div>
</template>

<script setup>
// PACKAGES
import { defineProps, inject, ref, watch } from "vue";
import { useRouter } from "vue-router";

// UTILS
import { apiRequest } from '@/services';

const router = useRouter();
const userId = inject('$userId');
const companyId = inject('$companyId');

const props = defineProps({
    modelValue: {
        type: Boolean,
        default: false
    }
});

const emit = defineEmits(['update:modelValue']);

const isLoading = ref(false);
const items = ref([]);

watch(() => props.modelValue, (open) => {
    if (open) fetchRecent();
});

function fetchRecent() {
    isLoading.value = true;
    apiRequest('get', `/api/v2/recent-visits?uid=${encodeURIComponent(userId.value)}`)
    .then((response) => {
        items.value = response.data?.status ? (response.data.data || []) : [];
    })
    .catch((error) => {
        console.error('ERROR in fetch recent visits: ', error);
    })
    .finally(() => {
        isLoading.value = false;
    });
}

// Task routes (router/projects): with folder → /:cid/project/:id/fs/:folderId/:sprintId/:taskId,
// without → /:cid/project/:id/s/:sprintId/:taskId
function openTask(task) {
    emit('update:modelValue', false);
    const base = `/${companyId.value}/project/${task.ProjectID}`;
    const path = task.folderObjId
        ? `${base}/fs/${task.folderObjId}/${task.sprintId}/${task._id}`
        : `${base}/s/${task.sprintId}/${task._id}`;
    router.push(path).catch((error) => {
        console.error('ERROR in open recent task: ', error);
    });
}
</script>

<style scoped>
.recent-visits__overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.35);
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
}
.recent-visits__card {
    background: #fff;
    border-radius: 10px;
    width: min(440px, 92vw);
    max-height: 64vh;
    overflow-y: auto;
    padding: 14px 16px;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.18);
}
.recent-visits__head { margin-bottom: 8px; }
.recent-visits__close { color: #9a9a9a; }
.recent-visits__close:hover { color: #e84a4a; }
.recent-visits__row {
    padding: 7px 8px;
    border-radius: 6px;
    min-width: 0;
}
.recent-visits__row:hover {
    background: #f7f9fc;
}
.recent-visits__name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
}
.recent-visits__status {
    background: #f0f0f0;
    border-radius: 10px;
    padding: 1px 7px;
    margin-left: 8px;
    white-space: nowrap;
    color: #6a6a6a;
}
.recent-visits__empty {
    padding: 18px 12px;
    text-align: center;
}
</style>
