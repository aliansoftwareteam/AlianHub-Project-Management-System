<template>
    <!-- What a camera-off participant looks like: their photo if we have one, otherwise
         the initial on a colour derived from their name. A black rectangle reads as a
         broken call; a face or a letter reads as "they turned the camera off". -->
    <div class="call-av" :style="{ width: px, height: px }">
        <!-- A direct URL or an inline data: image can go straight into an <img>. -->
        <img
            v-if="directSrc && !failed"
            :src="directSrc"
            alt=""
            class="call-av__img"
            @error="failed = true"
        />
        <!-- Anything else is a storage key, not a URL. Putting one in an <img> makes the
             browser resolve it against the current page, 404, and render the alt text —
             which is what put a stray name in the middle of the call window. -->
        <WasabiImage
            v-else-if="storageKey && !failed"
            :userImage="true"
            class="call-av__img"
            :style="{ width: px, height: px }"
            :data="{ title: name, url: storageKey, filename: storageKey, extension: extensionOf(storageKey) }"
            :thumbnail="thumb"
        />
        <span v-else class="call-av__letter" :style="{ background: tint, fontSize: letterSize }">{{ initial }}</span>
    </div>
</template>

<script setup>
import { computed, ref, watch, defineProps } from 'vue';
import WasabiImage from '@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue';

const props = defineProps({
    name: { type: String, default: '' },
    image: { type: String, default: '' },
    size: { type: Number, default: 96 },
});

// A picture that will not load must fall back to the letter. Without this the browser
// renders the alt text instead, which looks like a layout bug rather than a missing photo.
const failed = ref(false);
watch(() => props.image, () => { failed.value = false; });

// Profile images come in two shapes: a real URL (or an inline data: image), and a bare
// storage key that only means something to the storage layer.
const isDirect = (v) => /^(https?:|data:|blob:)/i.test(String(v || ''));
const directSrc = computed(() => (isDirect(props.image) ? props.image : ''));
const storageKey = computed(() => (props.image && !isDirect(props.image) ? props.image : ''));
const extensionOf = (v) => String(v || '').split('.').pop();
// Ask for a thumbnail near the rendered size rather than the full image.
const thumb = computed(() => (props.size > 60 ? '80x80' : '40x40'));

const px = computed(() => `${props.size}px`);
const letterSize = computed(() => `${Math.round(props.size * 0.42)}px`);
const initial = computed(() => (props.name || '?').trim().charAt(0).toUpperCase() || '?');

/**
 * A stable colour per person, so the same name always gets the same tile and the letter
 * becomes recognisable rather than decorative. Hand-picked hues rather than a random
 * hash: white text has to stay readable on every one of them.
 */
const TINTS = ['#3f6fd8', '#2f8f6b', '#a8563f', '#6a4fb3', '#b0863a', '#2f7f96', '#a34a72'];
const tint = computed(() => {
    const n = props.name || '';
    let sum = 0;
    for (let i = 0; i < n.length; i++) sum += n.charCodeAt(i);
    return TINTS[sum % TINTS.length];
});
</script>

<style scoped>
.call-av { border-radius: 50%; overflow: hidden; flex: none; }
.call-av__img { width: 100%; height: 100%; object-fit: cover; display: block; }
.call-av__letter {
    width: 100%; height: 100%;
    display: flex; align-items: center; justify-content: center;
    color: #fff; font-weight: 500; line-height: 1; user-select: none;
}
</style>
