<template>
    <div class="task-assigneesearch-groupbywrapper" :class="{'overflow-auto' : clientWidth <=767}">
        <div class="d-flex align-items-center justify-content-between flex-wrap task-filtersearchassignee-wrapper" :class="{'w-545' : clientWidth <=767 }" v-if="['ProjectListView', 'Calendar', 'ProjectKanban','TableView'].includes(activeTab)">
            <div class="d-flex align-items-center justify-content-start task-filtersearch" :class="[{ 'mb-10px': clientWidth <= 767 }]" :style="{width: (clientWidth <= 767 ? '100%' : '')}" v-if="!showArchived">
                <TaskFilter :projectData="projectData" @apply="(q) => $emit('applyFilter', q)" @clear="$emit('clearFilter')" v-if="Object.keys(projectData).length > 0"/>
                <div class="position-re task-fitler-search" id="projectviewfiltersearch_driver">
                    <input
                        type="text"
                        :placeHolder="$t('PlaceHolder.search')"
                        class="form-control"
                        :style="{width: (clientWidth > 767 ? '260px' : '90%')}"
                        :value="taskSearch"
                        @input="$emit('update:taskSearch', $event.target.value)"
                    >
                    <DropDown title="Search In" id="searchfilterdropdownoptions_driver" class="position-ab dropdown-image-horizontal" :bodyClass="{'search__in-dropdown' : true}">
                        <template #head>
                            <h4 class="black font-size-13 font-weight-500 p-10px m-0 search__in" :class="{'border-bottom': clientWidth > 767}">
                                {{ $t('Projects.search_in') }}
                            </h4>
                        </template>
                        <template #button>
                            <img :src="horizontalDots" alt="horizontalDots" class="vertical-middle" id="searchfilterdropdown_driver">
                        </template>
                        <template #options>
                            <DropDownOption @click="taskDescriptionSearch || taskKeySearch ? $emit('update:taskNameSearch', !taskNameSearch) : ''" class="task-serachstatus-dropdown border-radius-4-px">
                                <span class="project-mobile-desc mr-10px">{{ $t('Projects.task_name') }}</span>
                                <Toggle width="20" :modelValue="taskNameSearch" @update:modelValue="(v) => $emit('update:taskNameSearch', v)" :disabled="taskNameSearch && !taskDescriptionSearch && !taskKeySearch" @change="$emit('search')"/>
                            </DropDownOption>
                            <DropDownOption @click="$emit('update:taskKeySearch', !taskKeySearch)" class="task-serachstatus-dropdown border-radius-4-px">
                                <span class="project-mobile-desc mr-10px">{{ $t('Projects.task_key') }}</span>
                                <Toggle width="20" :modelValue="taskKeySearch" @update:modelValue="(v) => $emit('update:taskKeySearch', v)" @change="$emit('toggleSearch'),$emit('search')"/>
                            </DropDownOption>
                            <DropDownOption @click="$emit('update:taskDescriptionSearch', !taskDescriptionSearch)" class="task-serachstatus-dropdown border-radius-4-px">
                                <span class="project-mobile-desc mr-10px">{{ $t('ProjectDetails.description') }}</span>
                                <Toggle width="20" :modelValue="taskDescriptionSearch" @update:modelValue="(v) => $emit('update:taskDescriptionSearch', v)" @change="$emit('toggleSearch'),$emit('search')"/>
                            </DropDownOption>
                        </template>
                    </DropDown>
                </div>
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
            <div v-if="['ProjectListView', 'ProjectKanban','TableView'].includes(activeTab)" class="d-flex align-items-center justify-content-end task-filter-assignee overflow-auto style-scroll" :style="`${showArchived ? 'width: 100%;' : ''}`" :class="clientWidth <= 767 ? 'justify-content-start' : ''">
                <template v-if="!showArchived">
                    <!-- AI Assist (AHE-3777): project-level AI task generation. Placed before "Write with AI". -->
                    <button class="ai-assist-btn text-nowrap mr-1 cursor-pointer" @click="$emit('openAiAssist')" v-if="checkApps('AI',projectData) && checkPermission('task.task_create',projectData?.isGlobalPermission) === true">
                        <span class="ai-assist-btn__spark" aria-hidden="true">✨</span>
                        <span class="ai-assist-btn__label">AI Assist</span>
                    </button>
                    <button class="text-nowrap btn ai_button mr-1 cursor-pointer" @click="$emit('openAi')" v-if="checkApps('AI',projectData) && checkPermission('artificial_intelligence',projectData?.isGlobalPermission) === true">
                        <img src="@/assets/images/svg/ai_image_white.svg" class="mr-10-px"/>
                        <span>{{ $t('AI.write_with_ai') }}</span>
                    </button>
                    <!-- Tags app available on the plan but not switched on for this project: inline locked chip. -->
                    <AppTeaserBlock
                        v-if="getAppState('tags', projectData) === 'disabled' && checkPermission('task.task_tag',projectData?.isGlobalPermission) !== null"
                        appKey="tags" variant="inline" class="mr-1"
                    />
                    <!-- AI app available on the plan but not switched on for this project: inline locked chip. -->
                    <AppTeaserBlock
                        v-if="getAppState('AI', projectData) === 'disabled' && checkPermission('task.task_create',projectData?.isGlobalPermission) === true"
                        appKey="AI" variant="inline" class="mr-1"
                    />
                    <DropDown id="group_by" class="mr-1 group_by">
                        <template #button>
                            <button class="text-nowrap btn-white border-groupBy border-radius-6-px cursor-pointer" ref="group_by_status" @click="currentActive='group'">
                                <div class="group-by-dropdown" :class="{'active' : clientWidth <= 767 && currentActive == 'group' }">
                                    <strong :style="{color: (clientWidth <= 767 ? '#535358' : '#000')}" :class="{'font-size-12 font-weight-500' : clientWidth > 767 , 'font-size-14 font-weight-400' : clientWidth <=767}">{{ $t('Projects.group_by') }} : </strong>
                                    <span :style="{color: (clientWidth <= 767 ? '#535358' : '#818181')}" :class="{'font-size-12' : clientWidth > 767 , 'font-size-14' : clientWidth <=767}">{{ $t(`Projects.${groupByOptions.find(x => x.id === groupBy).label}`) }}</span>
                                </div>
                            </button>
                        </template>
                        <template #options>
                            <DropDownOption v-for="item in groupByOptions" :key="item.id" @click="$emit('update:groupBy', item.id); $refs.group_by_status.click(item)" :class="{'bg-light-gray' : item.id === groupBy}">
                                <div>
                                    <img :src="item.image" :alt="item.label" class="pr-10px">
                                    <span :class="{'purple' : item.id === groupBy}">{{ $t(`Projects.${item.label}`) }}</span>
                                </div>
                            </DropDownOption>
                        </template>
                    </DropDown>
                    <DropDown class="mr-1 group_by" v-if="activeTab === 'ProjectListView'">
                        <template #button>
                            <button class="text-nowrap btn-white border-groupBy border-radius-6-px cursor-pointer" ref="expand_collapse" @click="currentActive='subtask'">
                                <div class="group-by-dropdown current__dropdown" :class="{'active' : clientWidth <= 767 && currentActive == 'subtask' }">
                                    <strong :style="{color: (clientWidth <= 767 ? '#535358' : '#000')}" :class="{'font-size-12 font-weight-500' : clientWidth > 767 , 'font-size-14 font-weight-400' : clientWidth <=767}">{{ $t('Projects.subtask') }}: </strong>
                                    <span :style="{color: (clientWidth <= 767 ? '#535358' : '#818181')}" :class="{'font-size-12' : clientWidth > 767 , 'font-size-14' : clientWidth <=767}"> {{collapsed ? $t('Projects.collapsed') : $t('Projects.expanded')}}</span>
                                </div>
                            </button>
                        </template>
                        <template #options>
                            <DropDownOption @click="$emit('update:collapsed', false); $refs.expand_collapse.click()" :class="{'bg-light-gray' : !collapsed}">
                                <span :class="{'purple' : !collapsed}">{{ $t('Projects.expanded') }}</span>
                            </DropDownOption>
                            <DropDownOption @click="$emit('update:collapsed', true); $refs.expand_collapse.click()" :class="{'bg-light-gray' : collapsed}">
                                <span :class="{'purple' : collapsed}">{{ $t('Projects.collapsed') }}</span>
                            </DropDownOption>
                        </template>
                    </DropDown>
                    <!-- All newer features live behind one "…" menu (matches
                         the task context-menu pattern) instead of nine
                         separate toolbar buttons. -->
                    <DropDown id="more_features" class="mr-1" :zIndex="10">
                        <template #button>
                            <button class="text-nowrap btn-white border-groupBy border-radius-6-px cursor-pointer" ref="more_features_trigger" :title="$t('Projects.more_features')">
                                <img :src="horizontalDots" alt="more" class="vertical-middle">
                            </button>
                        </template>
                        <template #options>
                            <DropDownOption @click="$refs.more_features_trigger.click(); globalSearchOpen = true">
                                <div><span class="dropdown-label">{{ $t('Projects.global_search') }}</span></div>
                            </DropDownOption>
                            <DropDownOption @click="$refs.more_features_trigger.click(); showRecent = true">
                                <div><span class="dropdown-label">{{ $t('Projects.recent_tasks') }}</span></div>
                            </DropDownOption>
                            <DropDownOption @click="$refs.more_features_trigger.click(); showBurndown = true">
                                <div><span class="dropdown-label">{{ $t('Projects.burndown') }}</span></div>
                            </DropDownOption>
                            <DropDownOption @click="$refs.more_features_trigger.click(); showEpics = true">
                                <div><span class="dropdown-label">{{ $t('Projects.epics') }}</span></div>
                            </DropDownOption>
                            <DropDownOption @click="$refs.more_features_trigger.click(); showPages = true">
                                <div><span class="dropdown-label">{{ $t('Projects.pages') }}</span></div>
                            </DropDownOption>
                            <DropDownOption @click="$refs.more_features_trigger.click(); showExport = true">
                                <div><span class="dropdown-label">{{ $t('Projects.export_tasks') }}</span></div>
                            </DropDownOption>
                            <DropDownOption @click="$refs.more_features_trigger.click(); showPublicShare = true">
                                <div><span class="dropdown-label">{{ $t('Projects.public_link') }}</span></div>
                            </DropDownOption>
                            <DropDownOption @click="$refs.more_features_trigger.click(); showImportJira = true">
                                <div><span class="dropdown-label">{{ $t('Projects.import_jira') }}</span></div>
                            </DropDownOption>
                            <DropDownOption @click="$refs.more_features_trigger.click(); showImportCsv = true">
                                <div><span class="dropdown-label">{{ $t('Projects.import_csv') }}</span></div>
                            </DropDownOption>
                            <DropDownOption @click="$refs.more_features_trigger.click(); showImportTrello = true">
                                <div><span class="dropdown-label">{{ $t('Projects.import_trello') }}</span></div>
                            </DropDownOption>
                            <DropDownOption @click="$refs.more_features_trigger.click(); showImportAsana = true">
                                <div><span class="dropdown-label">{{ $t('Projects.import_asana') }}</span></div>
                            </DropDownOption>
                            <DropDownOption @click="$refs.more_features_trigger.click(); showImportMonday = true">
                                <div><span class="dropdown-label">{{ $t('Projects.import_monday') }}</span></div>
                            </DropDownOption>
                            <DropDownOption @click="$refs.more_features_trigger.click(); showAutoArchive = true">
                                <div><span class="dropdown-label">{{ $t('Projects.auto_archive') }}</span></div>
                            </DropDownOption>
                            <DropDownOption @click="$refs.more_features_trigger.click(); showEstimationScale = true">
                                <div><span class="dropdown-label">Estimation scale</span></div>
                            </DropDownOption>
                        </template>
                    </DropDown>
                    <GlobalSearchModal v-model="globalSearchOpen" />
                    <RecentVisitsDropdown v-model="showRecent" />
                    <BurndownModal v-model="showBurndown" :projectData="projectData" />
                    <EpicsPanel v-model="showEpics" :projectData="projectData" />
                    <PagesPanel v-model="showPages" :projectData="projectData" />
                    <ExportTasksDropdown v-model="showExport" :projectData="projectData" />
                    <PublicShareModal v-model="showPublicShare" :projectData="projectData" />
                    <ImportJiraModal v-model="showImportJira" :projectData="projectData" />
                    <ImportCsvModal v-model="showImportCsv" :projectData="projectData" />
                    <ImportTrelloModal v-model="showImportTrello" :projectData="projectData" />
                    <ImportAsanaModal v-model="showImportAsana" :projectData="projectData" />
                    <ImportMondayModal v-model="showImportMonday" :projectData="projectData" />
                    <AutoArchiveModal v-model="showAutoArchive" :projectData="projectData" />
                    <EstimationScaleModal v-model="showEstimationScale" :projectData="projectData" />
                    <div class="mr-1 border-groupBy border-radius-6-px d-flex align-items-center assignee-filter manage__filter-users">
                        <div
                            @click="$emit('manageFilterUsers', userId)"
                            :class="{'bg-white' : filterUsers.includes(userId)}"
                            class="border-radius-6-px border-right-radius-0 border-right cursor-pointer assignee-user font-size-12 font-weight-400 p7x-5px"
                        >
                            <img :src="filterUsers.includes(userId) ? activeUserIcon : userIcon" alt="user icon" class="vertical-middle">
                            <span class="font-size-12 font-weight-400 ml-7px"> {{ $t('Projects.me') }} </span>
                        </div>
                        <div
                            v-if="projectData?.isGlobalPermission === false ? checkPermission('task.show_tasks',projectData.isGlobalPermission) === 2 || checkPermission('task.show_tasks',projectData.isGlobalPermission) === true : true"
                            @click="$emit('update:userSidebar', !userSidebar)"
                            class="border-radius-6-px border-left-radius-0 cursor-pointer assignee-status p4x-5px"
                            :class="{'bg-white blue' : filterUsers.length && filterUsers.filter((x) => x !== userId).length}"
                        >
                            <img :src="filterUsers.length && filterUsers.filter((x) => x !== userId).length ? activeGroupIcon : groupIcon" alt="user icon">
                            <span class="font-size-12 font-weight-400 ml-10px"> {{filterUsers.length && filterUsers.filter((x) => x !== userId).length ? `(${filterUsers.filter((x) => x !== userId).length})` : $t('ProjectDetails.assignee')}}</span>
                        </div>
                    </div>
                </template>
                <button class="archived-btn font-weight-400 d-flex align-items-center justify-content-between" :style="{color: (clientWidth <= 767 ? '#535358' : '')}" :class="{'outline-primary show-archived-active': showArchived, 'outline-secondary': !showArchived, 'border-radius-6-px font-size-14' : clientWidth <=767 , 'border-0 font-size-13' : clientWidth > 767 }">
                    <template v-if="showArchived">
                        <span class="font-weight-bold font-size-16 dark-gray">{{ $t('ProjectSlider.archived_list') }}</span>
                        <span v-if="!showArchivedProjects" @click="$emit('update:showArchived', false)">{{ $t('ProjectSlider.hide_archive') }}</span>
                    </template>
                    <template v-else>
                        <span @click="$emit('update:showArchived', true)" class="text-nowrap">{{ $t('ProjectSlider.show_archive') }}</span>
                    </template>
                </button>
            </div>
            <div v-if="['Calendar'].includes(activeTab)" class="d-flex align-items-center justify-content-end task-filter-assignee style-scroll" :class="clientWidth <= 767 ? 'justify-content-start' : ''">
                <div class="mr-1 border-groupBy border-radius-6-px d-flex align-items-center assignee-filter manage__filter-users">
                    <div
                        @click="$emit('manageFilterUsers', userId)"
                        :class="{'bg-white' : filterUsers.includes(userId)}"
                        class="border-radius-6-px border-right-radius-0 border-right cursor-pointer assignee-user font-size-12 font-weight-400 p7x-5px"
                    >
                        <img :src="filterUsers.includes(userId) ? activeUserIcon : userIcon" alt="user icon" class="vertical-middle">
                        <span class="font-size-12 font-weight-400 ml-7px">{{ $t('Projects.me') }} </span>
                    </div>
                    <div
                        v-if="projectData?.isGlobalPermission === false ? checkPermission('task.show_tasks',projectData.isGlobalPermission) === 2 || checkPermission('task.show_tasks',projectData.isGlobalPermission) === true : true"
                        @click="$emit('update:userSidebar', !userSidebar)"
                        class="border-radius-6-px border-left-radius-0 cursor-pointer assignee-status p4x-5px"
                        :class="{'bg-white blue' : filterUsers.length && filterUsers.filter((x) => x !== userId).length}"
                    >
                        <img :src="filterUsers.length && filterUsers.filter((x) => x !== userId).length ? activeGroupIcon : groupIcon" alt="user icon">
                        <span class="font-size-12 font-weight-400 ml-10px"> {{filterUsers.length && filterUsers.filter((x) => x !== userId).length ? `(${filterUsers.filter((x) => x !== userId).length})` : $t('ProjectDetails.assignee')}}</span>
                    </div>
                </div>
                <div class="d-flex align-items-center assignee-filter">
                    <div class="mr-1 group_by monthly-calendar monthly-calendar-view" @click="$emit('openCalendar')">
                        {{ calendarDate ? calendarDate : new Date().toLocaleString('default', { month: 'long', year: 'numeric' }) }}
                        <MonthlyCalendarMilestone
                            v-if="calendartoggle"
                            :rangeObject="rangeObject"
                            :startDate="calendarDate ? new Date(calenderSelectDate) : new Date()"
                            @startEndDate="(val) => $emit('handleStartEndDate', val)"
                        />
                    </div>
                    <div class="mr-1 group_by d-flex">
                        <button type="button" title="Previous month" class="calendar-button" @click="$emit('prevMonth')">
                            <span class="fc-icon fc-icon-chevron-left"></span>
                        </button>
                        <button type="button" title="Next month" class="calendar-button" @click="$emit('nextMonth')">
                            <span class="fc-icon fc-icon-chevron-right"></span>
                        </button>
                    </div>
                    <div class="mr-1 group_by">
                        <button type="button" title="This month" class="calendar-button calendar-currentday-text" @click="$emit('defaultMonth')">{{ $t('Home.Today') }}</button>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, defineProps, defineEmits } from 'vue';
import DropDown from '@/components/molecules/DropDown/DropDown.vue';
import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue';
import Toggle from '@/components/atom/Toggle/Toggle.vue';
import Assignee from '@/components/molecules/Assignee/Assignee.vue';
import TaskFilter from '@/components/molecules/TaskFilter/TaskFilter.vue';
import MonthlyCalendarMilestone from '@/components/atom/MonthlyCalendarMilestone/MonthlyCalendarMilestone.vue';
import BurndownModal from '@/components/molecules/Burndown/BurndownModal.vue';
import RecentVisitsDropdown from '@/components/molecules/RecentVisits/RecentVisitsDropdown.vue';
import GlobalSearchModal from '@/components/molecules/GlobalSearch/GlobalSearchModal.vue';
import { globalSearchOpen } from '@/utils/openGlobalSearch';
import EpicsPanel from '@/components/molecules/Epics/EpicsPanel.vue';
import ExportTasksDropdown from '@/components/molecules/ExportTasks/ExportTasksDropdown.vue';
import PagesPanel from '@/components/molecules/Pages/PagesPanel.vue';
import PublicShareModal from '@/components/molecules/PublicShare/PublicShareModal.vue';
import ImportJiraModal from '@/components/molecules/ImportJira/ImportJiraModal.vue';
import ImportCsvModal from '@/components/molecules/ImportCsv/ImportCsvModal.vue';
import ImportTrelloModal from '@/components/molecules/ImportTrello/ImportTrelloModal.vue';
import ImportAsanaModal from '@/components/molecules/ImportAsana/ImportAsanaModal.vue';
import ImportMondayModal from '@/components/molecules/ImportMonday/ImportMondayModal.vue';
import AutoArchiveModal from '@/components/molecules/AutoArchive/AutoArchiveModal.vue';
import EstimationScaleModal from '@/components/molecules/EstimationScale/EstimationScaleModal.vue';

const showBurndown = ref(false);
const showEpics = ref(false);
const showPages = ref(false);
const showPublicShare = ref(false);
const showImportJira = ref(false);
const showImportCsv = ref(false);
const showImportTrello = ref(false);
const showImportAsana = ref(false);
const showImportMonday = ref(false);
const showAutoArchive = ref(false);
const showEstimationScale = ref(false);
const showRecent = ref(false);
const showExport = ref(false);
import { useCustomComposable } from '@/composable';
import AppTeaserBlock from '@/components/molecules/AppTeaserBlock/AppTeaserBlock.vue';

const { checkPermission, checkApps, getAppState } = useCustomComposable();

defineProps({
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

defineEmits([
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
    'changeAssignee',
    'openAi',
    'openAiAssist',
    'openCalendar',
    'handleStartEndDate',
    'prevMonth',
    'nextMonth',
    'defaultMonth',
]);

const currentActive = ref('');
const horizontalDots = require('@/assets/images/svg/horizontalDots.svg');
const activeUserIcon = require('@/assets/images/peopleBlue.png');
const userIcon = require('@/assets/images/peopleGray.png');
const activeGroupIcon = require('@/assets/images/peopleBlue.png');
const groupIcon = require('@/assets/images/peopleGray.png');
</script>

<style scoped>
/* AI Assist — modern "AI" pill: gradient border + gradient text + soft glow,
   distinct from the solid-purple "Write with AI" beside it. */
.ai-assist-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 14px;
    font-size: 12px;
    font-weight: 600;
    line-height: 1;
    border-radius: 999px;
    border: 1.5px solid transparent;
    background:
        linear-gradient(#fff, #fff) padding-box,
        linear-gradient(120deg, #7C5CFF 0%, #4D7CFF 50%, #C44BFF 100%) border-box;
    box-shadow: 0 2px 10px rgba(108, 99, 255, 0.18);
    transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.ai-assist-btn:hover {
    transform: translateY(-1px);
    box-shadow: 0 6px 18px rgba(124, 92, 255, 0.32);
}
.ai-assist-btn:active {
    transform: translateY(0);
}
.ai-assist-btn__label {
    background: linear-gradient(120deg, #7C5CFF 0%, #4D7CFF 50%, #C44BFF 100%);
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    color: #6a5cff; /* fallback where background-clip:text is unsupported */
}
.ai-assist-btn__spark {
    font-size: 13px;
    line-height: 1;
}

/* Tighten the gaps between the desktop action buttons so the row is less
   crowded — the global .mr-1 gap is 16px (1rem); 8px reads better. This is
   spacing only: we deliberately do NOT force the row onto a single line. An
   earlier attempt used flex-wrap:nowrap + a scrollable (flex:1 / min-width:0)
   action group, which HID the buttons that didn't fit on screens narrower than
   a full desktop. Leaving the group free to wrap keeps every option visible. */
@media (min-width: 768px) {
    .task-filter-assignee > :deep(.mr-1) {
        margin-right: 8px;
    }
    /* Responsive fix: keep the search box at its own width so it never
       stretches to fill the row when the toolbar wraps (previously the 90%
       width ballooned across a full wrapped line). And give the wrapper a
       row-gap so, when the search + action groups wrap onto two lines, the
       rows have clean vertical spacing instead of touching. */
    .task-filtersearchassignee-wrapper {
        row-gap: 10px;
    }
    .task-filtersearch,
    .task-fitler-search {
        flex: 0 0 auto;
    }
}
</style>
