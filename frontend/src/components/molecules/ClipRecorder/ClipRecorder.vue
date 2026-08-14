<template>
    <!-- GLOBAL recorder: mounted once at the app shell (Header) and shown via the
         shared composable's `open` flag, so it survives in-app navigation. -->
    <template v-if="recorder.state.open">
        <!-- FULL MODAL — shown to choose a mode and, after stopping, to preview and
             save. While recording, only the floating widget below is on screen. -->
        <div v-if="phase !== 'recording'" class="clip__overlay" @click.self="requestClose">
            <div class="clip__card">
                <!-- HEAD -->
                <div class="d-flex align-items-center justify-content-between clip__head">
                    <span class="font-size-16 font-weight-700">{{ $t('ClipRecorder.record_clip') }}</span>
                    <div class="d-flex align-items-center clip__head-actions">
                        <span class="cursor-pointer font-size-16 clip__close" :title="$t('ClipRecorder.close')" @click="requestClose">&#10005;</span>
                    </div>
                </div>

                <!-- UNSUPPORTED -->
                <div v-if="!isMediaSupported" class="font-size-13 clip__msg clip__msg--err">
                    {{ $t('ClipRecorder.unsupported') }}
                </div>

                <template v-else>
                    <!-- MODE SELECT + START (idle) — one row under a divider, so the
                         whole choose-and-go step reads as a single line. -->
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
                        <button type="button" class="clip__start" @click="startRecording">{{ $t('ClipRecorder.start') }}</button>
                    </div>

                    <div v-if="!isDisplaySupported && phase === 'idle'" class="font-size-12 gray81 clip__hint">
                        {{ $t('ClipRecorder.screen_https_hint') }}
                    </div>

                    <!-- ERROR (permission / runtime) -->
                    <div v-if="errorMessage" class="font-size-13 clip__msg clip__msg--err">
                        {{ errorMessage }}
                    </div>

                    <!-- PREVIEW -->
                    <div v-if="phase === 'preview' && previewUrl" class="clip__preview">
                        <video v-if="isVideo" :src="previewUrl" class="clip__media" controls></video>
                        <audio v-else :src="previewUrl" class="clip__media" controls></audio>
                    </div>

                    <!-- TITLE (preview only — name the clip before saving) -->
                    <div v-if="phase === 'preview'" class="clip__title-row">
                        <label class="font-size-12 gray81 clip__title-label">{{ $t('ClipRecorder.title_label') }}</label>
                        <input
                            v-model="title"
                            type="text"
                            class="clip__title-input font-size-13"
                            :placeholder="$t('ClipRecorder.title_placeholder')"
                            :maxlength="120"
                            :disabled="isSaving"
                        />
                    </div>

                    <!-- CONTROLS — idle keeps its Start inline with the mode row above,
                         so this is the preview step's actions only. -->
                    <div v-if="phase === 'preview'" class="d-flex justify-content-end clip__actions">
                        <button type="button" class="clip__btn-ghost font-size-13 mr-10px" :disabled="isSaving" @click="reRecord">{{ $t('ClipRecorder.re_record') }}</button>
                        <button type="button" class="btn-primary font-size-13" :disabled="isSaving" @click="saveClip">{{ isSaving ? $t('ClipRecorder.saving') : $t('ClipRecorder.save') }}</button>
                    </div>
                </template>
            </div>
        </div>

        <!-- RECORDING WIDGET — the only thing on screen while recording, so the user
             can keep working. Stop returns to the modal for preview + save. -->
        <div v-else class="clip__mini">
            <span class="clip__dot"></span>
            <span class="clip__mini-timer font-size-13 font-weight-600">{{ formattedElapsed }}</span>
            <button type="button" class="clip__mini-stop" @click="stopRecording">{{ $t('ClipRecorder.stop') }}</button>
        </div>
    </template>
</template>

<script setup>
// PACKAGES
import { ref, computed, watch, onMounted, onBeforeUnmount, inject } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";

// UTILS
import { useClipRecorder } from "@/composables/useClipRecorder";
import { storageQueryBuilder, generateFileName } from "@/utils/storageQueryBuild.js";
import { apiRequestWithoutCompnay } from "@/services";
import { createClip } from "@/services/clips";
import * as env from "@/config/env";
import { useCustomComposable } from "@/composable/index.js";

const { t } = useI18n();
const $toast = useToast();
const recorder = useClipRecorder();
const companyId = inject("$companyId");
const userId = inject("$userId");
const { makeUniqueId } = useCustomComposable();

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
const errorMessage = ref("");
const previewUrl = ref("");
const recordedBlob = ref(null);
const recordedMime = ref("");
const elapsed = ref(0);
const title = ref("");
const isSaving = ref(false);

let mediaStream = null;
let mediaRecorder = null;
let chunks = [];
let timerId = null;

const isVideo = computed(() => mode.value === "screen" || mode.value === "screenMic");

// True while there's recording in progress OR a recorded-but-not-saved clip —
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
    // Cap the encoding bitrate so clips stay small enough to upload within the
    // storage client's socket timeout (server→Wasabi). 2.5 Mbps keeps screen text
    // readable; unsupported browsers just ignore these hints.
    const recorderOptions = {};
    if (mime) recorderOptions.mimeType = mime;
    if (isVideo.value) recorderOptions.videoBitsPerSecond = 2500000;
    recorderOptions.audioBitsPerSecond = 128000;
    try {
        mediaRecorder = new window.MediaRecorder(mediaStream, recorderOptions);
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
        // Suggest a sensible default title (browser-only Date — safe at runtime).
        if (!title.value) {
            title.value = "Clip " + new Date().toLocaleString();
        }
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
        mediaRecorder.stop(); // onstop builds the blob + preview, restores the modal, stops tracks
    } else {
        stopTracks();
    }
}

function reRecord() {
    revokePreview();
    recordedBlob.value = null;
    chunks = [];
    elapsed.value = 0;
    title.value = "";
    phase.value = "idle";
}

// Save: upload the blob ONCE to storage (reusing the exact attachment-upload
// helper + path-guard-safe path), create the clip record, then hand the saved
// record back to the opener (e.g. so a task can attach it).
async function saveClip() {
    if (!recordedBlob.value || isSaving.value) {
        return;
    }
    isSaving.value = true;
    try {
        const blob = recordedBlob.value;
        const mediaType = isVideo.value ? "video" : "audio";
        const mimeType = blob.type || recordedMime.value || (isVideo.value ? "video/webm" : "audio/webm");
        const durationSec = elapsed.value;
        const source = mode.value; // 'screen' | 'voice' | 'screenMic'

        // 1) Upload once to storage. Path is company/user-scoped under a Clips
        //    folder; the server path guard only blocks traversal/escape, so this
        //    prefix is accepted (mirrors how task attachments upload).
        const clipFileName = generateFileName("clip-" + makeUniqueId(12) + ".webm", env.STORAGE_TYPE);
        const cid = companyId && companyId.value ? companyId.value : "";
        const uid = userId && userId.value ? userId.value : "";
        const storagePath = `Clips/${cid}/${uid}/${clipFileName}`;

        const file = new File([blob], clipFileName, { type: mimeType });
        const formData = new FormData();
        formData.append("companyId", cid);
        formData.append("path", storagePath);
        formData.append("file", file);

        const uploadRes = await apiRequestWithoutCompnay(
            "post",
            storageQueryBuilder("upload").route,
            formData,
            "form"
        );

        if (!uploadRes || !uploadRes.data || uploadRes.data.status !== true) {
            throw new Error("Clip upload failed");
        }

        // statusText carries the stored relative path/url (server storage: a
        // string; same shape the attachment flow relies on for non-images).
        const url = uploadRes.data.statusText;

        // 2) Create the clip record.
        const finalTitle = (title.value || "").trim() || ("Clip " + new Date().toLocaleString());
        const clipRes = await createClip({
            title: finalTitle,
            url,
            mediaType,
            mimeType,
            size: blob.size,
            durationSec,
            source,
        });

        if (!clipRes || !clipRes.data || clipRes.data.status !== true) {
            throw new Error("Clip record creation failed");
        }

        const clipRecord = clipRes.data.data;

        // 3) Let the opener react (e.g. attach the clip to a task).
        const onSaved = recorder.getOnSaved();
        if (onSaved) {
            try {
                onSaved(clipRecord);
            } catch (cbError) {
                console.error("ERROR in clip onSaved callback:", cbError);
            }
        }

        $toast.success(t("ClipRecorder.saved"), { position: "top-right" });

        // 4) Clean up + close.
        teardown();
        recorder.closeRecorder();
    } catch (error) {
        console.error("ERROR in save clip:", error);
        $toast.error(t("ClipRecorder.save_failed"), { position: "top-right" });
    } finally {
        isSaving.value = false;
    }
}

// Close intent: confirm if there's an in-progress / unsaved recording so the user
// never loses a clip by clicking outside or hitting the X.
function requestClose() {
    if (isSaving.value) {
        return;
    }
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
    recordedBlob.value = null;
    chunks = [];
}

function close() {
    teardown();
    recorder.closeRecorder();
}

// When a fresh recorder session opens, reset to a clean idle state (the
// component stays mounted across sessions since it lives in the app shell).
watch(() => recorder.state.open, (open) => {
    if (open) {
        phase.value = "idle";
        errorMessage.value = "";
        elapsed.value = 0;
        title.value = "";
        isSaving.value = false;
        recordedBlob.value = null;
        chunks = [];
        revokePreview();
        if (!isDisplaySupported.value && (mode.value === "screen" || mode.value === "screenMic")) {
            mode.value = "voice";
        }
    }
});

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
    z-index: 1100;
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
    /* Mounted at the app shell (navy Header) — set an explicit dark text colour so
       labels/title don't inherit the header's white text and vanish on the card. */
    color: #2b2b2b;
}
.clip__head {
    margin-bottom: 12px;
}
.clip__head-actions {
    gap: 14px;
}
.clip__close {
    color: #9a9a9a;
}
.clip__close:hover {
    color: #e84a4a;
}
/* Idle step: the three modes and Start sit on one line, separated from the
   header by a divider, so choosing and starting is a single row. */
.clip__modes {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    padding-top: 12px;
    margin-bottom: 0;
    border-top: 1px solid #ededf3;
}
.clip__mode {
    display: flex;
    align-items: center;
    gap: 6px;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    padding: 6px 10px;
    cursor: pointer;
    font-size: 12.5px;
}
.clip__mode--active {
    border-color: #2f3990;
    background: #f1f2fb;
}
/* Pushed to the far right of the same row. */
.clip__start {
    margin-left: auto;
    padding: 7px 16px;
    font-family: inherit;
    font-size: 12.5px;
    font-weight: 600;
    color: #fff;
    background: #2f3990;
    border: 0;
    border-radius: 8px;
    cursor: pointer;
}
.clip__start:hover {
    background: #262e75;
}
.clip__mode input:disabled {
    cursor: not-allowed;
}
.clip__hint {
    margin-top: 10px;
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
.clip__dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #e84a4a;
    animation: clip-pulse 1s infinite;
    flex: 0 0 auto;
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
.clip__title-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 12px;
}
.clip__title-label {
    font-weight: 600;
}
.clip__title-input {
    width: 100%;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    padding: 8px 10px;
    outline: none;
    color: #2b2b2b;
}
.clip__title-input:focus {
    border-color: #2f3990;
}
.clip__actions {
    margin-top: 4px;
}
/* btn-primary has no disabled style of its own — show the saving state clearly. */
.clip__actions .btn-primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
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
.clip__btn-ghost:disabled {
    opacity: 0.6;
    cursor: not-allowed;
}
/* Minimized floating widget — keeps recording visible without blocking the page. */
.clip__mini {
    position: fixed;
    right: 20px;
    bottom: 20px;
    z-index: 1100;
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
@keyframes clip-pulse {
    0% { opacity: 1; }
    50% { opacity: 0.3; }
    100% { opacity: 1; }
}
</style>
