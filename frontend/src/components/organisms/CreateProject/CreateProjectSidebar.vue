<!-- =========================================================================================
    File Name: CreateProjectSidebar.vue
    Created By : Dipsha Kalariya
    Commnet : This file is used as main sidebar of create project module.
========================================================================================== -->
<template>
<div class="createProjectSidebarWrapper commonProjectSidebar createTemplateProjectSidebarWrapper d-flex flex-row h-100 overflow-hidden" id="useTemplateId">
    <div id="back_arrow_id" class="">
        <Sidebar v-if="isVisible" :close-on-back-drop="!(isSpinnerForTemplate || isSpinner)" :visible="isActiveCreateSidebar" v-model:value="items" :grouped="true" :enable-search="false" :tourId="'createprojectfirst_driver'"
            :multi-select="false" @clear="items = []" :width="widthVal" @update:visible="$emit('closeSidebar',$event)" :top="clientWidth <= 767 ? '0px' : '46px'">
                <template #head-left>
                    <span class="font-size-18 font-weight-700 blue" :class="[{'templateNameProject':isDisplayTemplate}]">{{isDisplayTemplate === false ? $t('Projects.create_project') : useTemplateName || isButtonClicked ?  t('Projects.use_template') : t('Templates.templates')}}</span>
                </template>
                <template #head-right>
                    <button class="use-template-btn cursor-pointer" v-if="isDisplayDetail == true && !isButtonClicked" type="button" @click="handleButtonClick">{{$t('Projects.use_template')}}</button>
                    <button class="btn outline-primary d-flex align-items-center justify-content-center create-project-cancelbtn" :class="{'cursor-pointer' : (!isSpinner || !isSpinnerForTemplate) , 'cursor-default pointer-event-none' : (isSpinner || isSpinnerForTemplate)}" :disabled="(isSpinner || isSpinnerForTemplate)" @click="handleCloseSidebar">{{$t('Projects.cancel')}}</button>
                </template>
            <template #body>
                <div class="bg-light-gray mobile-common-background h-100" :class="{'p-015' : !isDisplayTemplate , 'addUseTemplate' : isDisplayTemplate}" >
                    <div class="header-sidebar default-background-header d-flex bg-white border-radius-8-px">
                        <div id="create-project-loading" class="createProjectWizardSlider createProjectBlankUseTemplateWrapper w-100" :class="{'p-020' : !isDisplayTemplate}">
                            <template v-if="checkProjectPlan() === true">
                                <div class="project-step-container mainwrapperbtn createTamplateMainBtn p-0" id="project-step-container" v-if="activeIndex === -1 && !isDisplayTemplate && !manageTemplate">
                                    <div class="form-group text-center" id="createblankproject_driver">
                                        <button type="button" @click="createBlankProject()">
                                        <img src="@/assets/images/addProjectplus.png" class="defaultImg">
                                        <img src="@/assets/images/addProjectplusBlue.png" class="hoverImg">
                                        </button>
                                        <p class="mb-0 choose-project-tilte">{{$t('Projects.blank_project')}}</p>
                                    </div>
                                    <div class="form-group text-center" id="createprojectusingtemplate_driver">
                                        <button type="button" @click="useTemplateData()"><img src="@/assets/images/Rocket.png"></button>
                                        <p class="mb-0 choose-project-tilte">{{$t('Projects.use_template')}}</p>
                                    </div>
                                </div>
                            </template>
                            <div v-else>
                                <div v-if="isSpinner === false">
                                    <div class="bg-white border-radius-12-px d-flex align-items-center flex-column position-re">
                                        <UpgradePlanSidebar
                                            :title="$t('Upgrades.You_have_reached_the_free_plan_limit').replace('PLAN_NAME',`${currentCompany.planFeature?.planName} plan` || '') + '.'"
                                            :message='$t(("Upgrades.require_upgrade_message")).replace("PROJECT_COUNT", currentCompany.planFeature?.project || 0).replace("PROJECT_NAME",currentCompany.planFeature?.planName || "")'
                                            :buttonText="$t('Upgrades.upgrade_your_plan')"
                                         />
                                    </div>
                                </div>
                            </div>
                            <!-- USE AS A EXIST TEMPLATE DATA HTML START (DIPSHA) -->
                            <div class="statusTaskWrapper statusTaskWrapperMain usetemplatesWrapper d-flex" :class="{'useTemaplteHeight' : isDisplayTemplate}">
                                <div class="mainLeftside" v-if="isDisplayTemplate && !isDisplayDetail">
                                    <h5>{{$t('ProjectDetails.browse_by_category')}}</h5>
                                    <div class="use-template-browsecategory">
                                        <ul class="taskStatusLeftListWrapper" v-if="categoryArray && categoryArray.length">
                                            <li v-for="(item,index) in categoryArray" v-bind:key="index" :style="`${selectedDefaultCategory.key === item.key ? 'background-color: #DBF1FF !important;cursor:pointer;border: 1px solid #dbf1ff;' : ''}`">
                                                <span class="templated_name" @click="changeCategoryData(item,'defaultData')" :style="`${selectedDefaultCategory.key === item.key ? 'color: #535358 !important;' : ''}`"> {{item.name}} </span>
                                            </li>
                                        </ul>
                                        <ul class="taskStatusLeftListWrapper" v-else>
                                            {{$t('Projects.no_category_found')}}
                                        </ul>
                                    </div>
                                    <h5 class="mobile-use-template-text">{{$t('Projects.template')}}</h5>
                                    <div class="use-template-browsecategory">
                                        <ul class="taskStatusLeftListWrapper">
                                            <li :style="`${(selectedCategory === CompanyDatabase && categoryType == 'basicData') ? 'background-color: #DBF1FF !important;cursor:pointer;border: 1px solid #dbf1ff;' : ''}`">
                                                <span class="templated_name" @click="changeCategoryData('','basicData')" :style="`${selectedCategory === CompanyDatabase ? 'color: #535358 !important;' : ''}`">
                                                    <p>{{userDataVal.companyData && userDataVal.companyData.filter((x) => x._id === CompanyDatabase)[0].Cst_CompanyName}}'s {{$t('Projects.template')}}</p>
                                                </span>
                                            </li>
                                        </ul>
                                    </div>
                                </div>
                                <img v-if="(showArrow == true && !isButtonClicked)" :src="back_arrow" class="backArrow cursor-pointer mr-15px" @click="()=>{!isDisplayDetail ? (isDisplayTemplate = false,widthVal='607px',selectedDefaultData= [],isTemplateExist = false,showArrow = false) : manageSelectedVal(!isDisplayDetail)}">
                                <img v-if="(showArrow == true && isButtonClicked)" :src="back_arrow" class="backArrow cursor-pointer mr-15px" :class="{'pointer-event-none' : isSpinnerForTemplate}" @click="isButtonClicked = false,emit('useTemplate',false),widthVal='923px'">
                                <div class="template-right-side position-re" :class="{'template__spinner' : clientWidth <= 767 && isSpinnerTemplate}">
                                    <SpinnerComp :is-spinner="isSpinner" v-if="isSpinner"/>
                                    <div v-if="!spinner">
                                        <div v-if="selectedDefaultData && selectedDefaultData.length > 0 && !isSpinner">
                                            <div v-if="!isDisplayDetail && !isSpinnerTemplate" class="d-flex mobile-usetempllate-list-display w-100 flex-wrap">
                                                <SingleTemplate v-for="(tempDefItem) in selectedDefaultData" v-bind:key="tempDefItem.id" :displayDataObject="tempDefItem" @click.prevent='displayTemplateDetail(tempDefItem)'/>
                                            </div>
                                            <TemplateDetail @update-processing="updateProcessing" :isButtonClicked="isButtonClicked" :model-value="formData" :currentSelectedKey="selectedDefaultCategory.key" v-if="isDisplayDetail" @update:manageTempList="manageTempList" :templateView="templateView" :isUseTemplate="true" :isExportTemplate="false" @click:closeDetails="closeDetails" @closeSecond="closeSecond" @click:updateSidebarVal="manageSelectedVal" @useTemplate="$event === false ? widthVal='923px' : widthVal='607px',useTemplateName = $event,showArrow == false,isButtonClicked = false"/>
                                        </div>
                                        <div v-else>
                                            <div class="position-ab position-center">
                                                <img :src="noResultFound" alt="norecordfound"/>
                                                <div class="error-text text-center">
                                                    <h2>{{$t('Filters.no_data_found')}}</h2>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <!-- USE AS A EXIST TEMPLATE DATA HTML END (DIPSHA) -->
                            <!-- USE AS A BLACK TEMPLATE HTML START (DIPSHA) -->
                            <div id="project-step-container" v-if="activeIndex === 0" class="mobile-projectName-category-wrapper">
                                <ProjectForm v-if="activeIndex === 0" v-model="formData"/>
                            </div>
                            <div id="project-step-container" v-if="activeIndex === 1" class="mobile-projectColorImage-wrapper">
                                <ProjectProfileForm v-if="activeIndex === 1" v-model="formData.projectProfileField" :name="formData.projectName" @update:image="(ele)=>{updateImageValue(ele)}"/>
                            </div>
                            <div id="project-step-container" class="ProjectShareGraphicModel" v-if="activeIndex === 2">
                                <ProjectWorkspace v-if="activeIndex === 2" v-model="formData.workSpaceField" :leader="formData.leadUser" :userDataVal="userDataVal" :name="formData.projectName" @disableNext="disableButton"/>
                            </div>
                            <div id="project-step-container" v-if="activeIndex === 3" class="mobile-project-taskstatus-section task-detail-mobile">
                                <ProjectTaskTypeForm v-if="activeIndex === 3" v-model="formData.taskTypeForm" @disableNext="(val) =>{isDisable = val}"/>
                            </div>
                            <div id="project-step-container" v-if="activeIndex === 4" class="mobile-add-status-project mobile-project-taskstatus-section">
                                <ProjectStatusForm v-if="activeIndex === 4" v-model="formData.projectStatusForm" @disableNext="(val) =>{isDisable = val}"/>
                            </div>
                            <div id="project-step-container" v-if="activeIndex === 5" class="mobile-project-taskstatus-section task-detail-mobile">
                                <TaskStatusForm v-if="activeIndex === 5" v-model="formData.taskStatusForm" />
                            </div>
                            <div id="project-step-container" v-if="activeIndex === 6" class="mobile-project-taskstatus-section">
                                <ProjectAlianAppsForm v-if="activeIndex === 6" v-model="formData.alianAppsObj"/>
                            </div>
                            <div id="project-step-container" v-if="currentCompany?.planFeature?.customFields === true && activeIndex === 7 && JSON.parse(JSON.stringify(formData?.alianAppsObj)).length && JSON.parse(JSON.stringify(formData?.alianAppsObj))?.find((e)=>e.key === 'CustomFields')?.appStatus === true && currentCompany?.planFeature?.customFields === true" class="mobile-project-taskstatus-section">
                                <CustomFieldProjectComponent :customField="customFiedlsValue" @manageCustomField="(val)=>{customFiedlsValue = val}"/>
                            </div>
                            <div id="project-step-container" v-if="activeIndex === (JSON.parse(JSON.stringify(formData?.alianAppsObj)).length && JSON.parse(JSON.stringify(formData?.alianAppsObj))?.find((e)=>e.key === 'CustomFields')?.appStatus === true && currentCompany?.planFeature?.customFields === true ? 8 : 7)" class="mobile-project-taskstatus-section">
                                <ProjectRequiredViewForm v-if="activeIndex === (JSON.parse(JSON.stringify(formData?.alianAppsObj)).length && JSON.parse(JSON.stringify(formData?.alianAppsObj))?.find((e)=>e.key === 'CustomFields')?.appStatus === true && currentCompany?.planFeature?.customFields === true ? 8 : 7)" v-model="formData.requiredViewobj"/>
                            </div>
                            <div id="project-step-container" v-if="activeIndex === (JSON.parse(JSON.stringify(formData?.alianAppsObj)).length && JSON.parse(JSON.stringify(formData?.alianAppsObj))?.find((e)=>e.key === 'CustomFields')?.appStatus === true && currentCompany?.planFeature?.customFields === true ? 9 : 8)" class="mobile-project-taskstatus-section">
                                <ProjectAllDetailPage v-if="activeIndex === (JSON.parse(JSON.stringify(formData?.alianAppsObj)).length && JSON.parse(JSON.stringify(formData?.alianAppsObj))?.find((e)=>e.key === 'CustomFields')?.appStatus === true && currentCompany?.planFeature?.customFields === true ? 9 : 8)" v-model="formData"/>
                            </div>
                            <div id="project-step-container" v-if="isActiveTemplatePage" class="mobile-project-taskstatus-section">
                                <BlankProjectTemplatePage v-if="isActiveTemplatePage" :templateDetail="formData.templateDetail" v-model="formData"/>
                            </div>
                            <!-- USE AS A BLACK TEMPLATE HTML END (DIPSHA) -->
                            <div class="conditional-btn-wrapper d-flex justify-content-end mt-31px">
                            <button v-if="activeIndex >= 0 && isDisable ===false && !isSpinner" @click="prevStep()" class="cursor-pointer conditional-previous-step btn border-primary border-radius-4-px blue bg-white">{{$t('Projects.previous')}}</button>
                            <button v-if="activeIndex >= 0 && isDisable === true" class="conditional-previous-step disabled__previous btn border-secondary border-radius-4-px bg-white">{{$t('Projects.previous')}}</button>
                            <button v-if="activeIndex < (JSON.parse(JSON.stringify(formData?.alianAppsObj)).length && JSON.parse(JSON.stringify(formData?.alianAppsObj))?.find((e)=>e.key === 'CustomFields')?.appStatus === true && currentCompany?.planFeature?.customFields === true ? 9 : 8) && activeIndex !== -1 && isDisable ===false" @click="nextStep()" class="cursor-pointer conditional-next-step btn border-radius-4-px white border-0 bg-blue">{{$t('Home.Next')}}</button>
                            <button v-if="activeIndex < 8 && activeIndex !== -1 && isDisable === true" class="conditional-next-step btn border-radius-4-px white border-0 bg-gray81">{{$t('Home.Next')}}</button>
                            <button v-if="activeIndex == (JSON.parse(JSON.stringify(formData?.alianAppsObj)).length && JSON.parse(JSON.stringify(formData?.alianAppsObj))?.find((e)=>e.key === 'CustomFields')?.appStatus === true && currentCompany?.planFeature?.customFields === true ? 9 : 8) && isShowTemplateBtn && !isSpinner"  @click="showTemplatePage()" class="cursor-pointer conditional-saveas-template btn border-radius-4-px border-primary blue bg-white" id="createprojectsavetemp_driver">{{$t('Projects.save_tamplete')}}</button>
                            <button v-if="activeIndex == (JSON.parse(JSON.stringify(formData?.alianAppsObj)).length && JSON.parse(JSON.stringify(formData?.alianAppsObj))?.find((e)=>e.key === 'CustomFields')?.appStatus === true && currentCompany?.planFeature?.customFields === true ? 9 : 8) && !isSpinner"  @click="submitData()" class="submit-btn cursor-pointer conditional-create-project btn border-radius-4-px bg-blue white border-0" id="createprojectbtn_driver">{{$t('Projects.create_project')}}</button>
                            <button v-if="isActiveTemplatePage&& !isSpinner"  @click="submitTemplateData()" class="submit-btn cursor-pointer conditional__save-create btn border-radius-4-px bg-blue white border-0">{{$t('Projects.save_create')}} </button>
                            <button v-else-if="isSpinner" type="button" class="btn btn-blue btn-login btn-disabled font-roboto-sans bg-blue white cursor-pointer font-weight-500" disabled><span id="btn-spinner"></span>{{$t('Auth.loading')}}...</button>
                        </div>
                        </div>
                    </div>
                </div>
            </template>
        </Sidebar>
    </div>
</div>
</template>
<script setup>
import { useStore } from "vuex";
import { computed, defineComponent,defineProps, ref, inject, watch, onMounted, nextTick } from "vue";
import { defineEmits } from 'vue';
import { dbCollections } from "@/utils/Collections";
import ProjectForm from '@/components/templates/CreateProject/ProjectForm.vue';
import ProjectProfileForm from '@/components/templates/CreateProject/ProjectProfileForm.vue';
import ProjectWorkspace from '@/components/templates/CreateProject/ProjectWorkspace.vue';
import ProjectTaskTypeForm from '@/components/templates/CreateProject/ProjectTaskTypeForm.vue'
import ProjectStatusForm from '@/components/templates/CreateProject/ProjectStatusForm.vue';
import TaskStatusForm from '@/components/templates/CreateProject/TaskStatusForm.vue';
import ProjectAlianAppsForm from '@/components/templates/CreateProject/ProjectAlianAppsForm.vue';
import ProjectRequiredViewForm from '@/components/templates/CreateProject/ProjectRequiredViewForm.vue';
import ProjectAllDetailPage from '@/components/templates/CreateProject/ProjectAllDetailPage.vue';
import BlankProjectTemplatePage from '@/components/templates/CreateProject/BlankProjectTemplatePage.vue'
import Sidebar from "@/components/molecules/Sidebar/Sidebar.vue";
import { useValidation } from "@/composable/Validation";
import {useToast} from 'vue-toast-notification';
import * as helper from '@/components/templates/CreateProject/helper.js'
import {removeDuplicatesWithKey} from "@/views/Settings/Template/helper.js";
import TemplateDetail from '@/components/templates/CreateProject/TemplateDetail.vue';
import SingleTemplate from "@/views/Settings/Template/SingleTemplate.vue"
import SpinnerComp from '@/components/atom/SpinnerComp/SpinnerComp.vue';
import * as env from '@/config/env';
import cloneDeep from 'lodash/cloneDeep'; // Import a cloning library
import { apiRequestWithoutCompnay } from '../../../services';
import UpgradePlanSidebar from "@/components/atom/UpgradePlanSidebar/UpgradePlanSidebar.vue"
import { useI18n } from "vue-i18n";
const { t } = useI18n();

const props = defineProps({
    isActiveCreateSidebar: {
        type: Boolean,
        default: false
    },
    isAdvanceFilterApplied: {
        type: Boolean,
        default: false
    }
})

const defaultCurrency = computed(() => getters['settings/allCurrencyArray']?.find((x) => x.code === "INR"));
// image
const noResultFound = require("@/assets/images/svg/No-Search-Result.svg");
const isVisible = ref(props.isActiveCreateSidebar);
const userId = inject('$userId');
const clientWidth = inject("$clientWidth");
const { getUser } = useGetterFunctions();
import { useGetterFunctions } from "@/composable";
import { useRoute, useRouter } from 'vue-router';
import {storageQueryBuilder,generateFileName} from '@/utils/storageQueryBuild.js';
import { apiRequest } from '../../../services';

const $toast = useToast();
const  { checkAllFields } = useValidation();

    defineComponent({
        name: "CreateProject-Component",
        components: {
            ProjectForm,
            Sidebar
        },
    })
    const formData = ref({
        projectName: {
            value: "",
            rules:
            "required | min:3| max:100",
            name: "project name",
            error: "",
        },
        projectCode: {
            value: "",
            rules:
            "required",
            name: "project key",
            error: "",
            isUniqueProjectCode : '',
        },
        leadUser: {
            value: [],
            rules:
            "required",
            name: "leadUser",
            error: "",
        },
        dueDate: {
            value: "",
            rules:
            "required",
            name: "dueDate",
            error: "",
        },
        proposalId: {
            value: "",
            rules: "",
            name: "proposal id",
            error: "",
        },
        skills: {
            value: [],
            rules: "",
            name: "skills",
            error: "",
        },
        projectProfileField:{
            selectedColor : {
                value: "",
                rules:
                "required",
                name: "selectedColor",
                error: "",
            },
            uploadedImage : {
                value: "",
                rules:
                "required",
                name: "Choose an Image to Upload",
                error: "",
            },
            previewImage : {
                value: "",
                rules:
                "required",
                name: "previewImage",
                error: "",
            }
        },
        workSpaceField : {
            privateSpaceValue : {
                value: false,
                rules:
                "required",
                name: "privateSpaceValue",
                error: "",
            },
            privateSpaceUsers : {
                value: [],
                rules:
                "required",
                name: "privateSpaceUsers",
                error: "",
            }
        },
        taskTypeForm : {
            taskTypeField : {
                value: {},
                rules:
                "required",
                name: "taskTypeField",
                error: "",
            }
        },
        projectStatusForm : {
            projectStatusField : {
                value: {},
                rules:
                "required",
                name: "projectStatusField",
                error: "",
            } 
        },
        taskStatusForm : {
            taskStatusField : {
                value: {},
                rules:
                "required",
                name: "taskStatusField",
                error: "",
            }
        },
        alianAppsObj :[],
        requiredViewobj: {
            value: [],
            rules:
            "required",
            name: "requiredViewobj",
            error: "",
        },
        templateDetail : {
            templateName: {
                value: "",
                rules:
                "required",
                name: "templateName",
                error: "",
            },
            description : {
                value: "",
                rules:
                "required",
                name: "description",
                error: "",
            },
            uploadedImage : {
                value: "",
                rules:
                "required",
                name: "uploadedImage",
                error: "",
            },
            previewImage : {
                value: "",
                rules:
                "required",
                name: "previewImage",
                error: "",
            }
        }
    })
    const previewImage = ref(null);
    const emit = defineEmits(["update:visible", "click:closeSidebar", "closeSidebar","update:manageTempList","useTemplate",'update-processing']);
    const { getters , dispatch, commit} = useStore();
    const userDataVal = getUserData();
    const CompanyDatabase = inject("$companyId");
    const hanldeBlankProjectTour = inject("hanldeBlankProjectTour");
    const companyUser = ref(getters['settings/companyUserDetail']);
    const projectTemplateGetter = computed(() => {
        return getters["projectData/projectTemplate"];
    })
    const currentCompany = computed(() => getters['settings/selectedCompany']);
    const isSpinnerTemplate = ref(false);
    const items = ref([]);
    const isDisplayTemplate = ref(false);
    const isDisplayDetail = ref(false);
    const manageTemplate = ref(false);
    const useTemplateName = ref(false);
    const isShowTemplateBtn = ref(false);
    const isActiveTemplatePage = ref(false);
    const isSpinner = ref(false);
    const spinner = ref(false);
    const isSpinnerForTemplate = ref(false);
    const isDisable = ref(false);
    const templateView = ref({});
    const isButtonClicked = ref(false);
    const useTemplateProj = ref('category');
    const customFiedlsValue = ref([]);
    const route = useRoute();
    const router = useRouter();
    const updateProcessing = (status) => {
        isSpinnerForTemplate.value = status;
    };
    // MANAGE TEMPLATE CREATE DETAILS (DIPSHA)
    const activeIndex = ref(-1);
    const createBlankProject = () =>{
        activeIndex.value = 0;
        isShowTemplateBtn.value = true;
        setTimeout(() => {
            if(hanldeBlankProjectTour) {
                hanldeBlankProjectTour()
            }
        }, 100);
    }
    const handleButtonClick = () => {
        widthVal.value = "607px";
        isButtonClicked.value = true;
    };
    function getUserData() {
        const user = getUser(userId.value,true);
        const userData = {
            id: user.id,
            Employee_Name: user.Employee_Name,
            companyid : user.AssignCompany,
            companyData : [],
            companyOwnerId : user.companyOwnerId
        }
        return userData;
    }
    const companies = computed(() => {
        return getters["settings/companies"];
    })
    if(companies.value && companies.value.length > 0){
        userDataVal.companyid.forEach(element => {
            let indexVal = companies.value.findIndex((item)=>{
                return item._id === element
            })
            if(indexVal !== -1){
                userDataVal.companyData.push(companies.value[indexVal])
            }
        });
    }
    const nextStep = ()=>{
        if(activeIndex.value === 0){
            checkAllFields({projectName : formData.value.projectName,projectCode:formData.value.projectCode}).then((valid)=>{
                if(valid){ 
                    if(formData.value.projectCode.isUniqueProjectCode !== ""){
                        return
                    }
                    else{
                        activeIndex.value += 1;
                    }
                }
            })
        }
        else if(activeIndex.value === 3){
            if(!Object.keys(formData.value.taskTypeForm.taskTypeField.value).length){
                formData.value.taskTypeForm.taskTypeField.error = t('errorPage.please_select_template');
                return;
            }
            else{
                checkAllFields(formData.value.taskTypeForm.taskTypeField).then((valid)=>{
                    if(valid){
                        activeIndex.value += 1;
                    }
                })
            }
        }
        else if(activeIndex.value === 5){
            if(!Object.keys(formData.value.taskStatusForm.taskStatusField.value).length){
                formData.value.taskStatusForm.taskStatusField.error = t('errorPage.please_select_template');
                return;
            }
            else{
                activeIndex.value += 1;
            }
        }
        else if(activeIndex.value === 7 && JSON.parse(JSON.stringify(formData.value?.alianAppsObj)).length && JSON.parse(JSON.stringify(formData.value?.alianAppsObj))?.find((e)=>e.key === 'CustomFields')?.appStatus == false){
            const isValid = JSON.parse(JSON.stringify(formData.value?.requiredViewobj.value)).some(item => item.setAsDefault || item.viewStatus);
            if(!isValid) {
                formData.value.requiredViewobj.error = t('ViewList.error_message_for_empty');
                return;
            } else {
                activeIndex.value += 1;
                formData.value.requiredViewobj.error='';
            }  
        }
        else if(activeIndex.value === 8 && JSON.parse(JSON.stringify(formData.value?.alianAppsObj)).length && JSON.parse(JSON.stringify(formData.value?.alianAppsObj))?.find((e)=>e.key === 'CustomFields')?.appStatus == true) {
            const isValid = JSON.parse(JSON.stringify(formData.value?.requiredViewobj.value)).some(item => item.setAsDefault || item.viewStatus);
            if(!isValid) {
                formData.value.requiredViewobj.error = t('ViewList.error_message_for_empty');
                return;
            } else {
                activeIndex.value += 1;
                formData.value.requiredViewobj.error='';
            }
        }
        else{
            if(activeIndex.value === 6) {
                if(JSON.parse(JSON.stringify(formData.value?.alianAppsObj)).length && JSON.parse(JSON.stringify(formData.value?.alianAppsObj))?.find((e)=>e.key === 'CustomFields')?.appStatus == false) {
                    customFiedlsValue.value = [];
                }
            }
            activeIndex.value += 1;
        }
    }
    const prevStep = () =>{
        activeIndex.value -= 1;
        isActiveTemplatePage.value = false;
        formData.value.projectName.error = '';
        formData.value.projectCode.error = '';
    }
    const back_arrow = require("@/assets/images/back_arrow.png");
    const categoryArray = ref([]);
    const selectedDefaultCategory = ref({});
    const defaultMainTemplate = ref([]);
    const allProjectTemplate = ref([]);
    const selectedDefaultData = ref([]);
    const selectedCategory = ref({});
    const categoryType = ref("");
    const isTemplateExist = ref(false);
    const showArrow = ref(false);
    const widthVal = ref('607px');
    const proIconData = ref({});

    onMounted(() => {
        checkProjectPlan();
    })
    const useTemplateData = () =>{
        showArrow.value = true
        widthVal.value = '1329px';
        categoryType.value = '';
        isDisplayTemplate.value = true;
        isShowTemplateBtn.value = true;
        selectedDefaultData.value = [];
        isSpinner.value = true;
        spinner.value = true;
        apiRequest("post", env.GLOBAL_PROJECT_TEMPLATE).then((result)=>{
            if(result.data.status){
                defaultMainTemplate.value = result.data.statusText;
                categoryArray.value = removeDuplicatesWithKey(defaultMainTemplate.value.map(ele=>ele.TemplateCategory),'key');
                selectedDefaultCategory.value = categoryArray.value[0];
                selectedDefaultData.value = defaultMainTemplate.value.filter(tempData=>tempData.TemplateCategory.key === selectedDefaultCategory.value.key);
            }
            spinner.value = false;
            isSpinner.value = false;
        }).catch((error)=>{
            spinner.value = false;
            isSpinner.value = false;
            console.error('Error in getting projectTemplate',error);
        });
    }
    const projectStaus = computed(() => {
        return cloneDeep(getters['settings/projectStaus']);
    })
    const taskType = computed(() => {
        return cloneDeep(getters['settings/taskType']);
    })
    const taskStatus = computed(() => {
        return cloneDeep(getters['settings/taskStatus']);
    })
    watch(() => getters['projectData/projectTemplate'],(newVal)=>{
        if(newVal && Object.keys(newVal).length == 0) {
            if(selectedDefaultCategory.value && Object.keys(selectedDefaultCategory.value).length == 0) {
                selectedDefaultData.value = [];
                isTemplateExist.value = true;
            }
        } else {
            allProjectTemplate.value = newVal.data;
            if(selectedDefaultCategory.value && Object.keys(selectedDefaultCategory.value).length == 0) {
                selectedDefaultData.value = allProjectTemplate.value;
                isTemplateExist.value = false;
            }
        }
    })
    function manageSelectedVal(value){
        isDisplayDetail.value = value;
        manageTempList(isDisplayDetail.value);
    }
    function manageTempList(value){
        isDisplayDetail.value = value;
        if(isDisplayDetail.value === false){
            widthVal.value = '1329px';
        }else {
            widthVal.value = '923px';
        }
    }
    function changeCategoryData(itemData,type){
        if(type == "basicData"){
            useTemplateProj.value = 'withoutcategory';
            if(categoryType.value == '' || categoryType.value !== 'basicData') {
                isTemplateExist.value = false;
                isSpinnerTemplate.value = true;
                categoryType.value = "basicData";
                selectedCategory.value = CompanyDatabase.value;
                selectedDefaultCategory.value = {};
                getProjectTemplate().then(()=>{
                    selectedDefaultData.value = allProjectTemplate.value.sort((a, b) => a?.Created_At?.seconds > b?.Created_At?.seconds ? -1 : 1);
                    isSpinnerTemplate.value = false;
                    if(allProjectTemplate.value.length <= 0){
                        isTemplateExist.value = true;
                    }
                }).catch((err)=>{
                    isSpinnerTemplate.value = false;
                    console.error(err)
                })
            }
        }
        if(type == "defaultData"){
            useTemplateProj.value = 'category';
            isTemplateExist.value = false;
            categoryType.value = "";
            selectedDefaultData.value = [];
            isDisplayDetail.value = false;
            selectedCategory.value = {};
            selectedDefaultCategory.value = itemData;
            selectedDefaultData.value = defaultMainTemplate.value.filter(tempData=>tempData.TemplateCategory.key === selectedDefaultCategory.value.key)
            if(selectedDefaultData.value.length <= 0){
                isTemplateExist.value = true; 
            }
        }
    }
    async function submitData(){
        try {
            isSpinner.value = true;
            var templateProjectStatus = [];
            if(Object.keys(formData.value.taskStatusForm.taskStatusField.value).length>0){
                if(formData.value.taskStatusForm.taskStatusField.value.defaultActive && Object.keys(formData.value.taskStatusForm.taskStatusField.value.defaultActive).length > 0){
                    templateProjectStatus.push({
                        'name': formData.value.taskStatusForm.taskStatusField.value.defaultActive.name,
                        'bgColor': formData.value.taskStatusForm.taskStatusField.value.defaultActive.textColor + '35',
                        'textColor': formData.value.taskStatusForm.taskStatusField.value.defaultActive.textColor,
                        'key' : formData.value.taskStatusForm.taskStatusField.value.defaultActive.key,
                        'statusImage': "",
                        'isDeleted' : true,
                        'type': 'default_active'
                    })
                }
                if(formData.value.taskStatusForm.taskStatusField.value.ActiveStatusList && formData.value.taskStatusForm.taskStatusField.value.ActiveStatusList.length > 0){
                    for(let j=0;j<formData.value.taskStatusForm.taskStatusField.value.ActiveStatusList.length;j++){
                        templateProjectStatus.push({
                            'name': formData.value.taskStatusForm.taskStatusField.value.ActiveStatusList[j].name,
                            'bgColor': formData.value.taskStatusForm.taskStatusField.value.ActiveStatusList[j].textColor + '35',
                            'textColor': formData.value.taskStatusForm.taskStatusField.value.ActiveStatusList[j].textColor,
                            'key' : formData.value.taskStatusForm.taskStatusField.value.ActiveStatusList[j].key,
                            'statusImage': "",
                            'isDeleted' : true,
                            'type': 'active'
                        })
                    }
                }
                if(formData.value.taskStatusForm.taskStatusField.value.DoneStatusList && formData.value.taskStatusForm.taskStatusField.value.DoneStatusList.length > 0){
                    for(let j=0;j<formData.value.taskStatusForm.taskStatusField.value.DoneStatusList.length;j++){
                        templateProjectStatus.push({
                            'name': formData.value.taskStatusForm.taskStatusField.value.DoneStatusList[j].name,
                            'bgColor': formData.value.taskStatusForm.taskStatusField.value.DoneStatusList[j].textColor + '35',
                            'textColor': formData.value.taskStatusForm.taskStatusField.value.DoneStatusList[j].textColor,
                            'key' : formData.value.taskStatusForm.taskStatusField.value.DoneStatusList[j].key,
                            'statusImage': "",
                            'isDeleted' : true,
                            'type': 'done'
                        })
                    }
                }
                if(formData.value.taskStatusForm.taskStatusField.value.defaultComplete && Object.keys(formData.value.taskStatusForm.taskStatusField.value.defaultComplete).length > 0){
                    templateProjectStatus.push({
                        'name': formData.value.taskStatusForm.taskStatusField.value.defaultComplete.name,
                        'bgColor': formData.value.taskStatusForm.taskStatusField.value.defaultComplete.textColor + '35',
                        'textColor': formData.value.taskStatusForm.taskStatusField.value.defaultComplete.textColor,
                        'key' : formData.value.taskStatusForm.taskStatusField.value.defaultComplete.key,
                        'statusImage': "",
                        'isDeleted' : true,
                        'type': 'close'
                    })
                }
            }

            let index = projectStaus.value.findIndex((x) => {
                return x._id === formData.value.projectStatusForm.projectStatusField.value._id
            })
            let projectStausValue = projectStaus.value[index];

            let taskTypeindex = taskType.value.findIndex((x) => {
                return x._id === formData.value.taskTypeForm.taskTypeField.value._id
            })
            let taskTypeValue = taskType.value[taskTypeindex];

            let taskStatusindex = taskStatus.value.findIndex((x) => {
                return x._id === formData.value.taskStatusForm.taskStatusField.value._id
            })
            let taskStausValue = taskStatus.value[taskStatusindex];
            if(JSON.parse(JSON.stringify(formData.value?.alianAppsObj)).length && JSON.parse(JSON.stringify(formData.value?.alianAppsObj))?.find((e)=>e.key === 'CustomFields')?.appStatus !== true) {
                customFiedlsValue.value = [];
            }
            const obj = {
                // need to discussion
                'TemplateName':  manageTemplate.value == true ? '' : '',
                'TemplateId' : "",
                // DEFAULT
                'AssigneeUserId': Array.from(new Set([companyUser.value.userId,...formData.value.leadUser.value.map((x)=>x.id), ...formData.value.workSpaceField.privateSpaceUsers.value.map((x) => x.id)])),
                'CompanyId': CompanyDatabase.value,
                'ProjectType': "Fix",
                'status': formData.value.projectStatusForm.projectStatusField.value.projectActiveStatus.filter((x) => x.default === true)[0].value,
                'markAsStar': false,
                'sprintsfolders': {},
                'sprintsObj': {},
                'ProjectCurrency': defaultCurrency.value || {},
                'statusType': "active",
                'lastTaskId': 0,
                'projectCreatedBy':userId.value,
                //STEP : 1
                'ProjectName': formData.value.projectName.value,
                'ProjectCode': formData.value.projectCode.value,
                'LeadUserId': Array.from(new Set([companyUser.value.userId,...formData.value.leadUser.value.map((x)=>x.id)])),
                'DueDate': formData.value.dueDate.value !== '' ? new Date(formData.value.dueDate.value) : "",
                ...(formData.value.dueDate.value !== '' && { 'dueDateDeadLine': [{'date': new Date(formData.value.dueDate.value) }] }),
                'proposalId': formData.value.proposalId.value,
                'skills': formData.value.skills.value,
                // STEP 3
                'isPrivateSpace': formData.value.workSpaceField.privateSpaceValue.value,
                // STEP 4
                'TaskTypeTemplateId' : formData.value?.taskTypeForm?.taskTypeField.value?.taskTypes.length === taskTypeValue?.taskTypes.length ?  formData.value?.taskTypeForm?.taskTypeField.value._id : '',
                'taskTypeCounts' : formData.value.taskTypeForm.taskTypeField.value.taskTypes,
                // STEP 5
                'projectStatusData': [...formData.value.projectStatusForm.projectStatusField.value.projectActiveStatus, ...formData.value.projectStatusForm.projectStatusField.value.projectDoneStatus, {...formData.value.projectStatusForm.projectStatusField.value.projectCompletedStatus}],
                'projectStatusTemplateId' : formData.value?.projectStatusForm?.projectStatusField.value?.projectActiveStatus?.length === projectStausValue?.projectActiveStatus.length && formData.value?.projectStatusForm?.projectStatusField.value?.projectDoneStatus.length === projectStausValue?.projectDoneStatus?.length ? formData.value?.projectStatusForm?.projectStatusField.value._id : '',
                // STEP 6
                'taskStatusData' : templateProjectStatus,
                'TemplateTaskStatusId' : formData.value?.taskStatusForm?.taskStatusField.value?.ActiveStatusList.length === taskStausValue?.ActiveStatusList.length && formData.value?.taskStatusForm?.taskStatusField.value?.DoneStatusList.length === taskStausValue?.DoneStatusList.length ?  formData.value.taskStatusForm?.taskStatusField.value?._id : '',
                // STEP 7
                'apps': manageTemplate.value == true 
                    ? [] 
                    : formData.value.alianAppsObj 
                        ? formData.value.alianAppsObj
                            .filter((x) => x.appStatus === true)
                            .map((x) => x.key) 
                : [],
                // STEP 8
                'ProjectRequiredComponent' : formData.value.requiredViewobj.value.filter((x) => x.viewStatus === true).map((x)=>({
                    _id:x._id,
                    viewStatus:x.viewStatus,
                    setAsDefault:x.setAsDefault
                })),
                'ProjectRequiredDefaultComponent': formData.value.requiredViewobj.value.filter((x) => x.setAsDefault === true)[0].keyName,
                'isGlobalPermission' : true,
                'customFiedlsValue':customFiedlsValue.value,
            }
            let path = `${CompanyDatabase.value}/${CompanyDatabase.value}/${dbCollections.PROJECTS}`;
            const getId = await apiRequest("get",env.GENERATEMONGOID);
            const docId = getId.status === 200 ? getId?.data || '' : '';
            if(!docId){
                $toast.error(t("Toast.Error_in_creating_project"),{position: 'top-right'});
                isSpinner.value = false;
                emit('click:closeSidebar',false);
                helper.resetStatus();
                return;
            }
            if(formData.value.projectProfileField.previewImage.value !== "" && previewImage.value !== null){
                let name = generateFileName(previewImage.value.name,env.STORAGE_TYPE);
                let filePath = `Project/${docId}/Settings/ProjectIcon/${name}`;

                const apiFormData = new FormData();
                apiFormData.append("companyId", CompanyDatabase.value);
                apiFormData.append("path", filePath);
                apiFormData.append("key", 'projectIcon');
                apiFormData.append("file", previewImage.value);
                await apiRequestWithoutCompnay("post", storageQueryBuilder('upload').route, apiFormData, "form").then((res)=>{
                    if(res.data.status){
                        let imageUrlPath = env.STORAGE_TYPE && env.STORAGE_TYPE==='server' ? res.data.statusText : res.data.statusText[0];
                        obj.projectIcon = {type:"image", data: imageUrlPath}
                    }else{
                        obj.projectIcon = {type:"image", data: ''}
                    }
                }).catch((err) => {
                    console.error(err,"ERROR IN UPLOAD FILE IN WASABI");
                })
            }
            else{
                obj.projectIcon = {type: "color", data : formData.value.projectProfileField.selectedColor.value };
            }
            let axiosData = {...obj,_id:docId};
            axiosData.projectStatusData = axiosData.projectStatusData.map(x => ({key:x.key,type:x.type, ...(x.key === 1 && {default: true})}));
            axiosData.taskStatusData = axiosData.taskStatusData.map(x => ({key:x.key,type:x.type}));
            axiosData.taskTypeCounts = axiosData.taskTypeCounts.map(x => ({key:x.key}));
            helper.HandleProject(path,axiosData,userDataVal,CompanyDatabase.value,true).then(async(result)=>{
                if(result.status === true){
                    if(isActiveTemplatePage.value){
                        if(formData.value.templateDetail.previewImage.value !== ""){
                            let name = generateFileName(formData.value.templateDetail.previewImage.value.name,env.STORAGE_TYPE);
                            let filePath = `ProjectTemplate/${name}`;
    
                            const apiFormData = new FormData();
                            apiFormData.append("companyId", CompanyDatabase.value);
                            apiFormData.append("path", filePath);
                            apiFormData.append("file", formData.value.templateDetail.previewImage.value);
                            await apiRequestWithoutCompnay("post", storageQueryBuilder('upload').route, apiFormData, "form").then((res)=>{
                                if(res.data.status){
                                    proIconData.value = {type:"image", data: res.data.statusText}
                                }else{
                                    proIconData.value = {type:"image", data: ''}
                                }
                            })
                        }
                        const templateObj = {
                            'AssigneeUserId': [companyUser.value.userId],
                            'TemplateName': formData.value.templateDetail.templateName.value,
                            "templateImageURL": proIconData.value,
                            'Description' : formData.value.templateDetail.description.value,
                            'CompanyId': CompanyDatabase.value,
                            'LeadUserId': [companyUser.value.userId],
                            'updatedAt': new Date(),
                            'createdAt': new Date(),
                            'TemplateRequiredComponent' : formData.value.requiredViewobj.value.filter((x) => x.viewStatus === true),
                            'taskStatusData': templateProjectStatus.map((x) => ({
                                type: x.type,
                                name: x.name,
                                textColor: x.textColor,
                                key: x.key,
                                bgColor: x.bgColor
                            })),
                            'apps': formData.value.alianAppsObj 
                                ? formData.value.alianAppsObj
                                    .filter((x) => x.appStatus === true)
                                    .map((x) => x.key) 
                            : [],
                            'TemplateTaskStatusId' : formData.value.taskStatusForm.taskStatusField.value._id,
                            'TaskTypeTemplateId' : formData.value.taskTypeForm.taskTypeField.value._id,
                            'TemplateTaskType' : formData.value.taskTypeForm.taskTypeField.value.taskTypes.map((x) => ({
                                name:x.name,
                                taskImage:x.taskImage,
                                key:x.key,
                                value:x.value
                            })),
                            'projectStatusData': [...formData.value.projectStatusForm.projectStatusField.value.projectActiveStatus, ...formData.value.projectStatusForm.projectStatusField.value.projectDoneStatus, {...formData.value.projectStatusForm.projectStatusField.value.projectCompletedStatus}].map((x) => ({
                                type:x.type,
                                name:x.name,
                                textColor:x.textColor,
                                key:x.key,
                                backgroundColor:x.backgroundColor,
                                value:x.value
                            })),
                            'ProjectRequiredDefaultComponent': formData.value.requiredViewobj.value.filter((x) => x.setAsDefault === true)[0].keyName,
                            'ProjectCurrency': defaultCurrency.value || {},
                            'projectCreatedBy':userId.value,
                            'isGlobalPermission' : true,
                            'customFiedlsValue':customFiedlsValue.value,
                            'TemplateTaskCloseKey': 2,
                        }

                        // API request save project template
                        let axiosData = { data: templateObj }
                        await apiRequest("post", `${env.PROJECT_TEMPLATE}`, axiosData).then((result) => {
                            if (result.status) {
                                $toast.success(t("Toast.Template_&_Project_data_has_been_added_successfully"), { position: 'top-right' });
                            }
                        });
                    }
                    else{
                        $toast.success(t("Toast.Project_data_has_been_added_successfully", {
                        filterMessage: props.isAdvanceFilterApplied
                            ? t("Toast.please_remove_the_advanced_filter_to_view_newly_created_projects")
                            : "",
                        }),{position: 'top-right'});
                    }
                    isSpinner.value = false;
                    emit('click:closeSidebar',false);
                    helper.resetStatus();
                    var newObj = {snap: null, privateSnap: false, op: "added", data: {...result.data, id: result.id}};
                    commit("projectData/mutateProjects",[newObj]);
                    nextTick(() => {
                        setTimeout(()=>{
                            if(props.isAdvanceFilterApplied === false) {
                                let currentTab = formData.value.requiredViewobj.value.find((x) => x.setAsDefault === true);
                                router.replace({name: "Project", params: {cid: route.params?.cid, id: result.id}, query: {...route.query, tab : currentTab?.keyName ?? "ProjectListView"}});
                            }
                        },100)
                    });
                    if(result?.customFieldValueArray) {
                        result.customFieldValueArray.forEach((customDataObj)=>{
                            commit("settings/mutateFinalCustomFields", {data: customDataObj || {},op: "added"});
                        })
                    }
                }else{
                    $toast.error(t("Toast.Error_in_creating_project"),{position: 'top-right'});
                    isSpinner.value = false;
                    emit('click:closeSidebar',false);
                    helper.resetStatus();
                }
            })
            .catch((error) => {
                isSpinner.value = false;
                console.error("ERROR in Craete project: ", error);
                helper.resetStatus();
            })
        }
        catch(error){
            isSpinner.value = false;
            console.error(error);
            helper.resetStatus();
        }
    }
    function submitTemplateData(){
        try{
            checkAllFields({templateName : formData.value.templateDetail.templateName}).then((valid)=>{
                if(valid){
                    submitData();
                }
            })
        }
        catch(error){
            isSpinner.value = false;
            console.error(error);
        }
    }
    function showTemplatePage(){
        activeIndex.value += 1;
        isActiveTemplatePage.value = true;
    }
    function displayTemplateDetail(item){
        widthVal.value = '923px'
        isDisplayDetail.value = true;
        templateView.value = item;
        templateView.value.useTemplateProj = useTemplateProj.value;
    }
    function closeDetails(){
        emit('click:closeSidebar',false);
        isButtonClicked.value = false;
        helper.resetStatus();
    }
    function closeSecond () {
        isDisplayDetail.value = true;
    }
    function getProjectTemplate () {
        try {
            return new Promise((res)=>{
                dispatch('projectData/setprojectTemplate', CompanyDatabase.value)
                .then(() => {
                    if(projectTemplateGetter.value && Object.keys(projectTemplateGetter.value).length != 0) {
                        isTemplateExist.value = false;
                        allProjectTemplate.value = projectTemplateGetter.value?.data ? projectTemplateGetter.value.data : [];
                    } else {
                        allProjectTemplate.value = [];
                        isTemplateExist.value - true;
                    }
                    res()
                })
            })
        } catch (error) {
            console.error(error);
        }
    }
    function updateImageValue(ele) {
        previewImage.value = ele[0]
    }

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

    function disableButton (event) {
        isDisable.value = event;
    }

    const handleCloseSidebar = () => {
        isVisible.value=!isVisible.value;
        emit('closeSidebar',isVisible.value);
        helper.resetStatus();
    }
</script>
<style>
@import "./style.css";

</style>
