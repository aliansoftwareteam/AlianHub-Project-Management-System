<template>
    <div class="empty-state d-flex align-items-center justify-content-center flex-column" :class="toneClass">
        <img v-if="resolvedImage" :src="resolvedImage" alt="" class="empty-state__img">
        <h3 class="empty-state__title mt-1">{{ title }}</h3>
        <p v-if="message" class="empty-state__msg">{{ message }}</p>
        <button
            v-if="actionLabel"
            type="button"
            class="cursor-pointer font-roboto-sans empty-state__btn"
            :class="tone ? 'empty-state__btn--tone' : 'blue_btn'"
            @mousedown.stop.prevent="onActionPointer"
            @click.stop.prevent="onActionClick"
        >{{ actionLabel }}</button>
        <a
            v-if="resolvedHelpHref"
            :href="resolvedHelpHref"
            target="_blank"
            rel="noopener noreferrer"
            class="empty-state__help"
        >{{ $t('EmptyState.learn_more') }}</a>
    </div>
</template>

<script setup>
import { computed, defineProps, defineEmits, ref } from 'vue';
import { useStore } from 'vuex';

const emit = defineEmits(['action']);
const skipClick = ref(false);
function onActionPointer() {
    skipClick.value = true;
    emit('action');
}
function onActionClick() {
    if (skipClick.value) {
        skipClick.value = false;
        return;
    }
    emit('action');
}

const props = defineProps({
    title: { type: String, default: '' },
    message: { type: String, default: '' },
    actionLabel: { type: String, default: '' },
    image: { type: String, default: '' },
    helpPath: { type: String, default: '' },
    tone: { type: String, default: '' },
});

const noSearchResult = require('@/assets/images/svg/No-Search-Result.svg');

const { getters } = useStore();

const toneClass = computed(() => (props.tone === 'pine' || props.tone === 'copper' ? `empty-state--${props.tone}` : ''));
const resolvedImage = computed(() => {
    if (props.tone) return props.image || '';
    return props.image || noSearchResult;
});

const resolvedHelpHref = computed(() => {
    if (!props.helpPath) return '';
    const base = getters['brandSettingTab/brandSettings']?.helpLink;
    if (!base) return '';
    return `${String(base).replace(/\/+$/, '')}/${String(props.helpPath).replace(/^\/+/, '')}`;
});
</script>

<style scoped>
.empty-state--pine,
.empty-state--copper {
    background: var(--kiln-paper, #f4ead8);
    border: 1px solid var(--kiln-line, #d8cbb3);
    border-radius: var(--kiln-radius-sm, 9px);
    max-width: 420px;
    margin: 16px auto;
}
.empty-state--copper {
    border-left: 3px solid var(--kiln-ember, #c45c26);
}
.empty-state__img {
    max-width: 180px;
}
.empty-state__title {
    font-family: var(--kiln-font-display), Georgia, serif;
    font-size: 18px;
    font-weight: 600;
    color: var(--kiln-ink, #1b2f28);
    margin-bottom: 6px;
}
.empty-state__msg {
    font-family: var(--kiln-font-body), sans-serif;
    font-size: 13.5px;
    line-height: 1.5;
    color: var(--kiln-muted, #5d6e66);
    max-width: 380px;
    margin: 0 0 16px;
}
.empty-state__btn {
    margin: 0;
}
.empty-state__btn--tone {
    min-height: 32px;
    padding: 6px 14px;
    border: 1px solid var(--kiln-line, #d8cbb3);
    border-radius: var(--kiln-radius-sm, 9px);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
}
.empty-state--pine .empty-state__btn--tone {
    background: var(--kiln-ink, #1b2f28);
    color: var(--kiln-paper, #f4ead8);
}
.empty-state--pine .empty-state__btn--tone:active {
    background: var(--kiln-ink, #1b2f28);
    color: var(--kiln-paper, #f4ead8);
}
.empty-state--copper .empty-state__btn--tone {
    background: var(--kiln-ember, #c45c26);
    color: var(--kiln-paper, #f4ead8);
}
.empty-state--copper .empty-state__btn--tone:active {
    background: var(--kiln-ink, #1b2f28);
    color: var(--kiln-paper, #f4ead8);
}
.empty-state__help {
    display: inline-block;
    margin-top: 12px;
    font-family: var(--kiln-font-body), sans-serif;
    font-size: 13px;
    color: var(--kiln-ember, #c45c26);
    text-decoration: none;
}
.empty-state__help:hover {
    text-decoration: underline;
}
</style>
