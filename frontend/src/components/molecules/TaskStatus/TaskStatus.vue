<template>
    <div>
        <button
            v-if="canChangeStatus"
            type="button"
            class="task-status-name ah-status-ink"
            aria-haspopup="dialog"
            :aria-expanded="isVisible ? 'true' : 'false'"
            :style="chipStyle"
            @click="isVisible = true"
        >
            {{ taskStatus?.name }}
        </button>
        <span
            v-else
            class="task-status-name ah-status-ink"
            :style="chipStyle"
        >
            {{ taskStatus?.name }}
        </span>
        <Sidebar
            v-if="canChangeStatus"
            className="task-status-sidebar"
            v-model:visible="isVisible"
            :title="$t('Templates.select_task_status')"
            :enable-search="true"
            :options="options"
            @update:value="(val) => updateStatus(val,taskStatus)"
            :zIndex="props.taskStatusIndex"
        >
        </Sidebar>
    </div>
</template>
<script setup>
import Sidebar from '@/components/molecules/Sidebar/Sidebar.vue';

import { computed, ref, defineProps, inject } from 'vue';
import { useCustomComposable } from '@/composable'
import { statusChipStyle } from '@/utils/statusChipColors';

const props = defineProps({
    taskKey: {
        type: [String, Number],
        required: true
    },
    projectId: {
        type: String,
        required: true
    },
    sprintId: {
        type: String,
        required: true
    },
    taskId: {
        type: String,
        required: true
    },
    taskStatusIndex: {
        type: Number,
        default:7
    }
});

const isVisible = ref(false);
const emit = defineEmits(["update:status"]);
const selectedProject = inject("selectedProject");
const taskStatuses = computed(() => {return selectedProject.value.taskStatusData});
const { checkPermission } = useCustomComposable();
const canChangeStatus = computed(() => checkPermission('task.task_list', selectedProject.value?.isGlobalPermission) == true && checkPermission('task.task_status', selectedProject.value?.isGlobalPermission) === true);
const taskStatus = computed(() => {
    if (taskStatuses.value) {
        return taskStatuses.value.find((status) => status.key === props.taskKey);
    } else {
        return {}
    }
});
const chipStyle = computed(() => statusChipStyle(taskStatus.value));

const options = computed(() => {
    if (taskStatuses.value) {       
        return taskStatuses.value.map((status) => {
            return {
                ...status,
                label: status.name,
    
            }
        });
    } else {
        return  []
    }
});

const updateStatus = (val,status) => {
    emit('update:status',status,val[0])
}
</script>
<style src="./style.css"></style>