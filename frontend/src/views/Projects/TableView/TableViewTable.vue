<template>
    <div v-if="tasks.length || isLoading">
        <div class="tv2__group">
            <label v-if="canGroupSelect && groupTaskIds.length" @click.stop>
                <input
                    type="checkbox"
                    class="ah-check"
                    :checked="groupCheckboxState === 'all'"
                    :indeterminate.prop="groupCheckboxState === 'some'"
                    :aria-label="$t('List.select_group')"
                    @click.stop
                    @change="selection.toggleGroup(groupTaskIds)"
                />
            </label>
            <span class="tv2__group-chip" :style="chipStyle">{{ groupLabel }}</span>
            <span class="tv2__group-count">{{ tasks.length }}</span>
        </div>

        <template v-if="!isLoading">
            <TableRow
                v-for="task in tasks"
                :key="task._id"
                :data="task"
                :selected="selection.isSelected(task._id)"
                :can-select="canGroupSelect"
                @open="$emit('open', $event)"
                @select="(row, event) => selection.toggleAndCascade(row, event)"
            />
        </template>
        <template v-else>
            <Skelaton v-for="i in 4" :key="i" class="tv2__skeleton" />
        </template>

        <div :id="`table_list_item_${sprintId}_${data.key}`" class="tv2__sentinel"></div>
    </div>
</template>

<script setup>
import { computed, inject, onMounted, onUnmounted, ref, watch } from "vue";
import { useStore } from "vuex";
import TableRow from "./TableRow.vue";
import Skelaton from "@/components/atom/Skelaton/Skelaton.vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { useCustomComposable, useGetterFunctions } from "@/composable";
import { taskListHelper } from "@/views/Projects/helper.js";
import { useTaskSelection } from "@/composable/useTaskSelection.js";

defineOptions({ name: "TableViewTable" });

const props = defineProps({
    data: { type: Object, required: true },
    group: { type: Number, default: 0 },
    sprintId: { type: String, default: "" },
    globalSortKey: { type: String, default: "" },
    keys: { type: String, default: "" }
});
defineEmits(["open"]);

const { getters, dispatch } = useStore();
const { checkPermission } = useCustomComposable();
const { getUser } = useGetterFunctions();
const { checkCase } = taskListHelper();
const selection = useTaskSelection();

const project = inject("selectedProject");
const companyId = inject("$companyId");
const userId = inject("$userId");
const searchedTask = inject("searchedTask");
const showArchivedInj = inject("showArchived", null);

const permit = checkPermission("task.show_tasks", project?.value?.isGlobalPermission);
const isLoading = ref(false);
const observerRef = ref(null);

selection.setActiveView("table");
watch(() => project.value?._id, (newId) => {
    if (newId) selection.setActiveProject(String(newId));
}, { immediate: true });

const canGroupSelect = computed(() => checkPermission("task.task_status", project.value?.isGlobalPermission) === true && !showArchivedInj?.value);

function matches(task) {
    const { searchKey, searchValue, operation, value } = props.data;
    if (searchKey === "DueDate") {
        return task.DueDate ? checkCase(operation, searchValue, new Date(task.DueDate).getTime() / 1000) : operation === "non";
    }
    if (searchKey === "AssigneeUserId") {
        return [...(task.AssigneeUserId || [])].sort().join("_") === value;
    }
    return task[searchKey] === searchValue;
}

const storeTasks = computed(() => {
    if (searchedTask?.value) {
        return (getters["projectData/searchedTasks"] || []).filter((task) => task.sprintId === props.sprintId);
    }
    return getters["projectData/tableTasks"]?.[project.value?._id]?.[props.sprintId]?.tasks || [];
});

const tasks = computed(() => storeTasks.value
    .filter((task) => !task?.deletedStatusKey && matches(task))
    .sort((a, b) => (props.globalSortKey ? 0 : a[props.data.indexName] - b[props.data.indexName])));

const groupTaskIds = computed(() => tasks.value.map((task) => String(task._id)).filter(Boolean));
const groupCheckboxState = computed(() => selection.groupState(groupTaskIds.value));

const groupLabel = computed(() => {
    if (props.data.searchKey === "AssigneeUserId") {
        const users = (props.data.users || []).map((user) => user?.Employee_Name || getUser(user)?.Employee_Name).filter(Boolean);
        return users.length ? users.join(", ") : props.data.name;
    }
    return props.data.name;
});
const chipStyle = computed(() => (props.data.bgColor
    ? { background: props.data.bgColor, color: props.data.textColor }
    : {}));

function addIntersections() {
    setTimeout(() => {
        const options = { root: document.getElementById("tableview_scroll"), rootMargin: "0px", threshold: 0 };
        const obs = new IntersectionObserver((entries) => {
            if (!entries[0].isIntersecting) return;
            dispatch("projectData/setTableTasksFromTypesense", {
                cid: companyId.value,
                pid: project.value._id,
                sprintId: props.sprintId,
                item: JSON.parse(JSON.stringify(props.data)),
                userId: userId.value,
                fetchNew: true,
                resetTable: null,
                sortKey: props.globalSortKey,
                isFirst: false,
                showAllTasks: project.value.isGlobalPermission === false ? permit : true
            });
        }, options);
        const target = document.getElementById(`table_list_item_${props.sprintId}_${props.data.key}`);
        if (target) obs.observe(target);
        observerRef.value = obs;
    });
}

watch(() => props.globalSortKey, () => {
    if (observerRef.value) observerRef.value.disconnect();
    dispatch("projectData/setTableTasksFromTypesense", {
        cid: companyId.value,
        pid: project.value._id,
        sprintId: props.sprintId,
        item: props.data,
        fetchNew: true,
        resetTable: null,
        userId: userId.value,
        sortKey: props.globalSortKey,
        isFirst: true,
        showAllTasks: project.value.isGlobalPermission === false ? permit : true
    }).then(addIntersections);
});

/* Rows created before the group index existed have no sort index; the server
 * backfills one so ordering and drag targets stay stable. */
function prepareIndexData() {
    const withoutIndex = tasks.value.filter((task) => (task[props.data.indexName] === undefined || task[props.data.indexName] === null) && task.TaskKey !== "--");
    if (!withoutIndex.length) return;

    if (withoutIndex.length > 1) isLoading.value = true;

    const rows = withoutIndex.map((task) => ({ data: task._id, item: props.data, taskKey: task.TaskKey }));
    const next = (index) => {
        if (index >= rows.length) {
            isLoading.value = false;
            return;
        }
        apiRequest("post", env.ONLOAD_UPDATE_TASK_INDEX, { taskUpdate: rows[index], companyId: companyId.value })
            .then(() => next(index + 1))
            .catch((error) => {
                console.error("ERROR in update task index: ", error);
                next(index + 1);
            });
    };
    next(0);
}

onMounted(() => {
    if (observerRef.value) observerRef.value.disconnect();
    addIntersections();
    prepareIndexData();
});
onUnmounted(() => {
    if (observerRef.value) observerRef.value.disconnect();
});
</script>
