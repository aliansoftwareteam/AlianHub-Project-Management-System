<template>
    <div class="lv2__group" role="rowgroup">
        <div role="row" class="lv2__aria-row"><div role="rowheader" class="lv2__aria-row">
        <button type="button" class="lv2__group-head" :aria-expanded="!!item.isExpanded" @click="$emit('toggle')">
            <span class="lv2__caret" :class="{ 'lv2__caret--open': item.isExpanded }" aria-hidden="true">▸</span>
            <span class="lv2__swatch" :style="{ background: swatch }"></span>
            <span class="lv2__group-name">{{ groupName }}</span>
            <span class="lv2__group-meta">{{ headMeta }}</span>
            <span v-if="wip" class="lv2__wip" :class="{ 'lv2__wip--over': wip.over }">{{ $t('List.wip', { used: wip.used, limit: wip.limit }) }}</span>
        </button>
        </div></div>

        <template v-if="item.isExpanded">
            <draggable
                :list="rows"
                handle=".draggable_icon"
                item-key="_id"
                tag="div"
                role="presentation"
                :group="{ name: 'lv2-task' }"
                :sortable="canDrag"
                :disabled="!canDrag"
                @change="onDragChange"
            >
                <template #item="{ element: task }">
                    <div role="presentation">
                        <ListRow
                            :data="task"
                            :selected="selection.isSelected(task._id)"
                            :expanded="isExpanded(task._id)"
                            :progress="progressFor(task._id)"
                            :can-select="canSelect"
                            :can-set-status="canSetStatus"
                            :run="agents.runFor(task._id)"
                            :proposal="agents.proposalFor(task._id)"
                            @open="$emit('open', task)"
                            @select="onSelect"
                            @toggle-subtasks="toggleSubtasks(task)"
                            @review-agent="$emit('review-agent', $event)"
                            @add-subtask="startSubtask(task)"
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
                        <div v-if="subtaskFor === String(task._id)" role="row" class="lv2__aria-row"><div role="cell" class="lv2__create lv2__create--sub">
                            <CreateTask
                                :sprint="{ ...task.sprintArray, id: task.sprintId, folderId: task.folderObjId }"
                                :taskId="task._id"
                                :assigneeOptions="subtaskAssignees(task)"
                                :considerWidth="false"
                                @cancel="subtaskFor = ''"
                            />
                        </div></div>
                    </div>
                </template>
            </draggable>

            <div v-if="!rows.length" role="row" class="lv2__aria-row"><div role="cell" class="lv2__aria-row">
                <p class="lv2__empty-group">{{ $t('List.group_empty') }}</p>
            </div></div>

            <div v-if="creating" role="row" class="lv2__aria-row"><div role="cell" class="lv2__create">
                <CreateTask
                    :sprint="sprint"
                    :assigneeOptions="project.AssigneeUserId"
                    :groupBy="groupType"
                    :groupType="groupType"
                    :considerWidth="false"
                    @cancel="creating = false"
                    @submit="onCreated"
                />
            </div></div>
            <div v-else-if="canCreate" role="row" class="lv2__aria-row"><div role="cell" class="lv2__aria-row">
                <button type="button" class="lv2__add" @click="creating = true">
                    <span class="lv2__add-plus">+</span>{{ $t('List.add_task_to', { group: groupName }) }}
                </button>
            </div></div>
        </template>
    </div>
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
import { hasSubtasks, indexProgress, pendingExpandIds, progressQuery, progressSignature } from "./subtaskProgress";
import { groupLabel, groupRows, listSourceTasks, searchExpandIds } from "./listFilter";
import { apiRequest } from "@/services";
import { subtaskCreateAssignees } from "@/utils/assigneeOptions";
import * as env from "@/config/env";

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
const { getSprintTasks } = taskListHelper();
const { updateTaskByGroup } = useUpdateTasks();
const selection = useTaskSelection();
const agents = useProjectAgentActivity();
const { applyDrag } = useListDragDrop();
const showArchived = inject("showArchived", ref(false));
const searchedTask = inject("searchedTask", ref(false));
const taskCollapsed = inject("taskCollapsed", ref(true));

const creating = ref(false);
const expandedIds = ref([]);
const subtaskFor = ref("");

const sprintId = computed(() => props.sprint?.id || props.sprint?._id);
const canCreate = computed(() => !showArchived.value
    && !searchedTask.value
    && checkPermission("task.task_create", props.project?.isGlobalPermission) === true
    && checkPermission("task.task_list", props.project?.isGlobalPermission) === true);
const canSelect = computed(() => !showArchived.value && checkPermission("task.task_status", props.project?.isGlobalPermission) === true);
const canSetStatus = canSelect;
const canDrag = computed(() => canSelect.value && !searchedTask.value && props.item.value !== "NO_DUE_DATE" && props.item.value !== "NEXT");

const storeTasks = computed(() => getters["projectData/tasks"]?.[props.project._id]?.[sprintId.value]?.tasks || []);
const sourceTasks = computed(() => listSourceTasks({
    searched: searchedTask.value,
    searchedTasks: getters["projectData/searchedTasks"],
    storeTasks: storeTasks.value,
    sprintId: sprintId.value
}));
const found = computed(() => (searchedTask.value
    ? null
    : getters["projectData/tasks"]?.[props.project._id]?.[sprintId.value]?.found?.[`${props.item.searchKey}_${props.item.searchValue}`] ?? null));

const groupTasks = computed(() => groupRows(sourceTasks.value, props.item, showArchived.value));

const rows = ref([]);
watch(groupTasks, (value) => { rows.value = [...value]; }, { immediate: true, deep: true });

const groupName = computed(() => groupLabel(props.item));
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

const subtaskCounts = ref({});
const progressFor = (taskId) => subtaskCounts.value[String(taskId)] || null;

function loadSubtaskCounts() {
    const ids = rows.value.filter(hasSubtasks).map((task) => String(task._id));
    if (!ids.length) return;
    apiRequest("post", `${env.TASK}/find`, { findQuery: progressQuery(ids) })
        .then((response) => { subtaskCounts.value = { ...subtaskCounts.value, ...indexProgress(response?.data) }; })
        .catch((error) => console.error("ERROR in list subtask progress: ", error));
}
watch(() => progressSignature(rows.value), loadSubtaskCounts, { immediate: true });

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

/* The toolbar's expand / collapse control drives every row at once, and has to keep doing
 * so for rows that arrive later -- a group opened after the toggle was flipped loads its
 * tasks only then. */
const autoExpandedIds = ref([]);
watch([taskCollapsed, rows], () => {
    if (searchedTask.value) {
        expandedIds.value = [...new Set([...expandedIds.value, ...searchExpandIds(rows.value)])];
        return;
    }
    if (taskCollapsed.value) {
        expandedIds.value = [];
        autoExpandedIds.value = [];
        return;
    }
    const pending = pendingExpandIds(rows.value, autoExpandedIds.value);
    if (!pending.length) return;
    autoExpandedIds.value = [...autoExpandedIds.value, ...pending];
    expandedIds.value = [...new Set([...expandedIds.value, ...pending])];
    rows.value.filter((task) => pending.includes(String(task._id))).forEach(loadSubtasks);
}, { immediate: true });

/* A searched parent carries only its matching subtasks; when none matched, expanding it
   shows the full set loaded into the sprint's own copy of the task. */
function subtasksOf(task) {
    if (task.subtaskArray?.length || !searchedTask.value) return task.subtaskArray || [];
    return storeTasks.value.find((stored) => stored._id === task._id)?.subtaskArray || [];
}

function visibleSubtasks(task) {
    return subtasksOf(task).filter((sub) => (showArchived.value ? sub.deletedStatusKey === 2 : !sub.deletedStatusKey));
}

const companyUsers = computed(() => (getters["settings/companyUsers"] || []).map((x) => x.userId));
const subtaskAssignees = (task) => subtaskCreateAssignees({ parent: task, project: props.project, companyUsers: companyUsers.value });

function startSubtask(task) {
    const id = String(task._id);
    if (!isExpanded(id)) toggleSubtasks(task);
    subtaskFor.value = id;
}

function onSelect(task, event) {
    selection.selectFromEvent(task, event, ".lv2");
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
    const created = payload?.data;
    if (!created) return;
    if (props.groupType === 0 && created.statusKey !== props.item.key) {
        updateTaskByGroup({ ...created, _id: created._id }, props.item, 0).catch((error) => console.error("ERROR in list inline add: ", error));
    }
}
</script>
