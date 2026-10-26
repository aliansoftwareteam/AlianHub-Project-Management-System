<template>
    <div class="ah-card projectInfoDiv" :class="[{'opacity-5 pointer-event-none' : item?.isRestrict === true}]">
        <div class="projectInfoTopLine d-flex align-items-center justify-content-between font-ui">
            <div class="d-flex align-items-center project__inToplinetextimg-wrapper">
                <button type="button" class="pls__star-btn" :class="{ 'is-on': isStarred('project', item?._id), 'pls__star-btn--locked': !editable }" :title="$t('Projects.favourite')" :aria-label="$t('Projects.favourite')" :aria-pressed="isStarred('project', item?._id)" @click="!item.isRestrict ? updateFavourite(item) : ''">
                    <span class="ah-mask-icon pls__star" :style="maskOf(isStarred('project', item?._id) ? projectStar : blankStar)" aria-hidden="true"></span>
                </button>
                <span class="ah-letter-tile ProjectFirstLatter d-flex align-items-center justify-content-center text-uppercase" v-if="item.projectIcon.type === 'color'" :style="[{'background-color': item.projectIcon.type === 'color' ? item.projectIcon.data : ''}]">{{item.ProjectName ? item.ProjectName.charAt(0) : ''}}</span>
                <WasabiImage
                    v-else
                    :style="[{'height': '20px','width': '20px','border-radius': '20px','margin-left': '5px'}]"
                    :data="{url: item.projectIcon.data}"
                />
                <p class="pls__name d-block text-ellipsis"><span>{{item.ProjectCode}}</span> | <span :title="item.ProjectName">{{item.ProjectName}}</span></p>
                <span v-if="showsClosedChip" class="ah-chip" data-test="closed-chip">{{ $t('Projects.closed_chip') }}</span>
                <a v-if="canOpen" class="pls__go d-flex text-decoration-none cursor-pointer" href.prevent="#" @click="!item.isRestrict ? redirectProjectList(item) : ''"><span class="ah-mask-icon pls__go-icon" :style="maskOf(projectGoToLink)" aria-hidden="true"></span>{{ $t('Projects.go_to_project') }}</a>
            </div>
            <DropDown v-if="menu.length" mode="menu" :bodyClass="{'setting__project-dropdown' : true}">
                <template #button>
                    <span class="ah-mask-icon setting__dots" :style="maskOf(dots)" role="img" :aria-label="$t('Projects.project_actions', { name: item.ProjectName })"></span>
                </template>
                <template #options>
                    <DropDownOption v-for="action in menu" :key="action.key" :data-test="`project-action-${action.key}`" @click="!item.isRestrict ? choose(action.key) : ''">
                        <div class="d-flex align-items-center setting__close-project">
                            {{ $t(action.label) }}
                        </div>
                    </DropDownOption>
                </template>
            </DropDown>
        </div>
        <div class="project_status_info_area d-flex">
            <div class="p_owner">
                <div class="p__owner-wrapper">
                    <span class="sub-title-span pls__label d-block">{{$t('Watcher.owner')}}</span>
                    <Assignee class="Assignee-component"
                        :users="item.LeadUserId"
                        :options="users.map((x) => x._id)"
                        :imageWidth="'30px'" 
                        :showDot="false"
                        @selected="changeAssignee('add', $event,item)"
                        @removed="changeAssignee('remove', $event,item)"
                        :numOfUsers="1"
                        :addUser="checkPermission('project.project_assignee') === true && editable"
                        :isDisplayTeam="false"
                    />
                </div>
            </div>
            <div class="p_sharewith" :class="[{'pointer-event-none' : isSpinner === true}]">
                <div class="p__sharewith-wrapper">
                    <span class="sub-title-span pls__label d-block">{{$t('Projects.share_with')}}</span>
                    <div class="share-with-wrapperdata d-flex align-items-center justify-content-start">
                        <button type="button" class="ah-btn ah-btn--sm pls__share" @click="!item.isRestrict ? updateProjectSpace(item,'public') : ''" :class="{ 'ah-btn--outline': item.isPrivateSpace === false, 'ah-btn--secondary': item.isPrivateSpace !== false, 'pls__share--locked': !editable }">{{$t('Projects.everyone')}}</button>                    
                        <button type="button" class="ah-btn ah-btn--sm pls__share" @click="!item.isRestrict ? updateProjectSpace(item,'private') : ''" :class="{ 'ah-btn--outline': item.isPrivateSpace === true, 'ah-btn--secondary': item.isPrivateSpace !== true, 'pls__share--locked': !editable }">{{$t('Projects.private')}}</button>
                    </div>
                </div>
            </div>
            <div class="p_status" v-if="checkPermission('project.project_status_change') != null">
                <div class="p_status-wrapper">
                    <span class="sub-title-span pls__label d-block">{{$t('Templates.project_status')}}</span>
                    <ul class="pro_block d-flex align-items-center justify-content-start flex-wrap" @click="!item.isRestrict ? openEditSidebar(item,'projectStatus') : ''">
                        <li class="projectDataColorli" v-for="(statusObj,statusKey) in item.projectStatusData"
                        :key="statusKey">
                            <span class="pls__status ah-status-ink" :class="[{'cursor-pointer' : editable}]" :style="statusChipStyle({ textColor: statusObj.textColor, bgColor: statusObj.backgroundColor })">
                                {{statusObj.name}}
                            </span>
                        </li>
                    </ul>
                </div>
            </div>
            <div class="task_type_status">
                <div class="task__type-wrapper">
                    <span class="sub-title-span pls__label d-block">{{$t('Projects.task_type')}}</span>
                    <ul class="d-flex task_type_statusul" @click="!item.isRestrict ? openEditSidebar(item,'taskType') : ''">
                        <li class="projectDataColorli" v-for="(taskType,taskTypeKey) in item.taskTypeCounts" :key="taskTypeKey">
                            <div class="task_type d-flex align-items-center" :class="[{'cursor-pointer' : editable}]">
                                <TaskTypeIcon :taskType="taskType" :style="[{'height':'13.85px','width':'13.85px'}]" />
                                <span class="ml-8px" :class="[{'cursor-pointer' : editable}]">{{taskType.name}}</span>
                            </div>
                        </li>
                    </ul>
                </div>
            </div>
            <div class="task_type_status_todo" v-if="checkPermission('task.task_status') != null">
                <div class="task__typestatustodo-wrapper">
                    <span class="sub-title-span pls__label d-block">{{$t('Templates.task_status')}}</span>
                    <ul class="d-flex task_type_statusul" @click="!item.isRestrict ? openEditSidebar(item,'taskStatus') : ''">
                        <li class="cursor_pointer projectDataColorli" v-for="(statusObj,statusKey) in item.taskStatusData" :key="statusKey">
                            <span class="pls__status ah-status-ink" :style="statusChipStyle(statusObj)" :class="[{'cursor-pointer' : editable}]">
                                {{statusObj.name}}
                            </span>
                        </li>
                    </ul>
                </div>
            </div>
            <div class="p_erpApp">
                <div class="p__erpApp-wrapper">
                    <span class="sub-title-span pls__label d-block">{{$t('Templates.apps')}}</span>
                    <ProjectAppsList
                        v-if="appref.length > 0"
                        class="pls__apps"
                        :apps="appref"
                        :modelValue="processedApps"
                        :disabled="!!item.isRestrict || !editable || settingPermission !== true || projectDetailPremission !== true"
                        @toggle="(key) => updateApp(item, { key })"
                    />
                    <ul class="d-flex" v-else>
                        <li class="projectDataColorli pls__none">
                            {{ $t('Apps.none') }}
                        </li>
                    </ul>
                </div>
            </div>
            <div class="p_requiredViews">
                <div class="p__requiredViews-wrapper">
                    <span class="sub-title-span pls__label d-block">{{$t('Projects.required_view')}}</span>
                    <ul class="d-flex flex-wrap" v-if="requireComp && requireComp.length > 0" >
                        <li class="pro_block cursor_pointer projectDataColorli" :class="[{'cursor-pointer' : editable}]" v-for="(requireObj,requireKey) in requireComp" :key="requireKey">
                            <span v-if="item.ProjectRequiredComponent?.filter((x) => x.keyName === requireObj.keyName).length > 0" class="ah-mask-icon erp_app def_req is-on mr-10px" :style="maskOf(projectComponentsIcons(requireObj.keyName).activeIcon)" role="img"
                            @click="!item.isRestrict ? (item.ProjectRequiredComponent.length > 1 ? updateTabs(item,requireObj,'unRead'):null) : ''" :title="requireObj.name || $t('Projects.not_available')" :aria-label="requireObj.name || $t('Projects.not_available')"></span>
                            <span v-else class="ah-mask-icon erp_app tab_req mr-10px" :style="maskOf(projectComponentsIcons(requireObj.keyName).icon)" role="img" @click="!item.isRestrict ? updateTabs(item,requireObj,'read') : ''" :title="requireObj.name || $t('Projects.not_available')" :aria-label="requireObj.name || $t('Projects.not_available')"></span>
                        </li>
                    </ul>
                    <ul class="d-flex" v-else>
                        <li class="projectDataColorli pls__none">
                            {{ $t('Projects.not_available') }}
                        </li>
                    </ul>
                </div>
            </div>
        </div>
        <ConfirmationSidebar
            v-if="confirming"
            v-model="showSidebar"
            :title="$t(confirming.title)"
            :message="$t(confirming.message)"
            :confirmationString="pending"
            :acceptButtonClass="confirming.danger ? 'btn-danger' : 'btn-primary'"
            :acceptButton="$t(confirming.title)"
            @confirm="run(pending)"
        />
    </div>
    <ProjectSettingSidebar v-if="openSidebarInProject" :sidebarTitle="sidebarTitle" :projectData="item" :openSidebarInProject="openSidebarInProject" @isSidebarProjectSetting="openSidebarInProject = false" />
</template>

<script setup>
import { defineProps, inject, computed, ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useProjects } from '@/composable/projects';
import { useFavourites } from '@/composable/favourites';
import Assignee from "@/components/molecules/Assignee/Assignee.vue";
import ProjectSettingSidebar from '@/components/atom/ProjectSettingSidebar/ProjectSettingSidebar.vue'
import { useStore } from 'vuex';
import { useToast } from 'vue-toast-notification';
import DropDown from '@/components/molecules/DropDown/DropDown.vue'
import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue'
const companyId = inject('$companyId');
import { useCustomComposable } from "@/composable";
import WasabiImage from "@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue";
import TaskTypeIcon from "@/components/atom/TaskTypeIcon/TaskTypeIcon.vue";
import { projectComponentsIcons } from '@/composable/commonFunction';
import { statusChipStyle } from '@/utils/statusChipColors';
import { maskOf } from '@/utils/iconMask';
import ProjectAppsList from "@/components/molecules/ProjectAppsList/ProjectAppsList.vue";
import { apiRequest } from "@/services";
import * as env from '@/config/env';
import ConfirmationSidebar from "@/components/molecules/ConfirmationSidebar/ConfirmationSidebar.vue"
import { useI18n } from "vue-i18n";
import { lifecycleOf, reopenStatusOf, ACTIVE, ARCHIVED, CLOSED } from "@/utils/lifecycle";
const { t } = useI18n();

const props = defineProps({
    item: {
        type: Object,
        default: () => ({})
    }
});

const ACTIONS = {
    close: { label: 'Projects.close_project', permission: 'project.project_close' },
    reopen: { label: 'Projects.reopen_project', permission: 'project.project_close' },
    archive: { label: 'Projects.archive_project', permission: 'project.project_delete' },
    restore: { label: 'Projects.restore_project', permission: 'project.project_delete' },
    delete: { label: 'Projects.delete_project', permission: 'project.project_delete' },
};
const MENU_BY_STATE = {
    [ACTIVE]: ['close', 'archive'],
    [CLOSED]: ['reopen', 'archive'],
    [ARCHIVED]: ['restore', 'delete'],
};
const CONFIRMS = {
    close: { title: 'Projects.close', message: 'conformationmsg.archive0mesg', danger: true },
    archive: { title: 'Projects.archive', message: 'conformationmsg.archive_project', danger: false },
    delete: { title: 'Projects.delete', message: 'conformationmsg.delete', danger: true },
};
const { isFavourite: isStarred, toggleFavourite } = useFavourites();
const {getters,commit} = useStore();
const {checkPermission} = useCustomComposable();
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

const state = computed(() => lifecycleOf(props.item, 'project'));
const editable = computed(() => state.value === ACTIVE);
const canOpen = computed(() => props.item.statusType !== 'close');
const showsClosedChip = computed(() => state.value === ARCHIVED && props.item.statusType === 'close');
const menu = computed(() => {
    if (settingPermission.value !== true || projectDetailPremission.value !== true) return [];
    return (MENU_BY_STATE[state.value] || [])
        .filter((key) => checkPermission(ACTIONS[key].permission, props.item.isGlobalPermission) === true)
        .map((key) => ({ key, label: ACTIONS[key].label }));
});
const pending = ref('');
const confirming = computed(() => CONFIRMS[pending.value] || null);

function redirectProjectList (data) {
    router.push({ name: 'Project', params: {cid: companyId.value, id: data._id}});
}
function updateFavourite(projectData) {
    if(settingPermission.value !== true || projectDetailPremission.value !== true){
        return;
    }
    if(!editable.value){
        return;
    }
    toggleFavourite({ type: 'project', id: String(projectData._id), name: projectData.ProjectName || '' });
}
const changeAssignee = async (type, user,projectData) => {
    try {
        if(!editable.value){
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
        if(!editable.value){
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
        if(!editable.value){
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
const data = async () => {
    const response = await apiRequest("get", env.PROJECTS_APPS);
    appref.value = response.data?.data || [];
};

onMounted(()=>{
    data();
})

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
        if(!editable.value){
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
        if(!editable.value){
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

function updateFor(action, project) {
    if (action === 'close') {
        const status = project.projectStatusData.find((x) => x.type === "close");
        return status ? { status: status.value, statusType: status.type } : null;
    }
    if (action === 'reopen') {
        const status = reopenStatusOf(project);
        return status ? { status: status.value, statusType: status.type } : null;
    }
    return { deletedStatusKey: { archive: 2, restore: 0, delete: 1 }[action] };
}

function choose(action) {
    if (CONFIRMS[action]) {
        pending.value = action;
        showSidebar.value = true;
        return;
    }
    run(action);
}

/* The server moves the project's tasks with it (Project/helpers/projectLifecycle). */
async function run(action) {
    const project = props.item;
    const updateObject = updateFor(action, project);
    showSidebar.value = false;
    if (!updateObject) return;
    try {
        await apiRequest("put",`/api/v1/${env.PROJECTACTIONS}/${project._id}`,{updateObject});
        commit('projectData/projectLocalUpdate', {itemData: {...project,...updateObject},projectId:project._id,key:'RemoveProject',subKey: '',userId: ''});
        if (action === 'delete') commit('projectData/mutateProjects', [{ op: "modified", data: { ...project, ...updateObject } }]);
        $toast.success(t(action === 'delete' ? 'Toast.Deleted_successfully' : 'Toast.Updated_successfully'),{position: 'top-right'});
    } catch (error) {
        $toast.error(t('Toast.something_went_wrong'),{position: 'top-right'});
        console.error(`ERROR in ${action} project: `, error);
    }
}

async function updateProjectType (projectObj,isPrivate) {
    try {
        let type = isPrivate === true ? 'private' : 'public';
        if(checkSpecificTypeCount(type) === true){
            await apiRequest("put",`/api/v1/${env.PROJECTACTIONS}/${projectObj._id}`,{updateObject: {isPrivateSpace: isPrivate}})
            $toast.success(t('Toast.Updated_successfully'),{position: 'top-right'});
            commit('projectData/projectLocalUpdate', {itemData:{...projectObj,isPrivateSpace: isPrivate},projectId:projectObj._id,key:'ProjectTypeChange',subKey:"",userId: ''});
        }
        else{
            isSpinner.value = false;
            $toast.error(t('Toast.Upgrade_Your_Plan'),{position: 'top-right'})
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