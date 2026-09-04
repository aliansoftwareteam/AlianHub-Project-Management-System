<template>
    <div v-if="variant === 'inline'" class="app-teaser-chip cursor-pointer" role="button" tabindex="0"
        :title="$t('AppsV2.enable_under', { desc: resolvedDescription, location: resolvedLocation })" @click="goToSettings" @keyup.enter="goToSettings">
        <span class="app-teaser-chip__lock" aria-hidden="true">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="4" y="11" width="16" height="9" rx="2"></rect>
                <path d="M8 11V8a4 4 0 0 1 8 0v3"></path>
            </svg>
        </span>
        <span class="app-teaser-chip__label">{{ resolvedTitle }}</span>
        <span class="app-teaser-chip__cta">{{ $t('AppsV2.enable') }}</span>
    </div>

    <div v-else class="app-teaser-banner cursor-pointer" role="button" tabindex="0" @click="goToSettings" @keyup.enter="goToSettings">
        <span class="app-teaser-banner__ic" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="4" y="11" width="16" height="9" rx="2"></rect>
                <path d="M8 11V8a4 4 0 0 1 8 0v3"></path>
            </svg>
        </span>
        <span class="app-teaser-banner__text">
            <span class="app-teaser-banner__title">{{ resolvedTitle }}</span>
            <span class="app-teaser-banner__desc">{{ resolvedDescription }}</span>
            <span class="app-teaser-banner__hint">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="3"></circle>
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 8 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H2a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 3.6 8a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H8a1.65 1.65 0 0 0 1-1.51V2a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V8a1.65 1.65 0 0 0 1.51 1H22a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                </svg>
                {{ resolvedLocation }}
            </span>
        </span>
        <span class="app-teaser-banner__cta">
            {{ buttonText || $t('AppsV2.enable_in_settings') }}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"></path></svg>
        </span>
    </div>
</template>

<script setup>
import { computed, inject } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';

const props = defineProps({
    appKey: { type: String, default: '' },
    variant: { type: String, default: 'block' },
    title: { type: String, default: '' },
    description: { type: String, default: '' },
    buttonText: { type: String, default: '' },
    location: { type: String, default: '' }
});

const router = useRouter();
const { t, te } = useI18n();
const companyId = inject('$companyId', null);

const copy = (part) => (te(`AppsV2.${props.appKey}_${part}`) ? t(`AppsV2.${props.appKey}_${part}`) : '');
const resolvedTitle = computed(() => props.title || copy('title') || props.appKey);
const resolvedDescription = computed(() => props.description || copy('desc'));
const resolvedLocation = computed(() => props.location || t('AppsV2.location'));

function goToSettings() {
    const cid = companyId?.value || companyId;
    router.push({ name: 'Settings-Projects', params: { cid } }).catch(() => {});
}
</script>

<style src="./style.css"></style>
