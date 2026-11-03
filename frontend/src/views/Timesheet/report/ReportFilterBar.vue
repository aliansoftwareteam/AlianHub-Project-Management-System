<template>
    <div class="rpt__controls" role="search" :aria-label="$t('Reports.filters')">
        <ReportDateChip :filters="filters" :presets="presets" @apply="(patch) => $emit('apply', patch)" @step="(direction) => $emit('step', direction)" />
        <template v-for="field in multiFields" :key="field">
            <EverythingFilterChip
                :name="field"
                highlight-picked
                :bulk="field !== 'people' || !singlePerson"
                :label="$t(`Reports.filter_${field}`)"
                :options="options[field] || []"
                :modelValue="filters[field] || []"
                @update:modelValue="(value) => $emit('apply', { [field]: value })"
                @click.capture="field === 'lists' && $emit('need-lists')"
            />
            <div
                v-if="field === 'people' && (filters.people || []).length > 1"
                class="ah-tabs rpt__match"
                role="group"
                :aria-label="$t('Reports.match_label')"
                :title="$t('Reports.match_hint')"
            >
                <button
                    v-for="mode in MATCH"
                    :key="mode"
                    type="button"
                    class="ah-tab"
                    :class="{ 'is-active': (filters.match || 'any') === mode }"
                    :aria-pressed="(filters.match || 'any') === mode ? 'true' : 'false'"
                    :data-test="`report-match-${mode}`"
                    @click="$emit('apply', { match: mode })"
                >{{ $t(`Reports.match_${mode}`) }}</button>
            </div>
        </template>
        <EverythingFilterChip
            v-if="fields.includes('billable')"
            name="billable"
            single
            :label="$t('Reports.filter_billable')"
            :options="billableOptions"
            :modelValue="filters.billable ? [filters.billable] : []"
            @update:modelValue="(value) => $emit('apply', { billable: value[0] || '' })"
        />
        <slot />
        <button v-if="narrowing" type="button" class="ah-btn ah-btn--ghost ah-btn--sm rpt__clear" data-test="report-clear" @click="$emit('clear')">
            {{ $t('Reports.clear_filters_n', { n: narrowing }) }}
        </button>
        <div v-if="$slots.end" class="rpt__controls-end"><slot name="end" /></div>
    </div>
</template>

<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import EverythingFilterChip from '@/views/Everything/EverythingFilterChip.vue';
import ReportDateChip from './ReportDateChip.vue';
import { activeCount, MATCH } from './reportQuery';
import '@/views/Everything/style.css';
import './report.css';

defineOptions({ name: 'ReportFilterBar' });

const props = defineProps({
    filters: { type: Object, required: true },
    presets: { type: Array, required: true },
    fields: { type: Array, default: () => [] },
    options: { type: Object, default: () => ({}) },
    singlePerson: { type: Boolean, default: false },
});
defineEmits(['apply', 'step', 'clear', 'need-lists']);
const { t } = useI18n();

const multiFields = computed(() => ['people', 'projects', 'lists', 'status', 'tags', 'types'].filter((field) => props.fields.includes(field)));
const billableOptions = computed(() => [
    { value: 'billable', label: t('Time.billable') },
    { value: 'non_billable', label: t('Time.non_billable') },
]);
const narrowing = computed(() => activeCount(props.filters));
</script>
