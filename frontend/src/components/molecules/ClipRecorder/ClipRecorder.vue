<template>
    <!-- FULL MODAL — hidden while minimized so the user can work over the page -->
    <div v-if="!minimized" class="clip__overlay" @click.self="requestClose">
        <div class="clip__card">
            <!-- HEAD -->
            <div class="d-flex align-items-center justify-content-between clip__head">
                <span class="font-size-16 font-weight-700">{{ $t('ClipRecorder.record_clip') }}</span>
                <div class="d-flex align-items-center clip__head-actions">
                    <span v-if="phase === 'recording'" class="cursor-pointer clip__icon-btn"
                        :title="$t('ClipRecorder.minimize')" @click="minimize">&#8211;</span>
                    <span class="cursor-pointer font-size-16 clip__close" :title="$t('ClipRecorder.close')" @click="requestClose">&#10005;</span>
                </div>
            </div>

            <!-- UNSUPPORTED -->
            <div v-if="!isMediaSupported" class="font-size-13 clip__msg clip__msg--err">
                {{ $t('ClipRecorder.unsupported') }}
            </div>

            <template v-else>
                <!-- MODE SELECT (only while idle) -->
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
                <div v-if="phase === 'recording'" class="font-size-12 gray81 clip__hint">
                    {{ $t('ClipRecorder.minimize_hint') }}
                </div>

                <!-- PREVIEW -->
                <div v-if="phase === 'preview' && previewUrl" class="clip__preview">
                    <video v-if="isVideo" :src="previewUrl" class="clip__media" controls></video>
                    <audio v-else :src="previewUrl" class="clip__media" controls></audio>
                </div>

                <!-- CONTROLS -->
                <div class="d-flex justify-content-end clip__actions">
                    <button v-if="phase === 'idle'" type="button" class="btn-primary font-size-13" @click="startRecording">{{ $t('ClipRecorder.start') }}</button>

                    <template v-if="phase === 'recording'">
                        <button type="button" class="clip__btn-ghost font-size-13 mr-10px" @click="minimize">{{ $t('ClipRecorder.minimize') }}</button>
                        <button type="button" class="btn-primary font-size-13 clip__stop" @click="stopRecording">{{ $t('ClipRecorder.stop') }}</button>
                    </template>

                    <template v-if="phase === 'preview'">
                        <button type="button" class="clip__btn-ghost font-size-13 mr-10px" @click="reRecord">{{ $t('ClipRecorder.re_record') }}</button>
                        <button type="button" class="btn-primary font-size-13" @click="attachClip">{{ $t('ClipRecorder.attach') }}</button>
                    </template>
                </div>
            </template>
        </div>
    </div>

    <!-- MINIMIZED WIDGET — floats over the app while recording continues in the background -->
    <div v-else class="clip__mini">
        <span class="clip__dot"></span>
        <span class="clip__mini-timer font-size-13 font-weight-600">{{ formattedElapsed }}</span>
        <button type="button" class="clip__mini-stop" @click="stopRecording">{{ $t('ClipRecorder.stop') }}</button>
        <span class="cursor-pointer clip__icon-btn" :title="$t('ClipRecorder.maximize')" @click="maximize">&#9974;</span>
    </div>
</template>

<script setup>
// PACKAGES
import { defineEmits, ref, computed, watch, onMounted, onBeforeUnmount } from "vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();
const emit = defineEmits(["attach", "close"]);

// FEATURE DETECTION — getDisplayMedia is undefined on plain http (non-secure
// context); guard so the modal degrades gracefully to voice-only.
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
const minimized = ref(false);
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

// True while there's recording in progress OR a recorded-but-not-attached clip —
// i.e. closing/leaving now would lose work.
const hasUnsavedWork = computed(() => phase.value === "recording" || (phase.value === "preview" && !!recordedBlob.value));

const formattedElapsed = computed(() => {
    const total = elapsed.value;
    const mm = String(Math.floor(total / 60)).padStart(2, "0");
    const ss = String(total % 60).padStart(2, "0");
    return `${mm}:${ss}`;
});

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
    return "";
}

async function acquireStream() {
    if (mode.value === "voice") {
        return await navigator.mediaDevices.getUserMedia({ audio: true });
    }
    if (mode.value === "screen") {
        return await navigator.mediaDevices.getDisplayMedia({ video: true });
    }
    const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    let micStream = null;
    try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (micError) {
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
        minimized.value = false; // restore the modal so the user can preview + attach
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
        mediaRecorder.stop(); // onstop builds the blob + preview, restores the modal, stops tracks
    } else {
        stopTracks();
    }
}

function minimize() {
    if (phase.value === "recording") {
        minimized.value = true;
    }
}

function maximize() {
    minimized.value = false;
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

// Close intent: confirm if there's an in-progress / unsaved recording so the user
// never loses a clip by clicking outside or hitting the X.
function requestClose() {
    if (hasUnsavedWork.value) {
        const ok = typeof window !== "undefined" && typeof window.confirm === "function"
            ? window.confirm(t("ClipRecorder.discard_confirm"))
            : true;
        if (!ok) return;
    }
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

// Warn before the user navigates away / closes the tab while a clip is unsaved.
const beforeUnloadHandler = (event) => {
    event.preventDefault();
    event.returnValue = "";
    return "";
};
watch(hasUnsavedWork, (val) => {
    if (typeof window === "undefined") return;
    if (val) {
        window.addEventListener("beforeunload", beforeUnloadHandler);
    } else {
        window.removeEventListener("beforeunload", beforeUnloadHandler);
    }
});

onMounted(() => {
    if (!isDisplaySupported.value && (mode.value === "screen" || mode.value === "screenMic")) {
        mode.value = "voice";
    }
});

onBeforeUnmount(() => {
    if (typeof window !== "undefined") {
        window.removeEventListener("beforeunload", beforeUnloadHandler);
    }
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
.clip__head-actions {
    gap: 14px;
}
.clip__icon-btn {
    font-size: 18px;
    line-height: 1;
    color: #5b5b6b;
}
.clip__icon-btn:hover {
    color: #2f3990;
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
    margin-bottom: 8px;
}
.clip__dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #e84a4a;
    animation: clip-pulse 1s infinite;
    flex: 0 0 auto;
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
/* Minimized floating widget — keeps recording visible without blocking the page. */
.clip__mini {
    position: fixed;
    right: 20px;
    bottom: 20px;
    z-index: 1000;
    display: flex;
    align-items: center;
    gap: 10px;
    background: #1b1b38;
    color: #fff;
    padding: 8px 12px;
    border-radius: 30px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
}
.clip__mini-timer {
    font-variant-numeric: tabular-nums;
    min-width: 42px;
}
.clip__mini-stop {
    background: #e84a4a;
    color: #fff;
    border: 0;
    border-radius: 16px;
    padding: 4px 12px;
    font-size: 12px;
    cursor: pointer;
}
.clip__mini .clip__icon-btn {
    color: #fff;
}
.clip__mini .clip__icon-btn:hover {
    color: #cfd2ff;
}
@keyframes clip-pulse {
    0% { opacity: 1; }
    50% { opacity: 0.3; }
    100% { opacity: 1; }
}
</style>
