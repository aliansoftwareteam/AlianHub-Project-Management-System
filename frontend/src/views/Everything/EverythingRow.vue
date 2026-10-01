<template>
    <div
        class="evr__row"
        role="listitem"
        :class="{ 'is-done': done }"
        v-bind="taskNavAttrs(task)"
        @click="$emit('open', task)"
    >
        <div class="evr__title" :style="indent">
            <TaskTypeIcon v-if="hasTypeIcon" :taskType="taskType" class="evr__type" aria-hidden="true" />
            <button type="button" class="evr__name" :title="task.TaskName" @click.stop="$emit('open', task)">{{ task.TaskName }}</button>
            <span v-if="task.subTasks" class="evr__subs" :title="$t('Everything.subtasks_n', { n: task.subTasks })">{{ task.subTasks }}</span>
        </div>

        <span class="evr__status" @click.stop>
            <ListStatusCircle :task="task" :statuses="statuses" :editable="canStatus" chip @change="(status) => $emit('status', task, status)" />
        </span>

        <div class="evr__meta">
            <span class="evr__project" :title="project?.ProjectName || null">
                <span class="evr__dot" :style="{ background: color }" aria-hidden="true"></span>
                <span class="evr__key">{{ task.TaskKey }}</span>
            </span>
            <span class="evr__assignee"><ListAssigneeCell :task="task" /></span>
            <span class="evr__due"><ListDueCell :task="task" :done="done" /></span>
            <span class="evr__prio" @click.stop>
                <ListPriorityCell v-if="showPriority" :task="task" :editable="canPriority" @change="(option) => $emit('priority', task, option)" />
            </span>
        </div>
    </div>
</template>

<script setup>
import { computed } from "vue";
import { useStore } from "vuex";
import TaskTypeIcon from "@/components/atom/TaskTypeIcon/TaskTypeIcon.vue";
import ListStatusCircle from "@/views/Projects/ListView/ListStatusCircle.vue";
import ListAssigneeCell from "@/views/Projects/ListView/ListAssigneeCell.vue";
import ListDueCell from "@/views/Projects/ListView/ListDueCell.vue";
import ListPriorityCell from "@/views/Projects/ListView/ListPriorityCell.vue";
import { isDoneStatus, priorityAppOn } from "@/views/Projects/ListView/listRowEdit";
import { projectColor } from "@/components/molecules/Home/homeFormat";
import { taskNavAttrs } from "@/components/organisms/TaskDetailOverlay/taskNavigation";

defineOptions({ name: "EverythingRow" });

const props = defineProps({
    task: { type: Object, required: true },
    project: { type: Object, default: null }
});
defineEmits(["open", "status", "priority"]);

const getters = useStore()?.getters || {};

const statuses = computed(() => props.project?.taskStatusData || []);
const done = computed(() => isDoneStatus({ type: props.task.statusType }));
const canStatus = computed(() => props.project?.edit?.status === true);
const canPriority = computed(() => props.project?.edit?.priority === true);
/* The project is handed in, never injected: the rows on this page belong to many projects, and
 * the Priority app is switched on per project. */
const showPriority = computed(() => priorityAppOn(props.project, getters["settings/selectedCompany"]?.planFeature));
const taskType = computed(() => (props.project?.taskTypeCounts || []).find((type) => type.key === props.task.TaskTypeKey) || null);
const hasTypeIcon = computed(() => Boolean(taskType.value && (taskType.value.taskImage || taskType.value.iconValue)));
const color = computed(() => projectColor(props.project));
const depth = computed(() => (Array.isArray(props.task.ancestors) ? props.task.ancestors.length : 0));
const indent = computed(() => (depth.value ? { paddingInlineStart: `${depth.value * 18}px` } : null));
</script>
