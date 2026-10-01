<template>
    <div class="empty-state" :class="{ 'empty-state--compact': compact }">
        <EmptyIllustration :name="illustration" class="empty-state__art" />
        <component :is="`h${level}`" v-if="title" class="empty-state__title">{{ title }}</component>
        <p v-if="message || $slots.default" class="empty-state__msg"><slot>{{ message }}</slot></p>
        <div v-if="showAction || secondaryLabel" class="empty-state__actions">
            <button
                v-if="showAction"
                type="button"
                class="ah-btn ah-btn--primary empty-state__btn"
                :class="{ 'ah-btn--sm': compact }"
                @click="$emit('action')"
            >{{ actionLabel }}</button>
            <button v-if="secondaryLabel" type="button" class="empty-state__link" @click="$emit('secondary')">{{ secondaryLabel }}</button>
        </div>
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
import EmptyIllustration from './EmptyIllustration.vue';

defineEmits(['action', 'secondary']);

const props = defineProps({
    title: { type: String, default: '' },
    message: { type: String, default: '' },
    illustration: { type: String, default: 'generic' },
    headingLevel: { type: Number, default: 3, validator: (level) => level >= 1 && level <= 6 },
    actionLabel: { type: String, default: '' },
    // The caller's own permission check: the label can stay put while the action comes and goes.
    actionAllowed: { type: Boolean, default: true },
    secondaryLabel: { type: String, default: '' },
    compact: { type: Boolean, default: false },
    // A path appended to the company's help link. Left empty, no link is shown.
    helpPath: { type: String, default: '' },
    // Declared so that views which still pass a picture do not leak it onto the root as an attribute; nothing draws it.
    image: { type: String, default: '' },
});

const store = useStore();

const level = computed(() => Math.min(6, Math.max(1, Math.round(props.headingLevel))));
const showAction = computed(() => Boolean(props.actionLabel) && props.actionAllowed);

// Self-hosters can point helpLink at their own documentation, so the base has to come from brand
// settings rather than being hardcoded. No base configured means no link rather than a dead one.
const resolvedHelpHref = computed(() => {
    if (!props.helpPath) return '';
    const base = store?.getters['brandSettingTab/brandSettings']?.helpLink;
    if (!base) return '';
    return `${String(base).replace(/\/+$/, '')}/${String(props.helpPath).replace(/^\/+/, '')}`;
});
</script>

<style scoped>
.empty-state {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 24px 20px;
    text-align: center;
    animation: empty-state-in var(--t-panel) var(--ease) both;
}
.empty-state--compact {
    padding: var(--sp-6, 12px) var(--sp-7, 14px);
}
.empty-state__art {
    max-width: 100%;
    margin-bottom: var(--sp-4, 8px);
}
.empty-state--compact .empty-state__art {
    width: 64px;
    height: 48px;
    margin-bottom: var(--sp-3, 6px);
}
.empty-state__title {
    font: var(--text-h3);
    color: var(--ink);
    margin: 0 0 6px;
}
.empty-state__msg {
    font: var(--text-small);
    color: var(--ink-2);
    max-width: 380px;
    margin: 0 0 16px;
}
.empty-state--compact .empty-state__msg {
    margin-bottom: var(--sp-4, 8px);
}
.empty-state__msg:last-child,
.empty-state__title:last-child {
    margin-bottom: 0;
}
.empty-state__actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: var(--sp-4, 8px) var(--sp-6, 12px);
}
.empty-state__btn {
    margin: 0;
}
.empty-state__link {
    min-height: var(--hit-min);
    padding: 0 var(--sp-2, 4px);
    border: 0;
    border-radius: var(--r-input);
    background: transparent;
    font: 600 var(--fs-md, 13px)/1.2 var(--font-ui);
    color: var(--brand);
    cursor: pointer;
}
.empty-state__link:hover {
    text-decoration: underline;
}
.empty-state__link:focus-visible {
    outline: none;
    box-shadow: var(--focus);
}
.empty-state__help {
    display: inline-block;
    margin-top: 12px;
    font: var(--text-small);
    color: var(--brand);
    text-decoration: none;
}
.empty-state__help:hover {
    text-decoration: underline;
}
@keyframes empty-state-in {
    from { opacity: 0; }
    to { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
    .empty-state { animation: none; }
}
</style>
