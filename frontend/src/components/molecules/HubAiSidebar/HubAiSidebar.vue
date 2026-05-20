<template>
    <div>
        <Sidebar width="923px" className="hub-ai-sidebar" :uniqueId="content.uID">
            <template #head-left>
                <span class="blue font-weight-700 font-size-18">{{selectedPrompt.title}}</span>
            </template>
            <template #head-right>
                <div @click="closeButton(true)" class="close-image d-flex align-items-center justify-content-center"><img src="@/assets/images/svg/delete.svg" /></div>
            </template>
            <template #body>
                <div class="p-20px">
                    <div class="d-flex align-items-center pb-13px">
                        <div class="hubai_image_div">
                            <img src="@/assets/images/svg/ai_image_white.svg" class="ai_image"/>
                        </div>
                        <span class="ai-color font-size-16 font-weight-700 pl-15px">{{$t('AI.hub_ai')}}</span>
                    </div>
                    <div>
                        <template v-if="Object.keys(hubResponse).length > 0">
                            <span class="black font-weight-bold" v-if="hubResponse?.title">{{$t('AI.title')}}: </span>
                            <p>{{hubResponse?.title}}</p>
                            <span v-if="hubResponse.description" class="black font-weight-bold">{{$t('ProjectDetails.description')}}: </span> 
                            <div class="p15x-0px" id="description-single" v-if="hubResponse.description" v-html="sanitizeHtml(hubResponse.description)"></div>
                            <span class="error_class" v-if="hubResponse.error">{{hubResponse.error}}</span>
                            <template v-if="!isSendMessage && !isErrorGenerateSingle">
                                <button v-for="(buttons,ind) in content.displayButton" :class="[{'pointer-event-none': isButtonClicked}]" :key="ind" class="btn-primary mr-10-px font-size-16 font-weight-400" @click="handleButtonClick(buttons,hubResponse)"> {{buttons.name}}</button>
                                <button class="outline-primary font-size-16 font-weight-400 mr-10-px" @click="copyText(hubResponse,'single')">{{$t('AI.copy')}}</button>
                            </template>
                            <button v-if="!isSendMessage && (chatContent.length === 0 || isErrorGenerateSingle === true)" class="outline-primary font-size-16 font-weight-400" @click="$emit('regenerate')">{{$t('AI.regenerate')}}</button>
                            <div v-if="isSendMessage && chatContent.length === 0" class="blinking-div"></div>
                        </template>
                        <template v-else>
                            {{$t('AI.generating_results')}}....
                            <div v-if="isSendMessage && chatContent.length === 0" class="blinking-div"></div>
                        </template>
                        <template v-if="chatContent.length > 0">
                            <div v-for="(item, index) in chatContent" :key="index" class="chat-content">
                                <div v-if="item.role === 'user'">
                                    <div class="d-flex align-items-center pb-13px">
                                        <UserProfile
                                            :showDot="false"
                                            class="cursor-pointer mr-10px"
                                            width="30px"
                                            :data="{
                                                id: getUser(userId)._id,
                                                title: getUser(userId).Employee_Name,
                                                image: getUser(userId).Employee_profileImageURL || ''
                                            }"
                                            :thumbnail="'30x30'"
                                        />
                                        <h3>You</h3>
                                    </div>
                                    <span>{{item.content}}</span>
                                </div>
                                <div v-if="item.role === 'system'">
                                    <div class="d-flex align-items-center pb-13px">
                                        <div class="hubai_image_div">
                                            <img src="@/assets/images/svg/ai_image_white.svg" class="ai_image"/>
                                        </div>
                                        <span class="ai-color font-size-16 font-weight-700 pl-15px">{{$t('AI.hub_ai')}}</span>
                                    </div>
                                    <span v-if="item.content?.title" class="black font-weight-bold">{{$t('AI.title')}}: </span>
                                    <p v-if="item.content?.title">{{item.content?.title}}</p>
                                    <span v-if="item.content?.description" class="black font-weight-bold">{{$t('ProjectDetails.Description')}}: </span> 
                                    <div v-if="item.content?.description" class="p15x-0px" id="description-multi" v-html="sanitizeHtml(renderHtmlFun(item.content.description))"></div>
                                    <span class="error_class" v-if="item.error">{{item.error}}</span>
                                    <template v-if="!isSendMessage && !isErrorGenerate">
                                        <button v-for="(buttons,ind) in content.displayButton" :key="ind" :class="[{'pointer-event-none': isButtonClicked}]" class="btn-primary mr-10-px font-size-16 font-weight-400" @click="handleButtonClick(buttons,item?.content)"> {{buttons.name}}</button>
                                        <button class="outline-primary font-size-16 font-weight-400 mr-10-px" @click="copyText(item?.content,'multi')">{{$t('AI.copy')}}</button>
                                    </template>
                                    <button v-if="!isSendMessage && (index == chatContent.length - 1 || isErrorGenerate === true)" class="outline-primary font-size-16 font-weight-400" @click="regenerate()">{{$t('AI.regenerate')}}</button>
                                </div>
                            </div>
                            <!-- <div v-if="isSendMessage" class="blinking-div"></div> -->
                        </template>
                    </div>
                </div>
                <div class="chatsend_wrapper">
                    <div class="d-flex align-items-center justify-content-between send_button_area w-100">
                        <textarea
                            type="text"
                            class="write-message"
                            id="message-box"
                            ref="messageBox"
                            :placeholder="$t('AI.ai_chat_placeholder')"
                            v-model="sendMessageText"
                            @keypress="handleEnter"
                        ></textarea>
                        <button class="btn-primary send__media-btn-ai border-radius-7-px"><img :src="sendIcon" alt="sendIcon" class="cursor-pointer" @click="sendMessageToAi()"></button>
                    </div>
                </div>
            </template>
        </Sidebar>
        <ConvertToSubTaskSidebar v-if="createTask" :isDisableButton="isSpinner" :closeSideBar="createTask"  @isConvertSubtaskOPen="createTask = false" :isCreteTask="createTask" @createTask="createTaskWithAi" :content="taskTitle" />
    </div>
</template>

<script setup>
import { ref, inject, computed, watch, onMounted, nextTick} from 'vue';
import { useStore } from "vuex";
import Sidebar from "@/components/molecules/Sidebar/Sidebar.vue";
import ConvertToSubTaskSidebar from '@/components/molecules/ConvertToSubTaskSidebar/ConvertToSubTaskSidebar.vue';
import UserProfile from '@/components/atom/UserProfile/UserProfile.vue';
import { useToast } from "vue-toast-notification";
import taskClass from "@/utils/TaskOperations"
import { useGetterFunctions } from "@/composable";
import { apiRequest } from '../../../services';
import { useAiApiFunction } from "@/composable/aiHelper";
import { useCustomComposable } from "@/composable";
import markdownit from 'markdown-it'
import * as env from '@/config/env'
import { sanitizeHtml } from '@/utils/sanitizeHtml';
import { taskPlanPermission } from "@/composable/commonFunction";
import { useI18n } from "vue-i18n";
const { t } = useI18n();

const mardownInit = markdownit({
    html: true
})

const props = defineProps({
    selectedPrompt: {
        type: Object,
        default: () => {}
    },
    content: {
        type: Object,
        default: () => {}
    },
    project: {
        type: Object,
        default: () => {}
    },
    task: {
        type: Object,
        default: () => {}
    },
    isSendMsg: {
        type: Boolean,
        default: false
    },
    isError: {
        type: Boolean,
        default: false
    }
})
const {getters,commit} = useStore();
const createTask = ref(false);
const isSpinner = ref(false);
const companyId = inject("$companyId");
const userId = inject("$userId");
const $toast = useToast();
const {getUser} = useGetterFunctions();
const {generateAiRequestForFunction} = useAiApiFunction();
const { checkTaskPerSprintPermisssion } = taskPlanPermission();

const companyOwner = computed(() => {
    return getters["settings/companyOwnerDetail"];
})

const {checkGenerateResponseLimit, checkPermission,debouncerWithPromise,makeUniqueId} = useCustomComposable();

const emit = defineEmits(["closeMainSidebar","closeHubAi","regenerate"]);
const sendIcon = require("@/assets/images/footerbtnsend.svg");
const sendMessageText = ref('');
const chatContent = ref([]);
const element = ref('');
const isSendMessage = ref(false);
const taskTitle = ref('');
const taskDescription = ref({});
const isErrorGenerate = ref(false);
const isErrorGenerateSingle = ref(false);
const fullText = ref('');
const isButtonClicked = ref('');
const injectDescription = inject('injectDescription')

const hubResponse = computed(() => props.content);
const aiRequestLimit = computed(() => checkPermission("artificial_intelligence.per_user_generate_limit", props.project?.isGlobalPermission, {gettersVal: getters}));

watch(() => props.isSendMsg, (newVal) => {
    isSendMessage.value = newVal;
},{immediate: true})

watch(() => chatContent.value, (newVal) => {
    chatContent.value = newVal;
})

watch(() => props.isError, (newVal) => {
    isErrorGenerateSingle.value = newVal;
})

onMounted(() => {
    nextTick(() =>{
        element.value = document.getElementById(props.content.uID);
    })
})

function createTaskWithAi (event) {
    checkTaskPerSprintPermisssion(event.sprints._id).then((resp) => {
        if(resp){
            isSpinner.value = true;
            let sprintObj = {
                id: event.sprints._id,
                name: event.sprints.name,
            }
            if(event.sprints.folderId){
                sprintObj.folderId = event.sprints.folderId;
                sprintObj.folderName = event.sprints.folderName;
            }
            let obj = {
                'TaskName': event.taskName,
                'TaskKey': '-',
                'AssigneeUserId': [],
                'watchers': [],
                'DueDate': '',
                'dueDateDeadLine': [],
                'TaskType': 'task',
                'TaskTypeKey': 1,
                'ParentTaskId': '',
                'ProjectID': event.project._id,
                'CompanyId': companyId.value,
                'status': {
                    "text": 'To Do',
                    "key": 1,
                    'type': 'default_active'
                },
                'isParentTask': true,
                'Task_Leader': userId.value,
                'sprintArray': sprintObj,
                'Task_Priority': 'MEDIUM',
                'deletedStatusKey': 0,
                'sprintId': event.sprints._id,
                'statusType': 'default_active',
                'statusKey': 1,
                'description': taskDescription.value.description,
                'rawDescription' : taskDescription.value.md
            }
            if(event.sprints.folderId){
                obj.folderObjId = event.sprints.folderId;
            }
        
            const projectData = {
                _id: event.project._id,
                CompanyId: companyId.value,
                lastTaskId: event.project.lastTaskId,
                ProjectName: event.project.ProjectName,
                ProjectCode: event.project.ProjectCode
            }
        
            const user = getUser(userId.value)
            const userData = {
                id: user.id,
                Employee_Name: user.Employee_Name,
                companyOwnerId: companyOwner.value.userId,
            }
            let indexObj;
            indexObj = {
                indexName : "groupByStatusIndex",
                searchKey : "statusKey",
                searchValue : "1"
            }
            taskClass.create({data: obj, user: userData, projectData, indexObj, groupBy: 1})
            .then((res) => {
                if(res.status){
                    $toast.success(t(`Toast.task_created_successfully`), {position: "top-right"});
                }else if(res.isUpgrade){
                    $toast.error(t('Toast.create_task_limit_in_sprint_upgrade_task_message').replace('SELECTED_SPRINT_DATA', event.sprints.name), {position: "top-right"});
                }else{
                    $toast.error(t(`Toast.something_went_wrong`), {position: "top-right"});
                }
                createTask.value = false
                isSpinner.value = false;
                isButtonClicked.value = false;
                closeButton();
            })
            .catch((error) => {
                isButtonClicked.value = false;
                isSpinner.value = false;
                console.error("ERROR in create task: ", error);
            })
        }else{
            $toast.error(t('Toast.create_task_limit_in_sprint_upgrade_task_message').replace('SELECTED_SPRINT_DATA', event.sprints.name), {position: "top-right"});
        }
    })
}

function copyText (text) {
    let cText = text?.title ? `### Title:\n${text?.title}` : '' ;
    let finalText = `${cText}\n\n### Description:\n${text.md}`;
    finalText = finalText.replaceAll(/\\n/g, '\n');
    navigator.clipboard.writeText(finalText);

    $toast.success(t("Toast.Copied"), {position: "top-right"});
}


function handleEnter(e) {
    if(e.keyCode === 13 && !e.shiftKey) {
        e.preventDefault();
        sendMessageToAi();
    }
}

function sendMessageToAi (isRegenerate = false) {
    debouncerWithPromise(1000).then(() => {
        if(checkGenerateResponseLimit(aiRequestLimit.value,userId.value) == true){
            isErrorGenerate.value = false;
            fullText.value = '';
            if(sendMessageText.value === '' && isRegenerate === false){
                return;
            }
            if(!isRegenerate){
                chatContent.value.push({ role: "user", content: sendMessageText.value });
            }
            let data = {
                userId: userId.value,
                message: `${sendMessageText.value} Give the response back in the preapare it in provided JSON format : ${props.content.outputFormat}`,
                isRegenerate: isRegenerate,
                uniqueUserId: props.content.uID,
                companyId: companyId.value
            }
            if(props.content.title === 'Write a Description'){
                data.message = `${data.message}  MAX CHARACTER LIMIT IS 5000 ONLY.`
            }
            sendMessageText.value = '';
            isSendMessage.value = true;
            let index = chatContent.value.length;
            const evId = `ev_${makeUniqueId(12)}`;
            const source = new EventSource(`${env.API_URI}/api/v1/generatePrompt/events/${evId}`);
            source.onmessage = function(event) {
                const data = JSON.parse(event.data)?.data;
                if(data.step !== "COUNT"){
                    receiveTextPart(data.value ? data.value : '',index);
                    scrollBottom();
                }
                else{
                    let userUpdate = data?.value;
                    if(userUpdate?.status === true){
                        commit("settings/mutateCompanyUsers",{data : userUpdate.data , op: 'modified'});
                    }
                }
                if(data.step === 100){
                    source.close();
                    isSendMessage.value = false;
                }
            }
            source.onerror = function(error) {
                source.close();
                isSendMessage.value = false;
                isErrorGenerate.value = true;
                console.error(error,"error");
                chatContent.value.push({ role: "system", error: 'An error occurred. Either the engine you requested does not exist or there was another issue processing your request' });
            }
            data.eventId = evId;
            generateAiRequestForFunction(data,'','','',false,'multi',props.project?.isGlobalPermission).then((result) => {
                if(result.status === false){
                    if(result.isReachedLimit){
                        $toast.error(t("Toast.Ai_limit_reached"),{position: 'top-right'});
                        return;
                    }else if(result.isNotAi){
                        $toast.error(result.statusText,{position: 'top-right'});
                        return;
                    }
                    isSendMessage.value = false;
                    isErrorGenerate.value = true;
                    chatContent.value.push({ role: "system", error: 'An error occurred. Either the engine you requested does not exist or there was another issue processing your request' });
                }
            }).catch((error) => {
                isSendMessage.value = false;
                console.error(error,"ERROR IN GENERAE PROMPTS:");
            })
        }else{
            $toast.error(t("Toast.Ai_limit_reached"),{position: 'top-right'});
            return;
        }
    })
}

function closeButton(buttonEvent = false) {
    emit('closeMainSidebar', buttonEvent);
    chatContent.value = [];
    let data = {
        userId: props.content.uID
    }
    apiRequest("post", env.DELETE_USER_CHAT, data).catch((err) => {
        console.error(err,"ERROR:")
    })
}

function scrollBottom(){
    element.value = document.getElementById(props.content.uID);
    if(element.value) {
        setTimeout(() => {
            element.value.scrollTo({top: element.value.scrollHeight, left: 0, behavior: "smooth"});
        }, 300)
    }
}

function handleButtonClick (funObj,valuObj) {
    isButtonClicked.value = true;
    taskTitle.value = valuObj?.title ? valuObj.title : '';
    taskDescription.value = valuObj;
    switch (funObj.name) {
        case 'Create':
            createTask.value = true;
            break;
        case 'Insert':
            injectDescription(valuObj.md);
            closeButton();
            isButtonClicked.value = false;
            break;
        default:
            break;
    }
}

function regenerate () {
    sendMessageToAi(true);
}

// function checkResponse(response,preFormat) {
//     if(typeof response === "object"){
//         let format = preFormat.replace('{', '').replace('}', '').split(',');
//         return Object.keys(response).every(value => format.includes(value));
//     }
// }

function receiveTextPart(textPart,index) {
    fullText.value += textPart;
    parseJsonAiText(index);
}
function parseJsonAiText(index) {
    const titleMatch = /"title"\s*:\s*"([^"]*)"/.exec(fullText.value);
    const descriptionMatch = /"description"\s*:\s*"([^]*)/.exec(fullText.value);

    chatContent.value[index] = { role: "system", content:{}};
    if (titleMatch) {
        let title = titleMatch[1];
        chatContent.value[index].content.title = title;
    }
    if (descriptionMatch) {
        const partialDescription = descriptionMatch[1].replace(/"\s*}/, '');
        let description = partialDescription.replaceAll(/\\n/g, '\n').replaceAll(/\\"/g, '"');
        chatContent.value[index].content.description = mardownInit.render(description);
        chatContent.value[index].content.md = description;
    }
}

function renderHtmlFun (data) {
    if(data){
        return mardownInit.render(data);
    }else{
        return '';
    }
}
</script>
<style>
.hubai_image_div{
    background: linear-gradient(270deg, #F241CD 0%, #4B5DEE 100%);
    width: 30px;
    height: 30px;
    border-radius: 15px;
}
.ai_image{
    top: 8px;
    left: 8px;
    position: relative;
}
.send__media-btn-ai{
  height: 54px !important; 
  width: 54px;
  margin-left: -6px;
}
.send_button_area{
    padding: 10px 10px 10px 10px;
}
.chat-content{
    padding: 20px 0px 20px;
}
.chatsend_wrapper{
    background-color: #FFFFFF;
    position: fixed;
    display: flex;
    height: max-content;
    bottom: 1px;
    width: 923px;
}
.hub-ai-sidebar  .sidebar-body{
    height: calc(100% - 121px)!important;
}
.blinder_wrapper_initial p:last-child:after, .blinder_wrapper .chat-content:last-child p:last-child:after {
    content: '';
    display: inline-block;
    width: 15px;
    height: 15px;
    background-color: #2F3990;
    border-radius: 50%;
    animation: blink-animation 1s infinite;
}

.blinking-div {
    width: 15px;
    height: 15px;
    background-color: #2F3990;
    border-radius: 50%;
    animation: blink-animation 1s infinite;
}
.hub-ai-sidebar pre {
    background-color: rgb(13 13 13);
    color: white;
    font-size: 14px;
    overflow: auto;
    padding: 5px;
}
.hub-ai-sidebar p {
    font-size: 18px;
}

.hub-ai-sidebar p {
    line-height: 28px;
}
.hub-ai-sidebar .close-image {
    text-align: center;
    width: 30px;
    height: 30px;
    background: #DFE1E6;
    border-radius: 5px;
}
.error_class{
    display: block;
    color: #f93a37;
    background: #6d504f0d;
    border: 1px solid transparent;
    height: 70px;
    width: 600px;
    padding: 9px;
    line-height: 22px;
    border-radius: 10px;
    margin-bottom: 20px;
}

@keyframes blink-animation {
    0% {
      opacity: 1;
    }
    50% {
      opacity: 0;
    }
    100% {
      opacity: 1;
    }
}

@media (max-width:923px) {
    .chatsend_wrapper {
        width: 100%;
    }
}

</style>