<template>
    <div>
        <Sidebar :title="$t('Channel.create_channel')" :visible="visible" @update:visible="inProgress ? '' : $emit('update:visible', $event), resetValues()" width="610px;">
            <template #body>
                <div v-if="!allowPublicChannels && !allowPrivateChannels" class="plan-upgrade-massage">
                    <h4>{{$t('Channel.msg1')}}.</h4>
                </div>
                <div class="bg-light-gray h-100 p-10px" v-else>
                    <div class="position-ab d-flex align-items-center justify-content-center z-index-7 w-100 h-100 bg-dark-gray3" v-if="inProgress">
                        <Spinner :isSpinner="true"/>
                    </div>
                    <div class="bg-white border-radius-8-px p-15px webkit-avilable">
                        <!-- CHANNEL NAME -->
                        <div class="d-flex align-items-center">
                            <label class="text-nowrap mr-10px">{{$t('Channel.channel_name')}}<span class="red">*</span></label>
                            <div class="position-re w-100">
                                <input type="text" v-model.trim="channelName.value" :placeholder="$t(`PlaceHolder.enter_channel_name`)" class="form-control webkit-avilable"
                                    @keyup="checkErrors({'field':channelName,
                                        'name':channelName.name,
                                        'validations':channelName.rules,
                                        'type':channelName.type,
                                        'event':$event.event})"
                                >
                                <div class="red position-ab font-size-11 error__text-channelname" v-if="channelName.error">{{channelName.error}}</div>
                            </div>
                        </div>

                        <!-- ICONS -->
                        <div>
                            <div class="d-flex white mt-2 justify-content-between">
                                <div class="border position-re border-radius-10-px bg-light-gray d-flex align-items-center justify-content-center mr-10px icons__wrapper-div">
                                    <img v-if="icon && Object.keys(icon).length || uploadFileName" class="position-ab create__channel-remove" @click="icon={},uploadFileName=''" :src="deletered">
                                    <img v-if="icon?.url" :src="icon?.url" alt="icon" class="border-radius-10-px w-100 h-100 icon__img">
                                    <FontAwesomeIcon v-if="icon?.iconName" :icon="icon" size="xl" class="gray81"/>
                                </div>
                                <div class="w-80">
                                    <span class="black font-weight-bold">{{$t('Channel.icons')}}</span>
                                    <div class="d-flex flex-wrap white overflow-y-scroll style-scroll" style="height: 150px;" >
                                    <div v-for="(item,index) in icons" :key="index" class="m-6px" :class="(icon && item?.iconName === icon?.iconName) ? ['icon_bg border-radius-5-px'] : null">
                                            <div class="d-flex justify-content-center align-items-center icon_wrapper" @click="setIcon(item)">
                                                <FontAwesomeIcon :icon="item" size="lg" class="gray81"/>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div class="text-center mt-10px">
                                <span>{{$t('Channel.or')}}</span>
                                <div class="d-flex align-items-center mt-10px text-nowrap">
                                    <input v-if="!uploadFileName" type="text" :placeholder="$t('Channel.choose_to_upload')" class="form-control" v-model.trim="icon.name" readonly/>
                                    <input v-else type="text" :placeholder="uploadFileName ? uploadFileName : $t('Channel.choose_to_upload')" class="form-control webkit-avilable" readonly/>
                                    <button class="btn-primary p0x-10px" @click="$refs.fileInputUser.click()">{{$t('Templates.upload')}}</button>
                                    <input type="file" ref="fileInputUser" class="d-none" name="img" @change="previewImage" accept="image/x-png,image/jpeg,image/jpg" id="upload-photo"/>
                                </div>
                            </div>
                        </div>

                        <!-- PRIVATE CHANNEL -->
                        <div class="d-flex mt-2" :style="{'opacity': showWarning ? 0.5 : 1}">
                            <div class="w-95">
                                <span class="font-weight-bold">{{$t('Channel.private_channel')}}</span>
                                <span class="d-block font-size-13 mt-5px">{{$t('Channel.msg2')}}</span>
                            </div>
                            <Toggle v-model="privateChannel" width="30" activeColor="#3845B3" :disabled="isDisabled"/>
                        </div>

                            <div v-if="showWarning" class="show_warning">
                                <div class="mb-15px msg-color">{{warningMessage}}</div>
                                <div class="upgrade-btn-txt d-flex justify-content-center">
                                    <span @click="$router.push({name: 'Upgrade', params: {cid: companyId}})">
                                        {{$t('Upgrades.upgrade_your_plan')}}
                                    </span>
                                </div>
                            </div>

                        <!-- SEND MESSAGE -->
                        <div class="d-flex mt-2">
                            <div class="w-95">
                                <span class="font-weight-bold">{{$t('Channel.send_messages')}}</span>
                                <span class="d-block font-size-13 mt-5px">{{$t('Channel.allowmsg2')}}.</span>
                            </div>
                            <Toggle v-model="sendMessage" width="30" activeColor="#3845B3"/>
                        </div>

                        <!-- ONLY SHARE WITH -->
                        <div class="d-flex align-items-center mt-2" v-if="privateChannel">
                            <span>{{$t("Channel.only_share_with")}}: </span>
                            <Assignee
                                class="assignee-data ml-15px"
                                :users="assigneeUsers"
                                :options="[...userGetter, ...teams.map((x) => 'tId_'+x._id)]"
                                :imageWidth="clientWidth>1024 ? '30px' : '25px'"
                                :num-of-users="clientWidth>1024 ? 4 : 2"
                                @selected="changeAssignee('add', $event)"
                                @removed="changeAssignee('remove', $event)"
                                :isDisplayTeam="true"
                            />
                        </div>

                        <!-- CREATE CHANNEL -->
                        <div class="d-flex justify-content-end mt-2">
                            <button class="btn-primary" @click="createChannel()">{{$t('Channel.create_channel')}}</button>
                        </div>
                    </div>
                </div>
            </template>
        </Sidebar>
    </div>
</template>

<script setup>
// PACKAGES
import { computed, inject, ref, onMounted, watch } from "vue";
import { useStore } from "vuex";
import { useValidation } from "@/composable/Validation";
import { library, dom } from "@fortawesome/fontawesome-svg-core";
import { far } from "@fortawesome/free-regular-svg-icons";
import { fab } from "@fortawesome/free-brands-svg-icons"
import { fas } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";

// COMPONENTS
import Sidebar from "@/components/molecules/Sidebar/Sidebar.vue"
import Spinner from "@/components/atom/SpinnerComp/SpinnerComp.vue"
import Toggle from "@/components/atom/Toggle/Toggle.vue"
import Assignee from "@/components/molecules/Assignee/Assignee.vue"
import { useCustomComposable, useGetterFunctions } from "@/composable";
import * as env from '@/config/env';
import { useToast } from "vue-toast-notification";
import { apiRequest, apiRequestWithoutCompnay } from '../../../services';
import {storageQueryBuilder} from '@/utils/storageQueryBuild.js';
import { useI18n } from "vue-i18n";
const { t } = useI18n();

library.add(far);
library.add(fab)
library.add(fas);
dom.watch();

// UTILS
const userId = inject("$userId");
const companyId = inject("$companyId");
const clientWidth = inject("$clientWidth");
const { getters,commit } = useStore();
const {getUser} = useGetterFunctions();
const {checkAllFields, checkErrors} = useValidation();
const { checkBucketStorage } = useCustomComposable();
const teams = computed(() => getters["settings/teams"])
const $toast = useToast()
const showWarning = ref(false);
const warningMessage = ref("");

// EMITS
const emit = defineEmits(["update:visible", "cancel", 'created']);

//IMAGE
const deletered = require("@/assets/images/svg/deletered.svg");

// PROPS
const props = defineProps({
    visible: {
        type: Boolean,
        default: false
    },
    folder: {
        type: Object,
        default: null
    },
    project: {
        type: Object,
        default: null
    },
})
const injectedProject = inject("selectedProject", null);
const projectData = computed(() => props.project || (injectedProject && "value" in injectedProject ? injectedProject.value : injectedProject) || null);

const icons = [...new Set([...Object.keys(far).map(key => far[key]),...Object.keys(fab).map(key => fab[key]),...Object.keys(fas).map(key => fas[key])])]
const userGetter = computed(() => {
    return getters["settings/companyUsers"].map((x) => x.userId)
})
const inProgress = ref(false)
const channelName = ref({
    error: "",
    value: "",
    rules: "required | min: 3",
    name: "channel name"
});
const icon = ref(icons.length > 0 ? {...icons[0],type: 'icon'} : {});
const assigneeUsers = ref([userId.value]);
const privateChannel = ref(false);
const sendMessage = ref(true);
const uploadFileName = ref('');

const currentCompanyDetails = computed(() => getters['settings/selectedCompany']);
const allowPrivateChannels = ref(false);
const allowPublicChannels = ref(false);

// Keep the watch on selectedCompany store getters to get updated data
watch(() => getters['settings/selectedCompany'], (val) => {
	currentCompanyDetails.value = val;
})

onMounted(() => {
    allowPrivateChannels.value = privateChannelsFun(currentCompanyDetails.value);
    allowPublicChannels.value = publicChannelsFun(currentCompanyDetails.value);
    if (!allowPrivateChannels.value || !allowPublicChannels.value) {
        showWarning.value = true;
        if (!allowPrivateChannels.value) {
            warningMessage.value = t('Channel.private_channel_limit_reached');
        } else {
            warningMessage.value = t('Channel.public_channel_limit_reached');
        }
    }
    manageToggleButton();
})

// Check private channels count as per the current subscription plan
const privateChannelsFun = (obj) => {
    const privateChannels = obj?.projectCount?.privateChannels;
    const maxPrivateChannels = obj?.planFeature?.maxPrivateChannels;

    return privateChannels === undefined || maxPrivateChannels === null || (maxPrivateChannels - privateChannels) > 0;
};

// Check public channels count as per the current subscription plan
const publicChannelsFun = (obj) => {
    const publicChannels = obj?.projectCount?.publicChannels;
    const maxPublicChannels = obj?.planFeature?.maxPublicChannels;

    return publicChannels === undefined || maxPublicChannels === null || (maxPublicChannels - publicChannels) > 0;
};

// Manage toggle for the private/public channel based on channel limits on subscription plan
const manageToggleButton = () => {
    privateChannel.value = !allowPublicChannels.value && allowPrivateChannels.value
                        ? true
                        : (allowPublicChannels.value && !allowPrivateChannels.value
                        ? false
                        : privateChannel.value);
}

// Disable toggle button of private/public channel based on subscription plan
const isDisabled = computed(() => allowPublicChannels.value !== allowPrivateChannels.value);

function setIcon(icn) {
    icon.value = {...icn, type: 'icon'}
    uploadFileName.value = '';
}

function previewImage(e) {
    let file = Array.from(e.target.files)?.[0];
    let fileList = Array.from(e.target.files);
    if(checkBucketStorage(fileList.map(file => file?.size),{gettersVal: getters}) !== true){
        return;
    }

    const extensions = ["jpg", "png", "gif", "jpeg"];
    const fileExt = file.name.split(".").pop()

    if(file && extensions.includes(fileExt)) {
        let render = new FileReader();
        render.onload = (data) => {
            icon.value = {
                file:file,
                url: data.target.result,
                type:'image'
            };
        }
        render.readAsDataURL(file)
        uploadFileName.value = file.name;
    } else {
        $toast.error(t("Toast.Please_select_an_image_file"), {position: "top-right"})
        return;
    }
}

function changeAssignee(type, event) {
    if(type == "add"){
        assigneeUsers.value.push(event.id);
    }
    else if(type == "remove"){
        assigneeUsers.value = assigneeUsers.value.filter((x) => x !== event.id)
    }
}

function resetValues() {
    channelName.value.value = "";
    channelName.value.error = "";
    icon.value = {};
    privateChannel.value = false;
    sendMessage.value = true;
    assigneeUsers.value = [];
    emit("update:visible", false);
}

function createChannel() {
    if(inProgress.value) return;
    inProgress.value = true;
    checkAllFields({channelName: channelName.value})
    .then((valid) => {
        if(valid) {
            createChannelFun().then((res) => {
                if (res.data.status) {
                    $toast.success(t(`Toast.Channel_created_successfully`), { position: "top-right" })
                    resetValues();
                    inProgress.value = false;
                    emit('created', res.data.data || null);
                    emit('update:visible', false);
                } else {
                    $toast.error(res.data.statusText, { position: "top-right" })
                    resetValues();
                    inProgress.value = false;
                }
            }).catch(() => {
                $toast.error(t(`Toast.something_went_wrong`), { position: "top-right" })
                emit('cancel');
                resetValues();
                inProgress.value = false;
            })
        } else {
            inProgress.value = false;
        }
    })
    .catch((error) => {
        inProgress.value = false;
        console.error("ERROR: ", error);
    })
}

async function createChannelFun() {
    return new Promise((resolve, reject) => {
        try {
            (async () => {
                if(!projectData.value?._id) {
                    $toast.error(t(`Toast.something_went_wrong`), {position: "top-right"});
                    inProgress.value = false;
                    return;
                }
                let user = getUser(userId.value);
                let uploadIcon = {
                    ...icon.value
                }

                delete uploadIcon.icon;

                if (uploadIcon && Object.keys(uploadIcon).length && uploadIcon?.type === 'image') {
                    const randomNumber = parseInt(Date.now() * Math.random());
                    let fileName;
                    if(env.STORAGE_TYPE && env.STORAGE_TYPE === 'server') {
                        const originalName = uploadIcon.file.name;
                        const lastDotIndex = originalName.lastIndexOf(".");
                        const namePart = originalName.substring(0, lastDotIndex).replaceAll(" ", "_");
                        const extension = originalName.substring(lastDotIndex + 1);
                        
                        const name = `${namePart}_${randomNumber}.${extension}`;
                        fileName = name.replaceAll(/[^a-zA-Z0-9_\-./]/g, '_');
                    } else {
                        const name = uploadIcon.file.name.split(".")
                        fileName = name[0].replaceAll(" ","_") + "_"+ randomNumber + "."+ name[1];
                    }
                    let filePath = `chats/${projectData.value._id}/channelImages/${fileName}`;
    
                    const apiFormData = new FormData();
                    apiFormData.append("path", filePath);
                    apiFormData.append("companyId", companyId.value);
                    apiFormData.append("file", uploadIcon.file);
                    await apiRequestWithoutCompnay("post", storageQueryBuilder('upload').route, apiFormData, "form").then((res)=>{
                        if(res.data.status){
                            uploadIcon = {
                                url: res.data.statusText,
                                type: 'image'
                            }
                        } else {
                            uploadIcon = {}
                        }
                    })
                }
                const axiosData = {
                    companyId: companyId.value,
                    projectId: projectData.value._id,
                    sprintName: channelName.value.value,
                    userData: {
                        id: user.id,
                        Employee_Name: user.Employee_Name,
                        companyOwnerId: user.companyOwnerId
                    },
                    projectName: projectData.value.ProjectName,
                    mainChat: true,
                    private: privateChannel.value,
                    sendMessage: sendMessage.value,
                    AssigneeUserId: assigneeUsers.value,
                    icon: uploadIcon
                }

                if(privateChannel.value) {
                    axiosData.watchers = assigneeUsers.value;
                }

                if(props.folder) {
                    axiosData.folder = {
                        folderId: props.folder.folderId,
                        folderName: props.folder.name
                    }
                } else {
                    axiosData.folder = null
                }

                let endPoint = env.SPRINT;
                apiRequest("post", endPoint, {
                    ...axiosData,
                    type: "addSprint",
                })
                .then((res) => {
                    commit('mainChat/mutateChatSprints', {op: "added", data: res?.data?.data || {}});
                    resolve(res);
                })
                .catch((error) => {
                    console.error("Error: ", error);
                    reject(error);
                });
            })()
        } catch (error) {
            console.error("ERROR: ", error);
            reject(error);
        }
    });
}
</script>

<style scoped>
.error__text-channelname{
    bottom: -14px; 
    left: 0px;
}
.icons__wrapper-div{
    width: 62px; 
    height: 62px;
}
.icon__img{
    object-fit: cover;
}
.icon_bg {
    background-color: #ebecf4;
}
.icon_wrapper{
    height: 40px;
    width: 35px;
}
.plan-upgrade-massage {
    position: absolute;
    top: 50%;
    left: 3%;
    font-size: 13px;
}
.create__channel-remove {
    right: -6px;
    top: -10px;
    background-color: #ffd6d6;
    padding: 5px;
    border-radius: 5px;
    cursor: pointer;
}
.upgrade-btn-txt{
    margin: 0 auto;
    background-color: #28C76F;
    color: #fff;
    padding: 3px 14px;
    border-radius: 4px;
    width: 175px;
}
.show_warning{
    border: 1px solid transparent;
    border-radius: 5px;
    margin-top: 20px;
    padding: 15px;
    background-color: #FFF4D4;
}
.msg-color{
    color: #996C00;
}
</style>