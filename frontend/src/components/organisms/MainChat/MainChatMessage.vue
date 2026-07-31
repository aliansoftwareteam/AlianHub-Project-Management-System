<template>
    <div
        class="mc-msg mc-b"
        :class="{ 'mc-b--me': message.sent, 'mc-b--cont': continuation, 'mc-pending': message.isSending }"
        :id="message._id || undefined"
        tabindex="-1"
    >
        <!-- other people's avatar; a hidden spacer keeps continuations aligned -->
        <MainChatAvatar
            v-if="!message.sent && !continuation"
            :name="senderName"
            :src="senderSrc"
            :size="34"
        />
        <span v-else-if="!message.sent" class="mc-av mc-av--34 mc-av--ghost"></span>

        <div class="mc-b-stack">
            <div v-if="!continuation" class="mc-b-meta" :class="{ 'mc-b-meta--me': message.sent }">
                <span v-if="!message.sent" class="mc-b-name">{{ displayName }}</span>
                <span class="mc-b-time">{{ shortTime }}</span>
            </div>

            <!-- Pinned marker. Rendered independently of the meta line above, which a
                 continuation hides — so a pinned message inside a burst of messages
                 from the same person previously carried no marker at all. -->
            <div v-if="message.pinnedMessage" class="mc-pinned" :class="{ 'mc-pinned--me': message.sent }">
                <MainChatIcon name="pin" :size="11" />
                <span>{{ $t('MainChat.pinned') }}</span>
            </div>

            <!-- bubble and its actions share one row, so the toolbar is centred on
                 the BUBBLE rather than on the whole stack (which also holds the
                 name/time line above and any reactions below) -->
            <div class="mc-b-line">
                <div class="mc-bub" :class="[groupClass, { 'mc-bub--me': message.sent, 'mc-bub--reacted': hasReactions, 'mc-bub--media': isVisualMedia, 'mc-bub--pinned': message.pinnedMessage }]">
                    <MainChatMessageBody :message="message" @preview="$emit('preview', message)" />
                    <span v-if="isEdited" class="mc-edited">({{ $t('MainChat.edited') }})</span>
                </div>

                <div v-if="!message.isDeleted && !message.isSending" class="mc-msg-tools">
                    <button type="button" :title="$t('MainChat.reply')" @click="$emit('reply', message)"><MainChatIcon name="reply" :size="16" /></button>

                    <!-- Reactions are triggered from HERE rather than from a second
                         affordance under the bubble: two separate hover targets made
                         the message shift as the pointer moved between them. -->
                    <span class="mc-react" ref="reactWrap">
                        <button
                            type="button"
                            :title="$t('MainChat.add_reaction')"
                            :class="{ 'mc-react-btn--on': pickerOpen }"
                            @click.stop="pickerOpen = !pickerOpen"
                        ><MainChatIcon name="emoji" :size="16" /></button>

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
                            <button :ref="`mcMenu${message._id}`" type="button" :title="$t('MainChat.more')"><MainChatIcon name="more" :size="16" /></button>
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

            <!--
              Existing reactions only. `hasReactions` matters for spacing, not just
              tidiness: this is a flex child of .mc-b-stack, so an empty bar still drew
              the stack's row gap under every single message — which is what put a
              visible space between bubbles inside a group. The add affordance lives in
              the hover toolbar, so there is nothing to render when the list is empty.
            -->
            <ReactionBar
                v-if="hasReactions && !message.isDeleted && !message.isSending"
                :reactions="message.reactions || []"
                compact
                :class="message.sent ? 'mc-rx mc-rx--me' : 'mc-rx'"
                @toggle="(emoji) => $emit('react', { message, emoji })"
            />

            <div v-if="message.failed" class="mc-failed-note">
                {{ $t('MainChat.not_sent') }}
                <button type="button" @click="$emit('retry', message)">{{ $t('MainChat.retry') }}</button>
            </div>
        </div>

    </div>
</template>

<script setup>
/**
 * One message bubble.
 *
 * Both channels and direct conversations use this: own messages sit right in the
 * app's navy, everyone else's sit left in white with the sender's name above —
 * which is what makes a multi-person channel readable.
 *
 * `continuation` means "same sender as the row above, inside the grouping
 * window": avatar, name and timestamp are dropped so a burst reads as one turn.
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
    continuation: { type: Boolean, default: false },
    // Does the run carry on below this message? Together with `continuation` this
    // gives the message's position in its group, which is what the corner radii key
    // off — see .mc-bub--g-* in style.css.
    continued: { type: Boolean, default: false },
    senderName: { type: String, default: '' },
    senderSrc: { type: String, default: '' },
    // The reader's own clock preference, resolved once by the list rather than per
    // message. 12-hour unless they have explicitly chosen 24.
    hour12: { type: Boolean, default: true },
});

const emit = defineEmits(['reply', 'copy', 'remove', 'retry', 'preview', 'react', 'pin', 'mark-unread', 'edit']);

const instance = getCurrentInstance();

// Same set ReactionBar offers, so a reaction added here is indistinguishable
// from one added anywhere else in the app. Kept local because ReactionBar
// declares it privately and is shared with task comments.
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

const displayName = computed(() => props.senderName || '—');

/**
 * Where this bubble sits in its run of same-author messages: single | first | mid |
 * last. Drives the corner radii so a burst reads as one block, the way Instagram and
 * WhatsApp do it — the corners facing an adjacent bubble tighten, the outer ones stay
 * round, and only the last bubble of a run keeps the tail notch.
 */
const groupClass = computed(() => {
    if (!props.continuation && !props.continued) return 'mc-bub--g-single';
    if (!props.continuation) return 'mc-bub--g-first';
    return props.continued ? 'mc-bub--g-mid' : 'mc-bub--g-last';
});

// Reaction chips overlap the bubble's lower edge, so a reacted bubble needs a
// little extra bottom padding to keep them clear of the text.
const hasReactions = computed(() => Array.isArray(props.message.reactions) && props.message.reactions.length > 0);

// Images and video render bare — no bubble fill, border or padding. A photo is
// the content itself, not text that needs a container around it. Documents keep
// their bubble, because there the chrome IS the affordance (icon + name + size).
const isVisualMedia = computed(() => ['image', 'video'].includes(props.message.type));

// Only your own text messages can be edited — media has nothing to retype.
const canEdit = computed(() => props.message.sent && ['text', 'link'].includes(props.message.type));

const isEdited = computed(() => {
    const { createdAt, updatedAt } = props.message;
    if (!createdAt || !updatedAt) return false;
    return new Date(createdAt).getTime() !== new Date(updatedAt).getTime();
});

/**
 * Message time, 12-hour with AM/PM by default.
 *
 * moment rather than toLocaleTimeString: the latter took its 12-vs-24-hour choice from
 * the browser locale (which is why these read as 24-hour), and even forced to hour12 it
 * cases the marker differently per locale — "1:05 pm" on en-GB, "1:05 PM" on en-US.
 * `h:mm A` is the same pattern the timesheet views use, so chat and time logs agree.
 */
const shortTime = computed(() => {
    const raw = props.message.createdAt;
    if (!raw) return '';
    const date = moment(raw.seconds ? raw.seconds * 1000 : raw);
    if (!date.isValid()) return '';
    return date.format(props.hour12 ? 'h:mm A' : 'HH:mm');
});

// DropDown exposes no close method, so the trigger is re-clicked to dismiss it —
// the same idiom the rest of the app uses.
function closeMenu() {
    const refs = instance && instance.refs;
    const trigger = refs && refs[`mcMenu${props.message._id}`];
    if (trigger && trigger.click) trigger.click();
}
</script>
