<template>
    <tr class="evr__tr" :class="{ 'is-done': done }" v-bind="taskNavAttrs(task)" @click="$emit('open', task)">
        <td class="evr__td evr__td--name" :style="indent">
            <span class="evr__td-title">
                <button type="button" class="evr__name" :title="task.TaskName" @click.stop="$emit('open', task)">{{ task.TaskName }}</button>
                <span v-if="task.subTasks" class="evr__subs" :title="$t('Everything.subtasks_n', { n: task.subTasks }, task.subTasks)">{{ task.subTasks }}</span>
                <slot name="lists"><TaskListChips :task="task" /></slot>
            </span>
        </td>
        <td class="evr__td">
            <span class="evr__project" :title="project?.ProjectName || null">
                <span class="evr__dot" :style="{ background: color }" aria-hidden="true"></span>
                <span class="evr__key">{{ task.TaskKey }}</span>
            </span>
        </td>
        <td class="evr__td" @click.stop>
            <span class="evr__status"><ListStatusCircle :task="task" :statuses="statuses" :editable="canStatus" chip @change="(status) => $emit('status', task, status)" /></span>
        </td>
        <td class="evr__td" @click.stop>
            <ListPriorityCell v-if="showPriority" :task="task" :editable="canPriority" @change="(option) => $emit('priority', task, option)" />
        </td>
        <td class="evr__td"><ListAssigneeCell :task="task" /></td>
        <td class="evr__td"><ListDueCell :task="task" :done="done" /></td>
        <td class="evr__td">
            <span class="evr__type-cell">
                <TaskTypeIcon v-if="hasTypeIcon" :taskType="taskType" class="evr__type" aria-hidden="true" />
                <span>{{ taskType?.name || task.TaskType }}</span>
            </span>
        </td>
        <td class="evr__td evr__td--updated" :title="updatedFull">{{ updatedAgo }}</td>
    </tr>
</template>

<script setup>
import { computed } from "vue";
import moment from "moment";
import TaskTypeIcon from "@/components/atom/TaskTypeIcon/TaskTypeIcon.vue";
import ListStatusCircle from "@/views/Projects/ListView/ListStatusCircle.vue";
import ListAssigneeCell from "@/views/Projects/ListView/ListAssigneeCell.vue";
import ListDueCell from "@/views/Projects/ListView/ListDueCell.vue";
import ListPriorityCell from "@/views/Projects/ListView/ListPriorityCell.vue";
import { taskNavAttrs } from "@/components/organisms/TaskDetailOverlay/taskNavigation";
import TaskListChips from "@/views/Projects/components/TaskListChips.vue";
import { useRowState } from "./useRowState";

defineOptions({ name: "EverythingTableRow" });

const props = defineProps({
    task: { type: Object, required: true },
    project: { type: Object, default: null }
});
defineEmits(["open", "status", "priority"]);

const { statuses, done, canStatus, canPriority, showPriority, taskType, hasTypeIcon, color, depth } = useRowState(() => props.task, () => props.project);
const indent = computed(() => (depth.value ? { paddingInlineStart: `${12 + depth.value * 18}px` } : null));
const updatedAgo = computed(() => (props.task.updatedAt ? moment(props.task.updatedAt).fromNow() : ""));
const updatedFull = computed(() => (props.task.updatedAt ? moment(props.task.updatedAt).format("LLL") : null));
</script>
