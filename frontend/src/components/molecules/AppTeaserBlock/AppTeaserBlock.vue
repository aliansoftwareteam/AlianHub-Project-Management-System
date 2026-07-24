<template>
    <!-- Inline variant: a compact "locked" chip for inline controls (tags, AI buttons). -->
    <div v-if="variant === 'inline'" class="app-teaser-chip cursor-pointer" role="button" tabindex="0"
        :title="`${resolvedDescription} — enable under ${location}`" @click="goToSettings" @keyup.enter="goToSettings">
        <span class="app-teaser-chip__lock" aria-hidden="true">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="4" y="11" width="16" height="9" rx="2"></rect>
                <path d="M8 11V8a4 4 0 0 1 8 0v3"></path>
            </svg>
        </span>
        <span class="app-teaser-chip__label">{{ resolvedTitle }}</span>
        <span class="app-teaser-chip__cta">Enable</span>
    </div>

    <!-- Block variant (default): compact dashed "available, not enabled" banner.
         Auto-height, single row (wraps in narrow columns). A quiet accent CTA —
         not the green button — so it reads as a free toggle, not a paid upgrade. -->
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
                {{ location }}
            </span>
        </span>
        <span class="app-teaser-banner__cta">
            {{ buttonText }}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"></path></svg>
        </span>
    </div>
</template>

<script setup>
import { computed, inject } from 'vue';
import { useRouter } from 'vue-router';

const props = defineProps({
    // Key of the app this block represents, e.g. "CustomFields".
    appKey: { type: String, default: '' },
    // 'block' — full dimmed-preview panel; 'inline' — compact locked chip.
    variant: { type: String, default: 'block' },
    // Optional overrides — otherwise resolved from APP_META by appKey.
    title: { type: String, default: '' },
    description: { type: String, default: '' },
    buttonText: { type: String, default: 'Enable in settings' },
    // Heading is composed as: "{headPrefix} <highlight>{title}</highlight> {headSuffix}".
    headPrefix: { type: String, default: 'Enable' },
    headSuffix: { type: String, default: 'in this project' },
    // Breadcrumb telling the user exactly where to switch the app on.
    location: { type: String, default: 'Settings → Projects → Apps' }
});

const router = useRouter();
const companyId = inject('$companyId', null);

// Copy for each representable app. Kept here so call sites only pass `appKey`.
const APP_META = {
    CustomFields: { title: 'Custom fields', description: 'Add your own fields to capture what matters on tasks.' },
    TimeTracking: { title: 'Time tracking', description: 'Log time against tasks and see where hours go.' },
    Milestones: { title: 'Milestones', description: 'Group work toward dated goals and track progress.' },
    AI: { title: 'AI', description: 'Draft tasks, summaries, and plans with AI.' },
    tags: { title: 'Tags', description: 'Label and filter tasks across the project.' }
};

const meta = computed(() => APP_META[props.appKey] || {});
const resolvedTitle = computed(() => props.title || meta.value.title || props.appKey);
const resolvedDescription = computed(() => props.description || meta.value.description || '');

function goToSettings() {
    const cid = companyId?.value || companyId;
    router.push({ name: 'Settings-Projects', params: { cid } }).catch(() => {});
}
</script>

<style src="./style.css"></style>
