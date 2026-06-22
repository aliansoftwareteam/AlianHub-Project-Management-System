<template>
    <div class="clip__overlay" @click.self="close">
        <div class="clip__card">
            <!-- HEAD -->
            <div class="d-flex align-items-center justify-content-between clip__head">
                <span class="font-size-16 font-weight-700">{{ $t('ClipRecorder.record_clip') }}</span>
                <span class="cursor-pointer font-size-16 clip__close" @click="close">&#10005;</span>
            </div>

            <!-- UNSUPPORTED -->
            <div v-if="!isMediaSupported" class="font-size-13 clip__msg clip__msg--err">
                {{ $t('ClipRecorder.unsupported') }}
            </div>

            <template v-else>
                <!-- MODE SELECT (only before a recording exists / while idle) -->
                <div v-if="phase === 'idle'" class="clip__modes">
                    <label class="clip__mode" :class="{ 'clip__mode--active': mode === 'voice' }">
                        <input type="radio" value="voice" v-model="mode" />
                        <span>{{ $t('ClipRecorder.voice') }}</span>
                    </label>
                    <label class="clip__mode" :class="{ 'clip__mode--active': mode === 'screen' }">
                        <input type="radio" value="screen" v-model="mode" :disabled="!isDisplaySupported" />
                        <span>{{ $t('ClipRecorder.screen') }}</span>
                    </label>
                    <label class="clip__mode" :class="{ 'clip__mode--active': mode === 'screenMic' }">
                        <input type="radio" value="screenMic" v-model="mode" :disabled="!isDisplaySupported" />
                        <span>{{ $t('ClipRecorder.screen_mic') }}</span>
                    </label>
                </div>

                <div v-if="!isDisplaySupported && phase === 'idle'" class="font-size-12 gray81 clip__hint">
                    {{ $t('ClipRecorder.screen_https_hint') }}
                </div>

                <!-- ERROR (permission / runtime) -->
                <div v-if="errorMessage" class="font-size-13 clip__msg clip__msg--err">
                    {{ errorMessage }}
                </div>

                <!-- RECORDING / TIMER -->
                <div v-if="phase === 'recording'" class="clip__recording">
                    <span class="clip__dot"></span>
                    <span class="font-size-14 font-weight-600">{{ $t('ClipRecorder.recording') }}</span>
                    <span class="clip__timer font-size-14">{{ formattedElapsed }}</span>
                </div>

                <!-- PREVIEW -->
                <div v-if="phase === 'preview' && previewUrl" class="clip__preview">
                    <video v-if="isVideo" :src="previewUrl" class="clip__media" controls></video>
                    <audio v-else :src="previewUrl" class="clip__media" controls></audio>
                </div>

                <!-- CONTROLS -->
                <div class="d-flex justify-content-end clip__actions">
                    <button
                        v-if="phase === 'idle'"
                        type="button"
                        class="btn-primary font-size-13"
                        @click="startRecording"
                    >{{ $t('ClipRecorder.start') }}</button>

                    <button
                        v-if="phase === 'recording'"
                        type="button"
                        class="btn-primary font-size-13 clip__stop"
                        @click="stopRecording"
                    >{{ $t('ClipRecorder.stop') }}</button>

                    <template v-if="phase === 'preview'">
                        <button
                            type="button"
                            class="clip__btn-ghost font-size-13 mr-10px"
                            @click="reRecord"
                        >{{ $t('ClipRecorder.re_record') }}</button>
                        <button
                            type="button"
                            class="btn-primary font-size-13"
                            @click="attachClip"
                        >{{ $t('ClipRecorder.attach') }}</button>
                    </template>
                </div>
            </template>
        </div>
    </div>
</template>

<script setup>
// PACKAGES
import { defineEmits, ref, computed, onMounted, onBeforeUnmount } from "vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();
const emit = defineEmits(["attach", "close"]);

// FEATURE DETECTION
// getDisplayMedia is undefined on plain http (non-secure context); guard so the
// modal degrades gracefully to voice-only instead of crashing.
const isMediaSupported = ref(
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === "function" &&
    typeof window !== "undefined" &&
    typeof window.MediaRecorder === "function"
);
const isDisplaySupported = ref(
    isMediaSupported.value &&
    typeof navigator.mediaDevices.getDisplayMedia === "function"
);

// STATE
const mode = ref("voice"); // 'voice' | 'screen' | 'screenMic'
const phase = ref("idle"); // 'idle' | 'recording' | 'preview'
const errorMessage = ref("");
const previewUrl = ref("");
const recordedBlob = ref(null);
const recordedMime = ref("");
const elapsed = ref(0);

let mediaStream = null;
let mediaRecorder = null;
let chunks = [];
let timerId = null;

const isVideo = computed(() => mode.value === "screen" || mode.value === "screenMic");

const formattedElapsed = computed(() => {
    const total = elapsed.value;
    const mm = String(Math.floor(total / 60)).padStart(2, "0");
    const ss = String(total % 60).padStart(2, "0");
    return `${mm}:${ss}`;
});

// Pick the first supported mimeType, falling back to '' (browser default).
function pickMimeType(video) {
    const candidates = video
        ? ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
        : ["audio/webm;codecs=opus", "audio/webm"];
    if (typeof window.MediaRecorder.isTypeSupported === "function") {
        for (const candidate of candidates) {
            if (window.MediaRecorder.isTypeSupported(candidate)) {
                return candidate;
            }
        }
    }
    return ""; // let the browser default
}

// Acquire the stream for the chosen mode (combining screen video + mic audio when needed).
async function acquireStream() {
    if (mode.value === "voice") {
        return await navigator.mediaDevices.getUserMedia({ audio: true });
    }
    if (mode.value === "screen") {
        return await navigator.mediaDevices.getDisplayMedia({ video: true });
    }
    // screen + mic: merge the display video track with a mic audio track.
    const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    let micStream = null;
    try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (micError) {
        // If the mic is denied, fall back to screen-only rather than aborting.
        console.error("Microphone unavailable for screen+mic clip:", micError);
    }
    const combined = new MediaStream();
    displayStream.getVideoTracks().forEach((track) => combined.addTrack(track));
    if (micStream) {
        micStream.getAudioTracks().forEach((track) => combined.addTrack(track));
    }
    return combined;
}

async function startRecording() {
    errorMessage.value = "";
    if (!isMediaSupported.value) {
        errorMessage.value = t("ClipRecorder.unsupported");
        return;
    }
    try {
        mediaStream = await acquireStream();
    } catch (error) {
        // Permission denied / dismissed / device missing.
        console.error("Clip capture permission error:", error);
        errorMessage.value = t("ClipRecorder.permission_denied");
        stopTracks();
        return;
    }

    // If the user stops sharing from the browser's native control, end the recording.
    mediaStream.getTracks().forEach((track) => {
        track.addEventListener("ended", () => {
            if (phase.value === "recording") {
                stopRecording();
            }
        });
    });

    chunks = [];
    const mime = pickMimeType(isVideo.value);
    recordedMime.value = mime;
    try {
        mediaRecorder = mime
            ? new window.MediaRecorder(mediaStream, { mimeType: mime })
            : new window.MediaRecorder(mediaStream);
    } catch (error) {
        console.error("MediaRecorder init failed:", error);
        errorMessage.value = t("ClipRecorder.unsupported");
        stopTracks();
        return;
    }

    mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
            chunks.push(event.data);
        }
    };
    mediaRecorder.onstop = () => {
        const type = recordedMime.value || (isVideo.value ? "video/webm" : "audio/webm");
        recordedBlob.value = new Blob(chunks, { type });
        revokePreview();
        previewUrl.value = URL.createObjectURL(recordedBlob.value);
        phase.value = "preview";
        stopTracks();
    };

    mediaRecorder.start();
    phase.value = "recording";
    elapsed.value = 0;
    timerId = window.setInterval(() => {
        elapsed.value += 1;
    }, 1000);
}

function stopRecording() {
    stopTimer();
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop(); // onstop builds the blob + preview and stops tracks
    } else {
        stopTracks();
    }
}

function reRecord() {
    revokePreview();
    recordedBlob.value = null;
    chunks = [];
    elapsed.value = 0;
    phase.value = "idle";
}

function attachClip() {
    if (!recordedBlob.value) {
        return;
    }
    const type = recordedBlob.value.type || recordedMime.value || (isVideo.value ? "video/webm" : "audio/webm");
    const file = new File([recordedBlob.value], "clip-" + Date.now() + ".webm", { type });
    emit("attach", file);
    close();
}

// CLEANUP HELPERS
function stopTimer() {
    if (timerId) {
        window.clearInterval(timerId);
        timerId = null;
    }
}

function stopTracks() {
    if (mediaStream) {
        mediaStream.getTracks().forEach((track) => track.stop());
        mediaStream = null;
    }
}

function revokePreview() {
    if (previewUrl.value) {
        URL.revokeObjectURL(previewUrl.value);
        previewUrl.value = "";
    }
}

function teardown() {
    stopTimer();
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
        try {
            mediaRecorder.stop();
        } catch (error) {
            console.error("Error stopping recorder on teardown:", error);
        }
    }
    mediaRecorder = null;
    stopTracks();
    revokePreview();
}

function close() {
    teardown();
    emit("close");
}

onMounted(() => {
    if (!isDisplaySupported.value && (mode.value === "screen" || mode.value === "screenMic")) {
        mode.value = "voice";
    }
});

onBeforeUnmount(() => {
    teardown();
});
</script>

<style scoped>
.clip__overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.35);
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
}
.clip__card {
    background: #fff;
    border-radius: 10px;
    width: min(460px, 92vw);
    padding: 16px 20px;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.18);
}
.clip__head {
    margin-bottom: 12px;
}
.clip__close {
    color: #9a9a9a;
}
.clip__close:hover {
    color: #e84a4a;
}
.clip__modes {
    display: flex;
    gap: 8px;
    margin-bottom: 12px;
    flex-wrap: wrap;
}
.clip__mode {
    display: flex;
    align-items: center;
    gap: 6px;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    padding: 8px 12px;
    cursor: pointer;
    font-size: 13px;
}
.clip__mode--active {
    border-color: #2f3990;
    background: #f1f2fb;
}
.clip__mode input:disabled {
    cursor: not-allowed;
}
.clip__hint {
    margin-bottom: 12px;
}
.clip__msg {
    margin-bottom: 12px;
    padding: 8px 12px;
    border-radius: 8px;
}
.clip__msg--err {
    background: #fdecec;
    color: #c0392b;
}
.clip__recording {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
}
.clip__dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #e84a4a;
    animation: clip-pulse 1s infinite;
}
.clip__timer {
    margin-left: auto;
    font-variant-numeric: tabular-nums;
}
.clip__preview {
    margin-bottom: 12px;
}
.clip__media {
    width: 100%;
    max-height: 320px;
    border-radius: 8px;
    background: #000;
}
.clip__actions {
    margin-top: 4px;
}
.clip__stop {
    background: #e84a4a !important;
}
.clip__btn-ghost {
    background: #f1f1f1;
    border: 1px solid #e0e0e0;
    border-radius: 6px;
    padding: 6px 14px;
    color: #333;
    cursor: pointer;
}
.clip__btn-ghost:hover {
    background: #e7e7e7;
}
@keyframes clip-pulse {
    0% { opacity: 1; }
    50% { opacity: 0.3; }
    100% { opacity: 1; }
}
</style>
