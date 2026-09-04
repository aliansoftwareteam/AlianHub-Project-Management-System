<template>
    <section class="lv2__group">
        <button type="button" class="lv2__group-head" @click="$emit('toggle')">
            <span class="lv2__caret" :class="{ 'lv2__caret--open': item.isExpanded }">▸</span>
            <span class="lv2__swatch" :style="{ background: swatch }"></span>
            <span class="lv2__group-name">{{ groupName }}</span>
            <span class="lv2__group-meta">{{ headMeta }}</span>
            <span v-if="wip" class="lv2__wip" :class="{ 'lv2__wip--over': wip.over }">{{ $t('List.wip', { used: wip.used, limit: wip.limit }) }}</span>
        </button>

        <template v-if="item.isExpanded">
            <draggable
                :list="rows"
                handle=".draggable_icon"
                item-key="_id"
                tag="div"
                :group="{ name: 'lv2-task' }"
                :sortable="canDrag"
                :disabled="!canDrag"
                @change="onDragChange"
            >
                <template #item="{ element: task }">
                    <div>
                        <ListRow
                            :data="task"
                            :selected="selection.isSelected(task._id)"
                            :expanded="isExpanded(task._id)"
                            :can-select="canSelect"
                            :can-set-status="canSetStatus"
                            :run="agents.runFor(task._id)"
                            :proposal="agents.proposalFor(task._id)"
                            @open="$emit('open', task)"
                            @select="onSelect"
                            @toggle-subtasks="toggleSubtasks(task)"
                            @review-agent="$emit('review-agent', $event)"
                        />
                        <template v-if="isExpanded(task._id)">
                            <ListRow
                                v-for="sub in visibleSubtasks(task)"
                                :key="sub._id"
                                :data="sub"
                                is-sub
                                :can-set-status="canSetStatus"
                                @open="$emit('open', sub)"
                                @toggle-done="toggleDone"
                            />
                        </template>
                    </div>
                </template>
            </draggable>

            <p v-if="!rows.length" class="lv2__empty-group">{{ $t('List.group_empty') }}</p>

            <div v-if="creating" class="lv2__create">
                <CreateTask
                    :sprint="sprint"
                    :assigneeOptions="project.AssigneeUserId"
                    :groupBy="groupType"
                    :groupType="groupType"
                    :considerWidth="false"
                    @cancel="creating = false"
                    @submit="onCreated"
                />
            </div>
            <button v-else-if="canCreate" type="button" class="lv2__add" @click="creating = true">
                <span class="lv2__add-plus">+</span>{{ $t('List.add_task_to', { group: groupName }) }}
            </button>
        </template>
    </section>
</template>

<script setup>
import { computed, inject, ref, watch } from "vue";
import { useStore } from "vuex";
import draggable from "vuedraggable";
import ListRow from "./ListRow.vue";
import CreateTask from "@/components/atom/CreateTask/CreateTask.vue";
import { useCustomComposable } from "@/composable";
import { taskListHelper, useUpdateTasks } from "@/views/Projects/helper.js";
import { useTaskSelection } from "@/composable/useTaskSelection.js";
import { useListDragDrop } from "./useListDragDrop.js";
import { useProjectAgentActivity } from "./useProjectAgentActivity.js";

defineOptions({ name: "ListGroup" });

const props = defineProps({
    item: { type: Object, required: true },
    sprint: { type: Object, required: true },
    project: { type: Object, required: true },
    groupType: { type: Number, default: 0 }
});
defineEmits(["toggle", "open", "review-agent"]);

const { getters } = useStore();
const { checkPermission } = useCustomComposable();
const { checkCase, getSprintTasks } = taskListHelper();
const { updateTaskByGroup } = useUpdateTasks();
const selection = useTaskSelection();
const agents = useProjectAgentActivity();
const { applyDrag } = useListDragDrop();
const showArchived = inject("showArchived", ref(false));
const searchedTask = inject("searchedTask", ref(false));
const taskCollapsed = inject("taskCollapsed", ref(true));

const creating = ref(false);
const expandedIds = ref([]);

const sprintId = computed(() => props.sprint?.id || props.sprint?._id);
const canCreate = computed(() => !showArchived.value
    && !searchedTask.value
    && checkPermission("task.task_create", props.project?.isGlobalPermission) === true
    && checkPermission("task.task_list", props.project?.isGlobalPermission) === true);
const canSelect = computed(() => !showArchived.value && checkPermission("task.task_status", props.project?.isGlobalPermission) === true);
const canSetStatus = canSelect;
const canDrag = computed(() => canSelect.value && !searchedTask.value && props.item.value !== "NO_DUE_DATE" && props.item.value !== "NEXT");

const storeTasks = computed(() => getters["projectData/tasks"]?.[props.project._id]?.[sprintId.value]?.tasks || []);
const found = computed(() => getters["projectData/tasks"]?.[props.project._id]?.[sprintId.value]?.found?.[`${props.item.searchKey}_${props.item.searchValue}`] ?? null);

const groupTasks = computed(() => {
    const item = props.item;
    const all = storeTasks.value.filter((task) => (showArchived.value ? task.deletedStatusKey === 2 : !task.deletedStatusKey));
    if (item.searchKey === "DueDate") {
        return all
            .filter((task) => (task.DueDate ? checkCase(item.operation, item.searchValue, new Date(task.DueDate).getTime() / 1000) : item.operation === "non"))
            .sort((a, b) => a.groupByDueDateIndex - b.groupByDueDateIndex);
    }
    if (item.searchKey === "AssigneeUserId") {
        return all
            .filter((task) => [...(task.AssigneeUserId || [])].sort((a, b) => (a > b ? 1 : -1)).join("_") === item.value)
            .sort((a, b) => a.groupByAssigneeIndex - b.groupByAssigneeIndex);
    }
    return all
        .filter((task) => task[item.searchKey] === item.searchValue)
        .sort((a, b) => a[item.indexName] - b[item.indexName]);
});

const rows = ref([]);
watch(groupTasks, (value) => { rows.value = [...value]; }, { immediate: true, deep: true });

const groupName = computed(() => {
    if (props.item.searchKey !== "AssigneeUserId") return props.item.name;
    const users = props.item.users || [];
    return users.length ? users.map((user) => user.Employee_Name).join(", ") : props.item.name;
});
const swatch = computed(() => props.item.textColor || "var(--ink-3)");

const estimateHours = computed(() => {
    const minutes = rows.value.reduce((total, task) => total + (Number(task.totalEstimatedTime) || 0), 0);
    return minutes ? Math.round(minutes / 60) : 0;
});
const headMeta = computed(() => {
    const count = found.value === null ? rows.value.length : found.value;
    return estimateHours.value ? `${count} · ${estimateHours.value}H` : String(count);
});

/* WIP limits are per status and optional: the chip only exists once a status
 * carries a limit, never as a guessed number. */
const wip = computed(() => {
    if (props.item.searchKey !== "statusKey") return null;
    const limit = Number(props.item.wipLimit ?? props.project?.wipLimits?.[props.item.key]) || 0;
    if (!limit) return null;
    const used = found.value === null ? rows.value.length : found.value;
    return { used, limit, over: used > limit };
});

const isExpanded = (taskId) => expandedIds.value.includes(String(taskId));
const hasSubtasks = (task) => Boolean(task.isParentTask && (task.subtaskArray?.length || Number(task.subTasks)));

function loadSubtasks(task) {
    if (task.subtaskArray?.length) return;
    getSprintTasks({
        projectId: props.project._id,
        sprintId: sprintId.value,
        item: props.item,
        fetchNew: true,
        projectData: props.project,
        parentId: task._id
    });
}

function toggleSubtasks(task) {
    const id = String(task._id);
    if (isExpanded(id)) {
        expandedIds.value = expandedIds.value.filter((x) => x !== id);
        return;
    }
    expandedIds.value = [...expandedIds.value, id];
    loadSubtasks(task);
}

/* The toolbar's expand / collapse control drives every row at once. */
watch(taskCollapsed, (collapsed) => {
    if (searchedTask.value) return;
    if (collapsed) {
        expandedIds.value = [];
        return;
    }
    const parents = rows.value.filter(hasSubtasks);
    expandedIds.value = parents.map((task) => String(task._id));
    parents.forEach(loadSubtasks);
});

function visibleSubtasks(task) {
    return (task.subtaskArray || []).filter((sub) => (showArchived.value ? sub.deletedStatusKey === 2 : !sub.deletedStatusKey));
}

function onSelect(task, event) {
    selection.toggleAndCascade(task, event);
}

function toggleDone(task, done) {
    const statuses = props.project?.taskStatusData || [];
    const next = done ? statuses.find((s) => s.type === "close") : statuses.find((s) => s.type === "default_active") || statuses.find((s) => s.type !== "close");
    if (!next) return;
    updateTaskByGroup(task, next, 0).catch((error) => console.error("ERROR in list subtask status: ", error));
}

function onDragChange(event) {
    applyDrag({ event, item: props.item, groupType: props.groupType, rows: rows.value, project: props.project });
}

function onCreated(payload) {
    creating.value = false;
    const created = payload?.data;
    if (!created) return;
    if (props.groupType === 0 && created.statusKey !== props.item.key) {
        updateTaskByGroup({ ...created, _id: created._id }, props.item, 0).catch((error) => console.error("ERROR in list inline add: ", error));
    }
}
</script>
