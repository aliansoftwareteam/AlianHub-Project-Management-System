<template>
    <!-- direct message: the other person's avatar -->
    <MainChatAvatar
        v-if="!isChannel"
        :name="title"
        :src="avatarSrc"
        :presence="presence"
        :size="size"
    />

    <!-- channel with an uploaded image -->
    <span v-else-if="kind === 'image'" class="mc-cicon" :class="sizeClass">
        <img v-if="isAbsolute" :src="icon.url" :alt="title" />
        <WasabiImageComp v-else :data="{ url: icon.url }" />
    </span>

    <!-- channel with a chosen glyph -->
    <span v-else-if="kind === 'icon'" class="mc-cicon mc-cicon--glyph" :class="sizeClass">
        <FontAwesomeIcon :icon="faIcon" />
    </span>

    <!-- no icon picked: the conventional hash -->
    <span v-else class="mc-cicon mc-cicon--hash" :class="sizeClass">#</span>
</template>

<script setup>
/**
 * How a conversation is represented visually, in one place.
 *
 * A channel may carry an uploaded image or a picked FontAwesome glyph — the
 * create-channel flow spreads that `icon` object onto the channel document, so
 * `type` / `url` / `iconName` / `prefix` sit on the channel itself (which is why
 * `icon` here is usually just the channel). The bare `#` is the LAST resort, for
 * channels with no icon at all; the header and the details pane both used to show
 * it unconditionally and threw away an icon the sidebar was already displaying.
 */
import { computed, defineProps } from 'vue';
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome';
import { ensureFaIcons, findFaIcon } from '@/utils/faIcons';
import WasabiImageComp from '@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue';
import MainChatAvatar from './MainChatAvatar.vue';

const props = defineProps({
    title: { type: String, default: '' },
    avatarSrc: { type: String, default: '' },
    isChannel: { type: Boolean, default: false },
    // The channel document (or any { type, url, iconName, prefix } bag).
    icon: { type: Object, default: () => ({}) },
    size: { type: Number, default: 34 },
    presence: { type: Boolean, default: null },
});

// Memoized, so this costs nothing after the first component that calls it.
ensureFaIcons();

const faIcon = computed(() => {
    const icon = props.icon || {};
    return icon.iconName ? findFaIcon(icon.iconName, icon.prefix) : undefined;
});

const kind = computed(() => {
    const icon = props.icon || {};
    if (icon.type === 'image' && icon.url) return 'image';
    // Fall back to the hash when a stored glyph cannot be resolved, rather than
    // rendering an empty circle.
    if (icon.type === 'icon' && faIcon.value) return 'icon';
    return '';
});

// An absolute URL renders directly; a stored key has to go through the storage
// component to be signed first.
const isAbsolute = computed(() => String((props.icon && props.icon.url) || '').includes('http'));

const sizeClass = computed(() => (props.size === 28 ? 'mc-cicon--28' : 'mc-cicon--34'));
</script>
