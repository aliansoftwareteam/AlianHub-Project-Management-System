<template>
    <div class="mainProjectlistingInSetting">
        <!-- <div class="form-mianDiv">
            <InputText
                placeholder="Search by project name"
            />
        </div> -->
        <div v-if="checkPermission('settings.settings_project_list') != null && checkPermission('project.project_details') != null">
            <div class="lising_mainDiv p-1 position-re">
                <div class="totalCountActiveClose d-flex justify-content-between position-re">
                    <input type="text" class="form-control project-search" v-model="searchValue" :placeholder="$t('PlaceHolder.search')"/>
                    <div class="d-flex">
                        <span class="tab-option" @click="activeTab = 0" :class="{'activeTab': activeTab === 0}">{{$t('Projects.all_project')}} ({{filterActiveProjects && filterActiveProjects.length ? filterActiveProjects.length : 0 }})</span>
                        <span class="tab-option" @click="activeTab = 1" :class="{'activeTab': activeTab === 1}">{{$t('Projects.closed_project')}} ({{filterCloseProject && filterCloseProject.length ? filterCloseProject.length : 0}})</span>
                    </div>
                </div>
                <div v-if="activeTabProjects?.length">
                  <ProjectsListingSetting
                    v-for="(item, itemIndex) in paginatedItems"
                    :key="'item'+itemIndex"
                    :item="item"
                    :activeTab="activeTab"
                  />

            <div v-if="clientWidth > 1024" class="pagination">
                  <div class="showingEntries">
                        <div v-if="activeTabProjects === filterActiveProjects">
                            {{$t('general.showing')}} {{ Math.min((currentPage - 1) * itemsPerPage + 1, filterActiveProjects.length) }}  to {{ Math.min(currentPage * itemsPerPage, filterActiveProjects.length) }} of {{ filterActiveProjects.length }} {{$t('general.entries')}}
                       </div>
                        <div v-else-if="activeTabProjects === filterCloseProject">
                            {{$t('general.showing')}} {{ (currentPage - 1) * itemsPerPage + 1 }} to {{ Math.min(currentPage * itemsPerPage, filterCloseProject.length) }} of {{ filterCloseProject.length }} {{$t('general.entries')}}
                        </div>
                 </div>
                <div class="page_button">

                            <div  @click="goToPreviousPage"  :disabled="currentPage === 1">
                               <span><img @click="goToPreviousPage" src= "@/assets/images/svg/right_arrow.svg" /> {{$t('Projects.previous')}}</span>
                            </div>
                           
                        
                        <div class="pagination-pages">
                            <span
                                v-for="i in setPages"
                                :class="{ active: currentPage === i, 'pointer-event-none': i === '...' }"
                                :key="i"
                                :id="`paginate${i}`"
                                @click="goToPage(i)"
                            >
                                {{ i }}
                            </span>
                        </div>
                        <div @click="goToNextPage" :disabled="currentPage === totalPages">
                            <span>{{$t('Home.Next')}} <img @click="nextPage" src= "@/assets/images/svg/left_arrow.svg" /></span>
                         </div>
                </div>


                <div v-if="allProjects.length " class="itemsPerPageSelect">
                        <label for="itemsPerPageSelect">{{$t('Projects.items_per_page') +' :'}}</label>
                        <select id="itemsPerPageSelect" v-model="itemsPerPage" @change="updatePagination">
                            <option :value="5">5</option>
                            <option :value="10">10</option>
                            <option :value="15">15</option>
                            <option :value="20">20</option>
                        </select>
                 </div>

            </div>
            <div v-else class="pagination">
                <div class="page_button justify-content-center flex-wrap">

                            <div  @click="goToPreviousPage"  :disabled="currentPage === 1">
                               <span class="d-block next_prev_btn"><img @click="goToPreviousPage" src= "@/assets/images/svg/right_arrow.svg" /> {{$t('Projects.previous')}}</span>
                            </div>
                           
                        
                        <div class="pagination-pages">
                            <span
                                v-for="i in setPages"
                                :class="{ active: currentPage === i, 'pointer-event-none': i === '...' }"
                                :key="i"
                                :id="`paginate${i}`"
                                @click="goToPage(i)"
                            >
                                {{ i }}
                            </span>
                        </div>
                        <div @click="goToNextPage" :disabled="currentPage === totalPages">
                            <span class="d-block next_prev_btn">{{$t('Home.Next')}} <img @click="nextPage" src= "@/assets/images/svg/left_arrow.svg" /></span>
                         </div>
                </div>
                <div :class="[clientWidth > 576 ? 'd-flex' : '','justify-content-between','align-items-center']">
                    <div class="showingEntries">
                            <div v-if="activeTabProjects === filterActiveProjects">
                                {{$t('general.showing')}} {{ Math.min((currentPage - 1) * itemsPerPage + 1, filterActiveProjects.length) }}  to {{ Math.min(currentPage * itemsPerPage, filterActiveProjects.length) }} of {{ filterActiveProjects.length }} {{$t('general.entries')}}
                           </div>
                            <div v-else-if="activeTabProjects === filterCloseProject">
                                {{$t('general.showing')}} {{ (currentPage - 1) * itemsPerPage + 1 }} to {{ Math.min(currentPage * itemsPerPage, filterCloseProject.length) }} of {{ filterCloseProject.length }} {{$t('general.entries')}}
                            </div>
                     </div>
    
                    <div v-if="allProjects.length " class="itemsPerPageSelect">
                            <label for="itemsPerPageSelect">{{$t('Projects.items_per_page') +' :'}}</label>
                            <select id="itemsPerPageSelect" v-model="itemsPerPage" @change="updatePagination">
                                <option :value="5">5</option>
                                <option :value="10">10</option>
                                <option :value="15">15</option>
                                <option :value="20">20</option>
                            </select>
                     </div>
                </div>

            </div>
            
        </div>
                <div v-else class="text-center">
                    <img :src="noSearch" alt="aliansoftware"/>
                    <div class="error-text">
                        <h2>{{ $t('Filters.no_data_found') }}</h2>
                    </div>
                </div>
            </div>  
        </div>
        <AppState v-else kind="forbidden" />
    </div>
</template>

<script setup>
import AppState from '@/components/molecules/AppState/AppState.vue';
import { defineComponent, onMounted, computed, ref,watch,inject,nextTick } from "vue";
import ProjectsListingSetting from "@/components/molecules/ProjectsListingSetting/ProjectsListingSetting.vue";
import { useProjectsHelper } from '@/views/Projects/helper';
import { useStore } from 'vuex';
import { useCustomComposable } from "@/composable";


const { dispatchProjects} = useProjectsHelper();
const {checkPermission} = useCustomComposable();
const {getters} = useStore();
const searchValue = ref("");
const activeTab = ref(0);
const noSearch = require("@/assets/images/svg/No-Search-Result.svg")
const currentPage = ref(1);
const itemsPerPage = ref(5);
const setPages = ref([]);
const clientWidth = inject("$clientWidth");


onMounted(() => {
    dispatchProjects().then(() => {
        setPages.value = getPagination(clientWidth.value <= 1024);
    })
    .catch((error) => {
        console.error("ERROR: in set projects: ", error);
    })
})


watch([searchValue, activeTab], () => {
    currentPage.value = 1;
});

function updatePagination() {
  currentPage.value = 1;
}

const allProjects = computed(()=> {
    if ((searchValue.value).trim()) {
     let allPro = getters["projectData/projects"].data.filter((x) => x.ProjectName.toLowerCase()?.includes(searchValue.value.toLowerCase().trim()) || x.ProjectCode.toLowerCase()?.includes(searchValue.value.toLowerCase().trim()))
     return allPro        
    } else {
        return getters["projectData/projects"].data
    }
})

           
    
const closeProjects = computed(()=> {
    if (searchValue.value.trim()) {
        let allPro = getters["projectData/closeProject"].data.filter((x) => x.ProjectName.toLowerCase()?.includes(searchValue.value.toLowerCase()) || x.ProjectCode.toLowerCase()?.includes(searchValue.value.toLowerCase()))
        return allPro
    } else {
        return getters["projectData/closeProject"].data
    }
})

const filterActiveProjects = computed(() => {
    let activeProject = allProjects.value
    activeProject && activeProject.sort((a,b) => a.Created_At > b.Created_At ? -1 : 1)
    return activeProject?.filter((ele)=>{return ele.deletedStatusKey !== 1 && ele.deletedStatusKey !== 2}) || [];
})


const filterCloseProject = computed(() => {
    let closeProject = closeProjects.value
    closeProject && closeProject.sort((a,b) => a.Created_At > b.Created_At ? -1 : 1)
    return closeProject;
})


const activeTabProjects = computed(() => {
    if (activeTab.value === 0)
    return filterActiveProjects.value;
return filterCloseProject.value;
});




const paginatedItems = computed(() => {
  const start = (currentPage.value - 1) * itemsPerPage.value;
  return activeTabProjects.value?.slice(start, start + itemsPerPage.value);
});

const totalPages = computed(() => Math.ceil(activeTabProjects.value?.length / itemsPerPage.value));


function goToPreviousPage() {
  if (currentPage.value > 1) {
    currentPage.value -= 1;
    scrollToTop();
  }
}

function goToNextPage() {
  if (currentPage.value < totalPages.value) {
    currentPage.value += 1;
    scrollToTop();
  }
}

function goToPage(page) {
    if(typeof page === 'number'){
        currentPage.value = page;
        scrollToTop();
    }
}

watch(
  [currentPage, totalPages, clientWidth],
  () => {
    setPages.value = getPagination(clientWidth.value <= 1024);
  }
);

const getPagination = () => {
    let pages = [];
    if (totalPages.value <= 5) {
        pages = [...Array(totalPages.value).keys()].map(num => num + 1);
    } else {
        if (currentPage.value <= 3) {
            pages = [1, 2, 3, 4, '...', totalPages.value];
        } else if (currentPage.value >= totalPages.value - 2) {
            pages = [1, '...', totalPages.value - 3,totalPages.value - 2, totalPages.value - 1, totalPages.value];
        } else {
            pages = [1, '...', currentPage.value - 1, currentPage.value,currentPage.value + 1, '...', totalPages.value];
        }
    }
    return pages;
};

const scrollToTop = () => {
    nextTick(() => {        
        const targetElement = document.querySelector('.lising_mainDiv');        
        if (targetElement) {
            targetElement.scrollIntoView({
                behavior: "smooth",
                block: "start"
            });
        }
    });
}

defineComponent({
    name: "ProjectsComponent"
})
</script>

<style>
@import "./style.css";
</style>