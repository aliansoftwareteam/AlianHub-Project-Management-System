<!-- =========================================================================================
    Created By : Dipsha Kalariya
    Commnet : This component is used to display project status detail for blank project form as step-5 in create project module.
    Now a thin wrapper over the reusable <TemplateSelectForm>: it owns the project-status
    data, store/API operations and the right-column list; the shell owns the template picker UI.
========================================================================================== -->
<template>
<div class="taskStatusSection statusTaskWrapper">
    <div class="bg-light-gray text-center mb-30px"
    :style="[{padding : clientWidth > 767 ? '16.5px' : '18.5px'}]"
    :class="{'border-radius-5-px': clientWidth > 767 , 'border-radius-8-px': clientWidth <= 767}"
    >
        <h3 v-if="fromWhich == ''" :class="{'task-heading-desktop': clientWidth > 767 , 'task-heading-mobile': clientWidth <= 767}">{{$t('Projects.project_status')}}</h3>
        <h3 v-else :class="{'task-heading-desktop': clientWidth > 767 , 'task-heading-mobile': clientWidth <= 767}">{{$t('Projects.what_project')}}?</h3>
    </div>
    <TemplateSelectForm
        :templates="templateList"
        :modelValue="theModel.projectStatusField.value"
        :isSaving="isSpinner"
        rightClass="style-scroll"
        @update:modelValue="setTemplateData"
        @create="onCreateTemplate"
        @rename="onRenameTemplate"
        @delete="onDeleteTemplate"
        @save="saveTemplateData"
        @left-focus="onLeftFocus"
    >
        <template #list>
            <label class="status_lable" :class="{'taskstatustitle-desktop': clientWidth > 767 , 'taskstatustitle-mobile': clientWidth <= 767}">{{ $t('Projects.active_status') }}</label>
            <draggable v-model="theModel.projectStatusField.value.projectActiveStatus" tag="ul" class="status_ul" @update:modelValue="$emit('update:modelValue',$event)" :item-key="makeUniqueId(5)" :group="'project_status_group'" :move="checkMove" @change="updateItem(theModel.projectStatusField.value.projectActiveStatus,$event,'active')">
                <template #item="{ element, index }">
                    <li class=" d-flex align-items-center justify-content-between closeStatus position-re">
                        <span class="taskInnerData"  v-if="!element.isEditable">
                            <div class="d-flex align-items-center  position-re" >
                                <span class="drag-image-wrapper position-ab" v-if="element.default !== true">
                                    <img :src="dragIcon" class="dragImage position-re" :style="[{top : clientWidth > 767 ? '2px !important' : '4.5px !important'}]"/>
                                </span>
                            <input v-if="!element.isAddNewStatus && element.textColor" :id="`ActiveTaskStatus${index}`" type="color" v-model.trim="element.textColor" @input="element.backgroundColor = element.textColor+'35'" class="ignore-drag input__ignore-drag p-0 mr-8px d-inline-block border-radius-2-px border-0 bg-transparent" disabled>
                            <span :class="{'taskInnerData-desktop': clientWidth > 767 , 'taskInnerData-mobile': clientWidth <= 767}">{{ element.name }}</span>
                            </div>
                        </span>
                        <input v-if="element.isEditable" class="statusInputText form-control edit-input" type="text" v-model.trim="element.name" @keypress.enter.prevent="manageSelectedOption(element,'active')" @input="$emit('resetTaskTypeErr')"/>
                        <img :src="saveData" class="cursor-pointer" v-if="element.isEditable" @click="manageSelectedOption(element,'active')">
                        <img :src="deletered" class="cursor-pointer ml-10px" v-if="element.isEditable" @click="element.isEditable = false, element.name = taskTypeNameData,$emit('disableNext',false)">
                        <span class="taskInnerData task-dropdown" v-if="!element.isEditable && element.default!== true">
                            <DropDown id="" class="status_change_dropdown" v-if="element.default ? false : true">
                                <template #button>
                                    <button class="btn-white border cursor-pointer dot-btn">
                                        <img :src="dotcolor">
                                    </button>
                                </template>
                                <template #options>
                                    <DropDownOption @click="deleteProjectStatus(element,'active')" class="mobile-delete-status">
                                        <img :src="deleteIcon" class="mr-10px"> {{$t('Templates.remove')}}
                                    </DropDownOption>
                                </template>
                            </DropDown>
                        </span>
                    </li>
                </template>
            </draggable>
            <div class="addStatusBtn searchValue">
                <button class="cursor-pointer btn btn-primary ml-0" type="button" v-if="!addTaskType" @click="taskTypeName = '',isTaskSidebarOpen = true">+ {{$t('Projects.add_status')}}</button>
            </div>
            <div>
                <label class="task-done-status" :class="{'taskstatustitle-desktop': clientWidth > 767 , 'taskstatustitle-mobile': clientWidth <= 767}">{{$t('Projects.done_status')}}</label>
                <draggable v-model="theModel.projectStatusField.value.projectDoneStatus" tag="ul" class="status_ul" @update:modelValue="$emit('update:modelValue',$event)" :item-key="makeUniqueId(5)" :group="'project_status_group'" :move="checkMove" @change="updateItem(theModel.projectStatusField.value.projectDoneStatus,$event,'done')">
                    <template #item="{ element, index }">
                        <li class=" d-flex align-items-center justify-content-between closeStatus">
                            <span class="taskInnerData"  v-if="!element.isEditable">
                                <div class="d-flex align-items-center  position-re">
                                    <span class="drag-image-wrapper position-ab" v-if="element.default !== true">
                                        <img :src="dragIcon" class="dragImage position-re" :style="[{top : clientWidth > 767 ? '2px !important' : '4.5px !important'}]"/>
                                    </span>
                                <input v-if="!element.isAddNewStatus && element.textColor" :id="`ActiveTaskStatus${index}`" type="color" v-model.trim="element.textColor" @input="element.backgroundColor = element.textColor+'35'" class="ignore-drag input__ignore-drag p-0 mr-8px d-inline-block border-radius-2-px border-0 bg-transparent" disabled>
                                {{ element.name }}
                                </div>
                            </span>
                            <input v-if="element.isEditable" class="statusInputText form-control edit-input" type="text" v-model.trim="element.name" @keypress.enter.prevent="manageSelectedOption(element,'done')" @input="$emit('resetTaskTypeErr')"/>
                            <img :src="saveData" class="cursor-pointer" v-if="element.isEditable" @click="manageSelectedOption(element,'done')">
                            <img :src="deletered" class="cursor-pointer ml-10px" v-if="element.isEditable" @click="element.isEditable = false, element.name = taskTypeNameData,$emit('disableNext',false)">
                            <span class="taskInnerData task-dropdown" v-if="!element.isEditable && element.default!== true">
                                <DropDown id="" class="status_change_dropdown">
                                    <template #button>
                                        <button class="btn-white border cursor-pointer dot-btn">
                                            <img :src="dotcolor">
                                        </button>
                                    </template>
                                    <template #options>
                                        <DropDownOption @click="deleteProjectStatus(element,'done')" class="mobile-delete-status">
                                            <img :src="deleteIcon" class="mr-10px"> {{$t('Templates.remove')}}
                                        </DropDownOption>
                                    </template>
                                </DropDown>
                            </span>
                        </li>
                    </template>
                </draggable>
            </div>
            <div class="mt-30px"  v-if="theModel.projectStatusField.value.projectCompletedStatus && Object.keys(theModel.projectStatusField.value.projectCompletedStatus).length > 0">
                <label class="status_lable" :class="{'taskstatustitle-desktop': clientWidth > 767 , 'taskstatustitle-mobile': clientWidth <= 767}">{{$t('Projects.close_status')}}</label>
                <div class="statuInputwrapper d-flex align-items-center justify-content-between closeStatus" :style="[{'border-color': theModel.projectStatusField.value.projectCompletedStatus?.backgroundColor}]">
                    <div class="d-flex align-items-center" :class="[{'edit_name_value':theModel.projectStatusField.value.projectCompletedStatus?.isEditable}]">
                        <input type="color" class="color-input p-0 mr-8px d-inline-block border-radius-2-px border-0 bg-transparent" ref="closeStatus"  v-model="theModel.projectStatusField.value.projectCompletedStatus.textColor" @input="theModel.projectStatusField.value.projectCompletedStatus.backgroundColor = theModel.projectStatusField.value.projectCompletedStatus?.textColor+'35'"  disabled>
                        <span class="style_changes_value text-ellipsis" v-if="!theModel.projectStatusField.value.projectCompletedStatus?.isEditable" :style="[{'color': theModel.projectStatusField.value.projectCompletedStatus?.textColor}]" :class="{'font-size-13px' : clientWidth >767 , 'font-size-16px' : clientWidth > 767 }">{{theModel.projectStatusField.value.projectCompletedStatus?.name}} </span>
                    </div>
                </div>
            </div>
        </template>
    </TemplateSelectForm>
    <TaskStatusSidebar v-if="isTaskSidebarOpen" :isTaskSidebarOpen="isTaskSidebarOpen" @closesidebar="isTaskSidebarOpen = false" :title="$t('Projects.list_of_project_status')" :options="statusOPtion" @selected="updateTaskStatus" @removed="removeTaskStatus" :isAddStatus="true" :type="'project_status'" :useDataArray="useDataArray"/>
</div>
</template>
<script setup>
import draggable from 'vuedraggable';
import { useStore } from "vuex";
import { ref, defineProps, onMounted, defineComponent , inject, watch} from 'vue';
import {useToast} from 'vue-toast-notification';
import { useCustomComposable } from "@/composable";
import TaskStatusSidebar from '@/components/molecules/TaskStatusSidebar/TaskStatusSidebar.vue';
import TemplateSelectForm from '@/components/molecules/TemplateSelectForm/TemplateSelectForm.vue';
import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue';
import DropDown from '@/components/molecules/DropDown/DropDown.vue';
import cloneDeep from 'lodash/cloneDeep'; // Import a cloning library
import { useI18n } from "vue-i18n";
import * as env from '@/config/env';
import { apiRequest } from '@/services/index';
const { t } = useI18n();
const { getters, commit } = useStore();
const {makeUniqueId} = useCustomComposable();
    defineComponent({
        name: "Projects-Status-form",
    })
    const deletered = require("@/assets/images/svg/deletered.svg");
    const saveData = require("@/assets/images/save.png");
    const dragIcon = require("@/assets/images/svg/Swip.svg");
    const dotcolor = require("@/assets/images/svg/three_dot.svg");
    const deleteIcon = require("@/assets/images/svg/redDelete_Icon.svg");
    const taskTypeNameData = ref('');
    const isSpinner = ref(false);
    const props = defineProps({
        modelValue : {
            type: Object,
            default : () =>({}),
        },
        from: {
            type: String,
            default: () => (''),
        },
        projectData: {
            type: Object,
        }
    })
    const emit = defineEmits([
        'update:modelValue','disableNext','settingValue','setTemplateData','saveTemplate','resetTaskTypeErr','updateStatus'
    ]);
    const $toast = useToast();
    const theModel = ref(props.modelValue);
    const clientWidth = inject("$clientWidth");
    const addTaskType = ref(false);
    const taskTypeName = ref("");
    const colorsList = ref([]);
    const fromWhich = ref(props.from);
    const templateList = ref([]);
    const isTaskSidebarOpen = ref(false);
    const statusOPtion = ref([]);
    const useDataArray = ref([]);

    function generateColor(){
        colorsList.value = [];
        function getRandomColor() {
            var letters = '0123456789ABCDEF';
            var color = '#';
            for (var i = 0; i < 6; i++) {
                color += letters[Math.floor(Math.random() * 16)];
            }
            return color;
        }
        for(let d=0;d<20;d++){
            let randomColor = getRandomColor();
            while(randomColor === "#FFFFFF" || colorsList.value.includes(randomColor)) {
                randomColor = getRandomColor();
            }
            colorsList.value.push(randomColor);
        }
    }

    onMounted(()=>{
        generateColor();
        templateList.value = cloneDeep(getters['settings/projectStaus']);
        emit('update:modelValue', theModel.value);
        if(templateList.value.length > 0){
            if(fromWhich.value === 'setting'){
                let index = templateList.value.findIndex((x) => {
                    return x._id === props.projectData.projectStatusTemplateId;
                })
                if(index !== -1){
                    theModel.value.projectStatusField.value = Object.keys(theModel.value.projectStatusField.value).length > 0 ? theModel.value.projectStatusField.value : templateList.value[index]
                }else{
                    const customObj = {
                        TemplateName : 'Custom',
                        projectDoneStatus : props.projectData.projectStatusData.filter((x) => x.type==='done'),
                        projectCompletedStatus : props.projectData.projectStatusData.filter((x) => x.type==='close')[0],
                        projectActiveStatus : props.projectData.projectStatusData.filter((x) => x.type==='active' || x.type === 'default_active')
                    }
                    templateList.value = [customObj, ...templateList.value];
                    theModel.value.projectStatusField.value = Object.keys(theModel.value.projectStatusField.value).length > 0 ? theModel.value.projectStatusField.value : customObj;
                }
            }else{
                theModel.value.projectStatusField.value = Object.keys(theModel.value.projectStatusField.value).length > 0 ? theModel.value.projectStatusField.value :templateList.value[0];
                let find = templateList.value.find((x) => x._id === theModel.value.projectStatusField.value._id);
                if(find === undefined){
                    templateList.value.push(theModel.value.projectStatusField.value);
                }
            }
            statusOPtion.value = [...theModel.value.projectStatusField.value.projectActiveStatus, ...theModel.value.projectStatusField.value.projectDoneStatus, theModel.value.projectStatusField.value.projectCompletedStatus];
        }
        if(props.projectData && Object.keys(props.projectData).length > 0) {
            useDataArray.value = props.projectData.projectStatusData.filter((y) => y.value === props.projectData.status);
        }
    })

    watch(() => getters['settings/projectStaus'], (val) => {
        const clonedTemplateList = cloneDeep(val);
        templateList.value = clonedTemplateList;
        if(templateList.value.length){
            if(fromWhich.value === 'setting'){
                let index = templateList.value.findIndex((x) => {
                    return x._id === props.projectData.projectStatusTemplateId;
                })
                if(index !== -1){
                    theModel.value.projectStatusField.value = Object.keys(theModel.value.projectStatusField.value).length > 0 ? theModel.value.projectStatusField.value : templateList.value[index]
                }else{
                    const customObj = {
                        TemplateName : 'Custom',
                        projectDoneStatus : props.projectData.projectStatusData.filter((x) => x.type==='done'),
                        projectCompletedStatus : props.projectData.projectStatusData.filter((x) => x.type==='close')[0],
                        projectActiveStatus : props.projectData.projectStatusData.filter((x) => x.type==='active' || x.type === 'default_active')
                    }
                    theModel.value.projectStatusField.value = Object.keys(theModel.value.projectStatusField.value).length > 0 ? theModel.value.projectStatusField.value : customObj;
                    templateList.value = [customObj, ...templateList.value];
                }
            }else{
                theModel.value.projectStatusField.value = Object.keys(theModel.value.projectStatusField.value).length > 0 ? theModel.value.projectStatusField.value :templateList.value[0];
            }
            statusOPtion.value = [...theModel.value.projectStatusField.value.projectActiveStatus, ...theModel.value.projectStatusField.value.projectDoneStatus, theModel.value.projectStatusField.value.projectCompletedStatus];
        }
    })
    function deleteProjectStatus (element,type) {
        emit('updateStatus',element,'add');
        let arr = type === 'active' ? theModel.value.projectStatusField.value.projectActiveStatus :theModel.value.projectStatusField.value.projectDoneStatus;
        let findInd = arr.findIndex((x) => {
            return x.value === element.value
        })
        if(findInd !== -1) {
            arr.splice(findInd,1);
        }
        let indexKey = templateList.value.findIndex((x)=>{
            return x._id == theModel.value.projectStatusField.value._id
        });
        if(indexKey !== -1 && theModel.value.projectStatusField.value.TemplateName !== 'Custom'){
            templateList.value[indexKey].isShowSave = true;
            templateList.value[indexKey].projectActiveStatus = [...theModel.value.projectStatusField.value.projectActiveStatus];
            templateList.value[indexKey].projectDoneStatus = [...theModel.value.projectStatusField.value.projectDoneStatus];
            templateList.value[indexKey].projectCompletedStatus = {...theModel.value.projectStatusField.value.projectCompletedStatus};
            commit("settings/mutateProjectStatus", {data: templateList.value[indexKey], op: "modified"});
        }
        emit('update:modelValue', theModel.value);
    }

    function checkMove (e) {
       return !(e.draggedContext.element.default);
    }

    function updateItem(item, event,type){
        if(event.added !== undefined){
            event.added.element.type = type;
        }
        let indexKey = templateList.value.findIndex((x)=>{
            return x._id == theModel.value.projectStatusField.value._id
        });
        if(type === 'active'){
            theModel.value.projectStatusField.value.projectActiveStatus = item
        }
        if(type === 'done'){
            theModel.value.projectStatusField.value.projectDoneStatus = item;
        }
        if(indexKey !== -1 && theModel.value.projectStatusField.value.TemplateName !== 'Custom'){
            templateList.value[indexKey].isShowSave = true;
            if(type === 'active'){
                templateList.value[indexKey].projectActiveStatus = [...item];
            }
            if(type === 'done'){
                templateList.value[indexKey].projectDoneStatus = [...item];
            }
            commit("settings/mutateProjectStatus", {data: templateList.value[indexKey], op: "modified"});
        }
        emit('update:modelValue', theModel.value);
    }
    function setTemplateData(itemData) {
        theModel.value.projectStatusField.value = {};
        theModel.value.projectStatusField.value = itemData;
        statusOPtion.value = [...theModel.value.projectStatusField.value.projectActiveStatus, ...theModel.value.projectStatusField.value.projectDoneStatus,theModel.value.projectStatusField.value.projectCompletedStatus];
        emit('setTemplateData');
        emit('update:modelValue', theModel.value);
    }

    async function onRenameTemplate(temp,name) {
        const axiosData = {
            id: temp._id,
            templateName: name
        }
        await apiRequest("put", `${env.API_PROJECT_STATUS_TEMPLATE}`, axiosData).then((result) => {
            if (result.data.status) {
                let index = templateList.value.findIndex((x) => x._id === temp._id);
                if(index !== -1) {
                    let modifiedObj = {...templateList.value[index],TemplateName: name,isEditable:false};
                    commit("settings/mutateProjectStatus", {data: {...modifiedObj, _id: temp._id}, op: "modified"});
                }
                $toast.success(t("Toast.Template_name_updated_successfully"),{position: 'top-right'});
            }
        });
    }

    function onLeftFocus(){
        addTaskType.value = false;
    }

    async function onCreateTemplate(name){
        const params = {
            TemplateName: name,
            projectActiveStatus: [{
                'name': 'Open',
                'value': 'open',
                'textColor': '#7367F0',
                'bgColor': '#E3E1FC35',
                'isEditable': false,
                'key': 1,
                'editColor': false,
                'default': true,
                "type": 'default_active'
            }],
            projectDoneStatus: [],
            projectCompletedStatus: {
                'name': 'Close',
                'value': 'close',
                'textColor': '#6BC950',
                'bgColor': '#6BC95035',
                'isEditable': false,
                'key': 2,
                'editColor': false,
                'type': 'close',
            },
            taskcloseStatus: 2,
            taskActiveStatus: [1],
            taskDoneStatus: [],
            createdAt: new Date()
        }
        const axiosData = { ...params }
        await apiRequest("post", `${env.API_PROJECT_STATUS_TEMPLATE}`, axiosData).then((result) => {
            if (result.data.status) {
                theModel.value.projectStatusField.value = { ...result.data.data };
                commit("settings/mutateProjectStatus", {data: { ...result.data.data }, op: "added"});
                commit("settings/setProjectStatus", {data: JSON.parse(JSON.stringify(({...result.data.data,newAdded:true}))), op: "added"});
                $toast.success(t("Toast.Template_has_been_created_Successfully"),{position: 'top-right'});
            }
        });
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
            'TemplateName' : templateList.value[indexKey].TemplateName,
            'projectActiveStatus': templateList.value[indexKey].projectActiveStatus,
            'projectDoneStatus' : templateList.value[indexKey].projectDoneStatus,
            'projectCompletedStatus' : templateList.value[indexKey].projectCompletedStatus,
            'createdAt': new Date()
        }
        if(templateList.value[indexKey].default !== undefined){
            obj.default = templateList.value[indexKey].default
        }

        await apiRequest("delete", `${env.API_PROJECT_STATUS_TEMPLATE}/${val._id}`).then(async (deleteResponse) => {
            if (deleteResponse.data.status) {
                const axiosData = { ...obj }
                await apiRequest("post", `${env.API_PROJECT_STATUS_TEMPLATE}`, axiosData).then((response) => {
                    const result = response.data;
                    if (result.status) {
                        if(oldId === theModel.value.projectStatusField.value?._id){
                            theModel.value.projectStatusField.value = { ...obj,_id:result?.data?._id };
                        }
                        let index = templateList.value.findIndex((x) => x._id === result?.data?._id || '');
                        const index1 = templateList.value.findIndex((type) => type._id === oldId);
                        if(index === -1 && index1 !== -1){
                            templateList.value[index1] = {...obj , _id : result?.data?._id || ''};
                        }
                        commit("settings/mutateProjectStatus", {data: {...obj , _id : oldId},newId:result?.data?._id || '', op: "modified"});
                        commit("settings/setProjectStatus", {data: JSON.parse(JSON.stringify(({...obj , _id : oldId}))),newId:result?.data?._id || '', op: "modified"});
                        emit('saveTemplate',result?.data?._id || '',oldId,'projectstatus')
                    }
                    isSpinner.value = false;
                }).catch((err) =>{
                    console.error(err)
                    isSpinner.value = false;
                });
            }else{
                isSpinner.value = false;
            }
        }).catch((err) =>{
            console.error(err)
            isSpinner.value = false;
        });
    }

    function updateTaskStatus (event) {
        emit('updateStatus',event,'remove');
        if(event.type === 'active'){
            theModel.value.projectStatusField.value.projectActiveStatus = [...theModel.value.projectStatusField.value.projectActiveStatus,event];
        }else if(event.type === 'done'){
            theModel.value.projectStatusField.value.projectDoneStatus = [...theModel.value.projectStatusField.value.projectDoneStatus,event];
        }
        let indexKey = templateList.value.findIndex((x)=>{
            return x._id == theModel.value.projectStatusField.value._id
        });
        if(indexKey !== -1 && theModel.value.projectStatusField.value.TemplateName !== 'Custom'){
            templateList.value[indexKey].isShowSave = true;
            templateList.value[indexKey].projectActiveStatus = [...theModel.value.projectStatusField.value.projectActiveStatus];
            templateList.value[indexKey].projectDoneStatus = [...theModel.value.projectStatusField.value.projectDoneStatus];
            templateList.value[indexKey].projectCompletedStatus = {...theModel.value.projectStatusField.value.projectCompletedStatus};
            commit("settings/mutateProjectStatus", {data: templateList.value[indexKey], op: "modified"});
        }
        emit('settingValue',theModel.value)
    }

    function removeTaskStatus (event) {
        emit('updateStatus',event,'add');
        if(event.type === 'active'){
            let activeIndex = theModel.value.projectStatusField.value.projectActiveStatus.findIndex((x) => {
                return x.key === event.key
            })

            if(activeIndex !== -1) {
                theModel.value.projectStatusField.value.projectActiveStatus.splice(activeIndex,1);
            }
        }else if(event.type === 'done'){
            let doneIndex = theModel.value.projectStatusField.value.projectDoneStatus.findIndex((x) => {
                return x.key === event.key
            })

            if(doneIndex !== -1) {
                theModel.value.projectStatusField.value.projectDoneStatus.splice(doneIndex,1);
            }
        }
        let indexKey = templateList.value.findIndex((x)=>{
            return x._id == theModel.value.projectStatusField.value._id
        });
        if(indexKey !== -1 && theModel.value.projectStatusField.value.TemplateName !== 'Custom'){
            templateList.value[indexKey].isShowSave = true;
            templateList.value[indexKey].projectActiveStatus = [...theModel.value.projectStatusField.value.projectActiveStatus];
            templateList.value[indexKey].projectDoneStatus = [...theModel.value.projectStatusField.value.projectDoneStatus];
            templateList.value[indexKey].projectCompletedStatus = {...theModel.value.projectStatusField.value.projectCompletedStatus};
            commit("settings/mutateProjectStatus", {data: templateList.value[indexKey], op: "modified"});
        }
    }

    async function onDeleteTemplate(temp) {
        await apiRequest("delete", `${env.API_PROJECT_STATUS_TEMPLATE}/${temp._id}`).then((result) => {
            if (result.data.status) {
                theModel.value.projectStatusField.value = templateList.value.find((x) => x._id !== temp._id) || {};
                commit("settings/mutateProjectStatus", {data: {_id: temp._id}, op: "removed"});
                commit("settings/setProjectStatus", {data: {_id: temp._id}, op: "removed"});
                $toast.success(t("Toast.Template_has_been_created_Successfully"),{position: 'top-right'});
            }
        });
    }

</script>
<style scoped>
@import './style.css';
.closeStatus {
    list-style: none;
    border: 1px solid #ececec!important;
    border-radius: 5px;
    padding: 0px 10px 0px 23px;
    margin-bottom: 10px;
}
input.form-control.edit-input{
    margin: 1px 8px 1px 0px;
    background-color: #f1f1f1;
    border: 0px;
}
input.form-control.edit-input1 {
    margin: 1px 8px 1px 0px;
    background-color: #f1f1f1;
    border: 0;
}
.input__ignore-drag{
    width: 12px;
    height: 12px;
}
.taskStatusSection .add_new_temp{
    flex-grow: 1;
    padding-right: 56px !important;
    box-sizing: border-box;
}
.taskStatusSection.statusTaskWrapper :deep(.taskStatusRight){overflow: auto;max-height: 308px;}
.taskStatusSection.statusTaskWrapper {overflow: unset;max-height: fit-content;}
@media(max-width:1366px){
    .taskStatusSection.statusTaskWrapper :deep(.taskStatusRight){overflow: auto;max-height: 308px;}
    .taskStatusSection.statusTaskWrapper {overflow: unset;max-height: fit-content;}
}
@media(max-width:767px){
    .closeStatus{height: 40px;}
    .taskStatusSection.statusTaskWrapper :deep(.taskStatusRight){max-height: 300px;}
}

</style>
