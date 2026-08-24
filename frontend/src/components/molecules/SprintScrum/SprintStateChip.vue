<template>
    <!-- Nothing at all for a plain list, so a project that never touches Scrum
         sees no change in its sprint header. -->
    <span v-if="state !== 'none'" class="ssc" @click.stop>
        <span class="ssc__state" :class="`is-${state}`">{{ $t(`Scrum.state_${state}`) }}</span>
        <span v-if="range" class="ssc__range">{{ range }}</span>
        <span v-if="state === 'active' || state === 'overdue'" class="ssc__days">{{ daysLabel }}</span>
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
/* This sits in .sprint-head-actions, alongside New Task, Suggest tasks and the
   hours chip — a row that wraps rather than overflows. So the chip itself never
   shrinks: a squeezed flex child does not ellipsise here, it gets cut through
   the middle of a word ("26 Aug – 1 S", "8 d"). It keeps its width and the row
   drops it to the next line when there is genuinely no room.

   What DOES give way is content, at the breakpoints below, cheapest first. */
.ssc {
    display: inline-flex;
    align-items: center;
    flex: 0 0 auto;
    flex-wrap: nowrap;
    gap: 8px;
    margin-left: 10px;
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
    white-space: nowrap;
}
.ssc__state.is-planned { background: #eceef7; color: #4b5162; }
.ssc__state.is-active { background: #e4f0e8; color: #1c7a43; }
.ssc__state.is-overdue { background: #fdece7; color: #b0431f; }
.ssc__state.is-closed { background: #eceef7; color: #8b90a0; }

.ssc__range { flex: 0 0 auto; white-space: nowrap; font-size: 12px; color: #6b7280; font-variant-numeric: tabular-nums; }
.ssc__days { flex: 0 0 auto; white-space: nowrap; font-size: 11.5px; color: #8b90a0; }

/* Breakpoints measured against the real header rather than picked. New Task,
   Suggest tasks and the hours chip already fill this row: with a short sprint
   name it leaves about 219px for the chip at 1920 and about 158px at 1440, and
   with a long name — the common case, the name is ellipsised in the wild — only
   about 23px at 1440.

   So the parts earn their place:
     state   55px, always. It is the whole point of the chip, and where even
             that does not fit the row was already wrapping without it.
     range   85px, above 1440 only. Measured: keeping it at 1440 pushed the
             hours chip onto a second line.
     days    53px, above 1440 only, same reason.

   The sprint goal is deliberately absent. It is free text, so it could not be
   budgeted for at all — at 145px it moved the hours chip to a second line on a
   1600px screen. It is shown in sprint settings, the complete dialog, the
   burndown header and the sprint report instead.

   Below 1440 with a long name the row still wraps, and that is fine: it wraps
   rather than clips or covers the Share With controls, which is what
   .sprint-head-actions was given flex-wrap and a row-gap for. */
@media (max-width: 1440px) {
    .ssc__range,
    .ssc__days { display: none; }
}
@media (max-width: 767px) {
    .ssc { gap: 6px; margin-left: 8px; }
}
</style>
