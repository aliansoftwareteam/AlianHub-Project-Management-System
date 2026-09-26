<template>
    <div class="project__detail-component"  v-if="clientWidth > 767 || isvisible === true">
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
            <ProjectMemoryCard
                v-if="checkPermission('project.project_details',projectData.isGlobalPermission) !== null && projectData?._id"
                :projectId="String(projectData._id)"
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
                @update:cloud-add="(payload) => newCloudAttachments(payload)"
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
    import ProjectMemoryCard from './ProjectMemoryCard.vue';
    import Attachments from '@/components/atom/Attachments/Attachments.vue';
    import FixMilestone from '@/components/organisms/FixMilestone/FixMilestone.vue';
    import HourlyMilestone from '@/components/organisms/HourlyMilestone/HourlyMilestone.vue';
    import CheckListComponent from '@/components/molecules/CheckList/CheckList.vue'
    import UpgradePlan from '@/components/atom/UpgradYourPlanComponent/UpgradYourPlanComponent.vue';
    import AppTeaserBlock from '@/components/molecules/AppTeaserBlock/AppTeaserBlock.vue';
    import * as env from '@/config/env';
    import { apiRequest, apiRequestWithoutCompnay } from '../../../services'
    import Swal from 'sweetalert2';
    import { useCustomComposable } from '@/composable';
    import {storageQueryBuilder,generateFileName} from '@/utils/storageQueryBuild.js';
    import { buildCloudAttachment, isCloudAttachment, cloudTypeOf, CLOUD_PROVIDERS } from '@/utils/cloudAttachment';
    import { importCloudFile } from '@/composable/cloudPicker';
    import { useI18n } from 'vue-i18n';
    import ProjectDetailRightSide from '@/components/organisms/ProjectDetailRightSide/ProjectDetailRightSide.vue';

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
    const { checkPermission, makeUniqueId, checkApps, getAppState, checkBucketStorage } = useCustomComposable();
    const { getters,commit } = useStore();
    const checkList = computed(() => projectData.value.checklistArray)
    const currentCompany = computed(() => getters["settings/selectedCompany"])
    const clientWidth = inject("$clientWidth");
    const emit = defineEmits(["openSeeAllProject","rightSideBarEmit","description"])
    const billingPeriodPro = ref('');
    const startDateProject = ref({});
    const isAttachmentSpinner = ref(false);
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

    /**
     * AHE-3838 — attach files picked from a cloud drive to the project.
     *
     *   mode 'link'   (default) store a reference; the bytes stay with the
     *                 provider. No upload, and deliberately no
     *                 checkBucketStorage — a link stores nothing of ours, so it
     *                 must not draw down the company's storage quota.
     *   mode 'import' the server copies the bytes into our storage and the
     *                 record becomes an ordinary attachment with no `source`.
     *                 This one DOES consume quota, so it is checked.
     *
     * Either way the record is written with the same $push + history calls the
     * upload path uses.
     */
    const newCloudAttachments = async ({ provider, files, mode = 'link' } = {}) => {
        if (!provider || !files || !files.length) return;

        // Importing copies bytes into our storage, so unlike linking it DOES
        // consume the company's quota and has to be checked first.
        if (mode === 'import' && checkBucketStorage(files.map((f) => f?.size || 0), { gettersVal: getters }) !== true) {
            return;
        }

        const projectdata = JSON.parse(JSON.stringify(projectData.value));
        isSpinner.value = true;
        let attached = 0;

        // Sequential: each $push re-reads the project document, so parallel writes
        // would lose records.
        for (const file of files) {
            try {
                let record;
                if (mode === 'import') {
                    // Server pulls the bytes into our storage; the result is an
                    // ORDINARY attachment with no `source`.
                    const storedName = generateFileName(file.name, env.STORAGE_TYPE);
                    const imported = await importCloudFile({
                        provider,
                        fileId: file.id,
                        filename: file.name,
                        path: `Project/${projectdata._id}/ProjectAttachment/${storedName}`,
                        // Dropbox only — see TaskDetailTab.
                        downloadUrl: file.downloadUrl || '',
                    });
                    record = {
                        filename: file.name,
                        extension: storedName.substring(storedName.lastIndexOf(".") + 1),
                        size: imported.size || file.size || 0,
                        id: makeUniqueId(17),
                        createdAt: new Date(),
                        userId: userId.value,
                        type: cloudTypeOf(file.mimeType),
                        url: imported.url,
                    };
                } else {
                    record = buildCloudAttachment({ provider, file, userId: userId.value, id: makeUniqueId(17) });
                }
                await apiRequest("put", `${env.PROJECT}/${projectdata._id}`, {
                    updateObject: { attachments: record },
                    key: '$push',
                });
                projectData.value.attachments.push(record);
                commit('projectData/projectLocalUpdate', { op: "modified", itemData: { ...projectData.value } });
                attached += 1;
            } catch (error) {
                console.error("Error attaching cloud file to project: ", error);
            }
        }

        isSpinner.value = false;
        const label = CLOUD_PROVIDERS[provider]?.label || provider;
        if (attached > 0) {
            $toast.success(t('Attachments.cloud_attached', { provider: label }), { position: 'top-right' });
        } else {
            $toast.error(mode === 'import'
                ? t('Attachments.import_failed', { provider: label })
                : t('Attachments.cloud_attach_failed'), { position: 'top-right' });
        }
    };

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
                                    count.value++;
                                    countFun(fileList[count.value]);
                                })
                                .catch((err) => {
                                    count.value++;
                                    countFun(fileList[count.value]);
                                    console.error(err, "Error in upload project attachment");
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

                // Dropping the attachment record. Body unchanged — only the
                // storage-delete step that used to wrap it is now conditional.
                const removeRecord = () => {
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
                        $toast.success(t('Toast.Attchments_deleted_successfully'),{position: 'top-right'});
                    })
                };

                // AHE-3838 — a cloud-linked attachment owns no object in our
                // storage and its `url` is empty, so asking the storage layer to
                // delete it would just fail and strand the record. Removing the
                // link never touches the file in the user's drive.
                if (isCloudAttachment(attachment)) {
                    removeRecord();
                    return;
                }

                let axiousObject = storageQueryBuilder('delete',companyId.value,((env.STORAGE_TYPE && env.STORAGE_TYPE === 'server') ? (attachment.url + "&thubmkey=attachmentIcon") : attachment.url));

                apiRequest(axiousObject.method, axiousObject.route, axiousObject.data).then(async (response)=>{
                    if (response.data.status === true) {
                        removeRecord();
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