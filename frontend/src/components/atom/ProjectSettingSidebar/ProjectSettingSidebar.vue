 <template>
    <div>
    <SpinnerComp :is-spinner="isSpinner" v-if="isSpinner"/>
        <Sidebar width="607px" :top ="clientWidth > 767 ? '46px' : '0px' " >
             <template #head-left>
                <div class="blue font-roboto-sans text-ellipsis text-nowrap pr-15px">{{sidebarTitle === 'projectStatus' ? `${projectData.ProjectName} ${$t('Projects.status')}` : sidebarTitle === 'taskType' ? `${projectData.ProjectName} ${$t('Projects.task_type')}` : sidebarTitle === 'taskStatus' ? `${projectData.ProjectName} ${$t('Templates.task_status')}` : ''}}</div>
            </template>
            <template #head-right>
                <button class="bg-white cancelButtonProject blue mr-010 cursor-pointer" @click="closeSidebarFun()">{{$t('Projects.cancel')}}</button>
                <button class="bg-blue cancelButtonProject white cursor-pointer" @click="submitData()" :disabled="isSpinnerTaskType || isSpinnerTaskStatus">{{ $t('Projects.submit') }}</button>
            </template>
            <template #body>
                <div :class="{'bg-white' : clientWidth <=767}" class="h-100 pss__setting-body">
                    <div v-if="sidebarTitle === 'projectStatus'" class="bg-white m-015 project__setting--blankproject border-radius-8-px createProjectWizardSlider pss__setting-panel" :class="{'mobile-project-taskstatus-section task-detail-mobile' : clientWidth<=767}"  :style="[{margin : clientWidth > 767 ? '15px' : '0'}]">
                        <ProjectStatusForm
                            v-model="formData.projectStatusForm"
                            :from="'setting'"
                            :projectData="JSON.parse(JSON.stringify(props.projectData))"
                            @setTemplateData="setTemplateData()"
                            @saveTemplate="saveTemplate"
                            @updateStatus="updateStatus"
                        />
                    </div>
                    <div v-if="sidebarTitle === 'taskType'" class="bg-white m-015 project__setting--blankproject border-radius-8-px createProjectWizardSlider pss__setting-panel" :class="{'mobile-project-taskstatus-section task-detail-mobile' : clientWidth<=767}" :style="[{margin : clientWidth > 767 ? '15px' : '0'}]">
                        <ProjectTaskTypeForm
                            v-model="formData.taskTypeForm"
                            :from="'setting'"
                            :projectData="JSON.parse(JSON.stringify(props.projectData))"
                            @setTemplateDataTaskType="setTemplateTaskType"
                            @saveTemplate="saveTemplate"
                            @spinnerOn="isSpinnerTaskType = true"
                            @updateStatus="updateStatus"
                        />
                    </div>
                    <div v-if="sidebarTitle === 'taskStatus'" class="bg-white m-015 project__setting--blankproject border-radius-8-px createProjectWizardSlider pss__setting-panel" :class="{'mobile-project-taskstatus-section task-detail-mobile' : clientWidth<=767}" :style="[{margin : clientWidth > 767 ? '15px' : '0'}]">
                        <TaskStatusForm 
                            v-model="formData.taskStatusForm" 
                            :from="'setting'" 
                            :projectData="JSON.parse(JSON.stringify(props.projectData))" 
                            @setTemplateDataTaskStatus="setTemplateTaskStatus" 
                            @saveTemplate="saveTemplate" 
                            @spinnerOn="isSpinnerTaskStatus = true"
                            @updateStatus="updateStatus"
                        />
                    </div>
                </div>
                <SpinnerComp :is-spinner="isSpinnerTaskType || isSpinnerTaskStatus" v-if="isSpinnerTaskType || isSpinnerTaskStatus"/>
            </template>
        </Sidebar>
            <ConfirmationsInTask :projectStatusConfirm="projectStatusConfirm" v-model="showSidebar"
                :selectedProjectData="props.projectData"
                :newProjectStausData="newProjectStausData"
                :oldProjectStatus="oldProjectStatus"
                :newTaskTypeData="newTaskTypeData"
                :oldTaskType="oldTaskType"
                :taskTypeConfirm="taskTypeConfirm"
                :statusConfirm="statusConfirm"
                :oldStatus="oldTaskStatus"
                @changeStatus="changeStatus"
                @changeTaskType="changeTaskType"
                @finalConfirm="finalConfirm"
                @checkTaskType="checkTaskType"
                :newTaskStatusData="newTaskStatusData"
                :errorMsg="errorMsg"
                :errorMsgType="errorMsgType"
            />
            <ConfirmationsTemplate v-if="openSidebar" 
                :oldStatus="oldStatus" 
                :selectedProjectData="projectData"
                :statusType="statusType"
                :taskType="taskTypes"
                :projectStatusType="projectStatusType"
                :errorMsg="errorMsg"
                :errorMsgType="errorMsgType"
                @changeStatus="(newSatatus,oldStatus,type) => modifyStatus(newSatatus,oldStatus,type)"
                @changeTaskType="(newType,oldType) => modifyType(newType,oldType)"
                @confirm="confirmData()"
                @closeModel="openSidebar = false"
            />
    </div>
</template>

<script setup>
import Sidebar from "@/components/molecules/Sidebar/Sidebar.vue";
import ProjectStatusForm from '@/components/templates/CreateProject/ProjectStatusForm.vue';
import {computed, defineProps, inject, ref} from 'vue';
import ProjectTaskTypeForm from '@/components/templates/CreateProject/ProjectTaskTypeForm.vue'
import TaskStatusForm from '@/components/templates/CreateProject/TaskStatusForm.vue';
import ConfirmationsInTask from "@/components/atom/ConfirmationsInTask/ConfirmationsInTask.vue"
import ConfirmationsTemplate from '@/components/atom/ConfirmationsTemplate/ConfirmationsTemplate.vue';
import { useStore } from "vuex";
import SpinnerComp from '@/components/atom/SpinnerComp/SpinnerComp.vue';
import * as env from '@/config/env';
import { apiRequest } from '../../../services';
import { useI18n } from "vue-i18n";
import { resetStatus } from '@/components/templates/CreateProject/helper.js'
const { t } = useI18n();

const props = defineProps({
    projectData: {
        type: Object,
        required: true
    },
    sidebarTitle: {
        type: String,
        default: ""
    },
    openSidebarInProject: {
        type: Boolean,
    }
})

const emit = defineEmits(["isSidebarProjectSetting"]);
const projectStatusConfirm = ref(false);
const showSidebar = ref(false);
const isSpinner = ref(false);
const statusConfirm = ref(false)
const { getters,commit } = useStore();

const isOpen = ref(props.openSidebarInProject);
const projectStatus = ref(props.projectData);
const newProjectStausData=  ref([]);
const newTaskTypeData=  ref([]);
const newTaskStatusData=  ref([]);

const formData = ref({
    projectStatusForm : {
        projectStatusField : {
            value: {},
            rules:
            "required",
            name: "projectStatusField",
            error: "",
        } 
    },
    taskTypeForm : {
        taskTypeField : {
            value: {},
            rules:
            "required",
            name: "taskTypeField",
            error: "",
        }
    },
    taskStatusForm : {
        taskStatusField : {
            value: {},
            rules:
            "required",
            name: "taskStatusField",
            error: "",
        }
    },
})
const companyId = inject("$companyId");
const oldProjectStatus = ref([]);
const oldTaskType = ref([]);
const oldTaskStatus = ref([]);
const taskTypeConfirm = ref(false);
const taskTypeKeys = ref([])
const taskStatusKey = ref([]);
const errorMsg = ref('')
const errorMsgType = ref('')
const isSpinnerTaskType = ref(false);
const isSpinnerTaskStatus = ref(false);
const usedStatus = ref([]);
const openSidebar = ref(false);
const oldStatus = ref([]);
const finalStatusData = ref([])
const statusType = ref(false)
const taskTypes = ref(false)
const projectStatusType = ref(false)

const projectStaus = computed(() => {
    return getters['settings/projectStatusStore'];
})
const taskType = computed(() => {
    return getters['settings/projectTaskType'];
})
const taskStatus = computed(() => {
    return getters['settings/projectTaskStatus'];
})
function setTemplateData () {
    newProjectStausData.value =  [...formData.value.projectStatusForm.projectStatusField.value.projectActiveStatus, ...formData.value.projectStatusForm.projectStatusField.value.projectDoneStatus, {...formData.value.projectStatusForm.projectStatusField.value.projectCompletedStatus}];
    if(newProjectStausData.value.filter((y) => y.value === props.projectData.status).length === 0){
        oldProjectStatus.value = props.projectData.projectStatusData.filter((y) => y.value === props.projectData.status);
    }
}

function setTemplateTaskType (data,data1) {
    isSpinnerTaskType.value = false;
    newTaskTypeData.value = formData.value.taskTypeForm.taskTypeField.value.taskTypes;
    if(data.length === 0 || data[0] === null) {
        oldTaskType.value = [];
        return;
    }
    taskTypeKeys.value = data.map(type => type.TaskTypeKey);
    const notMatchedProjects = data1.filter((x) => {
        return taskTypeKeys.value.some((y) => y === x.key);
    });
    oldTaskType.value = notMatchedProjects;
}

function setTemplateTaskStatus (data,data1) {
    isSpinnerTaskStatus.value = false;
    newTaskStatusData.value = [{...formData.value.taskStatusForm.taskStatusField.value.defaultActive}, ...formData.value.taskStatusForm.taskStatusField.value.ActiveStatusList, ...formData.value.taskStatusForm.taskStatusField.value.DoneStatusList, {...formData.value.taskStatusForm.taskStatusField.value.defaultComplete}];
    if(data.length === 0 || data[0] === null) {
        oldTaskStatus.value = [];
        return;
    }
    
    taskStatusKey.value = data.map(status => status.statusKey);
    const notMatchedProjects = data1.filter((x) => {
        return taskStatusKey.value.some((y) => y === x.key);
    });
    oldTaskStatus.value = notMatchedProjects;
}
const clientWidth = inject("$clientWidth");
function closeSidebarFun() {
    isOpen.value = false;
    emit("isSidebarProjectSetting",isOpen.value);
    resetStatus();
}

function checkStatus() {
    return new Promise((resolve, reject) => {
        try {
            if(props.sidebarTitle === 'projectStatus'){
                if(formData.value.projectStatusForm.projectStatusField.value._id !== props.projectData.projectStatusTemplateId && oldProjectStatus.value.length > 0){
                    showSidebar.value = true;
                    projectStatusConfirm.value = true;
                    resolve(false);
                }else{
                    resolve(true);
                }
            }else if(props.sidebarTitle === 'taskType'){
                if(formData.value.taskTypeForm.taskTypeField.value._id !== props.projectData.TaskTypeTemplateId && oldTaskType.value.length > 0){
                    showSidebar.value = true;
                    taskTypeConfirm.value = true;
                    resolve(false);
                }else{
                    resolve(true);
                }
            }else if(props.sidebarTitle === 'taskStatus'){
                if(formData.value.taskStatusForm.taskStatusField.value._id !== props.projectData.TemplateTaskStatusId && oldTaskStatus.value.length > 0){
                    showSidebar.value = true;
                    statusConfirm.value = true;
                    resolve(false);
                }else{
                    resolve(true);
                }
            }
        } catch (error) {
            reject(false);
        }
    })
}

function finalConfirm() {
    if(props.sidebarTitle === 'projectStatus'){
        finalSubmit();
    }
    if(props.sidebarTitle === 'taskType'){
        finalSubmitTaskType(true);  
    }
}

function checkTaskType() {
    if(props.sidebarTitle === 'taskStatus'){
        finalSubmitTaskStatus(true);  
    }
}

async function submitData () {
    const tasks =  await checkTasks();

    let checkRemoveStatus = [];

    if(props.sidebarTitle === 'taskType'){
        taskTypes.value = true;
        checkRemoveStatus = tasks.map(task => finalStatusData.value.find(status => status.key === task.TaskTypeKey)).filter((x) => x !== undefined);
    }
    else if(props.sidebarTitle === 'taskStatus'){
        statusType.value = true;
        checkRemoveStatus = tasks.map(task => finalStatusData.value.find(status => status.key === task.statusKey)).filter((x) => x !== undefined);
    }
    else{
        projectStatusType.value = true;
        checkRemoveStatus = finalStatusData.value.filter(status => status.value === props.projectData.status);
    }

    if(checkRemoveStatus.length > 0) {
        openSidebar.value = true;
        oldStatus.value = checkRemoveStatus;
    }
    else{
        executeData();
    }
}
async function finalSubmit()  {
    try {
        if(oldProjectStatus.value.length > 0){
            oldProjectStatus.value.filter((x) => {
                if(x.convertStatus === undefined || x.convertStatus === ''){
                    errorMsg.value = t('general.Please_Select_Status');
                }else{
                    errorMsg.value = '';
                }
            })
        }
        if(errorMsg.value !== ''){
            return false;
        }
        let updateObj = {};
        updateObj['projectStatusData'] = [
            ...formData.value.projectStatusForm.projectStatusField.value.projectActiveStatus,
            ...formData.value.projectStatusForm.projectStatusField.value.projectDoneStatus, 
            {...formData.value.projectStatusForm.projectStatusField.value.projectCompletedStatus},
        ]
        let index = projectStaus.value.findIndex((x) => {
            return x._id === formData.value.projectStatusForm.projectStatusField.value._id
        })
        let projectStausValue;
        if(index !== -1){
            projectStausValue = projectStaus.value[index];
        }
        updateObj['projectStatusTemplateId'] = formData.value.projectStatusForm.projectStatusField.value.projectActiveStatus.length === projectStausValue?.projectActiveStatus.length && formData.value.projectStatusForm.projectStatusField.value.projectDoneStatus.length === projectStausValue.projectDoneStatus.length ? formData.value.projectStatusForm.projectStatusField.value._id : ''
        if(formData.value.projectStatusForm.projectStatusField.value._id !== props.projectData.projectStatusTemplateId && projectStausValue !== undefined){
            updateObj['projectStatusTemplateId'] =  formData.value.projectStatusForm.projectStatusField.value.projectActiveStatus.length === projectStausValue?.projectActiveStatus.length && formData.value.projectStatusForm.projectStatusField.value.projectDoneStatus.length === projectStausValue.projectDoneStatus.length ? formData.value.projectStatusForm.projectStatusField.value._id : ''
            if(oldProjectStatus.value.length > 0){
                let newStatus = props.projectData.projectStatusData.filter((y) => y.value === props.projectData.status)[0].convertStatus;
                updateObj['statusType'] = newStatus.type;
                updateObj['status'] = newStatus.value;
                updateObj['projectStatusData'].push(newStatus);
            }
        }
        if(oldStatus.value.length > 0) {
            updateObj['statusType'] = oldStatus.value[0].convertStatus.type;
            updateObj['status'] = oldStatus.value[0].convertStatus.value;
        }
        await apiRequest("put",`/api/v1/${env.PROJECTACTIONS}/${props.projectData._id}`,{updateObject: updateObj})
        commit('projectData/projectLocalUpdate', {itemData:  {...props.projectData,...updateObj},projectId:props.projectData._id,key:'RemoveProject',userId: ''});
        emit("isSidebarProjectSetting",false);
    } catch (error) {
       console.error("Error Update Project Status",error); 
    }
}

async function finalSubmitTaskType(value)  {
    try {
        if(oldTaskType.value.length > 0){
            oldTaskType.value.filter((x) => {
                if(x.convertType === undefined || x.convertType === ''){
                    errorMsgType.value = t('Toast.Please_Select_Task_Type');
                }else{
                    errorMsgType.value = '';
                }
            })
        }
        if(errorMsgType.value !== ''){
            return false;
        }
        let updateObj = {};
        let taskTypeindex = taskType.value.findIndex((x) => {
            return x._id === formData.value.taskTypeForm.taskTypeField.value._id
        })
        let taskTypeValue = taskType.value[taskTypeindex];
        updateObj = {
            'taskTypeCounts' : formData.value.taskTypeForm.taskTypeField.value.taskTypes,
        }
        if(taskTypeValue !== undefined){
            updateObj.TaskTypeTemplateId = formData.value.taskTypeForm.taskTypeField.value.taskTypes.length === taskTypeValue.taskTypes.length ?  formData.value.taskTypeForm.taskTypeField.value._id : ''
        }
        await apiRequest("put",`/api/v1/${env.PROJECTACTIONS}/${props.projectData._id}`,{updateObject: updateObj})
        commit('projectData/projectLocalUpdate', {itemData:  {...props.projectData,...updateObj},projectId:props.projectData._id,key:'RemoveProject',userId: ''});
        if(value === true) {
            isSpinner.value = true;
            let axiosData = {
                companyId : companyId.value,
                projectId : props.projectData._id,
                taskTypeKey : oldTaskType.value.map(status => status.key),
                oldTaskType : oldTaskType.value
            }

            apiRequest("post", env.TASKTYPE, axiosData).then(() => {
                isSpinner.value = false;
                emit("isSidebarProjectSetting",false);
            }).catch((error) => {
                isSpinner.value = false;
                emit("isSidebarProjectSetting",false);
                console.error(error,"ERROR");
            })

        }else{
            emit("isSidebarProjectSetting",false);
        }
        if(finalStatusData.value.length > 0){
            let axiosData = {
                companyId : companyId.value,
                projectId : props.projectData._id,
                taskTypeKey : finalStatusData.value.map(status => status.key),
                oldTaskType : finalStatusData.value
            }

            apiRequest("post", env.TASKTYPE, axiosData).then(() => {
                isSpinner.value = false;
                emit("isSidebarProjectSetting",false);
            }).catch((error) => {
                isSpinner.value = false;
                emit("isSidebarProjectSetting",false);
                console.error(error,"ERROR");
            })
        }
    } catch (error) {
        console.error("Error Final Submit Task Type",error);
    }
}

async function finalSubmitTaskStatus(value)  {
    try {
        if(oldTaskStatus.value.length > 0){
            oldTaskStatus.value.filter((x) => {
                if(x.convertStatus === undefined || x.convertStatus === ''){
                    errorMsg.value = t('general.Please_Select_Status');
                }else{
                    errorMsg.value = '';
                }
            })
        }
        if(errorMsg.value !== ''){
            return false;
        }
        let updateObj = {};
        let taskStatusindex = taskStatus.value.findIndex((x) => {
            return x._id === formData.value.taskStatusForm.taskStatusField.value._id
        })
        let taskStausValue = taskStatus.value[taskStatusindex];
        updateObj = {
            'taskStatusData' : [{...formData.value.taskStatusForm.taskStatusField.value.defaultActive}, ...formData.value.taskStatusForm.taskStatusField.value.ActiveStatusList, ...formData.value.taskStatusForm.taskStatusField.value.DoneStatusList, {...formData.value.taskStatusForm.taskStatusField.value.defaultComplete}],
        }
        if(taskStausValue !== undefined){
            updateObj.TemplateTaskStatusId = formData.value.taskStatusForm.taskStatusField.value.ActiveStatusList.length === taskStausValue.ActiveStatusList.length && formData.value.taskStatusForm.taskStatusField.value.DoneStatusList.length === taskStausValue.DoneStatusList.length ?  formData.value.taskStatusForm.taskStatusField.value._id : ''
        }
        await apiRequest("put",`/api/v1/${env.PROJECTACTIONS}/${props.projectData._id}`,{updateObject: updateObj})
        commit('projectData/projectLocalUpdate', {itemData:  {...props.projectData,...updateObj},projectId:props.projectData._id,key:'RemoveProject',userId: ''});
        if(value === true) {
            isSpinner.value = true;
            let axiosData = {
                companyId : companyId.value,
                projectId : props.projectData._id,
                taskStatusKey : oldTaskStatus.value.map(status => status.key),
                oldTaskStatus : oldTaskStatus.value
            }

            apiRequest("post", env.TASKSTATUS, axiosData).then(() => {
                isSpinner.value = false;
                emit("isSidebarProjectSetting",false);
            }).catch((error) => {
                isSpinner.value = false;
                emit("isSidebarProjectSetting",false);
                console.error(error,"ERROR");
            })

        }else{
            emit("isSidebarProjectSetting",false);
        }
        if(finalStatusData.value.length > 0){
            let axiosData = {
                companyId : companyId.value,
                projectId : props.projectData._id,
                taskStatusKey : finalStatusData.value.map(status => status.key),
                oldTaskStatus : finalStatusData.value
            }

            apiRequest("post", env.TASKSTATUS, axiosData).then(() => {
                isSpinner.value = false;
                emit("isSidebarProjectSetting",false);
            }).catch((error) => {
                isSpinner.value = false;
                emit("isSidebarProjectSetting",false);
                console.error(error,"ERROR");
            })
        }
    } catch (error) {
        console.error("Error Final Submit Task Status",error);
    }
}

function saveTemplate(newId,oldId,type) {
    if(type === 'taskstatus'){
        if(projectStatus.value.TemplateTaskStatusId === oldId){
            projectStatus.value.TemplateTaskStatusId = newId;
        }
    }else if(type === 'tasktype'){
        if(projectStatus.value.TaskTypeTemplateId === oldId){
            projectStatus.value.TaskTypeTemplateId = newId;
        }
    }else if(type === 'projectstatus'){
        if(projectStatus.value.projectStatusTemplateId === oldId){
            projectStatus.value.projectStatusTemplateId = newId;
        }
    }
}

const changeStatus = (st,st1,type) => {
    if(type === 'projectStatus'){
        props.projectData.projectStatusData.filter((val) => {
            if(val.key === st1.key){
                val['convertStatus'] = st;
            }
        })
    }
    if(type === 'taskStatus'){
        oldTaskStatus.value.filter((val) => {
            if(val.key === st1.key){
                val['convertStatus'] = st;
            }
        })
    }
}

const changeTaskType = (type,type1) => {
    oldTaskType.value.filter((val) => {
        if(val.value === type1.value){
            val['convertType'] = type;
        }
    })
}

function checkTasks () {
    return new Promise((resolve, reject) => {
        try {
            if(props.sidebarTitle === 'taskType' || props.sidebarTitle === 'taskStatus'){
                if(Object.keys(props.projectData).length > 0) {
                    usedStatus.value = [];
                    const key = props.sidebarTitle === 'taskType' ? 'TaskTypeKey' : 'statusKey'
                    const statusData = props.sidebarTitle === 'taskType' ? props.projectData.taskTypeCounts : props.projectData.taskStatusData
                    const promises = statusData.map((x) => {
                        const searchResult = {
                            $match: {
                                $and: [
                                    {
                                        objId: {
                                            ProjectID: props.projectData._id,
                                        }
                                    },
                                    { [key]: x.key }
                                ]
                            }
                        };
    
                        return apiRequest('post', `${env.TASK}/find`, { findQuery: searchResult })
                            .then((response) => {
                                const result = response.data[0];
                                if (result) {
                                    usedStatus.value.push(result);
                                }
                            }).catch((err) => {
                                console.error("Error onMounted hook: ", err);
                            });
                        });
    
                        Promise.allSettled(promises)
                        .then(() => {
                            resolve(usedStatus.value);
                        })
                        .catch((error) => {
                            reject(error); 
                        })
                }
            }
            else {
                resolve([]);
            }
        } catch (error) {
            reject(error)
        }
    })
}

function executeData() {
    checkStatus().then((res) => {
        if(res === true && props.sidebarTitle === 'projectStatus'){
            finalSubmit();
        }
        if(res === true && props.sidebarTitle === 'taskType'){
            finalSubmitTaskType(false);
        }
        if(res === true && props.sidebarTitle === 'taskStatus'){
            finalSubmitTaskStatus(false);
        }
        resetStatus();
    })
}

function modifyStatus(newS,oldS,type) {
    if(type === 'projectStatus'){
        oldStatus.value.filter((val) => {
            if(val.key === oldS.key){
                val['convertStatus'] = newS;
            }
        })
    }else{
        finalStatusData.value.filter((val) => {
            if(val.key === oldS.key){
                val['convertStatus'] = newS;
            }
            else{
                delete val.convertStatus;
            }
        })
    }
}

function modifyType(newS,oldS) {
    finalStatusData.value.filter((val) => {
        if(val.key === oldS.key){
            val['convertType'] = newS;
        }
        else{
            delete val.convertType;
        }
    })
}

function updateStatus (item,type) {
    if(type === 'add'){
        item.convertStatus = '';
        item.convertType = '';
        finalStatusData.value.push(item);
    }
    else{
        let index = finalStatusData.value.findIndex((x) => x.key == item.key);
        if(index !== -1){
            finalStatusData.value.splice(index,1)
        }
    }
}

function confirmData () {
    if(props.sidebarTitle === 'taskStatus' || props.sidebarTitle === 'projectStatus'){
        if(finalStatusData.value.length > 0){
            finalStatusData.value.filter((x) => {
                if(x.convertStatus === ''){
                    errorMsg.value = t('general.Please_Select_Status');
                }else{
                    errorMsg.value = '';
                }
            })
        }
    }
    else if(props.sidebarTitle === 'taskType'){
        if(finalStatusData.value.length > 0){
            finalStatusData.value.filter((x) => {
                if(x.convertType === ''){
                    errorMsgType.value = t('Toast.Please_Select_Task_Type');
                }else{
                    errorMsgType.value = '';
                }
            })
        }
    }
    if(errorMsg.value !== '' || errorMsgType.value !== ''){
        return false;
    }
    executeData();
}
</script>

<style>
.cancelButtonProject{
    border: 1px solid #2F3990;
    border-radius: 4px;
    height: 30px;
    padding: 3px 14px;
    font-size: 16px;
    line-height: 24px;
    font-family: 'Roboto', sans-serif;
}
.project__setting--blankproject{
    padding: 20px;
}
.dragImage  {
    left: -17px;
    top: 0px;
    cursor: grab;
}
.practice-customer {
    margin-left: auto;
}
input.statusInputText.form-control.edit-input:focus-visible{outline-color: none !important;}

/* Settings sidebar: fill the body so the form panel spans the full height instead of
   leaving an empty gap below its content. Scoped to .pss__setting-* (added only here) so
   the shared .createProjectWizardSlider in the create-project wizard stays untouched. */
.pss__setting-body { display: flex; flex-direction: column; }
.pss__setting-body > .pss__setting-panel { flex: 1 1 auto; min-height: 0; }

/* Settings sidebar (desktop): the form and both scrollable lists grow to fill the
   panel height dynamically. Chain: panel → form root (.statusHeader) → section →
   columns row → each column → its list. min-height:0 at every level lets the inner
   lists scroll instead of overflowing. Scoped to .pss__setting-panel so the shared
   create-project wizard / template pages are untouched; desktop-only so the mobile
   rules below (max-height:500px etc.) still own small screens. */
@media(min-width: 768px){
    .pss__setting-panel { display: flex; flex-direction: column; box-sizing: border-box; }
    .pss__setting-panel > .statusHeader { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
    .pss__setting-panel > .statusHeader > .bg-light-gray { flex: none; }
    /* overflow:hidden is load-bearing: it forces the min-height:0 chain to bound, so the
       lists scroll instead of growing and pushing the add/new-template buttons out.
       max-height:none overrides the base `.taskStatusSection.style-scroll{max-height:307px}`
       cap so the section grows to the full panel height instead of stopping short. */
    .pss__setting-panel .taskStatusSection { flex: 1 1 auto; min-height: 0; max-height: none !important; overflow: hidden; }
    .pss__setting-panel .statusTaskWrapper { height: 100%; min-height: 0; }

    .pss__setting-panel .taskStatusLeft { display: flex; flex-direction: column; min-height: 0; }
    .pss__setting-panel .taskStatusLeft .templated_name_ul { max-height: none !important; min-height: 60px; }
    .pss__setting-panel .taskStatusLeft .add_template { flex: none; }

    .pss__setting-panel .taskyou_need_right { display: flex; flex-direction: column; min-height: 0; }
    .pss__setting-panel .taskyou_need_right .ddf__root { min-height: 0; display: flex; flex-direction: column; }
    .pss__setting-panel .taskyou_need_right .status_ul { flex: 1 1 auto; max-height: none !important; min-height: 0; overflow-y: auto; }
    .pss__setting-panel .taskyou_need_right .addStatusBtn { flex: none; padding-top: 12px; }
}

@media(max-width: 767px){
    .project__setting--blankproject {padding: 20px !important;border-radius: 0 !important;}
    .project__setting--blankproject .taskStatusRight ul.status_ul li {height: 40px !important;}
    .project__setting--blankproject .taskStatusRight.taskyou_need_right ul.status_ul li{height: 40px !important;}
    .project__setting--blankproject  .activeStatus ul.status_ul li {padding-top: 4px !important;padding-bottom: 4px !important;}
    .project__setting--blankproject .mobile-project-taskstatus-section.task-detail-mobile .bg-light-gray{padding: 18.5px 10px !important;}
    .project__setting--blankproject img.ignore-drag.project__setting-ignoredrag {height: 16px !important;width: 16px !important;}
    .project__setting--blankproject .taskStatusSection.style-scroll {max-height: 500px !important;}
    .project__setting--blankproject .taskStatusRight ul.status_ul li.d-flex.align-items-center.justify-content-between {padding-top: 4px !important;padding-bottom: 4px !important;}
}
</style>