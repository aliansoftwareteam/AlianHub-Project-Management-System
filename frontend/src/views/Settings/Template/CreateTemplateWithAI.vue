<template>
    <div class="ai-project-template">
        <Sidebar
            className="create_template_sidebar"
            :visible="isSidebar"
            :grouped="true"
            :enable-search="false"
            :multi-select="false"
            @clear="items = []"
            :width="'607px'"
            @update:visible="$emit('closeSidebar', $event)" :top="clientWidth <= 767 ? '0px' : '46px'"
        >
            <template #head-left>
                <div class="blue font-roboto-sans">{{ $t('Templates.ai_sidebar_title') }}</div>
            </template>
            <template #body>
                <div class="sidbar-bodytamplate" v-if="activeTab === 1">
                    <div class="mb-1">
                        <label class="dark-gray">{{$t('Templates.ai_label_category')}} <span class="text-red">*</span></label>
                        <select v-model="category" class="form-control" :disabled="isSpinner">
                            <option value="">{{ $t('PlaceHolder.Select') }}</option>
                            <option v-for="item in categories" :value="item" :key="item">{{ item }}</option>
                        </select>
                    </div>
                    <div class="mb-1">
                        <label class="dark-gray" for="description-textarea">{{ $t('Templates.ai_label_description') }}</label>
                        <textarea
                            id="description-textarea"
                            :placeholder="customPlaceholder"
                            maxlength="2000"
                            class="form-control"
                            v-model="useCaseDescription"
                            :disabled="isSpinner">
                        </textarea>
                    </div>
                    <div class="d-flex justify-content-end">
                        <button type="button" class="ai-button border-0"
                            :class="[{'cursor-pointer': !isInvalidPrompt, 'btn-disabled': isInvalidPrompt }]"
                            @click="activeTab = 2"
                            :disabled="isInvalidPrompt">
                            <span>{{ $t('Home.Next') }}</span>
                        </button>
                    </div>
                </div>
                <div class="sidbar-bodytamplate bg-transparent" v-if="activeTab === 2">
                    <div class="d-flex justify-content-between">
                        <span class="cursor-pointer d-flex align-items-center" @click="activeTab = 1">
                            <img src="@/assets/images/svg/back_blue_arrow.svg" class="mr-6px">
                            <span>{{ $t('UserTimesheet.back') }}</span>
                        </span>
                        <button type="button" class="ai-button border-0 cursor-pointer" :class="[{ 'btn-disabled': isSpinner }]" @click="handleGenerate" :disabled="isSpinner">
                            <span v-if="isSpinner" class="btn-custom-spinner mr-5-px"></span>
                            <span>{{ buttonText }}</span>
                        </button>
                    </div>
                    <div v-if="suggestedTemplates.length" class="existing-data-block">
                        <div class="mt-15px result-found-text">{{ $t('Templates.msg_search_result_found') }} <strong>"{{ buttonDisplayText }}"</strong></div>
                        <ul>
                            <li v-for="item in suggestedTemplates" :key="item._id" @click="finalObject = item, activeTab = 3, isGenerateWithAI = false">
                                <div class="template_project_img">
                                    <template v-if="!(item?.templateImageURL &&  Object.keys(item.templateImageURL || {}).length)">
                                        <img class="cursor-pointer" v-if="!(item?.templateImageURL &&  Object.keys(item.templateImageURL).length)" :src="demoTemp"/>
                                    </template>
                                    <template v-else>
                                        <img class="cursor-pointer" v-if="typeof item.templateImageURL === 'string' && item.templateImageURL?.includes('http')" :src="item.templateImageURL"/>
                                        <WasabiIamgeCompp
                                            v-else-if="item?.templateImageURL &&  Object.keys(item.templateImageURL).length"
                                            :data="{url:item.templateImageURL.data,extension:item.templateImageURL.extension || 'jpg'}"
                                            class="attachment__image-height w-100 cursor-pointer"
                                        />
                                    </template>
                                </div>
                                <div class="blue template-title">{{ item.TemplateName }}</div>
                            </li>
                        </ul>
                    </div>
                    <div v-else class="mt-30px font-size-14">{{ $t('Templates.msg_search_result_not_found')}} <strong>"{{ buttonDisplayText }}"</strong></div>
                </div>
                <div class="sidbar-bodytamplate bg-transparent" v-if="activeTab === 3">
                    <div class="d-flex justify-content-between">
                        <span class="cursor-pointer d-flex align-items-center" @click="activeTab = 2">
                            <img src="@/assets/images/svg/back_blue_arrow.svg" class="mr-6px">
                            <span>{{ $t('UserTimesheet.back') }}</span>
                        </span>
                        <button type="button" class="ai-button border-0 cursor-pointer" :class="[{ 'btn-disabled': isSpinner }]" @click="handleGenerate" :disabled="isSpinner">
                            <span v-if="isSpinner" class="btn-custom-spinner mr-5-px"></span>
                            <span>{{ buttonText }}</span>
                        </button>
                    </div>
                    <div class="template-detail">
                        <h5 class="font-size-20 mb-10px">{{ finalObject?.TemplateName }}</h5>
                        <span class="font-size-15">{{ finalObject?.Description }}</span>
                    </div>
                    <div class="preview-wrapper mt-2" v-if="finalObject && Object.keys(finalObject).length">
                        <div class="d-flex justify-content-between align-items-center item-block">
                            <h5>{{ $t('Templates.project_status') }}</h5>
                            <ul class="d-flex align-items-center">
                                <li class="item" v-for="(item, index) in finalObject?.projectStatusData" :key="index">
                                    <span
                                        :title="item.name"
                                        class="default-status-squer d-inline-block border-radius-2-px status__name"
                                        :style="[{'background-color': item.textColor }]">
                                    </span>
                                </li>
                            </ul>
                        </div>
                        <div class="d-flex justify-content-between align-items-center item-block">
                            <h5>{{ $t('Projects.task_type') }}</h5>
                            <ul class="d-flex align-items-center">
                                <li class="item" v-for="(item, index) in finalObject?.TemplateTaskType" :key="index" :title="item.name">
                                    <TaskTypeIcon :taskType="item" class="task-type-image-block" />
                                </li>
                            </ul>
                        </div>
                        <div class="d-flex justify-content-between align-items-center item-block">
                            <h5>{{ $t('Templates.task_status') }}</h5>
                            <ul class="d-flex align-items-center">
                                <li class="item" v-for="(item, index) in finalObject?.taskStatusData" :key="index">
                                    <span
                                        :title="item.name"
                                        class="default-status-squer d-inline-block border-radius-2-px status__name"
                                        :style="[{'background-color': item.textColor }]">
                                    </span>
                                </li>
                            </ul>
                        </div>
                        <div class="d-flex justify-content-between align-items-center item-block"  v-if="projectApps">
                            <h5>{{ $t('Templates.apps') }}</h5>
                            <ul class="d-flex align-items-center">
                                <li class="item cursor-pointer" :key="index" v-for="(item, index) in projectApps">
                                    <span :title="`${!item.appStatus ? 'Enable' : 'Disable'} ${item.name}`" @click="toggleAppStatus(index)">
                                        <img v-if="item.afterIcon" :src="getImageUrl(item)" />
                                    </span>
                                </li>
                            </ul>
                        </div>
                        <div class="d-flex justify-content-between align-items-center item-block" v-if="projectViews">
                            <h5>{{ $t('Projects.required_view') }}
                                <span class="text-red">*</span>
                                <span v-if="!isInvalidViews.length" class="ml-5px red font-size-12 font-weight-400">{{ $t('Templates.ai_min_view_msg_text') }}</span>
                            </h5>
                            <ul class="d-flex align-items-center">
                                <li class="item cursor-pointer" :key="index" v-for="(item, index) in projectViews">
                                    <span :title="`${!item.viewStatus ? 'Enable' : 'Disable'} ${item.name} View`" @click="toggleViewStatus(index)">
                                        <img :src="!item.viewStatus ? projectComponentsIcons(item.keyName).icon : projectComponentsIcons(item.keyName).activeIcon" :alt="item.name"/>
                                    </span>
                                </li>
                            </ul>
                        </div>
                        <div class="d-flex justify-content-end mt-15px">
                            <button
                                type="button"
                                class="ai-button border-0"
                                :class="[{'cursor-pointer': !isBtnSpinner, 'btn-disabled': (isBtnSpinner || !isInvalidViews.length)}]"
                                @click="handleSubmit"
                                :disabled="(isBtnSpinner || !isInvalidViews.length)"
                            >
                                <span v-if="isBtnSpinner" class="btn-custom-spinner mr-5-px"></span>
                                <span>{{ isBtnSpinner ? `${$t('Auth.loading') }...` : $t('Templates.create_template') }}</span>
                            </button>
                        </div>
                    </div>
                </div>
            </template>
        </Sidebar>
    </div>
</template>

<script setup>
import { defineComponent, ref, inject, defineEmits, onMounted, computed } from "vue";
import { useStore } from "vuex";
import { useToast } from 'vue-toast-notification';
import { useI18n } from "vue-i18n";

// Components
import Sidebar from "@/components/molecules/Sidebar/Sidebar.vue";
import TaskTypeIcon from "@/components/atom/TaskTypeIcon/TaskTypeIcon.vue";
import { iconForName, DEFAULT_ICON_COLOR } from "@/utils/iconLibrary";

// Define the component
defineComponent({
    name: "CreateProjectWithAIComponent",
    components: {
        Sidebar,
        TaskTypeIcon
    },
})

// Props
const props = defineProps({
    isSidebar: {
        type: Boolean,
        default: false
    },
    existingTemplates: {
        type: Array,
    }
})

// Utilities
import * as env from '@/config/env';
import { apiRequest } from '@/services';
import { projectComponentsIcons, getImageUrl } from '@/composable/commonFunction';
import categories from '@/utils/common-field-categories.json';
const { getters, commit } = useStore();
const $toast = useToast();
const { t } = useI18n();

// Reactive variables
const clientWidth = inject("$clientWidth");
const companyId = inject("$companyId");
const companyUser = ref(getters['settings/companyUserDetail']);
const isSpinner = ref(false);
const isBtnSpinner = ref(false);
const isGenerateWithAI = ref(true);
const activeTab = ref(1);
const finalObject = ref({});
const category = ref("");
const useCaseDescription = ref("");
const projectViews = ref([]);
const projectApps = ref([]);
const isInvalidPrompt = computed(() => {
    const cat = category.value?.trim();
    // const desc = useCaseDescription.value?.trim();
    const invalid = isSpinner.value || !cat; // (!!desc && desc.length < 10);
    return invalid;
});
const isInvalidViews = computed(() => {
    return projectViews.value.filter(x => x.viewStatus)
});
const customPlaceholder = computed(() => {
    return Object.keys(finalObject.value).length ? t('Templates.ai_after_desc_placeholder') : t('Templates.ai_before_desc_placeholder');
});
const buttonText = computed(() => {
    if (isSpinner.value) {
        return `${t('Auth.loading')}...`;
    }

    const hasFinalObject = isGenerateWithAI.value && finalObject.value && Object.keys(finalObject.value).length > 0;
    return hasFinalObject ? t('Templates.ai_button_text_requested_changes') : t('AI.generate');
});
const buttonDisplayText = computed(() => {
    const hasFinalObject = isGenerateWithAI.value && finalObject.value && Object.keys(finalObject.value).length > 0;
    return hasFinalObject ? t('Templates.ai_button_text_requested_changes') : t('AI.generate');
});
const suggestedTemplates = computed(() => {
    const templates = props.existingTemplates || [];
    const selectedCategory = category.value || "";
    const description = useCaseDescription.value || "";
    const normalizedCategory = selectedCategory.toLowerCase();
    const descriptionWords = description
        .toLowerCase()
        .split(/\s+/)
        .filter(word => word.length > 2);

    if (!normalizedCategory && descriptionWords.length === 0) {
        return templates;
    }

    return templates.map(template => {
        let score = 0;
        const templateCategory = (template.TemplateCategory?.name || "").toLowerCase();
        const templateName = (template.TemplateName || "").toLowerCase();
        const templateDesc = (template.Description || "").toLowerCase();

        // 1. Score for category match
        if (normalizedCategory && templateCategory.includes(normalizedCategory)) {
            score += 10;
        }

        // 2. Score for description keywords
        descriptionWords.forEach(word => {
            if (templateName.includes(word)) {
                score += 5;
            }
            if (templateDesc.includes(word)) {
                score += 2;
            }
        });

        // 3. Also treat selectedCategory as a keyword
        if (normalizedCategory) {
            if (templateName.includes(...new Set(normalizedCategory.toLowerCase().split(/\s+/).filter(word => word.length > 2)))) {
                score += 5;
            }
            if (templateDesc.includes(...new Set(normalizedCategory.toLowerCase().split(/\s+/).filter(word => word.length > 2)))) {
                score += 2;
            }
        }

        return { ...template, score };
    })
    .filter(template => template.score > 0)
    .sort((a, b) => b.score - a.score);
});

// Emits
const emit = defineEmits(["update:visible", "click:closeSidebar", "closeSidebar"]);

// Function to handle sidebar close
const handleCloseSidebar = () => emit('closeSidebar', false);

// Function to handle form submission
const handleGenerate = async () => {
    isSpinner.value = true;

    try {
        if(!category.value) return;

        const params = {
            category: category.value,
            useCaseDescription: useCaseDescription.value
        };
        const response = await apiRequest("post", `${env.PROJECT_TEMPLATE}/ai-generate`, params);
        const data = response.data.data;
        finalObject.value = { ...data };
        // Auto-assign a curated library icon to each AI-generated task type
        // (keyword map → generic fallback), tinted with the theme primary.
        if (Array.isArray(finalObject.value.TemplateTaskType)) {
            finalObject.value.TemplateTaskType = finalObject.value.TemplateTaskType.map((tt) => ({
                ...tt,
                iconType: 'library',
                iconValue: iconForName(tt.name),
                iconColor: DEFAULT_ICON_COLOR,
            }));
        }
        activeTab.value = 3;
        isGenerateWithAI.value = true;

    } catch (error) {
        console.error("ERROR in handleGenerate hook:", error);
        $toast.error(error?.response?.data?.error || "Something went to wrong, Please try again", { position: 'top-right' });
    } finally {
        isSpinner.value = false;
    }
}

// Function to handle store template data into database
const handleSubmit = async () => {
    isBtnSpinner.value = true;

    try {
        // Filter project view components
        const selectedViews = projectViews.value.filter(view => view.viewStatus);
        if (!selectedViews.length) return;
        const defaultView = selectedViews[0];
        defaultView.setAsDefault = true;

        // Filter project apps
        const selectedApps = projectApps.value.filter(app => app.appStatus);
        const userId = companyUser.value.userId;
        const company = companyId.value;
        const currency = {
            symbol: '₹',
            name: 'Indian Rupee',
            symbol_native: 'টকা',
            decimal_digits: 2,
            rounding: 0,
            code: 'INR',
            name_plural: 'Indian rupees'
        };

        finalObject.value = {
            ...finalObject.value,
            projectStatusData: finalObject.value.finalProjectStatusData,
            taskStatusData: finalObject.value.finalTemplateTaskStatusData,
            templateImageURL: {},
            AssigneeUserId: [userId],
            LeadUserId: [userId],
            CompanyId: company,
            CompanyName: company,
            updatedAt: new Date(),
            createdAt: new Date(),
            ProjectRequiredDefaultComponent: defaultView.keyName,
            ProjectCurrency: currency,
            projectCreatedBy: userId,
            ProjectSource: "",
            isGlobalPermission: true,
            customFiedlsValue: [],
            TemplateTaskStatusId: "",
            TaskTypeTemplateId: "",
            TemplateRequiredComponent: selectedViews,
            apps: selectedApps,
        };

        const params = { data: finalObject.value };

        const result = await apiRequest("post", `${env.PROJECT_TEMPLATE}`, params);
        if (result?.data?.status) {
            const obj = { op: 'add', data: { ...finalObject.value, ...result.data.data } };
            commit("projectData/mutateprojectTemplate", [obj]);
            resetData();
            $toast.success(t("Toast.Template_has_been_created_Successfully"), { position: 'top-right' });
        }
    } catch (error) {
        console.error("ERROR in handleSubmit:", error);
    } finally {
        isBtnSpinner.value = false;
    }
}

// Reset data
const resetData = () => {
    finalObject.value = {};
    useCaseDescription.value = "";
    category.value = "";
    handleCloseSidebar();
}

// Fatch initial project data
const fetchProjectData = async () => {
    try {
        const [viewsResponse, appsResponse] = await Promise.all([
            apiRequest("get", `${env.PROJECTS_TABS}`),
            apiRequest("get", `${env.PROJECTS_APPS}`)
        ]);

        projectViews.value = viewsResponse.data.filter(({ value }) =>
            !["gantt", "timeline", "embed"].includes(value)
        );

        projectApps.value = appsResponse.data;
    } catch (error) {
        console.error("ERROR in fetchProjectData:", error);
    }
};

// Toggle project view component click
const toggleViewStatus = (index) => {
    projectViews.value[index].viewStatus = !projectViews.value[index].viewStatus;
}

// Toggle project apps click
const toggleAppStatus = (index) => {
    projectApps.value[index].appStatus = !projectApps.value[index].appStatus;
}

// Initialize core data
onMounted(() => {
    fetchProjectData();
});
</script>

<style src="./style.css" scoped></style>
<style scoped>
    label {
        font-size: 14px;
        font-family: Roboto;
        font-weight: 500;
        line-height: 20.72px;
    }
    textarea {
        padding: 10px;
        line-height: 17px;
        min-height: 100px;
    }
    .btn-disabled {
        opacity: 0.7;
        pointer-events: none;
    }
    .template-detail {
        margin: 35px 0;
    }
    .preview-wrapper {
        margin: 15px 0;
        border-radius: 5px;
    }
    .item-block {
        padding: 0 21px;
        height: 44px;
        color: #535358;
        background-color: #FFF;
        margin-bottom: 10px;
        border-radius: 5px;
    }
    .item-block ul {
        list-style-type: none;
    }
    .item-block .item {
        margin-left: 10px;
        max-width: 12px;
    }
    .btn-custom-spinner {
        width: 16px;
        height: 16px;
        border: 2px solid #ffffff;
        border-top: 2px solid #3498db;
        border-radius: 50%;
        animation: spin 0.6s linear infinite;
    }
    .existing-data-block ul {
        list-style-type: none;
        padding: 0;
        margin: 15px 0 0 0;
        display: flex;
        flex-wrap: wrap;
        gap: 20px;
        max-height: 685px;
        overflow: auto;
        scrollbar-width: none;
        -ms-overflow-style: none;
    }
    .existing-data-block li {
        padding: 10px;
        border-radius: 5px;
        background: #FFF;
        font-size: 14px;
        cursor: pointer;
        width: 48%;
        border: 1px solid #cfcfcf;
    }
    .existing-data-block .template-title {
        margin: 7px 0;
        line-height: 20px;
        font-weight: 500;
        font-size: 16px;
    }
    .existing-data-block .result-found-text {
        line-height: 25px;
        font-size: 15px;
    }
    .existing-data-block li:hover {
        box-shadow: rgba(100, 100, 111, 0.2) 0px 7px 29px 0px;
        border: 1px solid #2F3990;
    }
    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }
</style>