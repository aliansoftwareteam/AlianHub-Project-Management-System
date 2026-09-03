<template>
    <div class="pd" :class="`pd--${layout}`">
        <template v-if="page">
            <div v-if="needsAttention" class="pd__banner" :class="`pd__banner--${reviewStateValue}`">
                <ShellIcon name="alert" :size="14" />
                <span class="pd__banner-text">{{ $t('DocsV2.stale_banner') }}</span>
                <button type="button" class="ah-btn ah-btn--sm ah-btn--secondary" @click="markReviewed">{{ $t('DocsV2.mark_reviewed') }}</button>
            </div>

            <div class="pd__head">
                <div class="pd__title-row">
                    <input v-model="draftTitle" type="text" class="pd__title" :placeholder="$t('DocsV2.untitled')" />
                    <div class="pd__actions">
                        <div class="ah-tabs">
                            <button type="button" class="ah-tab" :class="{ 'is-active': mode === 'edit' }" @click="openEditor">{{ $t('DocsV2.edit') }}</button>
                            <button type="button" class="ah-tab" :class="{ 'is-active': mode === 'preview' }" @click="openPreview">{{ $t('DocsV2.preview') }}</button>
                        </div>
                        <button v-if="projectId" type="button" class="ah-btn ah-btn--sm ah-btn--secondary" @click="showLinker = !showLinker">
                            <ShellIcon name="link" :size="13" />{{ $t('DocsV2.link_tasks') }}
                            <span v-if="linkedTasks.length" class="pd__count">{{ linkedTasks.length }}</span>
                        </button>
                        <template v-if="layout === 'panel'">
                            <button type="button" class="ah-btn ah-btn--sm ah-btn--secondary" @click="present">
                                <ShellIcon name="play" :size="11" />{{ $t('DocsV2.present') }}
                            </button>
                            <button type="button" class="ah-btn ah-btn--sm ah-btn--secondary" @click="openShare">
                                <ShellIcon name="share" :size="13" />{{ $t('DocsV2.share') }}
                            </button>
                        </template>
                        <button type="button" class="ah-btn ah-btn--sm ah-btn--primary" :disabled="!isDirty || isSaving" @click="savePage">
                            {{ isSaving ? $t('DocsV2.saving') : $t('DocsV2.save') }}
                        </button>
                        <button type="button" class="pd__icon pd__icon--danger" :title="$t('DocsV2.delete')" @click="deletePage">
                            <ShellIcon name="trash" :size="15" />
                        </button>
                        <button v-if="closable" type="button" class="pd__icon" :title="$t('DocsV2.close')" @click="requestClose">
                            <ShellIcon name="x" :size="15" />
                        </button>
                    </div>
                </div>

                <div class="pd__props">
                    <label class="pd__prop">
                        <span class="pd__k">{{ $t('DocsV2.owner') }}</span>
                        <select class="pd__select" :value="page.ownerId || ''" @change="setOwner($event.target.value)">
                            <option value="">{{ $t('DocsV2.no_owner') }}</option>
                            <option v-for="user in users" :key="'own-' + user._id" :value="user._id">{{ user.Employee_Name }}</option>
                        </select>
                    </label>
                    <span class="pd__prop">
                        <span class="pd__k">{{ $t('DocsV2.project') }}</span>
                        <span class="ah-chip">{{ projectName }}</span>
                    </span>
                    <button type="button" class="pd__prop pd__prop--btn" :title="isPrivate ? $t('Projects.doc_private_hint') : $t('Projects.doc_shared_hint')" @click="togglePrivate">
                        <span class="pd__k">{{ $t('DocsV2.visibility') }}</span>
                        <span class="ah-chip" :class="{ 'ah-chip--warn': isPrivate }">
                            <ShellIcon :name="isPrivate ? 'lock' : 'members'" :size="11" />{{ isPrivate ? $t('DocsV2.private') : $t('DocsV2.shared') }}
                        </span>
                    </button>
                    <label class="pd__prop" :title="$t('DocsV2.wiki_toggle_hint')">
                        <input type="checkbox" class="ah-check" :checked="isWiki" @change="toggleWiki($event.target.checked)" />
                        <span class="pd__k pd__k--strong">{{ $t('DocsV2.wiki_page') }}</span>
                    </label>
                    <label v-if="isWiki" class="pd__prop">
                        <span class="pd__k">{{ $t('DocsV2.review_date') }}</span>
                        <input type="date" class="pd__date" :value="toDateInput(page.reviewDate)" @change="setReviewDate($event.target.value)" />
                    </label>
                    <span v-if="linkedTasks.length" class="pd__prop pd__prop--wrap">
                        <span class="pd__k">{{ $t('DocsV2.linked_to') }}</span>
                        <span v-for="task in linkedTasks" :key="'lt-' + task.id" class="ah-chip ah-chip--brand ah-chip--mono">
                            {{ task.key || task.id.slice(-6) }}
                            <button type="button" class="pd__unlink" :title="$t('DocsV2.unlink')" @click="unlinkTask(task.id)">✕</button>
                        </span>
                    </span>
                    <span class="pd__prop pd__prop--muted">
                        <span class="ah-dot" :class="isDirty ? 'ah-dot--warn' : 'ah-dot--ok'"></span>
                        {{ isDirty ? $t('DocsV2.unsaved') : $t('DocsV2.updated', { when: relativeTime(page.updatedAt, t) }) }}
                    </span>
                </div>

                <div v-if="isWiki" class="pd__review">
                    <span class="ah-chip" :class="reviewChipClass(reviewStateValue)">
                        <ShellIcon v-if="reviewStateValue === 'verified'" name="check" :size="11" />
                        <span v-else class="ah-dot" :class="reviewStateValue === 'stale' ? 'ah-dot--danger' : 'ah-dot--warn'"></span>
                        {{ $t(reviewLabelKey(reviewStateValue)) }}
                    </span>
                    <span class="pd__review-text">{{ reviewLine }}</span>
                    <button v-if="!needsAttention" type="button" class="ah-btn ah-btn--sm ah-btn--ghost" @click="markReviewed">{{ $t('DocsV2.mark_reviewed') }}</button>
                </div>

                <TaskChipPicker
                    v-if="showLinker && projectId"
                    class="pd__linker"
                    :project-id="projectId"
                    @pick="linkTask"
                    @close="showLinker = false"
                />
            </div>

            <div class="pd__body">
                <PageBlockEditor
                    v-if="mode === 'edit'"
                    :key="editorKey"
                    ref="blockEditor"
                    :seed="editorSeed"
                    :editor-key="editorKey"
                    :project-id="projectId"
                    @change="onBlockChange"
                    @ready="onEditorReady"
                />
                <div v-else class="pd__preview ah-scroll" v-html="previewHtml"></div>
            </div>

            <PageComposeRail
                v-if="mode === 'edit'"
                ref="composeRail"
                :page-id="String(page._id)"
                :title="draftTitle"
                :current-text="rawDraft"
                @apply="onComposeApply"
            />

            <div v-if="showShare" class="pd__share-back" @click.self="showShare = false">
                <div class="ah-card pd__share">
                    <div class="ah-card__head">
                        <h3 class="ah-h3">{{ $t('Projects.doc_share_title') }}</h3>
                        <button type="button" class="pd__icon" :title="$t('DocsV2.close')" @click="showShare = false"><ShellIcon name="x" :size="15" /></button>
                    </div>
                    <div class="ah-card__body pd__share-body">
                        <p class="pd__share-sub"><ShellIcon name="docs" :size="14" /><b>{{ draftTitle || $t('DocsV2.untitled') }}</b></p>
                        <div class="pd__share-row">
                            <ShellIcon :name="isPrivate ? 'lock' : 'members'" :size="16" class="pd__share-ico" />
                            <div class="pd__share-copy">
                                <div class="pd__share-label">{{ isPrivate ? $t('DocsV2.private') : $t('DocsV2.shared') }}</div>
                                <div class="ah-small">{{ isPrivate ? $t('Projects.doc_private_hint') : $t('Projects.doc_shared_hint') }}</div>
                            </div>
                            <button type="button" class="pd__switch" :class="{ 'is-on': !isPrivate }" @click="togglePrivate"><i></i></button>
                        </div>
                        <div class="pd__share-row">
                            <ShellIcon name="globe" :size="16" class="pd__share-ico" />
                            <div class="pd__share-copy">
                                <div class="pd__share-label">{{ $t('Projects.doc_public_link') }}</div>
                                <div class="ah-small">{{ isPrivate ? $t('Projects.doc_public_needs_shared') : $t('Projects.doc_public_link_hint') }}</div>
                            </div>
                            <button type="button" class="pd__switch" :class="{ 'is-on': isPublic }" :disabled="isPrivate || isSharing" @click="togglePublicLink"><i></i></button>
                        </div>
                        <template v-if="isPublic">
                            <input class="ah-input pd__share-url" type="text" readonly :value="shareUrl" @focus="$event.target.select()" />
                            <button type="button" class="ah-btn ah-btn--primary ah-btn--block" @click="copyShareLink">{{ $t('Projects.doc_copy_public_link') }}</button>
                        </template>
                    </div>
                </div>
            </div>

            <PagePresenter
                v-if="presenting"
                :title="draftTitle"
                :blocks="contentBlocks"
                :project-name="projectName"
                @close="presenting = false"
            />
        </template>
        <div v-else-if="loadFailed" class="pd__missing">
            <div class="ah-empty">{{ $t('DocsV2.page_missing') }}</div>
        </div>
    </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useToast } from 'vue-toast-notification';
import { useI18n } from 'vue-i18n';
import { useStore } from 'vuex';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';
import TaskChipPicker from '@/components/molecules/Pages/TaskChipPicker.vue';
import PageBlockEditor from '@/components/molecules/Pages/PageBlockEditor.vue';
import PageComposeRail from '@/components/molecules/Pages/PageComposeRail.vue';
import PagePresenter from '@/components/molecules/Pages/PagePresenter.vue';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { useGetterFunctions } from '@/composable';
import pageContent from '@pageContent';
import { relativeTime, shortDate, toDateInput, reviewChipClass, reviewLabelKey, headingsOf } from './docsFormat';

const { contentToEditorData, blocksToRawText, TASK_TOKEN_PATTERN } = pageContent.default || pageContent;

defineOptions({ name: 'PageDocument' });

const { t } = useI18n();
const $toast = useToast();
const store = useStore();
const { getUser } = useGetterFunctions();

const props = defineProps({
    pageId: { type: String, default: '' },
    projectData: { type: Object, default: () => ({}) },
    layout: { type: String, default: 'panel' },
    closable: { type: Boolean, default: false },
});

const emit = defineEmits(['loaded', 'saved', 'deleted', 'close', 'outline', 'dirty']);

const page = ref(null);
const loadFailed = ref(false);
const draftTitle = ref('');
const contentHtml = ref('');
const contentBlocks = ref(null);
const savedSnapshot = ref({ title: '', html: '' });
const isSaving = ref(false);
const blockEditor = ref(null);
const composeRail = ref(null);
const editorSeed = ref(null);
const editorKey = ref('');
const baselinePending = ref(false);
const mode = ref('edit');
const previewHtml = ref('');
const showLinker = ref(false);
const linkedTasks = ref([]);
const isPrivate = ref(false);
const showShare = ref(false);
const share = ref(null);
const isSharing = ref(false);
const presenting = ref(false);

const projectId = computed(() => String((props.projectData && props.projectData._id) || (page.value && page.value.ProjectID) || ''));
const projectName = computed(() => {
    if (props.projectData && props.projectData.ProjectName) return props.projectData.ProjectName;
    const all = store.getters['projectData/allProjects'];
    const found = ((all && all.data) || []).find((p) => String(p._id) === projectId.value);
    return found ? found.ProjectName : t('DocsV2.workspace');
});
const users = computed(() => (store.getters['users/users'] || []).filter((u) => u && u.Employee_Name));
const rawDraft = computed(() => blocksToRawText(contentBlocks.value) || contentHtml.value || '');
const isWiki = computed(() => Boolean(page.value && page.value.isWiki));
const reviewStateValue = computed(() => (page.value && page.value.reviewState) || 'none');
const needsAttention = computed(() => isWiki.value && (reviewStateValue.value === 'due' || reviewStateValue.value === 'stale'));
const isPublic = computed(() => !!share.value && share.value.enabled !== false);
const shareUrl = computed(() => (share.value ? `${window.location.origin}/share/${share.value.token}` : ''));

// Saving is deliberate: Save button or Ctrl/Cmd+S, never an autosave.
const isDirty = computed(() => !!page.value
    && (draftTitle.value !== savedSnapshot.value.title || contentHtml.value !== savedSnapshot.value.html));

const nameOf = (id) => (id ? (getUser(String(id))?.Employee_Name || '—') : '—');

const reviewLine = computed(() => {
    if (!page.value) return '';
    const owner = nameOf(page.value.ownerId);
    if (page.value.reviewedAt) {
        return t('DocsV2.reviewed_by_next', { who: nameOf(page.value.reviewedBy), when: shortDate(page.value.reviewDate) });
    }
    return t('DocsV2.review_due_line', { when: shortDate(page.value.reviewDate), who: owner });
});

watch(isDirty, (dirty) => emit('dirty', dirty));
watch(contentBlocks, (blocks) => emit('outline', headingsOf(blocks)), { deep: true });

function confirmDiscard() {
    return !isDirty.value || window.confirm(t('Projects.page_discard_confirm'));
}

function loadPage(id) {
    loadFailed.value = false;
    if (!id) {
        page.value = null;
        return;
    }
    apiRequest('get', `${env.PAGES}/${id}`)
        .then((response) => {
            if (!response.data?.status) {
                page.value = null;
                loadFailed.value = true;
                return;
            }
            page.value = response.data.data;
            draftTitle.value = page.value.title || '';
            contentHtml.value = (page.value.content && page.value.content.html) || '';
            contentBlocks.value = contentToEditorData(page.value.content);
            savedSnapshot.value = { title: draftTitle.value, html: contentHtml.value };
            editorSeed.value = page.value.content || { html: contentHtml.value };
            editorKey.value = String(id);
            baselinePending.value = true;
            isPrivate.value = String(page.value.visibility || '') === 'private';
            linkedTasks.value = (page.value.linkedTasks || []).map((x) => ({ id: String(x), key: '' }));
            mode.value = 'edit';
            showLinker.value = false;
            showShare.value = false;
            share.value = null;
            previewHtml.value = '';
            presenting.value = false;
            emit('loaded', page.value);
        })
        .catch((error) => {
            console.error('ERROR in open page: ', error);
            loadFailed.value = true;
        });
}

watch(() => props.pageId, (id) => loadPage(id), { immediate: true });

function savePage() {
    if (!page.value || isSaving.value || !isDirty.value) return;
    isSaving.value = true;
    const sent = { title: draftTitle.value, html: contentHtml.value };
    apiRequest('put', `${env.PAGES}/${page.value._id}`, {
        title: sent.title,
        contentHtml: sent.html,
        contentBlocks: contentBlocks.value,
    }).then((response) => {
        if (response.data?.status) {
            // Compare against what was SENT: anything typed during the request stays dirty.
            savedSnapshot.value = sent;
            if (response.data.data) page.value = { ...page.value, ...response.data.data, content: page.value.content };
            $toast.success(response.data.statusText, { position: 'top-right' });
            emit('saved', page.value);
        } else {
            $toast.error(response.data?.statusText || t('Toast.something_went_wrong'), { position: 'top-right' });
        }
    }).catch((error) => console.error('ERROR in save page: ', error))
        .finally(() => { isSaving.value = false; });
}

function deletePage() {
    if (!page.value) return;
    if (!window.confirm(t('Projects.page_delete_with_children'))) return;
    const id = String(page.value._id);
    apiRequest('delete', `${env.PAGES}/${id}`)
        .then((response) => {
            if (response.data?.status) {
                page.value = null;
                emit('deleted', id);
            }
        }).catch((error) => console.error('ERROR in delete page: ', error));
}

function requestClose() {
    if (!confirmDiscard()) return;
    emit('close');
}

/* Properties save on their own, immediately — they are not edits to the body. */
function persistMeta(patch) {
    if (!page.value) return;
    apiRequest('put', `${env.PAGES}/${page.value._id}`, patch)
        .then((response) => {
            if (response.data?.status) {
                if (response.data.data) {
                    const saved = { ...response.data.data };
                    delete saved.content;
                    page.value = { ...page.value, ...saved };
                    page.value.reviewState = reviewStateOf(page.value);
                }
                emit('saved', page.value);
            } else {
                $toast.error(response.data?.statusText || t('Toast.something_went_wrong'), { position: 'top-right' });
            }
        })
        .catch((error) => console.error('ERROR in save doc meta: ', error));
}

// The list endpoint computes this server-side; after a property write the page comes
// back without it, so it is derived again here with the same rule.
function reviewStateOf(doc) {
    if (!doc.isWiki) return 'none';
    const due = doc.reviewDate ? new Date(doc.reviewDate) : null;
    if (!due || Number.isNaN(due.getTime())) return doc.reviewedAt ? 'verified' : 'due';
    const now = new Date();
    if (due > now) return 'verified';
    const staleAt = new Date(due);
    staleAt.setMonth(staleAt.getMonth() + 3);
    return now >= staleAt ? 'stale' : 'due';
}

function setOwner(ownerId) { persistMeta({ ownerId }); }
function toggleWiki(on) { persistMeta({ isWiki: Boolean(on) }); }
function setReviewDate(value) { if (value) persistMeta({ reviewDate: value }); }

function markReviewed() {
    if (!page.value) return;
    apiRequest('put', `${env.PAGES}/${page.value._id}/review`, {})
        .then((response) => {
            if (response.data?.status) {
                const saved = { ...response.data.data };
                delete saved.content;
                page.value = { ...page.value, ...saved };
                $toast.success(t('DocsV2.marked_reviewed'), { position: 'top-right' });
                emit('saved', page.value);
            } else {
                $toast.error(response.data?.statusText || t('Toast.something_went_wrong'), { position: 'top-right' });
            }
        })
        .catch((error) => console.error('ERROR in mark reviewed: ', error));
}

function linkTask(taskItem) {
    if (!taskItem || !taskItem._id) return;
    const id = String(taskItem._id);
    showLinker.value = false;
    if (linkedTasks.value.some((x) => x.id === id)) return;
    linkedTasks.value = [...linkedTasks.value, { id, key: taskItem.TaskKey || '' }];
    persistMeta({ linkedTasks: linkedTasks.value.map((x) => x.id) });
}

function unlinkTask(id) {
    linkedTasks.value = linkedTasks.value.filter((x) => x.id !== String(id));
    persistMeta({ linkedTasks: linkedTasks.value.map((x) => x.id) });
}

function togglePrivate() {
    isPrivate.value = !isPrivate.value;
    persistMeta({ visibility: isPrivate.value ? 'private' : 'project' });
    // Going private takes the doc off the web too.
    if (isPrivate.value && isPublic.value) setPublicLink(false);
}

function openShare() {
    if (!page.value) return;
    showShare.value = true;
    share.value = null;
    apiRequest('get', `/api/v2/public-shares?entityId=${page.value._id}`)
        .then((response) => { if (response.data?.status) share.value = response.data.data || null; })
        .catch((error) => console.error('ERROR in fetch doc share: ', error));
}

function setPublicLink(on) {
    if (!page.value || isSharing.value) return;
    isSharing.value = true;
    const request = share.value
        ? apiRequest('put', `/api/v2/public-shares/${share.value._id}`, { enabled: on })
        : apiRequest('post', '/api/v2/public-shares', { entityType: 'page', entityId: page.value._id });
    request.then((response) => {
        if (response.data?.status) share.value = response.data.data || null;
        else $toast.error(response.data?.statusText || t('Toast.something_went_wrong'), { position: 'top-right' });
    })
        .catch((error) => {
            $toast.error(error?.response?.data?.statusText || error?.message || t('Toast.something_went_wrong'), { position: 'top-right' });
        })
        .finally(() => { isSharing.value = false; });
}

function togglePublicLink() { setPublicLink(!isPublic.value); }

function copyShareLink() {
    if (!shareUrl.value) return;
    navigator.clipboard.writeText(shareUrl.value)
        .then(() => $toast.success(t('Toast.Link_is_Copied_to_clipboard'), { position: 'top-right' }))
        .catch(() => $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' }));
}

function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function chipSpan({ taskKey, statusName, bgColor, textColor, taskName }) {
    const style = bgColor && textColor ? ` style="background:${escapeHtml(bgColor)};color:${escapeHtml(textColor)}"` : '';
    return `<span class="ah-chip ah-chip--mono"${style} title="${escapeHtml(taskName)}">${escapeHtml(taskKey)}: ${escapeHtml(statusName)}</span>`;
}

// Preview hydrates every task token with the task's current status, fetched on open.
async function buildPreviewHtml() {
    const html = contentHtml.value || '';
    const tokens = [...html.matchAll(TASK_TOKEN_PATTERN)];
    if (!tokens.length) {
        previewHtml.value = html;
        return;
    }
    const statuses = (props.projectData && props.projectData.taskStatusData) || [];
    const chipById = {};
    await Promise.all([...new Set(tokens.map((m) => m[1]))].map(async (taskId) => {
        try {
            const response = await apiRequest('get', `${env.TASK}/${taskId}`);
            const taskDoc = response?.status === 200 ? response.data : null;
            if (taskDoc && taskDoc._id) {
                const status = statuses.find((s) => s && s.key === taskDoc.statusKey) || {};
                chipById[taskId] = {
                    taskName: taskDoc.TaskName || '',
                    statusName: status.name || (taskDoc.status && taskDoc.status.text) || t('Projects.unknown_status'),
                    bgColor: status.bgColor,
                    textColor: status.textColor,
                };
            }
        } catch (error) {
            console.error('ERROR in fetch task for chip: ', error);
        }
    }));
    previewHtml.value = html.replace(TASK_TOKEN_PATTERN, (match, taskId, taskKey) => {
        const data = chipById[taskId];
        return data
            ? chipSpan({ taskKey, ...data })
            : chipSpan({ taskKey, statusName: '—', taskName: t('Projects.unknown_status') });
    });
}

function openPreview() {
    if (!page.value) return;
    mode.value = 'preview';
    buildPreviewHtml();
}

function openEditor() {
    editorSeed.value = contentBlocks.value ? { blocks: contentBlocks.value } : { html: contentHtml.value };
    mode.value = 'edit';
}

function onEditorReady() {
    if (baselinePending.value) {
        baselinePending.value = false;
        savedSnapshot.value = { ...savedSnapshot.value, html: contentHtml.value };
    }
}

function onBlockChange({ blocks, html }) {
    contentBlocks.value = blocks;
    contentHtml.value = html;
}

function onComposeApply(payload) {
    if (blockEditor.value && blockEditor.value.applyBlocks) blockEditor.value.applyBlocks(payload);
}

function present() {
    if (!page.value) return;
    presenting.value = true;
}

function askAi() {
    if (mode.value !== 'edit') openEditor();
    setTimeout(() => composeRail.value && composeRail.value.focusAsk(), 0);
}

function scrollToHeading(blockId) {
    if (blockEditor.value && blockEditor.value.scrollToBlock) blockEditor.value.scrollToBlock(blockId);
}

defineExpose({ openShare, present, askAi, scrollToHeading, confirmDiscard, isDirty });

function onKeydown(e) {
    if (!page.value) return;
    if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 's') {
        e.preventDefault();
        savePage();
    } else if (e.key === 'Escape') {
        if (presenting.value) { presenting.value = false; return; }
        if (showShare.value) { showShare.value = false; return; }
        if (showLinker.value) { showLinker.value = false; return; }
        if (props.closable) requestClose();
    }
}
onMounted(() => document.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown));
</script>

<style scoped>
.pd {
    flex: 1 1 auto; min-width: 0; min-height: 0;
    display: flex; flex-direction: column; position: relative;
    background: var(--surface);
    font-family: var(--font-ui);
    color: var(--ink);
}
.pd__banner {
    display: flex; align-items: center; gap: 10px;
    padding: 9px 20px; font-size: 12.5px; flex: none;
    background: var(--warn-bg); color: var(--warn-ink);
    border-bottom: 1px solid var(--hairline);
}
.pd__banner--stale { background: var(--danger-bg); color: var(--danger-ink); }
.pd__banner-text { flex: 1; }

.pd__head { padding: 18px 20px 6px; display: flex; flex-direction: column; gap: 10px; flex: none; }
.pd--page .pd__head { padding: 26px 40px 8px; }
.pd__title-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.pd__title {
    flex: 1 1 320px; min-width: 0;
    border: 0; outline: none; background: transparent; padding: 0;
    font: 700 27px/1.2 var(--font-ui); letter-spacing: -.7px; color: var(--ink);
}
.pd__title::placeholder { color: var(--ink-3); }
.pd__actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.pd__count { font: var(--text-data); padding: 1px 5px; border-radius: 6px; background: var(--brand-tint); color: var(--brand); }
.pd__icon {
    width: 30px; height: 30px; border-radius: 7px; border: 0; background: transparent; padding: 0;
    color: var(--ink-2); display: inline-flex; align-items: center; justify-content: center; cursor: pointer;
    transition: background var(--t-state) var(--ease), color var(--t-state) var(--ease);
}
.pd__icon:hover { background: var(--surface-hover); color: var(--ink); }
.pd__icon--danger:hover { background: var(--danger-bg); color: var(--danger-ink); }

.pd__props { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; font-size: 12px; color: var(--ink-2); }
.pd__prop { display: inline-flex; align-items: center; gap: 6px; }
.pd__prop--btn { border: 0; background: transparent; padding: 0; cursor: pointer; font: inherit; color: inherit; }
.pd__prop--wrap { flex-wrap: wrap; }
.pd__prop--muted { margin-left: auto; }
.pd__k { color: var(--ink-label); }
.pd__k--strong { color: var(--ink); font-weight: 500; }
.pd__select, .pd__date {
    height: 24px; border: 1px solid transparent; border-radius: 6px; background: transparent;
    font: 600 12px var(--font-ui); color: var(--ink); padding: 0 4px; cursor: pointer;
}
.pd__select:hover, .pd__date:hover { border-color: var(--border); background: var(--surface); }
.pd__date { font: 500 11.5px var(--font-mono); }
.pd__unlink { border: 0; background: none; padding: 0 0 0 2px; color: inherit; cursor: pointer; font-size: 10px; opacity: .7; }
.pd__unlink:hover { opacity: 1; }

.pd__review { display: flex; align-items: center; gap: 10px; font-size: 12.5px; color: var(--ink-2); }
.pd__review-text { flex: 1; }
.pd__linker { max-width: 520px; }

.pd__body { flex: 1 1 auto; min-height: 0; padding: 4px 20px 0; display: flex; }
.pd--page .pd__body { padding: 4px 40px 0; }
.pd__preview {
    flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 8px 0 32px;
    font: 400 15px/1.7 var(--font-ui); color: var(--ink); max-width: 760px;
}
.pd__preview :deep(h1) { font: 600 24px/1.2 var(--font-ui); letter-spacing: -.5px; margin: 16px 0 6px; }
.pd__preview :deep(h2) { font: 600 17px/1.3 var(--font-ui); margin: 14px 0 4px; }
.pd__preview :deep(h3) { font: 600 14.5px/1.3 var(--font-ui); margin: 12px 0 4px; }
.pd__preview :deep(p) { margin: 0 0 10px; }
.pd__preview :deep(aside) { padding: 11px 13px; border-radius: 9px; margin: 8px 0; background: var(--warn-bg); color: var(--warn-ink); }
.pd__preview :deep(aside.callout--info) { background: var(--brand-tint); color: var(--brand); }
.pd__preview :deep(aside.callout--ok) { background: var(--ok-bg); color: var(--ok-ink); }
.pd__preview :deep(aside.callout--danger) { background: var(--danger-bg); color: var(--danger-ink); }
.pd__preview :deep(pre) { font: 400 12.5px/1.6 var(--font-mono); background: var(--surface-2); padding: 10px 12px; border-radius: var(--r-input); overflow: auto; }
.pd__preview :deep(blockquote) { margin: 8px 0; padding-left: 14px; border-left: 3px solid var(--brand); color: var(--ink-2); }
.pd__preview :deep(table) { border-collapse: collapse; }
.pd__preview :deep(td) { border: 1px solid var(--hairline); padding: 6px 10px; }
.pd__preview :deep(img) { max-width: 100%; border-radius: var(--r-input); }
.pd__preview :deep(figcaption) { font: var(--text-small); color: var(--ink-2); }
.pd__preview :deep(hr) { border: 0; height: 1px; background: var(--hairline); margin: 14px 0; }
.pd__preview :deep(.task-block), .pd__preview :deep(.task-list-block) {
    display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 10px;
    background: var(--surface-2); border: 1px solid var(--hairline);
}

.pd__share-back {
    position: absolute; inset: 0; z-index: 30;
    background: rgba(0, 0, 0, .28);
    display: flex; align-items: flex-start; justify-content: center; padding-top: 90px;
}
.pd__share { width: 440px; max-width: calc(100% - 40px); box-shadow: var(--shadow-modal); }
.pd__share-body { display: flex; flex-direction: column; }
.pd__share-sub { display: flex; align-items: center; gap: 6px; margin: 0 0 8px; font-size: 13px; color: var(--ink-2); min-width: 0; }
.pd__share-sub b { color: var(--ink); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pd__share-row { display: flex; align-items: center; gap: 11px; padding: 12px 0; border-top: 1px solid var(--hairline); }
.pd__share-ico { flex: none; color: var(--ink-2); }
.pd__share-copy { flex: 1 1 auto; min-width: 0; }
.pd__share-label { font-size: 13.5px; font-weight: 500; color: var(--ink); }
.pd__switch {
    flex: none; width: 38px; height: 21px; padding: 0; border: 0; border-radius: 999px;
    background: var(--border); cursor: pointer; transition: background var(--t-state) var(--ease);
}
.pd__switch i { display: block; width: 17px; height: 17px; margin: 2px; border-radius: 50%; background: var(--surface); transition: transform var(--t-state) var(--ease); }
.pd__switch.is-on { background: var(--brand); }
.pd__switch.is-on i { transform: translateX(17px); }
.pd__switch:disabled { opacity: .45; cursor: not-allowed; }
.pd__share-url { margin: 12px 0 8px; font: var(--text-data); color: var(--ink-2); background: var(--surface-2); }

.pd__missing { padding: 24px; }

@media (max-width: 767px) {
    .pd__head, .pd--page .pd__head { padding: 14px 16px 6px; }
    .pd__body, .pd--page .pd__body { padding: 0 16px; }
    .pd__title { font-size: 22px; }
    .pd__prop--muted { margin-left: 0; }
}
</style>
