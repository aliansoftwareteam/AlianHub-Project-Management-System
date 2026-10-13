<template lang="">
    <div class="d-flex taglist__dropdown-mobile__margin" @click="(e)=>{e.stopPropagation()}" :class="[{'pointer-none' : (tagChipArray.length >= 3 && isTaskList) || !checkApps('tags') }]">
        <DropDown mode="listbox" @isVisible="tagClosed">
        <template  #button="{ triggerAttrs }">
            <button
                v-show="(tagChipArray.length < 3 || !isTaskList) && checkApps('tags') && checkPermission('task.task_tag',project?.isGlobalPermission) === true"
                type="button"
                class="d-flex taglist__add-btn"
                :aria-label="$t('Tags.add_tag')"
                ref="clickDropDown"
                v-bind="triggerAttrs"
            >
                <svg v-if="!isTaskList" id="openTagDropdown" class="cursor-pointer tag-div" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path class="taglist__add-disc taglist__add-ring" d="M12 23.5C18.3513 23.5 23.5 18.3513 23.5 12C23.5 5.64873 18.3513 0.5 12 0.5C5.64873 0.5 0.5 5.64873 0.5 12C0.5 18.3513 5.64873 23.5 12 23.5Z"/>
                    <path class="taglist__add-glyph" d="M13.1327 16.7121C12.9408 16.904 12.703 17 12.4193 17C12.1356 17 11.8978 16.904 11.7059 16.7121L7.30038 12.3066C7.20859 12.2149 7.13567 12.1064 7.0816 11.9812C7.0272 11.8561 7 11.7226 7 11.5807V8.00125C7 7.72591 7.09812 7.49011 7.29437 7.29387C7.49028 7.09796 7.72591 7 8.00125 7H11.5807C11.7226 7 11.8561 7.02703 11.9812 7.0811C12.1064 7.1355 12.2149 7.20859 12.3066 7.30038L16.7121 11.7184C16.904 11.9103 17 12.1459 17 12.4253C17 12.705 16.904 12.9408 16.7121 13.1327L13.1327 16.7121ZM12.4193 16.0113L15.9987 12.4318L11.5807 8.00125H8.00125V11.5807L12.4193 16.0113ZM9.25282 10.0038C9.46141 10.0038 9.63863 9.93066 9.78448 9.78448C9.93066 9.63863 10.0038 9.46141 10.0038 9.25282C10.0038 9.04422 9.93066 8.867 9.78448 8.72115C9.63863 8.57497 9.46141 8.50188 9.25282 8.50188C9.04422 8.50188 8.867 8.57497 8.72115 8.72115C8.57497 8.867 8.50188 9.04422 8.50188 9.25282C8.50188 9.46141 8.57497 9.63863 8.72115 9.78448C8.867 9.93066 9.04422 10.0038 9.25282 10.0038Z"/>
                </svg>
                <svg v-else id="openTagDropdown" class="cursor-pointer tag-div" width="27" height="23" viewBox="0 0 27 23" aria-hidden="true" focusable="false">
                    <rect class="taglist__add-ring" x="0.699219" y="1.49805" width="25" height="21" rx="3.5" fill="none"/>
                    <path class="taglist__add-glyph" d="M14.5584 17.6526C14.3281 17.8829 14.0428 17.998 13.7023 17.998C13.3619 17.998 13.0766 17.8829 12.8463 17.6526L7.55967 12.366C7.44953 12.2559 7.36202 12.1257 7.29714 11.9755C7.23186 11.8253 7.19922 11.6651 7.19922 11.4949V7.19955C7.19922 6.86914 7.31697 6.58618 7.55246 6.35069C7.78755 6.11559 8.07031 5.99805 8.40072 5.99805H12.6961C12.8663 5.99805 13.0265 6.03049 13.1767 6.09537C13.3269 6.16065 13.457 6.24836 13.5672 6.3585L18.8538 11.6601C19.0841 11.8904 19.1992 12.1732 19.1992 12.5084C19.1992 12.844 19.0841 13.127 18.8538 13.3572L14.5584 17.6526ZM13.7023 16.8116L17.9977 12.5162L12.6961 7.19955H8.40072V11.4949L13.7023 16.8116ZM9.9026 9.60255C10.1529 9.60255 10.3656 9.51484 10.5406 9.33942C10.716 9.1644 10.8037 8.95174 10.8037 8.70143C10.8037 8.45111 10.716 8.23845 10.5406 8.06343C10.3656 7.88801 10.1529 7.8003 9.9026 7.8003C9.65229 7.8003 9.43962 7.88801 9.2646 8.06343C9.08918 8.23845 9.00147 8.45111 9.00147 8.70143C9.00147 8.95174 9.08918 9.1644 9.2646 9.33942C9.43962 9.51484 9.65229 9.60255 9.9026 9.60255Z"/>
                </svg>
            </button>
        </template>
        <template #head>
            <div class="tagInputwrapper">
                <InputText :modelValue="searchtag" 
                           :placeHolder="$t('Tags.search_or_create_new')" 
                           @update:modelValue="(val) => searchtag = val" 
                           @keyup="(val)=>checkSameName(val.event,val.value,'isSearch')" 
                           :isDirectFocus="true" 
                />
                <h5 v-if="errorMessage" class="red font-size-11 font-weight-400">{{errorMessage}}</h5>
            </div>
        </template>
    <template #options>
            <div class="chipDiv-wrapper" v-if="checkApps('tags')"> 
                <SpinnerComp :is-spinner="isSpinner || isChipSpinner"/>  
                <div v-for="(item, index) in tagChipArray" :key="index" class="tagList">
                    <TagChip :data="item" :isBorder="false" :ids="ids" :tagsArray="project.tagsArray" :prjectGlobalPermission="project?.isGlobalPermission" :taskId="task.id" :sprintId="task.sprintId" :taskName="task.TaskName" light-surface @isSpinner="(val)=> isChipSpinner = val"/>
                </div>
            </div>
                <div class="chipDiv-hr"></div>
            <div class="taglist-options">
                <div class="taglist_option--item" v-for="(item, index) in (searchtag ? array2 : array)" :key="index">
                    <div class="mainDiv cursor-pointer">
                        <div class="ml-0 w-100 edit__status-key"  v-if="editStatus && editStatus.key === 'isRename' && editStatus.uid === item.uid">
                            <InputText
                                :inputId="item.uid"
                                v-model="reNameVal" 
                                @focus="(val) =>{reNameVal = item.tagName,oldVal = JSON.parse(JSON.stringify(item))}"
                                @blur="(val)=> {editStatus = undefined}"
                                :placeHolder="$t('Projects.Rename Tag')" 
                                @update:modelValue="(val) => reNameVal = val" 
                                @keyup="(val)=>checkSameName(val.event,val.value.trim(),'isRename',index,item)" 
                                :isDirectFocus="true"
                                class="ml-0 w-100 edit__status-key"
                            />
                            <h5 v-if="renameErrorMessage" class="red" >{{renameErrorMessage}}</h5>
                        </div>
                            <div class="change-color-wrapper" v-else-if="editStatus && editStatus.key === 'isColor' && editStatus.uid === item.uid">
                                <span class="changeColorTextTagName" :title="item.tagName" :style="{color: tagChipColors(item).color}">{{item.tagName}}</span>
                                <input
                                    type="color"
                                    v-model.trim="tagColor"
                                    @input="tagBgColor = tagColor+'35'"
                                />
                                <img :src="saveimage" class="saveTagColorImage cursor-pointer" @click="()=>HandleColors('save',index,item)"/>
                                <img :src="cancelimage" class="deleteTagImage cursor-pointer ml-5px" @click="()=>HandleColors('cancel',index)"/>
                            </div>
                            <div class="d-flex justify-content-between w-100" v-else role="option" aria-selected="false" @click="addTag(item.uid)">
                                <span class="tag_name"  :title="item.tagName" :style="{color: tagChipColors(item).color}" >{{item.tagName}}</span>
                                <DropDown mode="menu" :id="`${tagActionsId}_${item.uid}`" v-if="checkPermission('task.task_tag',project?.isGlobalPermission) === true" @isVisible="(open) => open && (dataItem = item)">
                                    <template #button="{ triggerAttrs }">
                                        <button type="button" class="taglist__add-btn d-block" :aria-label="$t('Tags.tag_actions', { name: item.tagName })" data-option-action v-bind="triggerAttrs">
                                            <img :src="threedots" class="cursor-pointer p0x-5px ml-auto mt-7px tagname__threedots" :class="[{'threedots': clientWidth > 767}]" alt=""/>
                                        </button>
                                    </template>
                                    <template #options>
                                        <div class="">
                                            <ul class="tag-edit-option justify-content-start" role="none">
                                                <li class="mainDiv justify-content-start" role="menuitem" @click="EditChips('isRename')">
                                                    <img :src="renameimage" class="inner-tagedit-list-item"/>
                                                    <span>{{$t("Projects.rename")}}</span>
                                                </li>
                                                <li class="mainDiv justify-content-start" role="menuitem" @click="EditChips('isColor')">
                                                    <img :src="colorimage" class="inner-tagedit-list-item"/>
                                                    <span>{{$t("Tags.change_color")}}</span>
                                                </li>
                                                <li class="mainDiv justify-content-start" role="menuitem" @click="EditChips('isDelete'),showSidebar = true,sendMethod()">
                                                    <img :src="deleteimage" class="inner-tagedit-list-item"/>
                                                    <span class="red">{{$t("Projects.delete")}}</span>
                                                </li>
                                            </ul>
                                        </div>
                                    </template>
                                </DropDown>
                            </div>
                    </div>
                </div>
                <p class="tag-instruct-text" v-if="searchtag">{{$t('Tags.note_msg')}}</p>
                <p class="tag-instruct-text p-0" v-else-if="array.length==0 && tagChipArray.length == 0">{{$t("Tags.no_tags_found")}}</p>
            </div>
    </template> 
        </DropDown>
        <ConfirmationSidebar
            v-model="showSidebar"
            :acceptButtonClass="`btn-danger`"
            :acceptButton="$t('Projects.delete')"
            :title="$t('Tags.delete_tag')"
            :message="$t('Tags.delete_tag_desc')"
            :isShowInput="false"
            @confirm="deleteTags(dataItem),toast.success($t('Toast.Tag_Deleted_successfully'),{position:'top-right'})"
        >
        <template #body>
            <div></div>
        </template>
    </ConfirmationSidebar>
    </div>
</template>
<script setup>

import {ref,watchEffect,inject} from 'vue'

import DropDown from '@/components/molecules/DropDown/DropDown.vue'
import TagChip from '@/components/atom/TagChip/TagChip.vue'
import ConfirmationSidebar from "@/components/molecules/ConfirmationSidebar/ConfirmationSidebar.vue"
import InputText from "@/components/atom/InputText/InputText.vue";
import SpinnerComp from '@/components/atom/SpinnerComp/SpinnerComp.vue';

import { createTag,addTaskTag,updateTag,deleteTag,byTagName,taskTagChips} from "./helper.js";
import { tagChipColors } from "@/utils/statusChipColors";
import { useCustomComposable } from "@/composable";
import { useToast } from 'vue-toast-notification';
import { useI18n } from "vue-i18n";
const { t } = useI18n();

const companyId = inject("$companyId")
const threedots = require("@/assets/images/svg/tagdots.svg")
const array = ref([])
const array2 = ref([])
const clientWidth = inject('$clientWidth');
const editStatus = ref({})
const showSidebar = ref(false)
const reNameVal = ref("")
const tagChipArray = ref([])
const dataItem  = ref()
const errorMessage = ref("")
const renameErrorMessage = ref("")
const ids = ref({})
const tasksTagsArray = ref([])
const tagColor = ref('#000000')
const tagBgColor = ref('#000000')
const toast = useToast()
const {makeUniqueId , checkApps, checkPermission } = useCustomComposable();
const searchtag =  ref()
const tagActionsId = "custom"+makeUniqueId(5);
const renameimage = require("@/assets/images/editmilestone.png")
const deleteimage = require("@/assets/images/Deletemilestone.png")
const colorimage = require("@/assets/images/palette.png")
const saveimage = require("@/assets/images/save.png")
const cancelimage = require("@/assets/images/svg/deletered.svg")
const emit = defineEmits(["send:tagChipArray","send:ids", "send:dropvisible"])
const isSpinner = ref(false)
const isChipSpinner = ref(false)
const projectArray = ref()
const oldVal = ref('')
const clickDropDown = ref()
const sendMethod = () =>{
    clickDropDown.value.click()
}
defineExpose({sendMethod})

const props = defineProps({
    task: {
        type: Object,
        required: true,
    },
    project:{
        type: Object,
        required: true,
    },
    isTaskList:{
        type:Boolean,
        default: false,
    },
    chipCount:{
        type:Number,
        default:4
    },
    stringObj:{
        type:String,
    },
});

const getRandomColor = () => {
    var letters = '0123456789ABCDEF';
    var color = '#';
    for (var i = 0; i < 6; i++) {
        color += letters[Math.floor(Math.random() * 16)];
    }
    return {tagColor:color,tagBgColor:color+'35'};
}

projectArray.value = { ...props.project.tagsArray }

watchEffect(()=>{
    array.value = props.project.tagsArray || [];
    tasksTagsArray.value = props.task.tagsArray || [];
    array.value = array.value.filter((item)=>{ return !(tasksTagsArray.value.includes(item['uid'])) })
    array.value.sort(byTagName);

    tagChipArray.value = taskTagChips(props.project.tagsArray, tasksTagsArray.value)

    ids.value = {companyId:companyId.value,projectId:props.project._id,sprintId:props.task.sprintId,taskId:props.task._id, tagsArray: props.task.tagsArray}

    emit("send:tagChipArray",tagChipArray.value)
    emit("send:ids",ids.value)

})

function tagClosed(val) {
    emit("send:dropvisible",val)
    if(!val) {
        searchtag.value = ""
        errorMessage.value = ""
        renameErrorMessage.value = ""
        editStatus.value = undefined
    }
}

const EditChips = (key) => {
    editStatus.value = {...dataItem.value, key:key}    
}

//  search , create , rename tag function
const checkSameName = (e,val,state,i,item) => {
    const value = val.trim() ? val.trim() : ""
    let flag = false
    errorMessage.value = ""
    renameErrorMessage.value = ""
    let propArray = props.project.tagsArray !== undefined ? props.project.tagsArray : []

    if(state == 'isSearch'){
        array2.value = array.value.filter((item) =>{
        return item.tagName.toLowerCase().trim().includes(value.toLowerCase()) 
    })
    propArray.forEach((item) => {
        if( item.tagName.toLowerCase().trim() === value.toLowerCase().trim()) { flag = true }
        })
        if(e.keyCode == 13){
            if(flag){
                errorMessage.value = t('Tags.This_tag_has_already_been_added')
                return     
            }
            if(!value){
                errorMessage.value = t('Tags.Tag_name_required');
                return
            }
            let colors = getRandomColor()   
            const obj = {tagBgColor:colors.tagBgColor , tagColor:colors.tagColor , tagName:value,uid:makeUniqueId(12)}
            createTag(ids.value,obj).then(() => addTag(obj.uid))
            toast.success(t("Toast.Tag_Created_successfully"),{position:"top-right"})
            array.value.push(obj)
            searchtag.value = ""
            propArray.push(obj)
        }
    }

    if(state == 'isRename'){
        propArray.forEach((item) => {
        if(  item.tagName.toLowerCase().trim() === value.toLowerCase().trim()) { flag = true }
        })
        if(e.keyCode == 13){
            if(dataItem.value.tagName.toLowerCase().trim() === value.toLowerCase().trim()){
                    editStatus.value = false
                    return 
            }
            if(flag){
                renameErrorMessage.value = t('Tags.This_tag_has_already_been_added')
                return     
            }
            if(!value){
                renameErrorMessage.value = t('Tour.Tag_name_required');
                return
            }
            array.value[i].tagName = reNameVal.value
            updateTag(ids.value, oldVal.value, {...item,tagName:reNameVal.value})
            editStatus.value = undefined
        }
    }
}

const addTag = (payload) =>{
    addTaskTag(ids.value,payload).then((data)=>{
        isSpinner.value = data
        errorMessage.value = ""
    }).catch((error)=>{
        toast.error(error,{position: "top-right"})
    })
}

//  Handling deletion of Tags
const deleteTags = (payload) =>{
    showSidebar.value = false
    deleteTag(ids.value,payload)
    let dataArray = props.project.tagsArray
    const index = dataArray.findIndex(x => x.uid === payload.uid)
    if (index !== -1) {
        dataArray.splice(index, 1)
    }
}

//  Handling colors Changes
const HandleColors = (key,i,item) =>{
    if(key === 'save'){
        updateTag(ids.value, item, {...item , tagColor:tagColor.value , tagBgColor:tagBgColor.value})
        item.tagColor = tagColor.value;
        item.tagBgColor = tagColor.value+'35';
        tagColor.value = '#000000'
        tagBgColor.value = '#C8C8C8'
    }
    else{
        tagColor.value = '#000000'
        tagBgColor.value = '#C8C8C8'
    }
    editStatus.value = undefined
}

</script>
<style>
@import "./style.css";
.search-project-filter:has(.taglist-options) {
    padding: 0px!important;
}
.tagInputwrapper input::placeholder{
    text-transform: none !important;
}
.tagname__threedots{
    height:4px;
}
.mainDiv:focus-within .threedots{
    display: block;
}
.taglist__add-btn { margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; }
.taglist__add-disc { fill: var(--surface); }
.taglist__add-ring { stroke: var(--ink-3); }
.taglist__add-glyph { fill: var(--ink-2); }
.edit__status-key{
    height:26px !important;
}
.chipDiv-hr{
    border-bottom: 1px solid var(--border);
    margin: 6px 0;
}
</style>