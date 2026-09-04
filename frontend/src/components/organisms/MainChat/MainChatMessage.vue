<template>
    <div
        class="mc-msg"
        :class="{ 'is-me': message.sent, 'is-cont': continuation, 'is-agent': isAgent, 'is-pending': message.isSending }"
        :id="message._id || undefined"
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
                <span class="mc-msg-name">{{ displayName }}</span>
                <span v-if="isAgent" class="mc-agent-tag">{{ $t('Chat.agent') }}</span>
                <span class="mc-msg-time">· {{ shortTime }}</span>
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

            <div v-if="actionable" class="mc-msg-acts">
                <button type="button" class="mc-act" @click="$emit('reply', message)">{{ $t('Chat.reply') }}</button>
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

            <DropDown :id="`mc_menu_${message._id}`" :zIndex="1300">
                <template #button>
                    <button :ref="`mcMenu${message._id}`" type="button" :title="$t('MainChat.more')"><MainChatIcon name="more" :size="15" /></button>
                </template>
                <template #options>
                    <DropDownOption @click="closeMenu(), $emit('copy', message)">
                        <span class="mc-menu-item">{{ $t('MainChat.copy') }}</span>
                    </DropDownOption>
                    <DropDownOption @click="closeMenu(), $emit('reply', message)">
                        <span class="mc-menu-item">{{ $t('MainChat.reply') }}</span>
                    </DropDownOption>
                    <DropDownOption v-if="canEdit" @click="closeMenu(), $emit('edit', message)">
                        <span class="mc-menu-item">{{ $t('MainChat.edit') }}</span>
                    </DropDownOption>
                    <DropDownOption @click="closeMenu(), $emit('pin', message)">
                        <span class="mc-menu-item">{{ message.pinnedMessage ? $t('MainChat.unpin') : $t('MainChat.pin') }}</span>
                    </DropDownOption>
                    <DropDownOption @click="closeMenu(), $emit('mark-unread', message)">
                        <span class="mc-menu-item">{{ $t('MainChat.mark_unread') }}</span>
                    </DropDownOption>
                    <DropDownOption v-if="message.sent" @click="closeMenu(), $emit('remove', message)">
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
import { computed, defineProps, defineEmits, getCurrentInstance, onBeforeUnmount, ref, watch } from 'vue';
import moment from 'moment';
import DropDown from '@/components/molecules/DropDown/DropDown.vue';
import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue';
import ReactionBar from '@/components/atom/ReactionBar/ReactionBar.vue';
import MainChatAvatar from './MainChatAvatar.vue';
import MainChatIcon from './MainChatIcon.vue';
import MainChatMessageBody from './MainChatMessageBody.vue';

const props = defineProps({
    message: { type: Object, required: true },
    // Further attachments from the same author sent back to back, shown as one gallery.
    siblings: { type: Array, default: () => [] },
    continuation: { type: Boolean, default: false },
    continued: { type: Boolean, default: false },
    senderName: { type: String, default: '' },
    senderSrc: { type: String, default: '' },
    hour12: { type: Boolean, default: true },
});

const emit = defineEmits(['reply', 'copy', 'remove', 'retry', 'preview', 'react', 'pin', 'mark-unread', 'edit', 'make-task', 'save-later', 'transcribed']);

const instance = getCurrentInstance();

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

const isAgent = computed(() => props.message.isAgent === true || !!props.message.agentName);
const displayName = computed(() => (isAgent.value ? (props.message.agentName || props.senderName) : props.senderName) || '—');
const isText = computed(() => ['text', 'link'].includes(props.message.type) && !props.message.isDeleted);
const actionable = computed(() => !props.message.isDeleted && !props.message.isSending);
const hasReactions = computed(() => Array.isArray(props.message.reactions) && props.message.reactions.length > 0);
const canEdit = computed(() => props.message.sent && ['text', 'link'].includes(props.message.type));
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

// DropDown exposes no close method, so its trigger is re-clicked to dismiss it.
function closeMenu() {
    const refs = instance && instance.refs;
    const trigger = refs && refs[`mcMenu${props.message._id}`];
    if (trigger && trigger.click) trigger.click();
}
</script>
