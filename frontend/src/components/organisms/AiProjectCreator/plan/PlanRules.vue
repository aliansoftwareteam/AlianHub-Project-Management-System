<template>
    <div v-if="rules.length || notes.length" class="pr">
        <template v-if="rules.length">
            <h4 class="pr__title">{{ title }}</h4>
            <ul class="pr__list" data-test="plan-rules">
                <li v-for="(rule, i) in rules" :key="'r-' + i" class="pr__item">
                    <span class="pr__name">{{ rule.name }}</span>
                    <span class="pr__off">{{ $t('AiProject.rule_off') }}</span>
                </li>
            </ul>
            <p v-if="hint" class="pr__hint" data-test="plan-rules-hint">{{ hint }}</p>
        </template>
        <template v-if="notes.length">
            <h4 class="pr__title">{{ notesTitle }}</h4>
            <ul class="pr__list pr__list--notes" data-test="plan-rules-notes">
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
    rules: { type: Array, default: () => [] },
    notes: { type: Array, default: () => [] },
    title: { type: String, default: '' },
    notesTitle: { type: String, default: '' },
    hint: { type: String, default: '' },
});

const RULES_MAX = 3;
const REASON_CODES = ['too_many', 'name_missing', 'trigger', 'step', 'fit', 'admin', 'permission', 'off'];

const { t } = useI18n();

const reasonLabel = (code) => t(`AiProject.rule_reason_${REASON_CODES.includes(code) ? code : 'other'}`, { n: RULES_MAX });
</script>

<style scoped>
.pr { display: flex; flex-direction: column; gap: 6px; }
.pr__title { margin: 0; font-size: 12px; font-weight: 600; color: var(--ink-2); }
.pr__list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
.pr__item { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--ink); }
.pr__off { padding: 1px 8px; border-radius: 999px; font-size: 11px; background: var(--fill); color: var(--ink-2); border: 1px solid var(--hairline); }
.pr__hint { margin: 0; font-size: 12px; color: var(--ink-2); }
.pr__list--notes { font-size: 12px; color: var(--ink-2); }
</style>
