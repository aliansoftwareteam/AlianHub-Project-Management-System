<template>
    <div class="mainConvertList">
        <div v-if="isFolder === true">
            <Sidebar width="607px" :top="clientWidth <= 767 ? '0px' : '46px'">
                <template #head-left>
                    <div class="blue font-ui screenShotPreview">{{$t('ProjectDetails.convert_list')}}</div>
                </template>
                <template #head-right>
                <button class="outline-primary d-flex align-items-center font-ui font-size-16 convertlist__cancel-btn" @click="$emit('closeSidebar',false)">{{$t('Projects.cancel')}}</button>
                </template>
                <template #body>
                        <div class="bg-white overflow-x-visible overflow-y-auto overflow-y-auto::-webkit-scrollbar p15x-20px" :class="{'border-radius-12-px' : clientWidth > 767, 'border-radius-0 ' : clientWidth <= 767}"  :style="[{margin : clientWidth > 767 ? '15px' : '0px' ,  height : clientWidth <= 767 ?  '100%' : ''}]">
                        <div class="position-re overflow-x-visible overflow-y-auto overflow-y-auto::-webkit-scrollbar" :style="[{ maxHeight : clientWidth > 767 ? 'calc(100vh - 172px)' : 'calc(100vh - 90px)'}]">
                        <div class="d-flex align-items-center justify-content-between position-sti z-index-1 project__icon-wrapper">
                            <div class="d-flex align-items-center text-ellipsis projectDivInList">
                                <span v-if="selectedProjectData.projectIcon && selectedProjectData.projectIcon.type === 'color'" class="d-flex align-items-center justify-content-center font-weight-400 inital-box ml-6px" :style="[{'background-color': selectedProjectData.projectIcon.data}]">{{ selectedProjectData.ProjectName.charAt(0).toUpperCase()}}</span>
                                <img v-if="selectedProjectData.projectIcon && selectedProjectData.projectIcon.type === 'image'" class="profile-sm-square ml-6px" :src="selectedProjectData.projectIcon.data" alt=""/>
                                <span class="text-ellipsis Project-name-sidebar-inlist black font-weight-500 font-ui pl-10px" :class="{'font-size-13' : clientWidth > 767, 'font-size-16' : clientWidth <= 767}"  @click="showSidebar = true">{{selectedProjectData.ProjectCode}} | {{selectedProjectData.ProjectName}}</span>
                            </div>
                        </div>
                        <SideBarSprintFolderData
                            v-for="subItem in sprintFolders"
                            :key="subItem.folderId"
                            :data="subItem"
                            :folder="true"
                            :selectedProjectData="selectedProjectData"
                            @click="selectedFolder(subItem)"
                            :isShowIcon="false"
                        />
                    </div>
                    </div>
                    <ConfirmationSidebar
                        v-model="showSidebar"
                        :title="$t('Converttolist.are_you_sure_convert')"
                        :acceptButtonClass="'btn-primary font-ui'"
                        :acceptButton="$t('Converttolist.convert_to_list')"
                        @confirm="showSidebar = false,convertToListFun()">
                        <template #head>
                            <img @click="$emit('closeSidebar',false)" :src="closeImage" alt="closeImage" class="position-ab cursor-pointer close_image-icon">
                        </template>
                        <template #body>
                            <span class="d-block text-center convert-list-message font-size-16 font-weight-400 font-ui gray81 pt-17px important__note-desc" ><span class="red">{{$t('Converttolist.important')}}:</span> {{$t('Converttolist.you_will_lose')}}</span>
                        </template>
                    </ConfirmationSidebar>
                </template>
            </Sidebar>
        </div>
        <div v-if="isFolder === false">
            <ConfirmationSidebar
                v-model="showSidebar"
                :title="$t('Converttolist.are_you_sure_convert')"
                :acceptButtonClass="'btn-primary font-ui'"
                :acceptButton="$t('Converttolist.convert_to_list')"
                @confirm="showSidebar = false,convertToListFun()">
                <template #head>
                    <img @click="$emit('closeSidebar',false)" :src="closeImage" alt="closeImage" class="position-ab cursor-pointer close_image-icon">
                </template>
                <template #body>
                    <span class="d-block text-center convert-list-message font-size-16 font-weight-400 font-ui gray81 pt-17px important__note-desc"><span class="red">{{$t('Converttolist.important')}}:</span> {{$t('Converttolist.you_will_lose')}}</span>
                </template>
            </ConfirmationSidebar>
        </div>
    </div>
</template>

<script setup>
    import { defineProps, ref, defineEmits, inject, computed, onMounted } from "vue";
    import { useStore } from "vuex";
    import ConfirmationSidebar from "@/components/molecules/ConfirmationSidebar/ConfirmationSidebar.vue";
    import taskClass from "@/utils/TaskOperations";
    import { useGetterFunctions } from "@/composable";
    import { useToast } from "vue-toast-notification";
    import { useRouter } from 'vue-router';
    import Sidebar from '@/components/molecules/Sidebar/Sidebar.vue';
    import SideBarSprintFolderData from "@/components/organisms/SideBarSprintFolderData/SideBarSprintFolderData.vue"
    import { dbCollections } from '@/utils/Collections';
    import { sprintPlanPermission } from "@/composable/commonFunction";
    import { useI18n } from "vue-i18n";
    import { apiRequest } from "../../../services";
    import * as env from '@/config/env';
    import { nestedFolders } from '@/utils/folderTree';
    import { convertToListRequest } from '@/views/Projects/composables/taskPlacement';

    const { t } = useI18n();

    const {getUser} = useGetterFunctions();
    const {getters} = useStore();
    const $toast = useToast();
    const { checkPerProjectSprintPermission } = sprintPlanPermission();

    const props = defineProps({
        openSidebar: {
            type: Boolean,
            default: false
        },
        task: {
            type: Object,
        }
    })
    const emit = defineEmits(["closeSidebar"]);
    const companyId = inject('$companyId');
    const selectedProjectData = inject('selectedProject');
    const userId = inject('$userId');
    const clientWidth = inject("$clientWidth");
    const router = useRouter();

    const showSidebar = ref(false);
    const selectedFolderData = ref({});
    const subtaskArr = ref([]);
    const closeImage = require("@/assets/images/svg/deletearchiveSvg.svg");
    const sprintOptions = ref([]);
    const isFolder = ref(false);

    const companyOwner = computed(() => {
        return getters["settings/companyOwnerDetail"];
    })

    onMounted(() => {
        if(sprintFolders.value.length) {
            isFolder.value = true;
        }else{
            isFolder.value = false;
            showSidebar.value = true;
        }
        sprintOptions.value = [...(selectedProjectData.value?.sprintsObj ? Object.values(selectedProjectData.value.sprintsObj).filter((x) => !x.deletedStatusKey) : [])]
        if(selectedProjectData.value.sprintsfolders && Object.values(selectedProjectData.value.sprintsfolders).length) {
            Object.values(selectedProjectData.value.sprintsfolders).forEach((x) => {
                if(!x.deletedStatusKey) {
                    sprintOptions.value = [...sprintOptions.value, ...(Object.values(x?.sprintsObj)?.length ? Object.values(x.sprintsObj).filter((y) => !y.deletedStatusKey) : [])];
                }
            })
        }
    })

    const sprintFolders = ref(JSON.parse(JSON.stringify(nestedFolders(selectedProjectData.value.sprintsfolders))));

    // Check subtask exist or not
    const checkSubTask = () => {
        return new Promise((resolve, reject) => {
            try {
                const findQuery = [
                    {
                        "$match": {
                            ParentTaskId: props.task._id
                        }
                    },
                ];

                apiRequest('post',`${env.TASK}/find`,{findQuery: findQuery}).then((resp) => {
                    if(resp.status === 200) {
                        const result = resp.data;
                        if (result.length === 0) {
                            return resolve(true);
                        }
                        subtaskArr.value = result;
                        resolve(true);
                    }else{
                        reject(false);
                    }
                })
                .catch((error)=>{
                    console.error("ERROR in add project tags: ", error);
                })
            } catch (error) {
                reject(false);
                console.error(error,"error");
            }
        })
    }

    // Convert to list function
    const convertToListFun = () => {
        checkPerProjectSprintPermission(selectedProjectData.value._id,dbCollections.SPRINTS).then((resp) => {
            if(resp){
                let isExist = false;
                sprintOptions.value.filter((x) => {
                    if(x && x.name !== undefined && x.name.toLowerCase() === props.task.TaskName.toLowerCase()){
                        $toast.error(t("Toast.already_exists").replace('EXIST_VALUE', x.name),{position: 'top-right'});
                        isExist = true;
                        emit("closeSidebar", false);
                    }
                })
                if(isExist === false){
                    emit("closeSidebar", false);

                    checkSubTask().then((result)=>{
                        if(result === true){
                            const user = getUser(userId.value)
                            const userData = {
                                id: user.id,
                                Employee_Name: user.Employee_Name,
                                companyOwnerId: companyOwner.value.userId,
                            }

                            taskClass.convertToList(convertToListRequest({
                                companyId: companyId.value,
                                project: selectedProjectData.value,
                                task: props.task,
                                userData : userData,
                                folder: selectedFolderData.value,
                                isSubTask : subtaskArr.value.length > 0 ? true : false
                            })).then((response)=>{
                                if(response.data.status === true){
                                    let sprintObj = response.data.data;
                                    let parmasObj = {
                                        cid: companyId.value,
                                        id: selectedProjectData.value._id,
                                        sprintId: sprintObj._id
                                    }
                                    if(sprintObj.folderId) {
                                        parmasObj.folderId = sprintObj.folderId;
                                    }
                                    $toast.success(t("Toast.Converted_sucessfully"),{position: 'top-right'});
                                    router.push({name: sprintObj?.folderId ? "ProjectFolderSprint" : "ProjectSprint", params: parmasObj});
                                }else{
                                    $toast.error(t('Toast.something_went_wrong'),{position: 'top-right'});
                                }
                            }).catch((err)=>{
                                console.error('error',err);
                            })
                        }
                    })
                }
            }else{
                $toast.error(t(`Toast.Upgrade_your_plan_you_have_reached_the_limit_for_creating_sprints`), {position: "top-right"});
                return;
            }
        })
    }

    // Selected folder
    const selectedFolder = (folder) => {
        selectedFolderData.value = folder;
        showSidebar.value = true;
    }
</script>

<style scoped src="./style.css"></style>

