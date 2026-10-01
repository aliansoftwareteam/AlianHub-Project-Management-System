<template>
    <div class="pd" :class="`pd--${layout}`" @focusout="onFocusOut">
        <template v-if="page">
            <div v-if="isBehind" class="pd__banner" role="alert">
                <ShellIcon name="alert" :size="14" />
                <span class="pd__banner-text">{{ $t('Docs.conflict_banner') }}</span>
                <button type="button" class="ah-btn ah-btn--sm ah-btn--secondary" :disabled="isResolving" @click="keepMineAsCopy">{{ $t('Docs.conflict_keep_copy') }}</button>
                <button type="button" class="ah-btn ah-btn--sm ah-btn--secondary" :disabled="isResolving" @click="reloadSaved">{{ $t('Docs.conflict_reload') }}</button>
            </div>
            <div v-if="needsAttention" class="pd__banner" :class="`pd__banner--${reviewStateValue}`">
                <ShellIcon name="alert" :size="14" />
                <span class="pd__banner-text">{{ $t('Docs.stale_banner') }}</span>
                <button type="button" class="ah-btn ah-btn--sm ah-btn--secondary" @click="markReviewed">{{ $t('Docs.mark_reviewed') }}</button>
            </div>

            <div class="pd__head">
                <div class="pd__title-row">
                    <div class="pd__title-wrap" :data-title="draftTitle">
                        <textarea
                            :value="draftTitle"
                            rows="1"
                            class="pd__title"
                            :placeholder="$t('Docs.untitled')"
                            @input="onTitleInput"
                            @keydown.enter="onTitleEnter"
                        ></textarea>
                    </div>
                    <div class="pd__actions">
                        <div class="ah-tabs">
                            <button type="button" class="ah-tab" :class="{ 'is-active': mode === 'edit' }" @click="openEditor">{{ $t('Docs.edit') }}</button>
                            <button type="button" class="ah-tab" :class="{ 'is-active': mode === 'preview' }" @click="openPreview">{{ $t('Docs.preview') }}</button>
                        </div>
                        <button v-if="projectId" type="button" class="ah-btn ah-btn--sm ah-btn--secondary" @click="showLinker = !showLinker">
                            <ShellIcon name="link" :size="13" />{{ $t('Docs.link_tasks') }}
                            <span v-if="linkedTasks.length" class="pd__count">{{ linkedTasks.length }}</span>
                        </button>
                        <button type="button" class="ah-btn ah-btn--sm ah-btn--secondary" :aria-pressed="showComments" @click="showComments = !showComments">
                            <ShellIcon name="chat" :size="13" />{{ $t('Docs.comments') }}
                            <span v-if="openComments" class="pd__count">{{ openComments }}</span>
                        </button>
                        <button type="button" class="ah-btn ah-btn--sm ah-btn--secondary" aria-haspopup="dialog" :aria-expanded="showHistory" @click="showHistory = true">
                            <ShellIcon name="clock" :size="13" />{{ $t('Docs.history') }}
                        </button>
                        <template v-if="layout === 'panel'">
                            <button type="button" class="ah-btn ah-btn--sm ah-btn--secondary" @click="present">
                                <ShellIcon name="play" :size="11" />{{ $t('Docs.present') }}
                            </button>
                            <button type="button" class="ah-btn ah-btn--sm ah-btn--secondary" @click="openShare">
                                <ShellIcon name="share" :size="13" />{{ $t('Docs.share') }}
                            </button>
                        </template>
                        <button type="button" class="ah-btn ah-btn--sm ah-btn--primary" :disabled="!isDirty || isSaving || isBehind" :title="$t('Docs.save_now_hint')" @click="savePage">
                            {{ isSaving ? $t('Docs.saving') : $t('Docs.save') }}
                        </button>
                        <button type="button" class="pd__icon pd__icon--danger" :title="$t('Docs.delete')" @click="deletePage">
                            <ShellIcon name="trash" :size="15" />
                        </button>
                        <button v-if="closable" type="button" class="pd__icon" :title="$t('Docs.close')" @click="requestClose">
                            <ShellIcon name="x" :size="15" />
                        </button>
                    </div>
                </div>

                <div class="pd__props">
                    <label class="pd__prop">
                        <span class="pd__k">{{ $t('Docs.owner') }}</span>
                        <select class="pd__select" :value="page.ownerId || ''" @change="setOwner($event.target.value)">
                            <option value="">{{ $t('Docs.no_owner') }}</option>
                            <option v-for="user in users" :key="'own-' + user._id" :value="user._id">{{ user.Employee_Name }}</option>
                        </select>
                    </label>
                    <span class="pd__prop">
                        <span class="pd__k">{{ $t('Docs.project') }}</span>
                        <span class="ah-chip">{{ projectName }}</span>
                    </span>
                    <button type="button" class="pd__prop pd__prop--btn" :disabled="privateLocked" :title="privateHint" @click="togglePrivate">
                        <span class="pd__k">{{ $t('Docs.visibility') }}</span>
                        <span class="ah-chip" :class="{ 'ah-chip--warn': isPrivate }">
                            <ShellIcon :name="isPrivate ? 'lock' : 'members'" :size="11" />{{ isPrivate ? $t('Docs.private') : $t('Docs.shared') }}
                        </span>
                    </button>
                    <label class="pd__prop" :title="$t('Docs.wiki_toggle_hint')">
                        <input type="checkbox" class="ah-check" :checked="isWiki" @change="toggleWiki($event.target.checked)" />
                        <span class="pd__k pd__k--strong">{{ $t('Docs.wiki_page') }}</span>
                    </label>
                    <label v-if="isWiki" class="pd__prop">
                        <span class="pd__k">{{ $t('Docs.review_date') }}</span>
                        <input type="date" class="pd__date" :value="toDateInput(page.reviewDate)" @change="setReviewDate($event.target.value)" />
                    </label>
                    <span v-if="linkedTasks.length" class="pd__prop pd__prop--wrap">
                        <span class="pd__k">{{ $t('Docs.linked_to') }}</span>
                        <span v-for="task in linkedTasks" :key="'lt-' + task.id" class="ah-chip ah-chip--brand ah-chip--mono">
                            {{ task.key || task.id.slice(-6) }}
                            <button type="button" class="pd__unlink" :title="$t('Docs.unlink')" @click="unlinkTask(task.id)">✕</button>
                        </span>
                    </span>
                    <span class="pd__prop pd__prop--muted pd__save-state" role="status" :title="saveError || null">
                        <span class="ah-dot" :class="saveDot"></span>
                        {{ saveLabel }}
                    </span>
                </div>

                <div v-if="isWiki" class="pd__review">
                    <span class="ah-chip" :class="reviewChipClass(reviewStateValue)">
                        <ShellIcon v-if="reviewStateValue === 'verified'" name="check" :size="11" />
                        <span v-else class="ah-dot" :class="reviewStateValue === 'stale' ? 'ah-dot--danger' : 'ah-dot--warn'"></span>
                        {{ $t(reviewLabelKey(reviewStateValue)) }}
                    </span>
                    <span class="pd__review-text">{{ reviewLine }}</span>
                    <button v-if="!needsAttention" type="button" class="ah-btn ah-btn--sm ah-btn--ghost" @click="markReviewed">{{ $t('Docs.mark_reviewed') }}</button>
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
                    :page-id="String(page._id)"
                    :before-leave="saveBeforeLeaving"
                    @change="onBlockChange"
                    @ready="onEditorReady"
                />
                <div
                    v-else
                    ref="previewEl"
                    class="pd__preview ah-scroll"
                    @click="onMentionClick"
                    @keydown="onMentionKeydown"
                    v-html="previewHtml"
                ></div>
                <PageComments
                    v-show="showComments"
                    :key="`comments-${editorKey}`"
                    :page-id="String(page._id)"
                    :blocks="contentBlocks && contentBlocks.blocks"
                    :focus-id="focusCommentId"
                    :pick-block="mode === 'edit' ? currentBlock : null"
                    :before-leave="saveBeforeLeaving"
                    @count="openComments = $event"
                    @threads="markCommented"
                    @jump="jumpToBlock"
                    @close="showComments = false"
                />
            </div>

            <PageComposeRail
                v-if="mode === 'edit' && canUseAi()"
                ref="composeRail"
                :page-id="String(page._id)"
                :title="draftTitle"
                :current-text="rawDraft"
                @apply="onComposeApply"
                @undo="onComposeUndo"
                @tasks-linked="onTasksLinked"
                @tasks-unlinked="onTasksUnlinked"
            />

            <div v-if="showShare" class="pd__share-back" @click.self="showShare = false">
                <div class="ah-card pd__share">
                    <div class="ah-card__head">
                        <h3 class="ah-h3">{{ $t('Projects.doc_share_title') }}</h3>
                        <button type="button" class="pd__icon" :title="$t('Docs.close')" @click="showShare = false"><ShellIcon name="x" :size="15" /></button>
                    </div>
                    <div class="ah-card__body pd__share-body">
                        <p class="pd__share-sub"><ShellIcon name="docs" :size="14" /><b>{{ draftTitle || $t('Docs.untitled') }}</b></p>
                        <div class="pd__share-row">
                            <ShellIcon :name="isPrivate ? 'lock' : 'members'" :size="16" class="pd__share-ico" />
                            <div class="pd__share-copy">
                                <div class="pd__share-label">{{ isPrivate ? $t('Docs.private') : $t('Docs.shared') }}</div>
                                <div class="ah-small">{{ isPrivate ? $t('Projects.doc_private_hint') : $t('Projects.doc_shared_hint') }}</div>
                            </div>
                            <button type="button" class="pd__switch" :class="{ 'is-on': !isPrivate }" :disabled="privateLocked" :title="privateLocked ? privateHint : null" @click="togglePrivate"><i></i></button>
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
                        <button type="button" class="ah-btn ah-btn--secondary ah-btn--block pd__who" @click="showWhoCanSee = true">
                            <ShellIcon name="eye" :size="13" />{{ $t('WhoCanSee.menu_doc') }}
                        </button>
                    </div>
                </div>
            </div>

            <PageHistory
                v-if="showHistory"
                :page-id="String(page._id)"
                :current-title="draftTitle"
                :current-blocks="currentBlocks"
                :doc-private="isPrivate"
                :save-pending="savePending"
                :before-restore="savePending"
                @close="showHistory = false"
                @restored="onRestored"
            />

            <WhoCanSeeModal v-if="showWhoCanSee" v-model="showWhoCanSee" kind="page" :itemId="page?._id || ''" :title="draftTitle" />

            <PagePresenter
                v-if="presenting"
                :title="draftTitle"
                :blocks="contentBlocks"
                :project-name="projectName"
                @close="presenting = false"
            />
        </template>
        <div v-else-if="loadFailed" class="pd__missing">
            <div class="ah-empty">{{ $t('Docs.page_missing') }}</div>
        </div>
    </div>
</template>

<script setup>
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, unref, watch } from 'vue';
import { canUseAi } from "@/composable/aiAvailability";
import { useToast } from 'vue-toast-notification';
import { useI18n } from 'vue-i18n';
import { useStore } from 'vuex';
import { useRoute } from 'vue-router';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';
import WhoCanSeeModal from '@/components/molecules/WhoCanSee/WhoCanSeeModal.vue';
import TaskChipPicker from '@/components/molecules/Pages/TaskChipPicker.vue';
import PageBlockEditor from '@/components/molecules/Pages/PageBlockEditor.vue';
import PageComposeRail from '@/components/molecules/Pages/PageComposeRail.vue';
import PagePresenter from '@/components/molecules/Pages/PagePresenter.vue';
import PageComments from '@/components/molecules/Pages/PageComments.vue';
import PageHistory from '@/components/molecules/Pages/PageHistory.vue';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { useCustomComposable, useGetterFunctions } from '@/composable';
import pageContent from '@pageContent';
import { richHtml } from '@/utils/richHtml';
import { statusChipCss } from '@/utils/statusChipColors';
import { relativeTime, shortDate, toDateInput, reviewChipClass, reviewLabelKey, headingsOf } from './docsFormat';
import { decorateMentions } from './docMentions';
import { hydrateDocImages } from './docImages';
import { useMentionLinks } from './useMentionLinks';
import { createDocAutosave } from './docAutosave';

const { contentToEditorData, blocksToRawText, TASK_TOKEN_PATTERN } = pageContent.default || pageContent;

defineOptions({ name: 'PageDocument' });

const { t } = useI18n();
const $toast = useToast();
const store = useStore();
const { getUser } = useGetterFunctions();
const { getWasabiImageLink } = useCustomComposable();
const companyId = inject('$companyId');
const userId = inject('$userId', '');

const props = defineProps({
    pageId: { type: String, default: '' },
    projectData: { type: Object, default: () => ({}) },
    layout: { type: String, default: 'panel' },
    closable: { type: Boolean, default: false },
});

const emit = defineEmits(['loaded', 'saved', 'deleted', 'close', 'outline']);

const page = ref(null);
const loadFailed = ref(false);
const draftTitle = ref('');
const contentHtml = ref('');
const contentBlocks = ref(null);
const savedSnapshot = ref({ title: '', html: '' });
const isSaving = ref(false);
const isResolving = ref(false);
const savedHere = ref(false);
const blockEditor = ref(null);
const composeRail = ref(null);
const editorSeed = ref(null);
const editorKey = ref('');
const baselinePending = ref(false);
const mode = ref('edit');
const previewHtml = ref('');
const previewEl = ref(null);
const showLinker = ref(false);
const linkedTasks = ref([]);
const isPrivate = ref(false);
const showShare = ref(false);
const showWhoCanSee = ref(false);
const share = ref(null);
const isSharing = ref(false);
const presenting = ref(false);
const route = useRoute();
const showComments = ref(false);
const showHistory = ref(false);
const openComments = ref(0);
const commentedBlocks = ref([]);
const focusCommentId = computed(() => String((route && route.query && route.query.comment) || ''));

const projectId = computed(() => String((props.projectData && props.projectData._id) || (page.value && page.value.ProjectID) || ''));
const projectName = computed(() => {
    if (props.projectData && props.projectData.ProjectName) return props.projectData.ProjectName;
    const all = store.getters['projectData/allProjects'];
    const found = ((all && all.data) || []).find((p) => String(p._id) === projectId.value);
    return found ? found.ProjectName : t('Docs.workspace');
});
const users = computed(() => (store.getters['users/users'] || []).filter((u) => u && u.Employee_Name));
const rawDraft = computed(() => blocksToRawText(contentBlocks.value) || contentHtml.value || '');
const currentBlocks = computed(() => (contentBlocks.value && contentBlocks.value.blocks) || []);
const isWiki = computed(() => Boolean(page.value && page.value.isWiki));
const reviewStateValue = computed(() => (page.value && page.value.reviewState) || 'none');
const needsAttention = computed(() => isWiki.value && (reviewStateValue.value === 'due' || reviewStateValue.value === 'stale'));
const isPublic = computed(() => !!share.value && share.value.enabled !== false);
// The server lets only the author make a doc private: nobody else could read it afterwards.
const privateLocked = computed(() => !isPrivate.value && String((page.value && page.value.createdBy) || '') !== String(unref(userId) || ''));
const privateHint = computed(() => {
    if (privateLocked.value) return t('Projects.doc_private_author_only');
    return isPrivate.value ? t('Projects.doc_private_hint') : t('Projects.doc_shared_hint');
});
const shareUrl = computed(() => (share.value ? `${window.location.origin}/share/${share.value.token}` : ''));

const isDirty = computed(() => !!page.value
    && (draftTitle.value !== savedSnapshot.value.title || contentHtml.value !== savedSnapshot.value.html));

const autosave = createDocAutosave({
    draft: () => (page.value
        ? { pageId: String(page.value._id), title: draftTitle.value, html: contentHtml.value, blocks: contentBlocks.value }
        : null),
    isDirty: () => isDirty.value,
    send: (pageId, body) => apiRequest('put', `${env.PAGES}/${pageId}`, body),
    onSaved,
});
const { saveState } = autosave;
const isBehind = computed(() => saveState.value === 'conflict');
const saveError = computed(() => (saveState.value === 'failed' ? autosave.lastError.value : ''));
const saveDot = computed(() => {
    if (saveState.value === 'saved') return 'ah-dot--ok';
    return saveState.value === 'saving' ? 'ah-dot--warn' : 'ah-dot--danger';
});
const saveLabel = computed(() => {
    if (saveState.value === 'saving') return t('Docs.saving');
    if (saveState.value === 'offline') return t('Docs.autosave_offline');
    if (saveState.value === 'failed' || saveState.value === 'conflict') return t('Docs.autosave_not_saved');
    return savedHere.value ? t('Docs.saved') : t('Docs.updated', { when: relativeTime(page.value.updatedAt, t) });
});

/* The doc tree and the page header follow a save through `saved`; an autosave that leaves the title alone tells
   them nothing new, and would have the tree fetched again on every pause. */
function onSaved(sent, data, { settled }) {
    if (!page.value || String(page.value._id) !== sent.pageId) return;
    const renamed = sent.title !== savedSnapshot.value.title;
    savedSnapshot.value = { title: sent.title, html: sent.html };
    page.value = { ...page.value, ...data, content: page.value.content };
    savedHere.value = true;
    if (settled || renamed) emit('saved', page.value);
}

watch([draftTitle, contentHtml], () => {
    if (page.value && !baselinePending.value && isDirty.value) autosave.changed();
});

const nameOf = (id) => (id ? (getUser(String(id))?.Employee_Name || '—') : '—');

const reviewLine = computed(() => {
    if (!page.value) return '';
    const owner = nameOf(page.value.ownerId);
    if (page.value.reviewedAt) {
        return t('Docs.reviewed_by_next', { who: nameOf(page.value.reviewedBy), when: shortDate(page.value.reviewDate) });
    }
    return t('Docs.review_due_line', { when: shortDate(page.value.reviewDate), who: owner });
});

watch(contentBlocks, (blocks) => emit('outline', headingsOf(blocks)), { deep: true });

/* Nothing asks before leaving any more: the doc is saved on the way out, and what cannot be saved stays on
   this device for the next time the doc is opened. */
function saveBeforeLeaving() {
    autosave.flush({ settled: true });
    return true;
}

function onFocusOut(event) {
    if (!event.currentTarget.contains(event.relatedTarget)) autosave.flush({ settled: true });
}

const { onMentionClick, onMentionKeydown } = useMentionLinks({ beforeLeave: saveBeforeLeaving });

const personName = (id) => {
    const user = getUser(String(id));
    return user && !user.ghostUser ? user.Employee_Name : '';
};

watch(previewHtml, () => nextTick(() => {
    decorateMentions(previewEl.value, { labelOf: personName });
    hydrateDocImages(previewEl.value, (key) => getWasabiImageLink(companyId.value, key));
}));

/* A restore reloads the same doc: a new key is what makes the editor and the comments start over. */
let reloads = 0;

function loadPage(id) {
    loadFailed.value = false;
    showHistory.value = false;
    if (!id) {
        page.value = null;
        return Promise.resolve();
    }
    return apiRequest('get', `${env.PAGES}/${id}`)
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
            editorKey.value = reloads ? `${id}-r${reloads}` : String(id);
            baselinePending.value = true;
            savedHere.value = false;
            const unsaved = autosave.opened(page.value);
            if (unsaved) {
                draftTitle.value = unsaved.title || '';
                contentHtml.value = unsaved.html || '';
                contentBlocks.value = unsaved.blocks || contentToEditorData({ html: contentHtml.value });
                editorSeed.value = { blocks: contentBlocks.value };
                baselinePending.value = false;
                autosave.changed();
            }
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

watch(() => props.pageId, (id) => {
    autosave.flush({ settled: true });
    reloads = 0;
    loadPage(id);
}, { immediate: true });

async function onRestored() {
    if (!page.value) return;
    reloads += 1;
    await loadPage(String(page.value._id));
    if (page.value) emit('saved', page.value);
}

// A title is one line that wraps; a pasted line break becomes a space, one for one, so the caret stays put.
function onTitleInput(event) {
    const field = event.target;
    const oneLine = field.value.replace(/[\r\n]/g, ' ');
    if (oneLine !== field.value) {
        const caret = field.selectionStart;
        field.value = oneLine;
        field.setSelectionRange(caret, caret);
    }
    draftTitle.value = oneLine;
}

function onTitleEnter(event) {
    if (!event.isComposing) event.preventDefault();
}

/* Save now: the same save the doc makes by itself, without waiting for a pause. */
async function savePage() {
    if (!page.value || isSaving.value || !isDirty.value || isBehind.value) return false;
    isSaving.value = true;
    const saved = await autosave.flush({ settled: true });
    isSaving.value = false;
    if (saved) $toast.success(t('Docs.saved'), { position: 'top-right' });
    else if (!isBehind.value) $toast.error(autosave.lastError.value || t('Docs.autosave_not_saved'), { position: 'top-right' });
    return saved;
}

/* A version holds the saved doc, so edits still in the editor are saved before one is kept or restored over. */
function savePending() {
    return autosave.flush({ settled: true });
}

function reloadSaved() {
    if (!page.value) return Promise.resolve();
    autosave.discardUnsaved(String(page.value._id));
    reloads += 1;
    return loadPage(String(page.value._id));
}

/* The doc on the server is someone else's newer text and is left as it is; this person's text becomes a doc of
   its own beside it. */
async function keepMineAsCopy() {
    if (!page.value || isResolving.value) return;
    isResolving.value = true;
    try {
        const response = await apiRequest('post', env.PAGES, {
            title: t('Docs.conflict_copy_title', { title: draftTitle.value || t('Docs.untitled') }).slice(0, 200),
            contentBlocks: contentBlocks.value,
            ...(page.value.ProjectID ? { projectId: String(page.value.ProjectID) } : {}),
            ...(page.value.parentPageId ? { parentPageId: String(page.value.parentPageId) } : {}),
            ...(isPrivate.value ? { visibility: 'private' } : {}),
        });
        if (!response.data?.status) {
            $toast.error(response.data?.statusText || t('Toast.something_went_wrong'), { position: 'top-right' });
            return;
        }
        $toast.success(t('Docs.conflict_copy_kept', { title: response.data.data.title }), { position: 'top-right' });
        await reloadSaved();
        if (page.value) emit('saved', page.value);
    } catch (error) {
        console.error('ERROR in keeping a copy of the doc: ', error);
        $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
    } finally {
        isResolving.value = false;
    }
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
    saveBeforeLeaving();
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
                $toast.success(t('Docs.marked_reviewed'), { position: 'top-right' });
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

/* The server already linked or unlinked these; only the list on screen follows, so a later link does not drop them. */
function onTasksLinked(tasks) {
    const known = new Set(linkedTasks.value.map((x) => x.id));
    linkedTasks.value = [...linkedTasks.value, ...tasks.filter((task) => !known.has(String(task.taskId))).map((task) => ({ id: String(task.taskId), key: '' }))];
}

function onTasksUnlinked(ids) {
    const gone = new Set(ids.map(String));
    linkedTasks.value = linkedTasks.value.filter((x) => !gone.has(x.id));
}

function unlinkTask(id) {
    linkedTasks.value = linkedTasks.value.filter((x) => x.id !== String(id));
    persistMeta({ linkedTasks: linkedTasks.value.map((x) => x.id) });
}

function togglePrivate() {
    if (privateLocked.value) return;
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
    const style = bgColor && textColor ? ` style="${escapeHtml(statusChipCss({ bgColor, textColor }))}"` : '';
    return `<span class="ah-chip ah-chip--mono ah-status-ink"${style} title="${escapeHtml(taskName)}">${escapeHtml(taskKey)}: ${escapeHtml(statusName)}</span>`;
}

// Preview hydrates every task token with the task's current status, fetched on open.
async function buildPreviewHtml() {
    const html = richHtml(contentHtml.value || '');
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
    markCommented(commentedBlocks.value);
    if (baselinePending.value) {
        baselinePending.value = false;
        savedSnapshot.value = { ...savedSnapshot.value, html: contentHtml.value };
    }
}

function onBlockChange({ blocks, html }) {
    contentBlocks.value = blocks;
    contentHtml.value = html;
}

let beforeCompose = null;

async function onComposeApply(payload) {
    if (!blockEditor.value || !blockEditor.value.applyBlocks) return;
    beforeCompose = await blockEditor.value.applyBlocks(payload);
    markCommented(commentedBlocks.value);
}

async function onComposeUndo() {
    if (!beforeCompose || !blockEditor.value || !blockEditor.value.restore) return;
    const snapshot = beforeCompose;
    beforeCompose = null;
    await blockEditor.value.restore(snapshot);
    markCommented(commentedBlocks.value);
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

function currentBlock() {
    return blockEditor.value && blockEditor.value.currentBlock ? blockEditor.value.currentBlock() : null;
}

function markCommented(blockIds) {
    commentedBlocks.value = blockIds || [];
    if (blockEditor.value && blockEditor.value.markCommented) blockEditor.value.markCommented(commentedBlocks.value);
}

function jumpToBlock(blockId) {
    if (mode.value !== 'edit') openEditor();
    setTimeout(() => scrollToHeading(blockId), 0);
}

watch(focusCommentId, (id) => { if (id) showComments.value = true; }, { immediate: true });

defineExpose({ openShare, present, askAi, scrollToHeading, saveBeforeLeaving, isDirty });

function onKeydown(e) {
    if (!page.value) return;
    if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 's') {
        e.preventDefault();
        savePage();
    } else if (e.key === 'Escape') {
        if (showHistory.value) { showHistory.value = false; return; }
        if (presenting.value) { presenting.value = false; return; }
        if (showShare.value) { showShare.value = false; return; }
        if (showLinker.value) { showLinker.value = false; return; }
        if (showComments.value) { showComments.value = false; return; }
        if (props.closable) requestClose();
    }
}
function onPageHide() {
    autosave.keepNow();
    autosave.flush({ settled: true });
}

function onVisibility() {
    if (document.visibilityState === 'hidden') autosave.flush({ settled: true });
}

onMounted(() => {
    document.addEventListener('keydown', onKeydown);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('beforeunload', onPageHide);
    window.addEventListener('online', autosave.online);
});
onBeforeUnmount(() => {
    document.removeEventListener('keydown', onKeydown);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('beforeunload', onPageHide);
    window.removeEventListener('online', autosave.online);
    autosave.flush({ settled: true });
    autosave.dispose();
});
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
.pd__banner { flex-wrap: wrap; }
.pd__banner-text { flex: 1 1 220px; }

.pd__head { padding: 18px 20px 6px; display: flex; flex-direction: column; gap: 10px; flex: none; }
.pd--page .pd__head { padding: 26px 40px 8px; }
.pd__title-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
/* The hidden copy of the title sizes the grid cell, so the textarea grows with every wrapped line. */
.pd__title-wrap { flex: 1 1 320px; min-width: 0; display: grid; }
.pd__title-wrap::after { content: attr(data-title) " "; visibility: hidden; white-space: pre-wrap; }
.pd__title, .pd__title-wrap::after {
    grid-area: 1 / 1;
    border: 0; padding: 0; overflow-wrap: anywhere;
    font: 700 27px/1.2 var(--font-ui); letter-spacing: -.7px;
}
.pd__title {
    width: 100%; resize: none; overflow: hidden;
    outline: none; background: transparent; color: var(--ink);
}
.pd__title::placeholder { color: var(--ink-2); }
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
.pd__prop--btn:disabled { opacity: .6; cursor: not-allowed; }
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
.pd__preview :deep(.mention) {
    padding: 0 3px; border-radius: 4px; background: var(--brand-tint); color: var(--brand);
    font-weight: 500; overflow-wrap: anywhere; box-decoration-break: clone; -webkit-box-decoration-break: clone;
}
.pd__preview :deep(.mention[role="link"]) { cursor: pointer; }
.pd__preview :deep(.mention[role="link"]:hover) { text-decoration: underline; }
.pd__preview :deep(.mention[role="link"]:focus-visible) { outline: none; box-shadow: var(--focus); }
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
.pd__who { margin-top: 12px; }
.pd__share-url { margin: 12px 0 8px; font: var(--text-data); color: var(--ink-2); background: var(--surface-2); }

.pd__missing { padding: 24px; }

/* Editor.js centres its 760px column and hangs the 62px block toolbar to its left. On a full page that
   put the body a long way right of the title, so the column starts at a gutter that just fits the
   toolbar, and the title, the meta row and the preview start there too. */
@media (min-width: 768px) {
    .pd--page { --pd-gutter: 64px; }
    .pd--page .pd__head { padding-left: var(--pd-gutter); }
    .pd--page .pd__body { padding-left: 0; }
    .pd--page .pd__body :deep(.ce-block__content),
    .pd--page .pd__body :deep(.ce-toolbar__content) { margin-left: var(--pd-gutter); }
    .pd--page .pd__preview { padding-left: var(--pd-gutter); max-width: calc(760px + var(--pd-gutter)); }
}
@media (max-width: 767px) {
    .pd__head, .pd--page .pd__head { padding: 14px 16px 6px; }
    .pd__body, .pd--page .pd__body { padding: 0 16px; }
    .pd__title, .pd__title-wrap::after { font-size: 22px; }
    .pd__prop--muted { margin-left: 0; }
}
</style>
