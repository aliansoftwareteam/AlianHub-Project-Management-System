<template>
    <aside class="pcm" :aria-label="$t('Docs.comments_title')">
        <header class="pcm__head">
            <h3 class="pcm__title">{{ $t('Docs.comments_title') }}</h3>
            <div class="ah-tabs pcm__tabs" role="tablist">
                <button type="button" class="ah-tab" role="tab" :aria-selected="filter === 'open'" :class="{ 'is-active': filter === 'open' }" @click="filter = 'open'">
                    {{ $t('Docs.comments_open', { n: openThreads.length }) }}
                </button>
                <button type="button" class="ah-tab" role="tab" :aria-selected="filter === 'resolved'" :class="{ 'is-active': filter === 'resolved' }" @click="filter = 'resolved'">
                    {{ $t('Docs.comments_resolved', { n: threads.length - openThreads.length }) }}
                </button>
            </div>
            <button type="button" class="pcm__icon" :title="$t('Docs.close')" :aria-label="$t('Docs.close')" @click="emit('close')">
                <ShellIcon name="x" :size="14" />
            </button>
        </header>

        <div ref="listEl" class="pcm__list ah-scroll">
            <p v-if="loading" class="pcm__empty">{{ $t('Docs.comments_loading') }}</p>
            <p v-else-if="!shownThreads.length" class="pcm__empty">
                {{ filter === 'open' ? $t('Docs.comments_empty') : $t('Docs.comments_none_resolved') }}
            </p>
            <article
                v-for="thread in shownThreads"
                :id="`doc-comment-${thread.root._id}`"
                :key="thread.root._id"
                class="pcm__thread"
                :class="{ 'is-focused': focusedId === String(thread.root._id) }"
            >
                <button v-if="thread.blockId" type="button" class="pcm__anchor" :title="$t('Docs.comments_jump')" @click="emit('jump', thread.blockId)">
                    <ShellIcon name="docs" :size="11" />
                    <span class="pcm__anchor-text">{{ blockExcerpt(thread.blockId) || $t('Docs.comments_on_block') }}</span>
                </button>
                <p v-else-if="thread.blockRemoved" class="pcm__anchor pcm__anchor--gone">{{ $t('Docs.comments_block_removed') }}</p>

                <div v-for="item in [thread.root, ...thread.replies]" :key="item._id" class="pcm__item" :class="{ 'pcm__item--reply': item.parentId }">
                    <div class="pcm__meta">
                        <span class="ah-avatar ah-avatar--sm" aria-hidden="true">{{ initials(nameOf(item.userId)) }}</span>
                        <b class="pcm__who">{{ nameOf(item.userId) }}</b>
                        <span class="pcm__when">{{ relativeTime(item.createdAt, t) }}</span>
                        <span v-if="item.editedAt" class="pcm__when">{{ $t('Docs.comment_edited') }}</span>
                        <span class="pcm__tools">
                            <button v-if="isMine(item)" type="button" class="pcm__tool" @click="startEdit(item)">{{ $t('Docs.comment_edit') }}</button>
                            <button v-if="isMine(item) || isAdmin" type="button" class="pcm__tool pcm__tool--danger" @click="remove(item)">{{ $t('Docs.comment_delete') }}</button>
                        </span>
                    </div>
                    <div v-if="editingId === String(item._id)" class="pcm__edit">
                        <PageCommentInput v-model="editDraft" :people="people" :label="$t('Docs.comment_edit')" autofocus @submit="saveEdit(item)" @cancel="editingId = ''" />
                        <div class="pcm__row">
                            <button type="button" class="ah-btn ah-btn--sm ah-btn--ghost" @click="editingId = ''">{{ $t('Docs.comment_cancel') }}</button>
                            <button type="button" class="ah-btn ah-btn--sm ah-btn--primary" :disabled="!editDraft.trim() || busy" @click="saveEdit(item)">{{ $t('Docs.comment_save') }}</button>
                        </div>
                    </div>
                    <!-- commentHtml escapes the whole text before it marks up mentions and links. -->
                    <p v-else class="pcm__text" v-html="commentHtml(item.message, { links: true })"></p>
                </div>

                <div class="pcm__row pcm__row--thread">
                    <button type="button" class="ah-btn ah-btn--sm ah-btn--ghost" @click="toggleReply(thread.root)">{{ $t('Docs.comment_reply') }}</button>
                    <button type="button" class="ah-btn ah-btn--sm ah-btn--ghost" @click="setResolved(thread.root, !thread.root.resolved)">
                        <ShellIcon :name="thread.root.resolved ? 'refresh' : 'check'" :size="12" />
                        {{ thread.root.resolved ? $t('Docs.comment_reopen') : $t('Docs.comment_resolve') }}
                    </button>
                </div>
                <div v-if="replyingTo === String(thread.root._id)" class="pcm__reply">
                    <PageCommentInput v-model="replyDraft" :people="people" :placeholder="$t('Docs.comment_reply_placeholder')" autofocus @submit="send(thread.root)" @cancel="replyingTo = ''" />
                    <div class="pcm__row">
                        <button type="button" class="ah-btn ah-btn--sm ah-btn--primary" :disabled="!replyDraft.trim() || busy" @click="send(thread.root)">{{ $t('Docs.comment_send') }}</button>
                    </div>
                </div>
            </article>
        </div>

        <footer class="pcm__compose">
            <div class="pcm__target">
                <span v-if="anchor" class="ah-chip ah-chip--brand pcm__chip">
                    <span class="pcm__anchor-text">{{ $t('Docs.comment_target_block', { text: anchor.text || $t('Docs.comments_on_block') }) }}</span>
                    <button type="button" class="pcm__unanchor" :title="$t('Docs.comment_target_clear')" :aria-label="$t('Docs.comment_target_clear')" @click="anchor = null">✕</button>
                </span>
                <span v-else class="pcm__hint">{{ $t('Docs.comment_target_doc') }}</span>
                <button v-if="canAnchor" type="button" class="ah-btn ah-btn--sm ah-btn--ghost" @click="useCurrentBlock">{{ $t('Docs.comment_on_block') }}</button>
            </div>
            <p v-if="anchorHint" class="pcm__hint" role="status">{{ anchorHint }}</p>
            <PageCommentInput ref="composer" v-model="draft" :people="people" :placeholder="$t('Docs.comment_placeholder')" @submit="send(null)" />
            <div class="pcm__row">
                <button type="button" class="ah-btn ah-btn--sm ah-btn--primary" :disabled="!draft.trim() || busy" @click="send(null)">{{ $t('Docs.comment_send') }}</button>
            </div>
        </footer>
    </aside>
</template>

<script setup>
import { computed, inject, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useStore } from 'vuex';
import { useToast } from 'vue-toast-notification';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { useGetterFunctions } from '@/composable';
import { commentHtml, decodeCommentText } from '@/utils/commentHtml';
import PageCommentInput from './PageCommentInput.vue';
import { initials, relativeTime } from './docsFormat';
import { applyCommentEvent, threadsOf } from './pageComments';

defineOptions({ name: 'PageComments' });

const props = defineProps({
    pageId: { type: String, required: true },
    blocks: { type: Array, default: null },
    focusId: { type: String, default: '' },
    pickBlock: { type: Function, default: null },
});

const emit = defineEmits(['close', 'jump', 'count', 'threads']);

const { t } = useI18n();
const $toast = useToast();
const store = useStore();
const { getUser } = useGetterFunctions();
const socket = inject('$socket', ref(null));
const userId = inject('$userId', ref(''));

const PRIVILEGED_ROLES = [1, 2];
const ACTIVE_SEAT = 2;
const EVENTS = ['pageCommentInsert', 'pageCommentUpdate'];
const EXCERPT = 60;

const comments = ref([]);
const loading = ref(false);
const busy = ref(false);
const filter = ref('open');
const draft = ref('');
const anchor = ref(null);
const anchorHint = ref('');
const replyingTo = ref('');
const replyDraft = ref('');
const editingId = ref('');
const editDraft = ref('');
const focusedId = ref('');
const listEl = ref(null);
const composer = ref(null);

const me = computed(() => String((userId && userId.value) || ''));
const isAdmin = computed(() => PRIVILEGED_ROLES.includes(Number((store.getters['settings/companyUserDetail'] || {}).roleType)));
/* The same people the doc editor's mention picker offers: live seats that are not agents or bots. */
const people = computed(() => (store.getters['settings/companyUsers'] || [])
    .filter((seat) => seat && seat.userId && seat.isDelete !== true && (seat.status === undefined || Number(seat.status) === ACTIVE_SEAT)
        && !seat.isAgent && !seat.isBot && String(seat.userId) !== me.value)
    .map((seat) => ({ id: String(seat.userId), user: getUser(String(seat.userId)) }))
    .filter(({ user }) => user && user.Employee_Name && !user.ghostUser)
    .map(({ id, user }) => ({ id, name: user.Employee_Name })));
const blockIds = computed(() => (Array.isArray(props.blocks) ? props.blocks.map((block) => block && block.id).filter(Boolean) : null));
const threads = computed(() => threadsOf(comments.value, blockIds.value));
const openThreads = computed(() => threads.value.filter((thread) => !thread.root.resolved));
const shownThreads = computed(() => (filter.value === 'open' ? openThreads.value : threads.value.filter((thread) => thread.root.resolved)));
const canAnchor = computed(() => typeof props.pickBlock === 'function');

watch(() => openThreads.value.length, (n) => emit('count', n), { immediate: true });
watch(openThreads, (list) => emit('threads', list.map((thread) => thread.blockId).filter(Boolean)), { immediate: true });

const nameOf = (id) => getUser(String(id))?.Employee_Name || t('Docs.comment_someone');
const isMine = (item) => String(item.userId) === me.value;

const plainText = (html) => String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
function blockExcerpt(id) {
    const block = (props.blocks || []).find((b) => b && b.id === id);
    const data = (block && block.data) || {};
    const text = plainText(data.text || data.caption || data.code || '');
    return text.length > EXCERPT ? `${text.slice(0, EXCERPT)}…` : text;
}

const base = () => `${env.PAGES}/${props.pageId}/comments`;
const failed = (response) => $toast.error(response?.data?.statusText || t('Toast.something_went_wrong'), { position: 'top-right' });

function load() {
    if (!props.pageId) return;
    loading.value = true;
    apiRequest('get', base())
        .then((response) => {
            if (response.data?.status) comments.value = response.data.data || [];
            else failed(response);
        })
        .catch((error) => console.error('ERROR in load doc comments: ', error))
        .finally(() => {
            loading.value = false;
            focusComment(props.focusId);
        });
}

function focusComment(id) {
    if (!id) return;
    const target = comments.value.find((row) => String(row._id) === String(id));
    if (!target) return;
    const rootId = String(target.parentId || target._id);
    const root = comments.value.find((row) => String(row._id) === rootId);
    filter.value = root && root.resolved ? 'resolved' : 'open';
    focusedId.value = rootId;
    nextTick(() => {
        const node = listEl.value && listEl.value.querySelector(`#doc-comment-${rootId}`);
        if (node) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
}

function merge(row) {
    if (row) comments.value = applyCommentEvent(comments.value, row);
}

async function write(method, url, body) {
    busy.value = true;
    try {
        const response = await apiRequest(method, url, body);
        if (!response.data?.status) {
            failed(response);
            return null;
        }
        return response.data.data || {};
    } catch (error) {
        console.error('ERROR in doc comment write: ', error);
        failed(error?.response);
        return null;
    } finally {
        busy.value = false;
    }
}

async function send(threadRoot) {
    const message = threadRoot ? replyDraft.value : draft.value;
    if (!message.trim() || busy.value) return;
    const body = threadRoot ? { message, parentId: String(threadRoot._id) } : { message, ...(anchor.value ? { blockId: anchor.value.id } : {}) };
    const saved = await write('post', base(), body);
    if (!saved) return;
    merge(saved);
    if (threadRoot) {
        replyDraft.value = '';
        replyingTo.value = '';
    } else {
        draft.value = '';
        anchor.value = null;
        filter.value = 'open';
    }
}

function toggleReply(root) {
    const id = String(root._id);
    replyingTo.value = replyingTo.value === id ? '' : id;
    replyDraft.value = '';
}

/* The server stores text escaped; editing starts from what the reader saw. */
function startEdit(item) {
    editingId.value = String(item._id);
    editDraft.value = decodeCommentText(item.message);
}

async function saveEdit(item) {
    if (!editDraft.value.trim()) return;
    const saved = await write('put', `${base()}/${item._id}`, { message: editDraft.value });
    if (!saved) return;
    merge(saved);
    editingId.value = '';
}

async function setResolved(root, resolved) {
    const saved = await write('put', `${base()}/${root._id}/resolve`, { resolved });
    if (saved) merge(saved);
}

async function remove(item) {
    const question = item.parentId ? t('Docs.comment_delete_confirm') : t('Docs.comment_delete_thread_confirm');
    if (!window.confirm(question)) return;
    const done = await write('delete', `${base()}/${item._id}`);
    if (done) merge({ ...item, isDeleted: true });
}

function useCurrentBlock() {
    const block = props.pickBlock ? props.pickBlock() : null;
    if (!block || !block.id) {
        anchorHint.value = t('Docs.comment_pick_block_first');
        return;
    }
    anchorHint.value = '';
    anchor.value = { id: block.id, text: (block.text || '').slice(0, EXCERPT) };
    if (composer.value) composer.value.focus();
}

function startOnBlock(block) {
    if (!block || !block.id) return;
    filter.value = 'open';
    anchorHint.value = '';
    anchor.value = { id: block.id, text: (block.text || '').slice(0, EXCERPT) };
    nextTick(() => composer.value && composer.value.focus());
}

let joinedRoom = '';
const onEvent = (payload) => merge(payload && payload.fullDocument);

function leave() {
    const live = socket && socket.value;
    if (!live) return;
    EVENTS.forEach((event) => live.off(event, onEvent));
    if (joinedRoom) live.emit('leaveCommentRoom', joinedRoom);
    joinedRoom = '';
}

function join() {
    leave();
    const live = socket && socket.value;
    if (!live || !live.id || !props.pageId) return;
    joinedRoom = `pagecomments_${props.pageId}**${live.id}`;
    live.emit('joinCommentRoom', { roomName: joinedRoom, socketId: live.id });
    EVENTS.forEach((event) => live.on(event, onEvent));
}

watch(() => props.pageId, () => {
    comments.value = [];
    anchor.value = null;
    replyingTo.value = '';
    editingId.value = '';
    load();
    join();
}, { immediate: true });
watch(() => socket && socket.value && socket.value.id, () => join());
watch(() => props.focusId, (id) => focusComment(id));
onBeforeUnmount(leave);

defineExpose({ startOnBlock });
</script>

<style scoped>
.pcm {
    width: 340px; flex: none; min-height: 0;
    display: flex; flex-direction: column;
    border-left: 1px solid var(--hairline);
    background: var(--surface);
    font-family: var(--font-ui); color: var(--ink);
}
.pcm__head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--hairline); flex-wrap: wrap; }
.pcm__title { margin: 0; font: 600 14px/1.3 var(--font-ui); flex: 1 1 auto; }
.pcm__tabs { flex: none; }
.pcm__icon, .pcm__tool {
    border: 0; background: transparent; padding: 0; cursor: pointer; color: var(--ink-2);
    display: inline-flex; align-items: center; justify-content: center; border-radius: 6px;
}
.pcm__icon { width: 28px; height: 28px; }
.pcm__tool { height: 22px; padding: 0 6px; font: 500 11.5px/1 var(--font-ui); }
.pcm__icon:hover, .pcm__tool:hover { background: var(--surface-hover); color: var(--ink); }
.pcm__tool--danger:hover { background: var(--danger-bg); color: var(--danger-ink); }

.pcm__list { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 10px 12px; display: flex; flex-direction: column; gap: 10px; }
.pcm__empty { margin: 8px 0; font: var(--text-small); color: var(--ink-2); }
.pcm__thread { border: 1px solid var(--hairline); border-radius: 10px; padding: 10px; background: var(--surface); display: flex; flex-direction: column; gap: 8px; }
.pcm__thread.is-focused { border-color: var(--brand); box-shadow: var(--focus); }
.pcm__anchor {
    display: flex; align-items: center; gap: 6px; max-width: 100%;
    border: 0; border-left: 3px solid var(--brand); border-radius: 0 6px 6px 0;
    background: var(--brand-tint); color: var(--ink); padding: 4px 8px; margin: 0;
    font: 400 12px/1.4 var(--font-ui); text-align: left; cursor: pointer;
}
.pcm__anchor--gone { border-left-color: var(--border); background: var(--surface-2); color: var(--ink-2); cursor: default; }
.pcm__anchor-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.pcm__item { display: flex; flex-direction: column; gap: 3px; }
.pcm__item--reply { padding-left: 14px; border-left: 2px solid var(--hairline); }
.pcm__meta { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 12px; }
.pcm__who { font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pcm__when { color: var(--ink-2); white-space: nowrap; }
.pcm__tools { margin-left: auto; display: inline-flex; gap: 2px; }
.pcm__text { margin: 0; font: 400 13px/1.5 var(--font-ui); white-space: pre-wrap; overflow-wrap: anywhere; }
.pcm__text :deep(.mentioned) { color: var(--brand); font-weight: 600; }
.pcm__text :deep(a) { color: var(--brand); }

.pcm__row { display: flex; justify-content: flex-end; gap: 6px; flex-wrap: wrap; }
.pcm__row--thread { justify-content: flex-start; }
.pcm__edit, .pcm__reply { display: flex; flex-direction: column; gap: 6px; }

.pcm__compose { flex: none; border-top: 1px solid var(--hairline); padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 6px; background: var(--surface-2); }
.pcm__target { display: flex; align-items: center; gap: 6px; min-width: 0; flex-wrap: wrap; }
.pcm__chip { min-width: 0; max-width: 100%; }
.pcm__hint { margin: 0; font: var(--text-small); color: var(--ink-2); flex: 1 1 auto; }
.pcm__unanchor { border: 0; background: none; padding: 0 0 0 4px; color: inherit; cursor: pointer; font-size: 10px; }

@media (max-width: 767px) {
    .pcm { position: absolute; inset: 0; z-index: 25; width: auto; border-left: 0; }
}
</style>
