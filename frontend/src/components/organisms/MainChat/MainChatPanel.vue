<template>
  <div class="mc-shell">
    <!-- A click or keystroke anywhere in the conversation is what marks it read;
         merely having it on screen is not (see `engaged`). -->
    <section class="mc" @click="onEngage" @keydown="onEngage">
        <MainChatHeader
            :title="title"
            :subtitle="subtitle"
            :avatar-src="avatarSrc"
            :presence="presence"
            :is-channel="isChannel"
            :icon="icon"
            :active-pane="rightPane"
            :details-open="rightPane === 'info'"
            :summarizing="summarizing"
            :asking="askOpen"
            @summarize="summarize"
            @ask="toggleAsk"
            @search="toggleRightPane('search')"
            @pinned="toggleRightPane('pinned')"
            @info="toggleRightPane('info')"
        >
            <!-- Forwarded so the page that owns the layout can put its own control here.
                 The panel does not know whether a conversation list exists beside it. -->
            <template #lead><slot name="header-lead"></slot></template>
            <template #call-actions>
                <!-- Calling is one-to-one only: a channel has many members and no peer to
                     ring. It also needs a real conversation task to authorise against, so
                     a chat that has not sent its first message yet cannot start one. -->
                <template v-if="canCall">
                    <button
                        type="button"
                        class="mc-icon-btn"
                        :disabled="callBusy"
                        :title="$t('call.start_audio')"
                        @click="startCall(effectiveTaskId, 'audio')"
                    ><CallIcon name="phone" :size="16" /></button>
                    <button
                        type="button"
                        class="mc-icon-btn"
                        :disabled="callBusy"
                        :title="$t('call.start_video')"
                        @click="startCall(effectiveTaskId, 'video')"
                    ><CallIcon name="video" :size="16" /></button>
                </template>
                <slot name="call-actions"></slot>
            </template>
            <template #actions><slot name="header-actions"></slot></template>
        </MainChatHeader>

        <MainChatMessageList
            ref="list"
            :messages="messages"
            :loading="loading"
            :loading-older="loadingOlder"
            :has-more="hasMore"
            :empty-title="emptyTitle"
            :unread-anchor-id="unreadAnchorId"
            :unread-count="unreadAtOpen"
            :typing-ids="typingIds"
            :typing-label="typingLabel"
            @load-older="loadOlder"
            @reply="replyTo = $event"
            @thread="openThread($event)"
            @copy="copyMessage"
            @remove="confirmRemove"
            @retry="retry"
            @preview="openPreview"
            @react="({ message, emoji }) => toggleReaction(message, emoji)"
            @pin="onPin"
            @mark-unread="onMarkUnread"
            @edit="editingMessage = $event"
            @make-task="openTaskSheet($event && $event.text)"
            @save-later="onSaveLater"
        />

        <MainChatComposer
            :reply-to="replyTo"
            :editing="editingMessage"
            :disabled="!sendMessageAllowed"
            :disabled-reason="composerLockReason"
            :user-ids="watchers"
            :agents="mentionableAgents"
            :conversation-key="conversationKey"
            @typing="setTyping"
            @send="onSend"
            @send-task="onSendTask"
            @command="onCommand"
            @files="onFiles"
            @save="onSaveEdit"
            @cancel-reply="replyTo = null"
            @cancel-edit="editingMessage = null"
        />
    </section>

    <!-- The details pane and search share the right-hand column, so only one is
         ever open; the header buttons toggle between them. -->
    <MainChatInfo
        v-if="rightPane === 'info'"
        :title="title"
        :avatar-src="avatarSrc"
        :is-channel="isChannel"
        :icon="icon"
        :peer-id="peerId"
        :participants="watchers"
        :messages="messages"
        @close="rightPane = ''"
        @preview="openPreview"
        @open="openSearchHit"
    />

    <!-- Same pane in two modes: free-text search, or this conversation's pinned
         messages. `key` forces a remount on the switch so it reloads cleanly. -->
    <MainChatSearch
        v-else-if="rightPane === 'search' || rightPane === 'pinned'"
        :key="rightPane"
        :mode="rightPane"
        :project-id="projectId"
        :sprint-id="sprintId"
        :task-id="effectiveTaskId"
        :conversation-key="conversationKey"
        @close="rightPane = ''"
        @open="openSearchHit"
        @unpin="onUnpinFromList"
    />

    <MainChatThread
        v-else-if="rightPane === 'thread' && threadRootId"
        :key="threadRootId"
        ref="threadPane"
        :root="threadRoot"
        :target="conversationTarget"
        :where="sourceLabel"
        :user-ids="watchers"
        :agents="mentionableAgents"
        :conversation-key="conversationKey"
        :disabled="!sendMessageAllowed"
        :disabled-reason="composerLockReason"
        :sender="sender"
        :focus-id="threadFocusId"
        @close="closeThread"
        @copy="copyMessage"
        @remove="confirmRemove($event, threadPane && threadPane.remove)"
        @preview="openPreview"
        @make-task="openTaskSheet($event && $event.text)"
        @command="onCommand"
    />

    <MainChatSummary
        v-if="summaryState"
        :loading="summarizing"
        :error="summaryState.error"
        :summary="summaryState.summary"
        :items="summaryState.items"
        @close="closeSummary"
        @create-task="(item) => openTaskSheet(item.title, item)"
    />

    <MainChatAsk
        v-if="askOpen"
        :project-id="projectId"
        :sprint-id="sprintId"
        :task-id="effectiveTaskId"
        @close="askOpen = false"
    />

    <MakeTaskSheet
        v-if="taskDraft"
        :initial-title="taskDraft.title"
        :source-text="taskDraft.sourceText"
        :source-label="sourceLabel"
        :source-url="sourceUrl"
        :default-project-id="(linkedProject && linkedProject._id) || ''"
        @close="taskDraft = null"
        @created="onTaskCreated"
    />

    <!--
      The same previewer task attachments and comments use, so an attachment
      opened from chat gets identical zoom / pdf / doc / video handling.

      Mounted as soon as there are items but only SHOWN on the next tick: the
      component's `isImageWrapperAvailable` is a non-reactive computed over
      document.getElementById, so if it were first evaluated with showPreviewer
      already true — before its own onMounted created that element — it would
      cache false forever and the previewer would never open again.
    -->
    <ImagesPreviewer
        v-if="previewItems.length"
        :items="previewItems"
        :showPreviewer="previewOpen"
        :activeIndex="previewIndex"
        :config="{ handlesTimer: 2000 }"
        @close="previewOpen = false"
    />
  </div>
</template>

<script setup>
import { defaultStatus } from '@/components/organisms/QuickCreateTask/quickCreateTask';
/**
 * The Main Chat conversation surface.
 *
 * Deliberately independent of views/Projects/Comments/Comments.vue (which stays
 * shared by task comments and project comments and is NOT touched): this module
 * owns the chat look and its own orchestration, while reusing the same message
 * helpers underneath so both write identical documents.
 *
 * Conversation identity, matching existing behaviour:
 *   one-to-one -> default chat project; taskId = DM task id, sprintId = its sprint
 *   channel    -> chat project;         taskId = "default",  sprintId = channel id
 *
 * A brand-new one-to-one has no task yet: `newChat` is true and `taskId` holds the
 * OTHER USER's id. The first message creates the conversation task, then sends.
 */
import { computed, defineProps, defineEmits, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useStore } from 'vuex';
import { useRoute, useRouter } from 'vue-router';
import { useToast } from 'vue-toast-notification';
import { useI18n } from 'vue-i18n';
import Swal from '@/utils/lazySwal';
import taskClass from '@/utils/TaskOperations';
import * as env from '@/config/env';
import { apiRequest } from '@/services';
import { useGetterFunctions } from '@/composable';
import { storageHelper, taskPlanPermission } from '@/composable/commonFunction';
import ImagesPreviewer from '@/components/organisms/ImagePreviewer/ImagesPreviewer.vue';
import MainChatHeader from './MainChatHeader.vue';
import MainChatAsk from './MainChatAsk.vue';
import MainChatMessageList from './MainChatMessageList.vue';
import MainChatComposer from './MainChatComposer.vue';
import MainChatInfo from './MainChatInfo.vue';
import MainChatSearch from './MainChatSearch.vue';
import MainChatThread from './MainChatThread.vue';
import MainChatSummary from './MainChatSummary.vue';
import MakeTaskSheet from './MakeTaskSheet.vue';
import { canUseAi, loadAiAvailability } from '@/composable/aiAvailability';
import { useClipRecorder } from '@/composables/useClipRecorder';
import { shellState } from '@/components/organisms/Shell/shellState';
import CallIcon from '@/components/organisms/CallOverlay/CallIcon.vue';
import { useCall } from '@/composable/useCall';
import { useMainChatConversation } from './useMainChatConversation';
import { fetchChatAgents, fetchOwnAiInChat } from '@/views/Ai/useRunnableAgents';

const props = defineProps({
    // conversation target
    taskId: { type: String, default: '' },
    sprintId: { type: String, default: '' },
    folderId: { type: String, default: '' },
    newChat: { type: Boolean, default: false },
    // Everyone in the conversation (DM: both participants; channel: its members).
    // Drives unread badges and push notifications for the other side.
    watchers: { type: Array, default: () => [] },
    // presentation
    title: { type: String, default: '' },
    subtitle: { type: String, default: '' },
    avatarSrc: { type: String, default: '' },
    presence: { type: Boolean, default: null },
    isChannel: { type: Boolean, default: false },
    // A channel's own icon. The create-channel flow spreads the chosen image /
    // glyph onto the channel document, so this is normally the channel itself.
    icon: { type: Object, default: () => ({}) },
    sendMessageAllowed: { type: Boolean, default: true },
    linkedProject: { type: Object, default: null },
    // Set on a direct conversation with an agent: every message there goes to it.
    agentId: { type: String, default: '' },
});

// Attachment previews, search and the details pane are all owned here rather than
// pushed to the parent, so the module stays self-contained.
const emit = defineEmits(['created']);

const store = useStore();
const { getters } = store;
const $toast = useToast();
const { t } = useI18n();
const { getUser } = useGetterFunctions();
const { checkTaskPerSprintPermisssion } = taskPlanPermission();
const { handleStorageImageRequest } = storageHelper();

const projectData = inject('selectedProject');
const companyId = inject('$companyId');
const userId = inject('$userId');
const socket = inject('$socket');

const list = ref(null);
const replyTo = ref(null);
const editingMessage = ref(null);

// '' | 'info' | 'search' | 'pinned' | 'thread' — the right-hand column holds one pane at a time.
const rightPane = ref('');
function toggleRightPane(which) {
    rightPane.value = rightPane.value === which ? '' : which;
}

// In a one-to-one the "peer" is the other participant; used by the detail pane.
const peerId = computed(() => {
    if (props.isChannel) return '';
    return (props.watchers || []).find((id) => id && id !== userId.value) || props.taskId || '';
});
// Set once a brand-new DM has been created, so subsequent sends address the task.
const createdTaskId = ref('');
const creating = ref(false);

const isDefaultProject = computed(() => !!(projectData && projectData.value && projectData.value.default));

const projectId = computed(() => (projectData && projectData.value && projectData.value._id) || '');


/** The task the messages hang off: "default" for channels, the DM task otherwise. */
const effectiveTaskId = computed(() => {
    if (!isDefaultProject.value) return 'default';
    return createdTaskId.value || (props.newChat ? '' : props.taskId);
});

const conversationKey = computed(() => `${(projectData && projectData.value && projectData.value._id) || ''}:${props.sprintId}:${effectiveTaskId.value || props.taskId}`);

const mentionableAgents = ref([]);
async function loadMentionableAgents() {
    const taskId = effectiveTaskId.value;
    const key = conversationKey.value;
    if (props.agentId || !projectId.value || !props.sprintId || !taskId) {
        mentionableAgents.value = [];
        return;
    }
    const thread = { projectId: projectId.value, sprintId: props.sprintId, taskId };
    // An in-product agent needs a model on the server; the person's own connected AI does not.
    const agents = (await Promise.all([canUseAi() ? fetchChatAgents(thread) : [], fetchOwnAiInChat(thread)])).flat();
    if (key === conversationKey.value) mentionableAgents.value = agents;
}
watch([conversationKey, () => canUseAi()], loadMentionableAgents, { immediate: true });

// ─── Calling ────────────────────────────────────────────────────────────────────
// One-to-one only, and only once the conversation task exists — the server authorises
// a call by loading that task and checking the caller is one of its two participants,
// so there is nothing to authorise against before the first message is sent.
const { startCall, isBusy: callBusy, isSupported: callSupported, isSecure: callSecure } = useCall();
const canCall = computed(() => !props.isChannel
    && !props.agentId
    && isDefaultProject.value
    && !!effectiveTaskId.value
    && effectiveTaskId.value !== 'default'
    && callSupported()
    && callSecure());

const emptyTitle = computed(() => (props.isChannel
    ? t('MainChat.empty_channel')
    : t('MainChat.empty_direct')));

const typingIds = computed(() => Object.keys(typingUsers.value || {}));

/**
 * Hover text for the typing bubble. The bubble itself carries avatars rather than a
 * sentence — this is what makes it readable to a screen reader and on hover.
 *
 * A direct message needs no name: there is only one other person. A channel does,
 * because knowing WHO is about to speak is the useful part; past two it becomes noise,
 * so it collapses to a count.
 */
const typingLabel = computed(() => {
    const ids = typingIds.value;
    if (!ids.length) return '';

    if (!props.isChannel) return t('MainChat.typing');

    const names = ids
        .map((id) => (getUser(id) || {}).Employee_Name)
        .filter(Boolean);

    if (!names.length) return t('MainChat.typing');
    if (names.length === 1) return t('MainChat.typing_one', { name: names[0] });
    if (names.length === 2) return t('MainChat.typing_two', { first: names[0], second: names[1] });
    return t('MainChat.typing_many', { count: names.length });
});

/** Why the composer is closed — a channel switched to read-only, or read-only DMs. */
const composerLockReason = computed(() => {
    if (props.sendMessageAllowed) return '';
    return props.isChannel ? t('MainChat.read_only_channel') : t('MainChat.read_only_direct');
});


const conversationTarget = computed(() => ({
    projectId: projectId.value,
    sprintId: props.sprintId,
    taskId: effectiveTaskId.value,
    folderId: props.folderId,
    isDefaultProject: isDefaultProject.value,
}));

const sender = computed(() => {
    const me = getUser(userId.value) || {};
    const owner = getters['settings/companyOwnerDetail'];
    return {
        id: me._id || me.id,
        Employee_Name: me.Employee_Name,
        companyOwnerId: owner && owner.userId,
    };
});

const threadPane = ref(null);

const {
    messages, loading, loadingOlder, hasMore,
    load, loadOlder, catchUp, typingUsers, setTyping,
    attach, detach, sendText, sendMedia, sendFiles, retry, removeMessage, markRead,
    toggleReaction, togglePin, markUnreadFrom, editText,
} = useMainChatConversation({
    socket,
    companyId,
    userId,
    target: () => conversationTarget.value,
    observe: (doc) => { if (threadPane.value) threadPane.value.receive(doc); },
    // A brand-new DM has no watchers list yet — both participants are known from
    // the target user and me.
    participants: () => (props.watchers && props.watchers.length
        ? props.watchers
        : [userId.value, props.taskId].filter(Boolean)),
    watcherPrefs: () => (projectData && projectData.value && projectData.value.watchers) || {},
    currentUser: () => sender.value,
});

/* ------------------------------------------------------------------ *
 * threads
 *
 * A thread opens in the right-hand column, which is a full-width sheet on a phone. The
 * page is remounted for each conversation, so a thread never outlives the one it is in.
 * ------------------------------------------------------------------ */
const route = useRoute();
const router = useRouter();
const threadRootId = ref('');
const threadFocusId = ref('');

const threadRoot = computed(() => messages.value.find((m) => String(m._id || '') === threadRootId.value)
    || { _id: threadRootId.value });

function openThread(message, focusId = '') {
    const id = String((message && message._id) || '');
    if (!id) return;
    threadRootId.value = id;
    threadFocusId.value = focusId;
    rightPane.value = 'thread';
}

/* A notice links to a thread with ?thread=<id>; once that thread is closed the link is spent. */
function forgetThreadLink() {
    if (!router || !route || !route.query || !route.query.thread) return;
    const query = { ...route.query };
    delete query.thread;
    Promise.resolve(router.replace({ query })).catch(() => {});
}

function closeThread() {
    if (rightPane.value === 'thread') rightPane.value = '';
}

watch(rightPane, (pane) => {
    if (pane === 'thread' || !threadRootId.value) return;
    threadRootId.value = '';
    threadFocusId.value = '';
    forgetThreadLink();
});

watch(() => (route && route.query ? route.query.thread : ''), (id) => {
    if (id) openThread({ _id: String(id) });
}, { immediate: true });

const fileExtentions = computed(() => getters['settings/fileExtentions'] || []);

/* ------------------------------------------------------------------ *
 * unread
 *
 * The badge lives in the shared counter store, keyed per conversation — the same
 * value the sidebar tree and the tab counts read. Opening a conversation clears
 * it, so the count has to be captured BEFORE that happens or there is nothing
 * left to draw the "where you left off" line from.
 * ------------------------------------------------------------------ */
const unreadKey = computed(() => {
    if (!projectId.value || !effectiveTaskId.value) return '';
    return `task_${projectId.value}_${props.sprintId}_${effectiveTaskId.value}_comments`;
});

const unreadCount = computed(() => {
    const counts = (getters['users/myCounts'] && getters['users/myCounts'].data) || {};
    return Number(counts[unreadKey.value] || 0);
});

// What the "where you left off" line is drawn from. Captured when the conversation
// opens and cleared when it is marked read — never derived from the live count, or
// it would move as messages arrive.
const unreadAtOpen = ref(0);
const unreadAnchorId = ref('');

/**
 * Mirror a count change into the local counter store.
 *
 * The server write is only reflected back to this client by the
 * `userIdNoticationUpdate` socket echo. Without this patch the badge lags that
 * round trip — and if the echo does not arrive, the value never lands at all:
 * "Mark as unread" then showed its line but left the sidebar badge blank, and
 * re-opening the conversation read 0 and drew nothing. The shared comment
 * component does the same commit for the read direction; this covers both.
 *
 * Only the per-conversation `task_…` key is touched — the one thing the chat
 * module actually reads. The sprint/project rollups belong to the task-comment
 * surface and the server remains their source of truth.
 */
function writeLocalCount(value) {
    const key = unreadKey.value;
    if (!key) return;

    const counts = getters['users/myCounts'] || {};
    const current = { ...(counts.data || {}) };
    if (Number(current[key] || 0) === value) return;

    if (value > 0) current[key] = value;
    else delete current[key];

    store.commit('users/mutateCounts', { ...counts, data: current });
}

/**
 * Mark read: clear the badge, and drop the "where you left off" line with it.
 *
 * Both go at the same moment, because they are two views of one fact. Keeping the
 * line after the count was cleared left the conversation claiming unread messages
 * it no longer had.
 */
function readConversation() {
    if (!markRead()) return;
    writeLocalCount(0);
    unreadAtOpen.value = 0;
    unreadAnchorId.value = '';
}

/**
 * Re-read the authoritative counter document and publish it.
 *
 * Used after "Mark as unread" INSTEAD of trusting the optimistic patch: an
 * optimistic value looks correct even when the server write did not stick, and
 * that is what made this so slippery — the badge appeared, survived a tab switch
 * (local state), then vanished on reload or as soon as the socket echoed the real
 * document back a few seconds later.
 *
 * A raw request rather than dispatch('users/myCounts'), because that action
 * re-registers its socket listener on every call and would stack duplicates.
 */
async function refreshCounts() {
    try {
        const response = await apiRequest('get', `${env.USER_ID_COLLECTION}/${userId.value}`);
        const data = response && response.data && response.data.data;
        if (data) store.commit('users/mutateCounts', { type: 'add', data });
    } catch (error) {
        console.error('MainChat: could not refresh unread counts', error);
    }
}

// Newest message we have already accounted for, so the watcher below can tell an
// incoming message from an older page being prepended.
let newestSeenId = '';

// Set by "Mark as unread": the reader has deliberately asked for the badge back,
// so the automatic clear-on-incoming / clear-on-focus must not immediately undo
// it. Mirrors the legacy component's resetUnread guard. Reset on open().
let keepUnread = false;

/**
 * Has the reader actually engaged with this conversation — a click or a keystroke
 * inside it — as opposed to it merely being on screen?
 *
 * This is what marks it read, NOT opening it. Selecting a conversation is often
 * not the reader's doing: landing on a chat URL, or reloading the page,
 * auto-selects one. Clearing the count there wiped a deliberate "mark as unread"
 * without anyone touching it — which is what a refresh was doing. The previous
 * chat module drew the same line (it cleared on click), so this also matches what
 * production does today.
 */
let engaged = false;

function onEngage(event) {
    if (engaged || keepUnread) return;

    // Only a REAL interaction counts. MainChatMessage.closeMenu() dismisses the ⋮
    // menu by calling .click() on its own trigger, and that synthetic event
    // bubbles up here — so every use of the message menu fired a mark-read POST.
    // For "Mark as unread" that POST raced the mark-unread POST from the very item
    // being chosen; whichever landed last won. Local state made it look right, so
    // the badge survived a tab switch but a reload — which re-reads the server —
    // showed everything read again.
    if (!event || event.isTrusted !== true) return;

    // And opening a message's menu is not "reading the conversation": that is how
    // you get to "Mark as unread" in the first place.
    if (event.target && event.target.closest && event.target.closest('.mc-msg-tools')) return;

    engaged = true;
    readConversation();
}

/**
 * Has the counter document been fetched yet?
 *
 * `type` rather than `data`: the store slice starts as a bare {}, and the fetch
 * commits { type, data } — where `data` is legitimately null for a user who has no
 * counter document yet. Keying off `data` treated that as "still loading" and made
 * every conversation open sit through the timeout below.
 */
function countsReady() {
    const counts = getters['users/myCounts'];
    return !!(counts && (counts.data || counts.type));
}

/**
 * The unread count for this conversation, waiting for the counter document if it
 * has not landed yet.
 *
 * A page load that goes straight to a chat URL can open the conversation before
 * the counts request resolves, and reading 0 there loses the line entirely.
 * Bounded, so a failed counts request cannot wedge the conversation shut.
 */
function pendingUnread() {
    if (countsReady()) return Promise.resolve(unreadCount.value);

    return new Promise((resolve) => {
        let settled = false;
        let stop = null;
        let timer = null;

        const finish = () => {
            if (settled) return;
            settled = true;
            if (stop) stop();
            if (timer) clearTimeout(timer);
            resolve(unreadCount.value);
        };

        timer = setTimeout(finish, 5000);
        stop = watch(() => getters['users/myCounts'], () => {
            if (countsReady()) finish();
        });
    });
}

/**
 * Pull in enough history that every unread message is actually on screen.
 *
 * A page is 25; a backlog can be larger, and a divider pointing at a message that
 * was never loaded would sit at the very top claiming everything is unread.
 * Bounded, because chasing a thousand-message backlog on open is worse than
 * showing the line as high as we got.
 */
async function backfillUnread(pending) {
    let pages = 0;
    while (pending > messages.value.length && hasMore.value && pages < 8) {
        await loadOlder();
        pages += 1;
    }
}

/* ------------------------------------------------------------------ *
 * lifecycle — reload whenever the open conversation changes
 * ------------------------------------------------------------------ */
async function open() {
    detach();
    replyTo.value = null;
    messages.value = [];
    unreadAtOpen.value = 0;
    unreadAnchorId.value = '';
    newestSeenId = '';
    keepUnread = false;
    engaged = false;

    // Nothing to read yet for an unstarted DM: show the empty state, keep the
    // composer live so the first message creates the conversation.
    if (isDefaultProject.value && !effectiveTaskId.value) return;
    if (!props.sprintId) return;

    // In parallel: the counter document is usually already in the store, in which
    // case this resolves immediately and costs nothing.
    const [pending] = await Promise.all([pendingUnread(), load()]);

    if (pending > 0) {
        await backfillUnread(pending);
        const index = Math.max(0, messages.value.length - pending);
        const anchor = messages.value[index];
        if (anchor) {
            unreadAtOpen.value = Math.min(pending, messages.value.length);
            unreadAnchorId.value = idOf(anchor);
        }
    }

    newestSeenId = idOf(messages.value[messages.value.length - 1]);

    attach();
    // NOT marked read here — see `engaged` above. The first click or keystroke in
    // the pane does it, so a reload that auto-selects this conversation cannot
    // silently consume the unread state.
}

/**
 * Someone else posting while I am sitting in the conversation must not raise my
 * badge — I am looking at it. Keyed on the newest id rather than the length so
 * paging in older messages does not trigger a pointless write.
 */
watch(() => messages.value.length, () => {
    const latest = messages.value[messages.value.length - 1];
    const id = idOf(latest);
    if (!id || id === newestSeenId) return;
    newestSeenId = id;
    // Only once the reader has engaged: before that the conversation is merely on
    // screen, and a new arrival should still raise the badge.
    if (keepUnread || !engaged || !latest || latest.sent || latest.isSending) return;
    readConversation();
});

/**
 * markRead() deliberately does nothing while the tab is in the background, so a
 * message that arrived then stays counted even though the conversation is open.
 * Clear it when the reader actually comes back.
 */
function onWindowFocus() {
    // Coming back to the window is the last line of defence: if anything was missed
    // while it was in the background — the socket dropped, or an event simply did not
    // land — this pulls it in. Cheap and idempotent, so it costs one request.
    catchUp();
    if (threadPane.value) threadPane.value.refresh();

    if (keepUnread || !engaged) return;
    if (unreadCount.value > 0) readConversation();
}

/**
 * "Mark as unread" from the message menu.
 *
 * Draws the line immediately rather than waiting for the conversation to be
 * re-opened — which also makes this the way to exercise the whole unread path
 * single-handed, with no second account and no second message.
 */
async function onMarkUnread(message) {
    const index = messages.value.findIndex((m) => idOf(m) === idOf(message));
    if (index === -1) return;

    // Set BEFORE awaiting: this runs inside the menu item's click, which then
    // carries on bubbling to onEngage. Setting it after the await would let that
    // same click mark the conversation read again.
    keepUnread = true;

    const count = await markUnreadFrom(message);
    if (!count) {
        keepUnread = false;
        $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
        return;
    }

    unreadAtOpen.value = count;
    unreadAnchorId.value = idOf(message);
    $toast.success(t('MainChat.marked_unread'), { position: 'top-right' });

    // Read the count back from the server rather than assuming it landed, so the
    // badge shows what will still be there after a reload — nothing else.
    await refreshCounts();

    if (unreadCount.value !== count) {
        // Loud on purpose: the badge and the banner disagreeing means the write did
        // not persist, and that is a server-side problem no client patch can hide.
        console.error(
            'MainChat: mark-unread did not persist server-side',
            { key: unreadKey.value, expected: count, stored: unreadCount.value },
        );
    }
}

watch(
    () => [conversationKey.value, props.newChat],
    () => { createdTaskId.value = props.newChat ? '' : createdTaskId.value; open(); },
    { immediate: true },
);

/**
 * Subscribe once the socket exists — or exists again.
 *
 * attach() needs a live socket and simply returns if there is none, without retrying.
 * The connection is established asynchronously during app start-up, and App.vue also
 * REPLACES the instance when the tab comes back from being hidden. Either way a
 * conversation that was already open stayed subscribed to nothing.
 *
 * Watching the ref identity (not the id) is deliberate: it fires exactly when a new
 * instance is assigned, and avoids treating the Socket object itself as reactive state.
 */
watch(() => (socket ? socket.value : null), (instance) => {
    if (!instance) return;
    if (!props.sprintId) return;
    if (isDefaultProject.value && !effectiveTaskId.value) return;
    attach();
    // A replaced instance means we were disconnected — recover whatever was sent while
    // we were away, not just future messages.
    catchUp();
    if (threadPane.value) threadPane.value.refresh();
});

onMounted(() => window.addEventListener('focus', onWindowFocus));
onBeforeUnmount(() => {
    window.removeEventListener('focus', onWindowFocus);
    detach();
});

/* ------------------------------------------------------------------ *
 * new one-to-one: create the conversation task on first message
 * ------------------------------------------------------------------ */
async function createDirectConversation() {
    const project = projectData && projectData.value;
    const sprint = project && project.sprintsObj
        ? Object.values(project.sprintsObj)[0]
        : null;
    const status = defaultStatus(project);
    const taskType = project && project.taskTypeCounts ? project.taskTypeCounts[0] : null;

    if (!project || !sprint || !status || !taskType) {
        $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
        return '';
    }

    const allowed = await checkTaskPerSprintPermisssion(sprint.id || sprint._id).catch(() => true);
    if (!allowed) {
        $toast.error(t('Toast.create_task_plan_limit_message').replace('TASK_SPRINT', sprint.name), { position: 'top-right' });
        return '';
    }

    const me = getUser(userId.value);
    const companyOwner = getters['settings/companyOwnerDetail'];
    // Both participants must be assignees: the conversation list is filtered by
    // AssigneeUserId, so leaving one out hides the chat from that person.
    const participants = [userId.value, props.taskId];

    const payload = {
        TaskName: 'Chat',
        TaskKey: '--',
        AssigneeUserId: participants,
        watchers: participants,
        DueDate: '',
        dueDateDeadLine: [],
        TaskType: taskType.value,
        TaskTypeKey: taskType.key,
        ParentTaskId: '',
        ProjectID: project._id,
        CompanyId: companyId.value,
        status: { text: status.name, key: status.key, value: status.value, type: status.type },
        isParentTask: true,
        Task_Leader: userId.value,
        sprintArray: { id: sprint.id || sprint._id, name: sprint.name, value: sprint.value },
        Task_Priority: 'MEDIUM',
        deletedStatusKey: 0,
        sprintId: sprint.id || sprint._id,
        statusType: status.type,
        statusKey: status.key,
        mainChat: true,
    };

    const result = await taskClass.create({
        data: payload,
        user: {
            id: me.id,
            Employee_Name: me.Employee_Name,
            companyOwnerId: companyOwner && companyOwner.userId,
        },
        projectData: {
            _id: project._id,
            CompanyId: companyId.value,
            lastTaskId: project.lastTaskId || 0,
            ProjectName: project.ProjectName,
            ProjectCode: project.ProjectCode || '',
        },
        indexObj: { indexName: 'groupByStatusIndex', searchKey: 'statusKey', searchValue: 1 },
    });

    return (result && result.id) || '';
}

/** Ensure there is a conversation to post into; returns false if we can't make one. */
async function ensureConversation() {
    if (!isDefaultProject.value || effectiveTaskId.value) return true;
    if (creating.value) return false;

    creating.value = true;
    try {
        const newId = await createDirectConversation();
        if (!newId) return false;
        createdTaskId.value = newId;
        emit('created', newId);
        await nextTick();
        attach();
        return true;
    } catch (error) {
        console.error('MainChat: could not start conversation', error);
        $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
        return false;
    } finally {
        creating.value = false;
    }
}

/* ------------------------------------------------------------------ *
 * actions
 * ------------------------------------------------------------------ */
async function onSend(text) {
    if (!(await ensureConversation())) return;
    const reply = replyTo.value ? { ...replyTo.value } : {};
    replyTo.value = null;
    await sendText(text, reply);
}

async function onFiles(files) {
    if (!(await ensureConversation())) return;
    await sendFiles(files.map((f) => f), fileExtentions.value);
}

async function onSendTask(text) {
    openTaskSheet(text);
    await onSend(text);
}

async function onSaveLater(message) {
    const saved = await togglePin(message);
    $toast.success(t(saved ? 'Chat.saved_later' : 'Chat.unsaved_later'), { position: 'top-right' });
}

const askOpen = ref(false);
function toggleAsk() {
    if (!askOpen.value) closeSummary();
    askOpen.value = !askOpen.value;
}
watch(conversationKey, () => { askOpen.value = false; });

const summarizing = ref(false);
const summaryState = ref(null);
// Bumped on every run and close, so an answer for a conversation left behind is dropped.
let summaryRun = 0;

function closeSummary() {
    summaryRun += 1;
    summaryState.value = null;
    summarizing.value = false;
}

async function summarize() {
    if (!canUseAi() || summarizing.value) return;
    askOpen.value = false;
    summaryRun += 1;
    const run = summaryRun;
    summaryState.value = { summary: '', items: [], error: '' };
    if (!projectId.value || !props.sprintId || !effectiveTaskId.value) return;

    summarizing.value = true;
    try {
        const response = await apiRequest('post', env.AI_CHAT_SUMMARY, {
            projectId: projectId.value,
            sprintId: props.sprintId,
            taskId: effectiveTaskId.value,
        });
        if (run !== summaryRun) return;
        const body = (response && response.data) || {};
        summaryState.value = body.status
            ? { summary: (body.data && body.data.summary) || '', items: (body.data && body.data.actionItems) || [], error: '' }
            : { summary: '', items: [], error: t('Chat.summary_failed') };
    } catch (error) {
        if (run !== summaryRun) return;
        const aiOff = !!(error && error.response && error.response.data && error.response.data.code === 'ai_off');
        summaryState.value = { summary: '', items: [], error: t(aiOff ? 'Chat.summary_ai_off' : 'Chat.summary_failed') };
        if (aiOff) loadAiAvailability(companyId.value);
    } finally {
        if (run === summaryRun) summarizing.value = false;
    }
}

watch(conversationKey, closeSummary);

const taskDraft = ref(null);
const sourceLabel = computed(() => (props.isChannel ? `#${props.title}` : props.title));
const sourceUrl = computed(() => (typeof window === 'undefined' ? '' : window.location.href));

function plainText(raw) {
    return String(raw || '').replace(/<[^>]*>/g, '').trim();
}

function openTaskSheet(text, item = null) {
    const body = plainText(text);
    taskDraft.value = { title: body.slice(0, 250), sourceText: body, item };
}

function onTaskCreated(created) {
    const item = taskDraft.value && taskDraft.value.item;
    if (item && created) item.taskUrl = created.url;
    taskDraft.value = null;
}

const { openRecorder } = useClipRecorder();

async function postClip(clip) {
    if (!clip || !clip.url) return;
    if (!(await ensureConversation())) return;
    const name = `${clip.title || 'clip'}.webm`;
    await sendMedia({
        type: clip.mediaType === 'audio' ? 'audio' : 'video',
        mediaURL: clip.url,
        mediaName: name,
        mediaOriginalName: name,
        mediaSize: clip.size || 0,
    });
}

function onCommand({ name, text } = {}) {
    if (name === 'summarize') summarize();
    else if (name === 'task') openTaskSheet(text || (replyTo.value && replyTo.value.message));
    else if (name === 'clip') openRecorder({ type: 'chat', conversationKey: conversationKey.value }, postClip);
    else if (name === 'talk' && canUseAi()) shellState.talkToText = true;
}

async function onPin(message) {
    const pinned = await togglePin(message);
    $toast.success(t(pinned ? 'MainChat.pinned_ok' : 'MainChat.unpinned_ok'), { position: 'top-right' });
}

/**
 * Unpin straight from the pinned list.
 *
 * togglePin flips whatever the message currently says, so the row is passed with
 * pinnedMessage forced true — a stale copy reading false would re-pin it instead.
 */
async function onUnpinFromList(message) {
    if (!message || !message._id) return;
    await togglePin({ ...message, pinnedMessage: true });
    $toast.success(t('MainChat.unpinned_ok'), { position: 'top-right' });
}

async function onSaveEdit(text) {
    const target = editingMessage.value;
    editingMessage.value = null;
    if (target) await editText(target, text);
}

/* ------------------------------------------------------------------ *
 * attachment preview
 *
 * Every attachment in the OPEN conversation is handed to the previewer, not just
 * the one clicked, so its arrows and filmstrip walk the conversation's files —
 * the same shape task attachments use (items + activeIndex).
 * ------------------------------------------------------------------ */
const previewOpen = ref(false);
const previewIndex = ref(0);
const previewItems = ref([]);
// mediaURL -> resolved URL. Signed URLs cost a request each, so re-opening the
// previewer in the same conversation is free.
const resolvedMedia = new Map();

/** Attachments of the loaded transcript, oldest first — the previewer's item list. */
const attachmentMessages = computed(() => messages.value.filter((m) => m
    && m.mediaURL
    && !m.isDeleted
    && !m.isSending
    && !['text', 'link'].includes(m.type)));

function idOf(message) {
    return String((message && (message._id || message.tempId)) || '');
}

async function resolveMediaUrl(message) {
    const path = (message && message.mediaURL) || '';
    if (!path) return '';
    // Already absolute (an optimistic local preview, or a legacy stored URL).
    if (path.includes('http')) return path;
    if (resolvedMedia.has(path)) return resolvedMedia.get(path);

    try {
        const result = await handleStorageImageRequest({
            companyId: companyId.value,
            data: { url: path },
            isCache: true,
        });
        // `.url` — the helper resolves to { url, downloadUrl }, never a bare string.
        const url = (result && result.url) || '';
        if (url) resolvedMedia.set(path, url);
        return url;
    } catch (error) {
        console.error('MainChat: could not resolve attachment URL', error);
        return '';
    }
}

/**
 * Shape a message into the item the previewer expects.
 *
 * `path` must stay the STORAGE path: the previewer's download button re-resolves
 * it to a fresh download URL. No `key` field on purpose — ImagesPreviewer's
 * filmstrip passes item.key into selectImage(), which then uses the found ITEM
 * as an array index; every existing caller leaves key undefined so that branch
 * is never taken, and adding one here would break clicking a thumbnail.
 */
async function toPreviewItem(message) {
    const name = message.mediaOriginalName || message.mediaName || '';
    const baseName = String(name).replace(/\.[^/.]+$/, '');
    const source = message.mediaName || name;
    const parts = String(source).split('.');

    return {
        id: idOf(message),
        title: name,
        name,
        alt: `${baseName} file`,
        type: message.type,
        ext: parts.length > 1 ? parts.pop().toLowerCase() : '',
        url: await resolveMediaUrl(message),
        path: message.mediaURL,
    };
}

async function openPreview(message) {
    const loaded = attachmentMessages.value;
    const index = loaded.findIndex((m) => idOf(m) === idOf(message));

    // An attachment still uploading has no stored URL to show yet.
    if (index === -1 && (!message || !message.mediaURL || message.isSending)) return;

    // A search hit can be older than the loaded transcript. Preview it on its own
    // rather than refusing — there is simply no surrounding list to walk.
    const items = index === -1 ? [message] : loaded;

    previewIndex.value = index === -1 ? 0 : index;
    previewItems.value = await Promise.all(items.map(toPreviewItem));
    // Let the previewer mount (and create its teleport target) before showing it.
    await nextTick();
    previewOpen.value = true;
}

/**
 * Act on a search result.
 *
 * A reply opens its thread at that reply. An attachment opens straight in the
 * previewer. A text hit scrolls to the message and flashes it — but only when that message is in the loaded
 * transcript; the search reaches the whole conversation, so a hit can easily be
 * older than what has been paged in. Rather than silently doing nothing, say
 * where it is.
 */
async function openSearchHit(message) {
    if (!message) return;

    if (message.parentId) {
        openThread({ _id: message.parentId }, idOf(message));
        return;
    }

    if (!['text', 'link'].includes(message.type) && message.mediaURL) {
        await openPreview(message);
        return;
    }

    const id = idOf(message);
    const present = messages.value.some((m) => idOf(m) === id);
    if (!present) {
        $toast.info(t('MainChat.search_not_loaded'), { position: 'top-right' });
        return;
    }

    const node = document.getElementById(id);
    if (!node) return;
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    node.classList.add('mc-msg--flash');
    setTimeout(() => node.classList.remove('mc-msg--flash'), 1600);
}

// A different conversation means different files; drop the snapshot and its
// signed URLs rather than leaving the previous chat's attachments previewable.
watch(conversationKey, () => {
    previewOpen.value = false;
    previewItems.value = [];
    resolvedMedia.clear();
});

function copyMessage(message) {
    const plain = String(message.message || message.mediaOriginalName || '').replace(/<[^>]*>/g, '');
    navigator.clipboard.writeText(plain)
        .then(() => $toast.success(t('MainChat.copied'), { position: 'top-right' }))
        .catch(() => $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' }));
}

function confirmRemove(message, remove = removeMessage) {
    Swal.fire({
        title: t('MainChat.confirm_delete'),
        icon: 'warning',
        showCancelButton: true,
        customClass: { confirm: 'swal2-deny' },
        cancelButtonText: t('MainChat.cancel'),
        confirmButtonText: t('MainChat.confirm_delete_yes'),
    }).then((result) => {
        if (result.isConfirmed && remove) remove(message);
    });
}

defineExpose({ reload: open });
</script>

<style src="./style.css"></style>
