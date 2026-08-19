<!-- =========================================================================================
    Created By : Dipsha Kalariya
    Commnet : This component is used to display task status detail for blank project form as step-6 in create project module.
    Now a thin wrapper over the reusable <TemplateSelectForm>: it owns the task-status data,
    store/API operations and the right-column list; the shell owns the template picker UI.
========================================================================================== -->
<template>
<div class="statusHeader statusHeader_two">
    <h3 v-if="fromWhich == ''" class="heading_text bg-light-gray mt-0px"
    :class="{'border-radius-5-px  task-heading-desktop': clientWidth > 767 , 'border-radius-8-px  task-heading-mobile': clientWidth <= 767}"
    >{{$t('Templates.setup_status')}}</h3>
    <h3 v-else class="heading_text bg-light-gray mt-0px"
    :class="{'border-radius-5-px  task-heading-desktop': clientWidth > 767 , 'border-radius-8-px  task-heading-mobile': clientWidth <= 767}"
    >{{$t('Templates.what_task')}}?</h3>
    <div class="taskStatusSection style-scroll">
        <TemplateSelectForm
            ref="templateFormRef"
            :templates="templateList"
            :modelValue="theModel.taskStatusField.value"
            :fieldError="theModel.taskStatusField.error"
            :isSaving="isSpinner"
            rightClass="status_right status_new_right"
            @update:modelValue="setTemplateData"
            @create="onCreateTemplate"
            @rename="onRenameTemplate"
            @delete="onDeleteTemplate"
            @save="saveTemplateData"
            @left-focus="onLeftFocus"
        >
            <template #list>
                <h3 :class="{'taskstatustitle-desktop': clientWidth > 767 , 'taskstatustitle-mobile': clientWidth <= 767}"
                >{{$t('Projects.active_status')}}</h3>
                <div class="statuInputwrapper activeStatus" v-if="theModel.taskStatusField.value.defaultActive && Object.keys(theModel.taskStatusField.value.defaultActive).length > 0">
                    <ul class="status_ul">
                        <li class="d-flex align-items-center justify-content-between">
                            <span class="taskInnerData w-100" :class="{'taskInnerData-desktop': clientWidth > 767 , 'taskInnerData-mobile': clientWidth <= 767}">
                                <div class="d-flex align-items-center ml-15px">
                                    <input type="color" :id="`activeTaskStatus${98}`" v-model.trim="theModel.taskStatusField.value.defaultActive.textColor" @input="theModel.taskStatusField.value.defaultActive.bgColor = theModel.taskStatusField.value.defaultActive.textColor+'35',inputColor()"  class="p-0 mr-8px d-inline-block border-radius-2-px border-0 bg-transparent cursor-pointer project__status-icon" disabled>
                                    <span class="style_changes_value"   :class="{'taskInnerData-desktop': clientWidth > 767 , 'taskInnerData-mobile': clientWidth <= 767}" v-if="!theModel.taskStatusField.value.defaultActive.isEditable" :style="[{'color': theModel.taskStatusField.value.defaultActive.textColor}]">{{theModel.taskStatusField.value.defaultActive.statusName ? theModel.taskStatusField.value.defaultActive.statusName : theModel.taskStatusField.value.defaultActive.name}}</span>
                                    <input v-if="theModel.taskStatusField.value.defaultActive.isEditable" class="addStatusInput form-control" type="text"  v-model.trim="theModel.taskStatusField.value.defaultActive.statusName" @keypress.enter.prevent="saveTaskStatus('editType',theModel.taskStatusField.value.defaultActive)" @input="errorMsgTask = ''"/>
                                    <span class="position-ab" :style="[{top : clientWidth > 767 ? '8px' : '8px', right : clientWidth > 767 ? '10px' : '15px'}]">
                                        <img :src="saveData" class="cursor-pointer" v-if="theModel.taskStatusField.value.defaultActive.isEditable" @click="saveTaskStatus('editType',theModel.taskStatusField.value.defaultActive)">
                                        <img :src="deletered" class="cursor-pointer ml-10px" v-if="theModel.taskStatusField.value.defaultActive.isEditable" @click="theModel.taskStatusField.value.defaultActive.isEditable = false,theModel.taskStatusField.value.defaultActive.statusName = taskStatusName,errorMsgTask = ''">
                                    </span>
                                </div>
                            </span>
                        </li>
                    </ul>
                </div>
                <DragDropField :group="{ name: 'task_status_group' }"
                    class="tsf-fill-list"
                    :isDeletable="true" :isChangeColor="true"
                    v-model="theModel.taskStatusField.value.ActiveStatusList"
                    categoryTytpe="active"
                    @change:DraggableOption="manageSelectedOption"
                    @enter:updateFieldValue="addTaskStatus"
                    @click:updateFieldValue="addTaskStatus"
                    @input:deleteFieldValue="manageDeleteData"
                    @resetTaskTypeErr="errorMsgTask=''"
                    :addTaskType="addTaskType"
                    @changeColor="inputColor()"
                    :useDataArray="useTaskStatusArr"
                    :projectData="projectData"
                />
                <button class="cursor-pointer btn btn-primary addstatus-btn ml-0 mb-20px" type="button" @click="openTaskStatusSidebar()">+ {{$t('Projects.add_status')}}</button>
                <div class="red">
                    <span v-if="errorMsgTask" class="font-size-11">{{errorMsgTask}}</span>
                </div>
                <h3 :class="{'taskstatustitle-desktop': clientWidth > 767 , 'taskstatustitle-mobile': clientWidth <= 767}"
                >{{$t('Projects.done_status')}}</h3>
                <DragDropField
                    :group="{ name: 'task_status_group' }"
                    v-if="theModel.taskStatusField && Object.keys(theModel.taskStatusField.value).length > 0"
                    :isDeletable="true"
                    :isChangeColor="true"
                    v-model="theModel.taskStatusField.value.DoneStatusList"
                    categoryTytpe="done"
                    @change:DraggableOption="manageSelectedOption"
                    @enter:updateFieldValue="addTaskStatus"
                    @click:updateFieldValue="addTaskStatus"
                    @input:deleteFieldValue="manageDeleteData"
                    @resetTaskTypeErr="errorMsgTask=''"
                    :addTaskType="addTaskType"
                    @changeColor="inputColor()"
                    :useDataArray="useTaskStatusArr"
                    :projectData="projectData"
                />
                <div>
                    <h3 :class="{'taskstatustitle-desktop': clientWidth > 767 , 'taskstatustitle-mobile mt-030': clientWidth <= 767}"
                    >{{$t('Projects.close_status')}}</h3>
                    <div class="statuInputwrapper activeStatus" v-if="theModel.taskStatusField.value.defaultComplete && Object.keys(theModel.taskStatusField.value.defaultComplete).length > 0">
                        <ul class="status_ul">
                            <li class="d-flex align-items-center justify-content-between">
                            <div class="d-flex align-items-center w-100 ml-16px">
                                <input type="color" :id="`CloseTaskStatus${98}`" v-model.trim="theModel.taskStatusField.value.defaultComplete.textColor" @input="theModel.taskStatusField.value.defaultComplete.bgColor = theModel.taskStatusField.value.defaultComplete.textColor+'35'" class="p-0 mr-8px d-inline-block border-radius-2-px border-0 bg-transparent cursor-pointer project__status-icon" disabled>
                                <span class="style_changes_value" :class="{'taskInnerData-desktop': clientWidth > 767 , 'taskInnerData-mobile': clientWidth <= 767}" v-if="!theModel.taskStatusField.value.defaultComplete.isEditable" :style="[{'color': theModel.taskStatusField.value.defaultComplete.textColor}]">{{theModel.taskStatusField.value.defaultComplete.name ? theModel.taskStatusField.value.defaultComplete.name : theModel.taskStatusField.value.defaultComplete.name}}</span>
                                <input v-if="theModel.taskStatusField.value.defaultComplete.isEditable"  class="addStatusInput form-control" type="text" v-model.trim="theModel.taskStatusField.value.defaultComplete.name" @keypress.enter.prevent="saveTaskStatus('editType',theModel.taskStatusField.value.defaultComplete)" @input="errorMsgTask = ''" />
                                <span class="position-ab save__delete-wrappper" :style="[{top : clientWidth > 767 ? '6px' : '10px'}]">
                                    <img :src="saveData" class="cursor-pointer"  v-if="theModel.taskStatusField.value.defaultComplete.isEditable" @click="saveTaskStatus('editType',theModel.taskStatusField.value.defaultComplete)">
                                    <img :src="deletered" class="cursor-pointer ml-10px" v-if="theModel.taskStatusField.value.defaultComplete.isEditable" @click="theModel.taskStatusField.value.defaultComplete.isEditable = false,theModel.taskStatusField.value.defaultComplete.name = taskStatusName,errorMsgTask = ''">
                                </span>
                            </div>
                            </li>
                        </ul>
                    </div>
                </div>
            </template>
        </TemplateSelectForm>
    </div>
    <TaskStatusSidebar v-if="isTaskSidebarOpen" :isTaskSidebarOpen="isTaskSidebarOpen" @closesidebar="isTaskSidebarOpen = false" :title="$t('Projects.list_of_task_status')" :options="statusOPtion" @selected="updateTaskStatus" @removed="removeTaskStatus" :isAddStatus="true" :type="'task_status'" :useDataArray="useTaskStatusArr"/>

</div>
</template>
<script setup>
import { useStore } from "vuex";
import { ref, onMounted, inject, watch, defineComponent } from "vue";
const {getters, commit} = useStore();
import DragDropField from '@/components/atom/DragDropField/DragDropField.vue';
import {useToast} from 'vue-toast-notification';
import TaskStatusSidebar from '@/components/molecules/TaskStatusSidebar/TaskStatusSidebar.vue';
import TemplateSelectForm from '@/components/molecules/TemplateSelectForm/TemplateSelectForm.vue';
import cloneDeep from 'lodash/cloneDeep'; // Import a cloning library
import { useI18n } from "vue-i18n";
import * as env from '@/config/env';
import { apiRequest } from "@/services";
const { t } = useI18n();
    defineComponent({
        name: "Task-Status-form",
    })
    const deletered = require("@/assets/images/svg/deletered.svg");
    const templateList = ref([]);
    const clientWidth = inject("$clientWidth");
    const $toast = useToast();
    const saveData = require("@/assets/images/save.png");
    const isSpinner = ref(false);
    const templateFormRef = ref(null);
    const props = defineProps({
        modelValue: {
            type: Object,
            default: () => ({}),
        },
        projectData: {
            type: Object,
            default: () => ({})
        },
        from: {
            type: String,
            default: () => (''),
        }
    });
    const theModel = ref(props.modelValue);
    const fromWhich = ref(props.from);
    const isTaskSidebarOpen = ref(false);
    const statusOPtion = ref([]);
    const newStatusData = ref([]);

    const emit = defineEmits([
        'update:modelValue','renameTaskStatus','setTemplateDataTaskStatus','saveTemplate','spinnerOn','updateStatus'
    ]);
    const errorMsgTask = ref('');
    const useTaskStatusArr = ref([]);
    onMounted(() => {
        templateList.value = cloneDeep(getters['settings/taskStatus']);
        emit('update:modelValue', theModel.value);
        if(templateList.value.length > 0){
            if(fromWhich.value === 'setting'){
                let index = templateList.value.findIndex((x) => {
                    return x._id === props.projectData.TemplateTaskStatusId;
                })
                if(index !== -1){
                    theModel.value.taskStatusField.value = Object.keys(theModel.value.taskStatusField.value).length > 0 ? theModel.value.taskStatusField.value : templateList.value[index]
                }else{
                    const customObj = {
                        TemplateName : 'Custom',
                        defaultActive : props.projectData.taskStatusData.filter((x) => x.type==='default_active')[0],
                        DoneStatusList : props.projectData.taskStatusData.filter((x) => x.type==='done'),
                        defaultComplete : props.projectData.taskStatusData.filter((x) => x.type==='close')[0],
                        ActiveStatusList : props.projectData.taskStatusData.filter((x) => x.type==='active')
                    }
                    templateList.value = [customObj, ...templateList.value];
                    theModel.value.taskStatusField.value = Object.keys(theModel.value.taskStatusField.value).length > 0 ? theModel.value.taskStatusField.value : customObj;
                }
            }else{
                theModel.value.taskStatusField.value = Object.keys(theModel.value.taskStatusField.value).length > 0 ? theModel.value.taskStatusField.value :templateList.value[0];
                let find = templateList.value.find((x) => x._id === theModel.value.taskStatusField.value._id);
                if(find === undefined){
                    templateList.value.push(theModel.value.taskStatusField.value);
                }
            }
            statusOPtion.value = [...theModel.value.taskStatusField.value.ActiveStatusList, ...theModel.value.taskStatusField.value.DoneStatusList, theModel.value.taskStatusField.value.defaultActive, theModel.value.taskStatusField.value.defaultComplete];
        }
        if(Object.keys(props.projectData).length > 0) {
            props.projectData.taskStatusData.forEach((x) => {
                const searchResult = {
                    $match: {
                        $and:[
                            {
                                objId: {
                                    ProjectID: props.projectData._id,
                                }
                            },
                            { statusKey: x.key }
                        ]
                    }
                }

                apiRequest('post', `${env.TASK}/find`, { findQuery: searchResult }).then((response) => {
                    const result = response.data[0];
                    if(result){
                        useTaskStatusArr.value.push(result);
                    }
                }).catch((err) => {
                    console.error("Error onMounted hook: ", err)
                });
            })

        }
    })
    watch(() => getters['settings/taskStatus'], (val) => {
        templateList.value = cloneDeep(val);
        if(templateList.value.length){
            if(fromWhich.value === 'setting'){
                let index = templateList.value.findIndex((x) => {
                    return x._id === props.projectData.TemplateTaskStatusId;
                })
                if(index !== -1){
                    theModel.value.taskStatusField.value = Object.keys(theModel.value.taskStatusField.value).length > 0 ? theModel.value.taskStatusField.value : templateList.value[index]
                }else{
                    const customObj = {
                        TemplateName : 'Custom',
                        defaultActive : props.projectData.taskStatusData.filter((x) => x.type==='default_active')[0],
                        DoneStatusList : props.projectData.taskStatusData.filter((x) => x.type==='done'),
                        defaultComplete : props.projectData.taskStatusData.filter((x) => x.type==='close')[0],
                        ActiveStatusList : props.projectData.taskStatusData.filter((x) => x.type==='active')
                    }
                    templateList.value = [customObj, ...templateList.value];
                    theModel.value.taskStatusField.value = Object.keys(theModel.value.taskStatusField.value).length > 0 ? theModel.value.taskStatusField.value : customObj;
                }
            }else{
                theModel.value.taskStatusField.value = Object.keys(theModel.value.taskStatusField.value).length > 0 ? theModel.value.taskStatusField.value :templateList.value[0];
            }
            statusOPtion.value = [...theModel.value.taskStatusField.value.ActiveStatusList, ...theModel.value.taskStatusField.value.DoneStatusList, theModel.value.taskStatusField.value.defaultActive, theModel.value.taskStatusField.value.defaultComplete];
        }
    })
    watch(()=> props.modelValue ,(val)=>{
        theModel.value = val;
    })
    const addTaskType = ref(false);
    const taskStatusName = ref("");
    function openTaskStatusSidebar(){
        taskStatusName.value = '';
        addTaskType.value = true;
        isTaskSidebarOpen.value = true;
        templateFormRef.value?.closeInputs();
    }
    function onLeftFocus(){
        addTaskType.value = false;
        if(theModel.value.taskStatusField.value.defaultActive){
            theModel.value.taskStatusField.value.defaultActive.isEditable = false;
        }
        if(theModel.value.taskStatusField.value.defaultComplete){
            theModel.value.taskStatusField.value.defaultComplete.isEditable = false;
        }
        (theModel.value.taskStatusField.value.ActiveStatusList || []).forEach((x) => { x.isEditable = false; });
        (theModel.value.taskStatusField.value.DoneStatusList || []).forEach((x) => { x.isEditable = false; });
    }
    function setTemplateData(itemData) {
        theModel.value.taskStatusField.value = {};
        theModel.value.taskStatusField.value = itemData;
        statusOPtion.value = [...theModel.value.taskStatusField.value.ActiveStatusList, ...theModel.value.taskStatusField.value.DoneStatusList, theModel.value.taskStatusField.value.defaultActive, theModel.value.taskStatusField.value.defaultComplete];
        if(fromWhich.value === 'setting'){
            emit('spinnerOn');
            newStatusData.value = statusOPtion.value;
            const notMatchedProjects = props.projectData.taskStatusData.filter((x) => {
                return !newStatusData.value.some((y) => y.key === x.key);
            });
            if(notMatchedProjects.length > 0){
                // BUG-017 / #71 fix: body uses apiRequest().then().catch(),
                // no `await`, so the `async` keyword was misleading.
                notMatchedProjects.forEach((x) => {
                    const searchResult = {
                        $match: {
                            $and:[
                                {
                                    objId: {
                                        ProjectID: props.projectData._id,
                                    }
                                },
                                { statusKey: x.key }
                            ]
                        }
                    }

                    apiRequest('post', `${env.TASK}/find`, { findQuery: searchResult }).then((response) => {
                        const result = response.data[0];
                        if(result){
                            useTaskStatusArr.value.push(result);
                        }
                    }).catch((err) => {
                        console.error("Error setTemplateData hook: ", err)
                    });

                    emit('setTemplateDataTaskStatus',useTaskStatusArr.value,notMatchedProjects)
                })
            }else{
                emit('setTemplateDataTaskStatus',useTaskStatusArr.value,notMatchedProjects)
            }
        }
        emit('update:modelValue', theModel.value);
    }
    function manageSelectedOption(item , event , categoryVal){
        if(event.added !== undefined){
            event.added.element.type = categoryVal;
        }
        let indexKey = templateList.value.findIndex((x)=>{
            return x._id == theModel.value.taskStatusField.value._id
        });
        if(categoryVal === 'active'){
            theModel.value.taskStatusField.value.ActiveStatusList = item
        }
        if(categoryVal === 'done'){
            theModel.value.taskStatusField.value.DoneStatusList = item;
        }
        if(indexKey !== -1 && theModel.value.taskStatusField.value.TemplateName !== 'Custom'){
            templateList.value[indexKey].isShowSave = true;
            if(categoryVal === 'active'){
                templateList.value[indexKey].ActiveStatusList = [...item];
            }
            if(categoryVal === 'done'){
                templateList.value[indexKey].DoneStatusList = [...item];
            }
            commit("settings/mutateTaskStatus", {data: templateList.value[indexKey], op: "modified"});
        }
    }
    function manageDeleteData(item){
        saveTaskStatus('deleteType',item);
    }
    function addTaskStatus(item){
        saveTaskStatus('editType',item)
    }
    function saveTaskStatus(type,rowData){
        if(type == "deleteType"){
            emit('updateStatus',rowData,'add');
            if(rowData.type == "done"){
                let keyVal = theModel.value.taskStatusField.value.DoneStatusList.findIndex((item)=>{
                    return item.key === rowData.key
                })
                if(keyVal !== -1){
                    theModel.value.taskStatusField.value.DoneStatusList.splice(keyVal,1);
                }
            }
            if(rowData.type == "active"){
                let keyVal = theModel.value.taskStatusField.value.ActiveStatusList.findIndex((item)=>{
                    return item.key === rowData.key
                })
                if(keyVal !== -1){
                    theModel.value.taskStatusField.value.ActiveStatusList.splice(keyVal,1);
                }
            }
            let indexKey = templateList.value.findIndex((x)=>{
                return x._id == theModel.value.taskStatusField.value._id
            });
            if(indexKey !== -1 && theModel.value.taskStatusField.value.TemplateName !== 'Custom'){
                templateList.value[indexKey].isShowSave = true;
                templateList.value[indexKey].ActiveStatusList = [...theModel.value.taskStatusField.value.ActiveStatusList];
                templateList.value[indexKey].DoneStatusList = [...theModel.value.taskStatusField.value.DoneStatusList];
                templateList.value[indexKey].defaultActive = {...theModel.value.taskStatusField.value.defaultActive};
                templateList.value[indexKey].defaultComplete = {...theModel.value.taskStatusField.value.defaultComplete};
                commit("settings/mutateTaskStatus", {data: templateList.value[indexKey], op: "modified"});
            }
        }
        emit('update:modelValue', theModel.value);
    }
    async function onCreateTemplate(name){
        const insertObj = {
            TemplateName : name,
            ActiveStatusList : [],
            DoneStatusList: [],
            defaultActive : {
                'name': 'To Do',
                'value': 'to_do',
                'textColor':'#ff9600',
                'bgColor': '#ff960035',
                'isEditable': false,
                'key':1,
                'editColor':false,
                'type': 'default_active'
            },
            defaultComplete : {
                'name': 'Complete',
                'value': 'complete',
                'textColor':'#6BC950',
                'bgColor': '#6BC95035',
                'isEditable': false,
                'key':2,
                'editColor':false,
                'type': 'close'
            },
            taskcloseStatus : 2,
            taskActiveStatus : [1],
            taskDoneStatus : [],
            createdAt: new Date()
        }
        const object = {
            updateObject:insertObj
        }
        await apiRequest("post",env.TASK_STATUS_TEMPLATE,object).then((res) => {
            if(res.status === 200 && res?.data?._id){
                commit("settings/mutateTaskStatus", {data: {...insertObj, _id: res?.data?._id || ''}, op: "added"});
                commit("settings/setProjectTaskStatusArray", {data: JSON.parse(JSON.stringify(({...insertObj, _id: res?.data?._id || '',newAdded:true}))), op: "added"});
                theModel.value.taskStatusField.value = {...insertObj, _id: res?.data?._id || ''};
                $toast.success(t("Toast.Template_has_been_created_Successfully"),{position: 'top-right'});
            }else{
                $toast.error(t('Toast.something_went_wrong'), {position: 'top-right' });
            }
        })
        .catch((error) => {
            console.error(error);
            $toast.error(t('Toast.something_went_wrong'), {position: 'top-right' });
        })
        emit('update:modelValue', theModel.value);
    }
    async function saveTemplateData(val){
        isSpinner.value = true;
        let indexKey = templateList.value.findIndex((x)=>{
            return x._id == val._id
        });
        if(indexKey !== -1){
            delete templateList.value[indexKey].isShowSave;
        }
        const oldId = val._id;
        const obj = {
            'TemplateName' :  templateList.value[indexKey].TemplateName,
            'ActiveStatusList': templateList.value[indexKey].ActiveStatusList,
            'DoneStatusList' : templateList.value[indexKey].DoneStatusList,
            'defaultComplete' : templateList.value[indexKey].defaultComplete,
            'defaultActive' : templateList.value[indexKey].defaultActive
        }
        if(templateList.value[indexKey].default !== undefined){
            obj.default = theModel.value.taskStatusField.value.default
        }
        await apiRequest("delete",`${env.TASK_STATUS_TEMPLATE}/${val._id}`).then(async(response) => {
            if(response.status === 200){
                const object = {
                    updateObject:obj
                }
                await apiRequest("post",env.TASK_STATUS_TEMPLATE,object).then((res) => {
                    if(res.status === 200 && res?.data?._id) {
                        if(oldId === theModel.value.taskStatusField.value?._id){
                            theModel.value.taskStatusField.value = {...obj , _id : res?.data?._id || ''};
                        }
                        let index = templateList.value.findIndex((x) => x._id === res?.data?._id || '');
                        const index1 = templateList.value.findIndex((type) => type._id === oldId);
                        if(index === -1 && index1 !== -1){
                            templateList.value[index1] = {...obj , _id : res?.data?._id || ''};
                        }
                        commit("settings/mutateTaskStatus", {data: {...obj , _id : oldId},newId:res?.data?._id || '', op: "modified"});
                        commit("settings/setProjectTaskStatusArray", {data: JSON.parse(JSON.stringify(({...obj , _id : oldId}))),newId:res?.data?._id || '', op: "modified"});
                        emit('saveTemplate',res?.data?._id || '',oldId,'taskstatus')
                    }else{
                        $toast.error(t('Toast.something_went_wrong'), {position: 'top-right' });
                    }
                    isSpinner.value = false;
                }).catch((err) => {
                    console.error(err)
                    $toast.error(t('Toast.something_went_wrong'), {position: 'top-right' });
                    isSpinner.value = false;
                })
            }else{
                $toast.error(t('Toast.something_went_wrong'), {position: 'top-right' });
                isSpinner.value = false;
            }
        }).catch((err) => {
            console.error(err)
            $toast.error(t('Toast.something_went_wrong'), {position: 'top-right' });
            isSpinner.value = false;
        })
    }
    async function onRenameTemplate(temp,name) {
        const object = {
            type: "updateOne",
            key: "$set",
            updateObject:{ TemplateName : name },
            id:temp._id
        };
        await apiRequest("put",env.TASK_STATUS_TEMPLATE,object).then((res) => {
            if(res.status === 200){
                let index = templateList.value.findIndex((x) => x._id === temp._id);
                if(index !== -1) {
                    let modifiedObj = {...templateList.value[index],TemplateName: name,isEditable:false};
                    commit("settings/mutateTaskStatus", {data: {...modifiedObj, _id: temp._id}, op: "modified"});
                }
                $toast.success(t("Toast.Template_name_updated_successfully"),{position: 'top-right'});
            }else {
                $toast.error(t('Toast.something_went_wrong'), {position: 'top-right' });
            }
        }).catch((err) => {
            console.error(err)
            $toast.error(t('Toast.something_went_wrong'), {position: 'top-right' });
        })
    }
    async function onDeleteTemplate(temp){
        await apiRequest("delete",`${env.TASK_STATUS_TEMPLATE}/${temp._id}`).then((response) => {
            if(response.status === 200){
                theModel.value.taskStatusField.value = templateList.value[0] || {};
                commit("settings/mutateTaskStatus", {data: {_id: temp._id}, op: "removed"});
                commit("settings/setProjectTaskStatusArray", {data: {_id: temp._id}, op: "removed"});
                $toast.success(t("Toast.Template_has_been_created_Successfully"),{position: 'top-right'});
            }else {
                $toast.error(t('Toast.something_went_wrong'), {position: 'top-right' });
            }
        }).catch((err) =>{
            console.error(err,"Error in Delete Template");
            $toast.error(t('Toast.something_went_wrong'), {position: 'top-right' });
        })
    }
    function updateTaskStatus (event) {
        emit('updateStatus',event,'remove');
        if(event.type === 'active'){
            theModel.value.taskStatusField.value.ActiveStatusList = [...theModel.value.taskStatusField.value.ActiveStatusList,event];
        }else if(event.type === 'done'){
            theModel.value.taskStatusField.value.DoneStatusList = [...theModel.value.taskStatusField.value.DoneStatusList,event];
        }
        let indexKey = templateList.value.findIndex((x)=>{
            return x._id == theModel.value.taskStatusField.value._id
        });
        if(indexKey !== -1 && theModel.value.taskStatusField.value.TemplateName !== 'Custom'){
            templateList.value[indexKey].isShowSave = true;
            templateList.value[indexKey].ActiveStatusList = [...theModel.value.taskStatusField.value.ActiveStatusList];
            templateList.value[indexKey].DoneStatusList = [...theModel.value.taskStatusField.value.DoneStatusList];
            templateList.value[indexKey].defaultActive = {...theModel.value.taskStatusField.value.defaultActive};
            templateList.value[indexKey].defaultComplete = {...theModel.value.taskStatusField.value.defaultComplete};
            commit("settings/mutateTaskStatus", {data: templateList.value[indexKey], op: "modified"});
        }
    }
    function removeTaskStatus (event) {
        emit('updateStatus',event,'add');
        if(event.type === 'active'){
            let activeIndex = theModel.value.taskStatusField.value.ActiveStatusList.findIndex((x) => {
                return x.key === event.key
            })

            if(activeIndex !== -1) {
                theModel.value.taskStatusField.value.ActiveStatusList.splice(activeIndex,1);
            }
        }else if(event.type === 'done'){
            let doneIndex = theModel.value.taskStatusField.value.DoneStatusList.findIndex((x) => {
                return x.key === event.key
            })

            if(doneIndex !== -1) {
                theModel.value.taskStatusField.value.DoneStatusList.splice(doneIndex,1);
            }
        }
        let indexKey = templateList.value.findIndex((x)=>{
            return x._id == theModel.value.taskStatusField.value._id
        });
        if(indexKey !== -1 && theModel.value.taskStatusField.value.TemplateName !== 'Custom'){
            templateList.value[indexKey].isShowSave = true;
            templateList.value[indexKey].ActiveStatusList = [...theModel.value.taskStatusField.value.ActiveStatusList];
            templateList.value[indexKey].DoneStatusList = [...theModel.value.taskStatusField.value.DoneStatusList];
            templateList.value[indexKey].defaultActive = {...theModel.value.taskStatusField.value.defaultActive};
            templateList.value[indexKey].defaultComplete = {...theModel.value.taskStatusField.value.defaultComplete};
            commit("settings/mutateTaskStatus", {data: templateList.value[indexKey], op: "modified"});
        }
    }
</script>
<style scoped>
@import './style.css';
</style>
