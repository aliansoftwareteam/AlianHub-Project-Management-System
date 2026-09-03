<template>
    <div class="mc-note" :class="{ 'mc-note--compact': compact }">
        <div class="mc-note-row">
            <button type="button" class="mc-note-play" :disabled="!src" :title="playing ? $t('MainChat.pause') : 'Play'" @click="toggle">
                <ShellIcon :name="playing ? 'pause' : 'play'" :size="12" />
            </button>
            <div class="mc-note-wave" @click="seek">
                <span
                    v-for="(height, index) in bars"
                    :key="index"
                    :style="{ height: `${height}%` }"
                    :class="{ 'is-past': index / bars.length < progress }"
                ></span>
            </div>
            <span class="mc-note-time">{{ timeLabel }}</span>
        </div>

        <div v-if="transcript" class="mc-note-transcript">
            <span class="mc-note-label">{{ $t('ChatV2.transcript') }}</span>
            “{{ transcript }}”
        </div>

        <div v-if="!compact && !message.isSending" class="mc-note-acts">
            <template v-if="transcript">
                <button type="button" class="ah-btn ah-btn--outline ah-btn--sm" @click="$emit('make-task', { message, text: transcript })">{{ $t('ChatV2.make_task') }}</button>
                <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="copy">{{ $t('ChatV2.copy_text') }}</button>
            </template>
            <button v-else type="button" class="ah-btn ah-btn--outline ah-btn--sm" :disabled="busy || !src" @click="transcribe">
                {{ busy ? $t('ChatV2.transcribing') : $t('ChatV2.transcribe') }}
            </button>
            <span v-if="error" class="ah-field__error">{{ error }}</span>
        </div>

        <audio
            ref="audio"
            :src="src || undefined"
            preload="metadata"
            @loadedmetadata="onMeta"
            @timeupdate="onTime"
            @play="playing = true"
            @pause="playing = false"
            @ended="playing = false"
        ></audio>
    </div>
</template>

<script setup>
/**
 * A voice note: play button, waveform, duration, and the transcript once it exists.
 * The transcript is written back onto the message so everyone in the conversation
 * sees it and nobody pays for the same transcription twice.
 */
import { computed, defineProps, defineEmits, inject, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToast } from 'vue-toast-notification';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { storageHelper } from '@/composable/commonFunction';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';

const props = defineProps({
    message: { type: Object, required: true },
    compact: { type: Boolean, default: false },
});

const emit = defineEmits(['make-task', 'transcribed']);

const { t } = useI18n();
const $toast = useToast();
const companyId = inject('$companyId');
const { handleStorageImageRequest } = storageHelper();

const audio = ref(null);
const src = ref('');
const playing = ref(false);
const duration = ref(0);
const current = ref(0);
const busy = ref(false);
const error = ref('');
const transcript = ref(props.message.transcript || '');

watch(() => props.message.transcript, (value) => { if (value) transcript.value = value; });

const BAR_COUNT = 28;
// A stable pseudo-waveform per note: the real amplitude is not stored, and a bar
// pattern that changes on every render would read as broken.
const bars = computed(() => {
    const seed = String(props.message._id || props.message.tempId || 'note');
    let hash = 0;
    for (let i = 0; i < seed.length; i += 1) hash = (hash * 33 + seed.charCodeAt(i)) % 65521;
    const out = [];
    for (let i = 0; i < BAR_COUNT; i += 1) {
        hash = (hash * 9301 + 49297) % 233280;
        out.push(25 + Math.round((hash / 233280) * 75));
    }
    return out;
});

const progress = computed(() => (duration.value ? current.value / duration.value : 0));

function fmt(seconds) {
    const total = Math.max(0, Math.round(seconds || 0));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
const timeLabel = computed(() => (playing.value || current.value ? fmt(current.value) : fmt(duration.value)));

async function resolveSrc() {
    const path = props.message.mediaURL || '';
    if (!path) return;
    if (/^(https?:|blob:|data:)/i.test(path)) {
        src.value = path;
        return;
    }
    try {
        const result = await handleStorageImageRequest({ companyId: companyId.value, data: { url: path }, isCache: true });
        src.value = (result && result.url) || '';
    } catch (e) {
        src.value = '';
    }
}

onMounted(resolveSrc);
watch(() => props.message.mediaURL, resolveSrc);

function onMeta() {
    if (audio.value && Number.isFinite(audio.value.duration)) duration.value = audio.value.duration;
}
function onTime() {
    if (audio.value) current.value = audio.value.currentTime;
}
function toggle() {
    if (!audio.value || !src.value) return;
    if (playing.value) audio.value.pause();
    else audio.value.play().catch(() => {});
}
function seek(event) {
    if (!audio.value || !duration.value) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    audio.value.currentTime = ratio * duration.value;
}

async function transcribe() {
    if (busy.value || !src.value) return;
    busy.value = true;
    error.value = '';
    try {
        const blob = await fetch(src.value).then((r) => r.blob());
        const form = new FormData();
        form.append('file', new File([blob], props.message.mediaOriginalName || 'voice-note.webm', { type: blob.type || 'audio/webm' }));
        const res = await apiRequest('post', env.AI_TRANSCRIBE, form, 'form');
        const body = res && res.data;
        const text = body && body.status && body.data && typeof body.data.text === 'string' ? body.data.text.trim() : '';
        if (!text) {
            error.value = (body && body.statusText) || t('ChatV2.transcribe_failed');
            return;
        }
        transcript.value = text;
        if (props.message._id) {
            await apiRequest('put', env.API_COMMENTS, {
                id: props.message._id,
                data: { transcript: text },
                isProjectComment: props.message.project,
                options: { timestamps: false },
            }).catch((e) => console.error('MainChat: transcript save failed', e));
        }
        emit('transcribed', { message: props.message, text });
    } catch (e) {
        error.value = (e && e.response && e.response.data && e.response.data.statusText) || t('ChatV2.transcribe_failed');
    } finally {
        busy.value = false;
    }
}

function copy() {
    navigator.clipboard.writeText(transcript.value || '')
        .then(() => $toast.success(t('ChatV2.copied'), { position: 'top-right' }))
        .catch(() => $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' }));
}
</script>
