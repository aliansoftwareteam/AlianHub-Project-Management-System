<template>
    <div>
        <div class="createProjectListSidebarContentWrapper">
            <a href="#" @click.prevent="scrollToBottom" class="btn-scroll-to-bottom" :style="{paddingBottom: checkApps('tags') ? '15px' : ''}" v-if="clientWidth < 767">
                {{$t('general.scroll_to_bottom')}}
            </a>
            <div class="d-flex mobile__bg--withPadding" v-if="checkApps('tags')">
                <div class="d-flex align-items-center overflow-auto style-scroll tagList__main-wrapper-sidebar pb-1px">
                    <div v-for="(item, index) in tagChipArray" :key="index" @click.stop="">
                        <div class="tagList taglist__mobile-margin">
                            <TagChip  :data="item" :isBorder="false" :ids="ids"  :tagsArray="projectData.tagsArray" :prjectGlobalPermission="projectData?.isGlobalPermission" :taskId="task._id" :sprintId="task.sprintId" :taskName="task.TaskName"/>
                        </div>
                    </div>
                </div>
                <template v-if="checkPermission('task.task_tag',projectData?.isGlobalPermission) !== null">
                    <CreateTagPopup :task="task" @send:tagChipArray="(val)=>tagChipArray = val"  @send:ids="(val)=>ids = val" :project="projectData" :isTaskList="false" />
                </template>
            </div>
            <!-- Tags app available on the plan but not switched on for this project: representational teaser. -->
            <AppTeaserBlock
                v-else-if="getAppState('tags', projectData) === 'disabled'"
                appKey="tags" class="mb-1"
            />
            <Description
                v-if="checkPermission('task.task_description',projectData?.isGlobalPermission) !== null && checkApps('AI',projectData) !== undefined && checkPermission('task.task_description',projectData?.isGlobalPermission) !== undefined && Object.keys(projectData).length > 0"
                :isShowAi="checkApps('AI',projectData) && checkPermission('task.task_description',projectData?.isGlobalPermission) == true"
                :description="task?.descriptionBlock ? task.descriptionBlock : task.description"
                :editPermission="checkPermission('task.task_description',projectData?.isGlobalPermission)"
                :minlength="10"
                :projectData="projectData"
                :from="'task'"
                class="description-comp"
                :task="task"
                :isMainSpinner="isMainSpinner"
            />
            <SubTasks
                v-if="task.isParentTask && checkPermission('task.sub_task_create',projectData?.isGlobalPermission) !== null"
                :task="task"
                class="mt-1"
                :parentAssignee="task.AssigneeUserId"
                :subTasksArray="subTasksArray"
                :isMainSpinner="isMainSpinner"
            />
            <LinkedTasks
                :task="task"
                class="mt-1"
            />
            <EpicPicker
                :task="task"
                class="mt-1"
            />
            <div class="position-re" v-if="checkPermission('task.task_custom_field',projectData?.isGlobalPermission) !== null">
                <!-- App enabled for this project: existing behavior (feature, or blurred feature + upgrade overlay when the plan doesn't include it). -->
                <div v-if="checkApps('CustomFields')">
                    <div :class="[{'pointer-event-none opacity-5 blur-3-px':!currentCompany?.planFeature?.customFields}]">
                        <CustomFieldRenderViewComponent
                            @blurUpdate="submitHandler"
                            @editCustomField="editCustomField"
                            :task="props.task"
                            @isCustomField="isCustomField = true"
                            :editPermission="checkPermission('task.task_custom_field',projectData?.isGlobalPermission)"
                            :planPermission="currentCompany?.planFeature?.customFields"
                        />
                    </div>
                    <div v-if="!currentCompany?.planFeature?.customFields">
                        <UpgradePlan
                            :isImage="false"
                            :buttonText="$t('Upgrades.upgrade_your_plan')"
                            :lastTitle="$t('Upgrades.unlock_custom_field')"
                            :secondTitle="$t('Upgrades.unlimited')"
                            :firstTitle="$t('Upgrades.upgrade_to')"
                            :message="$t('Upgrades.the_feature_not_available')"
                        />
                    </div>
                </div>
                <!-- App available on the plan but not switched on for this project: representational teaser. -->
                <AppTeaserBlock
                    v-else-if="getAppState('CustomFields', projectData) === 'disabled'"
                    appKey="CustomFields"
                />
            </div>
            <CheckListComponent 
                v-if="checkPermission('task.task_checklist',projectData?.isGlobalPermission) !== null"
                :taskId="task._id"
                :sprintId="task.sprintId"
                :data="checkList"
                :task="task"
                :permission="checkPermission('task.task_checklist',projectData?.isGlobalPermission) === true"
                :isSpinnerAi="isSpinnerAi"
                :planCondition="currentCompany?.planFeature?.checkList ?? currentCompany?.planFeature?.taskCheckList"
                :isMainSpinner="isMainSpinner"
            />
            <Attachments
                class="mt-20px"
                v-if="checkPermission('task.task_attachments',projectData?.isGlobalPermission) !== null"
                :permission="checkPermission('task.task_attachments',projectData?.isGlobalPermission)"
                :attachments="task.attachments"
                :extensions="fileExtentions"
                @update:add="(files) => newAttachments(files)"
                @update:cloud-add="(payload) => newCloudAttachments(payload)"
                @update:delete="(file) => deleteAttachments(file)"
                @seAll="(val)=>{openSeeAll(val)}"
                @record-clip="onRecordClip"
                :isSpinner="isSpinner"
                :selectedData="task"
            />
        </div>
    </div>
    <CustomFieldsSidebarComponent
        @customFieldStore="customFieldStore"
        @closeSidebar="handleCloseSidebar"
        :componentDetail="componentDetail && Object.keys(componentDetail).length ? componentDetail : {}"
        :customFieldObject="componentDetail && Object.keys(componentDetail).length ? customFieldObject : {}"
        :isCustomField="isCustomField"
        @handleClose="handleClose()"
    />
    <PromptSidebar v-if="isOpenPromptDeatil" @closePrompt="isOpenPromptDeatil = false" :selectedPrompt="selectedPrompt" @closeMainSidebar="isOpenPromptDeatil = false" :project="projectData" :task="task" />
</template>

<script setup>
// PACKAGES
import Swal from 'sweetalert2';
import { useStore } from 'vuex';
import { useToast } from 'vue-toast-notification';
import { computed, defineProps, inject, ref, nextTick,onMounted, watch } from 'vue';

// COMPONENTS
import { dbCollections } from '@/utils/Collections';
import Description from '@/components/atom/Description/Description.vue'
import Attachments from '@/components/atom/Attachments/Attachments.vue'
import CheckListComponent from '@/components/molecules/CheckList/CheckList.vue'
import SubTasks from '@/components/organisms/SubTasks/SubTasks.vue'
import LinkedTasks from '@/components/organisms/LinkedTasks/LinkedTasks.vue'
import EpicPicker from '@/components/molecules/Epics/EpicPicker.vue'
import CreateTagPopup from "@/components/molecules/TagList/CreateTagPopup.vue";
import TagChip from '@/components/atom/TagChip/TagChip.vue'
import PromptSidebar from "@/components/molecules/PromptSidebar/PromptSidebar.vue";
import { apiRequest, apiRequestWithoutCompnay } from '../../../services';
import * as env from '@/config/env';
import axios from 'axios';

// UTILS
import { useCustomComposable, useGetterFunctions } from '@/composable';
import taskClass from '@/utils/TaskOperations';
import UpgradePlan from '@/components/atom/UpgradYourPlanComponent/UpgradYourPlanComponent.vue';
import AppTeaserBlock from '@/components/molecules/AppTeaserBlock/AppTeaserBlock.vue';
import {storageQueryBuilder,generateFileName} from '@/utils/storageQueryBuild.js';
import { buildCloudAttachment, isCloudAttachment, cloudTypeOf, CLOUD_PROVIDERS } from '@/utils/cloudAttachment';
import { importCloudFile } from '@/composable/cloudPicker';
import { useClipRecorder } from '@/composables/useClipRecorder';
import { useI18n } from 'vue-i18n';


const $toast = useToast();
const {t} = useI18n();
const { getters,commit } = useStore();
const { getUser } = useGetterFunctions();
const { checkPermission, makeUniqueId, checkBucketStorage,checkApps,getAppState } = useCustomComposable();
const { openRecorder } = useClipRecorder();

// props
const props = defineProps({
    task: {
        type: Object,
        required: true,
    },
    isSupport:{
        type:Boolean,
        default:false
    },
    subTasksArray: {
        type: Array,
        default: () => []
    },
    isMainSpinner:{
        type:Boolean,
        default:false
    }
});

// emit
const emit = defineEmits(["openSeeAll"]);

//computed
const fileExtentions = computed(() => {
    return getters['settings/fileExtentions'];
});
const companyOwner = computed(() => {
    return getters["settings/companyOwnerDetail"];
});
const checkList = computed(() => props.task.checklistArray);
const currentCompany = computed(() => getters["settings/selectedCompany"]);
const projectsGetter = computed(() => getters["projectData/onlyActiveProjects"]);
const showCustomField = computed(() => checkPermission("task.task_custom_field", projectData.value?.isGlobalPermission, {gettersVal: getters}));

// ref
const ids = ref();
const tagChipArray = ref();
const isSpinner = ref(false);
const submitted = ref(false);
const componentDetail = ref({});
const customFieldObject = ref({});
const isCustomField = ref(false);
const allProjectsArrayFilter = ref([]);
const CustomFieldData = ref(JSON.parse(JSON.stringify(getters["settings/customFields"])));
const selectedProject = ref([])
const isOpenPromptDeatil = ref(false);
const selectedPrompt = ref({})
const isSpinnerAi = ref(false);

// inject
const userId = inject('$userId');

// Recently-visited tracking — fire-and-forget on every task open.
function recordRecentVisit() {
    if (!props.task?._id) return;
    const user = getUser(userId.value);
    apiRequest('post', '/api/v2/recent-visits', {
        entityType: 'task',
        entityId: props.task._id,
        userData: { id: user.id },
    }).catch((error) => {
        console.error('ERROR in record recent visit: ', error);
    });
}
onMounted(recordRecentVisit);
watch(() => props.task?._id, recordRecentVisit);
const companyId = inject('$companyId');
const clientWidth = inject("$clientWidth");
const projectData = inject("selectedProject");

//getUser
const user = getUser(userId.value);

onMounted(() => {
    let data = {
        type: dbCollections.PROJECTS,
        data: [{ _id: process.env.VUE_APP_SUPPORT_PROJECTID}],
    };
    const axiosData = {
        dataObj: data.data,
        dbName: process.env.VUE_APP_SUPPORT_COMPANYID,
        collection: data.type,
        methodName: "findOne",
    };
    axios.post(env.API_URI + env.MONGO_OPRATION, axiosData).then((response) => {
        selectedProject.value.push(response.data.statusText)
    });
    if(props.isSupport === true){
        allProjectsArrayFilter.value = selectedProject.value;
    }else{
        allProjectsArrayFilter.value = JSON.parse(JSON.stringify(projectsGetter.value.data))
    }
})

const scrollToBottom = () => {
    const targetDiv = document.querySelector('.task-detail-leftside');
    if (targetDiv) {
        targetDiv.scrollTo({
            top: targetDiv.scrollHeight,
            behavior: 'smooth'
        });
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
    const count = ref(0);
    let isUpload = true;
    const countFun = (file) => {
        if(count.value >= fileList.length) {
            if(isUpload === true){
                $toast.success(t('Toast.Attachments_uploaded_successfully'),{position: 'top-right'});
            }else{
                $toast.error(t('Toast.Please_try_again'),{position: 'top-right'});
            }
            isSpinner.value = false;
            return;
        } else {
            isSpinner.value = true;
            let fileName = generateFileName(file.name,env.STORAGE_TYPE);
            const extension = fileName.substring(fileName.lastIndexOf(".") + 1);
            const fileType = file.type;
            const endIndex = fileType.indexOf("/");
            const result = fileType.substring(0, endIndex);

            let imagObj = {
                filename: file.name,
                extension: extension,
                size:file.size,
                id: makeUniqueId(17),
                createdAt: new Date(),
                userId: userId.value,
                type: result
            }
            const formData = new FormData();
            formData.append("companyId", companyId.value);
            if(file.type.includes("image")) {
                formData.append("key", "attachmentIcon");
            }
            formData.append("path", `Project/${props.task.ProjectID}/Sprint/${props.task._id}/Attachment/${fileName}`);
            formData.append("file", file);
            try {
                apiRequestWithoutCompnay("post", storageQueryBuilder('upload').route, formData, "form").then((response)=>{
                    if(response.data.status === true){
                        let findIndex = allProjectsArrayFilter.value.findIndex((ele)=>{return ele.id === props?.task?.ProjectID});
                        isUpload = true;
                        if(file.type.includes("image")) {
                            if(env.STORAGE_TYPE && env.STORAGE_TYPE === 'server') {
                                imagObj.url = response.data.statusText;
                            } else {
                                imagObj.url = response.data.statusText[0];
                            }
                        } else {
                            imagObj.url = response.data.statusText;
                        }
                        taskClass.updateAttachments({
                            companyId: companyId.value,
                            sprintId: props.task.sprintId,
                            taskId: props.task._id,
                            taskData: props.task,
                            operation: "add",
                            data: imagObj,
                            userData: {
                                id: user.id,
                                name: user.Employee_Name,
                                companyOwnerId: companyOwner.value._id,
                            },
                            projectData: {
                                id: findIndex == -1 ? projectData.value._id : allProjectsArrayFilter.value[findIndex]._id,
                                ProjectName: findIndex == -1 ? projectData.value.ProjectName : allProjectsArrayFilter.value[findIndex].ProjectName
                            }
                        }).then(() => {
                            count.value++;
                            countFun(fileList[count.value]);
                        }).catch((error) => {
                            console.error("Error in updating Attachment: ", error);
                            count.value++;
                            countFun(fileList[count.value]);
                        });
                    }else{
                        isUpload = false;
                        count.value++;
                        countFun(fileList[count.value]);
                        isSpinner.value = false;
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
};

/**
 * AHE-3838 — attach files LINKED from a cloud drive. No upload step: the bytes
 * stay with the provider, so this only writes the attachment record.
 *
 * Reuses taskClass.updateAttachments (the same call the upload path makes) so the
 * socket broadcast, history entry and cache clear all behave identically.
 *
 * Deliberately no checkBucketStorage() call — a link stores nothing of ours, so
 * it must not consume the company's storage quota.
 */
const newCloudAttachments = async ({ provider, files, mode = 'link' } = {}) => {
    if (!provider || !files || !files.length) return;

    // Importing copies bytes into our storage, so unlike linking it DOES consume
    // the company's quota and has to be checked first.
    if (mode === 'import' && checkBucketStorage(files.map((f) => f?.size || 0), { gettersVal: getters }) !== true) {
        return;
    }

    const findIndex = allProjectsArrayFilter.value.findIndex((ele) => ele.id === props?.task?.ProjectID);
    const userInfo = {
        id: user.id,
        name: user.Employee_Name,
        companyOwnerId: companyOwner.value._id,
    };
    const projectInfo = {
        id: findIndex === -1 ? projectData.value._id : allProjectsArrayFilter.value[findIndex]._id,
        ProjectName: findIndex === -1 ? projectData.value.ProjectName : allProjectsArrayFilter.value[findIndex].ProjectName,
    };

    isSpinner.value = true;
    let attached = 0;
    // Sequential on purpose: updateAttachments does a read-modify-write of the
    // task's attachments array, so concurrent calls would drop records.
    for (const file of files) {
        try {
            let record;
            if (mode === 'import') {
                // Server pulls the bytes and stores them exactly where an upload
                // would have. The result is an ORDINARY attachment — no `source`,
                // nothing cloud-specific about it from here on.
                const storedName = generateFileName(file.name, env.STORAGE_TYPE);
                const imported = await importCloudFile({
                    provider,
                    fileId: file.id,
                    filename: file.name,
                    path: `Project/${props.task.ProjectID}/Sprint/${props.task._id}/Attachment/${storedName}`,
                    // Dropbox only: the temporary direct link the Chooser returned,
                    // since it gives us no token to authenticate a download with.
                    downloadUrl: file.downloadUrl || '',
                });
                const extension = storedName.substring(storedName.lastIndexOf(".") + 1);
                record = {
                    filename: file.name,
                    extension,
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
            await taskClass.updateAttachments({
                companyId: companyId.value,
                sprintId: props.task.sprintId,
                taskId: props.task._id,
                taskData: props.task,
                operation: "add",
                data: record,
                userData: userInfo,
                projectData: projectInfo,
            });
            attached += 1;
        } catch (error) {
            console.error("Error attaching cloud file: ", error);
        }
    }
    isSpinner.value = false;

    if (attached > 0) {
        const label = CLOUD_PROVIDERS[provider]?.label || provider;
        $toast.success(t('Attachments.cloud_attached', { provider: label }), { position: 'top-right' });
    } else {
        $toast.error(mode === 'import'
            ? t('Attachments.import_failed', { provider: CLOUD_PROVIDERS[provider]?.label || provider })
            : t('Attachments.cloud_attach_failed'), { position: 'top-right' });
    }
};

// Record-from-task: open the GLOBAL recorder with this task as the target. When
// the user saves, the clip is uploaded once + recorded globally (My Clips), and
// the returned clip record is attached to THIS task via attachClipToTask.
const onRecordClip = () => {
    openRecorder(
        { type: "task", taskId: props.task._id, projectId: props.task.ProjectID },
        (clip) => attachClipToTask(clip)
    );
};

// Attach an already-uploaded clip to the task. Reuses the SECOND half of the
// newAttachments flow: build the same attachment object shape and call the
// existing taskClass.updateAttachments({ operation:'add' }) ($push + socket).
// No upload here — the clip blob was uploaded once by the global recorder.
const attachClipToTask = (clip) => {
    if (!clip || !clip.url) {
        return;
    }
    let findIndex = allProjectsArrayFilter.value.findIndex((ele)=>{return ele.id === props?.task?.ProjectID});
    const imagObj = {
        filename: (clip.title ? `${clip.title}.webm` : `clip-${makeUniqueId(12)}.webm`),
        extension: "webm",
        size: clip.size,
        id: makeUniqueId(17),
        createdAt: new Date(),
        userId: userId.value,
        type: clip.mediaType, // 'video' | 'audio'
        url: clip.url,
    };
    taskClass.updateAttachments({
        companyId: companyId.value,
        sprintId: props.task.sprintId,
        taskId: props.task._id,
        taskData: props.task,
        operation: "add",
        data: imagObj,
        userData: {
            id: user.id,
            name: user.Employee_Name,
            companyOwnerId: companyOwner.value._id,
        },
        projectData: {
            id: findIndex == -1 ? projectData.value._id : allProjectsArrayFilter.value[findIndex]._id,
            ProjectName: findIndex == -1 ? projectData.value.ProjectName : allProjectsArrayFilter.value[findIndex].ProjectName
        }
    }).then(() => {
        $toast.success(t('Toast.Attachments_uploaded_successfully'),{position: 'top-right'});
    }).catch((error) => {
        console.error("Error in attaching clip to task: ", error);
        $toast.error(t('Toast.Please_try_again'),{position: 'top-right'});
    });
};

const deleteAttachments = (attachment) => {
    Swal.fire({
        title: t(`conformationmsg.are_you_sure`),
        text: `${t('Toast.Are_you_sure_to_delete_this_file')} ?`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#3085d6',
        cancelButtonColor: '#d33',
        cancelButtonText: t('Projects.cancel'),
        confirmButtonText: t('conformationmsg.yes_delete')
    }).then((result)=>{
        if (result.isConfirmed) {
            isSpinner.value = true;

            // Dropping the attachment record. Unchanged from before — only the
            // storage-delete step above it is now conditional.
            const removeRecord = () => {
                let findIndex = allProjectsArrayFilter.value.findIndex((ele)=>{return ele._id === props?.task?.ProjectID});
                taskClass.updateAttachments({
                    companyId: companyId.value,
                    sprintId: props.task.sprintId,
                    taskId: props.task._id,
                    taskData: props.task,
                    operation: "remove",
                    id: attachment.id,
                    data: attachment,
                    userData: {
                        id: user.id,
                        name: user.Employee_Name,
                        companyOwnerId: companyOwner.value._id,
                    },
                    projectData: {
                        id: findIndex == -1 ? projectData.value._id : allProjectsArrayFilter.value[findIndex]._id,
                        ProjectName: findIndex == -1 ? projectData.value.ProjectName : allProjectsArrayFilter.value[findIndex].ProjectName
                    }
                }).then(() => {
                    isSpinner.value = false;
                    $toast.success(t('Toast.Attachment_removed_successfully'),{position: 'top-right'});
                }).catch((error) => {
                    console.error("Error in removing Attachment: ", error);
                    $toast.error(t('Toast.Attachment_not_removed'),{position: 'top-right'});
                })
            };

            // AHE-3838 — a cloud-linked attachment owns no object in our storage,
            // so there is nothing to delete there and its `url` is empty. Asking
            // the storage layer to remove it would just fail and leave the record
            // stranded. Removing the link never touches the user's Drive.
            if (isCloudAttachment(attachment)) {
                removeRecord();
                return;
            }

            let axiousObject = storageQueryBuilder('delete',companyId.value,((env.STORAGE_TYPE && env.STORAGE_TYPE === 'server') ? (attachment.url + "&thubmkey=attachmentIcon") : attachment.url));

            apiRequest(axiousObject.method, axiousObject.route, axiousObject.data).then((response)=>{
                if(response.data.status === true){
                    removeRecord();
                }else{
                    isSpinner.value = false;
                    $toast.success(t('Toast.something_went_wrong'),{position: 'top-right'});
                }
            }).catch((err)=>{
                isSpinner.value = false;
                console.error(err,"ERROR IN DELETE ATTACHMENTS");
            })
        }
    })
};
// The custom field value will be submitted to the task collection once all the validations are satisfied.
const submitHandler = async (value,detail,id,edit) => {
    if(showCustomField.value === true){
        if(value && detail.fieldType !== 'checkbox'){
            if(detail.fieldType === 'date'){
                try{
                    detail.fieldValue = new Date(value);
                    insertCustomField(detail,value);
                } catch(error){
                    console.error('ERROR',error);
                }
            }else if(detail.fieldType === 'dropdown'){
                detail.fieldValue = [value.id];
                try {
                    insertCustomField(detail,value);
                } catch(error){
                    console.error('ERROR',error);
                }
            }else if(detail.fieldType === 'number' || detail.fieldType === 'money'){
                try{
                    detail.fieldValue = String(value);
                    insertCustomField(detail,value);
                } catch(error){
                    console.error('ERROR',error);
                }
            }else{
                nextTick(() => {
                    const input = document.getElementById(`${id}`);
                    const ariaDescribedByValue = input.getAttribute('aria-describedby');
                    if(value && ariaDescribedByValue === null){
                        try{
                            if(detail.fieldType === "phone"){
                                if(edit){
                                    detail.fieldValue = "";
                                    detail.fieldCode = value.dialCode;
                                    detail.fieldPattern = value.maskWithDialCode;
                                    detail.fieldFlag = value.code;
                                }else{
                                    detail.fieldValue = detail.fieldValue?.replace(/^\+(\d+)\s|\s|\(|\)|-/g, '');
                                    detail.fieldCode = detail.fieldCode ? detail.fieldCode : detail.fieldCountryCode;
                                    detail.fieldPattern = detail.fieldPattern ? detail.fieldPattern : detail.fieldCountryObject.maskWithDialCode;
                                    detail.fieldFlag = detail.fieldFlag ? detail.fieldFlag : detail.fieldCountryObject.code;
                                }
                            }
                            insertCustomField(detail,value);
                        } catch(error){
                            console.error('ERROR',error);
                        }
                    }
                });
            }
        } else if(detail.fieldType === 'checkbox'){
            try{
                detail.fieldValue = value;
                insertCustomField(detail,value);
            } catch(error){
                console.error('ERROR',error);
            }
        }
    }
};
const insertCustomField = (detail,data) => {
    let updateDetail = {};
    let userData = {
        id: user.id,
        name: user.Employee_Name,
        companyOwnerId: companyOwner.value._id,
    }
    updateDetail.fieldValue = detail.fieldValue;
    if(detail.fieldType === "phone"){
        updateDetail.fieldCode = detail?.fieldCode;
        updateDetail.fieldPattern = detail?.fieldPattern;
        updateDetail.fieldFlag = detail?.fieldFlag;
    }
    updateDetail._id = detail._id;
    taskClass.updateTaskCustomField({taskId: props.task._id, customFieldId: detail._id, updateDetail: updateDetail,companyId:companyId.value,taskObj:props.task,detail:detail}).then((res) => {
        if(res.status){
            let historyObj = {
                'message': `<b>${userData.name}</b> has added value in <b> ${detail.fieldTitle}</b> Custom Field as <b>${data.value ? data.value : data}</b>.`,
                'key' : 'Project_Category',
                'sprintId' : props.task.sprintId
            }
            apiRequest("post", env.HANDLE_HISTORY, {
                "type": 'task',
                "companyId": companyId.value,
                "projectId": props.task.ProjectID,
                "taskId": props.task._id,
                "object": historyObj,
                "userData": userData
            }).catch((err) =>{
                console.error("Error in updating the notification",err);
            })
            $toast.success(t("Toast.Custom_field_updated_successfully"), {position: 'top-right' });
        }else{
            $toast.error(t('Toast.something_went_wrong'), {position: 'top-right' });
        }
        submitted.value = true;
    }).catch((err)=>{
        console.error('Error in updating the custom field',err);
        $toast.error(t('Toast.something_went_wrong'), {position: 'top-right' });
    });
} 
const customFieldStore = async(object,isEdit) => {
    let value = JSON.parse(JSON.stringify(object))
    let userData = {
        id: user.id,
        name: user.Employee_Name,
        companyOwnerId: companyOwner.value._id,
    }
    if(!isEdit){
        try {
            value.global = false;
            value.projectId = [props.task.ProjectID];
            value.createdAt = new Date();
            value.updatedAt = new Date();
            value.userId = userId.value;
            value.type = 'task'
            const object = {
                type: "save",
                updateObject:value
            }
            await apiRequest("post",env.CUSTOM_FIELD,object).then((res) => {
                if(res.status === 200) {
                    value._id = res?.data?._id || '';
                    commit("settings/mutateFinalCustomFields", {data: value || {},op: "added"});
                    $toast.success(t("Toast.Field_Added_Successfully"), {position: 'top-right' });
                    let historyObj = {
                        'message': `<b>${userData.name}</b> has Created <b> Custom Field </b> as <b>${value.fieldTitle}</b> for task.`,
                        'key' : 'Project_CustomField',
                    }
                    apiRequest("post", env.HANDLE_HISTORY, {
                        "type": 'project',
                        "companyId": companyId.value,
                        "projectId": props.task.ProjectID,
                        "taskId": null,
                        "object": historyObj,
                        "userData": userData
                    })
                }else{
                    $toast.error(t('Toast.something_went_wrong'), {position: 'top-right' });
                }
                isCustomField.value = false;
                componentDetail.value={};
                customFieldObject.value={};
            }).catch((err)=>{
                console.error("Error in inserting custom field",err);
                $toast.error(t('Toast.something_went_wrong'), {position: 'top-right' });
            });   
        } catch (error) {
            console.error("Error in inserting custom field",error);
            $toast.error(t('Toast.something_went_wrong'), {position: 'top-right' });
        }
    }else{
        try {
            const oldFieldValue = customFieldObject.value.fieldTitle
            value.updatedAt = new Date();
            const object = {
                type: "updateOne",
                key: "$set",
                updateObject:{
                    ...value
                },
                id:customFieldObject.value._id
            };
            await apiRequest("put",env.CUSTOM_FIELD,object).then((res) => {
                if(res.status === 200){
                    commit("settings/mutateFinalCustomFields", {data: {...customFieldObject.value,...value} || {},op: "modified"});
                    if(oldFieldValue !== value.fieldTitle){
                        let historyObj = {
                            'message': `<b>${userData.name}</b> has Edited <b> Custom Field </b> from <b>${oldFieldValue}</b> to <b>${value.fieldTitle}</b> for task.`,
                            'key' : 'Project_CustomField',
                        }
                        apiRequest("post", env.HANDLE_HISTORY, {
                            "type": 'project',
                            "companyId": companyId.value,
                            "projectId": props.task.ProjectID,
                            "taskId": null,
                            "object": historyObj,
                            "userData": userData
                        })
                    }
                    $toast.success(t("Toast.Field_Updated_Successfully"), {position: 'top-right' })
                }else{
                    $toast.error(t('Toast.something_went_wrong'), {position: 'top-right' });
                }
                isCustomField.value = false;
                componentDetail.value={};
                customFieldObject.value={};
            }).catch((err)=>{
                console.error("Error in updating custom field",err);
                $toast.error(t('Toast.something_went_wrong'), {position: 'top-right' });
            });   
        } catch (error) {
            console.error("Error in updating custom field",error);
            $toast.error(t('Toast.something_went_wrong'), {position: 'top-right' });
        }
    }
};
const handleCloseSidebar = (val,pageIndex) => {
    if(pageIndex === 0) isCustomField.value = val;
    componentDetail.value={};
    customFieldObject.value={};
};
function openSeeAll (value) {
    if(value === 'task'){
        emit("openSeeAll" )
    }
}
const editCustomField = (val) => {
    if(showCustomField.value === true && currentCompany.value?.planFeature?.customFields === true){
        componentDetail.value = CustomFieldData.value.find((x)=> x.cfType === val.fieldType);
        customFieldObject.value = val;
        if(componentDetail.value && Object.keys(componentDetail.value).length){            
            isCustomField.value = true;
        }
    }
};
const handleClose = () => {
    isCustomField.value = false;
    componentDetail.value = {};
    customFieldObject.value = {};
};
</script>
<style>

.highlighted-description{
    border: 1px solid #00dd00 !important;
}

</style>