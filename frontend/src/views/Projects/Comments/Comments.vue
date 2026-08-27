<template>
    <div v-if="!currentCompany?.planFeature?.commentsView">
        <UpgradePlan
            :buttonText="$t('Upgrades.upgrade_your_plan')"
            :lastTitle="$t('Comments.unlock_comment_view')"
            :secondTitle="$t('Upgrades.unlimited')"
            :firstTitle="$t('Upgrades.upgrade_to')"
            :message="$t('Upgrades.the_feature_not_available')"
        />
    </div>
    <div class="position-re h-100" v-else>
        <!-- HEADER -->

        <!-- BODY -->
        <DragDrop
            v-if="showDropZone && messageAllowed"
            :extensions="fileExtentions"
            @handleDrop="checkMedia"
            style="z-index: 6 !important;"
            class="position-sti z-index-1 h-100 media__extension chat__drag-drop d-flex align-items-center justify-content-center"
            @dragLeave="showDropZone = false"
        />
        <div id="message_container"
            @dragenter="messageAllowed ? showDropZone = true : showDropZone = false"
            class="overflow-y-auto style-scroll position-re msg__container"
        >
            <template v-if="loadingChat">
                <!-- CHAT LOADER -->
                <div class="bg-light-gray commments__component-wrapper position-re">
                    <div class="d-grid flex-column w-100">
                        <div class="d-flex w-100 pl-10px">
                            <div>
                                <Skelaton style="height: 30px; width: 30px;" class="border-radius-50-per d-flex align-items-center mt-1 justify-self-start"/>
                            </div>
                            <div class="w-100 ml-10px">
                                <Skelaton style="height: 40px; width: 10%;" class="border-radius-5-px d-flex align-items-center mt-1 justify-self-start"/>
                                <Skelaton style="height: 40px; width: 25%;" class="border-radius-5-px d-flex align-items-center mt-5px justify-self-start"/>
                            </div>
                        </div>
                        <Skelaton style="height: 40px; width: 50%;" class="border-radius-5-px d-flex align-items-center mr-10px mt-1 justify-self-end"/>
                        <Skelaton style="height: 40px; width: 10%;" class="border-radius-5-px d-flex align-items-center mr-10px mt-5px justify-self-end"/>
                        <Skelaton style="height: 40px; width: 25%;" class="border-radius-5-px d-flex align-items-center mr-10px mt-5px justify-self-end"/>
                        <div class="d-flex w-100 pl-10px">
                            <div>
                                <Skelaton style="height: 30px; width: 30px;" class="border-radius-50-per d-flex align-items-center mt-1 justify-self-start"/>
                            </div>
                            <div class="w-100 ml-10px">
                                <Skelaton style="height: 40px; width: 50%;" class="border-radius-5-px d-flex align-items-center mt-1 justify-self-start"/>
                                <Skelaton style="height: 40px; width: 35%;" class="border-radius-5-px d-flex align-items-center mt-5px justify-self-start"/>
                                <Skelaton style="height: 120px; width: 80%;" class="border-radius-5-px d-flex align-items-center mt-5px justify-self-start"/>
                            </div>
                        </div>
                    </div>
                </div>
            </template>
            <template v-else>
                <div class="p0x-5px">
                    <span v-if="messages.length && convertDateFormat({seconds: popupDate}).toLowerCase() !== $t('Home.Today').toLowerCase()" class="position-sti bg-white px-1 border-radius-5-px z-index-2 d-inline-block convert_dateformat">{{convertDateFormat({seconds: popupDate})}}</span>
                    <Comment
                        v-for="(data, index) in messages" :key="data._id"
                        :message="data"
                        :showDay="data.showDifference"
                        :showUser="showUserInfo(data, messages[index - 1])"
                        :showMessageTime="showMessageTime(data, messages[index - 1])"
                        :showUnread="unreadMessages !== 0 && index === (messages.length - (unreadMessages)) ? unreadMessages : 0"
                        :class="{'mb-1': (index === messages.length - 1)}"

                        :mainChat="mainChat"

                        @previewImage="handlePreviewImage(data)"
                        @downloadUrl="handleDownloadUrl" 
                        @highlight="highlightMessage"
                        @edit="editMessage(data)"
                        @createTask="createTask = true, formData.taskName.value=changeText(data.message.substr(0, 250), '', '')"
                        @addCheckList="addToCheckList(data.message)"
                        @copy="copyMessage(data.message)"
                        @delete="deleteMessage(data)"
                        @reply="replyMessage(data)"
                        @pin="pinMessage(data)"
                        @markUnread="updateCount(true, messages.length - index), resetUnread = false"
                    />
                </div>
            </template>
        </div>


        <!-- FOOTER -->
        <div>
            <div id="comment_footer"  class="border-top position-fi flex-column border-bottom d-flex align-items-end justify-content-between bg-white p-12px comment__footer">
                <!-- SCROLL BOTTOM -->
                <button v-if="showScrollBotton" class="scroll-bottom-btn position-ab bg-light-blue cursor-pointer" @click="scrollBottom()">
                    <img :src="downArrow" alt="downArrow" class="vertical-middle">
                </button>

                <MediaConfirmation
                    v-if="mediaFiles.length"
                    v-model="mediaFiles"
                    @cancel="mediaFiles = []"
                    @addNew="$refs.file_input.click()"
                    class="z-index-6"
                />
                <div class="d-flex w-100">
                    <!-- TEXT -->
                    <div class="d-flex align-items-center position-re comment__text-wrapper">
                        <div class="position-ab cursor-pointer message__reset-id" v-if="message._id" @click="resetMessage()">
                            <img :src="closeIcon" alt="closeIcon">
                        </div>
                        <template v-if="!recording">
                            <CommentInput
                                v-model="message.message"
                                :recording="recording"
                                :reply="message.reply"
                                @cancel-reply="message.reply = {}"
                                :showAll="mainChat && !projectData?.default"
                                :includeAlian="!mainChat"
                                :userIds="users.map((x) => x.id)"
                                @enter="mediaFiles.length ? sendMedia() : sendMessageFun(message)"
                                :sendMessageAllowed="messageAllowed"
                                @pasteFile="checkMedia"
                                :isHeight="props.isHeight"
                                :loadingChat="loadingChat"
                            />
                        </template>
                        <template v-else>
                            <span class="mr-10px">{{recordTime}}</span>
                            <div class="bg-green border-radius-10-px record__progress" :style="{width: `${recordingProgress}%`}"></div>
                            <div class="bg-light-gray border-radius-10-px record__progress" :style="{width: `${100 - recordingProgress}%`}"></div>
                        </template>
                    </div>

                    <!-- FUNCTIONS -->
                    <div class="d-flex align-items-center">
                        <!-- RECORD -->
                        <Record v-model="recording" v-model:recordingProgress="recordingProgress" v-model:recordTime="recordTime" @stop="sendRecord" :send-meassage-allowed="messageAllowed"/>

                        <!-- ATTACH -->
                        <template v-if="!recording">
                            <img :src="attachIcon" alt="attachIcon" class="mx-1 cursor-pointer" :class="{'cursor-not-allowed' : disabled=!messageAllowed }"  @click="messageAllowed ? $refs.file_input.click() : null">
                            <input type="file" class="d-none" ref="file_input" @change="(e) => {checkMedia(Array.from(e.target.files)); e.target.value = null;}" id="filechat" multiple :disabled="!messageAllowed">
                            <button class="btn-primary ml-1 send__media-btn border-radius-8-px" :class="{'disable__send-button' : disabled=!messageAllowed }" @click="messageAllowed ? (mediaFiles.length ? sendMedia() : sendMessageFun(message)) : null"><img :src="sendIcon" alt="sendIcon" class="cursor-pointer" :class="{'disable__send-button' : disabled=!messageAllowed }"></button>
                        </template>
                    </div>
                </div>
            </div>
        </div>
        <Modal :title="$t('Comments.create_task')" :acceptButtonText="$t('Comments.create_task')" class-name="createTask__modal" :modelValue="createTask" @accept="saveTask()" @close="createTask = false, resetTaskData()" :closeOnBackdrop="false">
            <template #body>
                <div>
                    <div class="position-re createTask__modal-field mb-15px">
                        <span class="mb-5px" >{{$t('Comment.task_name')}}</span>
                        <InputText
                            class="input__taskname-value"
                            v-model="formData.taskName.value"
                            placeholder="Enter task name"
                            :maxLength="250"
                            :minLength="3"
                            :isOutline="false"
                            :isDirectFocus="true"
                            @keyup="checkErrors({'field':formData.taskName,
                            'name':formData.taskName.name,
                            'validations':formData.taskName.rules,
                            'type':formData.taskName.type,
                            'event':$event.event})"
                        />
                        <div class="red position-ab z-index-1 font-size-12 error__text">{{formData.taskName.error}}</div>
                    </div>
                    <div class="position-re createTask__modal-field mb-15px">
                        <SelectComp
                            name="sprintSelection"
                            :title="$t('Projects.sprint')"
                            displayKey="name"
                            v-model="formData.selectedSprint.value"
                            :options="sprintOptions"
                            :enableSearch="sprintOptions.length > 10"
                            :disabled="!sprintOptions.length"
                            class="select__component"
                            @change="checkErrors({'field':formData.selectedSprint,
                            'name':formData.selectedSprint.name,
                            'validations':formData.selectedSprint.rules,
                            'type':formData.selectedSprint.type,
                            'event':$event})"
                        />
                        <div class="red position-ab z-index-1 font-size-12 error__text">{{formData.selectedSprint.error}}</div>
                    </div>
                    <div class="position-re createTask__modal-field mb-15px">
                        <SelectComp
                            name="taskTypeSelection"
                            :title="$t('Projects.task_type')"
                            displayKey="name"
                            v-model="formData.selectedType.value"
                            :options="projectData.taskTypeCounts.map((x) => ({...x, image: x.taskImage}))"
                            :enableSearch="projectData.taskTypeCounts.length > 10"
                            :disabled="!projectData.taskTypeCounts.length"
                            class="select__component"
                            @change="checkErrors({'field':formData.selectedType,
                            'name':formData.selectedType.name,
                            'validations':formData.selectedType.rules,
                            'type':formData.selectedType.type,
                            'event':$event})"
                        />
                        <div class="red position-ab z-index-1 font-size-12 error__text">{{formData.selectedType.error}}</div>
                </div>
                </div>
            </template>
        </Modal>

        <ImagesPreviewer
            :showPreviewer="showPreviewer"
            :items="transformedAttachments"
            :activeIndex="activeIndex"
            @close="closePreviewer"
            :config="{ handlesTimer: 2000 }"
        />
    </div>
</template>

<script setup>
// PACKAGES
import { defineComponent, nextTick, onMounted, ref, defineProps, inject, watch, computed, onBeforeUnmount } from "vue";
import { dbCollections } from "@/utils/Collections";
import { useConvertDate, useCustomComposable, useGetterFunctions } from "@/composable";
import { checkFile, renderFiles, showUserInfo, showMessageTime, sendMessage, bakeMessage, uploadToWasabi, deleteFromWasabi, sendMailFromMessage } from "./helper";
import { useToast } from "vue-toast-notification";
import { useValidation } from "@/composable/Validation";
import { useStore } from "vuex";
import taskClass from "@/utils/TaskOperations"

// COMPONENTS
import Skelaton from "@/components/atom/Skelaton/Skelaton.vue";
import Comment from "@/components/organisms/Comment/Comment.vue";
import CommentInput from "@/components/atom/CommentInput/CommentInput.vue"
import Record from "@/components/atom/Record/Record.vue"
import Modal from "@/components/atom/Modal/Modal.vue"
import SelectComp from "@/components/molecules/Select/Select.vue"
import InputText from "@/components/atom/InputText/InputText.vue"
import DragDrop from "@/components/atom/DragAndDropDivCompo/DragAndDropDivCompo.vue"
import MediaConfirmation from "@/components/molecules/MediaConfirmation/MediaConfirmation.vue"
import UpgradePlan from '@/components/atom/UpgradYourPlanComponent/UpgradYourPlanComponent.vue';
import { useRoute, useRouter } from "vue-router";
import * as env from '@/config/env';
import { apiRequest } from "../../../services";
import { taskPlanPermission } from "@/composable/commonFunction";
import { useI18n } from "vue-i18n";
import {generateFileName} from '@/utils/storageQueryBuild.js';
import ImagesPreviewer from "@/components/organisms/ImagePreviewer/ImagesPreviewer.vue";
import { storageHelper } from "@/composable/commonFunction";
import { firstId } from '@/utils/taskOpenProjectId';

const { t } = useI18n();

// UTILS
const {debounce, makeUniqueId, changeText, checkLink, compareObjects,checkBucketStorage} = useCustomComposable();
const projectData = inject("selectedProject");

const {handleStorageImageRequest} = storageHelper();
const companyId = inject("$companyId");
const userId = inject("$userId");
const clientWidth = inject("$clientWidth");
const socket= inject("$socket");
const {getUser} = useGetterFunctions();
const {convertDateFormat} = useConvertDate();
const { checkTaskPerSprintPermisssion } = taskPlanPermission();
const $toast = useToast()
const  { checkErrors , checkAllFields } = useValidation();
const {getters,commit,dispatch} = useStore();
const router = useRouter();
const route = useRoute();

// IMAGES
const attachIcon = require("@/assets/images/footerAttachmenticon.svg");
const sendIcon = require("@/assets/images/footerbtnsend.svg");
const downArrow = require("@/assets/images/dropdown-arrow.png");
const closeIcon = require("@/assets/images/svg/CloseSidebar_red.svg");

const element = ref(null);
const loadingChat = ref(true);

defineComponent({
    name: "Comments-Component",
    components: {
        Comment,
        CommentInput,
        Record,
        Modal,
        SelectComp,
        InputText,
        DragDrop,
        MediaConfirmation
    }
});

// PROPS
const props = defineProps({
    taskId: {
        type: String,
        default: ""
    },
    projectId: {
        type: String,
        default: ""
    },
    creator: {
        type: Object,
        default: () => {}
    },
    parentTaskId: {
        type: String,
        default: ""
    },
    title: {
        type: String,
        default: ""
    },
    newChat: {
        type: Boolean,
        default: false
    },
    sprintId: {
        type: String,
        default: ""
    },
    folderId: {
        type: String,
        default: null
    },
    userIds: {
        type: Array,
        default: () => []
    },
    watchers: {
        type: Array,
        default: () => []
    },
    checklistArray: {
        type: Array,
        default: () => []
    },
    mainChat: {
        type: Boolean,
        default: false
    },
    sendMessageAllowed: {
        type: Boolean,
        default: true
    },
    folderName: {
        type: String,
        default : ''
    },
    sprintName: {
        type: String,
        default : ''
    },
    productData: {
        type: Object,
        default : () => {}
    },
    forSupport: {
        type: Boolean,
        default : false
    },
    commentType: {
        type: String,
        default : 'tasks'
    },
    isHeight: {
        type: Number,
        default : 24
    },
    selectedChat: {
        type: Object,
        default : () => {}
    }
})

const fileExtentions = computed(() => {
    return getters['settings/fileExtentions'];
});

const currentCompany = computed(() => getters["settings/selectedCompany"]);
const commentRoomData = computed(()=> getters['mainChat/getCommentRoomData']);

const newMainChat = ref();

const createInProgress = ref(false);
const messageQueue = ref([]);

const companyOwner = computed(() => getters["settings/companyOwnerDetail"])
const showDropZone = ref(false);

const recording = ref(false);
const recordingProgress = ref(0);
const recordTime = ref("00:00");

const createTask = ref(false);
const sprintOptions = ref([]);
const formData = ref({
    taskName: {
        value: "",
        rules:
        "required | min: 3",
        name: "name",
        error: "",
    },
    selectedSprint: {
        value: "",
        rules:
        "required",
        name: "sprint",
        error: "",
    },
    selectedType: {
        value: "",
        rules:
        "required",
        name: "task type",
        error: "",
    }
});

const createEmptyMessage = () => ({
    reply:{},
    replyMessageId:"",
    message:"",
    mediaURL: undefined,
    mediaName: undefined,
    mediaSize: undefined,
});

const COMMENT_DRAFT_PREFIX = "alianhub:comment-draft";

const message = ref(createEmptyMessage());
const mediaFiles = ref([]);
const messages = ref([]);
const showScrollBotton = ref(false);
const currentTime = ref();
const customerDetails = ref();
const documentPath = ref("");
const projectPath = ref("");
const commentPath = ref("");
const mediaPath = ref("");
const totalMessages = ref(0);
const page = ref(1);
const messageLimit = ref(25);
const snapshotListener = ref(null);
const initalUser = ref(null);
const users = ref([]);
const unreadMessages = ref(0);
let debounceTimeout;
const countGetter = computed(() => {
    const { projectId, taskId, sprintId } = commentThreadQuery();
    const pid = projectId || firstId(projectData.value && projectData.value._id);
    if (!pid) return 0;
    return getters["users/myCounts"]?.data?.[`${taskId ? "task" : "project"}_${pid}${taskId ? `_${sprintId}_${taskId}` : ``}_comments`] || 0
})
watch(countGetter, (val) => {
    unreadMessages.value = val;
}, {immediate: true})
const userCommentCount = computed(() => {
    return  getters["users/myCounts"]?.data || {}
})
const adminUsers = computed(() => getters["settings/companyUsers"].filter((x) => x.roleType === 2)?.map((x) => x.userId) )
const companyUser = ref(getters['settings/companyUserDetail']);
const messageAllowed = computed(() => {
    if(props.mainChat && !projectData.value?.default && !props.sendMessageAllowed) {
        let allowed = false;
        let userRole= [1,2,7]
        if (userRole.includes(companyUser?.value?.roleType)) {
            allowed = true
        }

        return allowed;
    } else {
        return true;
    }
})
const popupDate = ref(0);
const resetUnread = ref(false);
const sprintFolders = ref({});
const sprintData = ref([]);
const folderData = ref([]);
const showPreviewer = ref(false);
const activeIndex = ref(0);
const transformedAttachments = ref([]);

const mentionRegex = ref(/@\[[\w ]+?\]\(\w{4,30}\)/gi)
const socketConnectionPromise = () => {
    return new Promise((resolve) => {
        setTimeout(()=> {
            let attempts = 0;
            const maxAttempts = 3;
            const checkSocketConnection = setInterval(() => {
                if (socket.value && socket.value.id) {
                    clearInterval(checkSocketConnection);
                    resolve();
                } else if (attempts >= maxAttempts) {
                    clearInterval(checkSocketConnection);
                    resolve();
                }
                attempts++;
            }, 1000);
        })
    });
}

function adjustDynamicWidth() {
    const footer = document.getElementById("comment_footer")
    if(props.mainChat) {
        if(footer){
            footer.style.width = "-webkit-fill-available"
            footer.style.width = "-moz-available"
            footer.style.width = footer.parentElement.parentElement.clientWidth+"px";
        }
    } else {
        if(footer){
            footer.style.width = footer.parentElement.parentElement.clientWidth+"px"
        }
    }
}

onMounted(async () => {
    try {
        adjustDynamicWidth();
        document.addEventListener('visibilitychange', visibilityHandler);
        await socketConnectionPromise();
        initialize();
        sprintData.value = getters["mainChat/mainChatSprints"][projectData.value._id];
        folderData.value = getters["mainChat/mainChatFolders"][projectData.value._id];
        if(projectData?.value?._id){
            getSprintFolderData(projectData.value._id); 
        }
    } catch (error) {
        console.error(error);
    }
})

watch(route, (newVal) => {
    if(newVal.hash) {
        highlightMessage({_id: newVal.hash.replace("#", "")})
    }
})

watch(projectData, (newProj, oldProj) => {
    if(newProj._id !== oldProj._id) {
        initialize();
        getSprintFolderData(newProj._id); 
    }
})

watch([() => props.sprintId, () => props.taskId, () => props.projectId], ([newSprint, newTask, newProject], [oldSprint, oldTask, oldProject]) => {
    if(newSprint !== oldSprint || newTask !== oldTask || newProject !== oldProject) {
        initialize();
    }
})
async function initialize() {
    restoreMessageDraft();
    page.value = 1;
    resetUnread.value = false;
    // unreadMessages.value = 0;
    detachSnapshot();

    if(!props.mainChat) {
        sprintOptions.value = [...(projectData.value?.sprintsObj ? Object.values(projectData.value.sprintsObj).filter((x) => !x.deletedStatusKey) : [])]
        if(projectData.value.sprintsfolders && Object.values(projectData.value.sprintsfolders).length) {
            Object.values(projectData.value.sprintsfolders).forEach((x) => {
                if(!x.deletedStatusKey) {
                    sprintOptions.value = [...sprintOptions.value, ...(Object.values(x?.sprintsObj || {})?.length ? Object.values(x.sprintsObj || {}).filter((y) => !y.deletedStatusKey) : [])];
                }
            })
        }
    }


    // AUTO FOCUS TEXTBOX
    nextTick(() => {
        document.getElementById("message-box")?.focus();
    })

    // ASSIGN PATHS
    if(props.taskId && props.taskId.length) {
        // TASK
        projectPath.value = `${companyId.value}/${companyId.value}/${props.mainChat ? dbCollections.MAIN_CHATS : dbCollections.PROJECTS}/${projectData.value._id}`
        documentPath.value = `${companyId.value}/${companyId.value}/${props.mainChat ? dbCollections.MAIN_CHATS : dbCollections.PROJECTS}/${projectData.value._id}/${props.sprintId}/${props.taskId}`
        commentPath.value = `${companyId.value}/${companyId.value}/${props.mainChat ? dbCollections.MAIN_CHATS : dbCollections.PROJECTS}/${projectData.value._id}/${props.sprintId}/${props.taskId}/${dbCollections.COMMENTS}`
        mediaPath.value = `${companyId.value}/${props.mainChat ? dbCollections.MAIN_CHATS : dbCollections.PROJECTS}/${projectData.value._id}/${props.sprintId}/${props.taskId}/comments/`
    } else {
        // PROJECT
        documentPath.value = `${companyId.value}/${companyId.value}/${props.mainChat ? dbCollections.MAIN_CHATS : dbCollections.PROJECTS}/${projectData.value._id}`
        commentPath.value = `${companyId.value}/${companyId.value}/${props.mainChat ? dbCollections.MAIN_CHATS : dbCollections.PROJECTS}/${projectData.value._id}/${dbCollections.COMMENTS}`
        mediaPath.value = `${companyId.value}/${props.mainChat ? dbCollections.MAIN_CHATS : dbCollections.PROJECTS}/${projectData.value._id}/comments/`
    }
    if(!props.mainChat) {
        const user = getUser(props.creator?.uid);

        initalUser.value = {
            name: user.Employee_Name,
            image: user.Employee_profileImageURL,
            createdAt: props.creator?.date
        }
    }

    setUsers();

    if(unreadMessages.value > messageLimit.value) {
        messageLimit.value = unreadMessages.value;
    }

    getMessages();

    // SHOW DAY POPUP BLOCK
    element.value?.addEventListener("scroll", () => {
        if(messages.value.length) {
            let timed = messages.value.filter((x) => x.showDifference).map((x) => x._id);
            if(timed.length) {
                timed = timed.map((x) => ({id: x, top: document.getElementById(x)?.getBoundingClientRect().top})).filter((x) => x.top - (125 + (props.mainChat ? 0 : props.taskId ? 100 : 45)) >= 0);
                if(timed.length) {
                    let msgId = timed[0].id

                    let ind = messages.value.findIndex((x) => x._id === msgId);

                    if(ind > 0) {
                        popupDate.value = (new Date(messages.value[ind - 1].createdAt).getTime()/1000) || 0
                    } else {
                        popupDate.value = 0;
                    }
                } else {
                    popupDate.value = 0;
                }
            } else {
                popupDate.value = (new Date(messages.value[messages.value.length - 1].createdAt).getTime()/1000);
            }
        } else {
            popupDate.value = 0;
        }
    })
}
const visibilityHandler = async () => {
    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(async () => {
        if (!document.hidden) {
            if (Object.keys(commentRoomData.value).length) {
             try {
                   await socketConnectionPromise();
                   let roomName = getRoomName(commentRoomData.value);
                   socket.value.emit('joinCommentRoom',{roomName,socketId: socket.value.id});
                   await tabSyncDataGet();
                   handleSocketData();
             } catch (error) {
                console.error("Error PROCESS COMMENTS TAB VISSIBILITY",error);
             }
            }
        }
    }, 1000);
};

function commentThreadQuery() {
    const projectId = firstId(
        props.projectId,
        projectData.value && projectData.value._id,
        route.params && route.params.id,
    );
    const taskId = firstId(props.taskId) || (props.taskId === 'default' ? 'default' : '');
    const sprintId = firstId(props.sprintId);
    return { projectId, taskId, sprintId };
}

function commentMessagesUrl({ skipValue = 0, batchLimit = messageLimit.value, tabLeaveTime = '', sort = '' } = {}) {
    const { projectId, taskId, sprintId } = commentThreadQuery();
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', projectId);
    if (taskId) params.set('taskId', taskId);
    if (sprintId) params.set('sprintId', sprintId);
    params.set('isDefault', projectData.value?.default ? 'true' : 'false');
    params.set('mainChat', props.mainChat ? 'true' : 'false');
    params.set('skipValue', String(skipValue));
    params.set('batchLimit', String(batchLimit));
    if (tabLeaveTime) params.set('tabLeaveTime', String(tabLeaveTime));
    if (sort) params.set('sort', sort);
    return { url: `${env.API_COMMENTS}/get-paginated-messages?${params.toString()}`, projectId, taskId, sprintId };
}

function tabSyncDataGet () {
    return new Promise((resolve, reject) => {
        try {
            let tabLeaveTime = sessionStorage.getItem('tableaveTime');
            const { url, projectId } = commentMessagesUrl({
                skipValue: 0,
                batchLimit: messageLimit.value,
                tabLeaveTime,
            });
            if (!projectId) {
                resolve();
                return;
            }
            apiRequest("get", url).then((response) => {
                response.data.data.forEach((docData)=> {
                    let index = messages.value.findIndex((x) => x._id === docData._id);
                    if(index > -1) {
                        messages.value[index] = {...docData, sent: docData.userId === userId.value};
                    } else {
                        let obj = {...docData, sent: docData.userId === userId.value};
                        if(messages.value.length > 1 && obj.createdAt !== undefined && new Date(obj.createdAt).setHours(0,0,0,0) !== new Date(messages.value[messages.value.length-1].createdAt).setHours(0,0,0,0)) {
                            obj.showDifference= true;
                        }
                        messages.value.push(obj);
                    }
                })
                resolve();
            }).catch((error)=>{
                reject(error);
            })
        } catch (error) {
            reject(error);
        }
    })
}
onBeforeUnmount(() => {
    element.value?.removeEventListener("scroll", debounce(watchScroll, 50));
    element.value?.removeEventListener("click", watchClick);
    document.removeEventListener('visibilitychange', visibilityHandler);
    // DETACH
    detachSnapshot();
})

watch([loadingChat, clientWidth], ([loading]) => {
    if(!loading) {
        setTimeout(() =>{
            adjustDynamicWidth();
            element.value = document.getElementById("message_container");
            element.value?.addEventListener("click", watchClick);
            element.value?.addEventListener("scroll", debounce(watchScroll, 50));
        })
    }
})

watch(() => props.userIds, () => {
    setUsers();
})

watch(message, () => {
    persistMessageDraft();
}, {deep: true})

function setUsers() {
    let tmp = [];
    if(props.mainChat) {
        if(!projectData.value?.default) {
            tmp = Array.from(new Set([...(props.userIds || [])]))
        } else {
            tmp = Array.from(new Set([...props.userIds]))
        }
    } else {
        if(props.taskId) {
            tmp = Array.from(new Set([companyOwner.value.userId, ...adminUsers.value, ...props.userIds || {}]))
        } else {
            tmp = Array.from(new Set([companyOwner.value.userId, ...adminUsers.value, ...(props.userIds || [])]))
        }
    }
    tmp = tmp?.filter((x) => x);
    users.value = tmp.map((x) => {
        const user = getUser(x);
        return {
            name: user.Employee_Name,
            image: user.Employee_profileImageURL,
            id: user.id,
            ghostUser: user.ghostUser
        }
    })
}

watch(projectData, (val) => {
    if(props.taskId.length) {
        if(val.taskComments?.[`${props.sprintId}_${props.taskId}`]?.[userId.value] > 0 && resetUnread.value === true) {
            updateCount(true, 0);
        }
    } else {
        if(unreadMessages.value > 0 && resetUnread.value === true) {
            updateCount(true, 0);
        }
    }

    if(!props.mainChat) {
        sprintOptions.value = [...(val?.sprintsObj ? Object.values(val.sprintsObj).filter((x) => !x.deletedStatusKey) : [])]
        if(val.sprintsfolders && Object.values(val.sprintsfolders).length) {
            Object.values(val.sprintsfolders).forEach((x) => {
                if(!x.deletedStatusKey) {
                    sprintOptions.value = [...sprintOptions.value, ...(Object.values(x?.sprintsObj || {})?.length ? Object.values(x.sprintsObj || {}).filter((y) => !y.deletedStatusKey) : [])];
                }
            })
        }
    }
})

function getLatestMessage(projectId, taskId, sprintId, messageData) {
    return new Promise((resolve, reject) => {
        try {
            const params = new URLSearchParams();
            const pid = firstId(projectId);
            const tid = firstId(taskId) || (taskId === 'default' ? 'default' : '');
            const sid = firstId(sprintId);
            if (pid) params.set('projectId', pid);
            if (tid) params.set('taskId', tid);
            if (sid) params.set('sprintId', sid);
            params.set('sort', 'createdAt:desc');
            params.set('batchLimit', '1');
            const url = `${env.API_COMMENTS}/get-paginated-messages?${params.toString()}`;
            apiRequest("get", url)
            .then((response) => {
                const latestMessage = response.data.data[0];
                if (!latestMessage) {
                    reject("No latest message found");
                }
                const isLastCreatedMessage = latestMessage._id === messageData._id;
                resolve({ latestMessage, isLastCreatedMessage});
            })
            .catch((error) => {
                console.error("Error fetching the latest message:", error);
                reject(error);
            });
        } catch (e) {
            reject(e);
        }
    })
}


function watchScroll(e) {
    if(e.target.scrollTop < (e.target.scrollHeight - e.target.offsetHeight - 500)) {
        showScrollBotton.value = true;
    } else {
        showScrollBotton.value = false;
    }

    if(e.target.scrollTop < 400 && e.target.scrollTop > 0) {
        getPaginatedMessages();
    }
}

function watchClick(e) {
    if(unreadMessages.value && document.hasFocus()) {
        e.preventDefault();

        if(e.target === document.getElementById("mark_as_unread")) {
            return;
        }
        resetUnread.value = true;
        updateCount(true, 0);
    }
}

function scrollBottom(){
    setTimeout(() => {
        element.value?.scrollTo({top: element.value?.scrollHeight, left: 0, behavior: "smooth"});
    }, 300)
}

function getCommentDraftKey() {
    const projectId = projectData.value?._id;
    if(!companyId.value || !projectId) return "";

    const scope = props.mainChat ? "main-chat" : "comments";
    const sprintId = props.sprintId || "project";
    const taskId = props.mainChat && props.newChat && newMainChat.value
        ? newMainChat.value
        : (props.taskId || "project");

    return [COMMENT_DRAFT_PREFIX, companyId.value, projectId, scope, sprintId, taskId].join(":");
}

function getDraftPayload() {
    const draft = message.value || {};
    return {
        ...draft,
        reply: draft.reply || {},
        replyMessageId: draft.replyMessageId || "",
        message: draft.message || "",
        mediaURL: draft.mediaURL,
        mediaName: draft.mediaName,
        mediaSize: draft.mediaSize,
    };
}

function hasDraftPayload(draft = getDraftPayload()) {
    return Boolean(
        draft._id ||
        draft.message?.trim()?.length ||
        (draft.reply && Object.keys(draft.reply).length)
    );
}

function persistMessageDraft() {
    const key = getCommentDraftKey();
    if(!key) return;

    try {
        const draft = getDraftPayload();
        if(hasDraftPayload(draft)) {
            sessionStorage.setItem(key, JSON.stringify(draft));
        } else {
            sessionStorage.removeItem(key);
        }
    } catch (error) {
        console.error("ERROR in persistMessageDraft hook: ", error);
    }
}

function restoreMessageDraft() {
    const key = getCommentDraftKey();
    if(!key) {
        message.value = createEmptyMessage();
        return;
    }

    try {
        const rawDraft = sessionStorage.getItem(key);
        message.value = rawDraft
            ? {...createEmptyMessage(), ...JSON.parse(rawDraft)}
            : createEmptyMessage();
    } catch (error) {
        console.error("ERROR in restoreMessageDraft hook: ", error);
        message.value = createEmptyMessage();
    }
}

function clearMessageDraft(key = getCommentDraftKey()) {
    if(!key) return;

    try {
        sessionStorage.removeItem(key);
    } catch (error) {
        console.error("ERROR in clearMessageDraft hook: ", error);
    }
}

function resetMessage() {
    const draftKey = getCommentDraftKey();
    message.value = createEmptyMessage();
    clearMessageDraft(draftKey);
}

function pinMessage(message) {
    try {
        let pinValue = message?.pinnedMessage === undefined ? true : !message?.pinnedMessage;

        const params = {
            id: message._id,
            data: { pinnedMessage: pinValue },
            isProjectComment: message.project,
            options: {
                timestamps: false
            }
        }
        apiRequest("put", env.API_COMMENTS, params).then(() => {
            message.pinnedMessage = pinValue;
            $toast.success(t(`Toast.Message ${pinValue ? 'pinned' : 'unpinned'} successfully`), {position: "top-right"});
        })
        .catch((error) => {
            console.error(`Error in pinMessage hook => ${error}`);
        })
    } catch (e) {
        console.error("ERROR in pin message: ", e);
    }
}

function editMessage(msg) {
    const tmpMsg = msg.message
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'");
    getReplyReferenceMessage();
    message.value = JSON.parse(JSON.stringify({...msg, message: tmpMsg, reply: msg.reply ? msg.reply : {}}));

    document.getElementById("message-box")?.focus();
}

function replyMessage(msg) {
    message.value.reply = JSON.parse(JSON.stringify(msg));

    document.getElementById("message-box")?.focus();
}

function copyMessage(message) {
    $toast.success(t(`Toast.Message_copied`), {position: "top-right"});
    navigator.clipboard.writeText(message);
}

function sendRecord(data) {
    checkMedia([data.file.data]);
}

function addToCheckList(msg) {
    const totalCharacter = 250;

    const name = msg.trim();
    if(!name || !name.length) {
        $toast.error(t("Toast.Item_cannot_be_empty"), {position: "top-right"});
        return;
    } else if(name.length > 250) {
        $toast.error(t("Toast.Maximum_MAX_CHAR_characters_are_allowed").replace('MAX_CHAR', totalCharacter), {position: "top-right"});
        return;
    }

    let uniqueId = makeUniqueId(6);
    let updateObj = [
        {
            AssigneeUserId: [],
            id: uniqueId,
            name: "Checklist",
            isChecked: false,
            isExpand: false
        }
    ]

    const strArray = name.split('\n');

    strArray.forEach((x) => {
        if(x?.trim()?.length) {
            updateObj.push({
                AssigneeUserId: [],
                isChecked: false,
                parentId: uniqueId,
                name: x,
                id: makeUniqueId(6)
            })
        }
    })
    if(props.taskId) {
        const user = getUser(userId.value)
        let historyObj = {
            key : "checklistadd",
            Employee_Name: user.Employee_Name,
            userId: user.id,
            taskName: props.title,
            projectName: projectData.value.ProjectName,
            name: "Checklist"
        }
        let localUpdateArray = [...new Set([...JSON.parse(JSON.stringify(props.checklistArray)) || [], ...updateObj])];

        taskClass.updateChecklistsv2({localUpdateArray:localUpdateArray,data:updateObj, projectId:projectData.value._id, taskId:props.taskId,historyObj,sprintId:props.sprintId,companyId:companyId.value,ops:'checklistadd',taskData: {folderObjId:props.folderId,sprintId:props.sprintId}}).then(()=>{
            $toast.success(t('Toast.Item_added_to_checklist'), {position: 'top-right'})
        }).catch((error) => {
            console.error("ERROR in delete: ", error.message);
        });
        return;
    }

    let promises = [];
    updateObj.forEach((x) => {
        promises.push(
            new Promise((resolve, reject) => {
                try {
                    const axiosParams = {
                        id: projectData.value._id,
                        checklistItem: x,
                        operation: 'push'
                    }

                    apiRequest("post", `${env.PROJECTS_CHECKLIST}`, axiosParams).then(() => {
                        resolve();
                        if(x.parentId){
                            const user = getUser(userId.value)
    
                            const userData = {
                                id: user.id,
                                Employee_Name: user.Employee_Name,
                                companyOwnerId: companyOwner.value.userId,
                            }
                            let historyObj = {
                                key : props.taskId ? "Task_Comment" : "Project_Comment",
                                message : `<b>${userData.Employee_Name}</b> has added <b>${x.name}</b> checklist from <b>(${projectData.value.ProjectName} ${props.folderName ? '/' + props.folderName : ''}${props.sprintName ? '/' + props.sprintName : ''}${props.taskId ? '/' + props.title : ''})</b> ${props.taskId ? 'task' : 'project'}.`
                            }
                            apiRequest("post", env.HANDLE_HISTORY, {
                                "type": props.taskId ? 'task':'project',
                                "companyId": companyId.value,
                                "projectId": projectData.value._id,
                                "taskId": props.taskId ? props.taskId : null,
                                "object": historyObj,
                                "userData": userData
                            })
                        }
                    })
                    .catch((error) => {
                        reject(error)
                    })
                } catch (error) {
                    reject(error)
                }
            })
        )
    })

    Promise.allSettled(promises)
    .then(() => {
        $toast.success(t("Toast.Item_added_to_checklist"), {position: 'top-right'})
        const localUpdateArray = [...new Set([...JSON.parse(JSON.stringify(props.checklistArray)) || [], ...updateObj])];
        commit('projectData/projectLocalUpdate', { itemData:  {...projectData.value, checklistArray: localUpdateArray }});
    })
    .catch((error) => {
        $toast.error(t("Toast.something_went_wrong"), {position: 'top-right'})
        console.error("ERROR in add to checklist: ", error);
    })
}

function deleteMessage(message) {
    getLatestMessage(projectData.value._id, props.taskId, props.sprintId, message)
    .then(({ latestMessage, isLastCreatedMessage }) => {
        if (latestMessage && isLastCreatedMessage) {
            debounce(updateLastMessageTime({
                ...message,
                message: "general.message_deleted",
            }), 500);
        }
    })
    .catch((error) => {
        console.error("Error fetching the latest message:", error);
    });

    const params = {
        id: message._id,
        data: { isDeleted: true },
        isProjectComment: message.project
    }
    apiRequest("put", env.API_COMMENTS, params).then(() => {
        message.isDeleted = true;
        if(message.type !== 'text' && message.type !== 'link') {
            deleteFromWasabi(message.mediaURL, companyId.value)
            .catch((error) => {
                console.error("Error in remove media from storage: ", error);
            })
        }
    })
    .catch((error) => {
        console.error(`Error in deleteMessage hook => ${error}`);
    })
}

function resetTaskData() {
    Object.values(formData.value).forEach((item) => {
        item.value = "";
        item.error = "";
    })
}
function saveTask() {
    return new Promise((resolve, reject) => {
        try {
            checkAllFields(formData.value)
            .then((valid) => {
                if(valid) {
                    checkTaskPerSprintPermisssion(formData.value.selectedSprint.value.id).then((resp) => {
                        if(resp){
                            if(formData.value.taskName.value.trim().length < 3 || formData.value.taskName.value.trim().length > 250) return;
        
                            const name = formData.value.taskName.value.trim();
                            formData.value.taskName.value = "";
                            formData.value.taskName.error = "";
        
                            const user = getUser(userId.value)
        
                            const userData = {
                                id: user.id,
                                Employee_Name: user.Employee_Name,
                                companyOwnerId: companyOwner.value.userId,
                            }
        
                            let sprintObj = {
                                id: formData.value.selectedSprint.value.id,
                                name: formData.value.selectedSprint.value.name,
                                value: formData.value.selectedSprint.value.value
                            }
        
                            if(formData.value.selectedSprint.value.folderId) {
                                sprintObj.folderId = formData.value.selectedSprint.value.folderId;
                                sprintObj.folderName = formData.value.selectedSprint.value.folderName;
                            }
        
                            let status = projectData.value.taskStatusData.find((x) => x.type === "default_active");
        
                            const obj = {
                                'TaskName': name,
                                'TaskKey': '--',
                                'AssigneeUserId': props.mainChat ? [userId.value, props.taskId] : [],
                                'watchers': [userId.value, props.taskId],
                                'DueDate': "",
                                'dueDateDeadLine': [],
                                'TaskType': formData.value.selectedType.value.value,
                                'TaskTypeKey': formData.value.selectedType.value.key,
                                'ParentTaskId': "",
                                'ProjectID': projectData.value._id,
                                'CompanyId': companyId.value,
                                'status': {
                                    "text": status.name,
                                    "key": status.key,
                                    "value": status.value,
                                    'type': status.type
                                },
                                'isParentTask': true,
                                'Task_Leader': userId.value,
                                'sprintArray': sprintObj,
                                'Task_Priority': "MEDIUM",
                                'deletedStatusKey': 0,
                                'sprintId': formData.value.selectedSprint.value.id,
                                'statusType': status.type,
                                'statusKey': status.key
                            }
        
                            if(props.mainChat) {
                                obj.mainChat = true;
                            }
        
                            const project = {
                                id: projectData.value._id,
                                CompanyId: companyId.value,
                                lastTaskId: projectData.value.lastTaskId || 0,
                                ProjectName: projectData.value.ProjectName,
                                ProjectCode: projectData.value.ProjectCode || ""
                            }
                            const indexObj = {
                                indexName : "groupByStatusIndex",
                                searchKey : "statusKey",
                                searchValue : "1"
                            }
                            taskClass.create({data: obj, user: userData, projectData: project ,indexObj})
                            .then((res) => {
                                if(res.status){
                                    if(!props.mainChat) {
                                        $toast.success(t(`Toast.task_created_successfully`), {position: "top-right"});
                                    }
                                    resolve(res.id);
                                }else if(res.isUpgrade){
                                    reject(t("Toast.create_task_plan_limit_message"))
                                    if(!props.mainChat) {
                                        $toast.error(t("Toast.create_task_plan_limit_message").replace('TASK_SPRINT', formData.value.selectedSprint.value.name), {position: "top-right"});
                                    } else {
                                        $toast.error(t(`Toast.something_went_wrong`), {position: "top-right"});
                                    }
                                }else{
                                    reject(t(`Toast.something_went_wrong`));
                                    $toast.error(t(`Toast.something_went_wrong`), {position: "top-right"});
                                }
                            })
                            .catch((error) => {
                                console.error("ERROR in create task: ", error);
                                reject(error)
                            })
                            createTask.value = false
                            resetTaskData();
                        }else{
                            reject(t("Toast.create_task_plan_limit_message"))
                            if(!props.mainChat) {
                                $toast.error(t("Toast.create_task_plan_limit_message").replace('TASK_SPRINT', formData.value.selectedSprint.value.name), {position: "top-right"});
                            } else {
                                $toast.error(t(`Toast.something_went_wrong`), {position: "top-right"});
                            }
                        }
                    })
                    .catch((error) => {
                        console.error("ERROR in check task permission: ", error);
                        reject(error)
                    })
                } else {
                    reject("Validation failed")
                }
            })
            .catch((error) => {
                reject(error);
                console.error("ERROR in check validation: ", error);
            })
        } catch (error) {
            reject(error);
        }
    })
}
/* --------------- GET/HANDLE MESSAGES --------------- */
function detachSnapshot() {
    if(snapshotListener.value) {
        snapshotListener.value = false;
    }
    if (Object.keys(commentRoomData.value).length) {
        const events = ['commentInsert', 'commentUpdate','commentDelete','commentReplace'];
        events.forEach(event => {
            socket.value.off(event);
        });
        let roomName = getRoomName(commentRoomData.value);
        socket.value.emit("leaveCommentRoom", roomName)
        commit("mainChat/setCommentRoomName",{});
    }
}

function getRoomName(obj) {
    const projectId = firstId(obj && obj.projectId);
    const sprintId = firstId(obj && obj.sprintId);
    const taskId = firstId(obj && obj.taskId) || (obj && obj.taskId === 'default' ? 'default' : '');
    if (sprintId && taskId) {
        return `comments_${projectId}_${sprintId}_${taskId}**${socket.value.id}`;
    } else {
        return `comments_project_${projectId}**${socket.value.id}`;
    }
}


function getMessages() {
    messages.value = [];
    totalMessages.value = 0;
    currentTime.value = new Date().setHours(new Date().getHours() - 1)
    const thread = commentThreadQuery();
    let obj = {
        'projectId': thread.projectId,
        ...(thread.sprintId ? {'sprintId': thread.sprintId} : ''),
        ...(!projectData.value?.default && props.mainChat ? {'taskId':"default"} : thread.taskId ? {'taskId': props.mainChat ? newMainChat.value : thread.taskId} : {"project": true})
    }
    if(props.mainChat && thread.taskId && thread.taskId !== "default") {
        obj.taskId = thread.taskId;
    }
    
    if(props.mainChat && projectData.value?.default && props.newChat) {
        loadingChat.value = false;
    }
    let roomName = getRoomName(obj);
    detachSnapshot();
    socket.value.emit('joinCommentRoom',{roomName,socketId: socket.value.id});
    commit("mainChat/setCommentRoomName",obj);
    handleSocketData();
}

function getMessageId(data = {}) {
    if (!data) return "";
    const raw = data._id != null ? data._id : data.id;
    if (raw == null || raw === "") return "";
    if (typeof raw === "object") {
        if (raw.$oid) return String(raw.$oid);
        if (typeof raw.toHexString === "function") return raw.toHexString();
    }
    const id = String(raw);
    return id === "[object Object]" ? "" : id;
}

function findMessageIndexById(data = {}) {
    const messageId = getMessageId(data);
    if(!messageId) return -1;

    return messages.value.findIndex((message) => {
        return getMessageId(message) === messageId || (message._id && String(message._id) === messageId);
    });
}

function decorateIncomingMessage(docData) {
    const obj = {...docData, sent: String(docData.userId) === String(userId.value)};
    const id = getMessageId(obj);
    if (id) {
        obj._id = id;
        obj.id = id;
    }
    const messageText = obj.message || "";
    obj.overflow = (obj.type === 'text' || obj.type === 'link')
        ? messageText.length > 465
        : messageText.length > 100;
    return obj;
}

function shouldShowDateDivider(obj) {
    return messages.value.length > 1
        && obj.createdAt !== undefined
        && new Date(obj.createdAt).setHours(0,0,0,0) !== new Date(messages.value[messages.value.length-1].createdAt).setHours(0,0,0,0);
}

function upsertIncomingComment(docData, {replaceSending = false, incrementTotal = false} = {}) {
    if(!docData) return false;

    const obj = decorateIncomingMessage(docData);
    const existingIndex = findMessageIndexById(obj);
    if(existingIndex > -1) {
        messages.value[existingIndex] = {...messages.value[existingIndex], ...obj};
        return false;
    }

    if(replaceSending) {
        let type = "";
        let name = "";
        if(docData.mediaURL && docData.mediaURL.length) {
            type = docData.type;
            name = docData.mediaName;
        }
        if(type && name) {
            const sendingIndex = messages.value.findIndex((x) => (x.isSending && x.type === type && x.mediaName === name));
            if(sendingIndex > -1){
                messages.value[sendingIndex] = obj;
                return false;
            }
        }
    }

    if(shouldShowDateDivider(obj)) {
        obj.showDifference = true;
    }
    messages.value.push(obj);
    if(incrementTotal) {
        totalMessages.value += 1;
    }
    return true;
}

function handleSocketData() {
    if(!snapshotListener.value) {
        snapshotListener.value = true;
    }

    socket.value.off("commentInsert");
    socket.value.off("commentUpdate");
    socket.value.off("commentDelete");
    socket.value.off("commentReplace");
    

    socket.value.on("commentInsert",(data)=> {
        let docData = data && (data.fullDocument || data);
        if(!docData) return;
        upsertIncomingComment(docData, {replaceSending: true, incrementTotal: true});
    })


    socket.value.on("commentUpdate",(data)=> {
        let docData = data.fullDocument;
        upsertIncomingComment(docData);
    })


    // HANDLE MESSAGE
    messages.value.forEach((x) => {
        if(x.type === 'text' || x.type === 'link') {
            x.overflow=x.message.length > 465
        } else {
            x.overflow=x.message.length > 100
        }
    })

    if(messages.value.length) {
        messages.value.sort((book1, book2) => {
            return compareObjects(book1, book2, 'createdAt')
        });

        if(messages.value.length < messageLimit.value) {
            if(messageLimit.value - messages.value.length > 25) {
                messageLimit.value = messageLimit.value - messages.value.length;
            } else {
                messageLimit.value = 25;
            }

            getPaginatedMessages()
            .then(() => {
                if(!resetUnread.value && unreadMessages.value && messages.value.length >= unreadMessages.value) {
                    nextTick(() => {
                        let ele = document.getElementById(messages.value[(messages.value.length) - unreadMessages.value]?._id)
                        if(ele) {
                            ele.scrollIntoView();
                        }
                    })
                } else {
                    nextTick(() => {
                        scrollBottom();
                    })
                }
            })
            .catch((error) => {
                console.error("ERROR in get message from mongo: ", error);
            })
        } else {
            if(messageLimit.value != 25) {
                messageLimit.value = 25;
            }

            getReplyReferenceMessage();
            if(!resetUnread.value && unreadMessages.value && messages.value.length >= unreadMessages.value) {
                nextTick(() => {
                    let ele = document.getElementById(messages.value[(messages.value.length) - unreadMessages.value]?._id)
                    if(ele) {
                        ele.scrollIntoView();
                    }
                })
            } else {
                nextTick(() => {
                    scrollBottom();
                })
            }
        }
    } else {
        getPaginatedMessages()
        .then(() => {
            if(!resetUnread.value && unreadMessages.value && messages.value.length >= unreadMessages.value) {
                nextTick(() => {
                    let ele = document.getElementById(messages.value[(messages.value.length) - unreadMessages.value]?._id)
                    if(ele) {
                        ele.scrollIntoView();
                    }
                })
            } else {
                nextTick(() => {
                    scrollBottom();
                })
            }
        })
        .catch((error) => {
            console.error("ERROR in get message from mongo: ", error);
        })
    }
}

function getPaginatedMessages(...args) {
    let findData;

    if(args.length === 1) {
        findData = args[0];
    }

    return new Promise((resolve, reject) => {
        try {
            const { projectId } = commentThreadQuery();
            if (!projectId) {
                loadingChat.value = false;
                resolve("No data");
                return;
            }
            const { url } = commentMessagesUrl({
                skipValue: totalMessages.value,
                batchLimit: messageLimit.value,
            });
            apiRequest("get", url).then((response) => {
                const results = response.data.data;

                if(!results.length) {
                    if(messages.value.length && !messages.value[0].showDifference) {
                        messages.value[0] = {...messages.value[0], showDifference: true};
                    }
                    getReplyReferenceMessage();
                    resolve("No data");
                    loadingChat.value = false;
                    return;
                }

                results.forEach((data) => {
                    const docData = data;

                    if(messages.value.findIndex(x => x._id === docData._id) === -1) {
                        if(messages.value[0] && !messages.value[0].showDifference && new Date(docData.createdAt).setHours(0,0,0,0) !== new Date(messages.value[0].createdAt).setHours(0,0,0,0)) {
                            messages.value[0] = {...messages.value[0], showDifference: true};
                        }

                        messages.value.unshift({
                            ...docData,
                            sent: docData.userId === userId.value,
                            createdAt: docData.createdAt,
                            updatedAt: docData.updatedAt
                        });
                    }
                })

                totalMessages.value += results?.length

                if(results.length < messageLimit.value) {
                    messages.value[0].showDifference = true;
                }

                if(findData) {
                    if(messages.value.filter((x) => x._id === findData._id).length) {
                        setTimeout(() => {
                            document.getElementById(findData._id).scrollIntoView({behavior: 'smooth'});
                            highlightMessage(findData);
                        }, 200)
                    } else {
                        getPaginatedMessages(findData);
                    }
                }

                messages.value.forEach((x) => {
                    if(x.type === 'text' || x.type === 'link') {
                        x.overflow=x.message.length > 465
                    } else {
                        x.overflow=x.message.length > 100
                    }
                })

                if(!resetUnread.value && unreadMessages.value && messages.value.length >= unreadMessages.value) {
                    nextTick(() => {
                        let ele = document.getElementById(messages.value[(messages.value.length) - unreadMessages.value]?._id)
                        if(ele) {
                            ele.scrollIntoView();
                        }
                    })
                }

                getReplyReferenceMessage();
                resolve("Data fetched successfully!");
                loadingChat.value = false;
            })
            .catch((error) => {
                loadingChat.value = false;
                console.error("ERROR in getPaginatedMessages hook: ", error);
                reject(error)
            })
        } catch(error) {
            loadingChat.value = false;
            reject({message: "ERROR TRY-CATCH in get data from mongo: " + error.message, error: error});
        }
    })
}

function highlightMessage(data) {
    let element = document.getElementById(data._id);

    if(element !== undefined && element !== null) {
        element.classList.toggle("highlighted-message");
        element.scrollIntoView({behavior: 'smooth'});

        setTimeout(()=>{
            element.classList.toggle("highlighted-message");
        }, 2000)
    } else {
        getPaginatedMessages(data).catch((error) => {
            console.error("ERROR in get message on ref: ", error);
        });
    }
}

function getReplyReferenceMessage() {
    messages.value.filter((x) => x.hasReply && x.reply === undefined).forEach((message) => {
        let obj = {};
        Object.keys(message).filter(key => key.includes("reply_")).forEach((key) => {
            obj[key.replace("reply_", "")] = message[key]
        })
        message.reply = obj;
    })
}
/* --------------- GET/HANDLE MESSAGES END --------------- */

/* --------------- SEND MESSAGES --------------- */
function uploadToStorage(file) {
    return new Promise((resolve, reject) => {
        try {
            let name = generateFileName(file.mediaOriginalName,env.STORAGE_TYPE);
            let path = ``
            if(props.taskId) {
                path = `Project/${projectData.value._id}/${props.sprintId}/${props.taskId}/Comments/${name}`
            } else {
                path = `Project/${projectData.value._id}/Comments/${name}`
            }

            uploadToWasabi(file.data, path, companyId.value)
            .then((URL) => {
                let msg = {...message.value};
                msg.mediaURL= URL;
                msg.mediaName= file.name;
                msg.mediaOriginalName= file.mediaOriginalName;
                msg.mediaSize= file.data.size;
                msg.type = file.fileType;
                msg.createdAt = file.createdAt;
                sendMessageFun({
                    ...msg
                },false)
                .then(() => {
                    resolve();
                })
                .catch((error) => {
                    reject(error);
                    console.error("ERROR in send file: ", error);
                })
            })
            .catch((error) => {
                console.error("ERROR: ", error);
            })
        } catch (error) {
            reject(error);
        }
    })
}

function checkMedia(data) {
    if(checkBucketStorage(data.map(file => file?.size),{gettersVal: getters}) !== true){
        return;
    }
    if(mediaFiles.value.length + data.length > 10) {
        $toast.error(t("Toast.Maximum_10_files_can_be_uploaded_at_once"), {position: "top-right"});
    }
    checkFile(data, fileExtentions.value)
    .then((files) => {
        files.forEach((file) => {
            let fileName = `${makeUniqueId()}_${file.name}`;
            renderFiles({data: file.data, name: fileName, mediaOriginalName: file.name, fileType: file.fileType}, userId.value)
            .then((result) => {
                if(mediaFiles.value.length < 10) {
                    mediaFiles.value.push({...result, file: file, message: ""});
                }
            })
            .catch((error) => {
                console.error("ERROR in render file: ", error);
            })
        })
    })
    .catch((error) => {
        console.error("ERROR in send file: ", error);
    })
}

async function sendMedia() {
    if(createInProgress.value) {
        messageQueue.value = [...messageQueue.value, ...mediaFiles.value];
        return;
    }
    if(props.newChat && !newMainChat.value) {
        messageQueue.value = [...messageQueue.value, ...mediaFiles.value];

        let success = await createTaskForMainChat()
        .then(() => {
            return true;
        })
        .catch((error) => {
            console.error("ERROR: ", error);
            return false;
        })

        if(!success) {
            return Promise.reject(new Error("Failed to create"));
        }
    }
    return new Promise((resolve, reject) => {
        try {
            scrollBottom();
            let promises = [];
            let tmpMessage = JSON.parse(JSON.stringify(message.value));
            let tempDate = new Date().toISOString();
            message.value.message = "";
            mediaFiles.value.forEach((media) => {
                media.createdAt = new Date();
                media.updatedAt = media.createdAt;
                messages.value.push({...media});
                promises.push(
                    new Promise((resolve2, reject2) => {
                        try {
                            message.value.reply = {};
                            uploadToStorage({data: media.file.data, name: media.mediaName, mediaOriginalName: media.mediaOriginalName, fileType: media.type,createdAt: tempDate})
                            .then(() => {
                                resolve2()
                            })
                            .catch((error) => {
                                reject2(error);
                            })
                        } catch (error) {
                            reject2(error);
                        }
                    })
                )
            });

            tmpMessage.createdAt = tempDate
            sendMessageFun(tmpMessage, false);
            Promise.allSettled(promises)
                .then(() => {
                    resolve(true);
                })
            .catch((error) => {
                console.error("ERROR: ", error);
                reject(error);
            })
            mediaFiles.value = [];
        } catch (error) {
            reject(error);
        }
    })
}

function checkMentions(message){
    let msg = message;

    let mentions = [];
    let tmpMentions = msg.match(mentionRegex.value);

    if(tmpMentions !== null) {
        tmpMentions.forEach((data) => {
            let id = data.split("(")[1].replace(")", "");
            let msgName = data.split("(")[0].replace("[", "").replace("]", "");
            if(id === 'alian') {
                return;
            }
            const user = id === "everyone" ? {id, name: "All"} : users.value.filter((x) => x.id === id)[0];
            if(!user) {
                return;
            }
            if(`@${user.name}` === msgName) {
                mentions.push(user.id)
                msg = msg.replace(data, `@[${user.name}](${user.id})`);
            }
        })
    }
    mentions = Array.from(new Set(mentions));
    return {mentions, msg};
}

function updateCount(reset = false, count = 0, otherUsers = []) {
    let taskId = props.taskId;
    if(props.newChat) {
        taskId = newMainChat.value;
    }

    const prevCount = unreadMessages.value; // Store unreadMessages.value in a temporary variable
    unreadMessages.value = 0;
    if(reset) {
        if(!document.hasFocus()) return;

        let axiosData = {
            companyId : companyId.value,
            projectId: projectData.value._id,
            userIds: [userId.value],
            ...(count ? {"set": true} : {"read": true}),
            key: taskId ? 2 : 1,
            ...(taskId ? {taskId} : {}),
            ...(props.sprintId ? {sprintId: props.sprintId} : {}),
            messageCount: count,
            prevCount: prevCount
        }

        if(props.parentTaskId) {
            axiosData.parentTaskId = props.parentTaskId;
        }
        apiRequest("post", env.UPDATE_UNREADREAD_COMMENTS_COUNT, axiosData).then(() => {
            if(axiosData.messageCount === 0){
                let sprintFieldName =  `sprint_${projectData.value._id}_${props.sprintId}_comments`
                let taskFieldName = `task_${projectData.value._id}${ `_${props.sprintId}_${props.taskId}`}_comments`;
                let parentTaskField = ''
                if(props.parentTaskId) {
                    parentTaskField = `parentTask_${projectData.value._id}${`_${props.sprintId}_${props.parentTaskId}`}_comments`;
                }

                userCommentCount.value[sprintFieldName] = (userCommentCount.value?.[sprintFieldName] || 0) - axiosData.prevCount;
                userCommentCount.value[taskFieldName] =  axiosData.messageCount;
                if(parentTaskField){
                    userCommentCount.value[parentTaskField] =  (userCommentCount.value?.[parentTaskField] || 0) - axiosData.prevCount;
                }

                // REMOVE KEY IF COUNT <= 0 for local update
                if(userCommentCount.value[sprintFieldName] <= 0) {
                    delete userCommentCount.value?.[sprintFieldName];
                }
                if(userCommentCount.value[taskFieldName] <= 0) {
                    delete userCommentCount.value?.[taskFieldName];
                }
                if(parentTaskField && userCommentCount.value?.[parentTaskField] <= 0) {
                    delete userCommentCount.value?.[parentTaskField];
                }
                commit("users/mutateCounts", {data: {...userCommentCount.value} || {}});
            }
        })
        .catch((error) => {
            console.error(error,"ERROR");
        })
    } else {
        let userArr = Array.from(new Set([...(props?.watchers || []), ...otherUsers]));

        userArr = filterUsers(userArr);
        userArr = [...new Set(userArr)].filter(x => x && x !== userId.value);

        if(!taskId.length) {
            let axiosData = {
                companyId : companyId.value,
                key : 1,
                projectId: projectData.value._id,
                userIds: userArr
            }
            apiRequest("post", env.UPDATE_UNREADREAD_COMMENTS_COUNT, axiosData).catch((error) => {
                console.error(error,"ERROR");
            })
        } else {
            let axiosData = {
                companyId : companyId.value,
                key : 2,
                projectId: projectData.value._id,
                userIds: userArr,
                taskId: taskId,
                sprintId: props.sprintId,
                prevCount: prevCount 
            }

            if(props.parentTaskId) {
                axiosData.parentTaskId = props.parentTaskId;
            }

            apiRequest("post", env.UPDATE_UNREADREAD_COMMENTS_COUNT, axiosData).catch((error) => {
                console.error(error,"ERROR");
            })
        }
    }
}

function performMessageQueue() {
    if(!messageQueue.value.length) return Promise.reject(new Error("No message queue"));
    let count = 0;
    const tmp = messageQueue.value;
    let result = [];

    const next = () => {
        count++;
        loop(tmp[count]);
    }

    const loop = (message) => {
        if(count >= tmp.length) {
            if(props.newChat) {
                router.push({name: `chat_project_channel`, params: {...route.params, sid: newMainChat.value}})
            }
            return Promise.resolve(result);
        }

        try {
            if(!message.type?.length) {
                sendMessageFun(message)
                .then(() => {
                    result.push({status: true, data: message, type: "text/link"})
                    next();
                })
                .catch((error) => {
                    result.push({status: false, data: message, error})
                    next();
                })
            } else {
                mediaFiles.value = [message]
                sendMedia()
                .then(() => {
                    result.push({status: true, data: message, type: "media"})
                    next();
                })
                .catch((error) => {
                    result.push({status: false, data: message, error})
                    next();
                })
            }
        } catch (error) {
            result.push({status: false, data: message, error})
            next();
        }
    }
    loop(tmp[count]);
}

function createTaskForMainChat() {
    return new Promise((resolve, reject) => {
        try {
            if(createInProgress.value) return;
            createInProgress.value = true;

            formData.value.taskName.value = "Chat";
            formData.value.selectedSprint.value = Object.values(projectData.value?.sprintsObj)?.[0];
            formData.value.selectedType.value = projectData.value?.taskTypeCounts?.[0];
            if(formData.value.selectedSprint.value.AssigneeUserId) delete formData.value.selectedSprint.value.AssigneeUserId;
            if(formData.value.selectedSprint.value.favorites) delete formData.value.selectedSprint.value.favorites;

            saveTask()
            .then((docId) => {
                newMainChat.value = docId;
                commentPath.value = `${companyId.value}/${companyId.value}/${dbCollections.MAIN_CHATS}/${projectData.value?._id}/${props.sprintId}/${docId}/${dbCollections.COMMENTS}`;
                documentPath.value = `${companyId.value}/${companyId.value}/${props.mainChat ? dbCollections.MAIN_CHATS : dbCollections.PROJECTS}/${projectData.value._id}/${props.sprintId}/${docId}`
                mediaPath.value = `${companyId.value}/${props.mainChat ? dbCollections.MAIN_CHATS : dbCollections.PROJECTS}/${projectData.value._id}/${props.sprintId}/${docId}/comments/`

                if(props.mainChat && projectData.value?.default) {
                    nextTick(() => {
                        router.push({...route, params: {...route.params, sid: docId}})
                    })
                    getMessages(newMainChat.value);
                }
                resolve(docId);
                createInProgress.value = false;

                if(messageQueue.value.length) {
                    performMessageQueue();
                }
            })
            .catch((error) => {
                console.error("ERROR: ", error);
                reject(error);
                createInProgress.value = false;
            });
        } catch (error) {
            reject(error);
            createInProgress.value = false;
        }
    })
}

function filterUsers(users = null) {
    if(!users) return [];

    let projectWatchersFilter = [];

    Object.keys(projectData.value?.watchers || {}).forEach((key) => {
        if(projectData.value?.watchers?.[key] === "all_activity") {
            projectWatchersFilter.push(key)
        }
    })

    users.forEach((uid) => {
        const ignore = projectData.value?.watchers?.[uid] === "ignore";
        if(!ignore) {
            projectWatchersFilter.push(uid);
        }
    })

    return projectWatchersFilter;
}

function sendNotification(messageData, otherUsers = []) {
    let receivers = Array.from(new Set([...otherUsers]));

    receivers = receivers?.filter((x) => x !== userId.value) || [];

    // UPDATE COUNTS OF MENTIONS
    let mentionCounts = {
        companyId : companyId.value,
        key : 4,
        userIds: receivers,
        readAll: false
    }
    apiRequest("post", env.UPDATE_UNREADREAD_COMMENTS_COUNT, mentionCounts).catch((error) => {
        console.error(error,"ERROR");
    })

    const user = getUser(userId.value);
    // const user = getUser(props.creator?.uid);
    const currentUser = {
        id: user._id,
        Employee_Name: user.Employee_Name,
        companyOwnerId: user.companyOwnerId,
    }
    const finalNotification = {
        key: props?.mainChat ? otherUsers?.length ?  "comments_I'm_@mentioned_in" : "message_create" : "comments_I'm_@mentioned_in",
        message: messageData.message
    }
    if(props.commentType === 'project'){
        apiRequest("post", env.HANDLE_NOTIFICATION, {
            type: 'project',
            companyId: companyId.value,
            projectId: projectData.value._id,
            object: finalNotification,
            userData: currentUser,
            mentionUserId:messageData?.mentionIds || [],
            comments_id: messageData._id
        })
        .catch((error) => {
            console.error("ERROR in update notification", error);
        })
    } else if(props?.mainChat && !otherUsers?.length) {
        if(props?.watchers && props?.watchers?.length && messageData?.userId){
            const userIds = props.watchers;
            const index = userIds.indexOf(messageData.userId);
            if (index > -1) {
                userIds.splice(index, 1);
            }
    
            if(userIds && userIds.length){
                apiRequest("post", env.SEND_FCM, {
                    message: messageData.message,
                    companyId: companyId.value,
                    userIdArray:userIds,
                    key: 'message_create',
                    type:'chat',
                    senderUserDetail:currentUser,
                    actionUrl:`${companyId.value}/chat/${messageData.objId.projectId}/${messageData?.objId?.taskId ? messageData.objId.taskId : messageData.objId.sprintId}`
                })
                .catch((error) => {
                    console.error("ERROR in send notification: ", error);
                })
            }
        }
    } else {
        apiRequest("post", env.HANDLE_NOTIFICATION, {
            type: props?.mainChat ? "chat" : "tasks",
            companyId: companyId.value || '',
            projectId: projectData?.value?._id || '',
            taskId: props?.taskId || '',
            folderId: props?.folderId ? props.folderId : '',
            sprintId: props?.sprintId || '',
            userData: currentUser,
            object: finalNotification,
            comments_id: messageData?._id,
            isGroupChat:props?.selectedChat?.TaskName ? false : true
        })
        .catch((error) => {
            console.error("ERROR in send notification: ", error);
        })
    }
}

function updateLastMessageTime(msgObj = {}) {
    const obj = JSON.parse(JSON.stringify(msgObj))
    if (!props.mainChat || !projectData.value.default) return;

    taskClass.updateLastMessageTime({ taskId: obj?.taskId ? obj.taskId : obj?.objId?.taskId, companyId: companyId.value, msgObj: msgObj }).catch((error) => {
        console.error("Error in updateLastMessageTime hook in Comments.vue: ", error.message);
    });
}

async function sendMessageFun(messageData,isReset = true) {
    if (!messageAllowed.value) {
        return;
    }
    if(isReset){
        resetMessage();
    }
    if(!messageData?.message?.trim()?.length && (!messageData.mediaURL || !messageData.mediaURL.length)) {
        return;
    }

    if(createInProgress.value) {
        messageQueue.value.push(messageData);
        return;
    }
    if(props.newChat && !newMainChat.value) {
        messageQueue.value.push(messageData);
        await createTaskForMainChat()
        .then(() => {
            return true;
        })
        .catch((error) => {
            console.error("ERROR: ", error);
            return false;
        })

        // if(!success) {
        return;
        // }
    }

    return new Promise((resolve, reject) => {
        try {
            messageData.message = messageData.message.trim();

            let link = null;
            if(messageData.message.length) {
                link = checkLink(messageData.message);

                if(link !== null) {
                    messageData.type = "link";
                }
            }

            let edited = messageData._id !== undefined && messageData.createdAt !== undefined;

            messageData.userId= userId.value;

            bakeMessage({messageData, edited})
            .then((messageObj) => {
                if(messageObj.type === "text" || messageObj.type === "link") {
                    let {mentions, msg} = checkMentions(messageObj.message);

                    if(mentions.length) {
                        if(mentions.includes("everyone")) {
                            messageObj.mentionIds = users.value
                                ?.filter((user) => !user.ghostUser && user.id !== messageData.userId)
                                .map((x) => x.id); 
                        } else {
                            messageObj.mentionIds = mentions;
                        }
                        messageObj.message = msg;
                    }
                }

                messageObj.objId = {
                    projectId:projectData.value._id
                };
                messageObj.project = true;
                if(newMainChat.value) {
                    messageObj.objId = {
                        ...messageObj.objId,
                        taskId:newMainChat.value,
                        sprintId:props.sprintId,
                    }
                    messageObj.project = false;
                } else if(props.taskId.length) {
                    messageObj.objId = {
                        ...messageObj.objId,
                        sprintId:props.sprintId
                    }
                    if(props.taskId === "default"){
                        messageObj.taskId=props.taskId
                    }else{
                        messageObj.objId = {
                            ...messageObj.objId,
                            taskId:props.taskId
                        }
                    }
                    if(props.folderId){
                        messageObj.objId = {
                            ...messageObj.objId,
                            folderId:props.folderId
                        }
                    }
                    messageObj.project = false;
                }

                // messageObj.type = "text";
                messageObj.message = messageObj.message
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&#039;');
                sendMessage({messageData: messageObj, edited, path: commentPath.value,timeZone: getUser(messageData.userId).timeZone ? getUser(messageData.userId).timeZone : "Asia/Kolkata" })
                .then((msg) => {
                    resolve("Message Sent", msg);

                    if(props.forSupport) {
                        if(companyUser?.value?.userEmail !== process.env.VUE_APP_USEREMAIL) {
                            let subject = "Support from AlianHub"
                            const mailMessage = changeText(msg.message  || '', '', '');
                            sendMailFromMessage(customerDetails.value.userEmail, subject, mailMessage);
                        } else {
                            let subject = `Support to ${customerDetails.value?.userName || ""}`
                            const mailMessage = `Email: ${customerDetails.value?.userEmail}\nProduct: ${props.productData?.productName}\n\nMessage:\n${changeText(msg.message  || '', '', '')}`;
                            sendMailFromMessage(process.env.VUE_APP_SUPPORT_MAIL, subject, mailMessage);
                        }
                    }

                    // INITIALIZE SNAPHOT => IF NOT INITIALIZED
                    if(!snapshotListener.value) {
                        getMessages();
                    }

                    // SET COUNT TO ZERO
                    resetUnread.value = true;
                    updateCount(true, 0);

                    if (edited) {
                        getLatestMessage(projectData.value._id, props.taskId, props.sprintId, messageData)
                        .then(({ latestMessage, isLastCreatedMessage }) => {
                            if (latestMessage && isLastCreatedMessage) {
                                debounce(updateLastMessageTime({ ...messageObj }), 500)
                            }
                        })
                        .catch((error) => {
                            console.error("Error fetching the latest message:", error);
                        });
                    } else {
                        debounce(updateLastMessageTime({ ...messageObj }), 500)
                    }

                    if(!edited) {
                        updateCount(false, 1, (msg?.mentionIds || []));
                    }

                    if(!edited && msg.mentionIds.length) {
                        let mentionsRefObj = {
                            mentionIds: msg.mentionIds,
                            type: !props.taskId.length ? "project" : "task",
                            projectId: projectData.value._id,
                            userId: userId.value,
                            notSeen: msg.mentionIds,
                            taskId: props.taskId,
                            sprintId: props.sprintId,
                            folderId: props.folderId ? props.folderId : "",
                            mainChat: props?.mainChat ? true : false
                        }

                        let keys = ["id", "type", "mediaSize", "mediaURL", "mediaName", "mediaOriginalName", "message", 'reply_id', 'reply_mediaName', 'reply_mediaOriginalName', 'reply_mediaURL', 'reply_mediaSize', 'reply_message', 'reply_type', 'reply_userId'];
                        Object.keys(msg).forEach((key) => {
                            if(keys.includes(key)) {
                                mentionsRefObj[`comment_${key}`] = msg[key];
                            }
                        })

                        const params = {
                            data: {
                                ...mentionsRefObj, 
                                createdAt: new Date(),
                                updatedAt: new Date()
                            }
                        }
                        apiRequest("post", `${env.APP_NOTIFICATION}/comment`, params).catch((error) => {
                            console.error(`Error in while send message comment on sendMessageFun hook => ${error}`);
                        })
                    }

                    if(!edited) {
                        if(props.mainChat) {
                            sendNotification(msg, msg.mentionIds || []);
                        } else if(msg.mentionIds.length) {
                            sendNotification(msg, msg.mentionIds);
                        }
                    }

                    scrollBottom();
                })
                .catch((error) => {
                    console.error("ERROR in send message: ", error);
                    reject(error);
                })
            })
            .catch((error) => {
                console.error("ERROR in bake message: ", error);
                reject(error);
            })
        } catch (error) {
            console.error("ERROR in send message: ", error);
            reject(error);
        }
    })
}
function getSprintData(id) {
    return new Promise((resolve, reject) => {
        try {
            if(Object.keys(getters["mainChat/mainChatSprints"]).includes(id)){
                if(!sprintData.value || !Object.keys(sprintData.value || {}).length){
                    sprintData.value = getters["mainChat/mainChatSprints"][id];
                }
                resolve(sprintData.value,true);
                return;
            }

            let projectId = id;
            dispatch("mainChat/setChatSprints",{projectId}).then((sprintss) => {
                sprintData.value = sprintss;
                resolve(sprintss);
            }).catch((error) => {
                console.error("Error in dispatching setChatSprints:", error);
                reject(error);
            })
        } catch (error) {
            reject(error);
        }
    })
}

function getFolderData(id) {
    return new Promise((resolve, reject) => {
        try {
            if(Object.keys(getters["mainChat/mainChatFolders"]).includes(id) || projectData.value.default){
                if(!folderData.value || folderData.value.length === 0 || !Object.keys(folderData.value || {}).length){
                    folderData.value = getters["mainChat/mainChatFolders"][id];
                }
                resolve(folderData.value,true);
                return;
            }
            let projectId = id;
            dispatch("mainChat/setChatFolders",{projectId}).then((folders) => {
                resolve(folders);
                folderData.value = folders;
            })
        } catch (error) {
            reject(error);
        }
    })
}

const getSprintFolderData = async (id) => {
    try {
        Promise.allSettled([getSprintData(id), getFolderData(id)])
        .then((results) => {
            const resolvedPromises = results.filter((result) => result.status === 'fulfilled');
            if (resolvedPromises.length === 2) {
                const [sprintsResult, foldersResult] = resolvedPromises.map((result) => result.value);
                const sprintsArray = sprintsResult?.filter(sprint => sprint.projectId === id && !sprint.folderId).map((x) => ({ ...x, id:x._id }));

                const foldersObject = foldersResult?.reduce((acc, folder) => {
                    if (folder.projectId === id) {
                        let folId = folder._id
                        acc[folId] = {
                            folderId: folId,
                            name: folder.name,
                            sprintsObj: {},
                            deletedStatusKey: folder.deletedStatusKey,
                            legacyId : folder?.legacyId ? folder?.legacyId : '',
                            id: folder._id,
                            _id: folder._id,
                        };
                    }
                    return acc;
                }, {});

                sprintsResult?.forEach(sprint => {
                    if (sprint.projectId === id && sprint.folderId && foldersObject[sprint.folderId]) {
                        sprint.folderName = foldersObject[sprint.folderId].name;
                        sprint.id = sprint?._id;
                        foldersObject[sprint.folderId].sprintsObj[sprint.id] = sprint;
                    }
                });
                sprintFolders.value = {
                    [id]: {
                        folders: foldersObject,
                        sprints: sprintsArray,
                    }
                };

                let project = projectData.value;
                let allSprints = sprintFolders.value !== undefined && sprintFolders.value && sprintFolders.value[projectData.value._id] ? sprintFolders.value[projectData.value._id]?.sprints : []
                allSprints = [...allSprints];

                let allFolders = sprintFolders.value && sprintFolders.value[projectData.value._id] ? sprintFolders.value[projectData.value._id]?.folders : {}

                const sprintIdToObject = {};
                allSprints.forEach(item => {sprintIdToObject[item.id] = item;});

                project.sprintsObj = sprintIdToObject;
                project.sprintsfolders = allFolders;

                projectData.value.sprintsObj = project.sprintsObj;
                projectData.value.sprintsfolders = project.sprintsfolders;
            } else {
                console.error("One or more promises were rejected");
            }
        })
        .catch((error) => {
            console.error("Error in Promise.allSettled", error);
        });
    } catch (error) {
        console.error("ERROR", error);
    }
}
/* --------------- SEND MESSAGES END --------------- */

/* --------------- PREVIEWER --------------- */

async function fetchAttachmentUrls(attachments) {
    const updatedAttachments = await Promise.all(
        attachments.map(async (attachment) => {
            const baseName = attachment.mediaOriginalName.replace(/\.[^/.]+$/, "");
            const extension = attachment.mediaName.split('.').pop();

            if (attachment.downloadURL) {
                return {
                    title: attachment.mediaOriginalName,
                    name: attachment.mediaOriginalName,
                    alt: `${baseName} file`,
                    type: attachment.type,
                    ext: extension,
                    url: attachment.downloadURL,
                    path: attachment.mediaURL,
                };
            }

            let properUrl = attachment.mediaURL; 

            try {
                const newUrl = await handleStorageImageRequest({
                    companyId: companyId.value,
                    data: { url: attachment.mediaURL },
                    isCache: true,
                });

                if (newUrl) {
                    properUrl = newUrl;
                } else {
                    console.error('getStorageImage returned an invalid response:', newUrl);
                }
            } catch (error) {
                console.error(`Error fetching URL for ${attachment.mediaOriginalName}:`, error);
            }

            return {
                title: attachment.mediaOriginalName,
                name: attachment.mediaOriginalName,
                alt: `${baseName} file`,
                type: attachment.type,
                ext: extension,
                url: properUrl,
                path: attachment.mediaURL,
            };
        })
    );

    transformedAttachments.value = updatedAttachments;
}

function handleDownloadUrl(url) {
    messages.value = messages.value.map((message) => {
        if (message._id === url.id) {
            return { ...message, downloadURL: url.url };
        }
        return message; 
    });
}
const handlePreviewImage = async (event) => {
    const attachments = Array.isArray(event) ? event : [event];
    await fetchAttachmentUrls(attachments); 
    showPreviewer.value = true; 
};

const closePreviewer = () => {
    showPreviewer.value = false;
};
</script>

<style>
@import './style.css';

.commments__component-wrapper{
    height: 100%;
}
</style>
