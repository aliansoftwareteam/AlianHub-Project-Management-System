<template>
    <div class="pbe">
        <div :id="holderId" class="pbe__holder"></div>
    </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import EditorJS from '@editorjs/editorjs';
import HeaderTool from '@editorjs/header';
import List from '@editorjs/nested-list';
import Checklist from '@editorjs/checklist';
import Marker from '@editorjs/marker';
import CodeTool from '@editorjs/code';
import InlineCode from '@editorjs/inline-code';
import Embed from '@editorjs/embed';
import Table from '@editorjs/table';
import pageContent from '@pageContent';
const { contentToEditorData, blocksToHtml, emptyEditorData } = pageContent.default || pageContent;

const { t } = useI18n();

const props = defineProps({
    seed: { type: Object, default: null },
    editorKey: { type: String, default: 'page' },
    readOnly: { type: Boolean, default: false },
});

const emit = defineEmits(['change', 'ready']);

const holderId = `pbe-${props.editorKey}-${Math.random().toString(36).slice(2, 8)}`;
const editor = ref(null);
const ready = ref(false);

const tools = {
    header: { class: HeaderTool, inlineToolbar: true },
    list: { class: List, inlineToolbar: true },
    checklist: { class: Checklist, inlineToolbar: true },
    marker: { class: Marker },
    code: { class: CodeTool, inlineToolbar: true },
    inlineCode: { class: InlineCode, inlineToolbar: true },
    embed: { class: Embed, inlineToolbar: true },
    table: { class: Table, inlineToolbar: true },
};

function seedData() {
    return contentToEditorData(props.seed || {});
}

async function emitChange() {
    if (!editor.value) return;
    const data = await editor.value.save();
    emit('change', { blocks: data, html: blocksToHtml(data) });
}

function initEditor() {
    editor.value = new EditorJS({
        holder: holderId,
        tools,
        data: seedData(),
        readOnly: props.readOnly,
        placeholder: t('Projects.pages_blank_hint'),
        minHeight: 240,
        onChange: () => {
            emitChange();
        },
        onReady: () => {
            ready.value = true;
            emit('ready');
        },
    });
}

async function applyBlocks(payload) {
    if (!editor.value || !payload) return;
    const incoming = contentToEditorData(
        payload.blocks !== undefined ? { blocks: payload.blocks } : payload
    );
    if (payload.mode === 'append') {
        const current = await editor.value.save();
        incoming.blocks = [...(current.blocks || []), ...(incoming.blocks || [])];
    }
    const data = (incoming.blocks && incoming.blocks.length) ? incoming : emptyEditorData();
    await editor.value.render(data);
    await emitChange();
}

defineExpose({ applyBlocks, emitChange });

onMounted(() => {
    initEditor();
});

watch(() => props.editorKey, async () => {
    if (editor.value && editor.value.destroy) {
        await editor.value.destroy();
        editor.value = null;
        ready.value = false;
    }
    initEditor();
});

onBeforeUnmount(() => {
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
    padding: 8px 8px 24px;
}
.pbe__holder {
    min-height: 240px;
}
.pbe :deep(.codex-editor__redactor) {
    padding-bottom: 48px !important;
}
.pbe :deep(.ce-block__content),
.pbe :deep(.ce-toolbar__content) {
    max-width: 720px;
}
.pbe :deep(.ce-header) {
    font-family: var(--kiln-font-display);
    font-weight: 650;
    letter-spacing: -0.03em;
    color: var(--kiln-ink);
}
.pbe :deep(.ce-paragraph) {
    font-family: var(--kiln-font-body);
    font-size: 16.5px;
    line-height: 1.65;
    color: var(--kiln-text);
}
.pbe :deep(.ce-toolbar__plus),
.pbe :deep(.ce-toolbar__settings-btn) {
    color: var(--kiln-ember);
    background: var(--kiln-paper-2);
    border-color: var(--kiln-line);
}
.pbe :deep(.ce-popover) {
    border-color: var(--kiln-line);
    box-shadow: var(--kiln-shadow);
}
</style>
