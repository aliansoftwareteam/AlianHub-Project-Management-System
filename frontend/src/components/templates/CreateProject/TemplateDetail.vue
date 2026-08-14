<!-- =========================================================================================
    Created By : Dipsha Kalariya
    Commnet : This component is used to display particular template details for template based project in create project module.
========================================================================================== -->
<template>
<div>
    <div v-if="!manageTemplate" class="setting_templateDetail_wrapper">
        <h4 class="text-blue" :class="[{'useTemplateDetailArrow':route.name !== 'Template'}]">
            <button v-if="route.name == 'Template'" type="button"  @click="$emit('click:updateSidebarVal',false)" class="backButtonTemplateList d-flex align-items-center cursor-pointer">
                <span class="d-flex align-items-center font-size-16 font-roboto-sans cursor-pointer blue"><img :src="back_arrow" class="mr-6px">{{$t('UserTimesheet.back')}}</span>
            </button>
        </h4>
       <div class="template-backdelete-wrapper">
            <h4 class="text-blue" v-if="isUseTemplate" :class="[{'useTemplateDetailArrowProject':route.name !== 'Template'}]">
            </h4>
            <!-- <h4 class="text-blue" v-if="isExportTemplate && currentSelectedKey == 0 && route.name == 'Template'">
                <button class="use-template-btn cursor-pointer" type="button">Export</button>
            </h4> -->
        </div>
        <div v-if="templateView && Object.keys(templateView).length > 0" class="template-scroll-wrapper overflow-x-hidden style-scroll">
            <button v-if="route.name === 'Template' && currentSelectedKey == 0" type="button" @click="deleteSelectedTemplate(templateView)" class="deleteTemplateBtn cursor-pointer" >{{ $t('Templates.delete_template') }}</button>
            <ConfirmModal
                :modelValue="showConfirmModal"
                :acceptButtonText="$t('Home.Confirm')"
                    :cancelButtonText="$t('Projects.cancel')"
                maxlength="150"
                :header="true"
                :showCloseIcon="false"
                @accept="handleConfirm"
                @close="showConfirmModal = false"
            >
                <template #header>
                    <h3 class="m-0">{{ $t('Home.Confirm') }}</h3>
                </template>
                <template #body>
                    <span>{{$t('Filters.are_you_sure')}}?</span>
                </template>
            </ConfirmModal>
            <div class="templateDetailWrapper">
                <template v-if="!(templateView?.templateImageURL &&  Object.keys(templateView.templateImageURL || {}).length)">
                    <img class="cursor-pointer" v-if="!(templateView?.templateImageURL &&  Object.keys(templateView.templateImageURL).length)" :src="demoTemp"/>
                </template>
                <template v-else>
                    <img class="cursor-pointer" v-if="typeof templateView.templateImageURL === 'string' && templateView.templateImageURL?.includes('http')" :src="templateView.templateImageURL"/>
                    <WasabiIamgeCompp
                        v-else-if="templateView?.templateImageURL &&  Object.keys(templateView.templateImageURL).length"
                        :data="{url:templateView.templateImageURL.data,extension:templateView.templateImageURL.extension || 'jpg'}"
                        class="attachment__image-height w-100 cursor-pointer"
                    />
                </template>
            </div>
            <div class="templateName_detail_wrapper">
            <div class="templateName_detail">
                <span class="text-capitalize">{{templateView.TemplateName}}</span>
            </div>
            <div class="templateName_detail pr-20px pt-3px">
                <p v-if="templateView.Description !== undefined" :class="[{'para-overflow': (templateView.Description.length > 496 && showMore)}]">{{showMore ? templateView.Description.slice(0,496) : templateView.Description}}
                </p>
            </div>
            <div v-if="templateView.Description.length > 496" class="text-right">
                <span @click="showMore = !showMore" class="blue cursor-pointer">{{ $t('Permissions.Read') }} {{showMore ? $t('Comments.more') : $t('Comments.less')}}</span>
            </div>
            <div class="project-task-allgoogproject-wrapper">
                <div class="d-flex justify-content-space-between align-items-center allgoodproject allgoodprojectvalue border-topleft-right-8-px">
                    <h5>{{$t('Templates.project_status')}}</h5>
                    <ul class="d-flex align-items-center" v-if="templateView.projectStatusData && templateView.projectStatusData.length > 0">
                        <li class="setImagevalue" v-for="(status,index) in templateView.projectStatusData" :key="index">
                            <span :title="status.name" class="default-status-squer d-inline-block border-radius-2-px status__name" :style="[{'background-color': status.textColor,'cursor': 'pointer'}]"></span>
                        </li>
                    </ul>
                </div>
                <div class="d-flex justify-content-space-between align-items-center allgoodproject allgoodprojectvalue">
                    <h5>{{ $t('Projects.task_type') }}</h5>
                    <ul class="d-flex align-items-center" v-if="templateView.TemplateTaskType && templateView.TemplateTaskType.length > 0">
                        <li class="setImagevalue" v-for="(status,index) in templateView.TemplateTaskType" :key="index">
                            <span :title="status.name">
                                <TaskTypeIcon :taskType="status" class="taskdetail-icon-image taskdetail__img d-inline-block border-radius-2-px"/>
                            </span>
                        </li>
                    </ul>
                </div>
                <div class="d-flex justify-content-space-between align-items-center allgoodproject allgoodprojectvalue">
                    <h5>{{$t('Templates.task_status')}}</h5>
                    <ul class="d-flex align-items-center" v-if="templateView.taskStatusData && templateView.taskStatusData.length > 0">
                        <li class="setImagevalue" v-for="(status,index) in templateView.taskStatusData" :key="index">
                            <span :title="status.name" class="default-status-squer d-inline-block border-radius-2-px status__name" :style="[{'background-color': status.textColor,'cursor': 'pointer'}]"></span>
                        </li>
                    </ul>
                </div>
                <div class="d-flex justify-content-space-between align-items-center allgoodproject allgoodprojectvalue">
                    <h5>{{$t('Templates.apps')}}</h5>
                    <ul class="d-flex align-items-center" v-if="templateView.apps && templateView.apps.length > 0 && templateView.apps.filter(ele=> ele.appStatus == true).length !== 0">
                        <template v-for="(appData,ids) in templateView.apps">
                            <li class="setImagevalue" v-bind:key="ids" v-if="appData.appStatus">
                                <span :title="appData.name">
                                    <img class="taskdetail-icon-image w-auto d-inline-block border-radius-2-px status__name"  :src="getImageUrl(appData)"/>
                                </span>
                            </li>
                        </template>
                    </ul>
                    <span v-else-if="templateView.apps.length <= 0 || templateView.apps.filter(ele=> ele.appStatus == true).length == 0">{{$t('Templates.no_app_selected')}}</span>
                </div>
                <div class="d-flex justify-content-space-between align-items-center allgoodproject allgoodprojectvalue">
                    <h5>{{ $t('Templates.default_views') }}</h5>
                    <ul class="d-flex align-items-center" v-if="templateView.TemplateRequiredComponent && templateView.TemplateRequiredComponent.length > 0">
                        <template v-for="(appData,ids) in templateView.TemplateRequiredComponent">
                            <li class="setImagevalue" v-bind:key="ids" v-if="appData.viewStatus">
                                <span :title="appData.name">
                                    <img class="appdata__keyimg" :src="projectComponentsIcons(appData.keyName).activeIcon" />
                                </span>
                            </li>
                        </template>
                    </ul>
                </div>
            </div>
        </div>
        </div>
    </div>
    <TemplateAllDetail @update-processing="updateProcessing" v-if="manageTemplate" v-model="formData" :templateView="templateView" @click:closeSubSidebar="closeSubSidebar" @closeTemplateDetailAll="manageTemplate = false,emit('useTemplate',false)"/>
</div>
</template>
<script setup>
import { ref, inject, watch } from 'vue';
import TemplateAllDetail from '@/components/templates/CreateProject/TemplateAllDetail.vue';
import ConfirmModal from '@/components/atom/Modal/Modal.vue';
import { useRoute } from "vue-router";
import { useStore } from "vuex";
import {useToast} from 'vue-toast-notification';
import { apiRequest } from '../../../services'
import WasabiIamgeCompp from "@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue"
import TaskTypeIcon from "@/components/atom/TaskTypeIcon/TaskTypeIcon.vue";
import { projectComponentsIcons,getImageUrl } from '@/composable/commonFunction';
import { storageQueryBuilder } from '@/utils/storageQueryBuild';
import { useI18n } from "vue-i18n";
import * as env from '@/config/env';
const { t } = useI18n();

const $toast = useToast();
const { commit } = useStore();
 const route = useRoute()
    const props = defineProps({
        modelValue: {
            type: Object,
            default: () => ({}),
        },
        templateView : {
            type : Object,
            default : ()=>({})
        },
        isUseTemplate : {
            type : Boolean,
            default: () => (false)  
        },
        isExportTemplate : {
            type : Boolean,
            default: () => (false)
        },
        categoryType : {
            type : String,
            default : () =>("")
        },
        currentSelectedKey: {
            type : Number,
            default: () =>(0)
        },
        isButtonClicked: {
            type : Boolean,
            default: () => (false) 
        }
    });
    const emit = defineEmits(["click:updateSidebarVal","click:closeDetails",'useTemplateChange','useTemplate','click:closeSubSidebar','closeTemplateDetailAll','update-processing']);
    const back_arrow = require("@/assets/images/svg/back_blue_arrow.svg");
    const demoTemp = require("@/assets/images/demoTemp.png");
    const templateView = ref(props.templateView);
    const showMore = ref(props.templateView.Description.length > 496 ? true : false);
    const formData = ref(props.modelValue);
    const manageTemplate = ref(props.isButtonClicked);
    const selectedRow = ref({});
    const showConfirmModal = ref(false);
    const CompanyDatabase = inject("$companyId");
    function updateProcessing(status) {
      emit('update-processing', status);
    }
    watch(() => props.isButtonClicked, (val) => {
        manageTemplate.value = val
    })
    function closeSubSidebar(){
        emit('click:closeDetails',false);
    }
    function deleteSelectedTemplate(item){
        showConfirmModal.value = true;
        selectedRow.value = item;        
    }
    async function handleConfirm() {
        await apiRequest("delete", `${env.PROJECT_TEMPLATE}/${selectedRow.value._id}`).then((result) => {
            if (result.data.status) {
                const newObj = { op: 'del', data: { ...selectedRow.value } }
                if (selectedRow.value.templateImageURL && Object.keys(selectedRow.value.templateImageURL).length && selectedRow.value.templateImageURL.data) {
                    let axiousObject = storageQueryBuilder('delete', CompanyDatabase.value, selectedRow.value.templateImageURL.data);
                    apiRequest(axiousObject.method, axiousObject.route, axiousObject.data).catch((error) => console.error(error));
                }
                $toast.success(t("Toast.Template_has_been_deleted_successfully"), { position: 'top-right' });
                commit("projectData/mutateprojectTemplate", [newObj])
                emit('click:updateSidebarVal', false)
            }
        });
    }
</script>

<style>
.useTemplateDetailArrow {
    position: absolute;
    top: 10px;
    left: 15px;
}
.useTemplateDetailArrowProject {
    position: absolute;
    top: 9px;
    right: 105px;
}
.taskdetail__img{
    width:14px !important;
    height: 14px !important;
}
.status__name{
    width: 12px !important;
    height: 12px !important;
}
.attachment__image-height{
    object-fit: contain;
}
.appdata__keyimg{
    width: 11.765px !important;
    height: 10px !important;
}
</style>
