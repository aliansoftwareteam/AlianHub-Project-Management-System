<template>
    <div class="project-list bg-white" id="project_sidebar_container">
        <div class="position-sti bg-white z-index-6 project__list-sticky">
        <div class="searchBox px-010rem blue cursor-default border-bottom-serach" id="projectrightside_driver" v-if="!showArchivedProjects">
            <img v-if="clientWidth <= 1300" :src="sidebarArrowIcon" alt="sidebarArrowIcon" class="cursor-pointer mr-1" @click="$emit('close')">
            <div class="form-control d-flex">
                <input type="text" v-model="search" :placeholder="$t('PlaceHolder.search')" ref="projectSearchInput" id="projectrightsidesearch_driver" class="serach-inputbox webkit-avilable ml-0" @input="updateSearch">

                <div class="d-flex align-items-center">
                    <DropDown id="project_filter_options" class="project_filter_options" title="Project search filter">
                        <template #button>
                            <img :src="horizontalDots" alt="horizontalDots" class="vertical-middle" id="projectrightsidedropdown_driver">
                        </template>
                        <template #options>
                            <DropDownOption @click="setProjectSearch">
                                <span class="project-mobile-desc mr-10px">{{ $t('ProjectSlider.project_name') }}</span>
                                <Toggle :modelValue="projectSearch" :disabled="projectSearch" @click="setProjectSearch" class="filter-toggle" width="20"
                                />
                            </DropDownOption>
                            <DropDownOption @click="setFolderSearch">
                                <span class="project-mobile-desc mr-10px">{{ $t('ProjectSlider.folder_name') }}</span>
                                <Toggle :modelValue="folderSearch" :disabled="folderSearch" @click="setFolderSearch" class="filter-toggle" width="20" />
                            </DropDownOption>
                            <DropDownOption @click="setSprintSearch">
                                <span class="project-mobile-desc mr-10px">{{ $t('ProjectSlider.sprint_name') }}</span>
                                <Toggle :modelValue="sprintSearch" :disabled="sprintSearch" @click="setSprintSearch" class="filter-toggle" width="20" />
                            </DropDownOption>
                        </template>
                    </DropDown>
                </div>
            </div>
            <ProjectFilter :projectData="projectData" @apply="applyFilter" @clear="$emit('clearFilter')" v-if="Object.keys(projectData).length > 0"/>
        </div>
        <div class="searchBox px-010rem blue border-bottom-serach cursor-pointer hideArchived_text" id="projectrightside_driver" v-else>
            <div class="d-flex align-items-center">
                <img v-if="clientWidth <= 1300" :src="sidebarArrowIcon" alt="sidebarArrowIcon" class="cursor-pointer mr-1" @click="$emit('close')">
                <div class="black">{{$t('ProjectSlider.archived_list')}}</div>
            </div>
            <div @click="$emit('update:showArchivedProjects', false)">{{$t('ProjectSlider.hide_archive')}}</div>
        </div>
        <div class="bg-white position-sti d-flex align-items-center justify-content-between assignee__drop-wrapper" style="height: 36px; padding: 0 10px;" v-if="!showArchivedProjects">
            <div class="d-flex align-items-center">
                <img id="projestleftlistfilter_driver" :src="filterFavorites ? starImage : blankStar" alt="starImage" class="cursor-pointer fillstar__image" @click="emit('update:filterFavorites', !filterFavorites)" v-show="!search && ProjectfilterObject?.query && !Object.keys(ProjectfilterObject?.query).length && !Object.keys(ProjectfilterObject?.sortByField).length && !Object.keys(ProjectfilterObject?.sortByOrder).length"/>
            </div>
            <div class="d-flex align-items-center">
                <DropDown>
                    <template #button>
                        <img ref="project_show_hide" :src="settingIcon" alt="settingIcon" class="cursor-pointer vertical-middle" id="projectleftsidsetting_driver"/>
                    </template>
                    <template #options>
                        <DropDownOption @click="$refs.project_show_hide.click(), $emit('update:showArchivedProjects', true)">
                            {{$t('ProjectSlider.show_archive')}}
                        </DropDownOption>
                    </template>
                </DropDown>
                <DropDown v-if="!showArchivedProjects && checkPermission('project.project_list',projectData.isGlobalPermission) === true && checkPermission('project.project_create',projectData.isGlobalPermission) === true" class="project__new-dropdown">
                    <template #button>
                        <button ref="new_project_menu" class="ml-1 project__new-btn" id="createproject_driver" :title="$t('ProjectSlider.new_project')">+ New <span class="project__new-caret">▾</span></button>
                    </template>
                    <template #options>
                        <DropDownOption @click="$refs.new_project_menu.click(), tourTest('isProjectTour'), $emit('createProject')">
                            <span>Blank project</span>
                        </DropDownOption>
                        <DropDownOption v-if="currentCompany?.planFeature?.aiPermission" class="aipg-trigger" id="createAiProject_driver" @click="$refs.new_project_menu.click(), $emit('createAiProject')">
                            <span>Create with AI</span>
                        </DropDownOption>
                    </template>
                </DropDown>
            </div>
        </div>
        </div>
        <!-- <div :class="[{'showArchived_space' : showArchivedProjects}]"> -->
            <template v-if="!loader && !isSpinner">
                <template v-if="filterdProjects?.length">
                    <VirtualScroller
                        :items="filterdProjects"
                        :activeId="projectData._id"
                        style="height: calc(100% - 104px);"
                        :JumpToActiveInitial="true"
                        ref="virtualScroller"
                    >
                        <template #default="{item}">
                            <Item
                                v-model:expands="expands"
                                :key="item._id"
                                :item="item"
                                :filterFavorites="filterFavorites"
                                :selected="projectData !== null && projectData._id === item._id"
                                @subItemToggle="$refs.virtualScroller.reCaclulate()"
                                @toggle="(data) => {mutateCurrentProjectDetails(data,true,true);$emit('projectDataClick'); $refs.virtualScroller.reCaclulate(), expands.project = expandedId}"
                                @change="(data) => {(projectData !== null && projectData._id === item._id ? mutateCurrentProjectDetails(data, true) : mutateCurrentProjectDetails(data,true));$emit('projectDataClick')}"
                                @changeAvatar="$emit('changeAvatar', $event)"
                                @projectAction="projectAction"
                                :loadingData="loadingData[item._id]"
                                :sprintData="(search === '' || projectSearch || (isProjectFilterApplied && search !== '' && !projectSearch)) ? sprintFolders: (item.sprintData || {})"
                                :isExpanded="item._id === expandedId || (search !== '' && (folderSearch || sprintSearch))"
                                @handleSidebarClose="$emit('handleSidebarClose')"
                                :isShowArchived="showArchivedProjects"
                            />
                        </template>
                    </VirtualScroller>
                </template>
                <template v-else>
                    <!-- Left as it was: the main panel already shows a full empty state and the
                         "+ New" button sits directly above this, so explaining it a third time in
                         the sidebar is noise. -->
                    <div class="text-center mt-1">
                        <h3 class="m-0">
                            {{!search?.length ? (isSpinner === false && projects.length == 0 ? $t('ProjectSlider.no_project_found') : $t('ProjectSlider.no_result_found')) : $t('ProjectSlider.no_result_found')}}
                        </h3>
                        <p v-if="search?.length" class="font-size-14 mt-10px">{{$t('ProjectSlider.try_using_diff')}}</p>
                    </div>
                </template>
            </template>
            <template v-else>
                <div v-for="i in 2" :key="i">
                    <div class="d-flex flex-column align-items-end">
                        <Skelaton class="border-radius-5-px mr-5px my-2px h-35px w-95"/>
                        <Skelaton class="border-radius-5-px mr-5px my-2px h-35px w-90"/>
                        <Skelaton class="border-radius-5-px mr-5px my-2px h-35px w-85"/>
                        <Skelaton class="border-radius-5-px mr-5px my-2px h-35px w-90"/>
                        <Skelaton class="border-radius-5-px mr-5px my-2px h-35px w-90"/>
                    </div>
                </div>
            </template>
        <!-- </div> -->
    </div>
</template>

<script setup>
import Item from '@/components/organisms/Item/Item.vue'
import DropDown from '@/components/molecules/DropDown/DropDown.vue'
import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue'
import ProjectFilter from '@/components/molecules/ProjectFilter/ProjectFilter.vue'
import Toggle from '@/components/atom/Toggle/Toggle.vue'
import Skelaton from "@/components/atom/Skelaton/Skelaton.vue"
import { useStore } from 'vuex';
import { useCustomComposable } from '@/composable';
import { inject, onMounted, ref, watch, computed } from 'vue'
import { useProjectsHelper, clearFilterSignal } from '../../../views/Projects/helper'
import { apiRequest } from '../../../services'
import * as env from '@/config/env';
import VirtualScroller from './VirtualScroller.vue'

// IMAGES
const horizontalDots = require("@/assets/images/svg/horizontalDots.svg");
const sidebarArrowIcon = require("@/assets/images/svg/sidebarclose_arrow.svg");
const starImage = require("@/assets/images/svg/start16.svg");
const blankStar = require("@/assets/images/svg/blankStar.svg");
const settingIcon = require("@/assets/images/svg/setting_vector.svg");

const {commit, getters} = useStore();
const userId = inject("$userId");
const clientWidth = inject("$clientWidth");
const {projects, filterdProjects,projectListFilters} = useProjectsHelper();
const searchProject = computed(()=> getters['projectData/searchedProjects'])
const {checkPermission,debounce} = useCustomComposable()
const currentCompany = computed(() => getters['settings/selectedCompany']);

const emit = defineEmits(["loadMoreProjects","applyFilter","update:search","updateSearchProject","update:searchData", "update:loader","projectDataClick","handleSidebarClose","createProject","createAiProject", "clearFilter"]);

const props = defineProps({
    showArchivedProjects: {
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
    },
    ProjectfilterObject: {
        type: Object,
        required: true
    },
    loader: {
        type: Boolean,
        required: true
    },
    isSpinner: {
        type: Boolean,
        required: true
    },
    loadedProjects: {
        type: Array,
        required: true
    },
    loadingData: {
        type: Object,
        required: true
    },
    mutateCurrentProjectDetails : {
        type: Function,
        required: true
    },
    expandedId: {
        type: String,
        required: true
    },
    sprintFolders: {
        type: Object,
        required: true
    },
    isProjectFilterApplied: {
        type:Boolean,
        required:true
    },
    isSearchAPIWait: {
        type:Boolean,
        required:true
    }
})

// const sprintFolderData = ref(props.sprintFolders)
const search = ref("");
const expands = ref({
    project: null,
    folder: null
});
const virtualScroller = ref("");
const projectSearch = ref(true);
const folderSearch = ref(false);
const sprintSearch = ref(false);
const isSearchAPIWaiting = ref(props.isSearchAPIWait)

const mainTour = inject("$mainTour");

function checkProjectPlan () {
    let projectCount = currentCompany.value?.projectCount?.projectCount || 0;
    let planfeatures = currentCompany.value?.planFeature;
    if(planfeatures === undefined){
        return false;
    }
    if(planfeatures?.project === null){
        return true;
    }else{
        if(planfeatures?.project > projectCount){
            return true;
        }else{
            return false;
        }
    }
}
function tourTest(key) {
    try {
        if(checkProjectPlan() == true) {
            mainTour.value.handleTour(key);
        }
    } catch (error) {
        console.error("ER: ", error);
    }
}

onMounted(() => {
    emit("update:loader", false);
    setTimeout(() => {
        const container = document.getElementById("project_sidebar_container");

        container?.addEventListener("scroll", () => {
            if ((container.scrollTop + container.clientHeight) >= (container.scrollHeight - 200)) {
                emit("loadMoreProjects")
            }
        });
    });
})

// watch(filterdProjects, () => {
//     emit("loadMoreProjects")
// }, { deep: true });

watch([clearFilterSignal, search], ([clearFilterNewVal, searchNewVal]) => {
    if (clearFilterNewVal > 0 && searchNewVal) {
        search.value = "";
        clearFilterSignal.value = 0;
    }
});

watch(() => props.isSearchAPIWait, (newVal) => {
    isSearchAPIWaiting.value = newVal;
})

// SEARCH OPERATION ON PROJECTS
watch(() => [search.value, projects.value, () => props.filterFavorites, projectSearch.value, folderSearch.value, sprintSearch.value,props.isProjectFilterApplied, searchProject.value], debounce((newValues,oldValues) => {
    /* eslint-disable */
    let isProjectFilterApplied = props.isProjectFilterApplied;

    const [newSearch, newProjects, newFilterFavorites, newProjectSearch, newFolderSearch, newSprintSearch,newProjectFilterApplied, newSearchProject] = newValues;
    const [oldSearch, oldProjects, oldFilterFavorites, oldProjectSearch, oldFolderSearch, oldSprintSearch,olProjectFIlterApplied, oldSearchProject] = oldValues;
    let isSearchUpdate;
    if (newSearch !== oldSearch || newProjectSearch !== oldProjectSearch || newFolderSearch !== oldFolderSearch || newSprintSearch !== oldSprintSearch || newProjectFilterApplied !== olProjectFIlterApplied) {
        isSearchUpdate = true;
    } else {
        isSearchUpdate = false;
    }

    if (newSearch !== oldSearch && newSearch === '' && isProjectFilterApplied) {
        reApplyFilter();
    }
    projectListFilters({
        projectSearch,
        folderSearch,
        sprintSearch,
        filterFavorites: props.filterFavorites,
        search,
        showArchivedProjects: props.showArchivedProjects,
        isSearchUpdate:isSearchUpdate,
        isProjectFilterApplied,
        ProjectfilterObject: props.ProjectfilterObject
    }).then(() => {
        if(!isSearchAPIWaiting.value){
            emit("update:loader", false);
        }
    })
    .catch((error) => {
        console.error("ERROR", error)
        emit("update:loader", false);
    })
    emit("update:searchData",newSearch);
}, 300));


const reApplyFilter = () => {
    let obj = {
        type: "projectFilter",
        ...props.ProjectfilterObject
    }
    let isProjectFilterApplied = props.isProjectFilterApplied
    apiRequest("post", `${env.PROJECTSEARCH}`, obj).then((serachedData)=>{

        commit("projectData/mutateSearchedProjects", { data: serachedData?.data || [], searchType: "projectFilter" });
        projectListFilters({
            projectSearch,
            folderSearch,
            sprintSearch,
            filterFavorites: props.filterFavorites,
            search:search.value,
            showArchivedProjects: props.showArchivedProjects,
            isSearchUpdate:false,
            isProjectFilterApplied,
            ProjectfilterObject: props.ProjectfilterObject
        })
        .catch((error) => {
            console.error("ERROR", error)
        })
    }).catch((error)=>{
        console.error(error)
    })
}

const projectAction = (itemData,key,subKey) => {
    commit('projectData/projectLocalUpdate', {itemData,key,subKey,userId: userId.value});
    if(props.showArchivedProjects){
        const index = filterdProjects.value.findIndex(x => x._id === itemData._id);
        filterdProjects.value.splice(index,1);
    }
}

function applyFilter (query, sortByField, sortByOrder){
    emit('applyFilter',query, sortByField, sortByOrder)
}

function updateSearch() {
  emit('update:search', search.value);
}
function setProjectSearch() {
  projectSearch.value = true;
  folderSearch.value = false;
  sprintSearch.value = false;
  emitSearch();
}

function setFolderSearch() {
  folderSearch.value = true;
  projectSearch.value = false;
  sprintSearch.value = false;
  emitSearch();
}

function setSprintSearch() {
  sprintSearch.value = true;
  projectSearch.value = false;
  folderSearch.value = false;
  emitSearch();
}

function emitSearch() {
  emit('updateSearchProject', {
    projectSearch: projectSearch.value,
    folderSearch: folderSearch.value,
    sprintSearch: sprintSearch.value,
  });
}
</script>