<template>
    <ListAssigneeCell
        v-if="column.id === 'assignee'"
        :task="task"
        :editable="can('assignee')"
        :options="can('assignee') ? edit.assigneeOptions(task) : []"
        :multiple="Boolean(edit && edit.multipleAssignees.value)"
        @change="(change) => edit.setAssignee(task, change, { row: row() })"
    />
    <ListDueCell
        v-else-if="column.id === 'due'"
        :task="task"
        :done="done"
        :editable="can('due')"
        @change="(date) => edit.setDue(task, date, { row: row() })"
    />
    <ListPriorityCell
        v-else-if="column.id === 'priority'"
        :task="task"
        :editable="can('priority')"
        @change="(option) => edit.setPriority(task, option, { row: row() })"
    />
    <EstimateCell
        v-else-if="column.id === 'estimate'"
        :task="task"
        :editable="can('estimate')"
        @change="(minutes, reason) => edit.setEstimate(task, minutes, { row: row(), reason })"
    />
    <span v-else-if="column.id === 'points'" class="tcc-points" @click.stop>
        <StoryPoints
            :pointsVal="task.points ?? null"
            :estimationScale="project?.estimationScale || 'fibonacci'"
            :permission="can('points')"
            :emptyLabel="$t('ViewColumns.points_none')"
            :buttonLabel="pointsLabel"
            @select="(value) => edit.setPoints(task, value, { row: row() })"
        />
    </span>
    <span v-else-if="column.id === 'start'" class="tcc-date">{{ dateText(task.startDate) }}</span>
    <span v-else-if="column.id === 'created'" class="tcc-date">{{ dateText(task.createdAt) }}</span>
    <span v-else-if="column.id === 'updated'" class="tcc-date">{{ dateText(task.updatedAt) }}</span>
    <CustomFieldCell
        v-else-if="column.field"
        :def="column.field"
        :task="task"
        :editable="can('customField')"
        :allTasks="fieldContext.allTasks"
        :defs="fieldContext.defs"
        @change="(value) => edit.setCustomField(task, column.field, value, { row: row() })"
    />
</template>

<script setup>
import { computed, inject, ref, unref } from "vue";
import { useI18n } from "vue-i18n";
import moment from "moment";
import StoryPoints from "@/components/atom/StoryPoints/StoryPoints.vue";
import ListAssigneeCell from "@/views/Projects/ListView/ListAssigneeCell.vue";
import ListDueCell from "@/views/Projects/ListView/ListDueCell.vue";
import ListPriorityCell from "@/views/Projects/ListView/ListPriorityCell.vue";
import EstimateCell from "./EstimateCell.vue";
import CustomFieldCell from "./CustomFieldCell.vue";
import { isClosedTask } from "@/views/Projects/ListView/subtaskProgress";
import { taskPoints } from "@/views/Projects/composables/taskPoints";

defineOptions({ name: "TaskColumnCell" });

const props = defineProps({
    column: { type: Object, required: true },
    task: { type: Object, required: true },
    isSub: { type: Boolean, default: false },
    rowEl: { default: null }
});

const { t } = useI18n();
const edit = inject("listRowEdit", null);
const project = inject("selectedProject", ref({}));
const dateFormat = inject("$dateFormat", ref("DD/MM/YYYY"));

const rights = computed(() => edit?.rights.value || {});
const can = (key) => Boolean(edit) && !props.isSub && rights.value[key] === true;
const done = computed(() => isClosedTask(props.task));
const row = () => unref(props.rowEl);

const fieldContext = computed(() => ({
    allTasks: edit?.fields?.allTasks.value || [],
    defs: edit?.fields?.defs.value || []
}));

const pointsLabel = computed(() => {
    const field = t("ViewColumns.col_points");
    const value = taskPoints(props.task);
    if (can("points")) return value === null ? t("List.cell_set", { field }) : t("List.cell_change", { field, value });
    return value === null ? t("List.cell_none", { field }) : t("List.cell_value", { field, value });
});

function dateText(value) {
    if (!value) return "";
    const date = moment(value?.seconds ? value.seconds * 1000 : value);
    return date.isValid() ? date.format(dateFormat.value) : "";
}
</script>

<style>
.tcc-date { font: var(--text-data); color: var(--ink-2); white-space: nowrap; }
.tcc-points { display: inline-flex; }
.tcc-points .sp-trigger { min-height: 24px; }
</style>
