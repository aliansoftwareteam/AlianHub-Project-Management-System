<template>
    <div class="pbe" @scroll="closeMention">
        <div
            :id="holderId"
            class="pbe__holder"
            @input="onEditorInput"
            @keydown.capture="onEditorKeydown"
            @keyup="onEditorKeyup"
            @click="onEditorClick"
            @focusin="rememberBlock"
            @mouseup="rememberBlock"
        ></div>
        <AiSelectionPanel ref="selectionPanel" :editor="currentEditor" :target="selectionTarget" @changed="emitChange" />
        <Teleport to="body">
            <DocMentionPicker
                v-if="mention.open"
                :query="mention.query"
                :position="mention"
                :sources="mentionSources"
                @ready="mentionPicker = $event"
                @pick="insertMention"
                @close="closeMention"
            />
        </Teleport>
    </div>
</template>

<script setup>
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { useStore } from 'vuex';
import EditorJS from '@editorjs/editorjs';
import HeaderTool from '@editorjs/header';
import List from '@editorjs/nested-list';
import Checklist from '@editorjs/checklist';
import Marker from '@editorjs/marker';
import CodeTool from '@editorjs/code';
import InlineCode from '@editorjs/inline-code';
import Embed from '@editorjs/embed';
import Table from '@editorjs/table';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { useCustomComposable, useGetterFunctions } from '@/composable';
import pageContent from '@pageContent';
import { canUseAi } from '@/composable/aiAvailability';
import AiSelectionPanel from '@/components/molecules/AiSelection/AiSelectionPanel.vue';
import { createSelectionTools } from '@/components/molecules/AiSelection/selectionTools';
import { listsOfProject } from '@/utils/aiTargets';
import { createBlockTools, TASK_LIST_LIMIT } from './blockTools';
import { initials } from './docsFormat';
import { decorateMentions, mentionElement, mentionQueryAt } from './docMentions';
import { useMentionLinks } from './useMentionLinks';

const { contentToEditorData, blocksToHtml, emptyEditorData } = pageContent.default || pageContent;

defineOptions({ name: 'PageBlockEditor' });

const { t } = useI18n();
const route = useRoute();
const store = useStore();
const { getUser } = useGetterFunctions();
const { checkPermission, checkBucketStorage, getWasabiImageLink } = useCustomComposable();

const props = defineProps({
    seed: { type: Object, default: null },
    editorKey: { type: String, default: 'page' },
    readOnly: { type: Boolean, default: false },
    projectId: { type: String, default: '' },
    pageId: { type: String, default: '' },
    beforeLeave: { type: Function, default: () => true },
});

const emit = defineEmits(['change', 'ready']);

const holderId = `pbe-${props.editorKey}-${Math.random().toString(36).slice(2, 8)}`;
const editor = ref(null);

const TASK_FIELDS = { TaskName: 1, TaskKey: 1, statusKey: 1, status: 1, AssigneeUserId: 1, ProjectID: 1, sprintId: 1 };
const liveFilter = { deletedStatusKey: { $in: [0, undefined] } };
const UPLOAD_REFUSALS = { 400: 'Docs.image_type_refused', 413: 'Docs.image_too_large' };
const ACTIVE_SEAT = 2;

const { onMentionClick, onMentionKeydown, routeToTask, fetchTask } = useMentionLinks({ beforeLeave: () => props.beforeLeave() });

function projects() {
    const all = store.getters['projectData/allProjects'];
    return (all && all.data) || [];
}

function findTasks(match, limit) {
    return apiRequest('post', `${env.TASK}/find`, {
        findQuery: [{ $match: match }, { $project: TASK_FIELDS }, { $sort: { updatedAt: -1 } }, { $limit: limit }],
    }).then((response) => (Array.isArray(response.data) ? response.data : []))
        .catch((error) => {
            console.error('ERROR in doc task lookup: ', error);
            return [];
        });
}

const toolContext = {
    t,
    get defaultProjectId() { return props.projectId; },
    projects,
    searchTasks(query, projectId) {
        const escaped = String(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return findTasks({
            ...(projectId ? { ProjectID: { objId: { $in: [projectId] } } } : {}),
            ...liveFilter,
            $or: [{ TaskName: { $regex: escaped, $options: 'i' } }, { TaskKey: { $regex: escaped, $options: 'i' } }],
        }, 8);
    },
    fetchTasks(projectId, statusType) {
        const byStatus = statusType === 'close' ? { 'status.type': 'close' }
            : statusType === 'open' ? { 'status.type': { $ne: 'close' } } : {};
        return findTasks({ ProjectID: { objId: { $in: [projectId] } }, ...liveFilter, ...byStatus }, TASK_LIST_LIMIT);
    },
    fetchTask,
    statusOf(task) {
        if (!task) return null;
        const project = projects().find((p) => String(p._id) === String(task.ProjectID));
        const fromProject = ((project && project.taskStatusData) || []).find((s) => s && s.key === task.statusKey);
        if (fromProject) {
            return { name: fromProject.name, type: fromProject.type, bgColor: fromProject.bgColor, textColor: fromProject.textColor };
        }
        return task.status ? { name: task.status.text || task.status.name, type: task.status.type } : null;
    },
    userOf(id) {
        const user = getUser(String(id));
        if (!user || user.ghostUser) return null;
        return { name: user.Employee_Name, image: user.Employee_profileImageURL, initials: initials(user.Employee_Name) };
    },
    openTask: routeToTask,
    uploadImage(file) {
        const form = new FormData();
        form.append('file', file);
        return apiRequest('post', `${env.PAGES}/${props.pageId}/images`, form, 'form').then((response) => {
            const body = response && response.data;
            if (body && body.status && body.data && body.data.key) return body.data.key;
            throw Object.assign(new Error('image upload refused'), { i18nKey: UPLOAD_REFUSALS[body && body.statusCode] });
        });
    },
    imageUrl(key) {
        return getWasabiImageLink(route.params.cid, key);
    },
    canStoreImage(file) {
        return Boolean(props.pageId) && checkBucketStorage([file.size], { gettersVal: store.getters }) === true;
    },
    openMentionPicker(range, query) {
        if (query.trim()) openMention(range, query, true);
    },
};

const labelOf = (id) => (toolContext.userOf(id) || {}).name || '';
const decorate = () => decorateMentions(document.getElementById(holderId), { labelOf });

let docIndex = null;
const mentionSources = {
    people(query) {
        const wanted = query.trim().toLowerCase();
        return (store.getters['settings/companyUsers'] || [])
            .filter((seat) => seat && seat.userId && seat.isDelete !== true && (seat.status === undefined || Number(seat.status) === ACTIVE_SEAT) && !seat.isAgent && !seat.isBot)
            .map((seat) => ({ id: String(seat.userId), user: toolContext.userOf(seat.userId) }))
            .filter(({ user }) => user && (!wanted || user.name.toLowerCase().includes(wanted)))
            .map(({ id, user }) => ({ type: 'user', id, label: user.name, image: user.image, initials: user.initials }));
    },
    async docs(query) {
        if (!docIndex) {
            docIndex = apiRequest('get', `${env.PAGES}?scope=all`)
                .then((response) => (response.data && response.data.status && Array.isArray(response.data.data) ? response.data.data : []))
                .catch(() => { docIndex = null; return []; });
        }
        const wanted = query.trim().toLowerCase();
        return (await docIndex)
            .filter((page) => String(page._id) !== props.pageId && (!wanted || String(page.title || '').toLowerCase().includes(wanted)))
            .map((page) => ({ type: 'doc', id: String(page._id), label: page.title || t('Docs.untitled') }));
    },
    async tasks(query) {
        return (await toolContext.searchTasks(query, ''))
            .map((task) => ({ type: 'task', id: String(task._id), label: [task.TaskKey, task.TaskName].filter(Boolean).join(' '), meta: task.TaskKey || '' }));
    },
};

const DocMentionPicker = defineAsyncComponent(() => import('./DocMentionPicker.vue'));
const mention = reactive({ open: false, query: '', top: 0, left: 0, fromSelection: false });
const mentionPicker = shallowRef(null);
const PICKER_GAP = 6;
const PICKER_HEIGHT = 320;
const PICKER_WIDTH = 320;
const EDGE = 8;
const CARET_KEYS = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
let mentionRange = null;

function placePicker(range) {
    const rect = range.getBoundingClientRect();
    const width = Math.min(PICKER_WIDTH, window.innerWidth - EDGE * 2);
    mention.left = Math.max(EDGE, Math.min(rect.left, window.innerWidth - width - EDGE));
    const fitsBelow = rect.bottom + PICKER_GAP + PICKER_HEIGHT <= window.innerHeight;
    mention.top = fitsBelow || rect.top < PICKER_HEIGHT ? rect.bottom + PICKER_GAP : rect.top - PICKER_GAP - PICKER_HEIGHT;
}

function openMention(range, query, fromSelection = false) {
    mentionRange = range;
    mention.query = query;
    mention.fromSelection = fromSelection;
    placePicker(range);
    mention.open = true;
}

function closeMention() {
    mention.open = false;
    mentionPicker.value = null;
    mentionRange = null;
}

function caretText() {
    const selection = window.getSelection();
    const holder = document.getElementById(holderId);
    if (!holder || !selection || !selection.rangeCount || !selection.isCollapsed) return null;
    const node = selection.anchorNode;
    if (!node || node.nodeType !== Node.TEXT_NODE || !holder.contains(node)) return null;
    const parent = node.parentElement;
    if (!parent || !parent.closest('[contenteditable="true"]') || parent.closest('.mention, .pb-image, .pb-picker')) return null;
    return { node, offset: selection.anchorOffset };
}

function onEditorInput() {
    if (props.readOnly) return;
    const at = caretText();
    const query = at ? mentionQueryAt(at.node.textContent.slice(0, at.offset)) : null;
    if (query === null) {
        closeMention();
        return;
    }
    const range = document.createRange();
    range.setStart(at.node, at.offset - query.length - 1);
    range.setEnd(at.node, at.offset);
    openMention(range, query);
}

function onEditorKeyup(event) {
    if (mention.open && !mention.fromSelection && CARET_KEYS.includes(event.key)) onEditorInput();
}

function onEditorKeydown(event) {
    if (!mention.open) {
        onMentionKeydown(event);
        return;
    }
    const picker = mentionPicker.value;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (picker) picker.move(event.key === 'ArrowDown' ? 1 : -1);
    } else if ((event.key === 'Enter' || event.key === 'Tab') && !event.isComposing) {
        if (!picker || !picker.choose()) {
            closeMention();
            return;
        }
    } else if (event.key === 'Escape') {
        closeMention();
    } else {
        return;
    }
    event.preventDefault();
    event.stopPropagation();
}

function onEditorClick(event) {
    if (onMentionClick(event)) return;
    if (mention.open && !mention.fromSelection) onEditorInput();
}

function onOutsidePointer(event) {
    if (!mention.open) return;
    const holder = document.getElementById(holderId);
    if (holder && holder.contains(event.target)) return;
    if (event.target.closest && event.target.closest('.dmp, .ce-inline-toolbar')) return;
    closeMention();
}

function insertMention(item) {
    const range = mentionRange;
    closeMention();
    if (!range || props.readOnly) return;
    const node = mentionElement(item);
    const space = document.createTextNode('\u00a0');
    range.deleteContents();
    range.insertNode(space);
    range.insertNode(node);
    decorate();
    const caret = document.createRange();
    caret.setStart(space, 1);
    caret.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(caret);
}

const tools = {
    header: { class: HeaderTool, inlineToolbar: true, config: { levels: [1, 2, 3], defaultLevel: 2 } },
    list: { class: List, inlineToolbar: true },
    checklist: { class: Checklist, inlineToolbar: true },
    table: { class: Table, inlineToolbar: true },
    ...createBlockTools(toolContext),
    code: { class: CodeTool },
    embed: { class: Embed, inlineToolbar: true },
    marker: { class: Marker },
    inlineCode: { class: InlineCode },
};

const selectionPanel = ref(null);
const currentEditor = () => editor.value;
const selectionTarget = computed(() => {
    const project = props.projectId ? projects().find((p) => String(p._id) === String(props.projectId)) : null;
    if (!project || checkPermission('task.task_create', project.isGlobalPermission) !== true) return null;
    const lists = listsOfProject(project);
    return lists.length ? { projectData: project, lists } : null;
});

function selectionTools() {
    if (props.readOnly || !canUseAi()) return {};
    return createSelectionTools({ t, onPick: (pick) => selectionPanel.value?.open(pick), canSplit: Boolean(selectionTarget.value) });
}

function seedData() {
    return contentToEditorData(props.seed || {});
}

async function emitChange() {
    if (!editor.value) return;
    decorate();
    const data = await editor.value.save();
    emit('change', { blocks: data, html: blocksToHtml(data) });
}

function initEditor() {
    editor.value = new EditorJS({
        holder: holderId,
        tools: { ...tools, ...selectionTools() },
        data: seedData(),
        readOnly: props.readOnly,
        placeholder: t('Docs.slash_hint'),
        minHeight: 200,
        onChange: () => { emitChange(); },
        onReady: () => {
            decorate();
            emit('ready');
        },
    });
}

/* Editor.js keeps no undo history across render(), so the content an AI result
 * replaces is handed back for the caller to restore. */
async function applyBlocks(payload) {
    if (!editor.value || !payload) return null;
    const previous = await editor.value.save();
    const incoming = { ...contentToEditorData({ blocks: payload.blocks || payload }) };
    if (payload.mode === 'append') {
        incoming.blocks = [...(previous.blocks || []), ...(incoming.blocks || [])];
    } else if (payload.mode === 'prepend') {
        incoming.blocks = [...(incoming.blocks || []), ...(previous.blocks || [])];
    }
    await editor.value.render(incoming.blocks && incoming.blocks.length ? incoming : emptyEditorData());
    await emitChange();
    return previous;
}

async function restore(data) {
    if (!editor.value || !data) return;
    await editor.value.render(data.blocks && data.blocks.length ? data : emptyEditorData());
    await emitChange();
}

function scrollToBlock(blockId) {
    const node = document.querySelector(`#${holderId} [data-id="${blockId}"]`);
    if (node) node.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* Editor.js forgets its current block as soon as focus leaves the editor, so the last one touched is kept here. */
let lastBlockId = '';
function rememberBlock(event) {
    const node = event.target && event.target.closest ? event.target.closest('.ce-block[data-id]') : null;
    if (node) lastBlockId = node.getAttribute('data-id');
}

function blockNode(blockId) {
    return blockId ? document.querySelector(`#${holderId} .ce-block[data-id="${CSS.escape(blockId)}"]`) : null;
}

function currentBlock() {
    const node = blockNode(lastBlockId);
    return node ? { id: lastBlockId, text: node.textContent.replace(/\s+/g, ' ').trim() } : null;
}

function markCommented(blockIds) {
    const wanted = new Set(blockIds || []);
    document.querySelectorAll(`#${holderId} .ce-block[data-id]`).forEach((node) => {
        node.classList.toggle('pbe-commented', wanted.has(node.getAttribute('data-id')));
    });
}

defineExpose({ applyBlocks, restore, emitChange, scrollToBlock, currentBlock, markCommented });

onMounted(() => {
    initEditor();
    document.addEventListener('mousedown', onOutsidePointer, true);
});

watch(() => props.editorKey, async () => {
    if (editor.value && editor.value.destroy) {
        await editor.value.destroy();
        editor.value = null;
    }
    initEditor();
});

onBeforeUnmount(() => {
    document.removeEventListener('mousedown', onOutsidePointer, true);
    closeMention();
    if (editor.value && editor.value.destroy) {
        editor.value.destroy();
        editor.value = null;
    }
});
</script>

<style scoped>
.pbe {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    padding: 4px 0 32px;
}
.pbe__holder { min-height: 200px; }
.pbe :deep(.ce-block.pbe-commented > .ce-block__content) { background: var(--brand-tint); box-shadow: inset 3px 0 0 var(--brand); border-radius: 0 6px 6px 0; }

.pbe :deep(.codex-editor__redactor) { padding-bottom: 60px !important; }
.pbe :deep(.ce-block__content),
.pbe :deep(.ce-toolbar__content) { max-width: 760px; }

.pbe :deep(.ce-paragraph) {
    font: 400 15px/1.7 var(--font-ui);
    color: var(--ink);
}
.pbe :deep(.ce-paragraph[data-placeholder]:empty::before) { color: var(--ink-2); }
.pbe :deep(.ce-header) {
    font-family: var(--font-ui);
    font-weight: 600;
    letter-spacing: -.3px;
    color: var(--ink);
    padding: 10px 0 4px;
}
.pbe :deep(h1.ce-header) { font-size: 24px; letter-spacing: -.5px; }
.pbe :deep(h2.ce-header) { font-size: 17px; }
.pbe :deep(h3.ce-header) { font-size: 14.5px; }
.pbe :deep(.cdx-list),
.pbe :deep(.cdx-checklist__item-text),
.pbe :deep(.tc-cell) { font: 400 14.5px/1.65 var(--font-ui); color: var(--ink); }
.pbe :deep(.cdx-checklist__item-checkbox-check) { background: var(--surface); border-color: var(--border); border-radius: 4px; }
.pbe :deep(.cdx-checklist__item--checked .cdx-checklist__item-checkbox-check) { background: var(--brand); border-color: var(--brand); }
.pbe :deep(.cdx-checklist__item--checked .cdx-checklist__item-checkbox-check svg path) { stroke: var(--on-brand); }
/* The plugin's hover fill (#0059AB) outranks the rule above; under the dark-ink tick it drops to 2.7:1. */
:root[data-theme="dark"] .pbe :deep(.cdx-checklist__item--checked .cdx-checklist__item-checkbox:hover .cdx-checklist__item-checkbox-check) { background: var(--brand-deep); border-color: var(--brand-deep); }
.pbe :deep(.ce-code__textarea) {
    font: 400 12.5px/1.6 var(--font-mono);
    background: var(--surface-2);
    color: var(--ink);
    border: 1px solid var(--hairline);
    border-radius: var(--r-input);
}
.pbe :deep(.tc-table) { --color-border: var(--hairline); }
.pbe :deep(.cdx-marker) { background: var(--warn-bg); color: inherit; }
.pbe :deep(.inline-code) { font-family: var(--font-mono); background: var(--surface-2); color: var(--brand); }

.pbe :deep(.ce-toolbar__plus),
.pbe :deep(.ce-toolbar__settings-btn) {
    color: var(--ink-2);
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: 7px;
}
.pbe :deep(.ce-toolbar__plus:hover),
.pbe :deep(.ce-toolbar__settings-btn:hover) { background: var(--surface-hover); color: var(--ink); }

/* Editor.js paints a popover on its __container from these variables; the .ce-popover holder stays in the
   DOM while closed, so a box drawn on it shows as a ring beside the + button. */
.pbe :deep(.ce-popover) {
    --width: 300px;
    --border-radius: 11px;
    --color-background: var(--surface);
    --color-border: var(--border);
}
.pbe :deep(.ce-popover__container) { box-shadow: var(--shadow-pop); }
.pbe :deep(.ce-popover-item) { padding: 7px 9px; border-radius: 7px; gap: 9px; }
.pbe :deep(.ce-popover-item:hover:not(.ce-popover-item--disabled)),
.pbe :deep(.ce-popover-item--focused:not(.ce-popover-item--no-hover)) { background: var(--brand-tint) !important; }
.pbe :deep(.ce-popover-item__icon) {
    width: 22px; height: 22px; border-radius: 6px;
    background: rgba(0, 0, 0, .06); color: var(--ink);
    box-shadow: none; margin-right: 0;
}
.pbe :deep(.ce-popover-item[data-item-name="task"] .ce-popover-item__icon),
.pbe :deep(.ce-popover-item[data-item-name="taskList"] .ce-popover-item__icon) { background: var(--brand-tint); color: var(--brand); }
.pbe :deep(.ce-popover-item__title) { font: 500 12.5px/1.2 var(--font-ui); color: var(--ink); }
.pbe :deep(.ce-popover__search) { background: var(--surface-2); border: 1px solid var(--hairline); border-radius: 7px; }
.pbe :deep(.ce-popover__search input) { font: 400 12.5px var(--font-ui); color: var(--ink); }
.pbe :deep(.ce-block--selected .ce-block__content) { background: var(--brand-tint); }

.pbe :deep(.pb-callout) {
    display: flex; gap: 10px; padding: 11px 13px; border-radius: 9px; margin: 6px 0;
    background: var(--warn-bg); color: var(--warn-ink); line-height: 1.6; font-size: 14px;
}
.pbe :deep(.pb-callout--info) { background: var(--brand-tint); color: var(--brand); }
.pbe :deep(.pb-callout--ok) { background: var(--ok-bg); color: var(--ok-ink); }
.pbe :deep(.pb-callout--danger) { background: var(--danger-bg); color: var(--danger-ink); }
.pbe :deep(.pb-callout__icon) { flex: none; display: inline-flex; margin-top: 2px; }
.pbe :deep(.pb-callout__text) { flex: 1; min-width: 0; outline: none; }
.pbe :deep(.pb-callout__text:empty::before),
.pbe :deep(.pb-quote:empty::before),
.pbe :deep(.pb-image__caption:empty::before) { content: attr(data-placeholder); opacity: .55; }
.pbe :deep(.pb-callout__tones) { display: none; gap: 4px; align-self: flex-start; }
.pbe :deep(.pb-callout:hover .pb-callout__tones) { display: inline-flex; }
.pbe :deep(.pb-callout__tone) { width: 12px; height: 12px; border-radius: 50%; border: 1px solid rgba(0, 0, 0, .15); cursor: pointer; padding: 0; }
.pbe :deep(.pb-callout__tone--info) { background: var(--brand); }
.pbe :deep(.pb-callout__tone--warn) { background: var(--warn); }
.pbe :deep(.pb-callout__tone--ok) { background: var(--ok); }
.pbe :deep(.pb-callout__tone--danger) { background: var(--danger); }

.pbe :deep(.pb-quote) {
    margin: 6px 0; padding: 4px 0 4px 14px; border-left: 3px solid var(--brand);
    font: 400 15px/1.65 var(--font-ui); color: var(--ink-2); outline: none;
}
.pbe :deep(.pb-delimiter) { height: 1px; background: var(--hairline); margin: 14px 0; }

.pbe :deep(.pb-image) { margin: 8px 0; }
.pbe :deep(.pb-image img) { max-width: 100%; border-radius: var(--r-input); display: block; }
.pbe :deep(.pb-image__caption) { font: var(--text-small); color: var(--ink-2); margin-top: 6px; outline: none; }
.pbe :deep(.pb-image__form) { display: flex; flex-direction: column; gap: 6px; padding: 12px; border: 1px dashed var(--border); border-radius: var(--r-input); background: var(--surface-2); }
.pbe :deep(.pb-image__form.is-over) { border-color: var(--brand); background: var(--brand-tint); }
.pbe :deep(.pb-image__row) { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.pbe :deep(.pb-image__row .ah-input) { flex: 1 1 180px; min-width: 0; }
.pbe :deep(.pb-image__file) { display: none; }
.pbe :deep(.pb-image__busy) { font: var(--text-small); color: var(--ink-2); }
.pbe :deep(.pb-image__error) { font: var(--text-small); color: var(--danger-ink); }

.pbe :deep(.mention) {
    padding: 0 3px; border-radius: 4px;
    background: var(--brand-tint); color: var(--brand);
    font-weight: 500; overflow-wrap: anywhere; box-decoration-break: clone; -webkit-box-decoration-break: clone;
}
.pbe :deep(.mention[role="link"]) { cursor: pointer; }
.pbe :deep(.mention[role="link"]:hover) { text-decoration: underline; }
.pbe :deep(.mention[role="link"]:focus-visible) { outline: none; box-shadow: var(--focus); }
.pbe :deep(.pb-mention-tool) { font: 600 13px var(--font-ui); color: var(--ink); }

.pbe :deep(.pb-picker) { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border: 1px solid var(--hairline); border-radius: 10px; background: var(--surface-2); margin: 6px 0; }
.pbe :deep(.pb-picker__head) { display: flex; align-items: center; gap: 10px; }
.pbe :deep(.pb-picker__head .ah-label) { flex: 1; }
.pbe :deep(.pb-select) { height: 30px; width: auto; max-width: 220px; font-size: 12.5px; padding: 0 8px; }
.pbe :deep(.pb-picker__results) { display: flex; flex-direction: column; gap: 1px; max-height: 220px; overflow: auto; }
.pbe :deep(.pb-picker__row) { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border: 0; background: transparent; border-radius: 7px; text-align: left; cursor: pointer; font: 400 13px var(--font-ui); color: var(--ink); }
.pbe :deep(.pb-picker__row:hover) { background: var(--surface-hover); }
.pbe :deep(.pb-picker__name) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pbe :deep(.pb-picker__empty) { font: var(--text-small); color: var(--ink-2); padding: 4px 8px; }

.pbe :deep(.pb-task),
.pbe :deep(.pb-tasklist) {
    background: var(--surface-2); border: 1px solid var(--hairline); border-radius: 10px;
    padding: 8px 12px; margin: 6px 0; font-size: 13px;
}
.pbe :deep(.pb-tasklist) { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; }
.pbe :deep(.pb-tasklist__head) { display: flex; align-items: center; gap: 8px; }
.pbe :deep(.pb-tasklist__project) { font-weight: 600; color: var(--ink); }
.pbe :deep(.pb-tasklist__count) { margin-left: auto; }
.pbe :deep(.pb-tasklist__filter) { height: 24px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); font: 500 11.5px var(--font-ui); color: var(--ink); padding: 0 6px; }
.pbe :deep(.pb-tasklist__rows) { display: flex; flex-direction: column; gap: 2px; }
.pbe :deep(.pb-task__row) { display: flex; align-items: center; gap: 9px; min-height: 30px; }
.pbe :deep(.pb-task__row.is-missing) { color: var(--ink-2); }
.pbe :deep(.pb-task__check) { width: 14px; height: 14px; border-radius: 4px; border: 1.5px solid var(--border); display: inline-grid; place-items: center; color: transparent; flex: none; }
.pbe :deep(.pb-task__check svg) { width: 10px; height: 10px; }
.pbe :deep(.pb-task__check.is-done) { background: var(--brand); border-color: var(--brand); color: var(--on-brand); }
.pbe :deep(.pb-task__open) { flex: 1; min-width: 0; text-align: left; border: 0; background: transparent; padding: 0; font: 400 13px/1.4 var(--font-ui); color: var(--ink); cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pbe :deep(.pb-task__open:hover) { color: var(--brand); }
.pbe :deep(.pb-task__open.is-done) { text-decoration: line-through; color: var(--ink-2); }
.pbe :deep(.pb-task__status) { font-size: 11px; height: 20px; }
.pbe :deep(.pb-task__meta) { margin-left: auto; }
</style>
