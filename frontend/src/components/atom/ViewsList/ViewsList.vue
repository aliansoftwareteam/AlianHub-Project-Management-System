<template>
    <div
    v-if="item._id && item._id.length>6"
        :class="{'bg-light-gray': active}"
        class="d-flex align-items-center text-nowrap border-top-radius-10-px cursor-pointer wrapper h-100"
        @click.stop="$emit('click', item)"
    >
        <div :class="{'border-left': firstChild && !active, 'border-right': !active, 'border-none activeViewList': active}" class="d-flex align-items-center font-size-14 view-list position-re"
        :style="{ height: active ? '48px' : 'auto' }">
           <span v-if="commentCount" class="count-block comment__count white position-ab">{{commentCount <= 99 ? commentCount : '+99'}}</span> 
           <img class="position-ab list_make_as_defaultimg" v-if="item.setAsDefault" :src="viewDefaultIcon" />
           <img :src="active ? projectComponentsIcons(item.keyName)?.activeIcon : projectComponentsIcons(item.keyName)?.icon" :alt="item.name" class="mr-10px">
           <span class="gray81">{{$t(`ViewList.${item.name}`)}}</span>
           <img :src="active ? activePin : pin" v-if="item?.isPin && item.isPin" class="ml-10px active__pin-condition">
           <span class="notification-tick blinking position-sti ml-7px" v-if="item?.isPrivate"></span>
           <DropDown :id="item._id" @isVisible="isDropDownVisible" :zIndex="6" v-if="checkPermission('project.view_list',project.isGlobalPermission) === true">
                <template #button>
                    <img :src="dots" class="dots ml-5px" :ref="item._id">
                </template>
                <template #options>
                    <div>
                        <ul class="p-0 m-0 justify-content-start cursor-pointer">
                            <li class="embed-edit-options mb-7px" @click.stop="editOptions('Pin'),$refs[item._id].click()" >
                                <img :src="pin" class="mr-14-px list__edit" />
                                <span class="font-roboto-sans font-weight-400 font-size-14 line-height-19 text-left gray81">{{item?.isPin ? $t('Projects.unpin') :$t('Projects.pinview') }}</span>
                            </li>
                            <li class="embed-edit-options cursor-pointer mb-7px" @click.stop="editOptions('AddDefault'),$refs[item._id].click()" v-if="project?.ProjectRequiredComponent && (project?.ProjectRequiredComponent?.filter((e)=>e.setAsDefault === true).length == 0 || project?.ProjectRequiredComponent?.find((e)=>e.setAsDefault === true).keyName === item?.keyName)">
                                <img :src="defaultView" class="mr-14-px list__edit" />
                                <span class="font-roboto-sans font-weight-400 font-size-14 line-height-19 text-left gray81">{{!item?.setAsDefault ? $t('ViewList.set_as_default') :$t('ViewList.remove_as_default') }}</span>
                            </li>
                            <li class="embed-edit-options cursor-pointer" @click.stop="isDelete = true, $refs[item._id].click()" v-if="isDeleteDisabled == false">
                                <img :src="deleteImage" class="mr-14-px list__edit"/>
                                <span class="font-roboto-sans font-weight-400 font-size-14 line-height-19 text-left red pt-2px">{{$t('Projects.deleteview')}}</span>
                            </li>
                        </ul>
                    </div>
                </template>
            </DropDown>
            <ConfirmationSidebar
                v-model="isDelete"
                :title="$t('Projects.deleteview')"
                :message="`${$t('Filters.are_you_sure')}  ${item.name} ${$t('Projects.view')}?`"
                acceptButtonClass="btn-danger"
                @confirm="() => editOptions('Delete')"
                 :acceptButton="$t('Projects.delete')"
                >
                <template #body>
                    <div></div>
                </template>
            </ConfirmationSidebar>
        </div>
    </div>
</template>

<script setup>
// PACKAGES
import { defineProps, defineEmits, ref , inject ,computed} from 'vue';
import { useToast } from 'vue-toast-notification';

// UTILS
import { deleteView , editView} from '@/components/molecules/EmbedView/helper';
import { useRoute , useRouter } from 'vue-router';
import * as env from '@/config/env';
import { useStore } from 'vuex';
import { useGetterFunctions, useCustomComposable } from '@/composable';
import { projectComponentsIcons } from '@/composable/commonFunction';

// COMPONENTS
import DropDown from '@/components/molecules/DropDown/DropDown.vue'
import ConfirmationSidebar from "@/components/molecules/ConfirmationSidebar/ConfirmationSidebar.vue"
import { apiRequest } from '../../../services';

const {getUser} = useGetterFunctions();
const viewDefaultIcon = require("@/assets/images/svg/list_home_icon.svg");
const pin = require("@/assets/images/svg/pin.svg")
const activePin = require("@/assets/images/svg/active-pin.svg")
const defaultView = require("@/assets/images/svg/HomeVector.svg")
const dots  = require("@/assets/images/svg/PriorityIcon/dotsIcon.svg") 
const isDropDownVisible = ref(false)
const deleteImage = require('@/assets/images/svg/delete-red.svg')
const isDelete = ref(false)
const userId = inject('$userId')
const route = useRoute();
const router = useRouter();
const companyId = inject('$companyId')
const companyOwner = computed(() => getters["settings/companyOwnerDetail"])
const project = inject("selectedProject")
const {checkPermission} = useCustomComposable();
const {getters,commit} = useStore()
const toast = useToast()
const user = getUser(userId.value);
const userData = {
    id: user.id,
    Employee_Name: user.Employee_Name,
    companyOwnerId: companyOwner.value.userId
}

// PROPS
const props = defineProps({
    item: {
        type: Object,
        required: true
    },
    active: {
        type: Boolean,
        default: false
    },
    firstChild: {
        type: Boolean,
        default: false
    },
    commentCount: {
        type: Number,
        default: 0
    },
    isDeleteDisabled: {
        type: Boolean,
        default: false
    }
})

const editOptions = (type) =>{
    let historyObj = ''
    if(type === 'Pin') {
        let item = props.item
        if(props.item?.isPin){
            editView({cid: companyId.value, pid: project.value?._id}, item, false, 'isPin').then((res)=>{
                commit('projectData/projectLocalUpdate', {itemData: res.data,projectId: project.value?._id,key:"ProjectView",subKey:"edit",userId: ''});
            }).catch((err) => {
                console.error(err)
            })
            historyObj = {
                'message': `<b> ${userData.Employee_Name} </b> has Unpinned the <b> ${item?.name} View </b>`,
                'key' : 'Project_Name',
            }
        } else {
            editView({cid:companyId.value, pid: project.value?._id}, item, true, 'isPin').then((res)=>{
                commit('projectData/projectLocalUpdate', {itemData: res.data,projectId: project.value?._id,key:"ProjectView",subKey:"edit",userId: ''});
            }).catch((err) =>{
                console.error(err)
            })
            historyObj = {
                'message': `<b> ${userData.Employee_Name} </b> has pinned the <b> ${item?.name} View </b>`,
                'key' : 'Project_Name',
            }
        }
    }

    if(type === 'Delete'){
        if(route.query.tab == props.item?.keyName) {
            let viewFind = project.value?.ProjectRequiredComponent?.find((e) => e.setAsDefault && e.keyName !== props.item?.keyName) || project.value?.ProjectRequiredComponent?.find((e) => e.viewStatus && e.keyName !== props.item?.keyName) || project.value?.ProjectRequiredComponent.find((e)=> e.keyName !== props.item?.keyName);
            router.replace({query: {tab: viewFind ? viewFind?.keyName :'ProjectListView'}});
        }
        let item = props.item;
        deleteView({cid: companyId.value, pid: project.value?._id}, item ).then((res) => {
            commit('projectData/projectLocalUpdate', {itemData: res.data,projectId: project.value?._id,key:"ProjectView",subKey:"delete",userId: ''});
            toast.success(res.statusText, {position:'top-right'})
            isDelete.value = false
        })
        historyObj = {
            'message': `<b> ${userData.Employee_Name} </b> has Deleted the <b> ${props.item?.name} View </b>`,
            'key' : 'Project_Name',
        }
    }
    if(type === 'AddDefault') {
        let item = props.item;
        if(!props.item?.setAsDefault) {
            editView({cid: companyId.value, pid: project.value?._id}, item, true, 'setAsDefault').then((res)=>{
                commit('projectData/projectLocalUpdate', {itemData: res.data,projectId: project.value?._id,key:"ProjectView",subKey:"edit",userId: ''});
            }).catch((err) => {
                console.error(err)
            })
            historyObj = {
                'message': `<b> ${userData.Employee_Name} </b> has added the <b> ${item?.name} </b>as Default View`,
                'key' : 'Project_Name',
            }
        } else {
            editView({cid: companyId.value, pid: project.value?._id}, item, false, 'setAsDefault').then((res)=>{
                commit('projectData/projectLocalUpdate', {itemData: res.data,projectId: project.value?._id,key:"ProjectView",subKey:"edit",userId: ''});
            }).catch((err) => {
                console.error(err)
            })
            historyObj = {
                'message': `<b> ${userData.Employee_Name} </b> has removed the <b> ${item?.name} </b>as Default View `,
                'key' : 'Project_Name',
            }
        }
    }
    apiRequest("post", env.HANDLE_HISTORY, {
        "type": 'project',
        "companyId": companyId.value,
        "projectId": project.value._id,
        "taskId": null,
        "object": historyObj,
        "userData": userData
    })
    .catch((error) => {
        console.error("ERROR in update project history: ", error);
    })
}

// EMITS
defineEmits(['click']);
</script>
<style scoped>
.dots, .list__edit{
    height: 20px;
    width: 15px;
}
.count-block.comment__count{
   color: #eabb00 !important;
   background-color: transparent;
   border: 1px solid #eabb00 !important;
   top: -9px;
   right: 4px;
}

.active__pin-condition{
    height: 10px;
    width: 10px;
}
</style>
