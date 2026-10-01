<template>
    <article
        class="evr__card"
        role="listitem"
        :class="{ 'is-done': done, 'is-dragging': dragging }"
        :draggable="canStatus ? 'true' : 'false'"
        v-bind="taskNavAttrs(task)"
        @dragstart="onDragStart"
        @dragend="onDragEnd"
        @click="$emit('open', task)"
    >
        <div class="evr__card-top">
            <span class="evr__project" :title="project?.ProjectName || null">
                <span class="evr__dot" :style="{ background: color }" aria-hidden="true"></span>
                <span class="evr__key">{{ task.TaskKey }}</span>
            </span>
            <span class="evr__prio" @click.stop>
                <ListPriorityCell v-if="showPriority" :task="task" :editable="canPriority" @change="(option) => $emit('priority', task, option)" />
            </span>
        </div>
        <div class="evr__card-title">
            <TaskTypeIcon v-if="hasTypeIcon" :taskType="taskType" class="evr__type" aria-hidden="true" />
            <button type="button" class="evr__name evr__card-name" :title="task.TaskName" @click.stop="$emit('open', task)">{{ task.TaskName }}</button>
        </div>
        <div class="evr__card-foot">
            <span class="evr__status" @click.stop>
                <ListStatusCircle :task="task" :statuses="statuses" :editable="canStatus" @change="(status) => $emit('status', task, status)" />
            </span>
            <span class="evr__assignee"><ListAssigneeCell :task="task" /></span>
            <span class="evr__due"><ListDueCell :task="task" :done="done" /></span>
            <span v-if="task.subTasks" class="evr__subs" :title="$t('Everything.subtasks_n', { n: task.subTasks })">{{ task.subTasks }}</span>
        </div>
    </article>
</template>

<script setup>
import { ref } from "vue";
import TaskTypeIcon from "@/components/atom/TaskTypeIcon/TaskTypeIcon.vue";
import ListStatusCircle from "@/views/Projects/ListView/ListStatusCircle.vue";
import ListAssigneeCell from "@/views/Projects/ListView/ListAssigneeCell.vue";
import ListDueCell from "@/views/Projects/ListView/ListDueCell.vue";
import ListPriorityCell from "@/views/Projects/ListView/ListPriorityCell.vue";
import { taskNavAttrs } from "@/components/organisms/TaskDetailOverlay/taskNavigation";
import { useRowState } from "./useRowState";

defineOptions({ name: "EverythingCard" });

const props = defineProps({
    task: { type: Object, required: true },
    project: { type: Object, default: null }
});
const emit = defineEmits(["open", "status", "priority", "drag-start", "drag-end"]);

const { statuses, done, canStatus, canPriority, showPriority, taskType, hasTypeIcon, color } = useRowState(() => props.task, () => props.project);
const dragging = ref(false);

function onDragStart(event) {
    if (!canStatus.value) {
        event.preventDefault();
        return;
    }
    event.dataTransfer?.setData("application/x-ah-task", String(props.task._id));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    dragging.value = true;
    emit("drag-start", props.task);
}

function onDragEnd() {
    dragging.value = false;
    emit("drag-end");
}
</script>
