<template>
    <div class="project-item-wrapper project-Subitem-wrapper position-re">
        <div
            class="hover-bg-light-purple-v1 project-item border-radius-5-px cursor-pointer ml-016"
            :class="[{
                'bg-light-purple-v1' : (folder && $route.params.folderId === data.folderId && !$route.params.sprintId) || (!folder && $route.params.sprintId === (data.id ? data.id : data._id)),
                'bg-light-purple-v2' : (folder && $route.params.folderId === data.folderId && $route.params.sprintId),
            }]"
        >
            <div class="position-ab drop__arrow-div">
                <img @click.stop="$emit('change', data)" v-if="sprints && sprints.length && (sprints.filter(e=>(showArchived ? e.deletedStatusKey == 2 : !e.deletedStatusKey))).length && !data.deletedStatusKey" src="@/assets/images/svg/triangleBlack.svg" alt="" :style="`transform: rotateZ(${isExpanded ? '90' : '0'}deg)`">
            </div>
            <a class="item-left text-decoration-none" :href="sprintHref" @click="onSprintClick">
                <Spinner v-if="!folder" :isSpinner="spinner" class="position-re list-spinner"/>
                <div class="text-ellipsis">
                    <img v-if="data.deletedStatusKey !== undefined && data.deletedStatusKey === 2" :src="inventoryIcon" alt="inventoryIcon">
                    <img v-else-if="data.deletedStatusKey !== undefined && data.deletedStatusKey === 1" :src="deleteIcon" alt="deleteIcon">
                    <img v-if="folder" :src="folderIcon" alt="folderIcon" class="ml-6px">
                    <span v-else>
                        <img v-if="!isShowArchived" @click.stop="markFavourite()" :src="favourite ? filledStar : blankStar" alt="favourite star" class="ml-6px">
                    </span>

                    <span class="text-ellipsis project-sb-desc ml-6px" :title="data.name">
                       {{data.name}}
                    </span>
                </div>
            </a>
            <div class="item-right">
                <template v-if="!isOpened">
                    <span v-if="!folder && !isShowArchived" class="gray sptint-total" :class="{'font-size-13': clientWidth > 767, 'font-size-16': clientWidth <= 767}">{{showArchived ? (data.archiveTaskCount || 0) : ((data.tasks < 0 ? 0 : data.tasks) || 0)}}</span>
                    <div class="count-block secondary-count-block child-count-block ml-6px" v-if="folder && data?.sprintsObj && Object.keys(data?.sprintsObj).length && showCounts({project, key: 'folder', sprints: Object.values(data?.sprintsObj), showArchived}).count" :style="({project, key: 'folder', sprints: Object.values(data?.sprintsObj), showArchived}).styles ">
                        {{showCounts({project, key: 'folder', sprints: Object.values(data?.sprintsObj), showArchived}).count > 99 ? "+99" : showCounts({project, key: 'folder', sprints: Object.values(data?.sprintsObj), showArchived}).count}}
                    </div>
                    <div class="count-block secondary-count-block child-count-block ml-6px" v-else-if="!folder && showCounts({project, key: 'sprint', sprints: [data], showArchived}).count" :style="({project, key: 'sprint', sprints: [data], showArchived}).styles">
                        {{showCounts({project, key: 'sprint', sprints: [data], showArchived}).count > 99 ? "+99" : showCounts({project, key: 'sprint', sprints: [data], showArchived}).count}}
                    </div>
                </template>
                <DropDown :id="itemId" @isVisible="(val)=> isOpened = val" :title="folder? data.name : data.name" v-if="
                    (
                        (folder && checkPermission('project.project_sprint_create',project.isGlobalPermission) === true)
                        || (folder && checkPermission('project.project_folder_name_edit',project.isGlobalPermission) === true)
                        || (!folder && checkPermission('project.project_sprint_name_edit',project.isGlobalPermission) === true)
                        || (folder && checkPermission('project.folder_delete',project.isGlobalPermission) === true)
                        || (!folder && checkPermission('project.sprint_delete',project.isGlobalPermission) === true)
                        || (folder && checkPermission('project.folder_restore',project.isGlobalPermission) === true && showArchived)
                        || (!folder && checkPermission('project.sprint_restore',project.isGlobalPermission) === true && showArchived)
                        || (folder && checkPermission('project.folder_archive',project.isGlobalPermission) === true && !showArchived)
                        || (!folder && checkPermission('project.sprint_archive',project.isGlobalPermission) === true && !showArchived)
                    ) && checkPermission('project.project_list',project.isGlobalPermission) === true
                    && (showArchived ? data.deletedStatusKey === 2 : !data.deletedStatusKey)
                ">
                    <template #button>
                        <img src="@/assets/images/svg/horizontalDots.svg" alt="dots" class="project__three-dot ml-6px vertical-middle"  :class="{'project-option': clientWidth > 767 && !isOpened, 'project-option-mobile': clientWidth <= 767}" :ref="itemId">
                    </template>

                    <template #options>
                        <template v-if="!showArchived">
                            <DropDownOption v-if="folder && checkPermission('project.project_sprint_create',project.isGlobalPermission) === true" @click="createSprint = true, $refs[itemId]?.click(), $emit('change', {...data, isNewClicked: true })">
                                <div class="d-flex align-items-center project-mobile-desc">
                                    <img :src="listIcon" alt="listIcon" class="mr-10px">
                                    {{$t('Projects.create_new_list')}}
                                </div>
                            </DropDownOption>
                            <DropDownOption v-if="folder ? checkPermission('project.project_folder_name_edit',project.isGlobalPermission) === true : checkPermission('project.project_sprint_name_edit',project.isGlobalPermission) === true" @click="$refs[itemId]?.click(), rename()">
                                <div class="d-flex align-items-center project-mobile-desc">
                                    <img :src="editIcon" alt="editIcon" class="mr-10px">
                                    {{$t('Projects.rename')}}
                                </div>
                            </DropDownOption>
                            <DropDownOption v-if="(folder ? checkPermission('project.folder_archive',project.isGlobalPermission) === true : checkPermission('project.sprint_archive',project.isGlobalPermission) === true) && !showArchived" @click="$refs[itemId]?.click(), showSidebar = true, archive = true">
                                <div class="d-flex align-items-center project-mobile-desc">
                                    <img :src="inventoryIcon" alt="inventoryIcon" class="mr-10px">
                                    {{$t('Projects.archive')}}
                                </div>
                            </DropDownOption>
                            <DropDownOption v-if="!folder && folderList.length" @click="$refs[itemId]?.click(), showMoveToFolder = true">
                                <div class="d-flex align-items-center project-mobile-desc">
                                    <img :src="folderIcon" alt="folderIcon" class="mr-10px" style="width: 16px;">
                                    {{$t('Projects.move_to_folder')}}
                                </div>
                            </DropDownOption>

                        </template>
                        <DropDownOption v-if="(folder ? checkPermission('project.folder_restore',project.isGlobalPermission) === true : checkPermission('project.sprint_restore',project.isGlobalPermission) === true) && showArchived == true" @click="$refs[itemId]?.click(), updateItem(0)">
                            <div class="d-flex align-items-center project-mobile-desc">
                                <img :src="inventoryIcon" alt="restoreInventoryIcon" class="mr-10px">
                                {{$t('Projects.restore')}}
                            </div>
                        </DropDownOption>
                        <DropDownOption v-if="(folder ? checkPermission('project.folder_delete',project.isGlobalPermission) === true : checkPermission('project.sprint_delete',project.isGlobalPermission) === true) && checkPermission('project.project_list',project.isGlobalPermission) === true" @click="$refs[itemId]?.click(), showSidebar = true, archive = false">
                            <div class="d-flex align-items-center project-mobile-desc mobile-deleteIcon red">
                                <img :src="deleteIcon" alt="deleteIcon" class="mr-10px">
                                {{$t('Projects.delete')}}
                            </div>
                        </DropDownOption>
                    </template>
                </DropDown>
            </div>
            <div>
                <ImportTaskButton 
                    ref="importTaskRef"
                    :showImportModal="showImportModal"
                    :projectId="project?._id"
                    :taskStatus="project?.taskStatusData"
                    :users="project?.isPrivateSpace ? (project?.AssigneeUserId || []) : (companyUsers || [])"
                    :sprint="sprint"
                    @toggle-import-modal="showImportModal = false"
                />
            </div>
        </div>
        <div v-if="createSprint || renameFolder || renameSprint" class="d-flex align-items-center create__rename-sprintwrapper m3px-auto">
            <SprintFolderInput
                :createSprint="createSprint || renameSprint"
                :createFolder="renameFolder"
                :folder="folder ? {folderId: data.folderId, folderName: data.name} : data.folderId ? {folderId: data.folderId, folderName: data.folderName} : null"
                :item="renameFolder || renameSprint ? data : null"
                :subItems="folder && !renameFolder ? [...(Object.values(data?.sprintsObj || {}))] : subItems"
                @cancel="createSprint = false, renameFolder = false, renameSprint=false"
            />
        </div>
        <div v-if="isExpanded && sprints?.length" class="pl-10px">
            <template v-for="subItem in sprints">
                <SubItem
                    v-if="showArchived ? (subItem.deletedStatusKey === 2 || subItem.archiveTaskCount) : (!subItem.deletedStatusKey)"
                    :key="subItem.id"
                    :data="subItem"
                    :projectId="projectId"
                    :subItems="[...(sprints || [])]"
                    :isShowArchived="isShowArchived"
                    @change="toggleSubItem($event)"
                    @changeProject="$emit('changeProject')"
                    @handleSidebarClose="emit('handleSidebarClose')"
                />
            </template>
        </div>

        <ConfirmationSidebar
            v-model="showSidebar"
            :title="`${archive ? $t('Projects.archive') : $t('Projects.delete')}`"
            :message="archive ? $t('conformationmsg.archive') : $t('conformationmsg.delete')"
            :confirmationString="`${archive ? 'archive' : 'delete'}`"
            :acceptButtonClass="archive ? 'btn-primary': 'btn-danger'"
            :acceptButton="`${archive ? $t('Projects.archive') : $t('Projects.delete')}`"
            @confirm="updateItem()"
            :showSpinner="showSpinner"
        />
        <MoveToFolderModal
            v-model="showMoveToFolder"
            :folders="folderList"
            :currentFolderId="data.folderId"
            @select="moveToFolder"
        />
    </div>
</template>

<script setup>
// PACKAGES
import { computed, defineComponent, defineEmits, defineProps, inject, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useCustomComposable, useGetterFunctions } from '@/composable';
import { useStore } from 'vuex';
import { useToast } from 'vue-toast-notification';

// COMPONENTS
import SubItem from './SubItem'
import DropDown from '@/components/molecules/DropDown/DropDown.vue'
import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue'
import SprintFolderInput from '@/components/atom/SprintFolderInput/SprintFolderInput.vue'
import ConfirmationSidebar from "@/components/molecules/ConfirmationSidebar/ConfirmationSidebar.vue"
import MoveToFolderModal from "@/components/molecules/MoveToFolder/MoveToFolderModal.vue"
import Spinner from "@/components/atom/SpinnerComp/SpinnerComp.vue"
import { apiRequest } from '../../../services';
import * as env from '@/config/env';
import { useI18n } from "vue-i18n";
import { firstId, injectedId, taskOpenRoute } from '@/utils/taskOpenProjectId';
const { t } = useI18n();

// UTILS
const $toast = useToast();
const router = useRouter();
const route = useRoute();
const userId = inject("$userId");
const {showCounts, checkPermission} = useCustomComposable();
const companyId = inject("$companyId");
const {getUser} = useGetterFunctions()
const {getters,commit} = useStore();
const clientWidth = inject("$clientWidth");
const showArchived = inject("showArchivedProjects");
const isOpened = ref(false)


// IMAGES
const inventoryIcon = require("@/assets/images/svg/inventoryIcon.svg");
const deleteIcon = require("@/assets/images/svg/deleteIcon.svg");
const listIcon = require("@/assets/images/svg/listView.svg");
const folderIcon = require("@/assets/images/folder.png");
const editIcon = require("@/assets/images/svg/rename.svg");
const filledStar = require("@/assets/images/svg/start10.svg");
const blankStar = require("@/assets/images/svg/blankStar.svg");

defineComponent({
    name: "sub-item",

    components: {
        SubItem,
        DropDown,
        DropDownOption,
        SprintFolderInput,
        ConfirmationSidebar,
        MoveToFolderModal,
    }
})

const emit = defineEmits(['change', 'changeProject',"updateFolderAndSprint","handleSidebarClose"]);

const props = defineProps({
    data: {
        type: Object,
        required: true
    },
    folder: {
        type: Boolean,
        default: false
    },
    filterFavorites: {
        type: Boolean,
        default: false
    },
    isExpanded: {
        type: Boolean,
        default: false
    },
    subItems: {
        type: Array,
        default: () => []
    },
    isShowArchived: {
        type: Boolean,
        default: false
    },
    projectId: {
        type: [String, Object],
        default: ''
    }
})

const companyUsers = computed(() => {
    return getters["settings/companyUsers"]?.map((x) => x.userId)
})


const sprints = computed(() => {
    let tmp = {};
    if(props.filterFavorites) {
        const favourites = (props?.data?.archivedSprintList || props?.data?.sprintsObj) ? Object.values(props?.data?.archivedSprintList ? props?.data?.archivedSprintList : props?.data?.sprintsObj).filter(x => x.favouriteTasks?.length && x.favouriteTasks.filter((y) => y.userId === userId.value).length).sort((a,b) => a?.createdAt?.seconds > b?.createdAt?.seconds ? -1 : 1) : []
        const others = (props?.data?.archivedSprintList || props?.data?.sprintsObj) ? Object.values(props?.data?.archivedSprintList ? props?.data?.archivedSprintList : props?.data?.sprintsObj).filter(x => !x.favouriteTasks?.length || !x.favouriteTasks.filter((y) => y.userId === userId.value).length).sort((a,b) => a?.createdAt?.seconds > b?.createdAt?.seconds ? -1 : 1) : []
        let arr = [...favourites, ...others]
        arr.forEach((sprint) => {
            tmp[sprint.id] = sprint;
        })
        return Object.values(tmp);
    } else {
        return Object.values(props?.data?.archivedSprintList ? props?.data?.archivedSprintList : props?.data?.sprintsObj || []);
    }
});

const itemId = computed(() => {
    return props.folder ? props.data.folderId : props.data.id;
})

const sprint = computed(() => {
    return props.data;
})

const showImportModal = ref(false);
const spinner = ref(false);
const archive = ref(false);
const showSpinner = ref(false);
const showSidebar = ref(false);
const createSprint = ref(false);
const renameFolder = ref(false);
const renameSprint = ref(false);
const showMoveToFolder = ref(false);
const project = inject("selectedProject");

// LIST OF FOLDERS A SPRINT CAN BE MOVED INTO (excludes deleted folders + the current item's own id)
const folderList = computed(() => {
    return Object.values(project.value?.sprintsfolders || {})
        .filter((f) => !f?.deletedStatusKey && (f?.folderId || f?._id) !== (props.data?.id || props.data?._id))
        .map((f) => ({ id: f.folderId || f._id, name: f.name || f.folderName || '' }));
})
const favourite = computed(() => {
    return props.data?.favouriteTasks && props.data.favouriteTasks.length && props.data.favouriteTasks.filter((x) => userId.value && x.userId === userId.value).length;
})

const companyOwner = computed(() => getters["settings/companyOwnerDetail"])
function getUserData() {
    const user = getUser(userId.value);
    const userData = {
        id: user.id,
        Employee_Name: user.Employee_Name,
        companyOwnerId: companyOwner.value.userId,
    }

    return userData;
}

function companyIdNow() {
    return firstId(
        injectedId(companyId),
        route.params && route.params.cid,
        typeof localStorage !== 'undefined' && localStorage.getItem('selectedCompany'),
    );
}

function sprintDest() {
    let tab = route.query?.tab;
    if(!project.value?.ProjectRequiredComponent?.find((x) => x.keyName === route.query?.tab)) {
        let viewFind = project.value?.ProjectRequiredComponent?.find((e) => e.setAsDefault) || project.value?.ProjectRequiredComponent?.find((e) => e.viewStatus) || project.value?.ProjectRequiredComponent[0];
        tab = viewFind ? viewFind?.keyName :"ProjectListView";
    }
    const dest = taskOpenRoute({
        companyId: companyIdNow(),
        projectId: firstId(props.projectId, project.value && project.value._id, props.data.projectId, route.params.id),
        sprintId: props.data.sprintsObj ? '' : firstId(props.data.id, props.data._id),
        folderId: props.data.folderId,
    });
    return { dest, tab };
}

const sprintHref = computed(() => {
    const { dest, tab } = sprintDest();
    if (!dest) return '';
    return router.resolve({ ...dest, query: { ...route.query, tab } }).href;
});

function onSprintClick(event) {
    emit('changeProject');
    const { dest, tab } = sprintDest();
    if (!dest) return;
    if (event && (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button === 1)) return;
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
    router.push({ ...dest, query: { ...route.query, tab } }).catch((error) => {
        console.error('ERROR opening sprint: ', error);
        if (sprintHref.value) window.location.hash = sprintHref.value.replace(/^#/, '');
    });
    emit('handleSidebarClose');
}

function toggleSubItem(data) {
    Object.keys(data.sprintsObj).forEach((key) => {
        if(data.sprintsObj[key].id === data.id) {
            data.sprintsObj[key].isExpanded = !data.sprintsObj[key].isExpanded;
        } else {
            data.sprintsObj[key].isExpanded = false;
        }
    })
}

function rename() {
    if(props.folder) {
        renameFolder.value = true;
        renameSprint.value = false;
    } else {
        renameFolder.value = false;
        renameSprint.value = true;
    }
}

function updateItem(value = null) {
    showSpinner.value = true;

    let obj = {};
    let updatedValue = '';
    if(props.folder) {
        obj.$set = { deletedStatusKey: value !== null ? value : archive.value ? 2 : 1}
        updatedValue = value !== null ? value : archive.value ? 2 : 1
    } else {
        obj.$set = {deletedStatusKey: value !== null ? value : archive.value ? 2 : 1};
        updatedValue = value !== null ? value : archive.value ? 2 : 1
    }

    const userData = getUserData();

    const axiosData = {
        type: !props.folder ? "updateSprint" : "updateFolder",
        companyId: companyId.value,
        projectId: project.value._id,
        folderId: props.data.folderId || null,
        updateObject: {
            ...obj
        },
        updatedValueDeleteStatusKey: updatedValue,
        userData,
        sprintName: !props.folder ? props.data.name : null,
        projectData: {
            id: project.value._id,
            ProjectName: project.value.ProjectName
        },
        folderName: props.data.name,
    }

    if(!props.folder && props.item?.folderId) {
        axiosData.folderName = props.item.folderName
    }
    
    if(props.folder) {
        axiosData.sprints = sprints.value?.filter((x) => !x.deletedStatusKey || x.deletedStatusKey === 6)?.map((x) => x.id)
    }
    // Keyed on `props.folder` — is this row ITSELF a folder — the same signal
    // `type` and `itemId` above already use. It previously keyed on
    // `props.data.folderId`, which asks a different question: is this row INSIDE
    // a folder. The two agree for a folder and for a loose sprint, and disagree
    // for a sprint nested in a folder, which was sent as `updateSprint` to the
    // folder route. That combination is not on the folder route's whitelist, so
    // archiving a nested sprint failed with "Invalid type".
    let reqUrl = env.SPRINT+'/'+itemId.value;
    if (props.folder) {
        reqUrl = env.FOLDER+'/'+itemId.value;
    }
    apiRequest("patch", reqUrl, axiosData)
    .then((res) => {
        // A refusal arrives as HTTP 200 with status:false. Committing its empty
        // `data` blanks the row in the store, and the success toast below would
        // then report the opposite of what happened.
        if (res?.data?.status === false) {
            showSpinner.value = false;
            showSidebar.value = false;
            archive.value = false;
            $toast.error(res?.data?.statusText || t(`Toast.something_went_wrong`), {position: "top-right"});
            return;
        }
        if (props.folder) {
            commit("projectData/mutateFolders",{op:'modified',data:{...res?.data?.data}});
        }
        else{
            commit("projectData/mutateSprints",{op:'modified',data:{...res?.data?.data}});
        }
        if (res?.data?.data) {
            let type;
            if (props.folder) {
                type = 'Folder';
            } else {
                type = 'Sprint';
            }
            emit("updateFolderAndSprint",res?.data?.data,type);
        }
        $toast.success(t(`Toast.${props.folder ? 'Folder' : 'Sprint'} ${value !== null ? 'restored' : archive.value ? 'archived' : 'deleted'} successfully`), {position: "top-right"})
        showSidebar.value = false;
        showSpinner.value = false;
        archive.value = false;
    })
    .catch((error) => {
        archive.value = false;
        showSidebar.value = false;
        showSpinner.value = false;
        $toast.error(t(`Toast.something_went_wrong`), {position: "top-right"})
        console.error("ERROR in updateItem: ", error);
    })
}

// RELOCATE THE SPRINT BETWEEN BUCKETS ON THE STORE, THEN RE-TRIGGER THE LIST GROUPING WATCHER
function relocateSprintLive(sprint, oldFolderId) {
    if(!sprint) return;
    const pid = sprint.projectId || project.value?._id;
    commit('projectData/relocateSprint', { data: sprint, oldFolderId: oldFolderId || null });
    // selectedProject is provided as a ref; reassigning .value re-runs the (non-deep) sprint grouping watcher in Projects.vue
    const relocated = getters['projectData/projects']?.data?.find((p) => p._id === pid);
    if(relocated) {
        project.value = relocated;
    }
}

// MOVE SPRINT INTO A FOLDER (or back to root when folder is null) — mirrors SprintsList.updateSprintAPICALL
function moveToFolder(folder) {
    // CAPTURE THE BUCKET THE SPRINT IS LEAVING (null = root) BEFORE THE PATCH MUTATES IT
    const oldFolderId = props.data?.folderId || null;
    const updateObject = {
        $set: {
            folderId: folder ? folder.id : null,
            folderName: folder ? folder.name : ''
        }
    };
    const userData = getUserData();
    apiRequest("patch", `${env.SPRINT}/${itemId.value}`, {
        companyId: companyId.value,
        projectId: project.value._id,
        folderId: props.data?.folderId || null,
        type: "updateSprint",
        updateObject,
        userData,
        sprintName: props.data.name,
        projectData: {
            id: project.value._id,
            ProjectName: project.value.ProjectName
        },
        folderName: props.data?.folderName || "",
        historyData: { type: 'moved' }
    })
    .then((res) => {
        if (res?.data?.status) {
            commit("projectData/mutateSprints", { op: 'modified', data: { ...res?.data?.data } });
            // RE-GROUP LIVE: relocate between buckets (root<->folder / folder<->folder) and re-trigger list grouping
            relocateSprintLive(res?.data?.data, oldFolderId);
            if (res?.data?.data) {
                emit("updateFolderAndSprint", res?.data?.data, 'Sprint');
            }
            $toast.success(t(`Toast.Sprint updated successfully`), { position: "top-right" });
        } else {
            $toast.error(t(`Toast.something_went_wrong`), { position: "top-right" });
        }
        showMoveToFolder.value = false;
    })
    .catch((error) => {
        showMoveToFolder.value = false;
        $toast.error(t(`Toast.something_went_wrong`), { position: "top-right" });
        console.error("ERROR in moveToFolder: ", error);
    });
}

function markFavourite() {
    spinner.value = true;
    const userData = getUserData();
    const isFavouriteOutsideFolder = (sprintId) => {
        if(props.subItems && props.subItems.length){
            let data = props.subItems.find((e)=> (e?._id ? e?._id : e?.id) === sprintId);
            return data?.favouriteTasks?.some((x) => x.userId === userId.value);
        }else{
            return null;
        }
    };

    const fav = isFavouriteOutsideFolder(props.data?.id ? props.data?.id : props.data?._id);
    const key = fav ? "$pull" : "$addToSet";
    apiRequest("put", `/api/v1/${env.PROJECTSPRINTUPDATE}/${props.data?.id ? props.data?.id : props.data?._id}`, {updateObject: { favouriteTasks: { userId: userId.value } },key: key}).then((results) => {
        spinner.value = false;
        emit("updateFolderAndSprint",results?.data,'Sprint');
        $toast.success(t(`Toast.${!favourite.value ? "Added_to_favourite" : "Removed_from_favourite"}`), {position: "top-right"});

        // Call history API
        const axiosData = {
            "type": "project",
            "companyId": companyId.value,
            "projectId": project.value._id,
            "taskId": null,
            "object": {
                "sprintId": props.data.id,
                "key": "Create_Sprint",
                "message": `<b>${userData.Employee_Name}</b> has set <b>${props.data.name}</b> sprint as favorite in <b>${project.value.ProjectName}</b> project.`
            },
            "userData": userData
        };
        apiRequest("post", env.HANDLE_HISTORY, axiosData).then((result) => {
            if(result.data.status) {
                console.info(result.data.statusText)
            }
        });
    }).catch((error)=>{
        console.error(error)
    })

}
</script>

<style>
.list-spinner .spinner {
    width: 10px !important;
    height: 10px !important;
    left: -5px;
}
.create__rename-sprintwrapper{
    padding: 0px 10px 0px 32px;
}
.drop__arrow-div{
    min-width: 10px;
    left: 10px;
}
</style>