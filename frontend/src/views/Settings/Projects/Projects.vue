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
                    <input type="text" class="ah-input project-search" v-model="searchValue" :placeholder="$t('PlaceHolder.search')" :aria-label="$t('PlaceHolder.search')"/>
                    <div class="d-flex" role="tablist">
                        <span
                            v-for="tab in TABS"
                            :key="tab.state"
                            class="tab-option"
                            :class="{'activeTab': activeTab === tab.state}"
                            role="tab"
                            tabindex="0"
                            :aria-selected="activeTab === tab.state"
                            :data-test="`projects-tab-${tab.state}`"
                            @click="activeTab = tab.state"
                            @keydown.enter="activeTab = tab.state"
                        >{{ $t(tab.label) }} ({{ buckets[tab.state].length }})</span>
                    </div>
                </div>
                <div v-if="activeTabProjects.length">
                  <ProjectsListingSetting
                    v-for="item in paginatedItems"
                    :key="item._id"
                    :item="item"
                  />

            <div v-if="clientWidth > 1024" class="pagination">
                  <div class="showingEntries">{{ shownEntries }}</div>
                <div class="page_button">

                            <div  @click="goToPreviousPage"  :disabled="currentPage === 1">
                               <span><i class="ah-mask-icon pg__arrow" :style="maskOf(previousArrow)" aria-hidden="true" @click="goToPreviousPage"></i> {{$t('Projects.previous')}}</span>
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
                            <span>{{$t('Home.Next')}} <i class="ah-mask-icon pg__arrow" :style="maskOf(nextArrow)" aria-hidden="true" @click="nextPage"></i></span>
                         </div>
                </div>


                <div class="itemsPerPageSelect">
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
                               <span class="d-block next_prev_btn"><i class="ah-mask-icon pg__arrow" :style="maskOf(previousArrow)" aria-hidden="true" @click="goToPreviousPage"></i> {{$t('Projects.previous')}}</span>
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
                            <span class="d-block next_prev_btn">{{$t('Home.Next')}} <i class="ah-mask-icon pg__arrow" :style="maskOf(nextArrow)" aria-hidden="true" @click="nextPage"></i></span>
                         </div>
                </div>
                <div :class="[clientWidth > 576 ? 'd-flex' : '','justify-content-between','align-items-center']">
                    <div class="showingEntries">{{ shownEntries }}</div>

                    <div class="itemsPerPageSelect">
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
        <AppState v-else kind="denied" />
    </div>
</template>

<script setup>
import AppState from '@/components/molecules/AppState/AppState.vue';
import { defineComponent, onMounted, computed, ref,watch,inject,nextTick } from "vue";
import ProjectsListingSetting from "@/components/molecules/ProjectsListingSetting/ProjectsListingSetting.vue";
import { useProjectsHelper } from '@/views/Projects/helper';
import { useStore } from 'vuex';
import { useCustomComposable } from "@/composable";
import { maskOf } from "@/utils/iconMask";
import { useI18n } from "vue-i18n";
import { lifecycleOf, ACTIVE, ARCHIVED, CLOSED } from "@/utils/lifecycle";

const TABS = [
    { state: ACTIVE, label: 'Projects.tab_open' },
    { state: ARCHIVED, label: 'Projects.tab_archived' },
    { state: CLOSED, label: 'Projects.tab_closed' },
];

const { t } = useI18n();
const { dispatchProjects} = useProjectsHelper();
const {checkPermission} = useCustomComposable();
const {getters} = useStore();
const searchValue = ref("");
const activeTab = ref(ACTIVE);
const noSearch = require("@/assets/images/svg/No-Search-Result.svg")
const previousArrow = require("@/assets/images/svg/right_arrow.svg")
const nextArrow = require("@/assets/images/svg/left_arrow.svg")
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

const matchesSearch = (project, term) => !term
    || String(project.ProjectName || '').toLowerCase().includes(term)
    || String(project.ProjectCode || '').toLowerCase().includes(term);

const buckets = computed(() => {
    const term = searchValue.value.trim().toLowerCase();
    const byState = { [ACTIVE]: [], [ARCHIVED]: [], [CLOSED]: [] };
    (getters["projectData/allProjects"]?.data || [])
        .filter((project) => !project.isPersonal && matchesSearch(project, term))
        .sort((a, b) => (a.Created_At > b.Created_At ? -1 : 1))
        .forEach((project) => byState[lifecycleOf(project, 'project')]?.push(project));
    return byState;
});

const activeTabProjects = computed(() => buckets.value[activeTab.value]);

const shownEntries = computed(() => {
    const total = activeTabProjects.value.length;
    return t('Projects.showing_entries', { from: Math.min((currentPage.value - 1) * itemsPerPage.value + 1, total), to: Math.min(currentPage.value * itemsPerPage.value, total), total });
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