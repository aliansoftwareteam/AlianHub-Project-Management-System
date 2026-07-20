<template>
    <template v-if="isLoading">
        <StackBarChartSkelaton />
    </template>
    <template v-else-if="chartData.length > 0 && !isLoading">
        <StackedBarChart
            :chartId="cardUID"
            :chartData="chartData"
            :showLegend="cardObject.isShowLegend"
            :showDataLabels="cardObject.isShowDataLabels"
            exportTitle="Tasks By Assignee"
        />
    </template>
    <template v-else-if="chartData.length === 0 && !isLoading">
        <span class="font-size-14">No data found</span>
    </template>
</template>

<script setup>
import { defineComponent, ref, onMounted, defineProps, inject, watch, computed } from "vue";
import { useStore } from "vuex";

defineComponent({
    name: "StackBarChartCardComponent"
})

// Component
import StackedBarChart from "@/components/atom/Charts/HighCharts/SingleRowStackedBar.vue";
import StackBarChartSkelaton from "@/components/atom/Skelaton/StackBarChartSkelaton.vue";

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
    // Project scope (all / include / exclude), always bounded to accessible.
    const projectMode = cardObject.value?.projectMode || 'all';
    const selectedProjectIds = cardObject.value?.projectId || [];
    // exclude → whitelist (accessible minus excluded) so the query stays bounded
    // to the user's accessible projects (a raw $nin would leak other projects).
    const accessibleProjectIds = props.allProjectsArrayFilter?.map((e) => e?._id) ?? [];
    const projectIdMatch = (projectMode === 'exclude' && selectedProjectIds.length)
        ? { ProjectID: { objId: { $in: accessibleProjectIds.filter((id) => !selectedProjectIds.includes(id)) } } }
        : (projectIDs.length ? { ProjectID: { objId: { $in: projectIDs } } } : {});
    const isParentTaskKeys = cardObject.value?.isParentTask === true ? [true, false] : [true];

    switch (componentId) {
        case 'TasksByAssigneeStackBarChartCard': {
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
        case 'WorkloadByStatusStackBarChartCard': {
            const workloadUserFilter = {
                ...projectIdMatch,
                deletedStatusKey:{
                    $in:[0]
                },
                isParentTask: {
                    $in: isParentTaskKeys
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
        const response = await apiRequest('post', `${env.TASK}/find`, { findQuery: findQuery });

        if (response.data.length) {
            if (props.componentId === "WorkloadByStatusStackBarChartCard") {
                chartData.value = response.data.map(x => {
                    const item = statusArray.value.find(y => y.key === x._id);
                    return item ? { name: item.name, data: [x.count], color: item.textColor } : null;
                }).filter(Boolean);
            } else if (props.componentId === "TasksByAssigneeStackBarChartCard") {
                chartData.value = response.data.map(x => {
                    const user = getUser(x._id);
                    return user ? { name: user.Employee_Name, data: [x.count], color: '' } : null;
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
