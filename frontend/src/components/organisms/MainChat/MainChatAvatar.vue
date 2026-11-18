<template>
    <span
        class="mc-av"
        :class="[`mc-av--${size}`, { 'mc-av--agent': agent }]"
        :style="{ background: showInitials && !agent ? color : null }"
        :title="name || ''"
    >
        <template v-if="agent">◉</template>
        <img v-else-if="absoluteUrl" :src="src" :alt="name || ''" />
        <WasabiImageComp
            v-else-if="storedKey"
            :userImage="true"
            :data="{ title: name || '', url: src, filename: fileName, extension }"
            class="mc-av-img"
        />
        <template v-else>{{ initials }}</template>
        <i v-if="presence !== null && !agent" class="mc-av-dot" :class="{ 'mc-av-dot--on': presence }"></i>
    </span>
</template>

<script setup>
/**
 * People are circles seeded with a colour; agents are rounded squares with the ◉ glyph
 * so one can never be mistaken for the other.
 *
 * A stored profile key goes through WasabiImageComp, which resolves it to a signed URL.
 * The bundled default_user.png is treated as "no photo": it is not a storage key, and
 * initials are more use than an identical grey silhouette.
 */
import { computed, defineProps, inject } from 'vue';
import WasabiImageComp from '@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue';

const props = defineProps({
    name: { type: String, default: '' },
    src: { type: String, default: '' },
    size: { type: Number, default: 26 },
    presence: { type: Boolean, default: null },
    agent: { type: Boolean, default: false },
});

const defaultUserAvatar = inject('$defaultUserAvatar', '');

const PALETTE = ['#5b63c4', '#2b9e86', '#c2683f', '#8557a8', '#3f7fc2', '#5f8a3a', '#b0533f', '#3f7f7a'];

const source = computed(() => String(props.src || ''));
const absoluteUrl = computed(() => source.value.includes('http') || source.value.startsWith('data:'));
const storedKey = computed(() => {
    if (!source.value || absoluteUrl.value) return false;
    if (defaultUserAvatar && source.value === defaultUserAvatar) return false;
    if (source.value.includes('/img/') || source.value.includes('default_user')) return false;
    return true;
});
const showInitials = computed(() => !absoluteUrl.value && !storedKey.value);

const initials = computed(() => {
    const parts = (props.name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, props.size <= 26 ? 1 : 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
});

const fileName = computed(() => source.value.split('/').pop() || '');
const extension = computed(() => {
    const parts = fileName.value.split('.');
    return parts.length > 1 ? parts.pop() : '';
});

const color = computed(() => {
    const seed = props.name || '?';
    let hash = 0;
    for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) % 100000;
    return PALETTE[hash % PALETTE.length];
});
</script>
