<template>
    <span
        class="mc-av"
        :class="size === 28 ? 'mc-av--28' : 'mc-av--34'"
        :style="{ background: showInitials ? color : 'transparent' }"
        :title="name || ''"
    >
        <!-- already a browsable URL -->
        <img v-if="absoluteUrl" :src="src" :alt="name || ''" />

        <!-- a stored profile key: the shared storage component signs it. `userImage`
             matters — profile photos live in their own bucket and are fetched through
             a different endpoint than ordinary attachments. -->
        <WasabiImageComp
            v-else-if="storedKey"
            :userImage="true"
            :data="{ title: name || '', url: src, filename: fileName, extension }"
            class="mc-av-img"
        />

        <template v-else>{{ initials }}</template>
        <i v-if="presence !== null" class="mc-av-dot" :class="{ 'mc-av-dot--on': presence }"></i>
    </span>
</template>

<script setup>
/**
 * Colour-seeded initials avatar, with the real photo when there is one.
 *
 * Three cases, and the middle one is the reason this is not just an <img>:
 *
 *   absolute URL   -> render directly
 *   stored key     -> hand to WasabiImageComp, which resolves it to a signed URL
 *   nothing usable -> initials on a seeded colour
 *
 * That middle case used to fall through to initials as well, on the reasoning that a
 * raw storage key in an <img> renders broken. The consequence was that every user with
 * an uploaded photo showed initials everywhere in this module, while the rest of the
 * app (UserProfile) resolved them properly.
 *
 * The app's own default_user.png is treated as "nothing usable" on purpose: getUser()
 * substitutes it for anyone without a photo, and it is a bundled asset rather than a
 * storage key — so sending it to storage would fire a request that can only 404, for a
 * large share of users. Initials are also more use than an identical grey silhouette,
 * which is why they were introduced here in the first place.
 */
import { computed, defineProps, inject } from 'vue';
import WasabiImageComp from '@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue';

const props = defineProps({
    name: { type: String, default: '' },
    src: { type: String, default: '' },
    size: { type: Number, default: 34 },
    // true = online, false = offline, null = don't show a presence dot at all
    presence: { type: Boolean, default: null },
});

const defaultUserAvatar = inject('$defaultUserAvatar', '');

// Muted, mid-dark hues that all carry white text at AA and sit calmly next to
// the app's navy.
const PALETTE = ['#5b63c4', '#2b9e86', '#c2683f', '#8557a8', '#3f7fc2', '#5f8a3a', '#b0533f', '#3f7f7a'];

const source = computed(() => String(props.src || ''));

const absoluteUrl = computed(() => source.value.includes('http') || source.value.startsWith('data:'));

/** A real storage key — not empty, not absolute, and not the bundled placeholder. */
const storedKey = computed(() => {
    if (!source.value || absoluteUrl.value) return false;
    if (defaultUserAvatar && source.value === defaultUserAvatar) return false;
    // Webpack serves bundled assets from /img/; a storage key never looks like that.
    if (source.value.includes('/img/') || source.value.includes('default_user')) return false;
    return true;
});

const showInitials = computed(() => !absoluteUrl.value && !storedKey.value);

const initials = computed(() => {
    const parts = (props.name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
});

const fileName = computed(() => source.value.split('/').pop() || '');
const extension = computed(() => {
    const parts = fileName.value.split('.');
    return parts.length > 1 ? parts.pop() : '';
});

const color = computed(() => {
    const source_ = props.name || '?';
    let hash = 0;
    for (let i = 0; i < source_.length; i += 1) {
        hash = (hash * 31 + source_.charCodeAt(i)) % 100000;
    }
    return PALETTE[hash % PALETTE.length];
});
</script>
