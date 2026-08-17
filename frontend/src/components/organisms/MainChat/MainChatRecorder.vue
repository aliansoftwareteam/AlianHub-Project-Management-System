<template>
    <div class="mc-rec" ref="root">
        <button
            type="button"
            class="mc-icon-btn"
            :class="{ 'mc-icon-btn--on': open, 'mc-rec-live': phase === 'recording' }"
            :disabled="disabled"
            :title="$t('MainChat.record')"
            @click="toggle"
        ><MainChatIcon name="mic" /></button>

        <div v-if="open" class="mc-rec-pop" @click.stop>
            <div class="mc-rec-head">
                <span class="mc-rec-title">
                    <i class="mc-rec-dot" :class="{ 'mc-rec-dot--live': phase === 'recording' }"></i>
                    {{ $t('MainChat.record') }}
                </span>
                <button type="button" class="mc-icon-btn" :title="$t('MainChat.cancel')" @click="close()">
                    <MainChatIcon name="close" :size="13" />
                </button>
            </div>

            <p v-if="error" class="mc-rec-error">{{ error }}</p>

            <!-- pick a microphone, then start -->
            <template v-if="phase === 'idle'">
                <label v-if="mics.length > 1" class="mc-rec-label">{{ $t('MainChat.microphone') }}</label>
                <select v-if="mics.length > 1" v-model="deviceId" class="mc-rec-select">
                    <option v-for="(mic, index) in mics" :key="mic.deviceId || index" :value="mic.deviceId">
                        {{ mic.label || `${$t('MainChat.microphone')} ${index + 1}` }}
                    </option>
                </select>

                <button type="button" class="mc-rec-primary" @click="start()">
                    <i class="mc-rec-dot"></i>{{ $t('MainChat.start_recording') }}
                </button>
            </template>

            <!-- recording / paused -->
            <template v-else>
                <div class="mc-rec-meter">
                    <span class="mc-rec-time">{{ formattedElapsed }}</span>
                    <span class="mc-rec-state">{{ phase === 'paused' ? $t('MainChat.paused') : $t('MainChat.recording') }}</span>
                </div>

                <div class="mc-rec-actions">
                    <button
                        v-if="canPause"
                        type="button"
                        class="mc-rec-ghost"
                        @click="phase === 'paused' ? resume() : pause()"
                    >{{ phase === 'paused' ? $t('MainChat.resume') : $t('MainChat.pause') }}</button>
                    <button type="button" class="mc-rec-primary mc-rec-primary--stop" @click="stop()">
                        {{ $t('MainChat.stop_attach') }}
                    </button>
                </div>
                <p class="mc-rec-hint">{{ $t('MainChat.record_hint') }}</p>
            </template>
        </div>
    </div>
</template>

<script setup>
/**
 * Voice note recorder for the composer.
 *
 * Deliberately much smaller than the global ClipRecorder (voice/screen modes, its own
 * overlay, upload + task attachment) and than Talk to Text (which transcribes): this
 * only produces a File and hands it to the composer, which stages it like any other
 * attachment. Nothing here uploads or sends — pressing Send does that through the
 * existing file path, so a voice note travels exactly like a dragged-in audio file.
 *
 * The result is `audio/webm`, which checkFile() classifies as `audio` from the MIME
 * type before it ever looks at the extension list — so a company's allowed-extension
 * settings cannot reject a recording.
 */
import { computed, defineProps, defineEmits, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useCustomComposable } from '@/composable';
import MainChatIcon from './MainChatIcon.vue';

const MAX_SECONDS = 5 * 60;

const props = defineProps({
    disabled: { type: Boolean, default: false },
});

const emit = defineEmits(['recorded']);

const { t } = useI18n();
const { makeUniqueId } = useCustomComposable();

const root = ref(null);
const open = ref(false);
const phase = ref('idle');        // idle | recording | paused
const elapsed = ref(0);
const error = ref('');
const mics = ref([]);
const deviceId = ref('');

// Plain variables: none of these should drive a re-render.
let recorder = null;
let stream = null;
let chunks = [];
let timer = null;
let discarded = false;

const canPause = computed(() => typeof MediaRecorder !== 'undefined' && !!MediaRecorder.prototype.pause);

const formattedElapsed = computed(() => {
    const minutes = Math.floor(elapsed.value / 60);
    return `${minutes}:${String(elapsed.value % 60).padStart(2, '0')}`;
});

function toggle() {
    if (props.disabled) return;
    if (open.value) {
        close();
        return;
    }
    open.value = true;
    error.value = '';
    listMics();
}

/**
 * Closing mid-take discards it. Anything already captured is dropped rather than
 * silently attached — the only way to keep a recording is to press stop.
 */
function close() {
    if (phase.value !== 'idle') {
        discarded = true;
        stopRecorder();
    }
    open.value = false;
}

async function listMics() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        mics.value = (devices || []).filter((device) => device.kind === 'audioinput');
        if (mics.value.length && !deviceId.value) deviceId.value = mics.value[0].deviceId;
    } catch (e) {
        // Labels need a granted permission; an empty list just means "use the default".
    }
}

async function start() {
    error.value = '';

    if (!navigator.mediaDevices || typeof window.MediaRecorder === 'undefined') {
        error.value = t('MainChat.record_unsupported');
        return;
    }

    try {
        stream = await navigator.mediaDevices.getUserMedia({
            audio: deviceId.value ? { deviceId: { exact: deviceId.value } } : true,
        });
    } catch (e) {
        error.value = t('MainChat.mic_denied');
        return;
    }

    // Labels are readable once permission has been granted.
    listMics();

    chunks = [];
    discarded = false;

    const mime = (window.MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/webm'))
        ? 'audio/webm'
        : '';

    try {
        recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    } catch (e) {
        error.value = t('MainChat.record_unsupported');
        releaseStream();
        return;
    }

    recorder.ondataavailable = (event) => {
        if (event.data && event.data.size) chunks.push(event.data);
    };
    recorder.onstop = onStop;

    recorder.start();
    phase.value = 'recording';
    elapsed.value = 0;
    startTimer();
}

function startTimer() {
    clearTimer();
    timer = setInterval(() => {
        elapsed.value += 1;
        // A hard ceiling, so a forgotten recording cannot grow without bound.
        if (elapsed.value >= MAX_SECONDS) stop();
    }, 1000);
}

function clearTimer() {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
}

function pause() {
    if (!recorder || recorder.state !== 'recording') return;
    recorder.pause();
    clearTimer();
    phase.value = 'paused';
}

function resume() {
    if (!recorder || recorder.state !== 'paused') return;
    recorder.resume();
    phase.value = 'recording';
    startTimer();
}

function stop() {
    discarded = false;
    stopRecorder();
}

function stopRecorder() {
    clearTimer();
    if (recorder && recorder.state !== 'inactive') {
        recorder.stop(); // onStop finishes the job
        return;
    }
    releaseStream();
    phase.value = 'idle';
}

function releaseStream() {
    if (stream) {
        stream.getTracks().forEach((track) => track.stop());
        stream = null;
    }
    recorder = null;
}

function onStop() {
    const type = (recorder && recorder.mimeType) || 'audio/webm';
    const captured = chunks;
    chunks = [];
    releaseStream();
    phase.value = 'idle';

    if (discarded) {
        discarded = false;
        return;
    }

    const blob = new Blob(captured, { type });
    if (!blob.size) {
        error.value = t('MainChat.no_audio');
        return;
    }

    // The name MUST be unique. It was derived from the duration, so any two clips of
    // the same length produced the same mediaOriginalName — and that field is what
    // reconciles an optimistic row with the document echoed back over the socket. Two
    // identically named clips matched each other's placeholders, which lost a message
    // and left the renderer patching a list that had changed underneath it.
    const file = new File([blob], `voice-note-${makeUniqueId(10)}.webm`, { type: type || 'audio/webm' });

    emit('recorded', file);
    open.value = false;
    elapsed.value = 0;
}

/** Clicking away closes an idle panel, but never throws away a live take. */
function onDocumentClick(event) {
    if (!open.value || phase.value !== 'idle') return;
    if (root.value && root.value.contains(event.target)) return;
    open.value = false;
}

watch(open, (isOpen) => {
    if (isOpen) document.addEventListener('click', onDocumentClick);
    else document.removeEventListener('click', onDocumentClick);
});

onBeforeUnmount(() => {
    document.removeEventListener('click', onDocumentClick);
    discarded = true;
    clearTimer();
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    releaseStream();
});
</script>
