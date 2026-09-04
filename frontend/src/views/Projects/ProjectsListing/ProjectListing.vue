<template>
    <ProjectListComponent
        v-if="clientWidth && clientWidth > 1300 && checkPermission('project.project_list',projectData.isGlobalPermission) !== null"
        :loadedProjects="loadedProjects"
        :filterFavorites="filterFavorites"
        :projectData="projectData"
        :loadingData="loadingData"
        :showArchivedProjects="showArchivedProjects"
        :ProjectfilterObject="ProjectfilterObject"
        v-model:loader="loader"
        :isSpinner="isSpinner"
        :expandedId="expandedId"
        :sprintFolders="sprintFolders"
        :isProjectFilterApplied="isProjectFilterApplied"
        :isSearchAPIWait="isSearchAPIWait"
        :mutateCurrentProjectDetails="mutateCurrentProjectDetails"
        @update:showArchivedProjects="$emit('update:showArchivedProjects', $event)"
        @update:filterFavorites="$emit('update:filterFavorites', $event)"
        @changeAvatar="$emit('changeAvatar', $event)"
        @createProject="$emit('createProject', $event)"
        @createAiProject="$emit('createAiProject', $event)"
        @loadMoreProjects="loadMoreProjects"
        @projectDataClick="projectDataClick()"
        @close="visible = false"
        @applyFilter="(query, sortByField, sortByOrder) => applyFilter(query, sortByField, sortByOrder)"
        @clearFilter="clearFilter($event)"
        @update:search="handleSearchUpdate"
        @updateSearchProject="handleSearchUpdateProject"
    />
    <Sidebar v-else v-model:visible="visible" className="z-index-6" title="Projects" :left="true" width="400px" :unMount="false" :hide-header="true" :closeOnBackDrop="true">
        <template #body>
            <ProjectListComponent
                :loadedProjects="loadedProjects"
                :filterFavorites="filterFavorites"
                :projectData="projectData"
                :loadingData="loadingData"
                :showArchivedProjects="showArchivedProjects"
                :ProjectfilterObject="ProjectfilterObject"
                v-model:loader="loader"
                :isSpinner="isSpinner"
                :expandedId="expandedId"
                :sprintFolders="sprintFolders"
                :isProjectFilterApplied="isProjectFilterApplied"
                :isSearchAPIWait="isSearchAPIWait"
                :mutateCurrentProjectDetails="mutateCurrentProjectDetails"
                @update:showArchivedProjects="$emit('update:showArchivedProjects', $event)"
                @update:filterFavorites="$emit('update:filterFavorites', $event)"
                @changeAvatar="$emit('changeAvatar', $event)"
                @createProject="$emit('createProject', $event)"
        @createAiProject="$emit('createAiProject', $event)"
                @projectDataClick="projectDataClick()"
                @loadMoreProjects="loadMoreProjects"
                @close="visible = false"
                @applyFilter="(query, sortByField, sortByOrder) => applyFilter(query, sortByField, sortByOrder)"
                @clearFilter="clearFilter($event)"
                @handleSidebarClose="handleSidebarClose()"
                @update:search="handleSearchUpdate"
                @updateSearchProject="handleSearchUpdateProject"
            />
        </template>
    </Sidebar>
</template>

<script setup>
// PACKAGES
import { computed, ref, defineEmits, defineProps, onMounted, watch, inject, nextTick } from 'vue';
import { useStore } from 'vuex';

// COMPONENTS
import { useCustomComposable } from '@/composable';
import { useRoute, useRouter } from 'vue-router';
import ProjectListComponent from '@/components/molecules/ProjectListComponent/ProjectListComponent.vue'
import Sidebar from "@/components/molecules/Sidebar/Sidebar.vue"
import { useProjectsHelper } from '../helper';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { useToast } from 'vue-toast-notification';
// Same pairing the sibling helpers use (views/Projects/helper.js, Header/helper.js):
// the i18n global, not useI18n(), so it works outside a setup-scoped component too.
import { i18n } from '@/locales/main';


// UTILS
const {getters, commit, dispatch} = useStore();
const {projects, filterdProjects, projectListFilters} = useProjectsHelper();
const searchProject = computed(()=> getters['projectData/searchedProjects'])
const {checkPermission} = useCustomComposable()
const $toast = useToast();
const t = i18n.global.t;
const router = useRouter();
let route = useRoute();
const userId = inject("$userId");
const companyId = inject("$companyId");
const clientWidth = inject("$clientWidth");

const ProjectfilterObject = ref( {
    query:{},
    sortByField:{},
    sortByOrder:{}
}); 

// EMITS
const emit = defineEmits(["update:projectData", "update:sprints", "change", "close", "update:showArchivedProjects", "update:filterFavorites", 'changeAvatar', 'createProject', 'createAiProject','isSpinner','sprintsFoldersData', 'update:sprintLoading']);

// PROPS
const props = defineProps({
    showArchivedProjects: {
        type: Boolean,
        required: true,
        default: false
    },
    loadingProjects: {
        type: Boolean,
        required: true,
        default: false
    },
    filterFavorites: {
        type: Boolean,
        default: false
    },
    projectData: {
        type: Object,
        required: true
    }
})


const search = ref("");

const loader = ref(props.loadingProjects);
const projectSearch = ref(true);
const folderSearch = ref(false);
const sprintSearch = ref(false);
const loadingData = ref({});
const companyUserDetail = computed(() => getters["settings/companyUserDetail"]);
// UPDATE PROJECTS VALUE ON DATABSE SNAP
// const projects = ref([]);
const isSpinner = ref(false);
const sprintData = ref([])
const folderData = ref({})
const sprintFolders = ref({})
const expandedId = ref('')
const itemsPerPage = ref(30);
const loadedProjects = ref([]);
const updateRenderList = ref(true);
const isProjectFilterApplied = ref(false);
const isSidebarClose = ref(false);
const visible = ref(false)
const isSearchAPIWait = ref(false);

watch(projects, () => {
    // UPDATE SELECTED PROJECT
    if(projects.value && projects.value.length) {
        if(props.projectData && !Object.keys(props.projectData).length) {
            if(route.params && route.params.id) {
                const projectIndex = projects.value.findIndex((item) => item._id === route.params.id);
                const routed = projectIndex !== -1 ? projects.value[projectIndex] : storeProject(route.params.id);
                if(routed) {
                    mutateCurrentProjectDetails(routed);
                } else {
                    reportUnreachableRouteProject();
                    mutateCurrentProjectDetails(projects.value[0], true);
                }
            } else {
                mutateCurrentProjectDetails(projects.value[0], true);
            }
        } else {
            const projIndex = projects.value.findIndex((item) => item._id === props.projectData._id);
            if(projIndex !== -1) {
                mutateCurrentProjectDetails({...projects.value[projIndex]});
            } else {
                mutateCurrentProjectDetails({...projects.value[0]}, true);
            }
        }
    }
},{deep: true})

watch(() => getters["projectData/sprints"],(sprintfold) => {
    if(route.params?.id && JSON.stringify(sprintData.value) !== JSON.stringify(sprintfold[props.projectData._id] || [])){
        sprintData.value = sprintfold[props.projectData._id];
        getSprintFolderData(props.projectData._id,true);
    }
})

watch(() => getters["projectData/folders"],(folder) => {
    if(route.params?.id && JSON.stringify(folderData.value) !== JSON.stringify(folder[props.projectData._id] || [])){
        folderData.value = folder[props.projectData._id];
        getSprintFolderData(props.projectData._id,true);
    }
})

watch(() => props.loadingProjects, (newVal, oldVal) => {
    if(newVal !== oldVal) {
        if(newVal) {
            loader.value = true;
        } else {
            setTimeout(() => {
                loader.value = false;
            }, 1000)
        }
    }
})

watch(() => route.params,(newVal, oldVal) => {
    if(newVal.id !== oldVal.id){
        sprintData.value = getters["projectData/sprints"][route.params.id];
        folderData.value = getters["projectData/folders"][route.params.id];
    }
})

// MUTATE CURRENT PROJECT DETAILS
/**
 * The URL named a project that is not in this user's list.
 *
 * That happens when the project was deleted (deletedStatusKey 1 — the list endpoint
 * excludes those) or is one this user cannot see. The caller still falls back to the
 * first project and rewrites the address bar to match, which on its own is silent: the
 * user asked for project X, got project Y, and the URL agrees with Y. Deep links from
 * the dashboard's milestone card, a notification or a bookmark all landed this way and
 * looked like they had opened what was clicked. Say so instead.
 */
// The sidebar list only carries projects whose sprints have loaded, so a
// project created seconds ago is absent from it while the store already has it.
function storeProject(id) {
    if (!id) return null;
    const known = getters["projectData/projects"];
    const list = Array.isArray(known) ? known : (known?.data || []);
    const item = list.find((x) => String(x._id || x.id) === String(id));
    return item ? { ...item, _id: item._id || item.id } : null;
}

function reportUnreachableRouteProject() {
    $toast.info(t('Toast.The_project_not_found'), { position: 'top-right' });
}

function mutateCurrentProjectDetails(data, updateRoute = false,isClicked = false) {
    if(!projects?.value?.length) return;
    if (expandedId.value === data._id && isClicked) {
        expandedId.value = ''
    } else {
        expandedId.value = data._id;
    }

    let tab = route.query?.tab;
    if(!data?.ProjectRequiredComponent?.find((x) => x.keyName === route.query?.tab)) {
        let viewFind = data?.ProjectRequiredComponent?.find((e) => e.setAsDefault) || data?.ProjectRequiredComponent?.find((e) => e.viewStatus) || data?.ProjectRequiredComponent[0];
        tab = viewFind ? viewFind?.keyName :"ProjectListView";
    }

    if(updateRoute) {
        router.push({
            name: "Project",
            params: {
                cid: companyId.value,
                id: data._id
            },
            query: {
                ...route.query,
                tab: tab
            }
        })
    }
    let project = projects.value.find((item) => item._id === data._id);
    if (search.value === '' || projectSearch.value || (isProjectFilterApplied.value && search.value !== '' && projectSearch.value === false)) {
        project = projects.value.find((item) => item._id === data._id);
    } else {
        project = searchProject.value.find((item) => item._id === data._id);
    }
    
    
    if (search.value === '' || projectSearch.value || (isProjectFilterApplied.value && search.value !== '' && projectSearch.value === false)) {
        let sprints = [...(project?.sprintsObj && Object.values(project?.sprintsObj).length ? Object.values(project.sprintsObj) : [])];

        project.sprintsfolders && Object.values(project.sprintsfolders).forEach((item) => {
            sprints = [...sprints, ...(item?.sprintsObj && Object.values(item?.sprintsObj).length ? Object.values(item.sprintsObj) : [])];
        })
        
        commit("projectData/mutateCurrentProjectDetails", project);
    }

    emit('update:projectData', project);
}

watch(() => props.projectData,(newVal, oldVal) => {
    if(newVal._id !== oldVal._id){
        getSprintFolderData(newVal._id ? newVal._id : oldVal._id);
        return;
    }
})

watch(filterdProjects, (newVal,oldVal) => {
    if(JSON.stringify(newVal) !== JSON.stringify(oldVal)){
        if(newVal.length && isProjectFilterApplied.value) {
            emit('update:isFilterHasData', false);
            updateRenderList.value = true;
            mutateCurrentProjectDetails({...newVal[0]}, true);
        } else {
            if(isProjectFilterApplied.value) {
                emit('update:isFilterHasData', true);
            }
        }
        if (updateRenderList.value) {
            loadedProjects.value = [];
            loadMoreProjects();
        } else {
            updateRenderList.value = true;
        }
    }
},{deep: true});

// ON MOUNTED
onMounted(async() => {
    sprintData.value = getters["projectData/sprints"][route.params.id];
    folderData.value = getters["projectData/folders"][route.params.id];
    if(projects.value && Object.keys(projects.value).length) {
        if(props.projectData && !Object.keys(props.projectData).length) {
            // Open the project the URL asks for — same rule the `projects` watcher
            // above already applies.
            //
            // Which of the two runs depends on whether the list is warm, and
            // `projectsList` is a module-level ref (views/Projects/helper.js) so it
            // survives every route change. A cold load leaves it empty here and the
            // watcher decides; ANY client-side navigation — a milestone card link, a
            // notification — arrives with it already full, so this branch decides
            // instead. It used to take projects[0] unconditionally and, with
            // updateRoute=true, rewrite the address bar to match, so every deep link
            // silently opened the first project and looked like it had been asked for.
            //
            // updateRoute stays true ONLY for the fallback: when the URL already names
            // the project there is nothing to correct, and re-pushing would drop the
            // caller's `tab` query (mutateCurrentProjectDetails swaps any tab that is
            // not one of the project's own views — which is what `tab=ProjectDetail` is).
            const routeIndex = route.params?.id
                ? projects.value.findIndex((item) => item._id === route.params.id)
                : -1;
            const routed = routeIndex !== -1 ? projects.value[routeIndex] : storeProject(route.params?.id);
            const target = routed || projects.value[0];
            if(route.params?.id && !routed) reportUnreachableRouteProject();
            mutateCurrentProjectDetails(target, !routed);
            if(target?.isGlobalPermission === false) {
                getSprintFolderData(target?._id);
            }
        } else {
            const projIndex = projects.value.findIndex((item) => item._id === props.projectData._id);
            if(projIndex !== -1) {
                mutateCurrentProjectDetails(projects.value[projIndex]);
                if(projects.value[projIndex]?.isGlobalPermission === false) {
                    getSprintFolderData(projects.value[projIndex]?._id);
                }
            }
        }
    }
    loadMoreProjects();
})

const loadMoreProjects = () => {
  const start = loadedProjects.value.length;
  const end = start + itemsPerPage.value;

  if (start < filterdProjects.value.length) {
    let newProjects = filterdProjects.value.slice(start, end);
    const finalProject = newProjects.map((x)=>{
        return {
            projectIcon: x.projectIcon,
            ProjectName: x.ProjectName,
            id: x.id,
            isGlobalPermission:x.isGlobalPermission,
            deletedStatusKey:x.deletedStatusKey,
            projectStatusData:x.projectStatusData,
            status: x.status,
            isPrivateSpace: x.isPrivateSpace,
            _id: x._id,
            isRestrict:x.isRestrict,
            createdAt:x.createdAt,
            lastProjectActivity:x.lastProjectActivity,
            userId:x.userId,
            sprintsfolders:x.sprintsfolders,
            sprintsObj:x.sprintsObj,
            favouriteTasks:x.favouriteTasks,
            userActivity:x.userActivity,
            ProjectRequiredComponent: x.ProjectRequiredComponent,
            sprintData: x.sprintData
        }
    })
    loadedProjects.value = [...loadedProjects.value, ...finalProject];
  }
};



function getSprintData(id, forceRefresh = false) {
    return new Promise((resolve, reject) => {
        try {
            if(!forceRefresh && Object.keys(getters["projectData/sprints"]).includes(id)){
                if(!sprintData.value || !Object.keys(sprintData.value || {}).length){
                    sprintData.value = getters["projectData/sprints"][id];
                }
                resolve(sprintData.value,true);
                return;
            }
            let projectId = id;
            // const uid = companyUserDetail.value.userId;
            // let publicQuery = {
            //     private:false,
            //     projectId : BSON.ObjectId(projectId)
            // }
        
            // let snapPublicQuery = {
            //     "fullDocument.private" : false,
            //     "fullDocument.projectId" : BSON.ObjectId(projectId)
            // }
            // let privateQuery = {
            //     private:true,
            //     projectId : BSON.ObjectId(projectId)
            // }
        
            // let snapPrivateQuery = {
            //     "fullDocument.private" : true,
            //     "fullDocument.projectId" : BSON.ObjectId(projectId)
            // }
            // if(companyUserDetail.value.roleType !== 1 && companyUserDetail.value.roleType !== 2) {
            //     privateQuery.AssigneeUserId = {
            //         $in:[uid]
            //     }
            //     snapPrivateQuery['fullDocument.AssigneeUserId'] = {$in:[uid]}
            // }
            dispatch("projectData/setSprints",{projectId}).then((sprintss) => {
                sprintData.value = sprintss;
                resolve(sprintss);
            }).catch(() => {
            })
        } catch (error) {
            reject(error);
        }
    })
}

function getFolderData(id) {
    return new Promise((resolve, reject) => {
        try {
            if(Object.keys(getters["projectData/folders"]).includes(id)){
                if(!folderData.value || Object.keys(folderData.value || {}).length === 0){
                    folderData.value = getters["projectData/folders"][id];
                }
                resolve(folderData.value,true);
                return;
            }
            let projectId = id;
            // const uid = companyUserDetail.value.userId;
            // let publicQuery = {
            //     private:false,
            //     projectId : BSON.ObjectId(projectId)
            // }
        
            // let snapPublicQuery = {
            //     "fullDocument.projectId" : BSON.ObjectId(projectId)
            // }
            // let privateQuery = {
            //     projectId : BSON.ObjectId(projectId)
            // }
        
            // let snapPrivateQuery = {
            //     "fullDocument.projectId" : BSON.ObjectId(projectId)
            // }
            dispatch("projectData/setFolders",{projectId}).then((folders) => {
                folderData.value = folders;
                resolve(folders);
            })
        } catch (error) {
            reject(error);
        }
    })
}

const getSprintFolderData = async (id,isUpdate = false, forceRefresh = false) => {
    try {
        if(!isUpdate){
            loadingData.value[id] = true;
            emit('update:sprintLoading', true);
        }
        if (search.value === '' || projectSearch.value) {
            await Promise.allSettled([getSprintData(id, forceRefresh), getFolderData(id)])
            .then((results) => {
                const resolvedPromises = results.filter((result) => result.status === 'fulfilled');
                if (resolvedPromises.length === 2) {
                    const [sprintsResult, foldersResult] = resolvedPromises.map((result) => result.value);
                    const sprintsArray = sprintsResult?.filter(sprint => sprint.projectId === id && !sprint.folderId).map((x) => ({ ...x, id:x._id }));

                    const foldersObject = foldersResult?.reduce((acc, folder) => {
                        if (folder.projectId === id) {
                            let folId = folder._id
                            acc[folId] = {
                                folderId: folId,
                                name: folder.name,
                                sprintsObj: {},
                                deletedStatusKey: folder.deletedStatusKey,
                                legacyId : folder?.legacyId ? folder?.legacyId : '',
                                id: folder._id,
                                _id: folder._id,
                            };
                        }
                        return acc;
                    }, {});

                    sprintsResult?.forEach(sprint => {
                        if (sprint.projectId === id && sprint.folderId && foldersObject[sprint.folderId]) {
                            sprint.folderName = foldersObject[sprint.folderId].name;
                            sprint.id = sprint._id;
                            foldersObject[sprint.folderId].sprintsObj[sprint.id] = sprint;
                        }
                    });
                    sprintFolders.value[id] = {}
                    sprintFolders.value = {
                        [id]: {
                            folders: foldersObject,
                            sprints: sprintsArray,
                        }
                    };

                    let project = projects.value.find((item) => item._id === id);
                    let allSprints = sprintFolders.value !== undefined && sprintFolders.value && sprintFolders.value[id] ? sprintFolders.value[id]?.sprints : []
                    allSprints = [...allSprints];

                    let allFolders = sprintFolders.value && sprintFolders.value[id] ? sprintFolders.value[id]?.folders : {}
                    allFolders = {...(project?.sprintsfolders && Object.keys(project?.sprintsfolders).length ? project?.sprintsfolders || {} : {}), ...allFolders}

                    const sprintIdToObject = {};
                    allSprints.forEach(item => {sprintIdToObject[item.id] = item;});

                    project.sprintsObj = sprintIdToObject;
                    project.sprintsfolders = allFolders;
                    var newObj = {snap: null, privateSnap: false, userId: userId.value,roleType: companyUserDetail.value.roleType, op: "modified", data: {...project}};
                    commit("projectData/mutateProjects",[newObj]);
                    if (search.value !== '' && projectSearch.value || search.value !== '' && (isProjectFilterApplied.value && search.value !== '' && projectSearch.value === false)) {
                        commit("projectData/mutateExistingSearchedProjects",project);
                    }
                    nextTick(() => {
                        loadingData.value[id] = false;
                        emit('update:sprintLoading', false);
                        if(isSidebarClose.value === true){
                            emit('handleSidebarClose');
                        }
                    })
                } else {
                    loadingData.value[id] = false;
                    emit('update:sprintLoading', false);
                    console.error("One or more promises were rejected");
                    if(isSidebarClose.value === true){
                        emit('handleSidebarClose');
                    }
                }
            })
            .catch((error) => {
                loadingData.value[id] = false;
                emit('update:sprintLoading', false);
                console.error("Error in Promise.allSettled", error);
                if(isSidebarClose.value === true){
                    emit('handleSidebarClose');
                }
            });
        } else {
            loadingData.value[id] = false
            emit('update:sprintLoading', false);
            if(isSidebarClose.value === true){
                emit('handleSidebarClose');
            }
        }
    } catch (error) {
        console.error("ERROR", error);
        emit('update:sprintLoading', false);
        if(isSidebarClose.value === true){
            emit('handleSidebarClose');
        }
    }
}

watch(sprintFolders,(sp) => {
    sprintFolders.value = sp;
})

const projectDataClick = () => {
    updateRenderList.value = false;
}

const applyFilter = (query, sortByField, sortByOrder) => {
    isSearchAPIWait.value = true;
    loader.value = true;
    isProjectFilterApplied.value = false;
    emit('update:isAdvanceFilterApplied', false);
    ProjectfilterObject.value = {
        query:query,
        sortByField:sortByField,
        sortByOrder:sortByOrder
    }
    let obj = {
        type: "projectFilter",
        query: query,
        sortByField: sortByField,
        sortByOrder: sortByOrder,
        fields: '_id',
        showArchived: props.showArchivedProjects
    }
    if (search.value) {
        let typeName;
        if (projectSearch.value) {
            typeName = "projectFilter_projectName"
        } else if (folderSearch.value) {
            typeName = "projectFilter_folder"
        } else if (sprintSearch.value) {
            typeName = "projectFilter_sprint"
        }
        obj.type = typeName,
        obj.search = search.value
    }
    apiRequest("post", `${env.PROJECTSEARCH}`, obj).then((serachedData)=>{
        isSearchAPIWait.value = false;
        isProjectFilterApplied.value = true;
        emit('update:isAdvanceFilterApplied', true);
        commit("projectData/mutateSearchedProjects", { data: serachedData?.data || [], searchType: "projectFilter" });
    }).catch((error)=>{
        console.error(error)
        isSearchAPIWait.value = false;
        loader.value = false;
    })
}

const clearFilter = () => {
    if(!isProjectFilterApplied.value) {
        return;
    }

    loader.value = true;
    updateRenderList.value = true;
    isProjectFilterApplied.value = false;
    emit('update:isFilterHasData', false);
    emit('update:isAdvanceFilterApplied', false);
    let isProjectFilterAppliedValue = isProjectFilterApplied.value
    ProjectfilterObject.value = {
        query:{},
        sortByField:{},
        sortByOrder:{}
    }

    if (search.value) {
        projectListFilters({
            projectSearch,
            folderSearch,
            sprintSearch,
            filterFavorites: props.filterFavorites,
            search:search.value,
            showArchivedProjects: props.showArchivedProjects,
            isSearchUpdate:true,
            isProjectFilterAppliedValue,
            ProjectfilterObject:ProjectfilterObject.value
        })
        .catch((error) => {
            console.error("ERROR", error)
        })
    }
}

function toggleSidebar(value) {
    visible.value = value;
}

const handleSidebarClose = (val) => {
    if(val === 'project'){
        isSidebarClose.value = true;
    }else {
        visible.value = false;
        emit('handleSidebarClose');
    }
};

function handleSearchUpdate(newSearchValue) {
    search.value = newSearchValue;
}

function handleSearchUpdateProject (searchValues) {
    projectSearch.value = searchValues.projectSearch;
    folderSearch.value = searchValues.folderSearch;
    sprintSearch.value = searchValues.sprintSearch;
}
// `mutateCurrentProjectDetails` is exposed so the AI Project Creator's
// post-create handler in Projects.vue can replay the exact same flow a
// user clicking a project in the sidebar triggers — commit-to-Vuex,
// route push with the right tab query, and `update:projectData` emit
// so the parent's watchers load sprints / tasks.
defineExpose({toggleSidebar, mutateCurrentProjectDetails, getSprintFolderData})
</script>

<style>
@import "./style.css";
</style>