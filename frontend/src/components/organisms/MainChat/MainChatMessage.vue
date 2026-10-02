<template>
    <div
        class="mc-msg"
        :class="{ 'is-me': onMySide,'is-cont': continuation, 'is-agent': isAgent, 'is-pending': message.isSending }"
        :id="domId"
        tabindex="-1"
    >
        <MainChatAvatar
            v-if="!continuation"
            :name="displayName"
            :src="isAgent ? '' : senderSrc"
            :size="26"
            :agent="isAgent"
        />
        <span v-else class="mc-msg-gutter"></span>

        <div class="mc-msg-stack">
            <div v-if="!continuation" class="mc-msg-meta">
                <span class="mc-msg-name" :data-test="isAi ? 'ai-author' : undefined">{{ isAi ? $t('AiMention.author') : displayName }}</span>
                <span v-if="isAi" class="mc-agent-tag mc-ai-for" data-test="ai-for">{{ $t('AiMention.answered_for', { name: askerName }) }}</span>
                <span v-else-if="isAgent" class="mc-agent-tag">{{ $t('Chat.agent') }}</span>
                <span v-if="shortTime" class="mc-msg-time">· {{ shortTime }}</span>
                <span v-if="message.pinnedMessage" class="mc-msg-pin"><MainChatIcon name="pin" :size="10" />{{ $t('MainChat.pinned') }}</span>
            </div>
            <div v-else-if="message.pinnedMessage" class="mc-msg-meta">
                <span class="mc-msg-pin"><MainChatIcon name="pin" :size="10" />{{ $t('MainChat.pinned') }}</span>
            </div>

            <div class="mc-msg-body" :class="{ 'mc-msg-body--card': isAgent && isText }">
                <MainChatMessageBody
                    :message="message"
                    :siblings="siblings"
                    @preview="$emit('preview', $event)"
                    @make-task="$emit('make-task', $event)"
                    @transcribed="$emit('transcribed', $event)"
                />
                <span v-if="isEdited" class="mc-edited">({{ $t('MainChat.edited') }})</span>
            </div>

            <ul v-if="agentChanges.length" class="mc-agent-changes" data-test="agent-changes">
                <li v-for="(change, index) in agentChanges" :key="index" class="mc-agent-change">
                    <span class="mc-agent-tag">{{ $t(`AgentChat.change_${change.outcome}`) }}</span>
                    <router-link
                        v-if="change.outcome === 'proposed' && companyId"
                        :to="{ name: 'AiInbox', params: { cid: companyId } }"
                        class="mc-agent-change-label"
                    >{{ change.label }}</router-link>
                    <span v-else class="mc-agent-change-label">{{ change.label }}</span>
                </li>
            </ul>
            <div v-if="agentAskNote" class="mc-agent-note" :data-test="`agent-ask-${agentAskState}`">{{ agentAskNote }}</div>
            <div v-if="askedOwnAi" class="mc-agent-note" data-test="own-ai-asked" :title="$t('AgentChat.asked_own_ai_hint')">{{ $t('AgentChat.asked_own_ai', { name: askedOwnAi }) }}</div>

            <div v-if="actionable" class="mc-msg-acts">
                <button type="button" class="mc-act" @click="$emit('reply', message)">{{ $t('Chat.reply') }}</button>
                <button v-if="!inThread" type="button" class="mc-act" data-test="reply-in-thread" @click="$emit('thread', message)">{{ $t('MainChat.reply_in_thread') }}</button>
                <button v-if="isText" type="button" class="mc-act mc-act--task" @click="$emit('make-task', { message, text: plainText })">{{ $t('Chat.make_task') }}</button>
                <button type="button" class="mc-act" :class="{ 'is-on': message.pinnedMessage }" @click="$emit('save-later', message)">
                    {{ message.pinnedMessage ? $t('Chat.saved_later') : $t('Chat.save_later') }}
                </button>
            </div>

            <ReactionBar
                v-if="hasReactions && actionable"
                :reactions="message.reactions || []"
                compact
                class="mc-rx"
                @toggle="(emoji) => $emit('react', { message, emoji })"
            />

            <MainChatThreadFooter
                v-if="hasThread"
                :message="message"
                :hour12="hour12"
                @open="$emit('thread', message)"
            />

            <div v-if="message.failed" class="mc-failed-note">
                {{ $t('MainChat.not_sent') }}
                <button type="button" @click="$emit('retry', message)">{{ $t('MainChat.retry') }}</button>
            </div>
        </div>

        <div v-if="actionable" class="mc-msg-tools">
            <span class="mc-react" ref="reactWrap">
                <button
                    type="button"
                    :title="$t('MainChat.add_reaction')"
                    :class="{ 'mc-react-btn--on': pickerOpen }"
                    @click.stop="pickerOpen = !pickerOpen"
                ><MainChatIcon name="emoji" :size="15" /></button>
                <div v-if="pickerOpen" class="mc-picker" @click.stop>
                    <button
                        v-for="emoji in REACTION_EMOJIS"
                        :key="emoji"
                        type="button"
                        class="mc-picker-emoji"
                        :title="emoji"
                        @click="pick(emoji)"
                    >{{ emoji }}</button>
                </div>
            </span>

            <DropDown mode="menu" themed :id="`mc_menu_${domId}`" :zIndex="1300">
                <template #button="{ triggerAttrs }">
                    <button type="button" :title="$t('MainChat.more')" v-bind="triggerAttrs"><MainChatIcon name="more" :size="15" /></button>
                </template>
                <template #options>
                    <DropDownOption @click="$emit('copy', message)">
                        <span class="mc-menu-item">{{ $t('MainChat.copy') }}</span>
                    </DropDownOption>
                    <DropDownOption @click="$emit('reply', message)">
                        <span class="mc-menu-item">{{ $t('MainChat.reply') }}</span>
                    </DropDownOption>
                    <DropDownOption v-if="!inThread" @click="$emit('thread', message)">
                        <span class="mc-menu-item">{{ $t('MainChat.reply_in_thread') }}</span>
                    </DropDownOption>
                    <DropDownOption v-if="canEdit" @click="$emit('edit', message)">
                        <span class="mc-menu-item">{{ $t('MainChat.edit') }}</span>
                    </DropDownOption>
                    <DropDownOption @click="$emit('pin', message)">
                        <span class="mc-menu-item">{{ message.pinnedMessage ? $t('MainChat.unpin') : $t('MainChat.pin') }}</span>
                    </DropDownOption>
                    <DropDownOption v-if="!inThread" @click="$emit('mark-unread', message)">
                        <span class="mc-menu-item">{{ $t('MainChat.mark_unread') }}</span>
                    </DropDownOption>
                    <DropDownOption v-if="message.sent" @click="$emit('remove', message)">
                        <span class="mc-menu-item mc-menu-item--danger">{{ $t('MainChat.delete') }}</span>
                    </DropDownOption>
                </template>
            </DropDown>
        </div>
    </div>
</template>

<script setup>
/**
 * One message row. Everyone sits left with an avatar, name and time; a run of
 * messages from the same author inside the grouping window drops the repeated
 * header. Agent posts carry the rounded-square avatar and the AGENT tag.
 */
import { computed, defineProps, defineEmits, inject, onBeforeUnmount, ref, unref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import moment from 'moment';
import DropDown from '@/components/molecules/DropDown/DropDown.vue';
import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue';
import ReactionBar from '@/components/atom/ReactionBar/ReactionBar.vue';
import MainChatAvatar from './MainChatAvatar.vue';
import MainChatIcon from './MainChatIcon.vue';
import MainChatMessageBody from './MainChatMessageBody.vue';
import MainChatThreadFooter from './MainChatThreadFooter.vue';
import { isAgentComment } from '@/utils/commentSide';
import { AI_MENTION_NAME, aiAuthorOf } from '@/utils/aiMention';
import { mentionsOwnAi } from '@/utils/agentMention';

const props = defineProps({
    message: { type: Object, required: true },
    // Further attachments from the same author sent back to back, shown as one gallery.
    siblings: { type: Array, default: () => [] },
    continuation: { type: Boolean, default: false },
    continued: { type: Boolean, default: false },
    senderName: { type: String, default: '' },
    senderSrc: { type: String, default: '' },
    askerName: { type: String, default: '' },
    hour12: { type: Boolean, default: true },
    // Shown in a thread panel: no thread of its own, and an id that cannot clash with the same message in the conversation.
    inThread: { type: Boolean, default: false },
});

const emit = defineEmits(['reply', 'thread', 'copy', 'remove', 'retry', 'preview', 'react', 'pin', 'mark-unread', 'edit', 'make-task', 'save-later', 'transcribed']);

// Must match the backend allowlist in Modules/Reactions/helpers/reactionRules.js
const REACTION_EMOJIS = ['👍', '❤️', '😄', '🎉', '😮', '😢', '🚀', '👀'];

const pickerOpen = ref(false);
const reactWrap = ref(null);

function pick(emoji) {
    pickerOpen.value = false;
    emit('react', { message: props.message, emoji });
}

function onDocumentClick(event) {
    if (!pickerOpen.value) return;
    if (reactWrap.value && reactWrap.value.contains(event.target)) return;
    pickerOpen.value = false;
}

function onKeydown(event) {
    if (event.key === 'Escape') pickerOpen.value = false;
}

watch(pickerOpen, (open) => {
    if (open) {
        document.addEventListener('click', onDocumentClick);
        document.addEventListener('keydown', onKeydown);
    } else {
        document.removeEventListener('click', onDocumentClick);
        document.removeEventListener('keydown', onKeydown);
    }
});

onBeforeUnmount(() => {
    document.removeEventListener('click', onDocumentClick);
    document.removeEventListener('keydown', onKeydown);
});

const { t } = useI18n();
const injectedCompanyId = inject('$companyId', '');
const companyId = computed(() => unref(injectedCompanyId) || '');
const CHANGE_OUTCOMES = ['done', 'proposed', 'refused', 'failed'];
const agentChanges = computed(() => (Array.isArray(props.message.agentChanges) ? props.message.agentChanges : [])
    .filter((change) => change && CHANGE_OUTCOMES.includes(change.outcome)));
const agentAskState = computed(() => (props.message.agentAsk && props.message.agentAsk.state) || '');
const agentAskNote = computed(() => {
    if (agentAskState.value === 'answering') return t('AgentChat.replying');
    if (agentAskState.value === 'failed') return t('AgentChat.could_not_reply');
    return '';
});

/* A message edited so that it no longer names the AI is no longer a question for it. */
const askedOwnAi = computed(() => {
    const { isDeleted, ownAiAsk, message } = props.message;
    return (!isDeleted && ownAiAsk && mentionsOwnAi(message) && ownAiAsk.name) || '';
});

const isAi = computed(() => !!aiAuthorOf(props.message));
const isAgent = computed(() => isAgentComment(props.message) || !!props.message.agentName || isAi.value);
const onMySide = computed(() => props.message.sent && !isAgent.value);
const displayName = computed(() => {
    if (isAi.value) return AI_MENTION_NAME;
    return (isAgent.value ? (props.message.agentName || props.senderName) : props.senderName) || '—';
});
const isText = computed(() => ['text', 'link'].includes(props.message.type) && !props.message.isDeleted);
const actionable = computed(() => !props.message.isDeleted && !props.message.isSending);
const domId = computed(() => {
    if (!props.message._id) return undefined;
    return props.inThread ? `thread_${props.message._id}` : String(props.message._id);
});
const hasThread = computed(() => !props.inThread && !!props.message._id && Number(props.message.replyCount || 0) > 0);
const hasReactions = computed(() => Array.isArray(props.message.reactions) && props.message.reactions.length > 0);
const canEdit = computed(() => onMySide.value &&['text', 'link'].includes(props.message.type));
const plainText = computed(() => String(props.message.message || '').replace(/<[^>]*>/g, ''));

const isEdited = computed(() => {
    const { createdAt, updatedAt } = props.message;
    if (!createdAt || !updatedAt) return false;
    return new Date(createdAt).getTime() !== new Date(updatedAt).getTime();
});

const shortTime = computed(() => {
    const raw = props.message.createdAt;
    if (!raw) return '';
    const date = moment(raw.seconds ? raw.seconds * 1000 : raw);
    if (!date.isValid()) return '';
    return date.format(props.hour12 ? 'h:mm A' : 'HH:mm');
});
</script>
