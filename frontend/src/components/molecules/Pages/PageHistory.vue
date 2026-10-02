<template>
    <section ref="dialogEl" class="ph" role="dialog" aria-modal="true" :aria-labelledby="titleId" tabindex="-1">
        <header class="ph__head">
            <button v-if="pane === 'detail'" type="button" class="ph__icon ph__back" :title="$t('Docs.history_back')" :aria-label="$t('Docs.history_back')" @click="backToList">
                <ShellIcon name="arrowLeft" :size="15" />
            </button>
            <h2 :id="titleId" class="ph__title">{{ $t('Docs.history_title') }}</h2>
            <button type="button" class="ph__icon ph__close" :title="$t('Docs.close')" :aria-label="$t('Docs.close')" @click="emit('close')">
                <ShellIcon name="x" :size="15" />
            </button>
        </header>

        <div class="ph__body" :class="`ph__body--${pane}`">
            <div class="ph__side">
                <form v-if="!readOnly" class="ph__save" @submit.prevent="saveVersion">
                    <input
                        v-model="saveName"
                        type="text"
                        class="ah-input ph__save-name"
                        :maxlength="NAME_MAX"
                        :placeholder="$t('Docs.history_name_placeholder')"
                        :aria-label="$t('Docs.history_name_label')"
                    />
                    <button type="submit" class="ah-btn ah-btn--sm ah-btn--primary" :disabled="busy">{{ $t('Docs.history_save_version') }}</button>
                </form>
                <p v-if="loading" class="ph__empty" role="status">{{ $t('Docs.history_loading') }}</p>
                <p v-else-if="!versions.length" class="ph__empty">{{ $t('Docs.history_empty') }}</p>
                <ul v-else ref="listEl" class="ph__list ah-scroll" :aria-label="$t('Docs.history_versions')" @keydown="onListKeydown">
                    <li v-for="version in versions" :key="version._id">
                        <button
                            type="button"
                            class="ph__item"
                            :class="{ 'is-active': version._id === selectedId }"
                            :aria-current="version._id === selectedId ? 'true' : undefined"
                            @click="open(version._id)"
                        >
                            <span v-if="version.name" class="ph__name">{{ version.name }}</span>
                            <span class="ph__when">{{ dateTime(version.savedAt) }}</span>
                            <span class="ph__who">
                                <span class="ah-avatar ah-avatar--sm" aria-hidden="true">{{ initials(nameOf(version.savedBy)) }}</span>
                                {{ nameOf(version.savedBy) }}
                            </span>
                            <span class="ph__why">{{ $t(reasonKey(version.reason)) }}</span>
                            <span v-if="version.visibility === 'private'" class="ah-chip ah-chip--warn ah-chip--sm ph__private">
                                <ShellIcon name="lock" :size="10" />{{ $t('Docs.history_private_time') }}
                            </span>
                        </button>
                    </li>
                </ul>
            </div>

            <div v-if="selected" ref="detailEl" class="ph__detail" role="region" tabindex="-1" :aria-labelledby="detailId">
                <div class="ph__detail-head">
                    <div class="ph__detail-copy">
                        <h3 :id="detailId" class="ph__detail-title">{{ (selectedBody && selectedBody.title) || selected.title || $t('Docs.untitled') }}</h3>
                        <p class="ph__detail-meta">
                            <span class="ah-chip ah-chip--sm">{{ $t('Docs.history_read_only') }}</span>
                            <span v-if="selected.name" class="ph__name">{{ selected.name }}</span>
                            <span>{{ nameOf(selected.savedBy) }}</span>
                            <span>{{ dateTime(selected.savedAt) }}</span>
                        </p>
                    </div>
                    <form v-if="renaming" class="ph__name-form" @submit.prevent="submitName">
                        <input
                            ref="nameEl"
                            v-model="nameDraft"
                            type="text"
                            class="ah-input ph__name-input"
                            :maxlength="NAME_MAX"
                            :placeholder="$t('Docs.history_name_placeholder')"
                            :aria-label="$t('Docs.history_name_label')"
                            @keydown.esc.stop.prevent="renaming = false"
                        />
                        <button type="submit" class="ah-btn ah-btn--sm ah-btn--primary" :disabled="busy">{{ $t('Docs.history_name_save') }}</button>
                        <button type="button" class="ah-btn ah-btn--sm ah-btn--ghost" @click="renaming = false">{{ $t('Docs.comment_cancel') }}</button>
                    </form>
                    <div v-else-if="!readOnly" class="ph__tools">
                        <button type="button" class="ah-btn ah-btn--sm ah-btn--secondary ph__rename" @click="startRename">{{ $t('Docs.history_name_this') }}</button>
                        <button type="button" class="ah-btn ah-btn--sm ah-btn--primary ph__restore" :disabled="busy" @click="restore">
                            <ShellIcon name="restore" :size="13" />{{ $t('Docs.history_restore') }}
                        </button>
                    </div>
                </div>

                <div class="ph__compare-row">
                    <span :id="compareId" class="ph__label">{{ $t('Docs.history_compare_label') }}</span>
                    <div class="ah-tabs ph__compare" role="group" :aria-labelledby="compareId">
                        <button
                            v-for="option in COMPARE"
                            :key="option.id"
                            type="button"
                            class="ah-tab"
                            :class="{ 'is-active': compare === option.id }"
                            :aria-pressed="compare === option.id"
                            :data-compare="option.id"
                            @click="compare = option.id"
                        >{{ $t(option.label) }}</button>
                    </div>
                </div>

                <p class="ph__summary" role="status">{{ summaryText }}</p>
                <p v-if="titleWords" class="ph__retitle">
                    <span class="ph__mark">{{ $t('Docs.history_title_changed') }}</span>
                    <template v-for="(segment, at) in titleWords" :key="at">
                        <del v-if="segment.kind === 'removed'">{{ segment.text }}</del>
                        <ins v-else-if="segment.kind === 'added'">{{ segment.text }}</ins>
                        <span v-else>{{ segment.text }}</span>
                    </template>
                </p>

                <div ref="blocksEl" class="ph__blocks ah-scroll" @click="onMentionClick" @keydown="onMentionKeydown">
                    <div v-for="(row, at) in rows" :key="at" class="ph__block" :class="`ph__block--${row.kind}`">
                        <span v-if="row.kind !== 'same'" class="ph__mark">{{ $t(MARK[row.kind]) }}</span>
                        <p v-if="row.kind === 'changed' && row.textChanged" class="ph__words">
                            <template v-for="(segment, i) in row.words" :key="i">
                                <del v-if="segment.kind === 'removed'">{{ segment.text }}</del>
                                <ins v-else-if="segment.kind === 'added'">{{ segment.text }}</ins>
                                <span v-else>{{ segment.text }}</span>
                            </template>
                        </p>
                        <template v-else-if="row.kind === 'changed'">
                            <!-- blockHtml sanitizes: a version's markup is never trusted. -->
                            <div class="ph__html ph__html--before" v-html="blockHtml(row.before)"></div>
                            <div class="ph__html" v-html="blockHtml(row.after)"></div>
                        </template>
                        <div v-else class="ph__html" v-html="blockHtml(row.after || row.before)"></div>
                    </div>
                </div>
            </div>
        </div>

        <ConfirmModal
            id="doc-history-restore"
            :modelValue="Boolean(restoreQuestion)"
            :title="$t('Docs.history_restore')"
            :acceptButtonText="$t('Docs.history_restore')"
            @accept="confirmRestore"
            @close="restoreQuestion = ''"
        >
            <template #body>
                <p class="ph__confirm">{{ restoreQuestion ? $t(restoreQuestion) : '' }}</p>
            </template>
        </ConfirmModal>
    </section>
</template>

<script setup>
import { computed, inject, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToast } from 'vue-toast-notification';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';
import ConfirmModal from '@/components/atom/Modal/Modal.vue';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { useCustomComposable, useGetterFunctions } from '@/composable';
import { useFocusTrap } from '@/composable/useFocusTrap';
import pageContent from '@pageContent';
import { richHtml } from '@/utils/richHtml';
import { initials } from './docsFormat';
import { decorateMentions } from './docMentions';
import { hydrateDocImages } from './docImages';
import { useMentionLinks } from './useMentionLinks';
import { diffBlocks, diffSummary, diffWords } from './pageDiff';

const { blocksToHtml, escapeHtml, TASK_TOKEN_PATTERN } = pageContent.default || pageContent;

defineOptions({ name: 'PageHistory' });

const props = defineProps({
    pageId: { type: String, required: true },
    currentTitle: { type: String, default: '' },
    currentBlocks: { type: Array, default: () => [] },
    docPrivate: { type: Boolean, default: false },
    readOnly: { type: Boolean, default: false },
    savePending: { type: Function, default: () => Promise.resolve(true) },
    beforeRestore: { type: Function, default: () => true },
});

const emit = defineEmits(['close', 'restored']);

const NAME_MAX = 80;
const PHONE_WIDTH = 767;
const COMPARE = [
    { id: 'previous', label: 'Docs.history_compare_previous' },
    { id: 'current', label: 'Docs.history_compare_current' },
];
const MARK = { added: 'Docs.history_added', removed: 'Docs.history_removed', changed: 'Docs.history_changed' };
const REASONS = ['author', 'interval', 'rewrite', 'restore', 'manual'];

const { t } = useI18n();
const $toast = useToast();
const { getUser } = useGetterFunctions();
const { getWasabiImageLink } = useCustomComposable();
const companyId = inject('$companyId', ref(''));
const clientWidth = inject('$clientWidth', ref(1280));

const uid = Math.random().toString(36).slice(2, 8);
const titleId = `ph-title-${uid}`;
const compareId = `ph-compare-${uid}`;
const detailId = `ph-detail-${uid}`;

const dialogEl = ref(null);
const listEl = ref(null);
const detailEl = ref(null);
const blocksEl = ref(null);
const nameEl = ref(null);
const versions = ref([]);
const bodies = ref({});
const loading = ref(true);
const busy = ref(false);
const selectedId = ref('');
const compare = ref('previous');
const pane = ref('list');
const saveName = ref('');
const renaming = ref(false);
const restoreQuestion = ref('');
const nameDraft = ref('');

useFocusTrap(dialogEl, ref(true));
const { onMentionClick, onMentionKeydown } = useMentionLinks({ beforeLeave: () => props.beforeRestore() });

const selected = computed(() => versions.value.find((version) => version._id === selectedId.value) || null);
const selectedBody = computed(() => bodies.value[selectedId.value] || null);
const previous = computed(() => {
    const at = versions.value.findIndex((version) => version._id === selectedId.value);
    return at === -1 ? null : (versions.value[at + 1] || null);
});
const previousBody = computed(() => (previous.value ? bodies.value[previous.value._id] || null : null));
const isFirst = computed(() => compare.value === 'previous' && !previous.value);

/* Older side first, so a removed word is one the newer side no longer has. */
const sides = computed(() => {
    const body = selectedBody.value;
    if (!body || body.missing) return null;
    if (compare.value === 'current') return { before: body, after: { title: props.currentTitle, blocks: props.currentBlocks } };
    if (!previous.value) return { before: body, after: body };
    return previousBody.value && !previousBody.value.missing ? { before: previousBody.value, after: body } : null;
});

const rows = computed(() => (sides.value ? diffBlocks(sides.value.before.blocks, sides.value.after.blocks) : []));
const titleWords = computed(() => {
    if (!sides.value || sides.value.before.title === sides.value.after.title) return null;
    return diffWords(sides.value.before.title, sides.value.after.title);
});
const summaryText = computed(() => {
    if (selectedBody.value && selectedBody.value.missing) return t('Docs.history_unavailable');
    if (!sides.value) return t('Docs.history_loading');
    if (isFirst.value) return t('Docs.history_first');
    const counts = diffSummary(rows.value);
    if (!counts.added && !counts.removed && !counts.changed && !titleWords.value) return t('Docs.history_no_changes');
    return t('Docs.history_summary', counts);
});

const nameOf = (id) => getUser(String(id))?.Employee_Name || t('Docs.comment_someone');
const personName = (id) => {
    const user = getUser(String(id));
    return user && !user.ghostUser ? user.Employee_Name : '';
};
const reasonKey = (reason) => `Docs.history_reason_${REASONS.includes(reason) ? reason : 'legacy'}`;

function dateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const blockHtml = (block) => richHtml(blocksToHtml([block]).replace(TASK_TOKEN_PATTERN, (token, taskId, taskKey) => escapeHtml(taskKey)));

watch(rows, () => nextTick(() => {
    decorateMentions(blocksEl.value, { labelOf: personName });
    hydrateDocImages(blocksEl.value, (key) => getWasabiImageLink(companyId.value, key));
}), { flush: 'post' });

const base = () => `${env.PAGES}/${props.pageId}/versions`;
const failed = (response) => $toast.error(response?.data?.statusText || t('Toast.something_went_wrong'), { position: 'top-right' });

async function fetchBody(id) {
    if (!id || bodies.value[id]) return;
    try {
        const response = await apiRequest('get', `${base()}/${id}`);
        bodies.value = { ...bodies.value, [id]: response.data?.status ? response.data.data : { missing: true } };
    } catch (error) {
        console.error('ERROR in open doc version: ', error);
        bodies.value = { ...bodies.value, [id]: { missing: true } };
    }
}

async function select(id) {
    selectedId.value = id;
    renaming.value = false;
    const at = versions.value.findIndex((version) => version._id === id);
    const before = at === -1 ? null : versions.value[at + 1];
    await Promise.all([fetchBody(id), fetchBody(before && before._id)]);
}

async function open(id) {
    pane.value = 'detail';
    await select(id);
    if (clientWidth.value <= PHONE_WIDTH && detailEl.value) detailEl.value.focus();
}

function backToList() {
    pane.value = 'list';
    nextTick(() => {
        const current = listEl.value && listEl.value.querySelector('.ph__item[aria-current="true"]');
        if (current) current.focus();
    });
}

function onListKeydown(event) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = Array.from(listEl.value.querySelectorAll('.ph__item'));
    const next = items[items.indexOf(document.activeElement) + (event.key === 'ArrowDown' ? 1 : -1)];
    if (!next) return;
    event.preventDefault();
    next.focus();
}

async function load(preferId = '') {
    loading.value = true;
    try {
        const response = await apiRequest('get', base());
        if (response.data?.status) versions.value = response.data.data || [];
        else failed(response);
    } catch (error) {
        console.error('ERROR in load doc versions: ', error);
    } finally {
        loading.value = false;
    }
    const wanted = [preferId, selectedId.value].find((id) => id && versions.value.some((version) => version._id === id));
    const first = wanted || (versions.value[0] && versions.value[0]._id) || '';
    if (first) await select(first);
    else selectedId.value = '';
}

async function write(method, url, body) {
    busy.value = true;
    try {
        const response = await apiRequest(method, url, body);
        if (response.data?.status) return response.data.data || {};
        failed(response);
        return null;
    } catch (error) {
        console.error('ERROR in doc version write: ', error);
        failed(error?.response);
        return null;
    } finally {
        busy.value = false;
    }
}

async function saveVersion() {
    if (busy.value) return;
    if (!(await props.savePending())) return;
    const saved = await write('post', base(), { name: saveName.value.trim() });
    if (!saved) return;
    saveName.value = '';
    $toast.success(t('Docs.history_saved'), { position: 'top-right' });
    await load(saved._id);
}

function startRename() {
    if (!selected.value) return;
    nameDraft.value = selected.value.name || '';
    renaming.value = true;
    nextTick(() => nameEl.value && nameEl.value.focus());
}

async function submitName() {
    if (!selected.value || busy.value) return;
    const id = selected.value._id;
    const saved = await write('put', `${base()}/${id}`, { name: nameDraft.value.trim() });
    if (!saved) return;
    versions.value = versions.value.map((version) => (version._id === id ? { ...version, name: saved.name || '' } : version));
    renaming.value = false;
    $toast.success(t('Docs.history_named'), { position: 'top-right' });
}

function restore() {
    if (!selected.value || busy.value) return;
    const goesPublic = selected.value.visibility === 'private' && !props.docPrivate;
    restoreQuestion.value = goesPublic ? 'Docs.history_restore_private_confirm' : 'Docs.history_restore_confirm';
}

async function confirmRestore() {
    restoreQuestion.value = '';
    if (!selected.value || busy.value) return;
    if (!(await props.beforeRestore())) return;
    const page = await write('post', `${base()}/${selected.value._id}/restore`);
    if (!page) return;
    $toast.success(t('Docs.history_restored'), { position: 'top-right' });
    emit('restored', page);
}

watch(() => props.pageId, () => {
    restoreQuestion.value = '';
    versions.value = [];
    bodies.value = {};
    selectedId.value = '';
    pane.value = 'list';
    load();
}, { immediate: true });
</script>

<style scoped>
.ph {
    position: absolute; inset: 0; z-index: 30;
    display: flex; flex-direction: column; min-height: 0;
    background: var(--surface); color: var(--ink);
    font-family: var(--font-ui);
    outline: none;
}
.ph__head { display: flex; align-items: center; gap: 8px; padding: 12px 20px; border-bottom: 1px solid var(--hairline); flex: none; }
.ph__title { margin: 0; flex: 1 1 auto; min-width: 0; font: 600 16px/1.3 var(--font-ui); }
.ph__icon {
    width: 32px; height: 32px; flex: none; border: 0; border-radius: 7px; padding: 0;
    background: transparent; color: var(--ink-2); cursor: pointer;
    display: inline-flex; align-items: center; justify-content: center;
}
.ph__icon:hover { background: var(--surface-hover); color: var(--ink); }
.ph__back { display: none; }

.ph__body { flex: 1 1 auto; min-height: 0; display: flex; }
.ph__side {
    width: 300px; flex: none; min-height: 0; display: flex; flex-direction: column;
    border-right: 1px solid var(--hairline); background: var(--surface-2);
}
.ph__save { display: flex; gap: 6px; padding: 12px; border-bottom: 1px solid var(--hairline); flex: none; }
.ph__save-name { flex: 1 1 auto; min-width: 0; height: 30px; font-size: 12.5px; }
.ph__empty { margin: 0; padding: 16px 14px; font: var(--text-small); color: var(--ink-2); }
.ph__confirm { margin: 0; max-width: 46ch; font: var(--text-body); line-height: 1.5; color: var(--ink); }
.ph__list { list-style: none; margin: 0; padding: 8px; flex: 1 1 auto; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
.ph__item {
    width: 100%; border: 1px solid transparent; border-radius: 9px; padding: 9px 10px; background: transparent;
    display: flex; flex-direction: column; align-items: flex-start; gap: 3px;
    font: 400 12.5px/1.4 var(--font-ui); color: var(--ink-2); text-align: left; cursor: pointer;
}
.ph__item:hover { background: var(--surface-hover); }
.ph__item.is-active { background: var(--surface); border-color: var(--brand); }
.ph__name { font-weight: 600; color: var(--ink); overflow-wrap: anywhere; }
.ph__when { color: var(--ink); font-weight: 500; }
.ph__who { display: inline-flex; align-items: center; gap: 6px; min-width: 0; overflow-wrap: anywhere; }
.ph__why { font: var(--text-small); color: var(--ink-2); }
.ph__private { gap: 4px; }

.ph__detail { flex: 1 1 auto; min-width: 0; min-height: 0; display: flex; flex-direction: column; gap: 10px; padding: 16px 20px 0; outline: none; }
.ph__detail-head { display: flex; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
.ph__detail-copy { flex: 1 1 260px; min-width: 0; }
.ph__detail-title { margin: 0 0 4px; font: 700 20px/1.25 var(--font-ui); letter-spacing: -.3px; overflow-wrap: anywhere; }
.ph__detail-meta { margin: 0; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12.5px; color: var(--ink-2); }
.ph__tools, .ph__name-form { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.ph__name-input { width: 220px; max-width: 100%; height: 30px; font-size: 12.5px; }

.ph__compare-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ph__label { font-size: 12px; color: var(--ink-label); }
.ph__summary { margin: 0; font: var(--text-small); color: var(--ink-2); }
.ph__retitle { margin: 0; display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; font-size: 13px; }

.ph__blocks { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 4px 0 32px; display: flex; flex-direction: column; gap: 6px; max-width: 820px; }
.ph__block { border-left: 3px solid transparent; border-radius: 0 8px 8px 0; padding: 4px 12px; }
.ph__block--added { border-left-color: var(--ok); background: var(--ok-bg); }
.ph__block--removed { border-left-color: var(--danger); background: var(--danger-bg); }
.ph__block--changed { border-left-color: var(--warn); background: var(--surface-2); }
.ph__mark { display: inline-block; font: 600 10.5px/1.6 var(--font-ui); letter-spacing: .4px; text-transform: uppercase; color: var(--ink-2); }
.ph__block--added .ph__mark { color: var(--ok-ink); }
.ph__block--removed .ph__mark { color: var(--danger-ink); }
.ph__block--changed .ph__mark { color: var(--warn-ink); }
.ph__words { margin: 0; font: 400 15px/1.7 var(--font-ui); white-space: pre-wrap; overflow-wrap: anywhere; }
.ph ins { background: var(--ok-bg); color: var(--ok-ink); text-decoration: underline; border-radius: 3px; }
.ph del { background: var(--danger-bg); color: var(--danger-ink); text-decoration: line-through; border-radius: 3px; }
.ph__html { font: 400 15px/1.7 var(--font-ui); color: var(--ink); overflow-wrap: anywhere; }
.ph__html--before { opacity: .7; border-bottom: 1px dashed var(--border); margin-bottom: 6px; padding-bottom: 6px; }
.ph__html :deep(h1) { font: 600 24px/1.2 var(--font-ui); letter-spacing: -.5px; margin: 8px 0 4px; }
.ph__html :deep(h2) { font: 600 17px/1.3 var(--font-ui); margin: 6px 0 4px; }
.ph__html :deep(h3) { font: 600 14.5px/1.3 var(--font-ui); margin: 6px 0 4px; }
.ph__html :deep(p) { margin: 0; }
.ph__html :deep(ul), .ph__html :deep(ol) { margin: 0; padding-left: 20px; }
.ph__html :deep(aside) { padding: 9px 12px; border-radius: 9px; background: var(--warn-bg); color: var(--warn-ink); }
.ph__html :deep(aside.callout--info) { background: var(--brand-tint); color: var(--brand); }
.ph__html :deep(aside.callout--ok) { background: var(--ok-bg); color: var(--ok-ink); }
.ph__html :deep(aside.callout--danger) { background: var(--danger-bg); color: var(--danger-ink); }
.ph__html :deep(pre) { font: 400 12.5px/1.6 var(--font-mono); background: var(--surface-2); padding: 10px 12px; border-radius: var(--r-input); overflow: auto; margin: 0; }
.ph__html :deep(blockquote) { margin: 0; padding-left: 14px; border-left: 3px solid var(--brand); color: var(--ink-2); }
.ph__html :deep(table) { border-collapse: collapse; display: block; max-width: 100%; overflow-x: auto; }
.ph__html :deep(td) { border: 1px solid var(--hairline); padding: 6px 10px; }
.ph__html :deep(figure) { margin: 0; }
.ph__html :deep(img) { max-width: 100%; border-radius: var(--r-input); }
.ph__html :deep(figcaption) { font: var(--text-small); color: var(--ink-2); }
.ph__html :deep(hr) { border: 0; height: 1px; background: var(--hairline); margin: 8px 0; }
.ph__html :deep(.mention) {
    padding: 0 3px; border-radius: 4px; background: var(--brand-tint); color: var(--brand);
    font-weight: 500; overflow-wrap: anywhere; box-decoration-break: clone; -webkit-box-decoration-break: clone;
}
.ph__html :deep(.mention[role="link"]) { cursor: pointer; }
.ph__html :deep(.mention[role="link"]:focus-visible) { outline: none; box-shadow: var(--focus); }

@media (max-width: 767px) {
    .ph { position: fixed; z-index: 60; padding-bottom: env(safe-area-inset-bottom); }
    .ph__head { padding: 10px 12px; }
    .ph__icon { width: 44px; height: 44px; }
    .ph__body--detail .ph__side, .ph__body--list .ph__detail { display: none; }
    .ph__back { display: inline-flex; }
    .ph__side { width: auto; flex: 1 1 auto; border-right: 0; }
    .ph__item { padding: 12px; min-height: 44px; }
    .ph__detail { padding: 12px 16px 0; }
    .ph__tools .ah-btn, .ph__name-form .ah-btn, .ph__save .ah-btn { height: 40px; }
    .ph__save-name, .ph__name-input { height: 40px; font-size: 16px; }
    .ph__name-input { width: 100%; }
}
</style>
