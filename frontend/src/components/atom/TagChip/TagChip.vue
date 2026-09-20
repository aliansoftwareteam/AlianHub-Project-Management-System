<template lang="">
        <div class="tagList_inner d-flex align-items-center">
        <!-- Edit Tag input -->
        <InputText
        v-if="editStatus && editStatus === 'isRename'"
        :modelValue="renameVal"
        @focus="(val)=>{ renameVal = Data.tagName}"
        @blur="(val)=> {editStatus = undefined,renameVal = '',renameErrorMessage='',showClass=false}"
        :placeHolder="$t('PlaceHolder.Rename_Tag')"
        @update:modelValue="(val) => renameVal = val.trim()" 
        @keyup="(val)=>HandleChange(val.event,'isRename')" 
        :isDirectFocus="true"
        :inputId="`tag`" 
        :width="`80px`"
        />
        <div class="error position-ab red bg-white font-size-10 error_top" v-if="renameErrorMessage">{{renameErrorMessage}}</div>
        
        <!-- Edit color input -->
        <div v-if="editStatus && editStatus === 'isColor'" class="d-flex align-items-center mr-5px borderdarkgray border-radius-3-px is__color-status">
        <input
        type="color"
        v-model.trim="tagColor"
        @input="tagBgColor = tagColor+'35'"
        >
        <img :src="saveimage" class=" cursor-pointer color-edit_img save_img" @click="(e)=> HandleChange(e,'isColorSave')"/>
        <img :src="cancelimage" class=" cursor-pointer color-edit_img ml-0" @click="(e)=> HandleChange(e,'isColorCancel')"/>
        </div>

        <!-- tagchip with dropdown -->
        <div class="tagList tagListContent d-flex align-items-center " :class="[{'remove_hover' : checkPermission('task.task_tag',prjectGlobalPermission) == false}]" v-if="editStatus != 'isRename'" :style="{backgroundColor:data.tagBgColor,border:isBorder?'1px solid':'0px',borderColor: isBorder?data.tagColor:'none'}">
            <div class="tagname__contianer d-flex">
                <span class="tagname" :title="data.tagName" :style="{color:data.tagColor}" :class="[{'threedots' : clientWidth < 767 || showClass}]">{{data.tagName}}</span>
            </div>
            <DropDown @isVisible="(val)=> visible = val" v-if="checkPermission('task.task_tag',prjectGlobalPermission) === true">
                <template #button>       
                    <img  :src="threedots" class="cursor-pointer tagHover__icon ml-2px"  alt="" :class="{threedots:showClass}"  @click="showClass = true" :ref="Did"/>  
                    </template>
                <template #options> 
                    <div class="">
                        <ul class="tag-edit-option justify-content-start">
                            <li class="mainDiv justify-content-start" @click="$refs[Did].click(),EditChips('isRename')">
                                <img :src="renameimage" class="inner-tagedit-list-item"/>
                                <span>{{$t("Projects.rename")}}</span>
                            </li>
                            <li class="mainDiv justify-content-start" @click=" $refs[Did].click(),EditChips('isColor')">
                                <img :src="colorimage" class="inner-tagedit-list-item"/>
                                <span>{{$t("Tags.change_color")}}</span>
                            </li>
                            <li class="mainDiv justify-content-start" @click=" $refs[Did].click(),EditChips('isDelete'),showSidebar = true">
                                <img :src="deleteimage" class="inner-tagedit-list-item"/>
                                <span class="red">{{$t("Projects.delete")}}</span>
                            </li>
                        </ul>
                    </div>
                    </template>   
            </DropDown> 
            <img  :src="cross" v-if="checkPermission('task.task_tag',prjectGlobalPermission) === true" class="cursor-pointer tagHover__icon-close ml-5px" alt="" :class="{threedots:showClass}"  @click="removeTag(ids,data), ActivityLog(`<b>${userData.Employee_Name}</b> has removed the Tag <b> ${data?.tagName} </b> Tag`, taskId),ActivityLog(`<b>${userData.Employee_Name}</b> has removed the Tag <b> ${data?.tagName}</b> in <b>${sanitizeInput(taskName)}</b> task.`, null)">
                <ConfirmationSidebar
                v-model="showSidebar"
                :acceptButtonClass="`btn-danger`"
                :acceptButton="$t('Projects.delete')"
                :title="$t('Tags.delete_tag')"
                :message="$t('Tags.delete_tag_desc')"
                :isShowInput="false"
                @confirm="deleteTags">
                    <template #body>
                        <div></div>
                    </template>
                </ConfirmationSidebar>
        </div>
    </div>

</template>
<script setup> 

// components
import { removeTaskTag } from "@/components/molecules/TagList/helper.js";
import DropDown from '@/components/molecules/DropDown/DropDown.vue'
import InputText from "@/components/atom/InputText/InputText.vue";
import ConfirmationSidebar from "@/components/molecules/ConfirmationSidebar/ConfirmationSidebar.vue"

// packages
import {ref, watchEffect,watch ,computed , inject} from 'vue'
import { useStore } from 'vuex'

// utility
import * as env from '@/config/env';
import { useCustomComposable , useGetterFunctions } from "@/composable";
import {updateTag,deleteTag} from "@/components/molecules/TagList/helper.js";
import { useToast } from 'vue-toast-notification';
import { useI18n } from "vue-i18n";
const { t } = useI18n();

const {getters} = useStore()
const {makeUniqueId,sanitizeInput,checkPermission} = useCustomComposable();
const clientWidth = inject('$clientWidth');
const threedots = require("@/assets/images/svg/tagdots.svg")
const cross = require("@/assets/images/svg/tagcross.svg")
const renameimage = require("@/assets/images/editmilestone.png")
const showClass = ref(false)
const deleteimage = require("@/assets/images/Deletemilestone.png")
const colorimage = require("@/assets/images/palette.png")
const saveimage = require("@/assets/images/save.png")
const cancelimage = require("@/assets/images/svg/deletered.svg")
import { apiRequest } from '../../../services';
const showSidebar = ref(false)
const editStatus = ref()
const tagColor = ref('#000000')
const tagBgColor = ref('#C8C8C8')
const renameVal = ref('')
const Did = ref("custom"+makeUniqueId(5));
const Data = ref()
const renameErrorMessage = ref("")
const toast = useToast()
const stringobj = ref()
const visible = ref()
const {getUser} = useGetterFunctions();
const companyId = inject('$companyId')
const userId = inject('$userId')
const user = getUser(userId.value);
const companyOwner = computed(() => getters["settings/companyOwnerDetail"])
const userData = {
    id: user.id,
    Employee_Name: user.Employee_Name,
    companyOwnerId: companyOwner.value.userId
}

const props = defineProps({
    data: {
        type: Object,
        required: true,
    },
    taskId: {
        type: String,
        default: ""
    },
    sprintId: {
        type: String,
        default: ""
    },
    isBorder: {
        type: Boolean,
        required: false,
    },
    tagsArray:{
        type:Object,
        required:{},
    },
    stringobjVal:{
        type:String,
    },
    ids:{
        type: Object,
        required: true,
    },
    taskName: {
        type: String,
        required: false,
        default: ''
    },
    prjectGlobalPermission: {
        type: Boolean,
        default: true,
    }
});

watchEffect(()=>{
        Data.value = props.data  
        stringobj.value = props.stringobjVal
})
watch(visible,()=>{
    showClass.value =  visible.value ? true : false 
})

const ActivityLog = (message, taskId = null) =>{
    let historyObj =  {
        'sprintId': taskId ? props.sprintId : null,
        'message': message,
        'key' : taskId ? 'task' : 'Project_Name',
    }
    apiRequest("post", env.HANDLE_HISTORY, {
        "type": taskId ? 'task' : 'project',
        "companyId": companyId.value,
        "projectId": props.ids.projectId,
        "taskId": taskId,
        "object": historyObj,
        "userData": userData
    })
    .catch((error) => {
        console.error("ERROR in update project history: ", error);
    })
}

const deleteTags = () =>{
    deleteTag(props.ids,Data.value)
    showSidebar.value = false
    ActivityLog(`<b>${userData.Employee_Name}</b> has deleted the <b> ${Data.value.tagName} Tag </b>`)
    toast.success(t('Toast.Tag_Deleted_successfully'),{position:'top-right'})
    let dataArray = props.tagsArray
    const index = dataArray.findIndex(x => x.uid === Data.value.uid)
    if (index !== -1) {
        dataArray.splice(index, 1)
    }
}

const removeTag = (ids,data) => {
    removeTaskTag(ids, data.uid)
}

const HandleChange = (e,key) => {
    let flag = false

    if(key === 'isRename')
        {
            props.tagsArray.forEach((item) => {
                if( item.tagName.toLowerCase().trim() === renameVal.value.toLowerCase().trim()) { flag = true }
            })
            if(e.keyCode == 13){
                if(Data.value.tagName.toLowerCase().trim() === renameVal.value.toLowerCase().trim()){
                    editStatus.value = false
                    return 
                }
                if(flag){
                    renameErrorMessage.value = t('Tags.This_tag_has_already_been_added');
                    return
                }
                if(!renameVal.value){
                    renameErrorMessage.value = t('Tags.Tag_name_required');
                    return
                }
                updateTag(props.ids,Data.value,{ ...Data.value , tagName: renameVal.value })
                ActivityLog(`<b>${userData.Employee_Name}</b> has renamed the Tag from <b>  ${Data.value?.tagName}  </b> to <b>${renameVal.value} </b>`)
                editStatus.value = undefined
                Data.value.tagName = renameVal.value;
            }
        }

        if(key === 'isColorSave')
        {
            updateTag(props.ids,Data.value,{...Data.value,tagColor:tagColor.value , tagBgColor:tagBgColor.value})
            Data.value.tagColor = tagColor.value;
            Data.value.tagBgColor = tagColor.value+'35';
            ActivityLog(`<b>${userData.Employee_Name}</b> has changed the Tag color of ${Data.value?.tagName}`)
            tagColor.value = '#000000'
            tagBgColor.value = '#C8C8C8'
            editStatus.value = undefined
        }
        if(key === 'isColorCancel')
        {
            tagColor.value = '#000000'
            tagBgColor.value = '#C8C8C8'
            editStatus.value = undefined
        }
}

const EditChips = (key)=>{
    editStatus.value = key
}
</script>
<style >
@import "./style.css";
</style>