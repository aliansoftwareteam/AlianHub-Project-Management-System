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
                        :style="{width: (clientWidth > 1025 ? '260px' : '90%')}"
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
                    <button class="text-nowrap btn ai_button mr-1 cursor-pointer" @click="$emit('openAi')" v-if="checkApps('AI',projectData) && checkPermission('artificial_intelligence',projectData?.isGlobalPermission) === true">
                        <img src="@/assets/images/svg/ai_image_white.svg" class="mr-10-px"/>
                        <span>{{ $t('AI.write_with_ai') }}</span>
                    </button>
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
                    <button class="text-nowrap btn-white border-groupBy border-radius-6-px cursor-pointer mr-1" @click="showBurndown = true">
                        <strong :style="{color: (clientWidth <= 767 ? '#535358' : '#000')}" :class="{'font-size-12 font-weight-500' : clientWidth > 767 , 'font-size-14 font-weight-400' : clientWidth <=767}">{{ $t('Projects.burndown') }}</strong>
                    </button>
                    <BurndownModal v-model="showBurndown" :projectData="projectData" />
                    <RecentVisitsDropdown class="mr-1" />
                    <button class="text-nowrap btn-white border-groupBy border-radius-6-px cursor-pointer mr-1" :title="$t('Projects.global_search')" @click="showGlobalSearch = true">
                        <strong :style="{color: (clientWidth <= 767 ? '#535358' : '#000')}" :class="{'font-size-12 font-weight-500' : clientWidth > 767 , 'font-size-14 font-weight-400' : clientWidth <=767}">{{ $t('Projects.global_search') }}</strong>
                    </button>
                    <GlobalSearchModal v-model="showGlobalSearch" />
                    <button class="text-nowrap btn-white border-groupBy border-radius-6-px cursor-pointer mr-1" @click="showEpics = true">
                        <strong :style="{color: (clientWidth <= 767 ? '#535358' : '#000')}" :class="{'font-size-12 font-weight-500' : clientWidth > 767 , 'font-size-14 font-weight-400' : clientWidth <=767}">{{ $t('Projects.epics') }}</strong>
                    </button>
                    <EpicsPanel v-model="showEpics" :projectData="projectData" />
                    <ExportTasksDropdown class="mr-1" :projectData="projectData" />
                    <button class="text-nowrap btn-white border-groupBy border-radius-6-px cursor-pointer mr-1" @click="showPages = true">
                        <strong :style="{color: (clientWidth <= 767 ? '#535358' : '#000')}" :class="{'font-size-12 font-weight-500' : clientWidth > 767 , 'font-size-14 font-weight-400' : clientWidth <=767}">{{ $t('Projects.pages') }}</strong>
                    </button>
                    <PagesPanel v-model="showPages" :projectData="projectData" />
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
import EpicsPanel from '@/components/molecules/Epics/EpicsPanel.vue';
import ExportTasksDropdown from '@/components/molecules/ExportTasks/ExportTasksDropdown.vue';
import PagesPanel from '@/components/molecules/Pages/PagesPanel.vue';

const showBurndown = ref(false);
const showGlobalSearch = ref(false);
const showEpics = ref(false);
const showPages = ref(false);
import { useCustomComposable } from '@/composable';

const { checkPermission, checkApps } = useCustomComposable();

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
