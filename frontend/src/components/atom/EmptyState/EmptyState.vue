<template>
    <div class="empty-state d-flex align-items-center justify-content-center flex-column">
        <img :src="image || noSearchResult" alt="" class="empty-state__img">
        <h3 class="empty-state__title mt-1">{{ title }}</h3>
        <p v-if="message" class="empty-state__msg">{{ message }}</p>
        <button
            v-if="actionLabel"
            type="button"
            class="blue_btn cursor-pointer font-roboto-sans empty-state__btn"
            @click="$emit('action')"
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
import { computed, defineProps, defineEmits } from 'vue';
import { useStore } from 'vuex';

defineEmits(['action']);

const props = defineProps({
    title: { type: String, default: '' },
    message: { type: String, default: '' },
    actionLabel: { type: String, default: '' },
    image: { type: String, default: '' },
    // A path appended to the company's help link. Left empty, no link is shown.
    helpPath: { type: String, default: '' },
});

const noSearchResult = require('@/assets/images/svg/No-Search-Result.svg');

const { getters } = useStore();

// Self-hosters can point helpLink at their own documentation, so the base has to come from brand
// settings rather than being hardcoded. No base configured means no link rather than a dead one.
const resolvedHelpHref = computed(() => {
    if (!props.helpPath) return '';
    const base = getters['brandSettingTab/brandSettings']?.helpLink;
    if (!base) return '';
    return `${String(base).replace(/\/+$/, '')}/${String(props.helpPath).replace(/^\/+/, '')}`;
});
</script>

<style scoped>
.empty-state {
    width: 100%;
    padding: 24px 20px;
    text-align: center;
}
.empty-state__img {
    max-width: 180px;
}
.empty-state__title {
    font-family: Roboto, sans-serif;
    font-size: 18px;
    font-weight: 500;
    color: #172b4d;
    margin-bottom: 6px;
}
.empty-state__msg {
    font-family: Roboto, sans-serif;
    font-size: 13.5px;
    line-height: 1.5;
    color: #8c8c8c;
    max-width: 380px;
    margin: 0 0 16px;
}
.empty-state__btn {
    margin: 0;
}
.empty-state__help {
    display: inline-block;
    margin-top: 12px;
    font-family: Roboto, sans-serif;
    font-size: 13px;
    color: #2f6fdb;
    text-decoration: none;
}
.empty-state__help:hover {
    text-decoration: underline;
}
</style>
