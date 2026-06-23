<template>
    <div class="w-100">
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
                            :showRefresh="item.componentId === 'EmployeeWorkloadReportCard'"
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
                        :showRefresh="item.componentId === 'EmployeeWorkloadReportCard'"
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
                    <CardFieldComponent :cardType="fieldArray?.cardType" :componentId="fieldArray?.key" :isEditCard="isEditCard" :allProjectsArray="props.allProjectsArray" @closeSidebar="handleCardClose" :fieldsArray="fieldArray?.fields" ref="childRef" @handleFunction="handleCardAddOnDashboard"/>
                </div>
            </template>
        </AdvanceSearchModal>
    </div>
</template>
<script setup>
    import {  ref, reactive, onMounted, inject, computed, watch,defineExpose, nextTick,provide } from 'vue';
    import { GridLayout, GridItem } from 'grid-layout-plus';
    import useCustomFieldImage from '@/composable/customFieldIcon.js';
    import AdvanceSearchModal from '@/components/atom/Modal/Modal.vue';
    import FeatureCard from '@/components/atom/FeatureCard/FeatureCard.vue';
    import DashBoardCard from '@/components/molecules/DashBoardCard/DashBoardCard.vue';
    import CardFieldComponent from '@/components/molecules/CardFieldComponent/CardFieldComponent.vue';

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
    const getUserDashboard = async() => {
        try {
            const response = await apiRequest("get", `${env.DASHBOARD}/${userId.value}`);
            if (response?.data?.length > 0) {
                const cards = response.data[0].cards || [];
                currentLayout.value = response.data[0];
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
    defineExpose({ handleToggle });
</script>
<style>
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