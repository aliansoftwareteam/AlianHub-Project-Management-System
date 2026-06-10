<template>
    <span class="position-re">
        <button class="text-nowrap btn-white border-groupBy border-radius-6-px cursor-pointer" @click.stop="toggleOpen">
            <strong :style="{color: (clientWidth <= 767 ? '#535358' : '#000')}" :class="{'font-size-12 font-weight-500' : clientWidth > 767 , 'font-size-14 font-weight-400' : clientWidth <=767}">{{ $t('Projects.recent_tasks') }}</strong>
        </button>
        <span v-if="isOpen" class="recent-visits__overlay" @click.stop="isOpen = false"></span>
        <div v-if="isOpen" class="recent-visits__panel">
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
    </span>
</template>

<script setup>
// PACKAGES
import { inject, ref } from "vue";
import { useRouter } from "vue-router";

// UTILS
import { apiRequest } from '@/services';

const router = useRouter();
const userId = inject('$userId');
const companyId = inject('$companyId');
const clientWidth = inject('$clientWidth');

const isOpen = ref(false);
const isLoading = ref(false);
const items = ref([]);

function toggleOpen() {
    isOpen.value = !isOpen.value;
    if (isOpen.value) {
        fetchRecent();
    }
}

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
    isOpen.value = false;
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
    z-index: 19;
}
.recent-visits__panel {
    position: absolute;
    top: 36px;
    right: 0;
    z-index: 20;
    width: 300px;
    max-height: 320px;
    overflow-y: auto;
    background: #fff;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
    padding: 4px 0;
}
.recent-visits__row {
    padding: 7px 12px;
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
