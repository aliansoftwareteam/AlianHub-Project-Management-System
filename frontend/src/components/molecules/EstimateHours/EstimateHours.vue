<template>
    <div>
        <span
            class="task-esitmate-hours"
            :class="{'cursor-pointer': permission,'red': totalHoursInMinute > task.totalEstimatedTime }"
            @click="showEtaSidebar()"
        >
            {{ totalHours }}
        </span>
        <Sidebar
            v-if="currentCompany?.planFeature?.timeEstimateProjectApp"
            v-model:visible="isVisible"
            width="607px"
            :zIndex="zIndexEstimate"
            :top="clientWidth<=767 ? '0px' : '46px'"
        >
            <template #head-left>
                <h3 class="blue" :class="clientWidth > 767 ? 'font-size-18' : 'font-size-16' ">{{$t('Milestone.adding_taskPlanning')}}</h3>
            </template>
            <template #head-right>
                <div>
                    <button class="outline-primary font-size-16 mr-10px" :style="[{padding : clientWidth > 767 ? '5px 13.2px' : '5px'}]"  @click="isVisible = false">{{$t('Projects.cancel')}}</button>
                    <button v-if="!savingETA" class="btn-primary font-size-16" :style="[{padding : clientWidth > 767 ? '5px 14.41px' : '5px 10px'}]"  @click="saveEta()">{{$t('Projects.save')}}</button>
                    <button v-else class="btn-secondary font-size-16" :style="[{padding : clientWidth > 767 ? '5px 14.41px' : '5px 10px'}]">{{$t('Projects.save')}}</button>
                </div>
            </template>
            <template #body>
                <div class="createprojectContent estimate__hours-wrapper position-re p-15px h-100">
                    <div v-if="savingETA" class="position-ab h-100 w-100 saving__eta">
                        <Spinner :isSpinner="true"/>
                    </div>
                    <div class="bg-white border-radius-8-px" :class="clientWidth <=767 ? 'p-0' : 'p-20px'">
                        <div :class="clientWidth <=767 ? 'd-block' : 'd-flex'">
                            <label :class="{'taskstatustitle-desktop': clientWidth > 767 , 'taskstatustitle-mobile': clientWidth <= 767}">{{$t('Projects.issue')}}</label>
                            <div class="input-field-group">
                                <InputText
                                    :modelValue="task.TaskName"
                                    :is-disabled="true"
                                    :placeHolder="$t('PlaceHolder.Enter_Project_Name')"
                                    autocomplete="off"
                                    class="form-control login-input text-capitalize"
                                    maxlength="100"
                                    type="text"
                                />
                            </div>
                        </div>
                        <div :class="clientWidth <=767 ? 'd-block ' : 'd-flex'" class="mt-20px">
                            <label :class="{'taskstatustitle-desktop': clientWidth > 767 , 'taskstatustitle-mobile': clientWidth <= 767}">{{$t('Milestone.start_date')}}<span class="text-red asterisk">*</span></label>
                            <div class="input-field-group">
                                <DueDateCompo
                                    id="due-date-task-estimate"
                                    class="duedate__estimate"
                                    :displyDate="task?.startDate"
                                    :isShowDateAndicon="true"
                                    @SelectedDate="($event) => $emit('update:startDate' ,$event)"
                                    v-if="checkPermission('task.task_due_date',projectData?.isGlobalPermission) === true && checkPermission('task.task_list',projectData?.isGlobalPermission) == true"
                                />
                                <template v-else>
                                    <span v-if="task.startDate && task.startDate">{{convertDateFormat(task.startDate)}}</span>
                                    <span v-else>{{$t('ProjectDetails.no_start_date')}}</span>
                                </template>
                            </div>
                        </div>
                        <div :class="clientWidth <=767 ? 'd-block ' : 'd-flex'" class="mt-20px">
                            <label :class="{'taskstatustitle-desktop': clientWidth > 767 , 'taskstatustitle-mobile': clientWidth <= 767}">{{$t('Home.Due_Date')}}<span class="text-red asterisk">*</span></label>
                            <div class="input-field-group">
                                <DueDateCompo
                                    id="due-date-task-estimate"
                                    class="duedate__estimate"
                                    :displyDate="task?.DueDate"
                                    :isShowDateAndicon="true"
                                    :disabledDates="task.dueDateDeadLine"
                                    @SelectedDate="($event) => $emit('update:dueDate' ,$event)"
                                    v-if="checkPermission('task.task_due_date',projectData?.isGlobalPermission) === true && checkPermission('task.task_list',projectData?.isGlobalPermission) == true"
                                />
                                <template v-else>
                                    <span v-if="task.DueDate">{{convertDateFormat(task.DueDate,'',{showDayName:false})}}</span>
                                    <span v-else>{{$t('ProjectDetails.no_due_date')}}</span>
                                </template>
                            </div>
                        </div>
                    </div>
                    <div class="estimate__HourTable" :class="clientWidth <=767 ? 'pt-20px' : ''">
                        <EstimateHourTable
                            class="mt-2"
                            :projectId="task.ProjectID"
                            :sprintId="task.sprintId"
                            :taskId="task._id"
                            :savingETA="savingETA"
                            :estimates="estimatedHours"
                            :dueDate="task.DueDate"
                            :createdAt="task.createdAt"
                            :updatedETA="updatedEta"
                            @update:updatedETA="updatedEta = JSON.parse(JSON.stringify($event))"
                            :AssigneeUserId="permission == 2 || permission == true ? task?.AssigneeUserId : [companyUser.userId]"
                            :permission="permission"
                            :isSpinner="isSpinner"
                        />
                    </div>
                </div>
            </template>
        </Sidebar>
        <Sidebar
            v-else
            v-model:visible="isVisible"
            width="607px"
            :zIndex="zIndexEstimate"
            :top="clientWidth<=767 ? '0px' : '46px'"
        >
            <template #head-left>
                <div></div>
            </template>
            <template #head-right>
                <div>
                    <button class="outline-primary font-size-16 mr-10px" :style="[{padding : clientWidth > 767 ? '5px 13.2px' : '5px'}]"  @click="isVisible = false">{{$t('Projects.cancel')}}</button>
                </div>
            </template>
            <template #body>
                <UpgradePlan
                    :buttonText="$t('Upgrades.upgrade_your_plan')"
                    :lastTitle="$t('ViewList.to_unlock_list_views')"
                    :secondTitle="$t('Upgrades.unlimited')"
                    :firstTitle="$t('Upgrades.upgrade_to')"
                    :message="$t('Upgrades.the_feature_not_available')"
                />
            </template>
        </Sidebar>
    </div>
</template>
<script setup>
import { defineProps, ref, computed, onBeforeUnmount, inject, onMounted, watch } from 'vue';
import { useStore } from 'vuex';

import Sidebar from '@/components/molecules/Sidebar/Sidebar.vue';
import Spinner from '@/components/atom/SpinnerComp/SpinnerComp.vue';
import InputText from '@/components/atom/InputText/InputText.vue';
import DueDateCompo from '@/components/molecules/DueDateCompo/DueDateCompo.vue';
import EstimateHourTable from '@/components/molecules/EstimateHourTable/EstimateHourTable.vue';
import UpgradePlan from '@/components/atom/UpgradYourPlanComponent/UpgradYourPlanComponent.vue';

import { useConvertDate, useCustomComposable, useGetterFunctions, useMoment } from '@/composable';
import { useToast } from 'vue-toast-notification';
import * as env from '@/config/env';
import { estimatedTimeAdded, estimatedTimeAssignAdded, estimatedTimeAssignUpdated, estimatedTimeUpdated } from '@/utils/NotificationTemplate';
import { apiRequest } from '../../../services';
import { useI18n } from "vue-i18n";
const { t } = useI18n();

const {getUser} = useGetterFunctions()
const {convertDateFormat} = useConvertDate()
const {changeDateFormate} = useMoment();
const { getters } = useStore();

defineEmits(['update:dueDate', 'update:startDate'])

const props = defineProps({
    permission : {
        type: [Number, String, Boolean],
        required: false,
        default: null
    },
    task:{
        type: Object,
        required: true
    },
    zIndexEstimate: {
        type: Number,
        default: 7
    },
    isSpinner: {
        type: Boolean,
        default: false
    }
});

const { checkPermission, addZero } = useCustomComposable();
const $toast = useToast();
const userId = inject('$userId');
const companyId = inject('$companyId');
const clientWidth = inject("$clientWidth");
const currentCompany = computed(() => getters["settings/selectedCompany"])
const companyUser = ref(getters['settings/companyUserDetail']);

const estimatedHours = ref([]);
const updatedEta = ref([]);
const isVisible = ref(false);
const savingETA = ref(false);
const etaSnap = ref(null);

const projectData = computed(() => {
    return getters['projectData/projects']?.data?.find((x) => x._id === props.task.ProjectID)
})

onMounted(() => {
    if(props.permission !== null)  {
        getETASnapshot();
    }
})
watch(() => props.isSpinner,(newVal,oldVal) => {
    if(newVal !== oldVal){
        updatedEta.value = [];
    }
});
function getETASnapshot() {
    try {
        apiRequest("get", `${env.ESTIMATED_TIME}/${props.task.ProjectID}/${props.task._id}`)
        .then((res) => {
            let data = res.data;
            estimatedHours.value = data;
        }).catch((err) => {
            console.error(err);
        })
    } catch (error) {
        console.error("ERROR: ", error);
    }
}

const getTotalMinutes = () => {
  return estimatedHours.value.reduce((sum, item) => {
    const canSeeAll =
      companyUser.value.roleType === 1 ||
      companyUser.value.roleType === 2 ||
      props.permission === 2;

    if (canSeeAll || item.UserId === userId.value) {
      return sum + item.EstimatedTime;
    }
    return sum;
  }, 0);
};

const totalHoursInMinute = computed(() => getTotalMinutes());

const totalHours = computed(() => {
  const total = getTotalMinutes();
  const displayHours = Math.floor(total / 60);
  const displayMinutes = total % 60;

  return `${displayHours.toString().padStart(2, "0")}h ${displayMinutes
    .toString()
    .padStart(2, "0")}m`;
});

function showEtaSidebar() {
    if(!props.permission) {
        $toast.error(t(`Toast.Access denied`), {position: 'top-right'})
        return;
    }
    let assigneePermissionCheck = companyUser.value.roleType !== 1 && companyUser.value.roleType !== 2 && props.permission !== 2 ? props.task?.AssigneeUserId?.length && props.task.AssigneeUserId.includes(userId.value) : props.task?.AssigneeUserId?.length;
    if(assigneePermissionCheck && props.task?.DueDate) {
        if(props.permission) {
            isVisible.value = true
        }
    } else {
        if(!props.task.AssigneeUserId.length) {
            $toast.error(t(`Toast.No_assignee_found`), {position: 'top-right'})
        } else if(!props.task?.DueDate) {
            $toast.error(t(`Toast.No_due_date_found`), {position: 'top-right'})
        } else if(companyUser.value.roleType !== 1 && companyUser.value.roleType !== 2 && props.permission !== 2 && !props.task.AssigneeUserId.includes(userId.value)){
            $toast.error(t(`Toast.No_self_assignee_found`), {position: 'top-right'})
        }
    }
}

function getUserData(uid) {
    let user = getUser(uid);
    return {
        id: user._id,
        Employee_Name: user.Employee_Name,
        companyOwnerId: user.companyOwnerId,
    };
}
function saveEta() {
    if(updatedEta.value.length) {
        const estimates = JSON.parse(JSON.stringify(updatedEta.value));
        updatedEta.value = [];
        savingETA.value = true;

        const currentUser = getUserData(userId.value);
        const saveHistory = (data, update = false) => {
            const userData = getUserData(data.UserId);
            const time = `${addZero(Math.floor(data.minutes/60))}:${addZero(Math.floor(data.minutes%60))}`
            const prevTime = data.prevTime ? `${addZero(Math.floor(data.prevTime/60))}:${addZero(Math.floor(data.prevTime%60))}` : '';
            let historyObj = {
                sprintId: props.task.sprintId,
                key: "Task_Due_Date",
            };
            const notificationObj = {
                loggedUserName: userData.Employee_Name,
                estimatedTime: prevTime,
                updateEstimatedTime: time,
                timeDateData: changeDateFormate(data.timeStamp, 'DD/MM/yyyy'),
                TaskName: props.task.TaskName,
                ProjectName: projectData.value.ProjectName,
            }
            const finalNotification = {
                key: "task_estimated_hours",
            };
            if(data.UserId === currentUser.id) {
                if(!update) {
                    finalNotification.message = estimatedTimeUpdated(notificationObj);
                    historyObj.message= `<b>${userData.Employee_Name}</b> has added <b>hrs(${time})</b> <b>estimated time</b> for<b> ${notificationObj.timeDateData}</b>.`;
                } else {
                    finalNotification.message = estimatedTimeAdded(notificationObj);
                    historyObj.message= `<b>${userData.Employee_Name}</b> has updated <b>estimated time</b> for <b>${notificationObj.timeDateData}</b> from <b>hrs(${prevTime})</b> to <b>hrs(${time})</b>.`;
                }
            } else {
                notificationObj.userName = currentUser.Employee_Name
                if(!update) {
                    finalNotification.message = estimatedTimeAssignUpdated(notificationObj);
                    historyObj.message= `<b>${currentUser.Employee_Name}</b> updated the <b>estimated time</b> of <b>${userData.Employee_Name}</b> for <b>${notificationObj.timeDateData}</b> from <b>${prevTime}</b> to <b>${time}</b>.`;
                } else {
                    finalNotification.message = estimatedTimeAssignAdded(notificationObj);
                    historyObj.message= `<b>${currentUser.Employee_Name}</b> added <b>hrs(${time})</b> in <b>estimated time</b> of <b>${userData.Employee_Name}</b> for <b>${notificationObj.timeDateData}</b> </b>.`;
                }
            }

            // HISTORY
            apiRequest("post", env.HANDLE_HISTORY, {
                type: "task",
                companyId: companyId.value,
                projectId: props.task.ProjectID,
                taskId: props.task._id,
                object: historyObj,
                userData: currentUser
            })
            .catch((error) => {
                console.error("ERROR in save history: ", error);
            })

            // NOTIFICATION
            apiRequest("post", env.HANDLE_NOTIFICATION, {
                type: "tasks",
                companyId: companyId.value,
                projectId: props.task.ProjectID,
                taskId: props.task._id,
                folderId: props.task?.folderObjId ? props.task?.folderObjId : '',
                sprintId: props.task.sprintId || '',
                userData: currentUser,
                object: finalNotification
            })
            .catch((error) => {
                console.error("ERROR in send notification: ", error);
            })
        }

        estimates.forEach((data) => {
            const firebaseObj = {
                UserId: data.UserId,
                TaskId: props.task._id,
                ProjectId: props.task.ProjectID,
                EstimatedTime: data.minutes,
                Date: new Date(data.timeStamp),
                createdAt: new Date(),
                updatedAt: new Date()
            }

            if(data.id && data.id != null) {
                const axiosObj = {
                    updateObject: firebaseObj,
                    key: "$set",
                    compareObj: {
                        _id: data.id
                    },
                    newObj: {
                        new: true
                    }
                }

                apiRequest("put", `${env.ESTIMATED_TIME}`,axiosObj)
                .then((resp) => {
                    const docData = resp.data;
                    let changeDate = new Date(docData.Date).setHours(0,0,0,0);
                    let etaIndex = estimatedHours.value.findIndex((x) => new Date(x.Date).setHours(0,0,0,0) === changeDate && x.UserId === docData.UserId)
                    if(etaIndex !== -1) {
                        estimatedHours.value[etaIndex] = {...docData}
                    }
                    try {
                        saveHistory(data, true);
                    } catch (error) {
                        console.error("ERROR", error);
                    }
                    savingETA.value = false;
                })
                .catch((error) => {
                    savingETA.value = false;
                    console.error("ERROR in update ETA in mongo: ", error);
                })
                delete firebaseObj.createdAt;
            } else {
                const axiosObj = {
                    updateObject: firebaseObj,
                    key: "$set",
                    newObj: {
                        upsert: true,
                        new: true
                    },
                    compareObj: {
                        userId: data.UserId,
                        Date: new Date(data.timeStamp),
                        TaskId: props.task._id
                    }
                }

                apiRequest("put", `${env.ESTIMATED_TIME}`,axiosObj)
                .then((res) => {
                    const docData = res.data;
                    let changeDate = new Date(docData.Date).setHours(0,0,0,0);
                    let etaIndex = estimatedHours.value.findIndex((x) => new Date(x.Date).setHours(0,0,0,0) === changeDate && x.UserId === docData.UserId)
                    if(etaIndex !== -1) {
                        estimatedHours.value[etaIndex] = {...docData}
                    } else {
                        estimatedHours.value.push(docData)
                    }
                    data.id = docData._id;

                    savingETA.value = false;

                    try {
                        saveHistory(data);
                    } catch (error) {
                        console.error("ERROR", error);
                    }
                })
                .catch((error) => {
                    savingETA.value = false;
                    console.error("ERROR in update ETA in mongo: ", error);
                })
            }
        })
        $toast.success(t(`Toast.Estimated_time_updated_successfully`), {position: "top-right"});
    } else {
        $toast.success(t(`Toast.Nothing_to_update`), {position: "top-right"});
    }
    return;
}

onBeforeUnmount(() => {
    if(etaSnap.value) {
        etaSnap.value();
    }
});

</script>
<style src="./style.css">
</style>