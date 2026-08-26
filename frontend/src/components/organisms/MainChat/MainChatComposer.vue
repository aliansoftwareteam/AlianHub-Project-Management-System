<template>
    <div class="mc-comp">
        <!--
          Cannot post here: say why, instead of leaving a dead input box. A disabled
          textarea with no explanation is indistinguishable from a broken one — which
          is exactly how the channel's "Send messages" switch read.
        -->
        <div v-if="disabled" class="mc-comp-locked">
            <MainChatIcon name="lock" :size="14" />
            <span>{{ disabledReason || $t('MainChat.read_only') }}</span>
        </div>

        <template v-else>
        <!-- editing an existing message -->
        <div v-if="editing" class="mc-comp-reply mc-comp-reply--edit">
            <b>{{ $t('MainChat.editing') }}</b>
            <span>{{ editingPreview }}</span>
            <button type="button" class="mc-icon-btn" :title="$t('MainChat.cancel')" @click="$emit('cancel-edit')"><MainChatIcon name="close" :size="14" /></button>
        </div>

        <!-- what you're replying to -->
        <div v-else-if="replyTo" class="mc-comp-reply">
            <b>{{ replyLabel }}</b>
            <span>{{ replyPreview }}</span>
            <button type="button" class="mc-icon-btn" :title="$t('MainChat.cancel')" @click="$emit('cancel-reply')"><MainChatIcon name="close" :size="14" /></button>
        </div>

        <!-- files staged before sending -->
        <div v-if="staged.length" class="mc-comp-files">
            <div v-for="(file, index) in staged" :key="index" class="mc-comp-chip">
                <span>{{ file.name }}</span>
                <button type="button" class="mc-icon-btn" :title="$t('MainChat.cancel')" @click="staged.splice(index, 1)"><MainChatIcon name="close" :size="14" /></button>
            </div>
        </div>

        <div class="mc-comp-box">
            <!--
              The app's CommentInput is reused rather than a plain textarea so the
              @-mention autocomplete (user list, keyboard selection, and the
              `@[Name](id)` token format the renderer expects) behaves exactly as
              it does in task comments. userIds drives who is suggestible.
            -->
            <!--
              `reply` must be an OBJECT, never null: CommentInput does an
              unguarded `Object.keys(reply)` in its class binding, so the default
              null throws "Cannot convert undefined or null to object". We pass
              {} because this composer renders its own reply banner above, and we
              don't want CommentInput drawing a second one.
            -->
            <CommentInput
                ref="input"
                v-model="text"
                class="mc-comp-input-wrap"
                :reply="{}"
                :userIds="userIds"
                :includeAlian="false"
                :sendMessageAllowed="!disabled"
                :loadingChat="false"
                @enter="submit"
                @pasteFile="onPasted"
            />

            <div class="mc-comp-tools">
                <button
                    type="button"
                    class="mc-icon-btn"
                    :title="$t('MainChat.attach')"
                    :disabled="disabled"
                    @click="picker && picker.click()"
                ><MainChatIcon name="attach" /></button>

                <!-- Voice note. Hands back a File, which is staged like any other
                     attachment so it sends through the existing upload path. -->
                <MainChatRecorder :disabled="disabled" @recorded="onRecorded" />

                <slot name="tools"></slot>
                <button
                    type="button"
                    class="mc-send"
                    :disabled="disabled || !canSend"
                    :title="editing ? $t('MainChat.save') : $t('MainChat.send')"
                    @click="submit"
                ><MainChatIcon name="send" :size="17" /></button>
            </div>
        </div>

        <div class="mc-comp-hint">
            <span><span class="mc-kbd">Enter</span> {{ editing ? $t('MainChat.save') : $t('MainChat.send') }}</span>
            <span><span class="mc-kbd">Shift + Enter</span> {{ $t('MainChat.shift_enter') }}</span>
            <span>{{ $t('MainChat.mention_hint') }}</span>
        </div>

        <input ref="picker" type="file" multiple class="d-none" @change="onPick" />
        </template>
    </div>
</template>

<script setup>
/**
 * Composer. Owns the draft, staged files, the reply banner and edit mode; the
 * parent decides what send/save actually does. Drafts are kept per conversation
 * so a mis-click on another chat never loses half-typed text.
 */
import { computed, defineProps, defineEmits, nextTick, ref, watch } from 'vue';
import { useGetterFunctions } from '@/composable';
import MainChatIcon from './MainChatIcon.vue';
import MainChatRecorder from './MainChatRecorder.vue';
import CommentInput from '@/components/atom/CommentInput/CommentInput.vue';

const DRAFT_PREFIX = 'alianhub:mainchat-draft';

const props = defineProps({
    replyTo: { type: Object, default: null },
    // when set, the composer saves an edit instead of sending a new message
    editing: { type: Object, default: null },
    disabled: { type: Boolean, default: false },
    // Why posting is closed, so the notice can name the actual reason.
    disabledReason: { type: String, default: '' },
    // suggestible participants for @-mentions
    userIds: { type: Array, default: () => [] },
    // stable id for the open conversation — drafts and resets key off this
    conversationKey: { type: String, default: '' },
});

const emit = defineEmits(['send', 'files', 'save', 'cancel-reply', 'cancel-edit', 'typing']);

const { getUser } = useGetterFunctions();

const text = ref('');
const staged = ref([]);
const input = ref(null);
const picker = ref(null);

const canSend = computed(() => !!text.value.trim() || staged.value.length > 0);

function plain(raw) {
    return String(raw || '').replace(/<[^>]*>/g, '');
}

const replyLabel = computed(() => {
    if (!props.replyTo) return '';
    const user = getUser(props.replyTo.userId);
    return (user && user.Employee_Name) || '';
});

const replyPreview = computed(() => {
    if (!props.replyTo) return '';
    const body = plain(props.replyTo.message || props.replyTo.mediaOriginalName);
    return body.length > 80 ? `${body.slice(0, 80)}…` : body;
});

const editingPreview = computed(() => {
    if (!props.editing) return '';
    const body = plain(props.editing.message);
    return body.length > 80 ? `${body.slice(0, 80)}…` : body;
});

function draftKey() {
    return `${DRAFT_PREFIX}:${props.conversationKey || 'unknown'}`;
}

function persistDraft() {
    try {
        const body = text.value.trim();
        if (body) localStorage.setItem(draftKey(), body);
        else localStorage.removeItem(draftKey());
    } catch (error) {
        // private mode / quota — a lost draft must never break sending
    }
}

function restoreDraft() {
    try {
        text.value = localStorage.getItem(draftKey()) || '';
    } catch (error) {
        text.value = '';
    }
}

function submit() {
    if (props.disabled) return;

    // saving an edit
    if (props.editing) {
        const body = text.value.trim();
        if (body) emit('save', body);
        text.value = '';
        return;
    }

    if (!canSend.value) return;

    if (staged.value.length) {
        emit('files', staged.value.slice());
        staged.value = [];
    }
    const body = text.value.trim();
    if (body) emit('send', body);

    text.value = '';
    try { localStorage.removeItem(draftKey()); } catch (error) { /* ignore */ }
}

function onPick(event) {
    staged.value = [...staged.value, ...Array.from(event.target.files || [])].slice(0, 10);
    event.target.value = null;
}

/** Files pasted straight into the input. */
function onPasted(files) {
    const incoming = Array.isArray(files) ? files : [files];
    staged.value = [...staged.value, ...incoming.filter(Boolean)].slice(0, 10);
}

/**
 * A finished voice note. Staged rather than sent, so it behaves like every other
 * attachment: you can add a message alongside it, or drop it before sending.
 */
function onRecorded(file) {
    if (!file) return;
    staged.value = [...staged.value, file].slice(0, 10);
}

/**
 * Tell the parent the draft is being worked on.
 *
 * Fires on every keystroke by design — the throttling lives in the conversation layer,
 * which is the only place that knows how often a signal has actually gone out. Clearing
 * the box (or sending) reports "stopped" immediately rather than waiting for the idle
 * timer, so the indicator drops the moment the message lands.
 */
watch(text, (value, previous) => {
    if (props.disabled) return;
    if (value === previous) return;
    emit('typing', !!value.trim());
});

// entering edit mode pre-fills the text; leaving it restores the draft
watch(() => props.editing, (message) => {
    if (message) {
        persistDraft();
        text.value = plain(message.message || '');
    } else {
        restoreDraft();
    }
    nextTick(() => input.value && input.value.focus && input.value.focus());
});

watch(() => props.conversationKey, () => {
    persistDraft();
    staged.value = [];
    restoreDraft();
});

watch(text, () => {
    if (!props.editing) persistDraft();
});

restoreDraft();

defineExpose({ focus: () => input.value && input.value.focus && input.value.focus() });
</script>
