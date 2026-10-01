<template>
    <aside class="mc-info mc-thread" data-test="thread-panel" :aria-label="$t('MainChat.thread_title')">
        <div class="mc-info-top">
            <span class="mc-info-title">
                {{ $t('MainChat.thread_title') }}
                <span v-if="where" class="mc-thread-where">{{ where }}</span>
            </span>
            <button
                type="button"
                class="mc-icon-btn"
                data-test="thread-close"
                :title="$t('MainChat.thread_close')"
                :aria-label="$t('MainChat.thread_close')"
                @click="$emit('close')"
            ><MainChatIcon name="close" :size="15" /></button>
        </div>

        <p v-if="failed" class="mc-thread-note" role="alert">{{ $t('MainChat.thread_failed') }}</p>

        <template v-else>
            <MainChatMessageList
                in-thread
                :messages="messages"
                :loading="loading"
                :has-more="false"
                @reply="replyTo = $event"
                @copy="$emit('copy', $event)"
                @remove="$emit('remove', $event)"
                @retry="retry"
                @preview="$emit('preview', $event)"
                @react="({ message, emoji }) => toggleReaction(message, emoji)"
                @pin="onPin"
                @edit="editingMessage = $event"
                @make-task="$emit('make-task', $event)"
                @save-later="onSaveLater"
            />

            <MainChatComposer
                :reply-to="replyTo"
                :editing="editingMessage"
                :disabled="disabled"
                :disabled-reason="disabledReason"
                :user-ids="userIds"
                :agents="agents"
                :conversation-key="draftKey"
                :placeholder="$t('MainChat.reply_in_thread')"
                @send="onSend"
                @send-task="onSendTask"
                @command="onCommand"
                @files="onFiles"
                @save="onSaveEdit"
                @cancel-reply="replyTo = null"
                @cancel-edit="editingMessage = null"
            />
        </template>
    </aside>
</template>

<script setup>
/**
 * One thread, beside its conversation: the message it hangs under, the replies and a
 * composer. It runs the conversation engine in thread mode, so a reply is written, edited,
 * reacted to and deleted exactly as a message in the conversation is.
 */
import { computed, defineProps, defineEmits, defineExpose, inject, nextTick, ref, watch } from 'vue';
import { useStore } from 'vuex';
import { useI18n } from 'vue-i18n';
import { useToast } from 'vue-toast-notification';
import { useClipRecorder } from '@/composables/useClipRecorder';
import MainChatMessageList from './MainChatMessageList.vue';
import MainChatComposer from './MainChatComposer.vue';
import MainChatIcon from './MainChatIcon.vue';
import { useMainChatConversation } from './useMainChatConversation';

const props = defineProps({
    // The message the thread hangs under; an id alone is enough, the rest is loaded.
    root: { type: Object, required: true },
    // { projectId, sprintId, taskId, folderId, isDefaultProject } of the conversation
    target: { type: Object, required: true },
    where: { type: String, default: '' },
    userIds: { type: Array, default: () => [] },
    agents: { type: Array, default: () => [] },
    conversationKey: { type: String, default: '' },
    disabled: { type: Boolean, default: false },
    disabledReason: { type: String, default: '' },
    sender: { type: Object, default: () => ({}) },
    // A reply to scroll to once the thread is loaded, such as a search hit.
    focusId: { type: String, default: '' },
});

const emit = defineEmits(['close', 'copy', 'remove', 'preview', 'make-task', 'command']);

const { getters } = useStore();
const { t } = useI18n();
const $toast = useToast();
const companyId = inject('$companyId');
const userId = inject('$userId');

const replyTo = ref(null);
const editingMessage = ref(null);
const failed = ref(false);

const rootId = computed(() => String((props.root && props.root._id) || ''));
const draftKey = computed(() => `${props.conversationKey}:thread:${rootId.value}`);

const {
    messages, loading, load, catchUp, receive,
    sendText, sendMedia, sendFiles, retry, removeMessage, toggleReaction, togglePin, editText,
} = useMainChatConversation({
    socket: null,
    companyId,
    userId,
    target: () => props.target,
    currentUser: () => props.sender,
    thread: () => props.root,
});

function showFocused() {
    if (!props.focusId || typeof document === 'undefined') return;
    const node = document.getElementById(`thread_${props.focusId}`);
    if (!node) return;
    node.scrollIntoView({ block: 'center' });
    node.classList.add('mc-msg--flash');
    setTimeout(() => node.classList.remove('mc-msg--flash'), 1600);
}

async function open() {
    replyTo.value = null;
    editingMessage.value = null;
    failed.value = false;
    if (!rootId.value) return;
    failed.value = !(await load());
    if (failed.value || !props.focusId) return;
    // Two ticks: the list scrolls to its newest reply one tick after it renders.
    await nextTick();
    await nextTick();
    showFocused();
}

watch(rootId, open, { immediate: true });

async function onSend(text) {
    const reply = replyTo.value ? { ...replyTo.value } : {};
    replyTo.value = null;
    await sendText(text, reply);
}

async function onSendTask(text) {
    emit('make-task', { text });
    await onSend(text);
}

async function onFiles(files) {
    await sendFiles(files.map((file) => file), getters['settings/fileExtentions'] || []);
}

async function onSaveEdit(text) {
    const target = editingMessage.value;
    editingMessage.value = null;
    if (target) await editText(target, text);
}

async function onPin(message) {
    const pinned = await togglePin(message);
    $toast.success(t(pinned ? 'MainChat.pinned_ok' : 'MainChat.unpinned_ok'), { position: 'top-right' });
}

async function onSaveLater(message) {
    const saved = await togglePin(message);
    $toast.success(t(saved ? 'Chat.saved_later' : 'Chat.unsaved_later'), { position: 'top-right' });
}

const { openRecorder } = useClipRecorder();

async function postClip(clip) {
    if (!clip || !clip.url) return;
    const name = `${clip.title || 'clip'}.webm`;
    await sendMedia({
        type: clip.mediaType === 'audio' ? 'audio' : 'video',
        mediaURL: clip.url,
        mediaName: name,
        mediaOriginalName: name,
        mediaSize: clip.size || 0,
    });
}

/* A clip recorded from here is posted here; the other commands act on the whole conversation. */
function onCommand(command = {}) {
    if (command.name === 'clip') openRecorder({ type: 'chat', conversationKey: draftKey.value }, postClip);
    else if (command.name === 'task') emit('make-task', { text: command.text || (replyTo.value && replyTo.value.message) });
    else emit('command', command);
}

defineExpose({ receive, refresh: catchUp, remove: removeMessage });
</script>
