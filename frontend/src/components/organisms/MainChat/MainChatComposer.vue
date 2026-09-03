<template>
    <div class="mc-comp">
        <div v-if="disabled" class="mc-comp-locked">
            <MainChatIcon name="lock" :size="14" />
            <span>{{ disabledReason || $t('MainChat.read_only') }}</span>
        </div>

        <template v-else>
            <div v-if="editing" class="mc-comp-reply mc-comp-reply--edit">
                <b>{{ $t('MainChat.editing') }}</b>
                <span>{{ editingPreview }}</span>
                <button type="button" class="mc-icon-btn" :title="$t('MainChat.cancel')" @click="$emit('cancel-edit')"><MainChatIcon name="close" :size="14" /></button>
            </div>
            <div v-else-if="replyTo" class="mc-comp-reply">
                <b>{{ replyLabel }}</b>
                <span>{{ replyPreview }}</span>
                <button type="button" class="mc-icon-btn" :title="$t('MainChat.cancel')" @click="$emit('cancel-reply')"><MainChatIcon name="close" :size="14" /></button>
            </div>

            <div v-if="staged.length" class="mc-comp-files">
                <div v-for="(file, index) in staged" :key="index" class="mc-comp-chip">
                    <span>{{ file.name }}</span>
                    <button type="button" class="mc-icon-btn" :title="$t('MainChat.cancel')" @click="staged.splice(index, 1)"><MainChatIcon name="close" :size="13" /></button>
                </div>
            </div>

            <div v-if="commandsOpen" class="ah-pop mc-cmd" @click.stop>
                <div class="ah-label ah-pop__label">{{ $t('ChatV2.commands') }}</div>
                <button
                    v-for="command in filteredCommands"
                    :key="command.key"
                    type="button"
                    class="ah-pop__item"
                    @click="runCommand(command)"
                >
                    <ShellIcon :name="command.icon" :size="15" />
                    <span>{{ $t(command.label) }}</span>
                    <kbd class="ah-kbd">/{{ command.key }}</kbd>
                </button>
                <p v-if="!filteredCommands.length" class="ah-small ah-pop__label">{{ $t('ChatV2.no_matches') }}</p>
            </div>

            <div class="mc-comp-box" :class="{ 'is-recording': recording }">
                <MainChatRecorder ref="recorder" @active="recording = $event" @recorded="onRecorded" />

                <template v-if="!recording">
                    <div class="mc-comp-field">
                        <CommentInput
                            ref="input"
                            v-model="text"
                            class="mc-comp-input-wrap"
                            :reply="{}"
                            :userIds="userIds"
                            :sendMessageAllowed="!disabled"
                            :loadingChat="false"
                            @enter="submit"
                            @pasteFile="onPasted"
                        />
                        <span v-if="!text" class="mc-comp-ph">{{ placeholder || $t('ChatV2.message') }}</span>
                    </div>

                    <div class="mc-comp-row">
                        <button type="button" class="mc-tool" :title="$t('MainChat.attach')" @click="picker && picker.click()">
                            <ShellIcon name="paperclip" :size="13" /><span>{{ $t('ChatV2.attach') }}</span>
                        </button>
                        <button type="button" class="mc-tool" :title="$t('ChatV2.cmd_clip')" @click="$emit('command', { name: 'clip', text: '' })">
                            <ShellIcon name="film" :size="13" /><span>{{ $t('ChatV2.clip') }}</span>
                        </button>
                        <button type="button" class="mc-tool" :title="$t('ChatV2.talk_to_text')" @click="$emit('command', { name: 'talk', text: '' })">
                            <ShellIcon name="mic" :size="13" /><span>{{ $t('ChatV2.talk_to_text') }}</span>
                        </button>
                        <button type="button" class="mc-tool" :title="$t('ChatV2.voice_note')" @click="startRecording">
                            <ShellIcon name="wave" :size="13" /><span>{{ $t('ChatV2.voice_note') }}</span>
                        </button>
                        <button type="button" class="mc-tool mc-tool--ai" :class="{ 'is-on': commandsOpen }" :title="$t('ChatV2.ask_ai')" @click.stop="commandsOpen = !commandsOpen">
                            <ShellIcon name="ai" :size="13" /><span>{{ $t('ChatV2.ask_ai') }}</span>
                        </button>

                        <div class="mc-comp-send">
                            <button
                                type="button"
                                class="mc-send"
                                :disabled="!canSend"
                                :title="editing ? $t('MainChat.save') : $t('MainChat.send')"
                                @click="submit"
                            >{{ editing ? $t('MainChat.save') : $t('ChatV2.send') }}</button>
                            <button
                                v-if="!editing"
                                type="button"
                                class="mc-send-more"
                                :disabled="!canSend"
                                :title="$t('ChatV2.send_options')"
                                @click.stop="sendMenu = !sendMenu"
                            ><ShellIcon name="chevronDown" :size="13" /></button>
                            <div v-if="sendMenu" class="ah-pop mc-send-menu" @click.stop>
                                <button type="button" class="ah-pop__item" @click="sendMenu = false; submit()">{{ $t('ChatV2.send_enter') }}</button>
                                <button type="button" class="ah-pop__item" @click="sendMenu = false; submitAsTask()">{{ $t('ChatV2.send_and_task') }}</button>
                            </div>
                        </div>
                    </div>
                </template>
            </div>

            <div class="mc-comp-hint">
                <template v-if="recording">
                    <span>{{ $t('ChatV2.transcription_note') }}</span>
                    <span>{{ $t('ChatV2.max_note') }}</span>
                </template>
                <template v-else>
                    <span>{{ $t('ChatV2.command_hint') }}</span>
                    <span><span class="ah-kbd">Enter</span>{{ editing ? $t('MainChat.save') : $t('MainChat.enter_send') }} · <span class="ah-kbd">Shift + Enter</span>{{ $t('MainChat.shift_enter') }}</span>
                </template>
            </div>

            <input ref="picker" type="file" multiple class="d-none" @change="onPick" />
        </template>
    </div>
</template>

<script setup>
/**
 * Composer. Owns the draft, staged files, the reply/edit banners, slash commands and the
 * inline voice recorder; the parent decides what send/save actually does. Drafts are
 * kept per conversation so a mis-click on another chat never loses half-typed text.
 */
import { computed, defineProps, defineEmits, defineExpose, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useGetterFunctions } from '@/composable';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';
import CommentInput from '@/components/atom/CommentInput/CommentInput.vue';
import MainChatIcon from './MainChatIcon.vue';
import MainChatRecorder from './MainChatRecorder.vue';

const DRAFT_PREFIX = 'alianhub:mainchat-draft';

const COMMANDS = [
    { key: 'task', label: 'ChatV2.cmd_task', icon: 'checkSquare' },
    { key: 'summarize', label: 'ChatV2.cmd_summarize', icon: 'ai' },
    { key: 'clip', label: 'ChatV2.cmd_clip', icon: 'film' },
    { key: 'voice', label: 'ChatV2.cmd_voice', icon: 'mic' },
];

const props = defineProps({
    replyTo: { type: Object, default: null },
    editing: { type: Object, default: null },
    disabled: { type: Boolean, default: false },
    disabledReason: { type: String, default: '' },
    userIds: { type: Array, default: () => [] },
    conversationKey: { type: String, default: '' },
    placeholder: { type: String, default: '' },
});

const emit = defineEmits(['send', 'send-task', 'files', 'save', 'cancel-reply', 'cancel-edit', 'typing', 'command']);

const { getUser } = useGetterFunctions();

const text = ref('');
const staged = ref([]);
const input = ref(null);
const picker = ref(null);
const recorder = ref(null);
const recording = ref(false);
const commandsOpen = ref(false);
const sendMenu = ref(false);

const canSend = computed(() => !!text.value.trim() || staged.value.length > 0);

const slash = computed(() => {
    const value = text.value;
    return value.startsWith('/') ? value.slice(1) : null;
});

const filteredCommands = computed(() => {
    const term = (slash.value || '').split(/\s+/)[0].toLowerCase();
    if (!term) return COMMANDS;
    return COMMANDS.filter((c) => c.key.startsWith(term));
});

watch(slash, (value) => {
    if (value !== null) commandsOpen.value = true;
    else if (commandsOpen.value && text.value === '') commandsOpen.value = false;
});

function plain(raw) {
    return String(raw || '').replace(/<[^>]*>/g, '');
}

const replyLabel = computed(() => {
    if (!props.replyTo) return '';
    const user = getUser(props.replyTo.userId);
    return (user && user.Employee_Name) || props.replyTo.agentName || '';
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

function clearText() {
    text.value = '';
    try { localStorage.removeItem(draftKey()); } catch (error) { /* ignore */ }
}

function runCommand(command) {
    const rest = slash.value !== null ? slash.value.replace(/^\S+\s*/, '').trim() : text.value.trim();
    commandsOpen.value = false;
    if (slash.value !== null) clearText();
    if (command.key === 'voice') {
        startRecording();
        return;
    }
    emit('command', { name: command.key, text: rest });
}

function submit() {
    if (props.disabled) return;

    if (commandsOpen.value && slash.value !== null) {
        const first = filteredCommands.value[0];
        if (first) runCommand(first);
        return;
    }

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
    clearText();
}

function submitAsTask() {
    const body = text.value.trim();
    if (!body) return;
    if (staged.value.length) {
        emit('files', staged.value.slice());
        staged.value = [];
    }
    emit('send-task', body);
    clearText();
}

function onPick(event) {
    staged.value = [...staged.value, ...Array.from(event.target.files || [])].slice(0, 10);
    event.target.value = null;
}

function onPasted(files) {
    const incoming = Array.isArray(files) ? files : [files];
    staged.value = [...staged.value, ...incoming.filter(Boolean)].slice(0, 10);
}

function startRecording() {
    if (props.disabled || !recorder.value) return;
    commandsOpen.value = false;
    recorder.value.start();
}

/** A finished voice note is sent straight away — the bar's own button says Send. */
function onRecorded(file) {
    if (!file) return;
    emit('files', [file]);
}

function onDocumentClick() {
    sendMenu.value = false;
    if (slash.value === null) commandsOpen.value = false;
}

onMounted(() => document.addEventListener('click', onDocumentClick));
onBeforeUnmount(() => document.removeEventListener('click', onDocumentClick));

watch(text, (value, previous) => {
    if (props.disabled) return;
    if (value === previous) return;
    emit('typing', !!value.trim());
});

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
    if (recorder.value) recorder.value.cancel();
    restoreDraft();
});

watch(text, () => {
    if (!props.editing) persistDraft();
});

restoreDraft();

defineExpose({
    focus: () => input.value && input.value.focus && input.value.focus(),
    startRecording,
});
</script>
