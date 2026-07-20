<template>
    <div class="d-flex align-items-center justify-content-center h-100 border-radius-8-px">
        <div>
            <div class="font-size-24 black font-weight-bold text-center" v-if="!isDataFetching">{{ taskRange }}</div>
            <div class="font-size-24 black font-weight-bold text-center" v-else>
                <SkelatonVue v-for="index in 1" :key="index"  :style="{height: '45px', width: '160px', borderRadius:'5px', margin: '5px 0px 5px 5px'}" :class="{}"/>
            </div>
            <div class="font-size-24 black font-weight-bold" v-if="cardDataObject?.measure === 3">{{ cardDataObject?.taskLabel }}</div>
        </div>
    </div>
</template>

<script setup>
    import { ref, watch, inject } from 'vue';
    import { useStore } from "vuex";
    import * as env from '@/config/env';
    import { apiRequest } from '@/services';
    import SkelatonVue from '@/components/atom/Skelaton/Skelaton.vue';
    import { useCustomComposable } from "@/composable";
    import { getConvertedTimeString, buildFilterQuery, getTimeRange, teamIdToUserId } from "@/composable/commonFunction";

    const props = defineProps({
        companyUserDetail: {
            type: Object,
            default: () => { }
        },
        cardUID: {
            type: String,
            required: true
        },
        cardData: {
            type: Object,
            default: () => { }
        },
        allProjectsArrayFilter: {
            type: Array,
            default: () => []
        },
        taskStatusArray: {
            type: Object,
            default: () => {}
        },
        componentId: {
            type: String,
            default: ''
        },
        filterData: {
            type: Object,
            default: () => {}
        }
    });

    const taskRange = ref(null); 
    const filterQuery = ref([]);
    const isDataFetching = ref(false);
    const cardDataObject = ref(JSON.parse(JSON.stringify(props.cardData || {})));
    const userId = inject('$userId');
    const {checkPermission} = useCustomComposable();
    const { getters } = useStore();
    const teamsArr = getters["settings/teams"];

    const init = () => {
        try {    
            isDataFetching.value = true;
            const calculationQueries = {
                1: { totalEstimatedTime: { $sum: cardDataObject.value.measure === 1 ? "$EstimatedTime" : "$LogTimeDuration"} },
                2: { totalEstimatedTime: { $avg: cardDataObject.value.measure === 1 ? "$EstimatedTime" : "$LogTimeDuration" } },
                3: { totalEstimatedTime: { $push: cardDataObject.value.measure === 1 ? "$EstimatedTime" : "$LogTimeDuration" } },
                4: { totalEstimatedTime: { $min: cardDataObject.value.measure === 1 ? "$EstimatedTime" : "$LogTimeDuration" } },
                5: { totalEstimatedTime: { $max: cardDataObject.value.measure === 1 ? "$EstimatedTime" : "$LogTimeDuration" } },
                6: { minEstimatedTime: { $min: cardDataObject.value.measure === 1 ? "$EstimatedTime" : "$LogTimeDuration" }, maxEstimatedTime: { $max: cardDataObject.value.measure === 1 ? "$EstimatedTime" : "$LogTimeDuration" } },
            };
            if(!(cardDataObject.value.measure === 1 || cardDataObject.value.measure === 2)) {
                if(!filterQuery.value?.$and) {
                    filterQuery.value.$and = [];
                }
                const pExclude = (cardDataObject.value.projectMode === 'exclude') && (cardDataObject.value.projectId || []).length;
                filterQuery.value.$and.push({ ProjectID: { objId: pExclude ? { $nin: cardDataObject.value.projectId } : { $in: cardDataObject.value.projectId } } },cardDataObject.value.isParentTask === true ? {} : { isParentTask: !cardDataObject.value.isParentTask },{ deletedStatusKey:0 });
            }
            let timeuserId = [];
            if(checkPermission('sheet_settings.workload_timesheet') === 2 || checkPermission('sheet_settings.workload_timesheet') === true) {
                timeuserId = cardDataObject.value.AssigneeUserId;
            } else if(checkPermission('sheet_settings.workload_timesheet') === 1) {
                timeuserId = userId.value ? [userId.value] : []
            } else {
                timeuserId = [];
            }

            let timeSheetUserId = [];
            if(checkPermission('sheet_settings.tracker_timesheet') === 2 || checkPermission('sheet_settings.tracker_timesheet') === true) {
                timeSheetUserId = cardDataObject.value.AssigneeUserId;
            } else if(checkPermission('sheet_settings.tracker_timesheet') === 1) {
                timeSheetUserId = userId.value ? [userId.value] : []
            } else {
                timeSheetUserId = [];
            }

            let timeRange = getTimeRange(cardDataObject.value?.timerange ?? 3);
            let start = timeRange.start;
            let end = timeRange.end;

            let projectStatsQuery = [
                ...(cardDataObject.value.measure === 1 || cardDataObject.value.measure === 2
                    ? [
                        { $match: {
                            ProjectId: (cardDataObject.value.projectMode === 'exclude' && (cardDataObject.value.projectId || []).length) ? { $nin: cardDataObject.value.projectId } : { $in: cardDataObject.value.projectId },
                            ...(cardDataObject.value.measure === 2 && {LogStartTime: {
                                $gte: start,
                                $lte: end
                            },}),
                            ...(cardDataObject.value.measure === 1 && {Date: {
                                dbDate: {
                                    $gte: start * 1000,
                                    $lte: end * 1000
                                }
                            }}),
                            ...(cardDataObject.value.measure === 2 && cardDataObject.value.AssigneeUserId?.length && {Loggeduser: {
                                $in : timeSheetUserId
                            }}),
                            ...(cardDataObject.value.measure === 1 && cardDataObject.value.AssigneeUserId?.length && {UserId: {
                                $in : timeuserId
                            }})
                        }},
                        { 
                            $lookup: {
                                from: "tasks",
                                let: { 
                                    taskIdRef: { 
                                        $convert: { 
                                            input: cardDataObject.value.measure === 1 ? "$TaskId" :"$TicketID",
                                            to: "objectId",
                                            onError: null
                                        } 
                                    } 
                                },
                                pipeline: [
                                    { 
                                        $match: { 
                                            $expr: { 
                                                $eq: ["$_id", "$$taskIdRef"]
                                            },
                                            // deletedStatusKey:{ $in:[0] },
                                            ...filterQuery.value
                                        } 
                                    }
                                ],
                                as: "matchedTasks"
                            }
                        },
                        {
                            $match: { "matchedTasks": { $ne: [] } }
                        },
                        { $group: { 
                            _id: null, 
                            ...calculationQueries[cardDataObject.value.calculation] 
                        } }
                    ]
                    : [
                        { $match: { 
                            deletedStatusKey: { $in: [0] },
                            ...filterQuery.value
                        } },
                        { $count: "taskCount" }
                    ]
                ),
            ];
            projectStatsQuery = teamIdToUserId(projectStatsQuery, teamsArr);
            apiRequest("post", cardDataObject.value.measure === 1 ? `${env.ESTIMATED_TIME}` : cardDataObject.value.measure === 2 ? `${env.TIMESHEET}` : `${env.TASK}/find` , cardDataObject.value.measure === 3 ? { findQuery: projectStatsQuery } : { queryeta: projectStatsQuery }).then((res) => {
                if (res.status !== 200) return (cardDataObject.value.measure === 3 ? taskRange.value = "0" : taskRange.value = "0h");

                const data = res.data?.[0] || {};
                
                const { totalEstimatedTime, minEstimatedTime, maxEstimatedTime, taskCount=0 } = data;

                taskRange.value = cardDataObject.value.measure !== 3 ? cardDataObject.value.calculation === 3
                    ? getConvertedTimeString(calculateMedian(totalEstimatedTime || []), "fetch")
                    : cardDataObject.value.calculation === 6
                    ? `${getConvertedTimeString(minEstimatedTime || 0, "fetch")} - ${getConvertedTimeString(maxEstimatedTime || 0, "fetch")}`
                    : getConvertedTimeString(totalEstimatedTime || 0, "fetch") : taskCount;
                isDataFetching.value = false;
            }).catch(() => {
                cardDataObject.value.measure === 3 ? taskRange.value = "0" : taskRange.value = "0h";
                isDataFetching.value = false;
            });   
        } catch (error) {
            isDataFetching.value = false;
            console.error("error in getting the timesheet",error)
        }
    };

    watch([() => props.cardData, () => props.filterData], ([newCardData, newFilterData],[oldCardData, oldFilterData]) => {
        if (JSON.stringify(newCardData) === JSON.stringify(oldCardData) && JSON.stringify(newFilterData) === JSON.stringify(oldFilterData)) {
            return;
        }
        cardDataObject.value = newCardData;
        if(cardDataObject.value?.projectId.length == 0) {
            cardDataObject.value.projectId = props?.allProjectsArrayFilter?.map(e => e._id) ?? [];
        }
        filterQuery.value = buildFilterQuery(newFilterData,userId.value);
        init();
    },{deep: true, immediate: true});

    function calculateMedian(arr) {
        if (!Array.isArray(arr) || arr.length === 0) return null;

        // Create a sorted copy of the array to avoid mutating the original array
        const sorted = [...arr].sort((a, b) => a - b);

        // Get the middle index
        const middleIndex = Math.floor(sorted.length / 2);

        // If odd number of elements, return the middle value
        if (sorted.length % 2 !== 0) {
            return sorted[middleIndex];
        }

        // If even number of elements, return the average of the two middle values
        return (sorted[middleIndex - 1] + sorted[middleIndex]) / 2;
    }
</script>