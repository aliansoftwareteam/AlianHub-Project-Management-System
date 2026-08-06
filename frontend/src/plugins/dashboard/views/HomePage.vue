<template>
    <div class="w-100">
        <!-- Dashboard-level date range — cards whose period is set to "Auto"
             follow this window; the rest keep their own selection. Reuses the
             app's standard range picker (CalenderCompo, as in the timesheets). -->
        <div class="dashboard-range-bar">
            <span class="dashboard-range-label">{{ $t('dashboardCard.dashboard_range') }}</span>
            <CalenderCompo
                class="dashboard-range-picker"
                :range="true"
                :preSelectable="false"
                :hideClearButton="true"
                position="left"
                :modelValue="globalRangeModel"
                @update:modelValue="setGlobalRange"
            />
            <span class="dashboard-range-hint">{{ $t('dashboardCard.dashboard_range_hint') }}</span>
        </div>
        <template v-if="layout && layout.length">
            <div v-if="clientWidth > 768">
                <GridLayout
                    :layout="layout"
                    :col-num="gridCol"
                    :row-height="30"
                    :is-draggable="!locked"
                    :is-resizable="!locked"
                    :vertical-compact="true"
                    :use-css-transforms="true"
                    @layout-updated="layoutUpdatedEvent"
                    :responsive="false"
                    :class="{'grid_bg': isMoving,'empty-layout':!layout.length}"
                >
                    <GridItem 
                        v-for="(item,index) in layout"
                        :x="item.x"
                        :y="item.y"
                        :w="item.w"
                        :h="item.h"
                        :i="item.i"
                        :key="item.i"
                        :min-w="item.minW"
                        :max-w="item.maxW"
                        :min-h="item.minH"
                        :max-h="item.maxH"
                        @move="move"
                        @mouseenter="onHover(index)"
                        @mouseleave="onLeave"
                        @resize="resize"
                        :class="{'grid_layout_hover': hoverIndex === index, [item.i]: true}"
                    >
                        <DashBoardCard
                            :title="item?.cardData?.fieldName"
                            :id="item.i"
                            :showRefresh="isRefreshable(item.componentId)"
                            :periodOptions="periodOptionsFor(item)"
                            :periodValue="periodValueFor(item)"
                            @period-change="(val) => handlePeriodChange(item, val)"
                            @delete-card="handleRemoveCard(item.i)"
                            @edit-card="handleEditCardSettings(item.componentId,item.cardData,item.i,item.filterData)"
                            @refresh-card="handleRefreshCard(item.i)">
                            <component
                                :is="getComponent(item.componentId)"
                                :cardUID="item.i"
                                :companyUserDetail="companyUserDetail"
                                :allProjectsArrayFilter="allProjectsArray ? allProjectsArray : (projectsGetter?.data ?? [])"
                                :taskStatusArray="taskStatusArray"
                                :cardData="item.cardData ?? {}"
                                :componentId="item.componentId"
                                :refreshTrigger="refreshKeys[item.i] || 0"
                                v-bind="bindUpdates(item.componentId) ? { onHandleUpdateFromCard:(e)=>handleUpdateFromCard(e) } : {}"
                                :filterData="item.filterData ?? {}"
                            />
                        </DashBoardCard>
                    </GridItem>
                </GridLayout>
            </div>
            <div v-else>
                <div v-for="(item,index) in layout" :key="index" class="mb-1 mr-1 ml-1" :class="{'mt-1':index === 0}">
                    <DashBoardCard
                        :title="item?.cardData?.fieldName"
                        :id="item.i"
                        :showRefresh="isRefreshable(item.componentId)"
                        :periodOptions="periodOptionsFor(item)"
                        :periodValue="periodValueFor(item)"
                        @period-change="(val) => handlePeriodChange(item, val)"
                        @delete-card="handleRemoveCard(item.i)"
                        @edit-card="handleEditCardSettings(item.componentId,item.cardData,item.i,item.filterData)"
                        @refresh-card="handleRefreshCard(item.i)">
                        <component
                            :is="getComponent(item.componentId)"
                            :cardUID="item.i"
                            :companyUserDetail="companyUserDetail"
                            :allProjectsArrayFilter="allProjectsArray ? allProjectsArray : (projectsGetter?.data ?? [])"
                            :taskStatusArray="taskStatusArray"
                            :cardData="item.cardData ?? {}"
                            :componentId="item.componentId"
                            :refreshTrigger="refreshKeys[item.i] || 0"
                            v-bind="bindUpdates(item.componentId) ? { onHandleUpdateFromCard:(e)=>handleUpdateFromCard(e) } : {}"
                            :filterData="item.filterData ?? {}"
                        />
                    </DashBoardCard>
                </div>
            </div>            
        </template>
        <div v-else class="d-flex justify-content-center pt-10px vgl-layout empty-layout align-items-center">
            {{!isDataFetching ? $t(`dashboardCard.empty_layout_container`) : ''}}
        </div>
        
        <AdvanceSearchModal
            :closeIcon="false"
            headerClasses="pb-15px p-20px border-0"
            :bodyClasses="`p-0 ${cardTab === 1 ? 'mh-both-500' : 'mh-550' } overflow-auto`"
            :modelValue="isShowModal"
            :header="true"
            :footer="false"
            :showCloseIcon="false"
            :closeOnBackdrop="false"
            @close="isShowModal = false;isEditCard=false"
            :styles="cardTab === 1 ? { 'min-width': '65% !important', 'z-index': 10 } : { 'min-width': 'fit-content','z-index': 10, 'width': '90%' }"
            :stylesModalOverlay="[{'z-index':9}]"
        >
            <template #header>
                <div class="d-flex align-items-center justify-content-between w-100">
                    <span class="cursor-pointer" v-if="cardTab === 2 && isEditCard === false" @click="() => cardTab = 1"><img :src="backArrow" alt="backArrow"></span>
                    <h3 class="m-0 text-capitalize font-size-16">{{ !isEditCard ? $t(`dashboardCard.add_card`) : $t(`dashboardCard.edit_card`)  }}</h3>
                    <div class="d-flex align-items-center">
                        <div class="input-wrapper" v-if="cardTab === 1">
                            <InputText
                                v-model="search"
                                :place-holder="$t('PlaceHolder.search')"
                                type="text"
                                :isOutline="false"
                                @keyup="searchFunction"
                            />
                        </div>
                        <img :src="cancelIcon" class="cursor-pointer cancel__icon-img ml-2" alt="close" @click.prevent="handleCardClose()">
                    </div>
                </div>
            </template>
            <template #body>
                <div v-if="cardTab === 1" class="ml-2 mr-2">
                    <template v-for="(cardArray, category) in (filterCardComponent)" :key="category">
                        <div class="mb-2">
                            <span class="font-size-24 category_title text-capitalize" v-if="search?.length == 0">{{$t(`dashboardCard.${category}`)}}</span>
                            <div :class="{'card-grid':cardArray.length}">
                                <template v-for="(val) in (cardArray)" :key="val?._id">
                                    <FeatureCard
                                        :title="$t(`dashboardCard.${val.name}`)" 
                                        :description="$t(`dashboardCard.${val.description}`)"
                                        :image="getImageData(val.image)"
                                        :alt="val.image"
                                        :backgroundColor="val.backgroundColor"
                                        @click="handleCard(val)"
                                    >
                                    </FeatureCard>
                                </template>
                            </div>
                        </div>
                    </template>
                    <div v-if="!Object.keys(filterCardComponent).length" class="font-size-13 p0x-15px gray81 center_no_record_found">{{$t('UserTimesheet.no_records_found')}}</div>
                </div>
                <div v-else-if="cardTab === 2 && Object.keys(fieldArray)?.length">
                    <CardFieldComponent :cardType="fieldArray?.cardType" :componentId="fieldArray?.key" :isEditCard="isEditCard" :savedProjectMode="editProjectMode" :allProjectsArray="props.allProjectsArray" @closeSidebar="handleCardClose" :fieldsArray="fieldArray?.fields" ref="childRef" @handleFunction="handleCardAddOnDashboard"/>
                </div>
            </template>
        </AdvanceSearchModal>

        <!-- Import dashboard: hidden picker + replace-confirmation -->
        <input ref="importFileInput" type="file" accept="application/json,.json" class="d-none" @change="onImportFileChange" />
        <AdvanceSearchModal
            :modelValue="showImportConfirm"
            :header="true"
            :footer="true"
            :closeIcon="false"
            :showCloseIcon="false"
            :closeOnBackdrop="false"
            :styles="{ 'min-width': '440px', 'z-index': 12 }"
            @close="showImportConfirm = false; pendingImport = null"
        >
            <template #header><h3 class="m-0">{{ $t('dashboardCard.import_confirm_title') }}</h3></template>
            <template #body>
                <span class="font-size-13">{{ $t('dashboardCard.import_confirm_body', { n: pendingImport ? pendingImport.cards.length : 0, m: layout.length }) }}</span>
            </template>
            <template #footer>
                <div class="d-flex justify-content-end">
                    <button class="outline-secondary" @click="showImportConfirm = false; pendingImport = null">{{ $t('Projects.cancel') }}</button>
                    <button class="outline-primary ml-10px" @click="applyImport('merge')">{{ $t('dashboardCard.import_merge') }}</button>
                    <button class="btn-primary ml-10px" @click="applyImport('replace')">{{ $t('dashboardCard.import_replace') }}</button>
                </div>
            </template>
        </AdvanceSearchModal>
    </div>
</template>
<script setup>
    import {  ref, reactive, onMounted, onBeforeUnmount, inject, computed, watch,defineExpose, nextTick,provide } from 'vue';
    import { GridLayout, GridItem } from 'grid-layout-plus';
    import useCustomFieldImage from '@/composable/customFieldIcon.js';
    import AdvanceSearchModal from '@/components/atom/Modal/Modal.vue';
    import FeatureCard from '@/components/atom/FeatureCard/FeatureCard.vue';
    import DashBoardCard from '@/components/molecules/DashBoardCard/DashBoardCard.vue';
    import CardFieldComponent from '@/components/molecules/CardFieldComponent/CardFieldComponent.vue';
    import CalenderCompo from '@/components/atom/CalenderCompo/CalenderCompo.vue';

    //Charts
    import { useStore } from 'vuex';
    import { useI18n } from "vue-i18n";
    import * as env from '@/config/env';
    import { apiRequest } from '@/services';
    import { useToast } from 'vue-toast-notification';
    import InputText from "@/components/atom/InputText/InputText.vue";
    import { getCardsComponentsSize } from "@/composable/commonFunction";
    import PieChartCardComponent from "@/components/organisms/PieChartCardComponent/PieChartCardComponent.vue";
    import BarChartsCardComponent from "@/components/organisms/BarChartsCardComponent/BarChartsCardComponent.vue";
    import TotalTaskCardComponent from "@/components/organisms/TotalTaskCardComponent/TotalTaskCardComponent.vue";
    import StackBarChartCardComponent from "@/components/organisms/StackBarChartCardComponent/StackBarChartCardComponent.vue";
    import TimeEstimatedWorkloadComp from "@/components/atom/Dashboard/TimeEstimatedWorkloadComp.vue"
    import EmployeeWorkloadReportCard from "@/components/organisms/EmployeeWorkloadReportCard/EmployeeWorkloadReportCard.vue";
    import MetricSummaryCard from "@/components/organisms/MetricSummaryCard/MetricSummaryCard.vue";
    import ProjectPulseCard from "@/components/organisms/ProjectPulseCard/ProjectPulseCard.vue";
    import ActiveWorkTableCard from "@/components/organisms/ActiveWorkTableCard/ActiveWorkTableCard.vue";
    import FreeResourcesCard from "@/components/organisms/FreeResourcesCard/FreeResourcesCard.vue";
    import WorkedTasksTableCard from "@/components/organisms/WorkedTasksTableCard/WorkedTasksTableCard.vue";
    import TeamCategoryBreakdownCard from "@/components/organisms/TeamCategoryBreakdownCard/TeamCategoryBreakdownCard.vue";
    import TeamLoggedVsEtaCard from "@/components/organisms/TeamLoggedVsEtaCard/TeamLoggedVsEtaCard.vue";
    import ProjectMetricsCard from "@/components/organisms/ProjectMetricsCard/ProjectMetricsCard.vue";
    import ProjectResourceCard from "@/components/organisms/ProjectResourceCard/ProjectResourceCard.vue";
    import LiveWorkCard from "@/components/organisms/LiveWorkCard/LiveWorkCard.vue";
    import UsersByCategoryCard from "@/components/organisms/UsersByCategoryCard/UsersByCategoryCard.vue";
    import OnLeaveCard from "@/components/organisms/OnLeaveCard/OnLeaveCard.vue";
    import NextUpCard from "@/components/organisms/NextUpCard/NextUpCard.vue";
    import MyAchievementsCard from "@/components/organisms/MyAchievementsCard/MyAchievementsCard.vue";
    import TaskStatusSummaryCard from "@/components/organisms/TaskStatusSummaryCard/TaskStatusSummaryCard.vue";
    import MyLeaveCard from "@/components/organisms/MyLeaveCard/MyLeaveCard.vue";
    import DueSoonCard from "@/components/organisms/DueSoonCard/DueSoonCard.vue";
    import MyTimeCard from "@/components/organisms/MyTimeCard/MyTimeCard.vue";
    import MilestoneReportCard from "@/components/organisms/MilestoneReportCard/MilestoneReportCard.vue";
    import { useCustomComposable } from '@/composable';
    import { onBeforeRouteLeave } from 'vue-router';
    import { abortAllRequests } from "@/services";

    const { t } = useI18n();
    const $toast = useToast();
    const { getters } = useStore();
    const { getImageData } = useCustomFieldImage();
    const {checkPermission} = useCustomComposable()

    const taskStatusArray = computed(() => getters["settings/AllTaskStatus"]);
    const companyUserDetail = computed(() => getters["settings/companyUserDetail"]);
    const projectsGetter = computed(() => {
        const projects = getters["projectData/onlyActiveProjects"];
        if ([1, 2].includes(companyUserDetail.value?.roleType) === false) {
            return projects?.data?.filter((e) => e._id !== '6571e7195470e64b1203295c') || [];
        }
        return projects?.data || [];
    });
    provide("selectedProject", {});

    const props = defineProps({
        allProjectsArray: {
            type: Array,
            default: () => [],
            required: true
        },
        locked: {
            type: Boolean,
            default: false
        },
    });

    const userId = inject('$userId');
    const clientWidth = inject("$clientWidth");
    const cancelIcon = require("@/assets/images/cancel_icon.png");
    const backArrow = require("@/assets/images/svg/back_arrow.svg");

    const gridCol = ref(12);
    const layout = ref([]);
    const fieldArray = ref({});
    const isMoving = ref(false);
    const hoverIndex = ref(null);
    const editCardId = ref(null);
    // Per-card refresh counter. The chrome's refresh icon increments the
    // counter for that card; the resolved component watches its bound
    // `refreshTrigger` prop and re-fetches on every change. Keyed by
    // `item.i` (the card uid).
    const refreshKeys = reactive({});
    const handleRefreshCard = (id) => {
        refreshKeys[id] = (refreshKeys[id] || 0) + 1;
    };
    const cardComponent = ref([]);
    const filterCardComponent = ref([]);
    const currentLayout = ref({});
    const isEditCard = ref(false);
    // Saved project scope mode for the card being edited (not a catalog field).
    const editProjectMode = ref('');
    const isShowModal = ref(props.isShowModalToggle || false);
    const cardTab = ref(props.cardTabIndex || 0);
    const search = ref('');
    const isDataFetching = ref(false);
    const bindUpdates = (componentId) => {
        return ['TimeEstimatedWorkloadComp', 'TimeTrackComp', 'TimeEstimatedComp'].includes(componentId);
    };

    onBeforeRouteLeave((to, from, next) => {
        abortAllRequests();
        next();
    })
    watch(()=>props.isShowModalToggle, (newValue) => {
        isShowModal.value = newValue;
    });

    watch(()=>props.cardTabIndex, (newValue) => {
        cardTab.value = newValue;
    });
    onMounted(async()=>{
        isDataFetching.value = true;
        await Promise.all([getUserDashboard(),getCardComponent()]).catch(()=>{
            console.error('Failed to fetch dashboard and card component');
        });
        setTimeout(()=>{
            isDataFetching.value = false;
        },2000)
    });
    // Management-only dashboard cards (company-wide data) — visible only to
    // Owner/Admin (roleType 1/2). Hidden from the "Add card" catalog AND from
    // an already-saved layout for anyone below that.
    const MANAGEMENT_ONLY_CARDS = ['MilestoneReportCard', 'ActiveProjectsCard', 'ProjectsByTypeCard', 'RunningProjectsCard'];
    const isManagementUser = () => [1, 2].includes(companyUserDetail.value?.roleType);

    const getUserDashboard = async() => {
        try {
            const response = await apiRequest("get", `${env.DASHBOARD}/${userId.value}`);
            if (response?.data?.length > 0) {
                let cards = response.data[0].cards || [];
                currentLayout.value = response.data[0];
                // Drop management-only cards from a non-management user's saved
                // layout so any previously-added instance stops rendering.
                if (!isManagementUser()) {
                    cards = cards.filter((e) => !MANAGEMENT_ONLY_CARDS.includes(e.componentId));
                }
                if(cards) {
                    layout.value = cards.map((e) => ({...e.config.position,...(getCardsComponentsSize(e.componentId) ?? {}), i:e.uid,componentId:e.componentId, cardData: e.config.cardData, filterData: e.config.filterData}));
                }
            }
        } catch (error) {
            console.error(error)
        }
    };
    const structureCards = (cards,fieldType='cardType',onlyFeature=false) => {
        return cards.reduce((acc, card) => {
            acc.feature = cards;
            if(!onlyFeature) {
                if (!acc[card[fieldType]]) {
                    acc[card[fieldType]] = [];
                }
                acc[card[fieldType]].push({
                    ...card
                });  
            }
            return acc;
        }, {});
    }
    const getCardComponent = async() => {
        try {
            const response = await apiRequest("get", `${env.CARDCOMPONENT}`);
            if (response?.data?.length > 0) {
                let cardsArray = checkPermission('sheet_settings.workload_timesheet') !== null ? response?.data : response?.data?.filter((e)=> !["TimeEstimatedWorkloadComp","TimeTrackComp","TimeEstimatedComp"].includes(e.key))
                // Management-only cards — hide from the "Add card" catalog for
                // anyone below Owner/Admin (roleType 1/2).
                if (!isManagementUser()) {
                    cardsArray = cardsArray?.filter((e) => !MANAGEMENT_ONLY_CARDS.includes(e.key));
                }
                cardComponent.value = JSON.parse(JSON.stringify(cardsArray));
                filterCardComponent.value = structureCards(cardsArray);
            }
        } catch (error) {
            console.error(error)
        }
    };
    const CalendarComponent = inject("CalendarComponent");
    const QueueListComponent = inject("QueueListComponent");
    const DashBoardList = inject("DashBoardList");    

    const getComponent = (type) => {
        switch (type) {
            case 'QueueListComp':
                return QueueListComponent;
            case 'TasksByAssigneePieChartCard':
                return PieChartCardComponent;
            case 'TasksByAssigneeStackBarChartCard':
                return StackBarChartCardComponent;
            case 'TasksByAssigneeBarChartCard':
                return BarChartsCardComponent;
            case 'WorkloadByStatusStackBarChartCard':
                return StackBarChartCardComponent;
            case 'WorkloadByStatusPieChartCard':
                return PieChartCardComponent;
            case 'WorkloadByStatusBarChartCard':
                return BarChartsCardComponent;
            case 'TASKLIST':
                return DashBoardList;
            case 'CalendarCard':
                return CalendarComponent;
            case 'TotalUrgentTasksComp':
                return TotalTaskCardComponent;
            case 'TimeEstimatedComp':
            case 'TimeTrackComp':
            case 'TimeEstimatedWorkloadComp':
                return TimeEstimatedWorkloadComp;
            case 'EmployeeWorkloadReportCard':
                return EmployeeWorkloadReportCard;
            case 'TasksByStatusCard':
            case 'TasksByProjectCard':
            case 'TotalTasksCard':
                return MetricSummaryCard;
            case 'ProjectPulseCard':
                return ProjectPulseCard;
            case 'ActiveWorkTableCard':
                return ActiveWorkTableCard;
            case 'FreeResourcesCard':
                return FreeResourcesCard;
            case 'WorkedTasksTableCard':
                return WorkedTasksTableCard;
            case 'TeamCategoryBreakdownCard':
                return TeamCategoryBreakdownCard;
            case 'TeamLoggedVsEtaCard':
                return TeamLoggedVsEtaCard;
            case 'ActiveProjectsCard':
            case 'ProjectsByTypeCard':
                return ProjectMetricsCard;
            case 'RunningProjectsCard':
                return ProjectResourceCard;
            case 'LiveWorkTableCard':
                return LiveWorkCard;
            case 'UsersByCategoryCard':
                return UsersByCategoryCard;
            case 'OnLeaveCard':
                return OnLeaveCard;
            case 'NextUpCard':
                return NextUpCard;
            case 'MyAchievementsCard':
                return MyAchievementsCard;
            case 'TaskStatusSummaryCard':
                return TaskStatusSummaryCard;
            case 'MyLeaveCard':
                return MyLeaveCard;
            case 'DueSoonCard':
                return DueSoonCard;
            case 'MyTimeCard':
                return MyTimeCard;
            case 'MilestoneReportCard':
                return MilestoneReportCard;
            default:
                return null;
        }
    };
    const findNextCardPositionOnLayout = (w, h) => {
        let gridMap = new Map();
        let maxY = 0;

        layout.value.forEach(item => {
            maxY = Math.max(maxY, item.y + item.h);
            for (let dx = 0; dx < item.w; dx++) {
                for (let dy = 0; dy < item.h; dy++) {
                    let key = `${item.x + dx},${item.y + dy}`;
                    gridMap.set(key, true);
                }
            }
        });

        let x = 0, y = 0;
        // eslint-disable-next-line
        while (true) {
            let fits = true;

            for (let dx = 0; dx < w; dx++) {
                for (let dy = 0; dy < h; dy++) {
                    let key = `${x + dx},${y + dy}`;
                    if (gridMap.has(key)) {
                        fits = false;
                        break;
                    }
                }
                if (!fits) break;
            }

            if (fits) {
                return { x, y };
            }

            x += w;

            if (x + w > gridCol.value) {
                x = 0;
                y += h;
            }
        }
    }
    // eslint-disable-next-line
    const handleCardAddOnDashboard = async(updateObject = null,filterData = null) => {
        try {
            delete updateObject?.filter;
            filterData = filterData.filter((e) => e.comparisonsData.length > 0);
            if(isEditCard.value) {
                let bodyData = {
                    queryObject:[
                        {
                            userId: userId.value,
                            templateId: currentLayout.value.templateId,
                            "cards.uid": editCardId.value
                        },
                        {
                            $set: { 
                                "cards.$.config.cardData": updateObject,
                                "cards.$.config.filterData": filterData
                            }
                        },
                        { new: true, useFindAndModify: false }
                    ],
                    method:"findOneAndUpdate",
                    userId: userId.value
                }
                const response = await apiRequest("post", `${env.DASHBOARD}`,bodyData);
                if(response) {
                    let findIndex = layout.value.findIndex((e)=>e.i === editCardId.value);
                    if(findIndex > -1) {
                        layout.value[findIndex] = {...layout.value[findIndex],cardData:{...(layout.value[findIndex]?.cardData ?? {}),...updateObject},filterData: filterData};
                    }
                    $toast.success("Dashboard Updated Successfully",{position: 'top-right'});
                    currentLayout.value = response.data?.data;
                    isShowModal.value = false;
                    fieldArray.value = {};
                    editCardId.value = null;
                }
            } else {
                let makeUid = makeUniqueId();
                let minMax = getCardsComponentsSize(fieldArray.value.key) ?? {"minW": 3,"maxW": 12,"minH": 5,"maxH": 18};
                let newPosition = findNextCardPositionOnLayout(3,5,gridCol.value);
                let posi = {
                    "x": newPosition.x ? newPosition.x : (layout.value.length * 2) % (gridCol.value || 12),
                    "y": newPosition.y ? newPosition.y : layout.value.length + (gridCol.value || 12),
                    "w": 3,
                    "h": 5,
                    ...minMax
                }
                let object = {
                    "componentId": fieldArray.value.key,
                    "cardId": fieldArray.value._id,
                    "uid": makeUid,
                    "config": {
                        "cardData": updateObject,
                        "position": posi,
                        "filterData" : filterData
                    }
                }
        
                let bodyData = {
                    queryObject:[
                        {
                            userId: userId.value,
                            templateId: currentLayout.value.templateId,
                        },
                        {
                            $push: {
                                cards: {
                                    ...object
                                }
                            }
                        },
                        { new: true, useFindAndModify: false }
                    ],
                    method:"findOneAndUpdate",
                    userId: userId.value
                }
                const response = await apiRequest("post", `${env.DASHBOARD}`,bodyData);
                if(response) {
                    currentLayout.value = response.data?.data;
                    layout.value.push({...posi,i:makeUid,componentId:fieldArray.value.key, cardData: updateObject, filterData: filterData});
                    isShowModal.value = false;
                    fieldArray.value = {};
                    $toast.success("Dashboard Updated Successfully",{position: 'top-right'});
                    scrollToCard(makeUid);
                }
            }
            handleCardClose();
        } catch (error) {
            console.error(error)
            isShowModal.value = false;
            isEditCard.value = false;
            editCardId.value = null;
            fieldArray.value = {};            
        }
    }

    const scrollToCard = (cardId) => {
        nextTick(() => {
            const cardElement = document.getElementsByClassName(`${cardId}`)?.[0];            
            if (cardElement) {
                cardElement.scrollIntoView({ 
                    behavior: 'smooth', 
                    block: 'center' 
                });
            }
        });
    }

    function makeUniqueId() {
        return Math.floor(100000000 + Math.random() * 900000000).toString();
    }
    const updatePosition = async(card) => {
        try {
            let bodyData = {
                queryObject:[
                    {
                        userId: userId.value,
                        templateId: currentLayout.value.templateId
                    },
                    {
                        $set: {
                            cards: card
                        }
                    },
                    { new: true, useFindAndModify: false }
                ],
                method:"findOneAndUpdate",
                userId: userId.value
            }
            const response = await apiRequest("post", `${env.DASHBOARD}`,bodyData);
            currentLayout.value = response.data?.data;
        } catch (error) {
            console.error(error)
        }
    };
    const handleEditCardSettings = (cardId,cardData,uid,filterData) => {
        try {
            let fields = cardComponent.value.find((e)=>e.key === cardId)?.fields;
            if(!fields) {
                console.error('No fields found for this card');
                return;
            }

            isEditCard.value = true;
            editCardId.value = uid;
            editProjectMode.value = cardData?.projectMode || '';
            fields.forEach(element => {
                if(element.name === 'filter') {
                    if (filterData && filterData.length > 0) {
                        element.value = Array.isArray(filterData) ? filterData : Object.values(filterData);
                    }
                    else{
                        element.value = [];
                    }
                } else {
                    if(Object.prototype.hasOwnProperty.call(cardData, element.name)) {
                        element.value = cardData[element.name];
                    }
                }
            });
            fieldArray.value = {...cardComponent.value.find((e)=>e.key === cardId), fields:fields};
            isShowModal.value = true;
            cardTab.value = 2;
        } catch (error) {
            isEditCard.value = false;
            editCardId.value = null;
            console.error(error);
        }
    };
    const handleRemoveCard = async(cardId) => {
        let cardIndex = layout.value.findIndex((e) => e.i == cardId);
        layout.value.splice(cardIndex, 1);
        try {
            let bodyData = {
                queryObject:[
                    {
                        userId: userId.value,
                        templateId: currentLayout.value.templateId,
                        "cards.uid": cardId
                    },
                    {
                        $pull: {
                            cards: { uid: cardId }
                        }
                    },
                    { new: true, useFindAndModify: false }
                ],
                method:"findOneAndUpdate",
                userId: userId.value
            }
            const response = await apiRequest("post", `${env.DASHBOARD}`,bodyData);
            $toast.success("Dashboard Updated Successfully",{position: 'top-right'});
            currentLayout.value = response.data;
        } catch (error) {
            console.error(error)
        }
    };
    const resize = () => {
        isMoving.value = true;
    };
    const move = () => {
        isMoving.value = true;
    };

    // Auto-scroll while dragging/resizing a card near a viewport edge.
    // grid-layout-plus maps the pointer to viewport coords with no auto-scroll,
    // so a card at the bottom of the screen can't be grown/moved past the edge —
    // the cursor can't travel below the screen and nothing scrolls. We nudge the
    // dashboard's scroll host when the cursor nears the top/bottom edge.
    // ponytail: fixed 60px edge zone; find the scroll host lazily per drag.
    const EDGE = 60;
    let scrollHost = null;
    let scrollVy = 0;
    let scrollRAF = 0;
    const getScrollHost = () => {
        const grid = document.querySelector('.vgl-layout');
        let el = grid ? grid.parentElement : null;
        while (el && el !== document.body) {
            const oy = getComputedStyle(el).overflowY;
            if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) return el;
            el = el.parentElement;
        }
        return document.scrollingElement || document.documentElement;
    };
    const scrollTick = () => {
        if (!scrollVy || !isMoving.value || !scrollHost) { scrollRAF = 0; return; }
        scrollHost.scrollTop += scrollVy;
        scrollRAF = requestAnimationFrame(scrollTick);
    };
    const onDragPointerMove = (e) => {
        if (!isMoving.value) { scrollVy = 0; scrollHost = null; return; }
        if (!scrollHost) scrollHost = getScrollHost();
        const fromBottom = window.innerHeight - e.clientY;
        if (fromBottom < EDGE) scrollVy = Math.ceil((EDGE - fromBottom) / 3);
        else if (e.clientY < EDGE) scrollVy = -Math.ceil((EDGE - e.clientY) / 3);
        else scrollVy = 0;
        if (scrollVy && !scrollRAF) scrollRAF = requestAnimationFrame(scrollTick);
    };
    onMounted(() => document.addEventListener('pointermove', onDragPointerMove, true));
    onBeforeUnmount(() => {
        document.removeEventListener('pointermove', onDragPointerMove, true);
        if (scrollRAF) cancelAnimationFrame(scrollRAF);
    });
    const layoutUpdatedEvent = async(newLayout) => {
        try {
            if(!isMoving.value) return;
            let cLayout = currentLayout.value?.data ? currentLayout.value.data : (currentLayout.value ?? {})
            if (!cLayout || !cLayout.cards) {
                return;
            }
    
            let updatedLayout = JSON.parse(JSON.stringify(cLayout));
            
            updatedLayout.cards = updatedLayout.cards.map((card) => {
                const updatedPosition = newLayout.find((layout) => layout.i === card.uid);
    
                if (updatedPosition) {
                    return {
                        ...card,
                        config: {
                            ...card.config,
                            position: {
                                ...card.config.position,
                                x: updatedPosition.x,
                                y: updatedPosition.y,
                                w: updatedPosition.w,
                                h: updatedPosition.h,
                            },
                        },
                    };
                }
    
                return card;
            });
            
            await updatePosition(updatedLayout.cards);
            isMoving.value = false;
        } catch (error) {
            console.error(error)
            isMoving.value = false;
        }
    };
    const onHover = (value) => {
        hoverIndex.value = value;
    };
    const onLeave = () => {
        hoverIndex.value = null;
    };
    const handleCard = (val) => {
        fieldArray.value = val;
        editProjectMode.value = ''; // new card → CardFieldComponent defaults to 'all'
        cardTab.value = 2;
    };
    const handleCardClose = () => {
        isShowModal.value = false;
        if(isEditCard.value === true) {
            isEditCard.value = false;
            editCardId.value = null;
            fieldArray.value = {};
        }
    }
    const handleToggle = () => {
        isShowModal.value = true;
        cardTab.value = 1;
        fieldArray.value = {};
    };
    const searchFunction = () => {
        let dataArray = structureCards(cardComponent.value)
        filterCardComponent.value = dataArray;
        if(search.value.trim().length > 0) {
            filterCardComponent.value = structureCards(cardComponent.value.filter(item => t(`dashboardCard.${item.name}`).toLowerCase().includes(search.value.toLowerCase())),'',true);
        }
    };
    const handleUpdateFromCard = async(data) => {
        let {id:editCardId,updateObject} = data;
        let bodyData = {
            queryObject:[
                {
                    userId: userId.value,
                    templateId: currentLayout.value.templateId,
                    "cards.uid": editCardId
                },
                {
                    $set: { 
                        "cards.$.config.cardData": updateObject
                    }
                },
                { new: true, useFindAndModify: false }
            ],
            method:"findOneAndUpdate",
            userId: userId.value
        }
        const response = await apiRequest("post", `${env.DASHBOARD}`,bodyData);
        if(response) {
            let findIndex = layout.value.findIndex((e)=>e.i === editCardId)
            if(findIndex > -1) {
                layout.value[findIndex] = {...layout.value[findIndex],cardData:{...(layout.value[findIndex]?.cardData ?? {}),...updateObject}};
            }
            $toast.success("Dashboard Updated Successfully",{position: 'top-right'});
            currentLayout.value = response.data?.data;
        }
    }
    // Cards that get the header refresh icon (reload latest data) — every
    // self-fetching card we've added reacts to the refreshTrigger prop.
    const isRefreshable = (cid) => [
        'EmployeeWorkloadReportCard', 'ActiveProjectsCard', 'ProjectsByTypeCard',
        'RunningProjectsCard', 'LiveWorkTableCard', 'UsersByCategoryCard', 'OnLeaveCard',
        'ProjectPulseCard', 'ActiveWorkTableCard', 'FreeResourcesCard',
        'WorkedTasksTableCard', 'TeamCategoryBreakdownCard', 'TeamLoggedVsEtaCard',
        'TasksByStatusCard', 'TasksByProjectCard', 'TotalTasksCard',
        'NextUpCard', 'MyAchievementsCard', 'MyLeaveCard', 'DueSoonCard', 'MyTimeCard',
        'MilestoneReportCard', 'TaskStatusSummaryCard', 'TASKLIST',
    ].includes(cid);

    // ── Dashboard-level date range ──────────────────────────────────
    // Provided to every card; a card whose period is "Auto" (timerange 0)
    // resolves its window from here and re-fetches when it changes.
    // Persisted per user in localStorage.
    const rangeStoreKey = () => `dashboardGlobalRange_${(userId && userId.value) || ''}`;
    const defaultGlobalRange = () => {
        const now = new Date();
        const day = now.getDay() === 0 ? 6 : now.getDay() - 1; // Mon-based week
        const start = new Date(now); start.setDate(now.getDate() - day); start.setHours(0, 0, 0, 0);
        const end = new Date(now); end.setHours(23, 59, 59, 999);
        return { dateFrom: start.toISOString(), dateTo: end.toISOString() };
    };
    const globalRange = ref(defaultGlobalRange());
    try {
        const saved = JSON.parse(localStorage.getItem(rangeStoreKey()) || 'null');
        if (saved && saved.dateFrom && saved.dateTo) globalRange.value = saved;
    } catch (e) { /* corrupted entry — keep the default week */ }
    provide('dashboardGlobalRange', globalRange);

    // CalenderCompo (range mode) works with a [startDate, endDate] pair.
    const globalRangeModel = computed(() => [
        new Date(globalRange.value.dateFrom),
        new Date(globalRange.value.dateTo),
    ]);
    const setGlobalRange = (range) => {
        if (!Array.isArray(range) || !range[0] || !range[1]) return;
        const from = new Date(range[0]);
        from.setHours(0, 0, 0, 0);
        const to = new Date(range[1]);
        to.setHours(23, 59, 59, 999);
        globalRange.value = { dateFrom: from.toISOString(), dateTo: to.toISOString() };
        try { localStorage.setItem(rangeStoreKey(), JSON.stringify(globalRange.value)); } catch (e) { /* storage full/blocked */ }
    };

    // AHE-3789 — inline header time-period selector for the activity cards
    // (moved out of the settings modal). The selection is stored in the card's
    // own cardData.timerange, so it persists and the card re-fetches on change.
    // Id 0 = "Auto" → the card follows the dashboard-level range above.
    const PROJECT_PERIOD_CARDS = [
        'RunningProjectsCard', 'UsersByCategoryCard', 'ProjectPulseCard',
        'WorkedTasksTableCard', 'TeamCategoryBreakdownCard', 'TeamLoggedVsEtaCard', 'OnLeaveCard',
        'MyAchievementsCard', 'MyTimeCard', 'MilestoneReportCard', 'TaskStatusSummaryCard',
    ];
    const PROJECT_PERIOD_OPTIONS = [
        { id: 0, label: 'Auto' },
        { id: 1, label: 'Today' }, { id: 2, label: 'Yesterday' }, { id: 3, label: 'This Week' }, { id: 4, label: 'Last Week' },
        { id: 5, label: 'This Month' }, { id: 6, label: 'Last Month' }, { id: 7, label: 'This Year' }, { id: 8, label: 'Last 30 Days' },
    ];
    const PROJECT_PERIOD_DEFAULT = {
        RunningProjectsCard: 1, UsersByCategoryCard: 3, ProjectPulseCard: 1,
        WorkedTasksTableCard: 3, TeamCategoryBreakdownCard: 3, TeamLoggedVsEtaCard: 3, OnLeaveCard: 1,
        MyAchievementsCard: 5, MyTimeCard: 3, MilestoneReportCard: 5, TaskStatusSummaryCard: 3, TASKLIST: 0,
    };
    // TASKLIST shows the period dropdown only when its date-range toggle is on.
    const periodOptionsFor = (item) => {
        const cid = item && item.componentId;
        if (cid === 'TASKLIST') {
            return (item.cardData && item.cardData.enableDateRange) ? PROJECT_PERIOD_OPTIONS : [];
        }
        return PROJECT_PERIOD_CARDS.includes(cid) ? PROJECT_PERIOD_OPTIONS : [];
    };
    const periodValueFor = (item) => {
        // NOTE: can't use `|| default` — 0 (Auto) is a valid saved value.
        const v = Number(item && item.cardData && item.cardData.timerange);
        if (Number.isFinite(v) && v >= 0 && v <= 8) return v;
        return PROJECT_PERIOD_DEFAULT[item && item.componentId] || 1;
    };
    const handlePeriodChange = async (item, val) => {
        const idx = layout.value.findIndex((e) => e.i === item.i);
        if (idx < 0) return;
        const updateObject = { ...(layout.value[idx].cardData || {}), timerange: Number(val) };
        layout.value[idx] = { ...layout.value[idx], cardData: updateObject };
        try {
            await apiRequest('post', `${env.DASHBOARD}`, {
                queryObject: [
                    { userId: userId.value, templateId: currentLayout.value.templateId, 'cards.uid': item.i },
                    { $set: { 'cards.$.config.cardData': updateObject } },
                    { new: true, useFindAndModify: false },
                ],
                method: 'findOneAndUpdate',
                userId: userId.value,
            });
        } catch (e) {
            console.error('Failed to persist card period change', e);
        }
    };

    // ── Export / Import dashboard (gear menu in the Home header) ──────
    // File-based sharing: export the current cards + layout to a .json the
    // user can hand to a teammate, who imports it onto their OWN dashboard
    // (replace, with confirmation). Reuses the existing updateDashboard
    // passthrough — no backend change.
    const importFileInput = ref(null);
    const showImportConfirm = ref(false);
    const pendingImport = ref(null); // { cards, dropped }

    const cardIdFor = (componentId) => cardComponent.value.find((c) => c.key === componentId)?._id || '';

    const exportDashboard = () => {
        try {
            const cards = layout.value.map((item) => ({
                componentId: item.componentId,
                cardId: cardIdFor(item.componentId),
                uid: item.i,
                config: {
                    cardData: item.cardData ?? {},
                    position: { x: item.x, y: item.y, w: item.w, h: item.h, minW: item.minW, maxW: item.maxW, minH: item.minH, maxH: item.maxH },
                    filterData: item.filterData ?? [],
                },
            }));
            if (!cards.length) {
                $toast.error(t('dashboardCard.export_empty'), { position: 'top-right' });
                return;
            }
            const payload = { type: 'alianhub-dashboard', version: 1, exportedAt: new Date().toISOString(), cardCount: cards.length, cards };
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `alianhub-dashboard-${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error('exportDashboard error', e);
            $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
        }
    };

    // Keep only cards whose componentId is a real, resolvable card in this
    // build — a stale or foreign export can't inject unknown/invalid cards.
    // uids are regenerated so they never collide within the target doc.
    const sanitizeImportedCards = (parsed) => {
        if (!parsed || parsed.type !== 'alianhub-dashboard' || !Array.isArray(parsed.cards)) return { cards: [], dropped: 0 };
        const MAX_CARDS = 60;
        let dropped = 0;
        const cards = [];
        parsed.cards.forEach((c) => {
            const componentId = c && c.componentId;
            const known = componentId && cardComponent.value.some((cc) => cc.key === componentId) && getComponent(componentId) !== null;
            if (!known || cards.length >= MAX_CARDS) { dropped += 1; return; }
            const size = getCardsComponentsSize(componentId) ?? { minW: 3, maxW: 12, minH: 5, maxH: 18 };
            const pos = (c.config && c.config.position) || {};
            cards.push({
                componentId,
                cardId: cardIdFor(componentId) || (c.cardId || ''),
                uid: makeUniqueId(),
                config: {
                    cardData: (c.config && c.config.cardData) || {},
                    position: {
                        x: Number.isFinite(pos.x) ? pos.x : 0,
                        y: Number.isFinite(pos.y) ? pos.y : 0,
                        w: Number.isFinite(pos.w) ? pos.w : 3,
                        h: Number.isFinite(pos.h) ? pos.h : 5,
                        ...size,
                    },
                    filterData: Array.isArray(c.config && c.config.filterData) ? c.config.filterData : [],
                },
            });
        });
        return { cards, dropped };
    };

    const triggerImport = () => {
        if (importFileInput.value) {
            importFileInput.value.value = '';
            importFileInput.value.click();
        }
    };
    const onImportFileChange = (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const result = sanitizeImportedCards(JSON.parse(reader.result));
                if (!result.cards.length) {
                    $toast.error(t('dashboardCard.import_invalid'), { position: 'top-right' });
                    return;
                }
                pendingImport.value = result;
                showImportConfirm.value = true;
            } catch (err) {
                console.error('import parse error', err);
                $toast.error(t('dashboardCard.import_invalid'), { position: 'top-right' });
            }
        };
        reader.readAsText(file);
    };

    // Map a persisted card doc → the in-memory layout item shape.
    const cardToLayoutItem = (e) => ({ ...e.config.position, ...(getCardsComponentsSize(e.componentId) ?? {}), i: e.uid, componentId: e.componentId, cardData: e.config.cardData, filterData: e.config.filterData });
    // Map a current layout item → the persisted card doc shape.
    const layoutItemToCard = (item) => ({
        componentId: item.componentId,
        cardId: cardIdFor(item.componentId),
        uid: item.i,
        config: {
            cardData: item.cardData ?? {},
            position: { x: item.x, y: item.y, w: item.w, h: item.h, minW: item.minW, maxW: item.maxW, minH: item.minH, maxH: item.maxH },
            filterData: item.filterData ?? [],
        },
    });

    // mode: 'replace' → swap the dashboard for the file's cards.
    //       'merge'   → keep current cards and append the file's cards BELOW
    //                   them (shifted past the current bottom; vertical-compact
    //                   then tidies any gap). uids are already regenerated in
    //                   sanitize, so appended cards can't collide.
    const applyImport = async (mode = 'replace') => {
        if (!pendingImport.value) return;
        const dropped = pendingImport.value.dropped;
        let cards;
        if (mode === 'merge') {
            const existing = layout.value.map(layoutItemToCard);
            const baseY = layout.value.reduce((m, it) => Math.max(m, (it.y || 0) + (it.h || 0)), 0);
            const appended = pendingImport.value.cards.map((c) => ({
                ...c,
                config: { ...c.config, position: { ...c.config.position, y: (c.config.position.y || 0) + baseY } },
            }));
            cards = [...existing, ...appended];
        } else {
            cards = pendingImport.value.cards;
        }
        try {
            const response = await apiRequest('post', `${env.DASHBOARD}`, {
                queryObject: [
                    { userId: userId.value, templateId: currentLayout.value.templateId },
                    { $set: { cards } },
                    { new: true, useFindAndModify: false },
                ],
                method: 'findOneAndUpdate',
                userId: userId.value,
            });
            if (response) {
                currentLayout.value = response.data?.data || currentLayout.value;
                layout.value = cards.map(cardToLayoutItem);
                cards.forEach((e) => { refreshKeys[e.uid] = (refreshKeys[e.uid] || 0) + 1; });
                const added = pendingImport.value.cards.length;
                const msg = mode === 'merge'
                    ? t('dashboardCard.import_merge_success', { n: added })
                    : (dropped ? t('dashboardCard.import_success_dropped', { n: dropped }) : t('dashboardCard.import_success'));
                $toast.success(msg, { position: 'top-right' });
            }
        } catch (e) {
            console.error('applyImport error', e);
            $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
        } finally {
            showImportConfirm.value = false;
            pendingImport.value = null;
        }
    };

    defineExpose({ handleToggle, exportDashboard, triggerImport });
</script>
<style>
    .dashboard-range-bar {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px 4px 10px;
        flex-wrap: wrap;
    }
    .dashboard-range-label {
        font-size: 12px;
        font-weight: 600;
        color: #3a3f52;
    }
    .dashboard-range-picker {
        min-width: 210px;
        max-width: 260px;
    }
    .dashboard-range-picker .dp__input {
        font-size: 12px;
        color: #3a3f52;
        border: 1px solid #e5e7eb;
        border-radius: 6px;
        padding-top: 4px;
        padding-bottom: 4px;
        transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }
    .dashboard-range-picker .dp__input:hover {
        border-color: #c7ccd9;
    }
    .dashboard-range-picker .dp__input:focus {
        border-color: #2F3990;
        box-shadow: 0 0 0 2px rgba(47, 57, 144, 0.12);
    }
    .dashboard-range-hint {
        font-size: 11px;
        color: #9aa0b4;
    }
    .center_no_record_found {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
    }
    .vgl-layout {
        background-color: #f5f3f3;
        user-select: none;
    }
    .empty-layout {
        height: calc(100vh - 106px) !important;
    }
    :deep(.vgl-item:not(.vgl-item--placeholder)) {
        background-color: #ccc;
        border: 1px solid black;
    }
    :deep(.vgl-item--resizing) {
        opacity: 90%;
    }
    :deep(.vgl-item--static) {
        background-color: #cce;
    }
    .layout-json {
        padding: 10px;
        margin-top: 10px;
        background-color: #ddd;
        border: 1px solid black;
    }
    .columns {
        columns: 120px;
    }
    .vgl-layout.grid_bg::before {
        position: absolute;
        width: calc(100% - 5px);
        height: calc(100% - 5px);
        margin: 5px;
        content: '';
        background-image: linear-gradient(to right, lightgrey 1px, transparent 1px),
            linear-gradient(to bottom, lightgrey 1px, transparent 1px);
            background-size: calc(calc(100% - 5px) / 12) 40px;
        background-repeat: repeat;
    }
    .vgl-item__resizer:before {
        right: 0;
        bottom: 0;
        border-style: solid;
        border-width: 0 0 10px 10px;
        border-color: transparent;
        z-index: 20;
        overflow: hidden;
    }
    .grid_layout_hover .vgl-item__resizer:before {
        border-color: transparent transparent #bbbbbb;
        border-bottom-color:#bbbbbb;
    }
    .vgl-item--placeholder {
        background-color: #D4D4D4;
        opacity: 1;
        border-radius: 12px;
    }
    .card-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(270px, 1fr));
        row-gap: 24px;
        column-gap: 24px;
    }
    .category_title {
        font-size: 24px;
        font-weight: 600;
        padding-bottom: 16px !important;
        display: block;
    }
    @media(max-width:1199px){
        .card-grid {
            grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
            row-gap: 24px;
            column-gap: 20px;
        }
    }
</style>