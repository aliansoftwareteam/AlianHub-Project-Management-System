<template>
    <div class="tp" :class="{ 'tp--busy': isSpinner }">
        <SpinnerComp :is-spinner="isSpinner" v-if="isSpinner" />

        <template v-if="!isDisplayTemplateDetail">
            <div class="tp__head">
                <h1 class="ah-h2 tp__title">{{ $t('Templates.templates') }}</h1>
                <span class="ah-label">{{ totalCount }} · {{ $t('Settings.built_in_count', { n: defaultMainTemplate.length }) }}</span>
                <div class="tp__head-actions">
                    <button type="button" class="ah-btn ah-btn--outline ah-btn--sm" @click="openSidebar('createTemplateWithAI')"><ShellIcon name="ai" :size="14" />{{ $t('Settings.from_description') }}</button>
                    <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" @click="openSidebar('createTemplate')"><ShellIcon name="plus" :size="14" />{{ $t('Settings.new_template') }}</button>
                </div>
            </div>

            <div class="tp__tabs" role="tablist">
                <button
                    v-for="item in categoryArray"
                    :key="item.key"
                    type="button"
                    class="tp__tab"
                    :class="{ 'is-active': categoryType !== 'basicData' && selectedDefaultCategory.key === item.key }"
                    role="tab"
                    :aria-selected="categoryType !== 'basicData' && selectedDefaultCategory.key === item.key"
                    @click="changeCategoryData(item, 'defaultData')"
                >{{ item.name }}</button>
                <button type="button" class="tp__tab" :class="{ 'is-active': categoryType === 'basicData' }" role="tab" :aria-selected="categoryType === 'basicData'" @click="changeCategoryData('', 'basicData')">
                    {{ $t('Settings.your_templates', { company: companyName }) }}
                </button>
            </div>

            <div class="ah-card tp__table" v-if="selectedDefaultData.length">
                <div class="tp__row tp__row--head">
                    <span class="ah-label">{{ $t('Settings.col_template') }}</span>
                    <span class="ah-label">{{ $t('Settings.col_contains') }}</span>
                    <span class="ah-label">{{ $t('Settings.col_views') }}</span>
                    <span class="ah-label">{{ $t('Settings.col_owner') }}</span>
                    <span></span>
                </div>
                <div v-for="tpl in selectedDefaultData" :key="tpl._id" class="tp__row" role="button" tabindex="0" @click="displayTemplateDetail(tpl)" @keydown.enter="displayTemplateDetail(tpl)">
                    <div class="tp__name-cell">
                        <div class="tp__name">{{ tpl.TemplateName }}</div>
                        <div class="ah-small tp__desc">{{ tpl.Description }}</div>
                    </div>
                    <span class="ah-mono tp__mono">{{ $t('Settings.statuses_count', { n: (tpl.taskStatusData || []).length }) }}<br>{{ $t('Settings.task_types_count', { n: (tpl.TemplateTaskType || []).length }) }}</span>
                    <span class="ah-mono tp__mono">{{ viewsCount(tpl) }}</span>
                    <span class="ah-small">{{ categoryType === 'basicData' ? companyName : $t('Settings.built_in') }}</span>
                    <span class="tp__action">{{ $t('Settings.view') }}</span>
                </div>
            </div>
            <div v-else-if="!isSpinner" class="ah-empty tp__empty">
                <span>{{ categoryType === 'basicData' ? $t('Settings.templates_empty_yours') : $t('Settings.templates_empty') }}</span>
                <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" @click="openSidebar('createTemplate')">{{ $t('Settings.new_template') }}</button>
            </div>

            <div class="ah-card tp__carry">
                <div class="ah-label">{{ $t('Settings.template_carries') }}</div>
                <div class="tp__chips">
                    <span v-for="c in carries" :key="c.key" class="ah-chip" :class="{ 'ah-chip--brand': c.brand }">{{ $t(c.label) }}</span>
                </div>
                <div class="ah-small">{{ $t('Settings.template_never_copies') }}</div>
            </div>
        </template>

        <TemplateDetail
            v-else
            :currentSelectedKey="selectedDefaultCategory.key"
            :categoryType="categoryType"
            :templateView="templateView"
            :isUseTemplate="false"
            :isExportTemplate="true"
            @closeSecond="closeSecond"
            @click:updateSidebarVal="manageSelectedVal"
            @closeTemplateDetail="isDisplayTemplateDetail = false"
        />

        <CreateTemplate v-if="createTemplateSidebar" :createTemplateSidebar="createTemplateSidebar" :defaultMainTemplate="defaultMainTemplate" @click:closeSidebar="closeEvent()" @closeSidebar="closeSidebar" />
        <CreateTemplateWithAI v-if="isCreateWithAI" :isSidebar="isCreateWithAI" @click:closeSidebar="closeEvent()" @closeSidebar="isCreateWithAI = false" :existingTemplates="defaultMainTemplate" />
    </div>
</template>

<script setup>
import { ref, inject, onMounted, computed, watch } from "vue";
import { useStore } from "vuex";
import * as env from "@/config/env";
import { apiRequest } from "@/services";
import { removeDuplicatesWithKey } from "./helper.js";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import SpinnerComp from "@/components/atom/SpinnerComp/SpinnerComp.vue";
import CreateTemplate from "@/views/Settings/Template/CreateTemplate.vue";
import CreateTemplateWithAI from "@/views/Settings/Template/CreateTemplateWithAI.vue";
import TemplateDetail from "@/components/templates/CreateProject/TemplateDetail.vue";

defineOptions({ name: "TemplateSettings" });

const { getters, dispatch } = useStore();
const emit = defineEmits(["update:manageTempList"]);
const companyId = inject("$companyId");

const SKIP_VIEWS = new Set(["Gantt", "Timeline", "Embed"]);
const carries = [
    { key: "statuses", label: "Settings.carry_statuses" },
    { key: "types", label: "Settings.carry_task_types" },
    { key: "fields", label: "Settings.carry_custom_fields" },
    { key: "views", label: "Settings.carry_views" },
    { key: "project_status", label: "Settings.carry_project_statuses" },
    { key: "apps", label: "Settings.carry_apps" },
    { key: "agents", label: "Settings.carry_agents", brand: true }
];

const categoryArray = ref([]);
const selectedDefaultCategory = ref({});
const isDisplayTemplateDetail = ref(false);
const defaultMainTemplate = ref([]);
const allProjectTemplate = ref([]);
const selectedDefaultData = ref([]);
const createTemplateSidebar = ref(false);
const isCreateWithAI = ref(false);
const isSpinner = ref(false);
const categoryType = ref("");
const templateView = ref({});

const companies = computed(() => getters["settings/companies"] || []);
const companyName = computed(() => companies.value.find((c) => c._id === companyId.value)?.Cst_CompanyName || "");
const projectTemplateGetter = computed(() => getters["projectData/projectTemplate"]);
const totalCount = computed(() => defaultMainTemplate.value.length + allProjectTemplate.value.length);

const viewsCount = (tpl) => (tpl.TemplateRequiredComponent || []).filter((x) => x.viewStatus && !SKIP_VIEWS.has(x.keyName)).length;

onMounted(() => {
    isSpinner.value = true;
    apiRequest("post", env.GLOBAL_PROJECT_TEMPLATE).then((result) => {
        if (result.data.status) {
            defaultMainTemplate.value = result.data.statusText;
            categoryArray.value = removeDuplicatesWithKey(defaultMainTemplate.value.map((ele) => ele.TemplateCategory), "key");
            selectedDefaultCategory.value = categoryArray.value.length ? categoryArray.value[0] : {};
            selectedDefaultData.value = defaultMainTemplate.value.filter((tpl) => tpl.TemplateCategory.key === selectedDefaultCategory.value.key);
        }
    }).catch((error) => {
        console.error("Error in getting projectTemplate", error);
    }).finally(() => {
        isSpinner.value = false;
    });
    getProjectTemplate();
});

watch(projectTemplateGetter, (newVal) => {
    allProjectTemplate.value = newVal?.data || [];
    if (categoryType.value === "basicData") {
        selectedDefaultData.value = allProjectTemplate.value;
        isDisplayTemplateDetail.value = false;
    }
});

function changeCategoryData(itemData, type) {
    isDisplayTemplateDetail.value = false;
    if (type === "basicData") {
        if (categoryType.value === "basicData") return;
        isSpinner.value = true;
        categoryType.value = "basicData";
        selectedDefaultCategory.value = {};
        getProjectTemplate().then(() => {
            selectedDefaultData.value = [...allProjectTemplate.value].sort((a, b) => (a?.Created_At?.seconds > b?.Created_At?.seconds ? -1 : 1));
            isSpinner.value = false;
        });
        return;
    }
    categoryType.value = "";
    selectedDefaultCategory.value = itemData;
    selectedDefaultData.value = defaultMainTemplate.value.filter((tpl) => tpl.TemplateCategory.key === itemData.key);
}

function openSidebar(key) {
    createTemplateSidebar.value = key === "createTemplate";
    isCreateWithAI.value = key === "createTemplateWithAI";
}
function closeSidebar(value) { createTemplateSidebar.value = value; }
function displayTemplateDetail(item) { isDisplayTemplateDetail.value = true; templateView.value = item; }
function manageSelectedVal(value) { isDisplayTemplateDetail.value = value; emit("update:manageTempList", value); }
function closeSecond() { isDisplayTemplateDetail.value = false; }

function getProjectTemplate() {
    return dispatch("projectData/setprojectTemplate", companyId.value).then(() => {
        allProjectTemplate.value = projectTemplateGetter.value?.data || [];
    }).catch((error) => {
        console.error(error);
    });
}

function closeEvent() {
    closeSidebar(false);
    categoryType.value = "";
    changeCategoryData("", "basicData");
}
</script>

<style scoped>
@import "./style.css";
</style>
