<template>
    <div v-if="!currentCompany?.planFeature?.tableView">
        <UpgradePlan
            :buttonText="$t('Upgrades.upgrade_your_plan')"
            :lastTitle="$t('conformationmsg.unlock_table_view')"
            :secondTitle="$t('Upgrades.unlimited')"
            :firstTitle="$t('Upgrades.upgrade_to')"
            :message="$t('Upgrades.the_feature_not_available')"
        />
    </div>
    <div v-else class="w-100 ah-page tv2">
        <ListBulkBar v-if="project" :project="project" />
        <div class="tv2__bar">
            <button
                v-if="!searchedTask && canCreate && showArchiveVar === false && createTask === false"
                type="button"
                class="tv2__add"
                @click.stop="createTask = true"
            >+ {{ $t('Projects.new_task') }}</button>
            <span class="tv2__note">{{ $t('ListV2.ai_fields_note') }}</span>
        </div>
        <div v-if="createTask" class="tv2__bar">
            <CreateTask
                :sprint="sprints[0]"
                :assigneeOptions="project.AssigneeUserId"
                :groupBy="grouped"
                :considerWidth="false"
                @cancel="createTask = false"
            />
        </div>

        <div class="tv2__scroll ah-scroll" id="tableview_scroll">
            <div class="tv2__grid">
                <div class="tv2__head">
                    <span></span>
                    <button type="button" class="tv2__sort" @click="sortByColumns(globalSortKey === `TaskName: ${1}` ? `TaskName: ${-1}` : `TaskName: ${1}`)">{{ $t('Projects.tasks') }}</button>
                    <button type="button" class="tv2__sort" @click="sortByColumns(globalSortKey === `statusKey: ${1}` ? `statusKey: ${-1}` : `statusKey: ${1}`)">{{ $t('Projects.status') }}</button>
                    <span>{{ $t('ListV2.col_owner') }}</span>
                    <span class="tv2__head-ai">✦ {{ $t('ListV2.col_summary') }}</span>
                    <span class="tv2__head-ai">✦ {{ $t('ListV2.col_risk') }}</span>
                    <span class="tv2__head-ai">✦ {{ $t('ListV2.col_area') }}</span>
                </div>

                <TableViewTable
                    v-for="item in groupItems"
                    :key="item.key"
                    :data="item"
                    :sprintId="firstSprintId"
                    :group="grouped"
                    :globalSortKey="globalSortKey"
                    :keys="`${item.key}`"
                    @open="openRow"
                />

                <div class="d-flex align-items-center justify-content-center flex-column" v-if="!totalTaskInFirstSprint.length">
                    <EmptyState
                        v-if="project?.deletedStatusKey !== 2"
                        :title="!project?.lastTaskId ? $t('EmptyState.no_tasks_title') : $t('EmptyState.no_match_title')"
                        :message="!project?.lastTaskId ? $t('EmptyState.no_tasks_msg') : $t('EmptyState.no_match_msg')"
                        helpPath="tasks"
                    />
                </div>
            </div>

            <div class="tv2__foot">
                <span>{{ $t('ListV2.ai_source_hint') }}</span>
                <span>{{ $t('ListV2.risk_formula') }}</span>
            </div>
        </div>
    </div>
</template>

<script setup>
// COMPONENTS
import CreateTask from "@/components/atom/CreateTask/CreateTask.vue";
import TableViewTable from './TableViewTable.vue';
import UpgradePlan from '@/components/atom/UpgradYourPlanComponent/UpgradYourPlanComponent.vue';
import EmptyState from '@/components/atom/EmptyState/EmptyState.vue';
import ListBulkBar from '@/views/Projects/ListView/ListBulkBar.vue';

// UTILS
import { useCustomComposable } from "@/composable";
import isEqual from 'lodash/isEqual';
import { taskListHelper } from '@/views/Projects/helper.js';
import { openTask } from '@/components/organisms/TaskDetailOverlay/useTaskOverlay';

// PACKAGES
import { useStore } from 'vuex';
import { computed, inject, onMounted, ref, watch } from "vue";

defineOptions({ name: "ProjectTableView" });

const { groupBy } = taskListHelper();
const { getters } = useStore();
const { checkPermission } = useCustomComposable();

const props = defineProps({
    grouped: { type: Number, default: 0 },
    projectData: { type: Object, default: () => ({}) },
    commonDateFormatForDate: { type: String, default: "DD/MM/YYYY" },
    sprints: { type: Array, default: () => [] },
    calendarDate: { type: [String, Number], default: "" },
    billingPeriod: { type: String, default: '' },
    data: { type: String, default: '' },
    userIds: { type: Array, default: () => [] },
    startDate: { type: Object, default: () => ({}) },
    watchers: { type: Object, default: () => ({}) },
    checklistArray: { type: Array, default: () => [] },
    isvisible: { type: Boolean, default: true },
    title: { type: String, default: '' },
    class: { type: String, default: '' }
});
defineEmits(["openSeeAllProject"]);

const project = inject('selectedProject');
const companyId = inject('$companyId');
const searchedTask = inject('searchedTask');
const showArchiveVar = inject("showArchived");

const createTask = ref(false);
const globalSortKey = ref('');
const groupedTasks = ref([]);

const taskData = computed(() => getters["projectData/tableTasks"]);
const currentCompany = computed(() => getters["settings/selectedCompany"]);
const canCreate = computed(() => checkPermission('task.task_create', project.value?.isGlobalPermission) === true
    && checkPermission('task.task_list', project.value?.isGlobalPermission) === true);

const firstSprintId = computed(() => props.sprints[0]?.id || props.sprints[0]?._id || "");
const groupItems = computed(() => groupedTasks.value[0]?.items || []);

const totalTaskInFirstSprint = computed(() => {
    const sprintTasks = getters['projectData/tableTasks']?.[props.projectData?._id]?.[firstSprintId.value];
    return sprintTasks?.tasks || [];
});

function load(refetch) {
    if (!project.value || !Object.keys(project.value).length) return;
    groupBy(props.grouped, refetch, project.value, props.sprints, groupedTasks, true, 'table', null, true, (resp) => {
        groupedTasks.value = resp;
    });
}

watch([() => props.grouped, () => props.sprints, taskData], ([newGroup, newSprints], [oldGroup, oldSprints]) => {
    load(!isEqual(newGroup, oldGroup) || JSON.stringify(newSprints) !== JSON.stringify(oldSprints));
});

/* Projects.vue mounts the legacy bottom bulk bar for every view; the redesigned
   views carry their own, so the old one is hidden while they are on screen. */
onMounted(() => {
    load(true);
});

function openRow(task) {
    openTask({
        companyId: companyId.value,
        projectId: project.value?._id,
        sprintId: task.sprintId,
        folderId: task.folderObjId || '',
        taskId: task._id
    });
}

const sortByColumns = (sortKey = "") => {
    globalSortKey.value = sortKey;
};
</script>
<style>
@import './style.css';
</style>
