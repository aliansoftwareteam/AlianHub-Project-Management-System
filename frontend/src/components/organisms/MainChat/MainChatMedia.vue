<template>
    <!-- image -->
    <div
        v-if="message.type === 'image'"
        :class="tile ? 'mc-tile' : 'mc-media'"
        :title="message.mediaOriginalName"
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

    <!-- voice note / audio -->
    <MainChatAudioNote
        v-else-if="message.type === 'audio'"
        :message="message"
        :compact="tile"
        @make-task="$emit('make-task', $event)"
        @transcribed="$emit('transcribed', $event)"
    />

    <!-- video -->
    <div
        v-else-if="message.type === 'video'"
        :class="tile ? 'mc-tile mc-tile--video' : 'mc-media'"
        :title="message.mediaOriginalName"
        @click.prevent="$emit('preview')"
    >
        <WasabiVideoComp :id="`mc_video_${message._id || message.tempId}`" :data="message.mediaURL" class="mc-file-thumb" />
    </div>

    <!-- document tile -->
    <div v-else-if="tile" class="mc-tile" :class="{ 'mc-tile--brand': isBrandTile }" :title="message.mediaOriginalName || message.mediaName" @click.prevent="$emit('preview')">
        <span class="mc-tile-name">{{ message.mediaOriginalName || message.mediaName || extension }}</span>
    </div>

    <!-- document row -->
    <div v-else class="mc-file" @click.prevent="$emit('preview')">
        <span class="mc-file-ic">{{ extension || 'file' }}</span>
        <div style="min-width:0">
            <div class="mc-file-name">{{ message.mediaOriginalName || message.mediaName }}</div>
            <div class="mc-file-meta">{{ prettySize }}</div>
        </div>
    </div>

    <div v-if="message.isSending" class="mc-bar"><i></i></div>
</template>

<script setup>
import { computed, defineProps, defineEmits } from 'vue';
import WasabiImageComp from '@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue';
import WasabiVideoComp from '@/components/atom/wasabiComps/wasabVideo.vue';
import ImageIcon from '@/components/atom/ImageIcon/ImageIcon.vue';
import MainChatAudioNote from './MainChatAudioNote.vue';

const props = defineProps({
    message: { type: Object, required: true },
    // 96×70 gallery tile instead of the full-size rendering.
    tile: { type: Boolean, default: false },
});

defineEmits(['preview', 'make-task', 'transcribed']);

const extension = computed(() => {
    const name = props.message.mediaOriginalName || props.message.mediaName || '';
    const parts = String(name).split('.');
    return parts.length > 1 ? parts.pop().toLowerCase() : '';
});

const isBrandTile = computed(() => ['pdf', 'doc', 'docx'].includes(extension.value));

const prettySize = computed(() => {
    const bytes = Number(props.message.mediaSize || 0);
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
});
</script>
