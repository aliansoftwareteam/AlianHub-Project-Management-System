<template>
    <div class="sprint position-re" :id="`sprint_${sprint?._id}_${cardUID}`">
        <!-- FOLDER NAME LEGEND -->
        <div
            v-if="sprint"
            class="cursor-default black position-ab bg-white border border-radius-5-px text-capitalize color52 p0x-10px sprint__foldername"
        >
            {{sprint.projectName}} {{sprint.folderName ? `/ ${sprint.folderName}` : '' }}
        </div>

        <div class="sprint_name TaskName d-flex justify-content-between align-items-center flex-wrap"  :class="{'mb-20px': sprint.isExpanded , 'flex-column align-items-start' : containerWidth<=512}" >
            <div @click="sprint.deletedStatusKey === 0 || sprint.deletedStatusKey === undefined ? $emit('change',sprint?._id,sprint.projectId) : ''" :class="containerWidth <= 767 ? `mw-100 w-100 justify-content-between ${containerWidth <= 480 ? '' : 'd-flex align-items-center'}` : 'd-flex align-items-center'">
                <div>
                    <div class="d-flex align-items-center mw-100">
                        <img v-if="sprint.deletedStatusKey === 0 || sprint.deletedStatusKey === undefined" :src="triangleBlack" alt="traingle" :style="`transform: rotateZ(${sprint.isExpanded ? 90 : 0}deg); width: 6px;`" class="cursor-pointer">
                        <img v-if="sprint.deletedStatusKey === 2" :src="inventory_2" class="pr-10px" />
                        <img v-if="sprint.isFolder === true" :src="folder">
                        <span class="text-ellipse font-weight-bold text-capitalize ml-10px cursor-pointer font-size-14 color52" :title="sprint.name">{{ sprint.name }}</span>
                    </div>
                </div>
            </div>
        </div>
        <Transition>
            <div v-if="sprint.isExpanded">
                <div v-if="isSpinner">
                    <Skelaton v-for="i in 5" :key="i" class="border-radius-5-px skelaton__option m-5px border-bottom"/>
                </div>
                <span v-if="isError" class="red">{{$t('Toast.something_went_wrong')}}</span>
                <div class="itemSprintWrapper style-scroll-6-px" id="tasklist_driver">
                    <TaskItemList
                        v-for="(item,index) in sprint.items"
                        :statusIndex="index"
                        :key="item.key"
                        :item="item"
                        :sprintId="sprint?._id"
                        :projectId="sprint.projectId"
                        :groupType="groupType"
                        :commonDateFormatForDate="commonDateFormatForDate"
                        @toggle="item.isExpanded = !item.isExpanded"
                        :project="project"
                        :sprintObject="sprint"
                        :filteredProjects="filteredProjects"
                        :searchTaskData="searchTaskData"
                        :cardData="cardData"
                    />
                </div>
            </div>
        </Transition>

        <ConfirmationSidebar
            v-model="showSidebar"
            :title="`${close ? $t('Projects.close') : archive ? $t('Projects.archive') : $t('Projects.delete')}`"
            :message="close ? $t('conformationmsg.sprintclosemsg') : archive ? $t('conformationmsg.archive') : $t('conformationmsg.delete')"
            :confirmationString="`${close ? 'close' : archive ? 'archive' : 'delete'}`"
            :acceptButtonClass="archive && !close ? 'btn-primary': 'btn-danger'"
            :acceptButton="`${close ? $t('Projects.close') : archive ? $t('Projects.archive') : $t('Projects.delete')}`"
            @confirm="updateItem()"
            :showSpinner="showSpinner"
            @selected="changeAssignee('add', $event.id)"
            @removed="changeAssignee('remove', $event.id)"
        />
        <SpinnerComp :is-spinner="isCreateSpinner" />
    </div>
</template>

<script setup>
// PACKAGES
import { computed, defineComponent, defineEmits, defineProps, inject, onMounted, ref, watch,provide} from 'vue';
import { useGetterFunctions } from '@/composable';
import { useToast } from 'vue-toast-notification';

// COMPONENTS
import TaskItemList from '../TaskItemList/TaskItemList.vue';
import ConfirmationSidebar from "@/components/molecules/ConfirmationSidebar/ConfirmationSidebar.vue"
import Skelaton from "@/components/atom/Skelaton/AiSkelaton.vue"
import SpinnerComp from '@/components/atom/SpinnerComp/SpinnerComp'
import * as env from '@/config/env';
import { useStore } from 'vuex';
import { useRoute } from 'vue-router';
import { apiRequest } from '../../../../../services/index'
import { useI18n } from "vue-i18n";
const { t } = useI18n();

// UTILS
const projectArray = inject("taskListProjects");
const containerWidth = inject("$containerWidth");
const companyId = inject("$companyId");
const userId = inject("$userId");
const modalStartDate = ref(null);
const modalEndDate = ref(null);
const initialDate = ref(0);
const $toast = useToast();
const {getters, commit} = useStore();
const route = useRoute()
const {getUser} = useGetterFunctions()

// IMAGES
const triangleBlack = require('@/assets/images/svg/triangleBlack.svg');
const folder = require('@/assets/images/folder.png');
const inventory_2 = require('@/assets/images/inventory_2.png');
defineComponent({
    name: "SprintsList",
    
    components: {
        TaskItemList,
        ConfirmationSidebar
    }
})

defineEmits(['change']);

const props = defineProps({
    sprint: Object,
    groupType: Number,
    commonDateFormatForDate: String,
    calendarDate: Number,
    filteredProjects: {
        type: Array,
        default: () => []
    },
    searchTaskData: {
        type: Array,
        default: () => {}
    },
    cardUID : {
        type: String,
        default: ""
    },
    cardData: {
        type: Array,
        default: () => []
    }
})

watch(route, () => {
    if (createTask.value) {
        createTask.value = false;
        modalStartDate.value = null;
        modalEndDate.value = null;
    }
})
const companyUsers = computed(() => {
    return getters["settings/companyUsers"]?.map((x) => x.userId)
})

const project = computed(() => {
    return projectArray.filter((x) => (props.sprint.isExpanded && x._id === props.sprint.projectId))[0] || {};
})
provide('selectedProject',project);

const companyOwnerId = computed(() => getters["settings/companyOwnerDetail"]?.userId)
const createTask = ref(false);
const assigneeInProgress = ref(false);
const showSpinner = ref(false);
const archive = ref(false);
const close = ref(false);
const showSidebar = ref(false);
const watcherUsers = ref([]);
const isSpinner = ref(false);
const isCreateSpinner = ref(false);
const isError = ref(false);


watch(props.sprint, (val) => {
    if(val.isExpanded === false && createTask.value === true) {
        createTask.value = false;
    }
})
watch([() => props.calendarDate], (data) => {
    if (data && data.length) {
        const selectedDate = data[0];
        if (selectedDate) {
            initialDate.value = new Date(selectedDate).getTime()
        } else {
            initialDate.value = new Date().getTime()
        }
    } else {
        initialDate.value = new Date().getTime()
    }
})
function getUserData() {
    const user = getUser(userId.value);
    const userData = {
        id: user._id,
        Employee_Name: user.Employee_Name,
        companyOwnerId: user.companyOwnerId,
    }

    return userData;
}

function updateItem(value = null) {
    showSpinner.value = true;

    let obj = {};
    let updatedValue = '';
    if(props.sprint.isFolder) {
        obj.$set = {deletedStatusKey: value !== null ? value : archive.value ? 2 : 1}
        updatedValue = value !== null ? value : archive.value ? 2 : 1
    } else {
        obj.$set = {deletedStatusKey: value !== null ? value : close.value ? 5 : archive.value ? 2 : 1};
        updatedValue = value !== null ? value : close.value ? 5 : archive.value ? 2 : 1
    }

    const userData = getUserData();

    const axiosData = {
        type: !props.sprint.isFolder ? "updateSprint" : "updateFolder",
        companyId: companyId.value,
        projectId: project.value._id,
        folderId: props.sprint.isFolder ? props.sprint.folderId : props.sprint._id,
        updateObject: {
            ...obj
        },
        updatedValueDeleteStatusKey: updatedValue,
        userData,
        sprintName: !props.sprint.isFolder ? props.sprint.name : null,
        projectData: {
            id: project.value._id,
            ProjectName: project.value.ProjectName
        },
        folderName: props.sprint.isFolder ? props.sprint?.name : "",
    }

    if (props.sprint.isFolder) {
        axiosData.sprints = Object.values(props.sprint.archivedSprintList).filter((x) => !x.deletedStatusKey || x.deletedStatusKey === 6)?.map((x) => x.id)
    }
    let reqUrl = env.SPRINT+"/"+props.sprint._id;
    if (props.sprint.isFolder) {
        reqUrl = env.FOLDER+"/"+props.sprint._id;
    }
    apiRequest("patch", reqUrl, axiosData)
    .then((res) => {
        // A refusal arrives as HTTP 200 with status:false. Committing its empty
        // `data` blanks the row in the store, and the success toast below would
        // then report the opposite of what happened.
        if (res?.data?.status === false) {
            close.value = false;
            showSidebar.value = false;
            showSpinner.value = false;
            $toast.error(res?.data?.statusText || t(`Toast.something_went_wrong`), {position: "top-right"});
            return;
        }
        if (props.sprint.isFolder) {
            commit("projectData/mutateFolders",{op:'modified',data:{...res?.data?.data}});
        }
        else{
            commit("projectData/mutateSprints",{op:'modified',data:{...res?.data?.data}});
        }
        $toast.success(t(`Toast.${props.sprint.isFolder ? 'Folder' : 'Sprint'} ${value !== null ? 'restored' : close.value ? 'closed' : archive.value ? 'archived' : 'deleted'} successfully`), {position: "top-right"})
        showSidebar.value = false;
        showSpinner.value = false;
        close.value = false;
    })
    .catch((error) => {
        close.value = false;
        showSidebar.value = false;
        showSpinner.value = false;
        $toast.error(t(`Toast.something_went_wrong`), {position: "top-right"});
        console.error("ERROR in updateItem: ", error);
    })
}

// CHANGE ASSIGNEE OF PRIVATE SPRINTS
function changeAssignee(type, uid) {
    if(assigneeInProgress.value) return;
    assigneeInProgress.value = true;

    let updateData = {};
    if(type === "add") {
        if(!props.sprint?.AssigneeUserId?.includes(uid)) {
            updateData.$addToSet = {
                'AssigneeUserId': uid,
                'watchers': uid
            }
        }
    } else {
        if(props.sprint?.AssigneeUserId?.includes(uid)) {
            updateData.$pull = {
                AssigneeUserId: uid,
                watchers: uid
            }

            if(props.sprint?.AssigneeUserId?.length === 1) {
                updateData.$set = {
                    private: false
                }
            }
        }
    }
    let obj = {
        type : type === 'add' ? 'added' : 'removed',
        userName : getUser(uid)?.Employee_Name
    }

    updateSprintAPICALL(updateData,obj)
}
// CALL SPRINT UPDATE
function updateSprintAPICALL(updateData = null,historyObj) {
    if(updateData) {
        try {
            const userData = getUserData();
            apiRequest("patch", `${env.SPRINT}/${props.sprint?.id ? props.sprint?.id : props.sprint?._id}`, {
                companyId: companyId.value,
                projectId: project.value._id,
                folderId: props.sprint?.folderId || null,
                type: "updateSprint",
                updateObject: updateData,
                userData,
                sprintName: !props.sprint.isFolder ? props.sprint.name : null,
                projectData: {
                    id: project.value._id,
                    ProjectName: project.value.ProjectName
                },
                folderName: props.sprint.isFolder ? props.sprint?.folderName : "",
                historyData : historyObj
            })
            .then((resp) => {
                if(resp.data.status) {
                    commit('projectData/mutateSprints', {op: "modified", data: resp.data.data});
                    // let historyObj = {
                    //     message: `<b>${userData.Employee_Name}</b> has ${type} <b>${props.sprint.name}</b> sprint ${props.sprint?.folderId === null ? '' : `in <b>${props.sprint.isFolder ? props.sprint?.folderName : ""}</b> folder`} in <b>${project.value.ProjectName}</b> project.`,
                    //     key: "project_sprint_removed",
                    //     sprintId: props.sprint._id,
                    // }
                    // apiRequest("post", env.HANDLE_HISTORY, {
                    //     "type": 'project',
                    //     "companyId": companyId.value,
                    //     "projectId": props.projectData._id,
                    //     "taskId": null,
                    //     "object": historyObj,
                    //     "userData": userData
                    // })
                    $toast.success(t(`Toast.Sprint updated successfully`), {position: "top-right"})
                }
                assigneeInProgress.value = false;
            })
            .catch((error) => {
                console.error('ERROR in update Sprint: ', error);
                $toast.error(t(`Toast.something_went_wrong`), {position: "top-right"})
                assigneeInProgress.value = false;
            })
        } catch (error) {
            $toast.error(t(`Toast.something_went_wrong`), {position: "top-right"})
            console.error('ERROR in update Sprint: ', error);
            assigneeInProgress.value = false;
        }
    } else {
        assigneeInProgress.value = false;
    }
}

// WATCHERS
onMounted(() => {
    handleWatcherList();
})
function handleWatcherList() {
    watcherUsers.value = [];
    let allUsers = JSON.parse(JSON.stringify(project.value?.isPrivateSpace ? !props.sprint?.private ? (project.value?.AssigneeUserId || []) : (props.sprint?.AssigneeUserId || []) : companyUsers.value));

    if(!allUsers.includes(companyOwnerId.value)) {
        allUsers.push(companyOwnerId.value);
    }

    if(props.sprint?.watchers?.length) {
        props.sprint.watchers.forEach(element => {
            if (!getUser(element).ghostUser) {
                watcherUsers.value.push({
                    ...getUser(element),
                    isWatcher: true,
                    isLoggedUser: element === userId.value
                });
            }
        });
    } else {
        if (!getUser(userId.value).ghostUser) {     
            watcherUsers.value = [{
                ...getUser(userId.value),
                isWatcher: false,
                isLoggedUser: true
            }];
        }
    }

    allUsers.forEach((uid) => {
        if(!watcherUsers.value.filter((x) => x.id === uid).length) {
            if (!getUser(uid).ghostUser) {  
                watcherUsers.value.push({
                    ...getUser(uid),
                    isWatcher: false,
                    isLoggedUser: true
                });
            }
        }
    })
}
watch(() => props.sprint?.watchers, () => {
    handleWatcherList();
})


</script>
<style src="./style.css"></style>