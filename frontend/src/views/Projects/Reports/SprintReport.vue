<template>
  <div class="agile-report">
    <div class="agile-report__bar">
      <select v-model="sprintId" class="sr__picker" :aria-label="$t('ReportsV2.sprint')">
        <option value="">{{ $t('Scrum.report_pick_sprint') }}</option>
        <option v-for="s in options" :key="s._id" :value="s._id">{{ s.name }}</option>
      </select>
      <span v-if="report" class="sr__state" :class="`is-${report.state}`">{{ $t(`Scrum.state_${report.state}`) }}</span>
      <span v-if="range" class="sr__range">{{ range }}</span>
    </div>

    <div v-if="!options.length" class="agile-report__msg">{{ $t('Scrum.report_none') }}</div>
    <div v-else-if="loading" class="agile-report__msg">{{ $t('Scrum.loading') }}</div>
    <div v-else-if="problem" class="sr__problem">{{ problem }}</div>
    <div v-else-if="!report" class="agile-report__msg">{{ $t('Scrum.report_pick_sprint') }}</div>

    <template v-else>
      <p v-if="report.goal" class="sr__goal">{{ report.goal }}</p>
      <!-- Said plainly rather than shown as a zero: a sprint nobody started has
           no commitment, and "committed 0" would read as a failed sprint. -->
      <p v-if="!report.hasCommitment" class="sr__notice">{{ $t('Scrum.report_no_commitment') }}</p>

      <div class="sr__cards">
        <div v-for="card in cards" :key="card.key" class="sr__card" :class="`is-${card.key}`">
          <span class="sr__card-n">{{ card.group.tasks }}</span>
          <span class="sr__card-l">{{ card.label }}</span>
          <span class="sr__card-m">{{ card.group.points }} {{ $t('Scrum.points') }} · {{ hours(card.group.minutes) }}</span>
        </div>
      </div>

      <div v-if="report.unfinishedList.length" class="sr__section">
        <span class="sr__section-title">{{ $t('Scrum.report_unfinished') }}</span>
        <ul class="sr__list">
          <li v-for="task in report.unfinishedList" :key="task._id">
            <span class="sr__key">{{ task.TaskKey }}</span>{{ task.TaskName }}
            <em v-if="task.movedOut" class="sr__moved">{{ $t('Scrum.report_moved_out') }}</em>
          </li>
        </ul>
      </div>

      <div v-if="report.addedList.length" class="sr__section">
        <span class="sr__section-title">{{ $t('Scrum.report_scope_added') }}</span>
        <ul class="sr__list">
          <li v-for="task in report.addedList" :key="task._id">
            <span class="sr__key">{{ task.TaskKey }}</span>{{ task.TaskName }}
          </li>
        </ul>
      </div>
    </template>
  </div>
</template>

<script>
export default { name: 'SprintReport' };
</script>

<script setup>
import { ref, computed, watch, onMounted, defineProps } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest } from '@/services';

const props = defineProps({
    projectData: { type: Object, default: () => ({}) },
    sprints: { type: Array, default: () => [] },
});

const { t } = useI18n();

const sprintId = ref('');
const loading = ref(false);
const problem = ref('');
const report = ref(null);

// Only real sprints can be reported on; a plain list has nothing to say.
const options = computed(() => (props.sprints || [])
    .filter((s) => s && s.isScrum === true && !s.isBacklog && s.mainChat !== true)
    .map((s) => ({ _id: String(s._id || s.id), name: s.name || 'Sprint', startDate: s.startDate }))
    .sort((a, b) => new Date(b.startDate || 0) - new Date(a.startDate || 0)));

const cards = computed(() => (report.value ? [
    { key: 'committed', label: t('Scrum.report_committed'), group: report.value.committed },
    { key: 'completed', label: t('Scrum.report_completed'), group: report.value.completed },
    { key: 'unfinished', label: t('Scrum.report_unfinished'), group: report.value.unfinished },
    { key: 'added', label: t('Scrum.report_scope_added'), group: report.value.addedAfterStart },
] : []));

const short = (value) => {
    if (!value) return '';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

const range = computed(() => {
    if (!report.value) return '';
    const from = short(report.value.startDate);
    const to = short(report.value.endDate);
    return from && to ? `${from} – ${to}` : '';
});

const hours = (minutes) => {
    const total = Number(minutes) || 0;
    return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, '0')}m`;
};

const load = async () => {
    if (!sprintId.value) { report.value = null; return; }
    loading.value = true;
    problem.value = '';
    try {
        const res = await apiRequest('get', `/api/v2/sprints/report?sprintId=${encodeURIComponent(sprintId.value)}`);
        if (!res?.data?.status) {
            problem.value = res?.data?.statusText || t('Toast.something_went_wrong');
            report.value = null;
            return;
        }
        report.value = res.data.data;
    } catch (error) {
        problem.value = error?.message || t('Toast.something_went_wrong');
        report.value = null;
    } finally {
        loading.value = false;
    }
};

watch(sprintId, load);
// Most-recent sprint first, so opening the tab shows something rather than a picker.
onMounted(() => { if (options.value.length) sprintId.value = options.value[0]._id; });
</script>

<style scoped>
.agile-report { width: 100%; }
.agile-report__bar { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.agile-report__msg { padding: 28px 4px; font-size: 13px; color: #6b7280; }

.sr__picker {
    height: 34px;
    min-width: 220px;
    padding: 0 8px;
    font-size: 13px;
    color: #1f2333;
    border: 1px solid #dfe1ec;
    border-radius: 8px;
    background: #fff;
}
.sr__state { padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; text-transform: uppercase; }
.sr__state.is-planned { background: #eceef7; color: #4b5162; }
.sr__state.is-active { background: #e4f0e8; color: #1c7a43; }
.sr__state.is-overdue { background: #fdece7; color: #b0431f; }
.sr__state.is-closed { background: #eceef7; color: #8b90a0; }
.sr__range { font-size: 12.5px; color: #6b7280; font-variant-numeric: tabular-nums; }

.sr__goal { margin: 0 0 10px; font-size: 13.5px; font-style: italic; color: #4b5162; }
.sr__notice { margin: 0 0 12px; font-size: 12.5px; color: #8b7028; background: #fdf8ec; border-radius: 8px; padding: 9px 12px; }
.sr__problem { padding: 20px 4px; font-size: 13px; color: #b02a2a; }

.sr__cards { display: flex; flex-wrap: wrap; gap: 10px; }
.sr__card { flex: 1 1 150px; padding: 14px; border-radius: 10px; background: #f5f6fa; }
.sr__card.is-completed { background: #eef7f0; }
.sr__card.is-unfinished { background: #fdf4e7; }
.sr__card.is-added { background: #f4f0f9; }
.sr__card-n { display: block; font-size: 24px; font-weight: 600; color: #1f2333; font-variant-numeric: tabular-nums; }
.sr__card-l { display: block; margin-top: 2px; font-size: 12px; font-weight: 500; color: #4b5162; }
.sr__card-m { display: block; margin-top: 4px; font-size: 11.5px; color: #8b90a0; font-variant-numeric: tabular-nums; }

.sr__section { margin-top: 20px; }
.sr__section-title { display: block; margin-bottom: 6px; font-size: 12px; font-weight: 600; color: #4b5162; text-transform: uppercase; letter-spacing: .03em; }
.sr__list { margin: 0; padding: 0; list-style: none; }
.sr__list li { font-size: 13px; color: #1f2333; padding: 6px 0; border-bottom: 1px solid #f1f1f5; }
.sr__key { display: inline-block; min-width: 84px; font-size: 11.5px; color: #8b90a0; font-variant-numeric: tabular-nums; }
.sr__moved { margin-left: 8px; font-size: 11px; font-style: normal; color: #b0431f; background: #fdece7; padding: 1px 7px; border-radius: 8px; }
</style>
