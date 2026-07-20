<template>
    <div class="d-flex justify-content-end mb-10px">
        <DropDown :id="cardUID">
            <template #button>
                <div :ref="cardUID"
                    class="status-estimate d-flex align-items-center font-weight-500 font-size-14 p-4px cursor-pointer w-max-content dark-gray">
                    <img src="@/assets/images/svg/calender.svg" alt="" style="width:12px;height:12px;" class="mr-4px">
                    <span>{{$t(`dashboardCard.${selectedOptionName}`)}}</span>
                </div>
            </template>
            <template #options>
                <DropDownOption v-for="(status, statusIndex) in allOptions" :key="statusIndex"
                    @click="selectedTime = status.id,updateData(status.id),$refs[cardUID].click()">
                    <div class="d-flex align-items-center">
                        <span class="ml-5px">{{$t(`dashboardCard.${status.name}`)}}</span>
                    </div>
                </DropDownOption>
            </template>
        </DropDown>
    </div>
    <div :style="{ overflowY: 'auto', maxHeight: clientWidth < 768 ? '200px' : 'calc(100% - 70px)', height: 'max-content' }"
        class="style-scroll-6-px pr-10px table-container">
        <table class="table time-sheet-table">
            <thead>
                <tr>
                    <th class="text-left font-size-14 font-weight-500 text-uppercase dark-gray ">
                    </th>
                    <th v-if="componentId === 'TimeEstimatedComp' || componentId === 'TimeEstimatedWorkloadComp'"
                        class="text-right font-size-14 font-weight-500 text-uppercase dark-gray">
                        {{ $t('UserTimesheet.planned') }}
                    </th>
                    <th v-if="componentId === 'TimeTrackComp' || componentId === 'TimeEstimatedWorkloadComp'"
                        class="text-right font-size-14 font-weight-500 text-uppercase dark-gray ml-5">
                        {{ $t('UserTimesheet.logged') }}
                    </th>
                </tr>
            </thead>
            <tbody v-if="userArrayData.length && !isFetching">
                <tr v-for="(user, index) in userArrayData" :key="index">
                    <td class="py-8px">
                        <div class="d-flex align-items-center">
                            <UserProfile :data="{ title: user?.name, image: user?.image }" width="30px" :showDot="false"
                                :thumbnail="'30x30'" />
                            <span class="ml-8px font-size-14 font-weight-500 text-ellipsis w-85" :title="user.name">
                                {{ user.name }}
                            </span>
                        </div>
                    </td>
                    <td v-if="componentId === 'TimeEstimatedComp' || componentId === 'TimeEstimatedWorkloadComp'"
                        class="text-right font-size-14 font-weight-500 py-8px">
                        {{ formatMinutesToHHMMSS(user.estimatedTime) }}
                    </td>
                    <td v-if="componentId === 'TimeTrackComp' || componentId === 'TimeEstimatedWorkloadComp'"
                        class="text-right font-size-14 font-weight-500 py-8px">
                        {{ formatMinutesToHHMMSS(user.totalTrackedTime) }}
                    </td>
                </tr>
            </tbody>
        </table>

        <div v-if="userArrayData.length === 0 && !isFetching" class="text-center mt-10px">
            <span>{{ $t('Filters.no_data_found') }}</span>
        </div>

        <div v-if="isFetching" class="queue__list-task style-scroll-6-px">
            <SkelatonVue v-for="index in 5" :key="index" :style="{ height: '45px', margin: '5px 0px 5px 5px' }" />
        </div>
    </div>
</template>
  

<script setup>
import {defineProps, ref, watch, defineEmits, computed, inject} from 'vue'
import { useStore } from "vuex";
import * as env from '@/config/env';
import DropDown from '@/components/molecules/DropDown/DropDown.vue'
import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue'
import { useGetterFunctions,useCustomComposable } from "@/composable";
import UserProfile from "@/components/atom/UserProfile/UserProfile.vue"
import { apiRequest } from '@/services';
import SkelatonVue from '@/components/atom/Skelaton/Skelaton.vue';
import { getTimeRange, teamIdToUserId } from "@/composable/commonFunction";
const { getUser } = useGetterFunctions()
const { getters } = useStore();
const teamsArr = getters["settings/teams"];
const emit = defineEmits(['handleUpdateFromCard']);

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
        default: () => {}
    },
    componentId: {
        type: String,
        default: ''
    },
    filterData: {
        type: Array,
        default: () => []
    }
})
// Variables
const {checkPermission} = useCustomComposable();
const clientWidth = inject("$clientWidth")
const currentUser = inject("$userId");
const cardObject = ref({});
const selectedTime = ref(cardObject.value ? cardObject.value.timerange : 3)
const isFetching = ref(true);
const userArrayData = ref([]);

const allOptions = ref([
    { name: "today", id: 1 },
    { name: "yesterday", id: 2 },
    { name: "this_week", id: 3 },
    { name: "last_week", id: 4},
    { name: "this_month", id: 5},
    { name: "last_month", id: 6 },
    { name: "this_year", id: 7 },
    { name: "last_30_days", id: 8 }
]);

const formatMinutesToHHMMSS = (minutes) => {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = Math.floor(minutes % 60);
    const seconds = 0;

    return `${String(hours).padStart(2, "0")}:${String(remainingMinutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

const mergeEstimateAndWorkload = (estimatedTimeData, workloadData, assigneeUserIds) => {
    try {
        let mergedData = {};
        assigneeUserIds.forEach(userId => {
            if (!userId.startsWith("tId_")) {
                mergedData[userId] = {
                    userId,
                    estimatedTime: 0,
                    totalTrackedTime: 0
                };
            }
        });

        estimatedTimeData.forEach(item => {
            let userId = item._id.user;
            if (!mergedData[userId]) {
                mergedData[userId] = {
                    userId,
                    estimatedTime: item.totalCount || 0,
                    totalTrackedTime: 0
                };
            } else {
                mergedData[userId].estimatedTime = item.totalCount || 0;
            }
        });

        workloadData.forEach(item => {
            let userId = item._id.user;
            if (!mergedData[userId]) {
                mergedData[userId] = {
                    userId,
                    estimatedTime: 0,
                    totalTrackedTime: item.totalCount || 0
                };
            } else {
                mergedData[userId].totalTrackedTime = item.totalCount || 0;
            }
        });

        let finalArray = Object.values(mergedData)?.map((e) => {
            let user = getUser(e.userId);
            return {
                userId: e.userId,
                name: user?.Employee_Name ?? '',
                image: user.Employee_profileImageURL ? user.Employee_profileImageURL : (user.Employee_profileImage ?? ''),
                estimatedTime: e.estimatedTime,
                totalTrackedTime: e.totalTrackedTime
            };
        });
        isFetching.value = false;
        return finalArray ?? [];
    } catch (error) {
        console.error('Error merging data:', error);
        isFetching.value = false;
        return [];
    }
};

const getEstimateData = async () => {
    try {
        isFetching.value = true;
        let timeRange = getTimeRange(cardObject.value?.timerange ?? 3);
        let start = timeRange.start;
        let end = timeRange.end;
        let userId = [];
        if(checkPermission('sheet_settings.workload_timesheet') === 2 || checkPermission('sheet_settings.workload_timesheet') === true) {
            userId = cardObject.value.AssigneeUserId;
        } else if(checkPermission('sheet_settings.workload_timesheet') === 1) {
            userId = currentUser.value ? [currentUser.value] : []
        } else {
            userId = [];
        }
        let timeSheetUserId = [];
        if(checkPermission('sheet_settings.tracker_timesheet') === 2 || checkPermission('sheet_settings.tracker_timesheet') === true) {
            timeSheetUserId = cardObject.value.AssigneeUserId;
        } else if(checkPermission('sheet_settings.tracker_timesheet') === 1) {
            timeSheetUserId = currentUser.value ? [currentUser.value] : []
        } else {
            timeSheetUserId = [];
        }
        let workloadQueryeta = [
            {
                $match: {
                    $and: [
                        {
                            Loggeduser: { 
                                $in: timeSheetUserId 
                            },
                            ProjectId: (cardObject.value.projectMode === 'exclude' && (cardObject.value.projectId || []).length) ? { $nin: cardObject.value.projectId } : { $in: cardObject.value.projectId },
                            LogStartTime: {
                                $gte: start,
                                $lte: end
                            },
                            logAddType : {
                                $in: cardObject.value?.logtype == 1 ? [1] : (cardObject.value?.logtype == 2 ? [0] : (cardObject.value?.logtype == 3 ? [0,1] : [0,1]))
                            }
                        }
                    ]
                }
            },
            {
                $group: {
                    _id: {
                        user: "$Loggeduser"
                    },
                    totalCount: {
                        $sum: "$LogTimeDuration"
                    }
                }
            }
        ];

        const mongo_search_eta_parameters = [
            {
                userId: {
                    $in: userId ?? []
                },
                ProjectId: (cardObject.value.projectMode === 'exclude' && (cardObject.value.projectId || []).length) ? { $nin: cardObject.value.projectId } : { $in: cardObject.value.projectId ?? [] },
                Date: {
                    dbDate: {
                        $gte: start * 1000,
                        $lte: end * 1000
                    }
                }
            }
        ];

        let queryeta = [
            {
                $match: {
                    $and: mongo_search_eta_parameters
                }
            },
            {
                $group: {
                    _id: {
                        user: "$UserId"
                    },
                    totalCount: {
                        $sum: "$EstimatedTime"
                    }
                }
            }
        ];

        queryeta = teamIdToUserId(queryeta, teamsArr);
        workloadQueryeta = teamIdToUserId(workloadQueryeta, teamsArr);
        if (props.componentId === "TimeEstimatedComp") {
            const estimatedTimeData = await apiRequest("post", `${env.ESTIMATED_TIME}`, { queryeta });
            return mergeEstimateAndWorkload(estimatedTimeData?.data ?? [], [], Array.from(new Set(teamIdToUserId(userId, teamsArr))));
        } 
        else if (props.componentId === "TimeTrackComp") {
            const workloadData = await apiRequest("post", `${env.TIMESHEET}`, { queryeta: workloadQueryeta });
            return mergeEstimateAndWorkload([], workloadData?.data ?? [], Array.from(new Set(teamIdToUserId(timeSheetUserId, teamsArr))));
        } 
        else if (props.componentId === "TimeEstimatedWorkloadComp") {
            const [workloadData, estimatedTimeData] = await Promise.all([
                apiRequest("post", `${env.TIMESHEET}`, { queryeta: workloadQueryeta }),
                apiRequest("post", `${env.ESTIMATED_TIME}`, { queryeta })
            ]);
            return mergeEstimateAndWorkload(estimatedTimeData?.data ?? [], workloadData?.data ?? [], Array.from(new Set(teamIdToUserId([...userId,...timeSheetUserId], teamsArr))));
        }

        return [];

    } catch (error) {
        console.error('Error fetching estimate data:', error);
        isFetching.value = false;
        return [];
    }
};

const updateData = (updateData) => {
    emit('handleUpdateFromCard',{id: props.cardUID,updateObject: {...props.cardData, "timerange": updateData}})
}
const selectedOptionName = computed(() => {
    return allOptions.value?.find(e => e?.id === (cardObject.value?.timerange ?? 3))?.name || '';
});
watch([() => props.cardData], async(newValue) => {
    if(JSON.stringify(cardObject.value) !== JSON.stringify(newValue[0])) {
        cardObject.value = newValue[0];
        if(cardObject.value?.projectId.length == 0) {
            cardObject.value.projectId = props?.allProjectsArrayFilter.map(e => e._id) ?? [];
        }
        if(cardObject.value?.AssigneeUserId.length == 0) {
            cardObject.value.AssigneeUserId = props.companyUserDetail?.userId ? [props.companyUserDetail?.userId] : [];
        }
        userArrayData.value = await getEstimateData()
    }
}, { deep: true, immediate: true });

</script>

<style scoped>
.status-estimate:hover {
    color: #2f3990;
}
.status-estimate {
    line-height: 16px;
}

.time-cell {
  text-align: right;
  color: #6B6B6B;
}
.user-cell {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #6B6B6B;
}
.user-cell span:hover{
    cursor: pointer;
}
.user-column {
  text-align: left;
  width: 40%;
}

.time-column {
  text-align: right;
  width: 25%;
}

.time-sheet-header {
  display: flex;
  padding: 8px;
  justify-content: end;
}

.time-sheet-body {
  overflow-y: auto;
}

.table-row {
  display: flex;
  align-items: center;
  padding: 8px;
  border-bottom: 1px solid #ddd;
}
.table-row:last-child{
    border-bottom: none;
}
.user-cell {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
}

.time-cell {
  flex: 0.5;
  text-align: end;
}

@media (max-width:375px) {
    .time-column {
        width: 30%;
    }
}
</style>
<style>
.time-sheet-table  .setting_project-owner img{
    max-width: 30px;
}
.time-sheet-table {
  table-layout: fixed;
  width: 100%;
  min-width: 300px;
}
.table-container {
    position: relative;
}
.table thead th {
  position: sticky;
  top: 0;
  background-color: white;
  z-index: 1;
}
</style>