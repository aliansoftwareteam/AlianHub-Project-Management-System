<template>
    <template v-if="isLoading">
        <PieChartSkelaton />
    </template>
    <template v-if="chartData.length > 0 && !isLoading">
        <PieChart
            :chartId="cardUID"
            :chartData="chartData"
            :isPercentageShow="cardObject.isPercentage"
            :showLegend="cardObject.isShowLegend"
            exportTitle="Workload By Status"
        />
    </template>
    <template v-if="chartData.length === 0 && !isLoading">
        <span class="font-size-14">No data found</span>
    </template>
</template>

<script setup>
import { defineComponent, ref, onMounted, computed, defineProps, inject, watch } from "vue";
import { useStore } from "vuex";

defineComponent({
    name: "WorkloadByStatusPieChartCard"
})

// Component
import PieChart from "@/components/atom/Charts/HighCharts/PieChart.vue";
import PieChartSkelaton from "@/components/atom/Skelaton/PieChartSkelaton.vue";

// Utils
import { apiRequest } from "@/services";
import env from '@/config/env';
import { useGetterFunctions } from "@/composable";
import { buildFilterQuery, teamIdToUserId } from "@/composable/commonFunction";
const { getUser } = useGetterFunctions()
const { getters } = useStore();
const teamsArr = getters["settings/teams"];

// Props
const props = defineProps({
    taskStatusArray: {
        type: Object,
        default: () => { }
    },
    allProjectsArrayFilter: {
        type: Array,
        default: () => []
    },
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
    componentId: {
        type: String,
        default: ''
    },
    filterData: {
        type: Array,
        default: () => { }
    },
})

// Variables
const userId = inject('$userId');
const chartData = ref([]);
const isLoading = ref(false);
const cardObject = ref(props.cardData);
const filterData = ref(JSON.parse(JSON.stringify(props.filterData)))
const filterQuery = ref([]);
const allTaskStatusArray = ref(JSON.parse(JSON.stringify(props.taskStatusArray)));
const statusArray = computed(() => {
    if (allTaskStatusArray.value.settings && allTaskStatusArray.value.settings.length) {
        return allTaskStatusArray.value?.settings.map((x) => {
            return { ...x, finalValue: x.key };
        });
    } else {
        return [];
    }
});

onMounted(() => {
    if (filterData.value && filterData.value.length) {
        filterQuery.value = buildFilterQuery(filterData.value,userId.value);
    }
    init()
})

const getQuery = (componentId) => {
    const roleType = props.companyUserDetail.roleType;
    const projectIDs = cardObject.value?.projectId?.length ? cardObject.value?.projectId : (props.allProjectsArrayFilter?.map(e=>e?._id) ?? []);
    // Project scope: all → $in all accessible; include → $in selected;
    // exclude → $nin selected (new projects auto-included).
    const projectMode = cardObject.value?.projectMode || 'all';
    const selectedProjectIds = cardObject.value?.projectId || [];
    const projectIdMatch = (projectMode === 'exclude' && selectedProjectIds.length)
        ? { ProjectID: { objId: { $nin: selectedProjectIds } } }
        : (projectIDs.length ? { ProjectID: { objId: { $in: projectIDs } } } : {});
    const isParentTaskKeys = cardObject.value?.isParentTask === true ? [true, false] : [true];

    switch (componentId) {
        case 'TasksByAssigneePieChartCard': {
            const taskAssineeFilter = {
                ...projectIdMatch,
                isParentTask: {
                    $in: isParentTaskKeys
                },
                deletedStatusKey:{
                    $in:[0]
                },
                ...(filterQuery.value && { ...filterQuery.value }),
                ...(![1, 2].includes(roleType) && { AssigneeUserId: { $in: [userId.value] } }),
            };

            let taskAssigneefindQuery = [
                { "$unwind": "$AssigneeUserId" },
                { "$match": taskAssineeFilter },
                { "$group": { _id: "$AssigneeUserId", count: { $sum: 1 } } },
                { "$sort": { count: 1 } }
            ];

            if (taskAssineeFilter.AssigneeUserId) {
                taskAssigneefindQuery.push({ "$match": { "_id": userId.value } });
            }

            return taskAssigneefindQuery;
        }
        case 'WorkloadByStatusPieChartCard': {
            const workloadUserFilter = {
                ...projectIdMatch,
                isParentTask: {
                    $in: isParentTaskKeys
                },
                deletedStatusKey:{
                    $in:[0]
                },
                ...(filterQuery.value && { ...filterQuery.value })
            };

            const workloadFindQuery = [
                { "$match": workloadUserFilter },
                { "$group": { _id: "$statusKey", count: { $sum: 1 } } },
                { "$sort": { count: 1 } }
            ];

            return workloadFindQuery;
        }
        default:
            return [];
    }
}

const init = async () => {
    isLoading.value = true;
    try {
        const findQuery = teamIdToUserId(getQuery(props.componentId), teamsArr);
        const response = await apiRequest('post', `${env.TASK}/find`, { findQuery });

        if (response.data.length) {
            if (props.componentId === "WorkloadByStatusPieChartCard") {
                chartData.value = response.data.map(x => {
                    const item = statusArray.value.find(y => y.key === x._id);
                    return item ? { name: item.name, y: x.count, color: item.textColor } : null;
                }).filter(Boolean);
            } else if (props.componentId === "TasksByAssigneePieChartCard") {
                chartData.value = response.data.map(x => {
                    const user = getUser(x._id);
                    return user ? { name: user.Employee_Name, y: x.count, color: '' } : null;
                }).filter(Boolean);
            }
        } else {
            chartData.value = [];
        }
    } catch (error) {
        console.error(error);
    } finally {
        isLoading.value = false;
    }
}

// Watch for changes in cardData prop
watch(() => props.cardData, (newValue, oldValue) => {
    if (JSON.stringify(newValue) === JSON.stringify(oldValue)) return;

    cardObject.value = newValue;

    if (newValue && newValue.length > 0) {
        init();
    }
}, { immediate: true });

// Watch for changes in advance filter prop
watch(() => props.filterData, (newValue) => {
    const hasValues = Object.values(newValue).length > 0;

    if (hasValues) {
        filterQuery.value = buildFilterQuery(Object.values(newValue),userId.value);
        init();
    } else if (filterQuery.value !== '') {
        filterQuery.value = '';
        init();
    }
}, { immediate: true, deep: true });
</script>