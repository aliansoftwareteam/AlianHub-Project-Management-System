<template>
    <div class="projectInfoDiv bg-white" :class="[{'opacity-5 pointer-event-none' : item?.isRestrict === true}]">
        <div class="projectInfoTopLine d-flex align-items-center justify-content-between font-roboto-sans">
            <div class="d-flex align-items-center project__inToplinetextimg-wrapper">
                <img :class="[{'cursor-pointer' : activeTab === 0}]" :src="item?.favouriteTasks?.filter((x) => x.userId === userId)?.length ? projectStar : blankStar" @click="!item.isRestrict ? updateFavourite(item) : ''" title="favorite"/>
                <span class="ProjectFirstLatter light-purple d-flex align-items-center justify-content-center font-weight-400 font-roboto-sans white font-size-13 text-uppercase" v-if="item.projectIcon.type === 'color'" :style="[{'background-color': item.projectIcon.type === 'color' ? item.projectIcon.data : ''}]">{{item.ProjectName ? item.ProjectName.charAt(0) : ''}}</span>
                <WasabiImage
                    v-else
                    :style="[{'height': '20px','width': '20px','border-radius': '20px','margin-left': '5px'}]"
                    :data="{url: item.projectIcon.data}"
                />
                <p class="font-weight-500 dark-gray d-block font-size-14 text-ellipsis"><span>{{item.ProjectCode}}</span> | <span :title="item.ProjectName">{{item.ProjectName}}</span></p>
                <a v-if="activeTab === 0" class="d-flex font-weight-400 font-size-13 text-decoration-none font-roboto-sans cursor-pointer" href.prevent="#" @click="!item.isRestrict ? redirectProjectList(item) : ''"><img :src="projectGoToLink">{{ $t('Projects.go_to_project') }}</a>
            </div>
            <DropDown v-if="checkPermission('settings.settings_project_list') == true && checkPermission('project.project_details') == true && checkPermission('project.project_close') == true" :bodyClass="{'setting__project-dropdown' : true}">
                <template #button>
                    <img ref="setting" :src="dots" alt="dots" class="position-re ml-20px setting__dots">
                </template>
                <template #options>
                    <DropDownOption v-if="item.deletedStatusKey === 2">
                        <div class="d-flex align-items-center font-size-14 GunPowder setting__close-project" @click="$refs.setting.click(), !item.isRestrict ? unarchiveProject(item) : ''">
                            {{$t('Projects.restore_project')}}
                        </div>
                    </DropDownOption>
                    <DropDownOption v-if="item.deletedStatusKey === 2">
                        <div class="d-flex align-items-center font-size-14 GunPowder setting__close-project" @click="$refs.setting.click(), showSidebar=true">
                            {{$t('Projects.delete_project')}}
                        </div>
                    </DropDownOption>
                    <DropDownOption v-if="item.statusType !== 'close' && item.deletedStatusKey !== 2" @click="$refs.setting.click(), showSidebar=true">
                        <div class="d-flex align-items-center font-size-14 GunPowder setting__close-project">
                            {{ $t('Projects.close_project') }}
                        </div>
                    </DropDownOption>
                    <DropDownOption @click="$refs.setting.click(), !item.isRestrict ? colseProject(item,'reopen') : ''" v-if="item.statusType === 'close'">
                        <div class="d-flex align-items-center font-size-14 GunPowder setting__close-project">
                            {{ $t('Projects.reopen_project') }}
                        </div>
                    </DropDownOption>
                </template>
            </DropDown>
        </div>
        <div class="project_status_info_area d-flex">
            <div class="p_owner">
                <div class="p__owner-wrapper">
                    <span class="sub-title-span d-block font-roboto-sans font-weight-400 gray81 font-size-13">{{$t('Watcher.owner')}}</span>
                    <Assignee class="Assignee-component"
                        :users="item.LeadUserId"
                        :options="users.map((x) => x._id)"
                        :imageWidth="'30px'" 
                        :showDot="false"
                        @selected="changeAssignee('add', $event,item)"
                        @removed="changeAssignee('remove', $event,item)"
                        :numOfUsers="1"
                        :addUser="checkPermission('project.project_assignee') === true && activeTab === 0"
                        :isDisplayTeam="false"
                    />
                </div>
            </div>
            <div class="p_sharewith" :class="[{'pointer-event-none' : isSpinner === true}]">
                <div class="p__sharewith-wrapper">
                    <span class="sub-title-span d-block font-roboto-sans font-weight-400 gray81 font-size-13">{{$t('Projects.share_with')}}</span>
                    <div class="share-with-wrapperdata d-flex align-items-center justify-content-start">
                        <button class="border-radius-8-px font-size-13 d-flex align-items-center justify-content-center mr-010 font-roboto-sans"  @click="!item.isRestrict ? updateProjectSpace(item,'public') : ''" :class="[{'outline-primary share__everyone' : item.isPrivateSpace === false,'outline-secondary share__private':item.isPrivateSpace !== false,'cursor-pointer': activeTab === 0}]">{{$t('Projects.everyone')}}</button>                    
                        <button class="border-radius-8-px font-size-13 d-flex align-items-center justify-content-center font-roboto-sans"  @click="!item.isRestrict ? updateProjectSpace(item,'private') : ''" :class="[{'outline-primary share__everyone' : item.isPrivateSpace === true,'outline-secondary share__private':item.isPrivateSpace !== true,'cursor-pointer': activeTab === 0}]">{{$t('Projects.private')}}</button>
                    </div>
                </div>
            </div>
            <div class="p_status" v-if="checkPermission('project.project_status_change') != null">
                <div class="p_status-wrapper">
                    <span class="sub-title-span d-block font-roboto-sans font-weight-400 gray81 font-size-13">{{$t('Templates.project_status')}}</span>
                    <ul class="pro_block d-flex align-items-center justify-content-start flex-wrap" @click="!item.isRestrict ? openEditSidebar(item,'projectStatus') : ''">
                        <li class="projectDataColorli" v-for="(statusObj,statusKey) in item.projectStatusData"
                        :key="statusKey">
                            <span class="font-roboto-sans font-weight-400 font-size-13 white" :class="[{'cursor-pointer' : activeTab === 0}]" :style="[{'color': statusObj.textColor+'!important','background-color': statusObj.backgroundColor}]">
                                {{statusObj.name}}
                            </span>
                        </li>
                    </ul>
                </div>
            </div>
            <div class="task_type_status">
                <div class="task__type-wrapper">
                    <span class="sub-title-span d-block font-roboto-sans font-weight-400 gray81 font-size-13">{{$t('Projects.task_type')}}</span>
                    <ul class="d-flex task_type_statusul" @click="!item.isRestrict ? openEditSidebar(item,'taskType') : ''">
                        <li class="projectDataColorli" v-for="(taskType,taskTypeKey) in item.taskTypeCounts" :key="taskTypeKey">
                            <div class="task_type d-flex align-items-center border-radius-6-px bg-lightgray" :class="[{'cursor-pointer' : activeTab === 0}]">
                                <img v-if="taskType?.taskImage?.includes('http')" :src="taskType.taskImage" alt="task_type" :style="[{'height':'13.85px','width':'13.85px'}]">
                                <WasabiImage
                                    v-else
                                    :style="[{'height':'13.85px','width':'13.85px'}]"
                                    :data="{url: taskType.taskImage}"
                                />
                                <span class="font-size-13 font-roboto-sans font-weight-400 GunPowder ml-8px" :class="[{'cursor-pointer' : activeTab === 0}]">{{taskType.name}}</span>
                            </div>
                        </li>
                    </ul>
                </div>
            </div>
            <div class="task_type_status_todo" v-if="checkPermission('task.task_status') != null">
                <div class="task__typestatustodo-wrapper">
                    <span class="sub-title-span d-block font-roboto-sans font-weight-400 gray81 font-size-13">{{$t('Templates.task_status')}}</span>
                    <ul class="d-flex task_type_statusul" @click="!item.isRestrict ? openEditSidebar(item,'taskStatus') : ''">
                        <li class="cursor_pointer projectDataColorli" v-for="(statusObj,statusKey) in item.taskStatusData" :key="statusKey">
                            <span class="font-roboto-sans font-weight-400 font-size-13 bg-black white" :style="[{'background-color': statusObj.bgColor, 'color': statusObj.textColor+'!important'}]" :class="[{'cursor-pointer' : activeTab === 0}]">
                                {{statusObj.name}}
                            </span>
                        </li>
                    </ul>
                </div>
            </div>
            <div class="p_erpApp">
                <div class="p__erpApp-wrapper">
                    <span class="sub-title-span d-block font-roboto-sans font-weight-400 gray81 font-size-13">{{$t('Templates.apps')}}</span>
                    <ul 
                        class="pro_block d-flex align-items-center justify-content-start flex-wrap" 
                        v-if="appref.length > 0"
                    >
                        <li 
                            class="image_apps cursor_pointer projectDataColorli black" 
                            :class="{ 'cursor-pointer': activeTab === 0 }" 
                            v-for="(appObj, appKey) in appref" 
                            :key="appKey"
                        >
                            <div class="icon-wrapper">
                                <img 
                                    :src="processedApps?.includes(appObj.key) ? appIcons[appObj.key]?.afterIcon : appIcons[appObj.key]?.beforeIcon" 
                                    @click="!item.isRestrict ? updateApp(item, { key: appObj.key }) : ''" 
                                    :title="appObj.name || 'N/A'" 
                                    class="erp_app mr-4px"
                                />
                            </div>
                        </li>
                    </ul>
                    <ul class="d-flex" v-else>
                        <li class="projectDataColorli black font-size-13">
                            N/A
                        </li>
                    </ul>
                </div>
            </div>
            <div class="p_requiredViews">
                <div class="p__requiredViews-wrapper">
                    <span class="sub-title-span d-block font-roboto-sans font-weight-400 gray81 font-size-13">{{$t('Projects.required_view')}}</span>
                    <ul class="d-flex flex-wrap" v-if="requireComp && requireComp.length > 0" >
                        <li class="pro_block cursor_pointer projectDataColorli" :class="[{'cursor-pointer' : activeTab === 0}]" v-for="(requireObj,requireKey) in requireComp" :key="requireKey">
                            <img v-if="item.ProjectRequiredComponent?.filter((x) => x.keyName === requireObj.keyName).length > 0" :src="projectComponentsIcons(requireObj.keyName).activeIcon"
                            @click="!item.isRestrict ? (item.ProjectRequiredComponent.length > 1 ? updateTabs(item,requireObj,'unRead'):null) : ''" :title="requireObj.name ? requireObj.name :'N/A'" class="erp_app def_req mr-10px">
                            <img v-else :src="projectComponentsIcons(requireObj.keyName).icon" @click="!item.isRestrict ? updateTabs(item,requireObj,'read') : ''" :title="'45'+requireObj.name ? requireObj.name :'N/A'" class="erp_app tab_req mr-10px">
                        </li>
                    </ul>
                    <ul class="d-flex" v-else>
                        <li class="projectDataColorli font-size-13">
                            N/A
                        </li>
                    </ul>
                </div>
            </div>
        </div>
        <ConfirmationSidebar
            v-model="showSidebar"
            :title="`${item.deletedStatusKey === 0 ? $t('Projects.close') : item.deletedStatusKey === 1 ? $t('Projects.archive') : $t('Projects.delete')}`"
            :message="item.deletedStatusKey === 0 ? $t('conformationmsg.archive0mesg') : item.deletedStatusKey === 1 ? $t('conformationmsg.archive') : $t('conformationmsg.delete')"
            :confirmationString="`${item.deletedStatusKey === 0 ? 'close' : item.deletedStatusKey === 1 ? 'archive' : 'delete'}`"
            :acceptButtonClass="item.deletedStatusKey === 1 ? 'btn-primary': 'btn-danger'"
            :acceptButton="`${item.deletedStatusKey === 0 ? $t('Projects.close') : item.deletedStatusKey === 1 ? $t('Projects.archive') : $t('Projects.delete')}`"
            @confirm="item.deletedStatusKey === 0 ? colseProject(item, 'close') : item.deletedStatusKey === 2 ? deleteProject(item, 1) : ''"
        />
    </div>
    <ProjectSettingSidebar v-if="openSidebarInProject" :sidebarTitle="sidebarTitle" :projectData="item" :openSidebarInProject="openSidebarInProject" @isSidebarProjectSetting="openSidebarInProject = false" />
</template>

<script setup>
import { defineProps, inject, computed, ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useProjects } from '@/composable/projects';
import Assignee from "@/components/molecules/Assignee/Assignee.vue";
import ProjectSettingSidebar from '@/components/atom/ProjectSettingSidebar/ProjectSettingSidebar.vue'
import { useStore } from 'vuex';
import { useToast } from 'vue-toast-notification';
import DropDown from '@/components/molecules/DropDown/DropDown.vue'
import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue'
const companyId = inject('$companyId');
const userId = inject("$userId");
import { useCustomComposable, useGetterFunctions } from "@/composable";
import WasabiImage from "@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue";
import { projectComponentsIcons, projectAppsIcons } from '@/composable/commonFunction';
import { apiRequest } from "@/services";
import * as env from '@/config/env';
import ConfirmationSidebar from "@/components/molecules/ConfirmationSidebar/ConfirmationSidebar.vue"
import { useI18n } from "vue-i18n";
import { closeProject } from "@/utils/NotificationTemplate";
const { t } = useI18n();

const props = defineProps({
    item: {
        type: Object,
        default: () => {}
    },
    activeTab:{
        type: Number
    }
});
const {markFavourite} = useProjects();
const {getters,commit} = useStore();
const {checkPermission,sanitizeInput} = useCustomComposable();
const {getUser} = useGetterFunctions();
const router = useRouter();
const $toast = useToast();
const projectGoToLink = require("@/assets/images/svg/projectGoToLink.svg");
const blankStar = require("@/assets/images/svg/blankStar.svg");
const projectStar = require("@/assets/images/svg/start13.svg");
const sidebarTitle = ref('');
const openSidebarInProject = ref(false);
const dots =require('@/assets/images/svg/setting_project_threedots.svg')
const isSpinner = ref(false);
const showSidebar = ref(false);

const users = computed(() => getters["users/users"]);
const user = getUser(userId.value);
const userData = {
    id: user.id,
    Employee_Name: user.Employee_Name,
    companyOwnerId: user.companyOwnerId
}
const requireComp = computed(() => {
    let arr = getters['settings/projectTabComponents'];
    const removeArr = ["gantt", "timeline","embed"];
    // Also drop the dead legacy 'Gantt'/'Timeline' keyNames (replaced by 'GanttView'/'TimelineView').
    // getView() has no case for them (they render NotFound) and they duplicate the working views in
    // this Required-Views picker — the value-based removeArr above doesn't catch them by keyName.
    const removeKeyNames = ["Gantt", "Timeline"];
    arr= arr?.filter((item) => {
        if(!removeArr.includes(item.value) && !removeKeyNames.includes(item.keyName)) {
            return item;
        }
    });
    return arr;
});
const {checkSpecificTypeCount} = useProjects();

const settingPermission = computed(() => checkPermission("settings.settings_project_list",true, {gettersVal: getters}))
const projectDetailPremission = computed(() => checkPermission("project.project_details",true, {gettersVal: getters}))
const taskStatusPermission = computed(() => checkPermission("task.task_status", true, {gettersVal: getters}))
const projectStatusPermission = computed(() => checkPermission("project.project_status_change", true, {gettersVal: getters}))

function redirectProjectList (data) {
    router.push({ name: 'Project', params: {cid: companyId.value, id: data._id}});
}
function updateFavourite(projectData) {
    if(settingPermission.value !== true || projectDetailPremission.value !== true){
        return;
    }
    if(props.activeTab === 1){
        return;
    }
    if(!projectData.favouriteTasks || !projectData.favouriteTasks.find((x) => x.userId === userId.value)) {
        markFavourite({
            cid: companyId.value,
            projectId: projectData._id,
            userId: userId.value
        })
        commit('projectData/projectLocalUpdate', {itemData:projectData,key:'MarkAsFavourite',subKey:"add",userId: userId.value});
    } else {
        markFavourite({
            cid: companyId.value,
            projectId: projectData._id,
            userId: userId.value,
            data: projectData.favouriteTasks.find((x) => x.userId === userId.value)
        })
        commit('projectData/projectLocalUpdate', {itemData:projectData,key:'MarkAsFavourite',subKey:"remove",userId: userId.value});
    }
}
const changeAssignee = async (type, user,projectData) => {
    try {
        if(props.activeTab === 1){
            return;
        }
        let queryObj;
        let key;
        if (type === "add") {
            queryObj = { AssigneeUserId: user.id, LeadUserId : user.id};
            key = '$addToSet'
        } else {
            queryObj = {
                AssigneeUserId: user.id,
                ...(projectData.LeadUserId.includes(user.id) && { LeadUserId: user.id })
            }
            key = "$pull"
        }
    
        await apiRequest("put",`/api/v1/${env.PROJECTACTIONS}/${projectData._id}`,{updateObject: queryObj,key: key})
        commit('projectData/projectLocalUpdate', {itemData:  {...projectData.value},projectId:projectData._id,key:'LeadUserChange',subKey: key === '$addToSet' ? 'add' : 'remove',userId: user.id});
        $toast.success(t(`Toast.Assignee ${type === "add" ? 'added' : 'removed'} successfully`),{position: 'top-right'});
    } catch (error) {
        console.error(error);
    }
}

function updateProjectSpace (projectObj,type) {
    let checkPlan;
    isSpinner.value = true;
    if(type === 'public'){
        checkPlan = checkSpecificTypeCount('public');
    }else{
        checkPlan = checkSpecificTypeCount('private');
    }
    if(checkPlan === true){
        if((type === 'private' && projectObj.isPrivateSpace === true)|| (type === 'public' && projectObj.isPrivateSpace === false)){
            return;
        }
        if(settingPermission.value !== true || projectDetailPremission.value !== true){
            return;
        }
        if(props.activeTab === 1){
            return;
        }
        let space = type == 'public' ? false : true;
        updateProjectType(projectObj,space)
    }else{
        isSpinner.value = false;
        $toast.error(t('Toast.Upgrade_Your_Plan'),{position: 'top-right'})
    }
}

async function updateApp (item,appObj) {
    try {
        if (settingPermission.value !== true || projectDetailPremission.value !== true) {
            return;
        }
        if(props.activeTab === 1){
            return;
        }

        if (!Array.isArray(item.apps)) {
            item.apps = [];
        }

        const containsObject = item.apps.some(app => typeof app === "object" && app !== null);

        if (containsObject) {
            item.apps = item.apps.map(app => (typeof app === "object" ? app.key : app));
        }

        let index = item.apps.indexOf(appObj.key);

        if (index === -1) {
            item.apps.push(appObj.key);
        } else {
            item.apps.splice(index, 1);
        }

        let queryObj = containsObject
            ? { updateObject: { apps: item.apps }, key: "$set" } 
            : item.apps.includes(appObj.key)
                ? { updateObject: { apps: appObj.key }, key: "$addToSet" } 
                : { updateObject: { apps: appObj.key }, key: "$pull" };

         await apiRequest("put", `/api/v1/${env.PROJECTACTIONS}/${item._id}`, queryObj);

        commit("projectData/projectLocalUpdate", {
            itemData: item.apps,
            projectId: item._id,
            key:"ProjectAppChange",
            subKey: "",
            userId: "",
        });

        $toast.success(t('Toast.Updated_successfully'),{position: 'top-right'});
    } catch (error) {
       console.error(error); 
    }
}

const appref = ref([]);
const appIcons = ref({});
const data = async () => {
    const response = await apiRequest("get", env.PROJECTS_APPS);
    appref.value = response.data;

    const icons = {};
    for (const app of appref.value) {
        icons[app.key] = await getAppIcon(app.key);
    }
    appIcons.value = icons;
};

onMounted(()=>{
    data();
})
const getAppIcon = async(appKey) => {
    const icons = projectAppsIcons(appKey) || {};
    
    return {
        beforeIcon: icons.beforeIcon || "default-icon.png", 
        afterIcon: icons.afterIcon || "default-icon.png"
    };
};

const getAppKeys = (apps) => {
    if (!Array.isArray(apps)) return [];

    return apps.map(app => (typeof app === "object" ? app.key : app));
};

const processedApps = computed(() => getAppKeys(props.item.apps));

async function updateTabs (item,appObj,type) {
    try {
        if(settingPermission.value !== true || projectDetailPremission.value !== true){
            return;
        }
        if(props.activeTab === 1){
            return;
        }
        if((appObj.setAsDefault == true && type == 'unRead')){
            return;
        }
        let fInd = item.ProjectRequiredComponent.findIndex((x) => {
            return x.keyName === appObj.keyName
        })
        if(type === 'read'){
            if(fInd === -1){
                appObj.viewStatus = true;
                item.ProjectRequiredComponent.push(appObj);
            }else{
                item.ProjectRequiredComponent[fInd].viewStatus = true
            }
        }
        if(type === 'unRead'){
            item.ProjectRequiredComponent.splice(fInd,1)
        }
        let queryObj ={ProjectRequiredComponent: item.ProjectRequiredComponent}
        await apiRequest("put",`/api/v1/${env.PROJECTACTIONS}/${item._id}`,{updateObject: queryObj});
        commit('projectData/projectLocalUpdate', {itemData:  item.ProjectRequiredComponent,projectId:item._id,key:'ProjectTabChange',subKey: '',userId: ''});
        $toast.success(t('Toast.Updated_successfully'),{position: 'top-right'});   
    } catch (error) {
        console.error(error);
    }
}

function openEditSidebar(projectObj, type){
    try{ 
        if(props.activeTab === 1){
            return;
        }
        if(settingPermission.value !== true || projectDetailPremission.value !== true){
            return
        }
        if(type == 'projectStatus' && projectStatusPermission.value !== true){
            return;
        }
        if(type == 'taskStatus' && taskStatusPermission.value !== true){
            return;
        }
        openSidebarInProject.value = true;
        sidebarTitle.value = type;
    }catch(error){
        console.error(error);
    }
}

async function colseProject (project,type) {
    try {
        if(settingPermission.value !== true || projectDetailPremission.value !== true){
            return;
        }
        let updateObject = {}
        let status;
        if(type === 'close'){
            status = project.projectStatusData.find((x) => x.type === "close");
            updateObject.status = status.value;
            updateObject.statusType = status.type;
        }else{
            status = project.projectStatusData.find((x) => x.default === true);
            if (!status) {
                status = project.projectStatusData.find((x) => x.type === "default_active");
                if (!status) {
                    status = project.projectStatusData[0];
                }
            }
            updateObject.status = status.value;
            updateObject.statusType = status.type;
           
    
        }
        await apiRequest("put",`/api/v1/${env.PROJECTACTIONS}/${project._id}`,{updateObject: updateObject});
        commit('projectData/projectLocalUpdate', {itemData:  {...project,...updateObject},projectId:project._id,key:'RemoveProject',subKey: '',userId: ''});
        if(type === 'reopen') {
            restoreChildTasks(project._id);
            let historyObj = {
                key : "Project_EndDate",
                message : `<b>${userData.Employee_Name}</b> has reopened <b>${sanitizeInput(project.ProjectName)}</b> Project</b>.`
            }
            apiRequest("post", env.HANDLE_HISTORY, {
                "type": 'project',
                "companyId": companyId.value,
                "projectId": project._id,
                "taskId": null,
                "object": historyObj,
                "userData": userData
            })
        } else {
            restoreChildTasks(project._id, 8);
        }
        if(type === 'close'){
            let notifyObj = {
                'ProjectName' : project?.ProjectName ||' ',
                'userName' : userData?.Employee_Name || ''
            }
            let notificationObject = {
                message: closeProject(notifyObj),
                key: "project_close",
            };
            
            apiRequest("post", env.HANDLE_NOTIFICATION, {
                type: 'project',
                companyId: companyId.value,
                projectId: project?._id,
                object: notificationObject,
                userData: userData
            })
            .catch((error) => {
                console.error("ERROR in update notification", error);
            })
        }
        $toast.success(t('Toast.Updated_successfully'),{position: 'top-right'});
        showSidebar.value = false;
    } catch (error) {
        console.error(error);
    }
}


async function deleteProject(project, deletedStatusKey) {
    try {
        showSidebar.value = false
        let updateObject = {};
        updateObject.deletedStatusKey = deletedStatusKey;

        await apiRequest("put",`/api/v1/${env.PROJECTACTIONS}/${project._id}`,{updateObject: updateObject});
        commit('projectData/projectLocalUpdate', {itemData:  {...project,...updateObject},projectId:project._id,key:'RemoveProject',subKey: '',userId: ''});
        deleteChildTasks(project);
        commit('projectData/mutateProjects', [{ op: "modified", data: { ...project, ...updateObject } }]);
        let historyObj = {
            key: "Project_EndDate",
            message: `<b>${userData.Employee_Name}</b> has deleted <b>${sanitizeInput(project.ProjectName)}</b> project</b>.`
        }
        apiRequest("post", env.HANDLE_HISTORY, {
            "type": 'project',
            "companyId": companyId.value,
            "projectId": project._id,
            "taskId": null,
            "object": historyObj,
            "userData": userData
        })

        $toast.success(t('Toast.Deleted_successfully'), { position: 'top-right' });
    } catch (error) {
        console.error(error);
    }
}

async function deleteChildTasks(project) {
    try {
        let body = {
            findObject: {deletedStatusKey: { $in: [0, undefined] }},
            updateObject: { $set: { deletedStatusKey: 1 } },
        }
        await apiRequest("put", `/api/v1/${env.PROJECTALLTASKUPDATE}/${project._id}`,body);
    } catch (error) {
        console.error(error)
    }
}

async function unarchiveProject(project) {
    try {
        let updateObject = {deletedStatusKey: 0}
        await apiRequest("put",`/api/v1/${env.PROJECTACTIONS}/${project._id}`,{updateObject: updateObject});
        commit('projectData/projectLocalUpdate', {itemData:  {...project,...updateObject},projectId:project._id,key:'RemoveProject',subKey: '',userId: ''});
        restoreChildTasks(project._id, 7);
        let historyObj = {
            key : "Project_EndDate",
            message : `<b>${userData.Employee_Name}</b> has unarchived <b>${sanitizeInput(project.ProjectName)}</b> project</b>.`
        }
        apiRequest("post", env.HANDLE_HISTORY, {
            "type": 'project',
            "companyId": companyId.value,
            "projectId": project._id,
            "taskId": null,
            "object": historyObj,
            "userData": userData
        })
        $toast.success(t('Toast.Updated_successfully'),{position: 'top-right'});
    } catch (error) {
        console.error("ERROR in unarchive project: ", error);
    }
}

async function restoreChildTasks(projectId, restoreKey = 8) {
    // UPDATE CHILD TASKS | TYPESENE
    try {
        let taskDeleteStatusKey = 0;
        let body = {
            findObject: { deletedStatusKey:restoreKey },
            updateObject: {deletedStatusKey: taskDeleteStatusKey}
        }
        await apiRequest("put", `/api/v1/${env.PROJECTALLTASKUPDATE}/${projectId}`,body);
    } catch (error) {
        console.error(`ERROR in update sprint tasks: `, error);
    }
}

async function updateProjectType (projectObj,isPrivate) {
    try {
        let queryObj;
        if(isPrivate === true){
            queryObj = {'projectCount.privateCount':1, 'projectCount.publicCount':-1};
        }else{
            queryObj = {'projectCount.publicCount':1, 'projectCount.privateCount':-1};
        }
        await apiRequest("put",`${env.COMPANYACTIONS}`,{updateObject: queryObj,key: '$inc'});
        let type = isPrivate === true ? 'private' : 'public';
        if(checkSpecificTypeCount(type) === true){
            let queryObj = {
                isPrivateSpace: isPrivate
            };
            await apiRequest("put",`/api/v1/${env.PROJECTACTIONS}/${projectObj._id}`,{updateObject: queryObj})
            $toast.success(t('Toast.Updated_successfully'),{position: 'top-right'});
            let historyObj = {
                key : "Project_EndDate",
                message : `<b>${userData.Employee_Name}</b> has changed <b>Share with option</b> as <b>${type}</b></b>.`
            }
            apiRequest("post", env.HANDLE_HISTORY, {
                "type": 'project',
                "companyId": companyId.value,
                "projectId": projectObj._id,
                "taskId": null,
                "object": historyObj,
                "userData": userData
            })
            commit('projectData/projectLocalUpdate', {itemData:{...projectObj,isPrivateSpace: isPrivate},projectId:projectObj._id,key:'ProjectTypeChange',subKey:"",userId: ''});
        }
        //If you don't have plans to update private or public projects, that time count is decresed
        else{
            isSpinner.value = false;
            $toast.error(t('Toast.Upgrade_Your_Plan'),{position: 'top-right'})
            let queryObj;
            if(isPrivate === true){
                queryObj = {'projectCount.privateCount':-1, 'projectCount.publicCount':1};
            }else{
                queryObj = {'projectCount.publicCount':-1, 'projectCount.privateCount':1};
            }
            await apiRequest("put",`${env.COMPANYACTIONS}`,{updateObject: queryObj,key: '$inc'});
            commit('projectData/projectLocalUpdate', {itemData:{...projectObj,isPrivateSpace: isPrivate},projectId:projectObj._id,key:'ProjectTypeChange',subKey:"",userId: ''});
        }
    } catch (error) {
        console.error('Error while updating project type',error);
    }
}

</script>

<style scoped>
@import "./style.css";
</style>