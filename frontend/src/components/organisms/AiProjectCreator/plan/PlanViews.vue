<template>
    <div v-if="views.length || notes.length" class="pv">
        <template v-if="views.length">
            <h4 class="pv__title">{{ title }}</h4>
            <ul class="pv__list" data-test="plan-views">
                <li v-for="(view, i) in views" :key="'v-' + i" class="pv__item">
                    <span class="pv__name">{{ view.name }}</span>
                    <span class="pv__kind">{{ kindLabel(view.kind) }}</span>
                </li>
            </ul>
        </template>
        <template v-if="notes.length">
            <h4 class="pv__title">{{ notesTitle }}</h4>
            <ul class="pv__list pv__list--notes" data-test="plan-views-notes">
                <li v-for="(note, i) in notes" :key="'n-' + i">
                    <strong v-if="note.name">{{ note.name }}</strong>
                    <span> — {{ reasonLabel(note.code) }}</span>
                </li>
            </ul>
        </template>
    </div>
</template>

<script setup>
import { useI18n } from 'vue-i18n';

defineProps({
    views: { type: Array, default: () => [] },
    notes: { type: Array, default: () => [] },
    title: { type: String, default: '' },
    notesTitle: { type: String, default: '' },
});

const VIEWS_MAX = 5;
const REASON_CODES = ['permission', 'name_taken', 'name_missing', 'look', 'kind', 'too_many', 'no_source'];

const { t } = useI18n();

const kindLabel = (kind) => t(`AiProject.view_kind_${kind}`);
const reasonLabel = (code) => t(`AiProject.view_reason_${REASON_CODES.includes(code) ? code : 'other'}`, { n: VIEWS_MAX });
</script>

<style scoped>
.pv { display: flex; flex-direction: column; gap: 6px; }
.pv__title { margin: 0; font-size: 12px; font-weight: 600; color: var(--ink-2); }
.pv__list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
.pv__item { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--ink); }
.pv__kind { padding: 1px 8px; border-radius: 999px; font-size: 11px; background: var(--fill); color: var(--ink-2); border: 1px solid var(--hairline); }
.pv__list--notes { font-size: 12px; color: var(--ink-2); }
</style>
