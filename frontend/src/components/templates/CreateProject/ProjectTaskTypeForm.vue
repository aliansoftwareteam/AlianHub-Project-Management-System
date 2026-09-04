<!-- =========================================================================================
    Created By : Dipsha Kalariya
    Commnet : This component is used to display project task type detail for blank project form as step-4 in create project module.
    Now a thin wrapper over the reusable <TemplateSelectForm>: it owns the task-type data,
    store/API operations and the right-column list; the shell owns the template picker UI.
========================================================================================== -->
<template>
<div class="statusHeader statusHeader_one">
    <div :class="{'border-radius-5-px': clientWidth > 767 , 'border-radius-8-px': clientWidth <= 767 } ">
        <h3 v-if="fromWhich == ''" class="heading_text mt-0 bg-light-gray"
        :class="{'border-radius-5-px  task-heading-desktop': clientWidth > 767 , 'border-radius-8-px task-heading-mobile': clientWidth <= 767}"
        >{{$t('Projects.add_task_need')}}</h3>
        <h3 v-else class="heading_text mt-0 bg-light-gray"
        :class="{'border-radius-5-px  task-heading-desktop': clientWidth > 767 , 'border-radius-8-px task-heading-mobile': clientWidth <= 767}"
        >{{$t('Projects.what_task_want')}}</h3>
    </div>
    <div class="taskStatusSection style-scroll">
        <TemplateSelectForm
            ref="templateFormRef"
            :templates="taskTypeTemplates"
            :modelValue="theModel.taskTypeField.value"
            :fieldError="theModel.taskTypeField.error"
            :isSaving="isSpinner"
            containerId="createprojecttasktypetemplate_driver"
            addIconId="createprojecttasktype_driver"
            rightId="createprojecttasktypetemplatestatus_driver"
            rightClass="taskyou_need_right"
            @update:modelValue="setTemplateData"
            @create="onCreateTemplate"
            @rename="onRenameTemplate"
            @delete="onDeleteTemplate"
            @save="saveTaskTypeTemplateData"
            @left-focus="onLeftFocus"
        >
            <template #list>
                <label :class="{'taskstatustitle-desktop': clientWidth > 767 , 'taskstatustitle-mobile': clientWidth <= 767}" >{{$t('Projects.task_type')}}</label>
                <DragDropField v-if="theModel.taskTypeField.value && Object.keys(theModel.taskTypeField.value).length > 0" :group="{ name: 'task_type_group' }" :isDeletable="true" :isChangeColor="false" :modelValue="theModel.taskTypeField.value.taskTypes"  @enter:updateFieldValue="addedTaskType" @click:updateFieldValue="addedTaskType" @input:deleteFieldValue="manageDeleteData" @resetTaskTypeErr="taskTypeError=''" @disbaleButton="(val)=>{$emit('disableNext',val)}" :addTaskType="addTaskType" :useDataArray="useTaskTypeArr" @update:modelValue="manageSelectedOption" :from="'task_type'"/>
                <div class="addStatusBtn searchValue mb-0">
                    <button class="cursor-pointer btn btn-primary" type="button" v-if="!addTaskType" @click="openTaskTypeSidebar()" id="createprojecttasktypenew_driver">+ {{$t('Home.add_task_type')}}</button>
                    <div class="d-flex align-items-center justify-content-between" v-else>
                        <button class="cursor-pointer upload-image-btn up__btn btn-primary" type="button">
                            <img v-if="addNewtaskImage" :src="addNewtaskImage" class="projecttasktypeform__image__after"/>
                            <img v-else src="@/assets/images/svg/upload.svg" class="projecttasktypeform__image__before" alt="upload">
                        </button>
                        <input :placeholder="$t('PlaceHolder.enter_task_type')" class="addStatusInput form-control add__task-type" v-model.trim="taskTypeName" @keypress.enter.prevent="addTaskTypeStatus('addType')" id="searchValueOutside" type="text" @input="resetTaskTypeData()">
                        <img class="greenCheck cursor-pointer green__check" src="@/assets/images/svg/greencheck2.svg" @click="addTaskTypeStatus('addType')" alt="save">
                        <img class="crossCheck cursor-pointer cross__check" src="@/assets/images/svg/deletered.svg" alt="cancel" @click="clearTaskType(),addNewtaskImage=''">
                    </div>
                </div>
                <div class="red pt-5px" >
                    <span v-if="taskTypeError" class="font-size-12 red">{{taskTypeError}}</span>
                </div>
            </template>
        </TemplateSelectForm>
    </div>
    <TaskStatusSidebar v-if="isTaskSidebarOpen" :isTaskSidebarOpen="isTaskSidebarOpen" @closesidebar="isTaskSidebarOpen = false" :title="$t(`Projects.list_of_task_type`)" :options="statusOPtion" @selected="updateTaskStatus" @removed="removeTaskStatus" :isAddStatus="true" :type="'task_type'" :useDataArray="useTaskTypeArr"/>
</div>
</template>
<script setup>
import { useStore } from "vuex";
import { ref, onMounted, watch, inject } from 'vue';
import DragDropField from '@/components/atom/DragDropField/DragDropField.vue';
const {getters, commit} = useStore();
import {useToast} from 'vue-toast-notification';
import TaskStatusSidebar from '@/components/molecules/TaskStatusSidebar/TaskStatusSidebar.vue';
import TemplateSelectForm from '@/components/molecules/TemplateSelectForm/TemplateSelectForm.vue';
import { useI18n } from "vue-i18n";
import * as env from '@/config/env';
import { apiRequest } from "@/services";
const { t } = useI18n();

    const taskTypeTemplates = ref([]);
    const isSpinner = ref(false);
    const clientWidth = inject("$clientWidth");
    const $toast = useToast();
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
    const emit = defineEmits([
        'update:modelValue','disableNext','openTaskTYpe','updateModel','renameTaskTypeSetting','setTemplateDataTaskType','saveTemplate','spinnerOn','updateStatus'
    ]);
    const theModel = ref(props.modelValue);
    const fromWhich = ref(props.from)
    const useTaskTypeArr = ref([]);
    const newTaskTypeData = ref([]);
    const isTaskSidebarOpen = ref(false);
    const statusOPtion = ref([]);
    const isDelete = ref(false);
    const hanldeProjectTaktypeTour = inject("hanldeProjectTaktypeTour", null);
    onMounted(() => {
        taskTypeTemplates.value = JSON.parse(JSON.stringify(getters['settings/taskType']));
        emit('update:modelValue', theModel.value);
        if(taskTypeTemplates.value.length > 0){
            if(fromWhich.value === 'setting'){
                let index = taskTypeTemplates.value.findIndex((x) => {
                    return x._id === props.projectData.TaskTypeTemplateId;
                })
                if(index !== -1){
                    theModel.value.taskTypeField.value = Object.keys(theModel.value.taskTypeField.value).length ? theModel.value.taskTypeField.value : taskTypeTemplates.value[index]
                }else{
                    const customObj = {
                        TemplateName : 'Custom',
                        taskTypes : props.projectData.taskTypeCounts
                    }
                    taskTypeTemplates.value = [customObj, ...taskTypeTemplates.value];
                    theModel.value.taskTypeField.value = Object.keys(theModel.value.taskTypeField.value).length ? theModel.value.taskTypeField.value : customObj;
                }
            }else{
                theModel.value.taskTypeField.value = Object.keys(theModel.value.taskTypeField.value).length ? theModel.value.taskTypeField.value : taskTypeTemplates.value[0];
                let find = taskTypeTemplates.value.find((x) => x._id === theModel.value.taskTypeField.value._id);
                if(find === undefined){
                    taskTypeTemplates.value.push(theModel.value.taskTypeField.value);
                }
            }
            statusOPtion.value = theModel.value.taskTypeField.value.taskTypes;
        }
        if(Object.keys(props.projectData).length > 0) {
            props.projectData.taskTypeCounts.forEach((x) => {
                const searchResult = {
                    $match: {
                        $and:[
                            {
                                objId: {
                                    ProjectID: props.projectData._id,
                                }
                            },
                            { TaskTypeKey: x.key }
                        ]
                    }
                }

                apiRequest('post', `${env.TASK}/find`, { findQuery: searchResult }).then((response) => {
                    const result = response.data[0];
                    if(result){
                        useTaskTypeArr.value.push(result);
                    }
                }).catch((err) => {
                    console.error("Error onMounted hook: ", err)
                });
            })
        }
        if(hanldeProjectTaktypeTour && hanldeProjectTaktypeTour !== undefined && hanldeProjectTaktypeTour.value !== null) {
            hanldeProjectTaktypeTour.value();
        }
    })

    watch(() => getters['settings/taskType'], (val) => {
        taskTypeTemplates.value = JSON.parse(JSON.stringify(val));
        if(taskTypeTemplates.value.length){
            if(fromWhich.value === 'setting'){
                let index = taskTypeTemplates.value.findIndex((x) => {
                    return x._id === props.projectData.TaskTypeTemplateId;
                })
                if(index !== -1){
                    theModel.value.taskTypeField.value = Object.keys(theModel.value.taskTypeField.value).length ? theModel.value.taskTypeField.value : taskTypeTemplates.value[index]
                }else{
                    const customObj = {
                        TemplateName : 'Custom',
                        taskTypes : props.projectData.taskTypeCounts
                    }
                    taskTypeTemplates.value = [customObj, ...taskTypeTemplates.value];
                    theModel.value.taskTypeField.value = Object.keys(theModel.value.taskTypeField.value).length ? theModel.value.taskTypeField.value : customObj;
                }
            }else{
                theModel.value.taskTypeField.value = Object.keys(theModel.value.taskTypeField.value).length ? theModel.value.taskTypeField.value : taskTypeTemplates.value[0];
            }
            statusOPtion.value = theModel.value.taskTypeField.value.taskTypes;
        }
    })
    watch(()=> props.modelValue ,(val)=>{
        theModel.value = val;
    })
    const addTaskType = ref(false);
    const taskTypeName = ref("");
    const taskTypeError = ref("");
    const addNewtaskImage = ref("");

    function manageSelectedOption(e){
        theModel.value.taskTypeField.value.taskTypes = e;
        let indexKey = taskTypeTemplates.value.findIndex((x)=>{
            return x._id == theModel.value.taskTypeField.value._id
        });
        if(indexKey !== -1 && theModel.value.taskTypeField.value.TemplateName !== 'Custom'){
            taskTypeTemplates.value[indexKey].isShowSave = true;
            taskTypeTemplates.value[indexKey].taskTypes = [...theModel.value.taskTypeField.value.taskTypes];
            commit("settings/mutateTaskType", {data: taskTypeTemplates.value[indexKey], op: "modified"});
        }
    }
    function addedTaskType(item){
        addTaskTypeStatus('editType',item);
    }
    function manageDeleteData(item){
        addTaskTypeStatus('deleteType',item);
    }
    function openTaskTypeSidebar(){
        taskTypeName.value = '';
        isTaskSidebarOpen.value = true;
        emit('openTaskTYpe',true);
        templateFormRef.value?.closeInputs();
    }
    function onLeftFocus(){
        addTaskType.value = false;
        (theModel.value.taskTypeField.value?.taskTypes || []).forEach((x) => { x.isEditable = false; });
    }
    function setTemplateData(itemData) {
        theModel.value.taskTypeField = {};
        theModel.value.taskTypeField.value = itemData;
        statusOPtion.value = theModel.value.taskTypeField.value.taskTypes;
        if(fromWhich.value === 'setting'){
            emit('spinnerOn')
            newTaskTypeData.value = theModel.value.taskTypeField.value.taskTypes;
            const notMatchedProjects = props.projectData.taskTypeCounts.filter((x) => {
                return !newTaskTypeData.value.some((y) => y.key === x.key);
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
                                { TaskTypeKey: x.key }
                            ]
                        }
                    }

                    apiRequest('post', `${env.TASK}/find`, { findQuery: searchResult }).then((response) => {
                        const result = response.data[0];
                        if(result){
                            useTaskTypeArr.value.push(result);
                        }
                    }).catch((err) => {
                        console.error("Error setTemplateData hook: ", err)
                    });

                    emit('setTemplateDataTaskType',useTaskTypeArr.value,notMatchedProjects)
                })
            }else{
                emit('setTemplateDataTaskType',useTaskTypeArr.value,notMatchedProjects)
            }
        }
        emit('update:modelValue', theModel.value);
    }
    async function onCreateTemplate(name){
        const insertObj = {
            TemplateName : name,
            taskTypes : [
                {
                    'default': true,
                    'name': 'Task',
                    'taskCount': 0,
                    'value': "task",
                    'taskImage': addNewtaskImage.value !== "" ? addNewtaskImage.value : 'setting/task_type/task.png',
                    'isAddNewStatus': false,
                    'key': 1,
                    'isEditable': false,
                    'isDeleted': false,
                    'assignAsSubtask': false,
                    'assignAsTask': false,
                }
            ]
        }
        const object = {
            updateObject:insertObj
        }
        await apiRequest("post",env.TASK_TYPE_TEMPLATE,object).then((res) => {
            if(res.status === 200 && res?.data?._id) {
                commit("settings/mutateTaskType", {data: {...insertObj, _id: res?.data?._id || ''}, op: "added"});
                commit("settings/setProjectTaskTypeArray", {data: JSON.parse(JSON.stringify(({...insertObj, _id: res?.data?._id || '',newAdded:true}))), op: "added"});
                theModel.value.taskTypeField.value = {...insertObj, _id: res?.data?._id || ''};
                $toast.success(t("Toast.Template_has_been_created_Successfully"),{position: 'top-right'});
            }else{
                $toast.error(t('Toast.something_went_wrong'), {position: 'top-right' });
            }
        })
        emit('update:modelValue', theModel.value);
    }
    function addTaskTypeStatus(type,rowData){
        if(type === "deleteType"){
            emit('updateStatus',rowData,'add');
            isDelete.value = true;
            let temp = theModel.value.taskTypeField.value.taskTypes;
            let mainKey = temp.findIndex(item=>{
                return item.key === rowData.key;
            })
            if(mainKey !== -1){
                theModel.value.taskTypeField.value.taskTypes.splice(mainKey, 1);
            }
            let indexKey = taskTypeTemplates.value.findIndex((x)=>{
                return x._id == theModel.value.taskTypeField.value._id
            });
            if(indexKey !== -1 && theModel.value.taskTypeField.value.TemplateName !== 'Custom'){
                taskTypeTemplates.value[indexKey].isShowSave = true;
                taskTypeTemplates.value[indexKey].taskTypes = [...theModel.value.taskTypeField.value.taskTypes];
                commit("settings/mutateTaskType", {data: taskTypeTemplates.value[indexKey], op: "modified"});
            }
        }
        emit('update:modelValue', theModel.value);
    }
    function clearTaskType(){
        taskTypeName.value = "";
        addTaskType.value = false;
        taskTypeError.value = "";
    }
    async function saveTaskTypeTemplateData(val){
        isSpinner.value = true;
        let indexKey = taskTypeTemplates.value.findIndex((x)=>{
            return x._id == val._id
        });
        if(indexKey !== -1){
            delete taskTypeTemplates.value[indexKey].isShowSave;
        }
        const oldId = val._id
        const obj = {
            'TemplateName':taskTypeTemplates.value[indexKey].TemplateName,
            'taskTypes': taskTypeTemplates.value[indexKey].taskTypes
        }
        if(taskTypeTemplates.value[indexKey].default !== undefined){
            obj.default = taskTypeTemplates.value[indexKey].default
        }
        await apiRequest("delete",`${env.TASK_TYPE_TEMPLATE}/${val._id}`).then(async(response) => {
            if(response.status === 200){
                const object = {
                    updateObject:obj
                }
                await apiRequest("post",env.TASK_TYPE_TEMPLATE,object).then((res) => {
                    if(res.status === 200 && res?.data?._id) {
                        if(oldId === theModel.value.taskTypeField.value?._id){
                            theModel.value.taskTypeField.value = {...obj , _id : res?.data?._id || ''};
                        }
                        let index = taskTypeTemplates.value.findIndex((x) => x._id === res?.data?._id || '');
                        const index1 = taskTypeTemplates.value.findIndex((type) => type._id === oldId);
                        if(index === -1 && index1 !== -1){
                            taskTypeTemplates.value[index1] = {...obj , _id : res?.data?._id || ''};
                        }
                        commit("settings/mutateTaskType", {data: {...obj , _id : oldId},newId:res?.data?._id || '', op: "modified"});
                        commit("settings/setProjectTaskTypeArray", {data: JSON.parse(JSON.stringify(({...obj , _id : oldId}))),newId:res?.data?._id || '', op: "modified"});
                        emit('saveTemplate',res?.data?._id || '',oldId,'tasktype');
                    }else{
                        $toast.error(t('Toast.something_went_wrong'), {position: 'top-right' });
                    }
                    isSpinner.value = false;
                }).catch((err) => {
                    isSpinner.value = false;
                    console.error(err)
                    $toast.error(t('Toast.something_went_wrong'), {position: 'top-right' });
                })
            }else{
                isSpinner.value = false;
                $toast.error(t('Toast.something_went_wrong'), {position: 'top-right' });
            }
        }).catch((err) => {
            console.error(err)
            $toast.error(t('Toast.something_went_wrong'), {position: 'top-right' });
            isSpinner.value = false;
        })
    }
    function resetTaskTypeData () {
        taskTypeError.value = "";
    }
    async function onRenameTemplate (temp,name) {
        const object = {
            type: "updateOne",
            key: "$set",
            updateObject:{ TemplateName : name },
            id:temp._id
        };
        await apiRequest("put",env.TASK_TYPE_TEMPLATE,object).then((res) => {
            if(res.status === 200){
                let index = taskTypeTemplates.value.findIndex((x) => x._id === temp._id);
                if(index !== -1) {
                    let modifiedObj = {...taskTypeTemplates.value[index],TemplateName: name,isEditable:false};
                    commit("settings/mutateTaskType", {data: {...modifiedObj, _id: temp._id}, op: "modified"});
                }
                $toast.success(t("Toast.Template_name_updated_successfully"),{position: 'top-right'});
            }else{
                $toast.error(t('Toast.something_went_wrong'), {position: 'top-right' });
            }
        }).catch((err) => {
            console.error(err)
            $toast.error(t('Toast.something_went_wrong'), {position: 'top-right' });
        })
    }
    async function onDeleteTemplate(temp){
        try {
            await apiRequest("delete",`${env.TASK_TYPE_TEMPLATE}/${temp._id}`).then((response) => {
                if(response.status === 200){
                    theModel.value.taskTypeField.value = taskTypeTemplates.value[0] || {};
                    commit("settings/mutateTaskType", {data: {_id: temp._id}, op: "removed"});
                    commit("settings/setProjectTaskTypeArray", {data: {_id: temp._id}, op: "removed"});
                    $toast.success(t("Toast.Template_has_been_created_Successfully"),{position: 'top-right'});
                }else{
                    $toast.error(t('Toast.something_went_wrong'), {position: 'top-right' });
                }
            }).catch((err) =>{
                console.error(err,"Error in Delete Template");
                $toast.error(t('Toast.something_went_wrong'), {position: 'top-right' });
            });
        } catch (error) {
            console.error(error,"Error in Delete Template");
            $toast.error(t('Toast.something_went_wrong'), {position: 'top-right' });
        }
    }
    function updateTaskStatus (event) {
        emit('updateStatus',event,'remove')
        let index = theModel.value.taskTypeField.value.taskTypes.findIndex((typ) => {
            return typ.key === event.key;
        })
        if(index === -1) {
            theModel.value.taskTypeField.value.taskTypes.push(event);
        }
        let indexKey = taskTypeTemplates.value.findIndex((x)=>{
            return x._id == theModel.value.taskTypeField.value._id
        });
        if(indexKey !== -1 && theModel.value.taskTypeField.value.TemplateName !== 'Custom'){
            taskTypeTemplates.value[indexKey].isShowSave = true;
            taskTypeTemplates.value[indexKey].taskTypes = [...theModel.value.taskTypeField.value.taskTypes];
            commit("settings/mutateTaskType", {data: taskTypeTemplates.value[indexKey], op: "modified"});
        }
    }
    function removeTaskStatus (event) {
        emit('updateStatus',event,'add');
        let activeIndex = theModel.value.taskTypeField.value.taskTypes.findIndex((x) => {
            return x.key === event.key
        })

        if(activeIndex !== -1) {
            theModel.value.taskTypeField.value.taskTypes.splice(activeIndex,1);
        }
        let indexKey = taskTypeTemplates.value.findIndex((x)=>{
            return x._id == theModel.value.taskTypeField.value._id;
        });
        if(indexKey !== -1 && theModel.value.taskTypeField.value.TemplateName !== 'Custom'){
            taskTypeTemplates.value[indexKey].isShowSave = true;
            taskTypeTemplates.value[indexKey].taskTypes = [...theModel.value.taskTypeField.value.taskTypes];
            commit("settings/mutateTaskType", {data: taskTypeTemplates.value[indexKey], op: "modified"});
        }
    }
</script>
<style scoped>
@import './style.css';
</style>
<style>
/* Bound the task-type list so a long list scrolls and "+ Add task type" stays visible
   below it (mirrors the left Templates list). Global (not scoped): .taskyou_need_right now
   lives on <TemplateSelectForm>'s right column and .status_ul is rendered by DragDropField,
   so a scoped rule can't reach across both boundaries. The .taskyou_need_right ancestor
   keeps this scoped to the task-type column only. */
.taskyou_need_right .status_ul {
    max-height: 220px;
    overflow-y: auto;
}
</style>
