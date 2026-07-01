<template>
    <div class="description-wrapper">
        <div v-if="noDescription" class="description_componenet">
            <div class="bg-white border-radius-8-px mt-1 p-10px" :class="{'ml-10px mr-5-px': clientWidth < 767}">
                <button @click="noDescription = false" class="add_description_button">
                    {{$t('PlaceHolder.Add_description')}}
                </button>
            </div>
        </div>
        <div class="editor-container description_componenet" v-show="!noDescription">
            <div v-if="editPermission && checkAiProject && checkAiDescription" class="ai-write-desc-bar">
                <div class="d-flex align-items-center cursor-pointer" @click="openAiWriteDescription()">
                    <img :src="aiIcon" class="mr-3px" alt="ai" />
                    <span class="font-size-14 font-weight-500 ai-color ai-border-bottom">{{ $t('AI.ai_write_description') }}</span>
                </div>
            </div>
            <div v-show="contentLoaded" id="editorjs" :class="{'ml-10px mr-10-px': clientWidth < 767, 'show_hide_class': !isShow}" @click="isShow = true"></div>
            <Transition>
                <span v-if="showMessage" class="saved_message">{{$t('Description.saved')}}</span>
            </Transition>
            <Skelaton class="w-100 border-radius-8-px" style="height: 60px;" v-if="!contentLoaded"/>
            <div v-show="false" id="editor-converter"></div>
            <div class="hide_show_wrapper" v-if="contentExceeds" :class="{'ml-10px mr-10-px': clientWidth < 767 }">
                <button v-if="!isShow" @click="isShow = true" class="hide_show">{{$t('Description.show_more')}}</button>
                <button v-else @click="isShow = false" class="hide_show">{{$t('Description.show_less')}}</button>
            </div>
            <div class="d-flex justify-content-start description-action mt-10px mb-15px description-padding">
                <!-- <button class="outline-primary mr-10px" @click="cancelData()">{{$t('Projects.cancel')}}</button> -->
                <button v-if="isChanged" class="btn-primary" @click="saveData()">{{$t('Projects.save')}}</button>
            </div>

            <PromptSidebar v-if="isOpenPromptDeatil" @closePrompt="isOpenPromptDeatil = false, resetAiBlocks()" :selectedPrompt="selectedPrompt" @closeMainSidebar="(e) => {isOpenPromptDeatil = false; e ? resetAiBlocks() : '';}" :project="project" :task="task" />

            <AiWriteDescription
                v-model="showAiWrite"
                :title="aiWriteTitle"
                :taskType="aiWriteTaskType"
                :existingDescription="aiWriteExistingDescription"
                @apply="applyAiDescription"
            />
        </div>
    </div>
</template>

<script setup>
import { computed, defineComponent, inject, onMounted, provide, ref, watch } from 'vue';
import { useStore } from 'vuex';
import Swal from 'sweetalert2';
import { useRoute, useRouter } from "vue-router";
import markdownit from 'markdown-it'
import { useToast } from 'vue-toast-notification';
import { useI18n } from "vue-i18n";
const { t } = useI18n();
const mardownInit = markdownit({
    html: true
})
// Emit inline code as <code class="inline-code"> (the class @editorjs/inline-code
// uses) so Editor.js preserves + styles it when markdown is converted into
// description blocks — a bare <code> loses the inline-code styling on sanitize.
mardownInit.renderer.rules.code_inline = (tokens, idx) =>
    `<code class="inline-code">${mardownInit.utils.escapeHtml(tokens[idx].content)}</code>`;
// mardownInit.renderer.rules.strong_open = () => "<b>";
// mardownInit.renderer.rules.strong_close = () => "</b>";

import PromptSidebar from "@/components/molecules/PromptSidebar/PromptSidebar.vue"
import AiWriteDescription from "@/components/molecules/AiWriteDescription/AiWriteDescription.vue"

import EditorJS from '@editorjs/editorjs';
import Header from '@editorjs/header';
import List from '@editorjs/nested-list';
import Checklist from '@editorjs/checklist';
import Marker from '@editorjs/marker';
import CodeTool from '@editorjs/code';
import InlineCode from '@editorjs/inline-code';
import Embed from '@editorjs/embed';
import Table from '@editorjs/table';
import writeWithAi from './writeWithAi.js';

import { apiRequest } from '../../../services';
import * as env from '@/config/env';
import { useCustomComposable } from '@/composable';
import Skelaton from '@/components/atom/Skelaton/Skelaton.vue';
import taskClass from '@/utils/TaskOperations';
const aiIcon = require('@/assets/images/svg/ai_image.svg');


defineComponent({
    name: "DescriptionComponent"
});
const { getters, commit} = useStore();

const currentCompany = computed(() => getters["settings/selectedCompany"]);
const showMessage = ref(false);
const isOpenPromptDeatil = ref(false);
const selectedPrompt = ref({});
const blockIndex = ref(null)
const router = useRouter();
const route = useRoute();
const isShow = ref(false)
const noDescription = ref(false)
const contentExceeds = ref(false)
const tempBlock = ref([])
const isChanged = ref(false);

// "Write with AI" popover (dedicated lightweight entry point — separate from
// the Editor.js WriteWithAi block / PromptSidebar).
const showAiWrite = ref(false);
// One-shot flag: a programmatic editor.render() (how AI content is applied) does
// NOT fire the editor's onChange, so it wouldn't auto-save. We set this before
// applying AI content and persist explicitly once injectBlocks has rendered it,
// otherwise the description shows but isn't saved (lost on reload).
const pendingAiSave = ref(false);

const contentLoaded = ref(false)

const { checkPermission,checkApps, debounce } = useCustomComposable();

const props = defineProps({
    description: {
        type: [String, Object],
        default: () => {}
    },
    editPermission: {
        type: [Boolean, Number],
        default: false
    },
    minlength: {
        type: Number,
        default: 0
    },
    isShowAi: {
        type: Boolean,
        default: false
    },
    projectData: {
        type: Object,
        default: () => {}
    },
    from: {
        type: String,
        default:''
    },
    task: {
        type: Object,
        default: () => {}
    },
    isMainSpinner: {
        type: Boolean,
        default: false
    }
});

const companyId = inject('$companyId');
const project = inject("selectedProject");
const clientWidth = inject('$clientWidth');

const checkAiProject = computed(() => checkApps('AI',props.projectData));
const checkAiDescription = props.from === 'project' ? computed(() => checkPermission("project.project_description", props.projectData?.isGlobalPermission, {gettersVal: getters})) : computed(() => checkPermission("task.task_description", props.projectData?.isGlobalPermission, {gettersVal: getters}));

// Inputs handed to the lightweight "Write with AI" popover. Title + type come
// from the task when editing a task, or the project name when from==='project'
// (Description.vue is shared between both). Existing description is sent as
// faithful Markdown (blocksToMarkdown) so the model can rewrite/improve — or, in
// Add mode, reproduce it verbatim and insert — without losing its structure.
const aiWriteTitle = computed(() => props.from === 'project'
    ? (props.projectData?.ProjectName || '')
    : (props.task?.TaskName || ''));
const aiWriteTaskType = computed(() => props.from === 'project' ? 'project' : (props.task?.TaskType || ''));
const aiWriteExistingDescription = computed(() => {
    const d = props.description;
    if (!d) return '';
    if (typeof d === 'string') return d;
    if (Array.isArray(d.blocks)) return blocksToMarkdown(d.blocks);
    return '';
});

const editorTools = {
    WriteWithAi: {
        class:writeWithAi,
        config: {
            openSidebar : openDescriptionWithAi,
            isShowAi: checkAiProject.value && checkAiDescription.value
        },
    },
    header: {
        class: Header,
        inlineToolbar: true
    },
    list: {
        class: List,
        inlineToolbar: true
    },
    checklist: {
        class: Checklist,
        inlineToolbar: true
    },
    marker: {
        class: Marker,
        inlineToolbar: true
    },
    code: {
        class: CodeTool,
        inlineToolbar: true
    },
    inlineCode: {
        class: InlineCode,
        inlineToolbar: true
    },
    embed: {
        class: Embed,
        inlineToolbar: true
    },
    table: {
        class: Table,
        inlineToolbar: true
    }
}

const editor = ref();

const $toast = useToast();
const converter = ref();

onMounted(() => {
    if(props.isMainSpinner === false){
        initEditor();
    }
})

watch([() => route?.params?.taskId, () => route?.params?.id , () => route?.query?.detailTab], () => {
    if(route?.params?.taskId || route?.query?.detailTab === 'task-detail-tab'){
        return;
    }
    if(!props.description || (typeof props.description !== 'string' && !props.description.blocks?.length)) {
        noDescription.value = true;
    }
    else{
        noDescription.value = false;
    }
    contentLoaded.value = false;
    setTimeout(() => {
        renderDescription();
    },500)
})

watch(() => props.isMainSpinner, (newVal) => {
    if (newVal === false) {
        initEditor();
    }
}, {flush: 'post'});


function initEditor() {
    editor.value = new EditorJS({
        holder: 'editorjs',
        tools: {...editorTools},
        placeholder: t('Description.description_placeholder'),
        readOnly: !props.editPermission,
        onChange: debounce(() => {
            blockIndex.value = editor.value.blocks.getCurrentBlockIndex();
            try {
                editor.value.save().then((res) => {
                    // isChanged.value = JSON.stringify(props.description?.blocks) != JSON.stringify(res?.blocks) ? true : false
                    if(JSON.stringify(props.description?.blocks) != JSON.stringify(res?.blocks)){
                        saveData();
                    }
                    if(res !== undefined && res){
                        tempBlock.value = res;
                    }
                    checkContentSize()
                })
            } catch (error) {
                console.error("ERROR in save: ", error);
            }
        }, 500),
        onReady(){
            document.querySelector('.codex-editor__redactor').style.paddingBottom = '10px';
            if(!props.description || (Array.isArray(props.description?.blocks) && !props.description.blocks.length)) {
                noDescription.value = true;
            } else if (typeof props.description === 'string' && props.description !== '') {
                noDescription.value = false;
            }
            setTimeout(() => {
                renderDescription()
            },500);
        }
    });
    converter.value = new EditorJS({
        holder: 'editor-converter',
        tools: {...editorTools},
        onChange() {
            converter.value.save().then((newBlocks) => {
                injectBlocks(newBlocks.blocks?.reverse() || [])
            }).catch((err) => {
                console.error(err,"Error in conver in to blocks");
            })
        },
    });
}

function checkContentSize() {
    contentLoaded.value = true;

    // CHECK IF SIZE EXCEEDS
    const minHeight = 350;
    setTimeout(() => {
        const editorConentHeight = document?.querySelector('.codex-editor')?.clientHeight;
        if(!editorConentHeight) return;
        contentExceeds.value = editorConentHeight > minHeight;

        // ADJUST BOTTOM PADDING DEPENDING ON CONTENT SIZE
        const editorTextArea = document.querySelector('.codex-editor__redactor');
        if(editorTextArea) {
            editorTextArea.style.minHeight= '215px';
            if(contentExceeds.value) {
                editorTextArea.style.paddingBottom = '0px';
            } else {
                editorTextArea.style.paddingBottom = '10px';
            }
        }
    })
}

watch(() => props.editPermission,() => {
    editor.value.readOnly.toggle(!props.editPermission)
})

function blocksToText(response = []) {
    let descText = "";
    response.forEach((x) => {
        switch(x.type) {
            case "paragraph":
                descText += x.data.text;
                break;
            case "header":
                descText += x.data.text;
                break;
            case "quote":
                descText += x.data.text + "\n";
                descText += x.data.caption;
                break;
            case "warning":
                descText += x.data.title + "\n";
                descText += x.data.message;
                break;
            case "code":
                descText += x.data.code;
                break;
            case "linkTool":
                descText += x.data.link;
                break;
            case "list":
                descText += (x.data.items || []).map((i) => (typeof i === "string" ? i : (i && i.content) || "")).join(", ");
                break;
            case "checklist":
                descText += (x.data.items || []).map((i) => (i && i.text) || "").join(", ");
                break;
        }
        descText += "\n";
    })
    return descText;
}

// Faithful Markdown for the "Write with AI" model input. Unlike blocksToText
// (a lossy comma-joined flatten kept only for the stored plain-text field),
// this preserves headings and bullet structure so that — in Add mode, where the
// model reproduces the existing description verbatim and inserts the new content
// — it round-trips back through markdown -> blocks cleanly (no "[object Object]",
// no collapsed lists). Covers the editor's tools; falls back to a block's text.
function blocksToMarkdown(blocks = []) {
    const inline = (html) => (html == null ? '' : String(html)
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/?(?:b|strong)>/gi, '**')
        .replace(/<\/?(?:i|em)>/gi, '*')
        .replace(/<code[^>]*>/gi, '`').replace(/<\/code>/gi, '`')
        .replace(/<a\b[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"')
        .trim());
    // Nested-list items are objects ({ content, items }); render recursively.
    const renderItems = (items, ordered, depth) => {
        let out = '';
        (items || []).forEach((it, i) => {
            const indent = '  '.repeat(depth);
            const marker = ordered ? `${i + 1}.` : '-';
            const text = typeof it === 'string' ? inline(it) : inline(it && it.content);
            out += `${indent}${marker} ${text}\n`;
            if (it && Array.isArray(it.items) && it.items.length) {
                out += renderItems(it.items, ordered, depth + 1);
            }
        });
        return out;
    };
    let md = '';
    (blocks || []).forEach((x) => {
        const d = x.data || {};
        switch (x.type) {
            case 'header':
                md += `${'#'.repeat(Math.min(Math.max(d.level || 2, 1), 6))} ${inline(d.text)}\n\n`;
                break;
            case 'paragraph':
                md += `${inline(d.text)}\n\n`;
                break;
            case 'list':
                md += `${renderItems(d.items, d.style === 'ordered', 0)}\n`;
                break;
            case 'checklist':
                (d.items || []).forEach((it) => {
                    md += `- [${it && it.checked ? 'x' : ' '}] ${inline(it && it.text)}\n`;
                });
                md += '\n';
                break;
            case 'quote':
                md += `> ${inline(d.text)}\n\n`;
                break;
            case 'code':
                md += '```\n' + (d.code || '') + '\n```\n\n';
                break;
            case 'warning':
                md += `> **${inline(d.title)}**\n> ${inline(d.message)}\n\n`;
                break;
            default:
                if (d.text) md += `${inline(d.text)}\n\n`;
                break;
        }
    });
    return md.trim();
}

const saveData = debounce(() => {
    editor.value.saver.save().then((response) => {
        response.blocks = response.blocks.filter((block) => block.type !== "WriteWithAi");
        if(response){
            let val = {blocks: response || {},text : blocksToText(response?.blocks)}

            if(props.from === 'task'){
                taskClass.updateDescription({
                    companyId: companyId.value,
                    task: props.task,
                    text: val
                }).then(() => {
                    highlightDescription()
                })
                .catch((error) => {
                    $toast.error(t('Toast.Description_not_updated'),{position: 'top-right'});
                    console.error("Error in updating Description: ", error);
                })
            }
            else{
                updateProjectDescription(val);
            }
        }
    });
})

function renderDescription(replace = false) {
    try {
        if(props.description){
            if(typeof props.description === 'string'){
                blockIndex.value = 1;
                injectDescription(props.description,replace);
            }else{
                editor.value?.render(props.description)
                .then(() => {
                    checkContentSize()
                });
                if(!Object.keys(tempBlock.value).length){
                    tempBlock.value = props.description;
                }
            }
        }else{
            let obj = {
                blocks: []
            }
            editor.value?.render(obj)
            .then(() => {
                checkContentSize()
            });
        }
    } catch (error) {
        console.error(error,"ERROR:");
    }
}

function openDescriptionWithAi () {
    if(!currentCompany.value?.planFeature?.aiPermission){
        Swal.fire({
            title: t('AI.please_upgrade_plan_to_use_ai'),
            text: t('AI.ai_available_on_paid_plans_upgrade_now'),
            icon: 'info',
            confirmButtonColor: '#28C76F',
            confirmButtonText: t('Header.upgrade_now'),
            showCloseButton:true    
        }).then((result) => {
            if (result.isConfirmed) {
                router.push({name: 'Upgrade', params: {cid: companyId.value}})
            }
        })
        return;
    }
    const data = {
        query: [{title : "Write a Description"}]
    };
    apiRequest("post",env.FINDONEPROMPTS,data).then((result)=>{
        if(result.data.status === true){
            selectedPrompt.value = result.data.statusText;
            isOpenPromptDeatil.value = true;
        }
    })
}

// Opens the dedicated lightweight popover. Reuses the EXACT same AI-plan gate
// as openDescriptionWithAi (the Editor.js block tool entry point) so both
// entry points behave identically on free plans.
function openAiWriteDescription() {
    if(!currentCompany.value?.planFeature?.aiPermission){
        Swal.fire({
            title: t('AI.please_upgrade_plan_to_use_ai'),
            text: t('AI.ai_available_on_paid_plans_upgrade_now'),
            icon: 'info',
            confirmButtonColor: '#28C76F',
            confirmButtonText: t('Header.upgrade_now'),
            showCloseButton:true
        }).then((result) => {
            if (result.isConfirmed) {
                router.push({name: 'Upgrade', params: {cid: companyId.value}})
            }
        })
        return;
    }
    showAiWrite.value = true;
}

// Apply an AI-generated description by REUSING the exact, proven path the
// existing "Write a Description" sidebar uses: injectDescription ->
// converter.blocks.renderFromHTML -> converter.onChange -> injectBlocks ->
// editor.render. That single converter operation is the only thing that
// reliably works here; the earlier version reinvented it with extra
// clear/render/save calls that raced Editor.js' BlockManager and threw
// "Can't find a Block to remove".
//
// This is a "write THE description" action, so we make it a full REPLACE by
// resetting the working block set first: injectBlocks then splices the
// generated blocks into an empty set (blockIndex 1), producing ONLY the new
// content. The resulting editor change triggers the debounced onChange ->
// saveData(), which persists it (task -> taskClass.updateDescription,
// project -> updateProjectDescription).
// The popover hands back the FULL description to apply — for both "Add" (the
// model inserts the new content into the existing text and returns the whole
// thing) and "Rewrite". Either way this REPLACES via the path above; the user
// has already reviewed the exact final result in the popover's preview, so
// nothing is applied unseen.
async function applyAiDescription(payload = '') {
    const markdown = typeof payload === 'string' ? payload : (payload && payload.text) || '';
    if (!markdown || !editor.value || !converter.value) return;
    tempBlock.value = { blocks: [] };
    blockIndex.value = 1;
    noDescription.value = false;
    pendingAiSave.value = true;
    await injectDescription(markdown);
}

async function injectDescription(description = '') {
    try {
        description = description.replaceAll(/\\n/g, '\n');
        const htmlStr = mardownInit.render(description)
        await converter.value.blocks.renderFromHTML(htmlStr);
    } catch (error) {
        console.error(error,"error");
    }
}

async function injectBlocks (newBlocks) {
    const blocks = [...(tempBlock.value?.blocks || [])]

    newBlocks.forEach((block, index) => {
        blocks.splice(blockIndex.value-1, index === 0 ? 1 : 0, block);
    })
    await editor.value.render({...tempBlock.value, blocks})
    checkContentSize()
    // The AI "Use this" path renders programmatically (no editor onChange fires),
    // so persist explicitly once the generated content is in the editor —
    // otherwise it shows but isn't saved (lost on reload). One-shot.
    if (pendingAiSave.value) {
        pendingAiSave.value = false;
        saveData();
    }
}

// async function cancelData () {
//     if(Object.keys(tempBlock.value).length > 0){
//         if(props.description){
//             if(typeof props.description === 'string'){
//                 const blockCount = editor.blocks.getBlocksCount();
//                 for (let i = blockCount - 1; i >= 0; i--) {
//                     editor.blocks.delete(i);
//                 }
//                 blockIndex.value = 1;
//                 converter.blocks.renderFromHTML(props.description);
//             }else{
//                 editor?.render(props.description);
//                 if(!Object.keys(tempBlock.value).length){
//                     tempBlock.value = props.description;
//                 }
//             }
//         }else{
//             let obj = {
//                 blocks: []
//             }
//             editor?.render(obj);
//         }
//     }
// }

function resetAiBlocks() {
    // const currIndex = blockIndex.value;
    // editor.blocks.delete(currIndex - 1);

    document.querySelectorAll("[data-type=WW_AI]").forEach((x) => {
        const blockId = x?.parentElement?.parentElement?.dataset?.id
        const deleteIndex = editor.value.blocks.getBlockIndex(blockId)
        if(deleteIndex >= 0) {
            editor.value.blocks.delete(deleteIndex);
        }
    })
}

function highlightDescription() {
    showMessage.value = true;
    setTimeout(() => {
        showMessage.value = false;
    }, 1000);
}

async function updateProjectDescription (val) {
    let updateObject = {descriptionBlock: val.blocks}
    await apiRequest("put",`/api/v1/${env.PROJECTACTIONS}/${props.projectData._id}`,{updateObject: updateObject});
    highlightDescription();
    commit('projectData/projectLocalUpdate', {itemData:  {...props.projectData,...updateObject},projectId: props.projectData._id,key:'RemoveProject',subKey: '',userId: ''});
}


provide('injectDescription',injectDescription)

defineExpose({
    highlightDescription
})
</script>

<style src="./style.css">

</style>