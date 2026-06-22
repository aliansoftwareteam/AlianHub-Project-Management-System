<template lang="">
    <div v-if="navOptions.length > 0" class="view__list-dropdown d-flex" :class="{'flex-column' : clientWidth <= 767}" :id='tourId'>
        <div class="view__navbar" :class="{'view_dd-responsive-tabs style-scroll p-0' : clientWidth <= 767}" :style="`${clientWidth <= 767 ? '' : ''}`">
            <span class="d-block font-size-13 cursor-default colorlowlightgray mb-5px taskview__text" v-if="clientWidth > 767">
                {{$t('Projects.task_view')}}
            </span>
            <div v-for="(item, index) in navOptions" :key="index">
                <DropDownOption :class="{'activeView': item.name == viewItem.name}" class="options" :style="`${clientWidth <= 767 ? 'padding: 5px 0px !important;' : ''}`" :item="{label:$t(`ViewList.${item.name}`), image: projectComponentsIcons(item.keyName).icon}"  @click="viewItem = {...item}"/>
                <div  v-if="index == 3 && clientWidth > 767" class="p0x-10px">
                    <div class="comments__divider"></div>
                </div>
            </div>
        </div>
        <div class="view__body bg-light-gray" :class="{'view_list_dd_body' : clientWidth <= 767}">
            <div v-if="viewItem.name == 'Embed'">
                <EmbedView :projectData="projectData" @closeDropdown="emits('closeDropdown')"/>
            </div>
            <div v-if="viewItem.name != 'Embed'">
                <div class="d-flex justify-content-center mt-1">
                    <img :src="viewItem?.image" alt="list-image" class="filter-shadow">
                </div>

                <div class="description mt-20px mb-17px">
                    <h3 class="font-size-16 black pb-5px m-0 taskview__title">{{$t(`ViewList.${viewItem.name}`)}}</h3>
                    <p class="font-size-13 GunPowder m-0 taskview__text">{{$t(`ViewListdescription.${viewItem.description}`)}}</p>
                </div>

                <div class="d-flex justify-content-between align-items-center">
                    <div class="d-flex justify-content-between pinview__main-wrapper">
                        <div class="private__pin-wrapper d-flex align-items-center">
                            <input type="checkbox"  id="c2" v-model="isPin" @change="changePin(isPin)">
                            <label  for="c2" class="font-size-13 pl-3px dark-gray2 taskview__text">{{$t('Projects.pin')}} {{$t('Projects.view')}}</label>
                        </div>
                    </div>
                    <button class="btn-primary font-roboto-sans d-flex align-items-center font-size-16 disable__addview-btn"  @click="handleSubmit(),emits('handleCloseDropdown')" :disabled='isDisabled' :class="[{'grey_btn': isDisabled}]">{{$t('Projects.add_view')}}</button>
                </div>    
            </div>
        </div>
    </div>
</template>
<script setup>
// UTILS
import { addView, editView } from '@/components/molecules/EmbedView/helper.js'
import { addPrivateView } from './helper.js'
import { useCustomComposable, useGetterFunctions } from "@/composable";
import * as env from '@/config/env';
import { projectComponentsIcons } from '@/composable/commonFunction';

// COMPONENTS
import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue'
import EmbedView from '@/components/molecules/EmbedView/EmbedView.vue'

// PACKAGES
import { ref, onMounted, inject, computed, watch } from 'vue'
import { useToast } from 'vue-toast-notification'
import { useStore } from 'vuex';
import { apiRequest } from '../../../services';
import { useI18n } from "vue-i18n";
const { t } = useI18n();

const {getUser} = useGetterFunctions();
const {makeUniqueId} = useCustomComposable();
const { getters,commit } = useStore();
const clientWidth = inject("$clientWidth");
const props = defineProps({
    projectData:{
        type:Object,
        default:() => {}
    },
    tourId: {
        type: String,
        default: ''
    }
})

const companyUserData = computed(()=> { return getters['settings/companyUsers']})
const toast = useToast()
const emits = defineEmits(['closeDropdown','handleCloseDropdown'])
const isPin = ref(false)
const isPrivate = ref(false)
const navOptions = ref('')
const images = {
    ProjectListView: {image: require('@/assets/images/png/List.png'), description: 'list_view' },
    ProjectKanban: {image: require('@/assets/images/png/Board.png'), description: 'kanban_view' },
    ProjectDetail: {image: require('@/assets/images/png/ProjectDetail.png'), description: 'projectdetail_view'},
    Comments: {image: require('@/assets/images/png/comments.png'), description: 'Comments_view'},
    Calendar: {image: require('@/assets/images/png/Calendar.png'), description: 'calender_view'},
    TableView: {image: require('@/assets/images/png/Table.png'), description: 'table_view'},
    Workload: {image: require('@/assets/images/png/Workload.png'), description: "workload_view"},
    ActivityLog: {image: require('@/assets/images/png/Activity.png'), description: 'activitylog_view'},
    Reports: {image: require('@/assets/images/png/Activity.png'), description: 'reports_view'},
    GanttView: {image: require('@/assets/images/png/Table.png'), description: 'gantt_view'},
    RecurringTasks: {image: require('@/assets/images/png/Calendar.png'), description: 'recurring_view'},
    TimelineView: {image: require('@/assets/images/png/Table.png'), description: 'timeline_view'},
    MindMapView: {image: require('@/assets/images/png/Activity.png'), description: 'mindmap_view'},
    WhiteboardView: {image: require('@/assets/images/png/Board.png'), description: 'whiteboard_view'},
    CanvasView: {image: require('@/assets/images/png/Activity.png'), description: 'canvas_view'}
}
const viewItem = ref('')
const companyId = inject('$companyId')
const userId = inject('$userId')
const companyUser = ref()
const companyOwner = computed(() => getters["settings/companyOwnerDetail"])
const Data = ref('')
const isDisabled = ref(false)
const user = getUser(userId.value);

const userData = {
    id: user?._id,
    Employee_Name: user.Employee_Name,
    companyOwnerId: companyOwner.value.userId
}

onMounted(() => {
    Data.value = {...props.projectData}
    const queryRef = apiRequest("get", `${env.PROJECTS_TABS}`)
    queryRef.then((response) => {
        const data = response.data;
        navOptions.value = data.map((item) => { return {...item ,image: (images[item?.keyName])?.image , description : (images[item?.keyName])?.description , sortIndex: item?.sortIndex != 6 && item?.sortIndex != 9 ? item?.sortIndex : (item?.sortIndex == 9 ? 6 : 9 ) }})
        navOptions.value = (navOptions.value.filter((element) => element?.keyName != 'Gantt' && element?.keyName != 'Timeline')).sort((a,b) => (a.sortIndex < b.sortIndex) ? -1 : 1 )
        viewItem.value = {...navOptions.value[0]}
    })
    companyUser.value = (companyUserData.value.filter((item) => userId.value === item.userId )[0])
})

watch(viewItem,()=>{
    let array = Data?.value?.ProjectRequiredComponent.filter((item) => viewItem.value.name == item.name)
    isDisabled.value = array.length ? true : false
    isPin.value = array[0] && array[0]?.isPin ? array[0]?.isPin: false
})

watch(() => getters['projectData/projects']?.data?.find((x) => x._id === Data.value?._id) , () => {
    Data.value = getters['projectData/projects']?.data?.find((x) => x._id === Data.value?._id)
})

// This function is used to manage all the checklist hostory for the project and tasks
const manageHistory = async (type, key, message) => {
    const axiosData = {
        "type": type,
        "companyId": companyId.value,
        "projectId": Data.value._id,
        "taskId": null,
        "object": {
            "sprintId": null,
            "key": key,
            "message": message
        },
        "userData": userData
    };
    await apiRequest("post", env.HANDLE_HISTORY, axiosData).then((result) => {
        if(result.data.status) {
            console.info(result.data.statusText)
        }
    });
}

const changePin = (pin) => {
    if(!isDisabled.value){
        return;
    }
    viewItem.value['isPin'] = !pin
    let array = Data?.value?.ProjectRequiredComponent.filter((item) => viewItem.value.name == item.name)
    let item = array[0]
    delete (item).updatedAt

    editView({cid: companyId.value, pid: Data.value?._id}, item, pin, 'isPin').then((res) => {
        // Call history API
        commit('projectData/projectLocalUpdate', {itemData: res.data,projectId: Data.value?._id,key:"ProjectView",subKey:"edit",userId: ''});
        const msg =  `<b> ${userData.Employee_Name} </b> has ${pin ? 'Pinned' : 'Unpinned'} the <b> ${item?.name} View </b>`;
        manageHistory("project", "Project_Name", msg);
    }).catch((err) =>{
        console.error(err)
    })
    toast.success(t(`Toast.View ${pin ? 'Pinned' : 'Unpinned'}`),{position : 'top-right'})
}

const handleSubmit = () =>{
    let array = Data?.value?.ProjectRequiredComponent.filter((item) => viewItem.value.name == item.name)
    let array2 = companyUser?.value?.ProjectRequiredComponent ? (Object.values(companyUser?.value?.ProjectRequiredComponent)).filter((item) => viewItem.value.name == item.name && props.projectData._id == item.projectId ) : []

    if(array.length || array2.length) {
        toast.error(t("Toast.View_Already_Added"), {position:'top-right'})
        return 
    }
    let data = navOptions.value.filter((item) =>  item.name == viewItem.value.name)
    if(!isPrivate.value) {
        delete (data[0]).updatedAt
        delete (data[0]).createdAt
        delete (data[0]).description
        delete (data[0]).image
        addView({cid: companyId.value, pid: Data.value._id}, {...data[0] , isPin: isPin.value}).then((res) => {
            commit('projectData/projectLocalUpdate', {itemData: res.data,projectId: Data.value._id,key:"ProjectView",subKey:"add",userId: ''});
            toast.success(res.statusText , {position:'top-right'})
        }).catch((err) =>{
            console.error(err.statusText)
        })
    } else {
        data = {...data[0], isPin: isPin.value, isPrivate: isPrivate.value, projectId: Data.value._id}
        addPrivateView({cid:companyId.value, uid:companyUser.value._id, uniqueId:makeUniqueId(10)}, data).then((res) => {
            toast.success(t(`Toast.${res.statusText}`), {position:'top-right'})
        }).catch((err) => {
            console.error(err.statusText)
        })
    }
    // Call history API
    const msg =  `<b>${userData.Employee_Name}</b> has added the <b> ${isPin.value ? 'pinned' : ''} ${isPrivate.value ? 'private' : ''} View </b> as <b>${data[0]?.name}</b>`;
    manageHistory("project", "Project_Name", msg);
    emits('closeDropdown')
}

</script>
<style>
@import './style.css';

.view_dd-responsive-tabs{
    width: 100%;
    max-width: 100%;
    flex-direction: row;
    display: flex;
    overflow-x: auto;
}

.view_dd-responsive-tabs .drop-down-options-image {
    border-radius: 0px !important;
}
.view_dd-responsive-tabs span.project-mobile-desc {
    padding-left: 0px !important;
}
.view_dd-responsive-tabs .options:not(.activeView) {
    background-color: white !important;
}

.view_list_dd_body {
    max-height: calc(100vh - 30vh);
    overflow: auto;
    max-width: 100%;
    box-sizing: border-box;
}
.taskview__text{
    line-height:19.24px;
}
.taskview__title{
    line-height: 23.68px;
}
.pinview__main-wrapper{
    min-width: 188px;
}
.disable__addview-btn{
    padding: 7px 14.5px !important;
}
</style>