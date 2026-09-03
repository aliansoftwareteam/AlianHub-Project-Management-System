<template>
    <div v-if="phase !== 'idle'" class="mc-rec">
        <span class="mc-rec-dot"></span>
        <span class="mc-rec-time">{{ formattedElapsed }}</span>
        <div class="mc-rec-wave" aria-hidden="true">
            <span
                v-for="(level, index) in levels"
                :key="index"
                :style="{ height: `${level}%` }"
                :class="{ 'is-live': index >= levels.length - LIVE_BARS }"
            ></span>
        </div>
        <span class="mc-rec-hint">{{ $t('ChatV2.recording') }}</span>
        <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" @click="stop()">{{ $t('ChatV2.send') }}</button>
    </div>
    <p v-else-if="error" class="ah-field__error">{{ error }}</p>
</template>

<script setup>
/**
 * Inline voice-note recorder. Renders only while a take is running; the composer
 * starts it through `start()` and receives the finished File through `recorded`,
 * which then travels through the normal attachment path.
 */
import { computed, defineEmits, defineExpose, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useCustomComposable } from '@/composable';

const MAX_SECONDS = 5 * 60;
const BAR_COUNT = 32;
const LIVE_BARS = 6;

const emit = defineEmits(['recorded', 'active']);

const { t } = useI18n();
const { makeUniqueId } = useCustomComposable();

const phase = ref('idle');
const elapsed = ref(0);
const error = ref('');
const levels = ref(Array.from({ length: BAR_COUNT }, () => 20));

let recorder = null;
let stream = null;
let chunks = [];
let timer = null;
let meter = null;
let audioContext = null;
let analyser = null;
let discarded = false;

const formattedElapsed = computed(() => `${Math.floor(elapsed.value / 60)}:${String(elapsed.value % 60).padStart(2, '0')}`);

watch(phase, (value) => emit('active', value !== 'idle'));

async function start() {
    if (phase.value !== 'idle') return;
    error.value = '';

    if (!navigator.mediaDevices || typeof window.MediaRecorder === 'undefined') {
        error.value = t('MainChat.record_unsupported');
        return;
    }

    try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
        error.value = t('MainChat.mic_denied');
        return;
    }

    chunks = [];
    discarded = false;
    const mime = (window.MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/webm')) ? 'audio/webm' : '';

    try {
        recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    } catch (e) {
        error.value = t('MainChat.record_unsupported');
        releaseStream();
        return;
    }

    recorder.ondataavailable = (event) => { if (event.data && event.data.size) chunks.push(event.data); };
    recorder.onstop = onStop;
    recorder.start();

    startMeter();
    phase.value = 'recording';
    elapsed.value = 0;
    levels.value = Array.from({ length: BAR_COUNT }, () => 20);
    timer = setInterval(() => {
        elapsed.value += 1;
        if (elapsed.value >= MAX_SECONDS) stop();
    }, 1000);
    document.addEventListener('keydown', onKeydown);
}

function startMeter() {
    try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        audioContext = new Ctx();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        audioContext.createMediaStreamSource(stream).connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        meter = setInterval(() => {
            analyser.getByteTimeDomainData(data);
            let peak = 0;
            for (let i = 0; i < data.length; i += 1) peak = Math.max(peak, Math.abs(data[i] - 128));
            const level = Math.min(100, Math.max(15, Math.round((peak / 128) * 160)));
            levels.value = [...levels.value.slice(1), level];
        }, 90);
    } catch (e) {
        // Without a meter the bars stay flat; the recording itself is unaffected.
    }
}

function stopMeter() {
    if (meter) { clearInterval(meter); meter = null; }
    if (audioContext) {
        audioContext.close().catch(() => {});
        audioContext = null;
        analyser = null;
    }
}

function onKeydown(event) {
    if (event.key === 'Escape') cancel();
}

function stop() {
    discarded = false;
    stopRecorder();
}

/** Esc, or the composer closing mid-take: nothing captured is kept. */
function cancel() {
    if (phase.value === 'idle') return;
    discarded = true;
    stopRecorder();
}

function stopRecorder() {
    if (timer) { clearInterval(timer); timer = null; }
    document.removeEventListener('keydown', onKeydown);
    stopMeter();
    if (recorder && recorder.state !== 'inactive') {
        recorder.stop();
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
    elapsed.value = 0;

    if (discarded) {
        discarded = false;
        return;
    }

    const blob = new Blob(captured, { type });
    if (!blob.size) {
        error.value = t('MainChat.no_audio');
        return;
    }
    // Unique on purpose: the name reconciles the optimistic row with the stored document.
    emit('recorded', new File([blob], `voice-note-${makeUniqueId(10)}.webm`, { type: type || 'audio/webm' }));
}

onBeforeUnmount(() => {
    discarded = true;
    if (timer) clearInterval(timer);
    document.removeEventListener('keydown', onKeydown);
    stopMeter();
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    releaseStream();
});

defineExpose({ start, cancel, isRecording: () => phase.value !== 'idle' });
</script>
