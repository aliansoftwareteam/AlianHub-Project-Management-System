<template>
    <!-- Nothing at all for a plain list, so a project that never touches Scrum
         sees no change in its sprint header. -->
    <span v-if="state !== 'none'" class="ssc" @click.stop>
        <span class="ssc__state" :class="`is-${state}`">{{ $t(`Scrum.state_${state}`) }}</span>
        <span v-if="range" class="ssc__range">{{ range }}</span>
        <span v-if="state === 'active' || state === 'overdue'" class="ssc__days">{{ daysLabel }}</span>
        <span v-if="sprint.goal" class="ssc__goal" :title="sprint.goal">{{ sprint.goal }}</span>
    </span>
</template>

<script>
export default { name: 'SprintStateChip' };
</script>

<script setup>
import { computed, defineProps } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps({
    sprint: { type: Object, default: () => ({}) },
});

const { t } = useI18n();

const asDate = (value) => {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
};

/* Mirrors deriveState in Modules/Sprints/scrumRules.js. Overdue is derived from
   the end date rather than stored, so a sprint that runs past its box says so
   without anything having to write to it. */
const state = computed(() => {
    const s = props.sprint || {};
    if (s.isScrum !== true) return 'none';
    const stored = String(s.state || '');
    if (stored === 'closed') return 'closed';
    if (stored !== 'active') return 'planned';
    const end = asDate(s.endDate);
    return end && end.getTime() < Date.now() ? 'overdue' : 'active';
});

const short = (value) => {
    const d = asDate(value);
    return d ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '';
};

const range = computed(() => {
    const from = short(props.sprint?.startDate);
    const to = short(props.sprint?.endDate);
    return from && to ? `${from} – ${to}` : '';
});

const daysLabel = computed(() => {
    const end = asDate(props.sprint?.endDate);
    if (!end) return '';
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    // Whole calendar days, so "1 day left" means today is not the last day.
    const left = Math.round((new Date(end.getFullYear(), end.getMonth(), end.getDate())
        - new Date(endOfToday.getFullYear(), endOfToday.getMonth(), endOfToday.getDate())) / 86400000);
    if (left < 0) return t('Scrum.days_over', { count: Math.abs(left) });
    if (left === 0) return t('Scrum.last_day');
    return t('Scrum.days_left', { count: left });
});
</script>

<style scoped>
.ssc {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin-left: 10px;
    min-width: 0;
    cursor: default;
}
.ssc__state {
    flex: 0 0 auto;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: .02em;
    text-transform: uppercase;
}
.ssc__state.is-planned { background: #eceef7; color: #4b5162; }
.ssc__state.is-active { background: #e4f0e8; color: #1c7a43; }
.ssc__state.is-overdue { background: #fdece7; color: #b0431f; }
.ssc__state.is-closed { background: #eceef7; color: #8b90a0; }

.ssc__range { flex: 0 0 auto; font-size: 12px; color: #6b7280; font-variant-numeric: tabular-nums; }
.ssc__days { flex: 0 0 auto; font-size: 11.5px; color: #8b90a0; }
.ssc__goal {
    min-width: 0;
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    font-style: italic;
    color: #8b90a0;
}
</style>
