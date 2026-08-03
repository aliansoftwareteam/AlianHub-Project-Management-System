<template>
    <!-- image
         The wrapper reserves space and shimmers until the media paints, so
         switching conversations never shows an empty coloured block while the
         signed URL is still being fetched. `.capture` is required because
         `load` does not bubble — but it does reach ancestors on the way down. -->
    <div
        v-if="message.type === 'image'"
        class="mc-media"
        :class="{ 'mc-media--ready': mediaReady }"
        @load.capture="mediaReady = true"
        @error.capture="mediaReady = true"
        @click.prevent="$emit('preview')"
    >
        <ImageIcon
            v-if="message.mediaURL && message.mediaURL.includes('http')"
            :src="message.mediaURL"
            :alt="message.mediaOriginalName"
            :extension="extension"
            class="mc-file-thumb"
        />
        <WasabiImageComp
            v-else
            :data="{ url: message.mediaURL, title: message.mediaOriginalName, filename: message.mediaOriginalName, extension }"
            class="mc-file-thumb"
        />
    </div>

    <!-- audio — the only attachment WITHOUT click-to-preview: the native player
         is already inline, and a click handler over it would swallow play/seek. -->
    <WasabiAudioComp
        v-else-if="message.type === 'audio'"
        :id="`mc_audio_${message._id || message.tempId}`"
        :data="message.mediaURL"
    />

    <!-- video
         Clicking anywhere on the thumbnail opens the previewer rather than
         playing inline — a 180px tile is for recognising the clip, the previewer
         is where it is actually watched (with real controls). Same trade the
         comment renderer makes. -->
    <div
        v-else-if="message.type === 'video'"
        class="mc-media"
        :class="{ 'mc-media--ready': mediaReady }"
        @loadeddata.capture="mediaReady = true"
        @error.capture="mediaReady = true"
        @click.prevent="$emit('preview')"
    >
        <WasabiVideoComp :id="`mc_video_${message._id || message.tempId}`" :data="message.mediaURL" class="mc-file-thumb" />
    </div>

    <!-- any other attachment (documents, archives, …) -->
    <div v-else class="mc-file" @click.prevent="$emit('preview')">
        <span class="mc-file-ic">{{ extension || 'file' }}</span>
        <div style="min-width:0">
            <div class="mc-file-name">{{ message.mediaOriginalName || message.mediaName }}</div>
            <div class="mc-file-meta">{{ prettySize }}</div>
        </div>
    </div>

    <!-- in-flight upload -->
    <div v-if="message.isSending" class="mc-bar"><i></i></div>
</template>

<script setup>
/**
 * One attachment, rendered.
 *
 * Split out of MainChatMessageBody so the details pane's media grid can show the
 * asset ALONE. Reusing the whole message body there dragged along the quoted
 * reply line and the "(edited)" badge, which spilled out of the square tiles.
 *
 * Only ever rendered for attachment messages — the caller decides that; the
 * final branch is therefore "some other file type", not "not a message".
 */
import { computed, defineProps, defineEmits, ref, watch } from 'vue';
import WasabiImageComp from '@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue';
import WasabiAudioComp from '@/components/atom/wasabiComps/wasabAudio.vue';
import WasabiVideoComp from '@/components/atom/wasabiComps/wasabVideo.vue';
import ImageIcon from '@/components/atom/ImageIcon/ImageIcon.vue';

const props = defineProps({
    message: { type: Object, required: true },
});

defineEmits(['preview']);

// Flipped by the wrapper's captured `load` / `loadeddata`, which is what stops
// the shimmer. Reset if the message's media changes (e.g. a placeholder settling
// into the stored document) so the new asset shimmers too.
const mediaReady = ref(false);
watch(() => props.message.mediaURL, () => { mediaReady.value = false; });

const extension = computed(() => {
    const name = props.message.mediaOriginalName || props.message.mediaName || '';
    const parts = String(name).split('.');
    return parts.length > 1 ? parts.pop().toLowerCase() : '';
});

const prettySize = computed(() => {
    const bytes = Number(props.message.mediaSize || 0);
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
});
</script>
