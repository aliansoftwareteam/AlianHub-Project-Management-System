<template>
    <div class="project__detail-component"  v-if="clientWidth > 767 || isvisible === true">
        <a href="#" @click.prevent="scrollToBottom" class="btn-scroll-to-bottom" v-if="clientWidth < 767">
            {{$t('general.scroll_to_bottom')}}
        </a>
        <div v-if="!currentCompany?.planFeature?.projectDetailsView">
            <UpgradePlan
                :buttonText="$t('Upgrades.upgrade_your_plan')"
                :lastTitle="$t('conformationmsg.unlock_project_detail_view')"
                :secondTitle="$t('Upgrades.unlimited')"
                :firstTitle="$t('Upgrades.upgrade_to')"
                :message="$t('Upgrades.the_feature_not_available')"
            />
        </div>
        <template v-else>
            <Description
                ref="editorRef"
                v-if="checkPermission('project.project_description',projectData.isGlobalPermission) !== null"
                :editPermission="checkPermission('project.project_description',projectData.isGlobalPermission) === true"
                :description="projectData?.descriptionBlock ? projectData?.descriptionBlock : projectData?.description"
                :minlength="10"
                :projectData="projectData"
                :from="'project'"
            />
            <CheckListComponent 
                v-if="checkPermission('project.project_checklist',projectData.isGlobalPermission) !== null"
                :data="checkList"
                :permission="checkPermission('project.project_checklist',projectData?.isGlobalPermission) === true"
                :planCondition="currentCompany?.planFeature?.checkList ?? currentCompany?.planFeature?.taskCheckList"
            />
            <Attachments
                class="mt-20px"
                v-if="checkPermission('project.project_attachments',projectData.isGlobalPermission) !== null"
                :permission="checkPermission('project.project_attachments',projectData.isGlobalPermission)"
                :extensions="fileExtentions"
                :attachments="projectData.attachments"
                @update:add="(files) => newAttachments(files)"
                @update:delete="(file) => deleteAttachments(file)"
                :isSpinner="isSpinner"
                :selectedData="projectData"
                @seAll="(val)=>{openSeeAll(val)}"
                @updateProjectAttachment="(val) => handleAttachment(val)"
                :isMainSpinner="isAttachmentSpinner"
            />
            <div class="milestone__fixhourly-wrapper" v-if="checkApps('Milestones')">
                <h5 v-if="projectData.ProjectType === 'Fix' && checkPermission('project.project_milestone',projectData.isGlobalPermission) !== null ||
                    projectData.ProjectType === 'Hourly' && checkPermission('project.project_milestone',projectData.isGlobalPermission) !== null" class="milestone_font">
                    {{$t("Milestone.milestone")}}
                </h5>
                <FixMilestone
                    v-if="projectData.ProjectType === 'Fix' && checkPermission('project.project_milestone',projectData.isGlobalPermission) !== null"
                    :permissionData="checkPermission('project.project_milestone',projectData.isGlobalPermission)"
                    :currency="projectData.ProjectCurrency"
                    :projectId="projectData._id"
                    :ProjectName="projectData.ProjectName"
                    :planCondition="currentCompany?.planFeature?.milestone"
                    :currencyValue="projectData?.ProjectCurrency?.symbol || ''"
                    @updateTotalDifference="updateTotalDifference"
                />

                <HourlyMilestone
                    v-if="projectData.ProjectType === 'Hourly' && checkPermission('project.project_milestone',projectData.isGlobalPermission) !== null"
                    :currency="projectData.ProjectCurrency"
                    :projectDataMilestone="projectData"
                    :permissionData="checkPermission('project.project_milestone',projectData.isGlobalPermission)"
                    :billingPeriodHourly="billingPeriodPro"
                    :startDate="startDateProject"
                    :planCondition="currentCompany?.planFeature?.milestone"
                    :currencyValue="projectData?.ProjectCurrency?.symbol || ''"
                    @updateTotalDifference="updateTotalDifference"
                />
            </div>
            <!-- Milestones app available on the plan but not switched on for this project: representational teaser. -->
            <div class="milestone__fixhourly-wrapper" v-else-if="getAppState('Milestones', projectData) === 'disabled' && checkPermission('project.project_milestone',projectData.isGlobalPermission) !== null">
                <AppTeaserBlock appKey="Milestones" />
            </div>
            <ProjectDetailRightSide v-if="activeTab === 'ProjectDetail' && clientWidth <= 767 && activeTab !== 'Calendar'" :projectData="projectData" @rightSideBarEmit="rightSideBarEmit" @description="handleDescription" />
        </template>
    </div>
</template>

<script setup>
    import { defineProps , inject , computed,watch, ref} from 'vue';
    import { useStore } from 'vuex';
    import { useToast } from 'vue-toast-notification';
    import Description  from '@/components/atom/Description/Description.vue';
    import Attachments from '@/components/atom/Attachments/Attachments.vue';
    import FixMilestone from '@/components/organisms/FixMilestone/FixMilestone.vue';
    import HourlyMilestone from '@/components/organisms/HourlyMilestone/HourlyMilestone.vue';
    import CheckListComponent from '@/components/molecules/CheckList/CheckList.vue'
    import UpgradePlan from '@/components/atom/UpgradYourPlanComponent/UpgradYourPlanComponent.vue';
    import AppTeaserBlock from '@/components/molecules/AppTeaserBlock/AppTeaserBlock.vue';
    import * as env from '@/config/env';
    import { apiRequest, apiRequestWithoutCompnay } from '../../../services'
    import Swal from 'sweetalert2';
    import { useCustomComposable, useGetterFunctions } from '@/composable';
    import {storageQueryBuilder,generateFileName} from '@/utils/storageQueryBuild.js';
    import { useI18n } from 'vue-i18n';
    import ProjectDetailRightSide from '@/components/organisms/ProjectDetailRightSide/ProjectDetailRightSide.vue';
    import { projectAttachmentAdd , projectAttachmentChange } from '@/utils/NotificationTemplate';

    const companyId = inject('$companyId');
    const $toast = useToast();
    const {t} = useI18n();
    const isSpinner = ref(false);
    const editorRef = ref();
    const userId = inject('$userId');
    const props = defineProps({
        billingPeriod:{type:String,required: true},
        activeTab:{type:String,required: true},
        startDate:{type:Object,required:false},
        isvisible:{type:Boolean,default:() => true}
    });
    const projectData = inject('selectedProject');
    const { checkPermission, makeUniqueId, checkApps, getAppState, checkBucketStorage, sanitizeInput } = useCustomComposable();
    const { getters,commit } = useStore();
    const checkList = computed(() => projectData.value.checklistArray)
    const currentCompany = computed(() => getters["settings/selectedCompany"])
    const clientWidth = inject("$clientWidth");
    const emit = defineEmits(["openSeeAllProject","rightSideBarEmit","description"])
    const billingPeriodPro = ref('');
    const startDateProject = ref({});
    const isAttachmentSpinner = ref(false);
    const {getUser} = useGetterFunctions();
    const user = getUser(userId.value);
    const userData = {
        id: user.id,
        Employee_Name: user.Employee_Name,
        companyOwnerId: user.companyOwnerId
    }
    watch(() => props.billingPeriod, (newval) => {
        billingPeriodPro.value = newval;
    });
    watch(() => props.startDate,(newValue) => {
        startDateProject.value = newValue;
    });
    watch(
      () => projectData.value._id,(newVal,oldVal) => {
        if (oldVal !== newVal) {
          isSpinner.value = false;
        }
      }
    );
    const fileExtentions = computed(() => {
        return getters['settings/fileExtentions'];
    });

    const scrollToBottom = () => {
        const targetDiv = document.querySelector('.project__detail-component');
        if (targetDiv) {
            targetDiv.scrollTo({
                top: targetDiv.scrollHeight,
                behavior: 'smooth'
            });
        }
    }

    const newAttachments = (files) => {
        if(!files.length) {
            return;
        }
        let fileList = Array.from(files);
        if(checkBucketStorage(fileList.map(file => file?.size),{gettersVal: getters}) !== true){
            return;
        }
        let projectdata = JSON.parse(JSON.stringify(projectData.value));
        const count = ref(0);
        let isUpload = true;
        isSpinner.value = true;
        const countFun = (file) => {
            if(count.value >= fileList.length) {
                if(isUpload === true){
                    $toast.success(t('Toast.Attachments_uploaded_successfully'),{position: 'top-right'});
                    // If we have update API. That time remove below code.
                    try {
                        apiRequest("post",env.CACHECLEAR, {
                            "isPrefix": true,
                            "cacheKey": "UserProjectData:"
                        });
                    } catch (error) {
                        console.error("Error in cacheClear add new attachment Project",error);
                    }
                }else{
                    $toast.error(t('Toast.Please_try_again'),{position: 'top-right'});
                }
                isSpinner.value = false;
                return;
            } else {
                let fileName = generateFileName(file.name,env.STORAGE_TYPE);
                const extension = fileName.substring(fileName.lastIndexOf(".") + 1);
                const fileType = file.type;
                const endIndex = fileType.indexOf("/");
                const result = fileType.substring(0, endIndex);
                let imagObj = {
                    filename: file.name,
                    extension: extension,
                    size: file.size,
                    id: makeUniqueId(17),
                    createdAt: new Date(),
                    userId: userId.value,
                    type: result
                }
                const formData = new FormData();
                formData.append("companyId", companyId.value);
                formData.append("path", `Project/${projectdata._id}/ProjectAttachment/${fileName}`);
                formData.append("file", file);
                if(file.type.includes("image")) {
                    formData.append("key", "attachmentIcon");
                }
                try {
                    apiRequestWithoutCompnay("post", storageQueryBuilder('upload').route, formData, "form").then(async (response)=>{
                        if(response.data.status === true) {
                            try {
                                if(file.type.includes("image")) {
                                    if(env.STORAGE_TYPE && env.STORAGE_TYPE === 'server') {
                                        imagObj.url = response.data.statusText;
                                    } else {
                                        imagObj.url = response.data.statusText[0];
                                    }
                                } else {
                                    imagObj.url = response.data.statusText;
                                }

                                const params = {
                                    updateObject: {
                                        attachments: imagObj
                                    },
                                    key: '$push'
                                }

                                apiRequest("put", `${env.PROJECT}/${projectdata._id}`, params).then(() => {                                    
                                    projectData.value.attachments.push(imagObj)
                                    commit('projectData/projectLocalUpdate', { op: "modified", itemData: { ...projectData.value } });

                                    let historyObj = {
                                        key : "Project_Attachment",
                                        message : `<b>${userData.Employee_Name}</b> has attached <b>${file.name}</b> on <b>${sanitizeInput(projectdata.ProjectName)}</b>.`
                                    }
                                    apiRequest("post", env.HANDLE_HISTORY, {
                                        "type": 'project',
                                        "companyId": companyId.value,
                                        "projectId": projectdata._id,
                                        "taskId": null,
                                        "object": historyObj,
                                        "userData": userData
                                    }).then(() => {
                                        count.value++;
                                        countFun(fileList[count.value]);
                                    })
                                })
                                .catch((err) => {
                                    count.value++;
                                    countFun(fileList[count.value]);
                                    console.error(err, "Error in upload project attachment");
                                })
                                let notifyObj = {
                                    url: file.name,
                                    ProjectName : projectdata.ProjectName
                                }
                                let notificationObject = {
                                    message: projectAttachmentAdd(notifyObj),
                                    key: "attachments",
                                };
                                
                                apiRequest("post", env.HANDLE_NOTIFICATION, {
                                    type: 'project',
                                    companyId: companyId.value,
                                    projectId: projectdata._id,
                                    object: notificationObject,
                                    userData: userData,
                                    changeType:'name',
                                    changeData: notifyObj
                                })
                                .catch((error) => {
                                    console.error("ERROR in update notification", error);
                                })
                                isUpload = true;
                            } catch (error) {
                                console.error("ERROR: ", error);
                            }
                        } else {
                            isUpload = false;
                            count.value++;
                            countFun(fileList[count.value]);
                            isSpinner.value = false;
                            console.error(response,"Error");
                        }
                    }).catch((err)=>{
                        isUpload = false;
                        count.value++;
                        countFun(fileList[count.value]);
                        isSpinner.value = false;
                        console.error(err,"Error");
                    })
                } catch (error) {
                    isUpload = false;
                    isSpinner.value = false;
                    count.value++;
                    countFun(fileList[count.value]);
                    console.error("Error uploading file:", error);
                }
            }
        }
        countFun(fileList[count.value]);
    }

    const deleteAttachments = (attachment) => {
        Swal.fire({
            title: t(`conformationmsg.are_you_sure`),
            text: `${t('Toast.Are_you_sure_to_delete_this_file')}`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#3085d6',
            cancelButtonColor: '#d33',
            cancelButtonText: t('Projects.cancel'),
            confirmButtonText: t('conformationmsg.yes_delete')
        }).then((result)=>{
            if (result.isConfirmed) {
                isSpinner.value = true;

                let axiousObject = storageQueryBuilder('delete',companyId.value,((env.STORAGE_TYPE && env.STORAGE_TYPE === 'server') ? (attachment.url + "&thubmkey=attachmentIcon") : attachment.url));

                apiRequest(axiousObject.method, axiousObject.route, axiousObject.data).then(async (response)=>{
                    if (response.data.status === true) {
                        const params = {
                            updateObject: {
                                attachments: { id: attachment.id }
                            },
                            key: '$pull'
                        }

                        apiRequest("put", `${env.PROJECT}/${projectData.value._id}`, params).then(() => {
                            isSpinner.value = false;

                            const indx = projectData.value.attachments.findIndex((x) => x.id === attachment.id)
                            if (indx !== -1) {
                                projectData.value.attachments.splice(indx, 1)
                            }
                            commit('projectData/projectLocalUpdate', { op: "modified", itemData: { ...projectData.value } });
                            let historyObj = {
                                key : "Project_Attachment",
                                message : `<b>${userData.Employee_Name}</b> has deleted <b>${attachment.filename}</b> on <b>${sanitizeInput(projectData.value.ProjectName)}</b>.`
                            }
                            apiRequest("post", env.HANDLE_HISTORY, {
                                "type": 'project',
                                "companyId": companyId.value,
                                "projectId": projectData.value._id,
                                "taskId": null,
                                "object": historyObj,
                                "userData": userData
                            })
                            let notifyObj = {
                                    removeFileName: attachment.filename,
                                    ProjectName : projectData.ProjectName
                                }
                                let notificationObject = {
                                    message: projectAttachmentChange(notifyObj),
                                    key: "attachments",
                                };
                                
                                apiRequest("post", env.HANDLE_NOTIFICATION, {
                                    type: 'project',
                                    companyId: companyId.value,
                                    projectId: projectData._id,
                                    object: notificationObject,
                                    userData: userData,
                                    changeType:'name',
                                    changeData: notifyObj
                                })
                                .catch((error) => {
                                    console.error("ERROR in update notification", error);
                                })
                            $toast.success(t('Toast.Attchments_deleted_successfully'),{position: 'top-right'});
                        })
                    } else {
                        isSpinner.value = false;
                        $toast.error(t('Toast.something_went_wrong'),{position: 'top-right'});
                    }
                }).catch((err)=>{
                    isSpinner.value = false;
                    console.error(err,"ERROR IN DELETE ATTACHMENTS");
                })
            }
        })
    }

    const handleAttachment = (val) => {
        isAttachmentSpinner.value = val;
    }

    function openSeeAll(data) {
        if(data === 'project'){
            emit("openSeeAllProject" )
        }
    }
    const rightSideBarEmit = (val,data) => {
        emit('rightSideBarEmit',val,data)
    }
    const handleDescription = (val) => {
        emit('description',val)
    }
    const updateTotalDifference = (val) => {
        projectData.value.milestoneAmount = val;
    }
</script>
<style scoped>
.project__detail-component{
    padding: 20px 18.5px;
}
</style>