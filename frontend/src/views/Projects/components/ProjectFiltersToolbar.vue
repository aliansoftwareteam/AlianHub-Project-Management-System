<template>
    <div class="task-assigneesearch-groupbywrapper pft" :class="{ 'pft--search-open': searchOpen, 'pft--phone': sheetMode }">
        <div class="d-flex align-items-center justify-content-between flex-wrap task-filtersearchassignee-wrapper" :class="{'w-545' : clientWidth <=767 }" v-if="['ProjectListView', 'Calendar', 'ProjectKanban','TableView'].includes(activeTab)">
            <div class="d-flex align-items-center justify-content-start task-filtersearch" :class="[{ 'mb-10px': clientWidth <= 767 }]">
                <TaskFilter :projectData="projectData" @apply="onApplyFilter" @clear="onClearFilter" v-if="!sheetMode && Object.keys(projectData).length > 0"/>
                <button type="button" class="pft__search-toggle" :aria-label="$t('PlaceHolder.search')" :aria-expanded="searchOpen" @click="searchOpen = !searchOpen">
                    <ShellIcon name="search" :size="15" />
                </button>
                <div class="position-re task-fitler-search pft__search" id="projectviewfiltersearch_driver">
                    <ShellIcon name="search" :size="14" class="pft__search-icon" />
                    <input
                        type="text"
                        :placeHolder="$t('PlaceHolder.search')"
                        :aria-label="$t('PlaceHolder.search')"
                        class="form-control pft__input"
                        :value="taskSearch"
                        @input="$emit('update:taskSearch', $event.target.value)"
                    >
                    <DropDown mode="listbox" :title="$t('Projects.search_in')" id="searchfilterdropdownoptions_driver" class="position-ab dropdown-image-horizontal" :bodyClass="{'search__in-dropdown' : true}">
                        <template #head>
                            <h4 class="black font-size-13 font-weight-500 p-10px m-0 search__in" :class="{'border-bottom': clientWidth > 767}">
                                {{ $t('Projects.search_in') }}
                            </h4>
                        </template>
                        <template #button="{ triggerAttrs }">
                            <button type="button" class="pft__search-scope" :title="$t('Projects.search_in')" :aria-label="$t('Projects.search_in')" v-bind="triggerAttrs">
                                <ShellIcon name="chevronDown" :size="13" />
                            </button>
                        </template>
                        <template #options>
                            <DropDownOption :selected="taskNameSearch" @click="taskDescriptionSearch || taskKeySearch ? $emit('update:taskNameSearch', !taskNameSearch) : ''" class="task-serachstatus-dropdown border-radius-4-px">
                                <span class="project-mobile-desc mr-10px">{{ $t('Projects.task_name') }}</span>
                                <Toggle width="20" :modelValue="taskNameSearch" @update:modelValue="(v) => $emit('update:taskNameSearch', v)" :disabled="taskNameSearch && !taskDescriptionSearch && !taskKeySearch" @change="$emit('search')"/>
                            </DropDownOption>
                            <DropDownOption :selected="taskKeySearch" @click="$emit('update:taskKeySearch', !taskKeySearch)" class="task-serachstatus-dropdown border-radius-4-px">
                                <span class="project-mobile-desc mr-10px">{{ $t('Projects.task_key') }}</span>
                                <Toggle width="20" :modelValue="taskKeySearch" @update:modelValue="(v) => $emit('update:taskKeySearch', v)" @change="$emit('toggleSearch'),$emit('search')"/>
                            </DropDownOption>
                            <DropDownOption :selected="taskDescriptionSearch" @click="$emit('update:taskDescriptionSearch', !taskDescriptionSearch)" class="task-serachstatus-dropdown border-radius-4-px">
                                <span class="project-mobile-desc mr-10px">{{ $t('ProjectDetails.description') }}</span>
                                <Toggle width="20" :modelValue="taskDescriptionSearch" @update:modelValue="(v) => $emit('update:taskDescriptionSearch', v)" @change="$emit('toggleSearch'),$emit('search')"/>
                            </DropDownOption>
                        </template>
                    </DropDown>
                </div>
                <button
                    v-if="sheetMode"
                    type="button"
                    class="pft__filters-btn"
                    data-test="filters-button"
                    aria-haspopup="dialog"
                    :aria-expanded="String(filtersOpen)"
                    :aria-label="activeFilterCount ? $t('Projects.filters_active', { n: activeFilterCount }) : $t('Projects.filters')"
                    @click="filtersOpen = true"
                >
                    <span>{{ $t('Projects.filters') }}</span>
                    <span v-if="activeFilterCount" class="pft__filters-count" aria-hidden="true">{{ activeFilterCount }}</span>
                </button>
                <Assignee
                    :tourId="'projectviewassignee_driver'"
                    v-if="clientWidth > 767 && projectData?.isPrivateSpace"
                    class="assignee-data ml-15px"
                    :users="projectData.AssigneeUserId"
                    :options="[...users.map((x) => x._id), ...teams.map((x) => 'tId_'+x._id)]"
                    :imageWidth="clientWidth>1024 ? '30px' : '25px'"
                    :num-of-users="clientWidth>1024 ? 4 : 2"
                    :showAddUser="true"
                    :addUser="checkPermission('project.project_assignee',projectData.isGlobalPermission) === true"
                    @selected="$emit('changeAssignee', 'add', $event)"
                    @removed="$emit('changeAssignee', 'remove', $event)"
                    :isDisplayTeam="true"
                />
            </div>
            <component :is="sheetMode ? ProjectFiltersSheet : InPlace" v-model:open="filtersOpen">
            <div v-if="isListLike" class="d-flex align-items-center justify-content-end task-filter-assignee" :class="clientWidth <= 767 ? 'justify-content-start' : ''">
                <TaskFilter :projectData="projectData" @apply="onApplyFilter" @clear="onClearFilter" v-if="sheetMode && Object.keys(projectData).length > 0"/>
                <template v-if="!showArchived">
                    <button
                        type="button"
                        class="ai_button pft__icon-btn cursor-pointer"
                        :title="$t('AI.write_with_ai')"
                        :aria-label="$t('AI.write_with_ai')"
                        @click="$emit('openAi')"
                        v-if="canUseAi({ project: projectData, permitted: checkPermission('artificial_intelligence',projectData?.isGlobalPermission) === true })"
                    >
                        <ShellIcon name="ai" :size="15" />
                    </button>
                    <DropDown mode="listbox" id="group_by" class="group_by" :title="$t('Projects.group_by')" :zIndex="sheetMode ? SHEET_MENU_Z : 7">
                        <template #button="{ triggerAttrs }">
                            <button type="button" class="text-nowrap btn-white border-groupBy pft__pill cursor-pointer" ref="group_by_status" :title="$t('Projects.group_by')" :aria-label="$t('Projects.group_by')" v-bind="triggerAttrs">
                                <ShellIcon name="layout" :size="14" />
                                <span>{{ $t(`Projects.${groupByOptions.find(x => x.id === groupBy).label}`) }}</span>
                            </button>
                        </template>
                        <template #options>
                            <DropDownOption v-for="item in groupByOptions" :key="item.id" :selected="item.id === groupBy" @click="$emit('update:groupBy', item.id); $refs.group_by_status.click()" :class="{'bg-light-gray' : item.id === groupBy}">
                                <div>
                                    <img :src="item.image" alt="" class="pr-10px">
                                    <span :class="{'purple' : item.id === groupBy}">{{ $t(`Projects.${item.label}`) }}</span>
                                </div>
                            </DropDownOption>
                        </template>
                    </DropDown>
                    <button
                        type="button"
                        v-if="activeTab === 'ProjectListView'"
                        class="border-groupBy pft__icon-btn current__dropdown cursor-pointer"
                        :title="collapsed ? $t('Projects.expand_subtasks') : $t('Projects.collapse_subtasks')"
                        :aria-label="collapsed ? $t('Projects.expand_subtasks') : $t('Projects.collapse_subtasks')"
                        @click="$emit('update:collapsed', !collapsed)"
                    >
                        <ShellIcon :name="collapsed ? 'expand' : 'minimize'" :size="14" />
                    </button>
                    <div class="border-groupBy d-flex align-items-center assignee-filter manage__filter-users">
                        <button
                            type="button"
                            @click="$emit('manageFilterUsers', userId)"
                            :class="{'is-active' : filterUsers.includes(userId)}"
                            :aria-pressed="filterUsers.includes(userId)"
                            class="cursor-pointer assignee-user"
                        >
                            <ShellIcon name="user" :size="14" />
                            <span>{{ $t('Projects.me') }}</span>
                        </button>
                        <button
                            type="button"
                            v-if="projectData?.isGlobalPermission === false ? checkPermission('task.show_tasks',projectData.isGlobalPermission) === 2 || checkPermission('task.show_tasks',projectData.isGlobalPermission) === true : true"
                            @click="filtersOpen = false; $emit('update:userSidebar', !userSidebar)"
                            class="cursor-pointer assignee-status"
                            :class="{'is-active' : assigneeFilterCount}"
                            :title="assigneeFilterCount ? $t('Projects.assignee_count', { n: assigneeFilterCount }) : $t('ProjectDetails.assignee')"
                            :aria-label="assigneeFilterCount ? $t('Projects.assignee_count', { n: assigneeFilterCount }) : $t('ProjectDetails.assignee')"
                        >
                            <ShellIcon name="users" :size="14" />
                            <span v-if="assigneeFilterCount" class="pft__count">{{ assigneeFilterCount }}</span>
                        </button>
                    </div>
                    <ProvenanceFilter :modelValue="doneBy" @update:modelValue="(v) => $emit('update:doneBy', v)" />
                </template>
                <span v-else class="pft__mode-chip">{{ $t('ProjectSlider.archived_list') }}</span>
                <DropDown mode="menu" id="more_features" :title="$t('Projects.more_features')" :zIndex="sheetMode ? SHEET_MENU_Z : 10">
                    <template #button="{ triggerAttrs }">
                        <button type="button" class="border-groupBy pft__icon-btn cursor-pointer" :title="$t('Projects.more_features')" :aria-label="$t('Projects.more_features')" v-bind="triggerAttrs">
                            <ShellIcon name="dots" :size="15" />
                        </button>
                    </template>
                    <template #options>
                        <template v-for="(group, gi) in moreGroups" :key="group.key">
                            <div v-if="gi" class="ah-pop__sep" role="separator"></div>
                            <div class="ah-label ah-pop__label">{{ $t(`Projects.menu_${group.key}`) }}</div>
                            <DropDownOption v-for="item in group.items" :key="item.key" @click="filtersOpen = false; item.open()">
                                <div><span class="dropdown-label">{{ $t(item.label) }}</span></div>
                            </DropDownOption>
                        </template>
                    </template>
                </DropDown>
            </div>
            </component>
            <div v-if="['Calendar'].includes(activeTab)" class="d-flex align-items-center justify-content-end task-filter-assignee" :class="clientWidth <= 767 ? 'justify-content-start' : ''">
                <div class="border-groupBy d-flex align-items-center assignee-filter manage__filter-users">
                    <button
                        type="button"
                        @click="$emit('manageFilterUsers', userId)"
                        :class="{'is-active' : filterUsers.includes(userId)}"
                        :aria-pressed="filterUsers.includes(userId)"
                        class="cursor-pointer assignee-user"
                    >
                        <ShellIcon name="user" :size="14" />
                        <span>{{ $t('Projects.me') }}</span>
                    </button>
                    <button
                        type="button"
                        v-if="projectData?.isGlobalPermission === false ? checkPermission('task.show_tasks',projectData.isGlobalPermission) === 2 || checkPermission('task.show_tasks',projectData.isGlobalPermission) === true : true"
                        @click="$emit('update:userSidebar', !userSidebar)"
                        class="cursor-pointer assignee-status"
                        :class="{'is-active' : assigneeFilterCount}"
                        :title="assigneeFilterCount ? $t('Projects.assignee_count', { n: assigneeFilterCount }) : $t('ProjectDetails.assignee')"
                        :aria-label="assigneeFilterCount ? $t('Projects.assignee_count', { n: assigneeFilterCount }) : $t('ProjectDetails.assignee')"
                    >
                        <ShellIcon name="users" :size="14" />
                        <span v-if="assigneeFilterCount" class="pft__count">{{ assigneeFilterCount }}</span>
                    </button>
                </div>
                <div class="d-flex align-items-center assignee-filter">
                    <div class="group_by monthly-calendar monthly-calendar-view" @click="$emit('openCalendar')">
                        {{ calendarDate ? calendarDate : new Date().toLocaleString('default', { month: 'long', year: 'numeric' }) }}
                        <MonthlyCalendarMilestone
                            v-if="calendartoggle"
                            :rangeObject="rangeObject"
                            :startDate="calendarDate ? new Date(calenderSelectDate) : new Date()"
                            @startEndDate="(val) => $emit('handleStartEndDate', val)"
                        />
                    </div>
                    <div class="group_by d-flex">
                        <button type="button" :title="$t('Projects.prev_month')" class="calendar-button" @click="$emit('prevMonth')">
                            <span class="fc-icon fc-icon-chevron-left"></span>
                        </button>
                        <button type="button" :title="$t('Projects.next_month')" class="calendar-button" @click="$emit('nextMonth')">
                            <span class="fc-icon fc-icon-chevron-right"></span>
                        </button>
                    </div>
                    <div class="group_by">
                        <button type="button" :title="$t('Projects.this_month')" class="calendar-button calendar-currentday-text" @click="$emit('defaultMonth')">{{ $t('Home.Today') }}</button>
                    </div>
                </div>
            </div>
        </div>
        <template v-if="isListLike">
            <RecentVisitsDropdown v-model="showRecent" />
            <BurndownModal v-model="showBurndown" :projectData="projectData" />
            <EpicsPanel v-model="showEpics" :projectData="projectData" />
            <PagesPanel v-model="showPages" :projectData="projectData" />
            <ExportTasksDropdown v-model="showExport" :projectData="projectData" />
            <PublicShareModal v-model="showPublicShare" :projectData="projectData" />
            <WhoCanSeeModal v-if="showWhoCanSee" v-model="showWhoCanSee" kind="project" :itemId="projectData?._id || ''" :title="projectData?.ProjectName || ''" />
            <ImportDialog v-model="showImport" :projectData="projectData" :users="users" :sprint="importSprint" />
            <AutoArchiveModal v-model="showAutoArchive" :projectData="projectData" />
            <EstimationScaleModal v-model="showEstimationScale" :projectData="projectData" />
        </template>
    </div>
</template>

<script setup>
import { ref, computed, defineProps, defineEmits, watch } from 'vue';
import { canUseAi } from "@/composable/aiAvailability";
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';
import { useRoute } from 'vue-router';
import DropDown from '@/components/molecules/DropDown/DropDown.vue';
import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue';
import Toggle from '@/components/atom/Toggle/Toggle.vue';
import Assignee from '@/components/molecules/Assignee/Assignee.vue';
import TaskFilter from '@/components/molecules/TaskFilter/TaskFilter.vue';
import ProvenanceFilter from '@/components/molecules/Provenance/ProvenanceFilter.vue';
import MonthlyCalendarMilestone from '@/components/atom/MonthlyCalendarMilestone/MonthlyCalendarMilestone.vue';
import BurndownModal from '@/components/molecules/Burndown/BurndownModal.vue';
import RecentVisitsDropdown from '@/components/molecules/RecentVisits/RecentVisitsDropdown.vue';
import { openPalette } from '@/components/molecules/AdvanceSearch/paletteKeys';
import EpicsPanel from '@/components/molecules/Epics/EpicsPanel.vue';
import ExportTasksDropdown from '@/components/molecules/ExportTasks/ExportTasksDropdown.vue';
import PagesPanel from '@/components/molecules/Pages/PagesPanel.vue';
import PublicShareModal from '@/components/molecules/PublicShare/PublicShareModal.vue';
import WhoCanSeeModal from '@/components/molecules/WhoCanSee/WhoCanSeeModal.vue';
import ImportDialog from '@/components/organisms/ImportDialog/ImportDialog.vue';
import AutoArchiveModal from '@/components/molecules/AutoArchive/AutoArchiveModal.vue';
import EstimationScaleModal from '@/components/molecules/EstimationScale/EstimationScaleModal.vue';
import { ALL as DONE_BY_ALL } from '@/components/molecules/Provenance/doneByQuery';
import { clearFilterSignal } from '@/views/Projects/composables/taskFilterSignal';
import ProjectFiltersSheet from './ProjectFiltersSheet.vue';

const PHONE_MAX = 767;
const LIST_LIKE_TABS = ['ProjectListView', 'ProjectKanban', 'TableView'];
// Menus opened from the sheet have to stack above its backdrop.
const SHEET_MENU_Z = 70;

const InPlace = (_, { slots }) => slots.default?.();
InPlace.props = ['open'];
InPlace.inheritAttrs = false;

const showBurndown = ref(false);
const showEpics = ref(false);
const showPages = ref(false);
const showPublicShare = ref(false);
const showWhoCanSee = ref(false);
const showImport = ref(false);
const showAutoArchive = ref(false);
const showEstimationScale = ref(false);
const showRecent = ref(false);
const showExport = ref(false);

const opener = (flag) => () => { flag.value = true; };
import { useCustomComposable } from '@/composable';

const { checkPermission } = useCustomComposable();

const props = defineProps({
    activeTab: { type: String, required: true },
    projectData: { type: Object, required: true },
    clientWidth: { type: Number, required: true },
    showArchived: { type: Boolean, default: false },
    showArchivedProjects: { type: Boolean, default: false },
    taskSearch: { type: String, default: '' },
    taskNameSearch: { type: Boolean, default: true },
    taskKeySearch: { type: Boolean, default: false },
    taskDescriptionSearch: { type: Boolean, default: false },
    filterUsers: { type: Array, default: () => [] },
    doneBy: { type: String, default: 'all' },
    userSidebar: { type: Boolean, default: false },
    collapsed: { type: Boolean, default: true },
    groupBy: { type: Number, default: 0 },
    groupByOptions: { type: Array, default: () => [] },
    users: { type: Array, default: () => [] },
    teams: { type: Array, default: () => [] },
    userId: { type: String, default: '' },
    calendartoggle: { type: Boolean, default: false },
    calendarDate: { type: String, default: '' },
    calenderSelectDate: { type: Number, default: 0 },
    rangeObject: { type: Object, default: () => ({}) },
});

const route = useRoute();
const searchOpen = ref(Boolean(props.taskSearch));
watch(() => props.taskSearch, (value) => { if (value) searchOpen.value = true; });
// The wizard files rows into one sprint: the one in the route, else the project's first.
// 22b's "into Mobile App v2" headline reads from this.
const importSprint = computed(() => {
    const wanted = String(route.params.sprintId || '');
    const flat = [];
    Object.values(props.projectData?.sprintsObj || {}).forEach((sp) => sp?.id && flat.push({ ...sp, _id: sp.id }));
    Object.values(props.projectData?.sprintsfolders || {}).forEach((folder) => {
        Object.values(folder?.sprintsObj || {}).forEach((sp) => sp?.id && flat.push({ ...sp, _id: sp.id, folderId: folder.folderId, folderName: folder.folderName || '' }));
    });
    return flat.find((sp) => String(sp.id) === wanted) || flat[0] || {};
});

const emit = defineEmits([
    'update:taskSearch',
    'update:taskNameSearch',
    'update:taskKeySearch',
    'update:taskDescriptionSearch',
    'update:userSidebar',
    'update:collapsed',
    'update:groupBy',
    'update:showArchived',
    'applyFilter',
    'clearFilter',
    'search',
    'toggleSearch',
    'manageFilterUsers',
    'update:doneBy',
    'changeAssignee',
    'openAi',
    'openAiAssist',
    'openCalendar',
    'handleStartEndDate',
    'prevMonth',
    'nextMonth',
    'defaultMonth',
]);

const assigneeFilterCount = computed(() => props.filterUsers.filter((x) => x !== props.userId).length);

const isListLike = computed(() => LIST_LIKE_TABS.includes(props.activeTab));
const sheetMode = computed(() => props.clientWidth <= PHONE_MAX && isListLike.value);
const filtersOpen = ref(false);
watch(sheetMode, (on) => { if (!on) filtersOpen.value = false; });

const advancedApplied = ref(false);
watch(clearFilterSignal, () => { advancedApplied.value = false; });
const onApplyFilter = (query) => {
    advancedApplied.value = true;
    emit('applyFilter', query);
};
const onClearFilter = () => {
    advancedApplied.value = false;
    emit('clearFilter');
};

const activeFilterCount = computed(() => [
    props.filterUsers.includes(props.userId),
    assigneeFilterCount.value > 0,
    props.doneBy !== DONE_BY_ALL,
    advancedApplied.value,
].filter(Boolean).length);

// Show/Hide Archive is a mode switch, not a filter, so it lives in the overflow menu
// and the menu stays mounted in archive mode — it is the only way back out.
const moreGroups = computed(() => {
    const groups = [];
    if (!(props.showArchived && props.showArchivedProjects)) {
        groups.push({ key: 'view', items: [
            {
                key: 'archive',
                label: props.showArchived ? 'ProjectSlider.hide_archive' : 'ProjectSlider.show_archive',
                open: () => emit('update:showArchived', !props.showArchived)
            }
        ] });
    }
    groups.push(
        { key: 'find', items: [
            { key: 'search', label: 'Projects.global_search', open: openPalette },
            { key: 'recent', label: 'Projects.recent_tasks', open: opener(showRecent) }
        ] },
        { key: 'insights', items: [
            { key: 'burndown', label: 'Projects.burndown', open: opener(showBurndown) },
            { key: 'epics', label: 'Projects.epics', open: opener(showEpics) },
            { key: 'pages', label: 'Projects.pages', open: opener(showPages) }
        ] },
        { key: 'share', items: [
            { key: 'export', label: 'Projects.export_tasks', open: opener(showExport) },
            { key: 'public', label: 'Projects.public_link', open: opener(showPublicShare) },
            { key: 'whoCanSee', label: 'WhoCanSee.menu_project', open: opener(showWhoCanSee) }
        ] },
        { key: 'import', items: [
            { key: 'import', label: 'Projects.import_any', open: opener(showImport) }
        ] },
        { key: 'settings', items: [
            { key: 'autoArchive', label: 'Projects.auto_archive', open: opener(showAutoArchive) },
            { key: 'estimation', label: 'Projects.estimation_scale', open: opener(showEstimationScale) }
        ] }
    );
    return groups;
});

</script>

<style>
@import "./project-filters.css";
</style>
