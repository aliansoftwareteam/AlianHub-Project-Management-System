<template>
    <div>
        <Sidebar width="923px" @update:visible="(val)=> $emit('closePrompt')" :title="selectedPrompt.title">
            <template #body>
                <div class="prompt-body-sidebar">
                    <form class="prompt_form">
                        <div v-for="(item, index) in selectedPrompt.fields" :key="index" class="d-flex align-items-center m-20px">
                            <label style="width:25%" class="font-weight-500 font-size-14">{{item.title}}<span class="red" v-if="item.rules.includes('required')">*</span></label>
                            <div style="width:75%">
                                <div v-if="item.type === 'text'">
                                    <InputComponent
                                        v-model="item.value"
                                        :type="item.type"
                                        :placeholder="item.placeHolder"
                                        @keyup="checkErrors({'field':item,
                                        'name':item.title,
                                        'validations':item.rules,
                                        'type':item.type,
                                        'event':$event.event})"
                                    />
                                    <div class="red" >{{item?.error }}</div>
                                </div>
                                <div v-if="item.type === 'textArea'" >
                                    <textarea
                                        type="text"
                                        class="promt_sidebar_textarea form-control"
                                        id="message-box"
                                        ref="messageBox"
                                        :placeholder="item.placeHolder"
                                        @keyup="checkErrors({'field':item,
                                        'name':item.title,
                                        'validations':item.rules,
                                        'type':item.type,
                                        'event':$event.event})"
                                        v-model="item.value"
                                    >
                                    </textarea>
                                    <div class="red" >{{item?.error }}</div>
                                </div>
                                <DropDown v-if="item.type === 'dropdown'" mode="listbox">
                                    <template #button>
                                        <div :ref="uniqueId+item.title" class="dropdown-button"><span class="ah-sr-only">{{ item.title }}</span>{{item.value}}</div>
                                    </template>
                                    <template #options>
                                        <DropDownOption
                                            v-for="(option, index) in item.options"
                                            :key="index"
                                            :selected="option.value === item.value"
                                            @click="item.value = option.value,$refs[uniqueId+item.title][0].click()"
                                        >
                                            <span class="ml-10px">{{ option.value }}</span>
                                        </DropDownOption>
                                    </template>
                                </DropDown>
                            </div>
                        </div>
                        <button type="submit" class="btn-primary cursor-pointer border-0 d-block ml-auto generate-button-ai" @click.stop.prevent="generatePrompts()">{{$t('AI.generate')}}</button>
                    </form>
                </div>
            </template>
        </Sidebar>
        <HubAiSidebar v-if="isGenerate" 
            :selectedPrompt="selectedPrompt"
            @closeMainSidebar="(e) => $emit('closeMainSidebar', e)"
            :content="content"
            :project="project"
            :task="task"
            @regenerate="generatePrompts(true)"
            :isSendMsg="isSendMsg"
            :isError="isError"
         />
    </div>
</template>
<script setup>
import { ref, inject, computed } from 'vue'
import Sidebar from "@/components/molecules/Sidebar/Sidebar.vue";
import InputComponent from '@/components/atom/InputText/InputText.vue';
import DropDown from '../DropDown/DropDown.vue';
import DropDownOption from '../DropDownOption/DropDownOption.vue';
import HubAiSidebar from '../HubAiSidebar/HubAiSidebar.vue';
import { useValidation } from "@/composable/Validation";
import { useCustomComposable } from "@/composable";
import { useStore } from 'vuex';
import { useToast } from "vue-toast-notification";
import { useAiApiFunction } from "@/composable/aiHelper";
import markdownit from 'markdown-it'
import * as env from '@/config/env'
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
    project: {
        type: Object,
        default: () => {}
    },
    task: {
        type: Object,
        default: () => {}
    }
})

const isGenerate = ref(false);
const content = ref({});
const isSendMsg = ref(false);
const isError = ref(false);
const fullText = ref('');
const companyId = inject("$companyId")

const { checkErrors, checkAllFields} = useValidation();
const userId = inject('$userId');
const {makeUniqueId,checkGenerateResponseLimit, checkPermission,debouncerWithPromise} = useCustomComposable();
const uID =ref(`${userId.value + makeUniqueId(6)}`);
const uniqueId = ref(`${makeUniqueId(7)}`)
const { getters,commit } = useStore();
const $toast = useToast();
const aiRequestLimit = computed(() => checkPermission("artificial_intelligence.per_user_generate_limit", props.project?.isGlobalPermission, {gettersVal: getters}))
const {generateAiRequestForFunction} = useAiApiFunction();

function generatePrompts(isRegenerate = false){
    debouncerWithPromise(1000).then(() => {
        checkAllFields(props.selectedPrompt.fields).then((valid)=>{
            if(valid){
                if(checkGenerateResponseLimit(aiRequestLimit.value,userId.value) == true){
                    fullText.value = '';
                    isError.value = false;
                    isSendMsg.value = true;
                    if(!isRegenerate){
                        isGenerate.value = true;
                    }
                    let obj = {
                        fields: props.selectedPrompt.fields,
                        id: props.selectedPrompt._id
                    }
                    let data = {
                        prompt: obj,
                        uniqueUserId: uID.value,
                        isRegenerate:isRegenerate,
                        companyId: companyId.value,
                        userId: userId.value
                    }
                    const evId = `ev_${makeUniqueId(12)}`;
                    const source = new EventSource(`${env.API_URI}/api/v1/generatePrompt/events/${evId}`);
                    source.onmessage = function(event) {
                        const data = JSON.parse(event.data)?.data;
                        if(data.step !== "COUNT"){
                            receiveTextPart(data.value ? data.value : '');
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
                            isSendMsg.value = false;
                        }
                    }
                    source.onerror = function(error) {
                        source.close();
                        isError.value = true;
                        isSendMsg.value = false;
                        content.value.error = t('AI.error_occurred_engine_issue');
                        console.error(error,"error");
                    }
                    data.eventId = evId;
                    generateAiRequestForFunction(data,'','','',false,'single',props.project?.isGlobalPermission).then((result) => {
                        if(result.status === true){
                            content.value.uID = uID.value;
                            content.value.outputFormat = props.selectedPrompt.outputFormat;
                            content.value.displayButton = props.selectedPrompt.displayButton;
                            content.value.error = '';
                        }else if(result.status === false){
                            if(result.isReachedLimit){
                                $toast.error(t("Toast.Ai_limit_reached"),{position: 'top-right'});
                                isGenerate.value = false;
                                return;
                            }else if(result.isNotAi){
                                $toast.error(result.statusText,{position: 'top-right'});
                                isGenerate.value = false;
                                return;
                            }
                        }
                    }).catch((error) => {
                        isError.value = true;
                        isSendMsg.value = false;
                        content.value.error = t('AI.error_occurred_engine_issue');
                        console.error(error,"ERROR IN GENERAE PROMPTS:");
                    })
                }else{
                    $toast.error(t("Toast.Ai_limit_reached"),{position: 'top-right'});
                    return;
                }
            }
        })
    })
}

// function checkResponse(response,preFormat) {
//     if(typeof response === "object"){
//         let format = preFormat.replace('{', '').replace('}', '').split(',');
//         return Object.keys(response).every(value => format.includes(value));
//     }
// }

function scrollBottom(){
    const element = document.getElementById(content.value.uID);
    if(element) {
        setTimeout(() => {
            element.scrollTo({top: element.scrollHeight, left: 0, behavior: "smooth"});
        }, 300)
    }
}

function receiveTextPart(textPart) {
    fullText.value += textPart;
    parseJsonAiText();
}
function parseJsonAiText() {
    const titleMatch = /"title"\s*:\s*"([^"]*)"/.exec(fullText.value);
    const descriptionMatch = /"description"\s*:\s*"([^]*)/.exec(fullText.value);

    if (titleMatch) {
        let title = titleMatch[1];
        content.value.title = title;
    }
    if (descriptionMatch) {
        const partialDescription = descriptionMatch[1].replace(/"\s*}/, '');
        let description = partialDescription.replaceAll(/\\n/g, '\n').replaceAll(/\\"/g, '"');
        content.value.description = mardownInit.render(description);
        content.value.md = descriptionMatch[1].slice(0,-1);
    }
}
</script>
<style>
.prompt-body-sidebar{
    background: var(--surface);
    margin: 15px;
    width: 893px;
}
.dropdown-button{
    border-radius: 5px;
    border: 1px solid var(--border);
    height: 29px;
    padding: 5px;
}
.prompt_form{
    border-radius: 8px;
    border: 1px solid var(--surface);
    box-shadow: 0px 2px 12px 3px var(--shadow-ink);
}
.generate-button-ai{
    margin-right: 20px;
    margin-bottom: 20px;
    font-size: 16px;
    font-weight: 400;
    padding: 3px 14px 3px 14px;
}
.promt_sidebar_textarea {
    padding: 5px 10px !important;
    height: 90px !important;
}

.prompt-body-sidebar{
    background: var(--surface);
    margin: 15px;
    width: calc(100% - 30px);
}
@media (max-width:767px) {
    .prompt_form > div > label {
        width: 100% !important;
        margin-bottom: 5px;
    }
    .prompt_form > div > div {
        width: 100% !important;
    }
    .prompt_form > div {
        flex-direction: column;
        align-items: start;
        text-wrap: nowrap;
    }
}
</style>