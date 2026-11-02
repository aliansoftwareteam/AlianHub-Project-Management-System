<template>
    <div class="ah-page rpt vr">
        <ReportToolbar :title="$t('Time.variance')" :exporting="exporting" :canExport="groups.length > 0" @export="onExport">
            <template #meta><span class="rpt__range-text vr__headline">{{ headline }}</span></template>
            <template #actions>
                <span v-if="ownTimeOnly" class="ah-small">{{ $t('Time.variance_own_only') }}</span>
                <select v-else v-model="groupBy" class="ah-input rpt__select" :aria-label="$t('Time.group_by')">
                    <option value="project">{{ $t('Time.by_project') }}</option>
                    <option value="person">{{ $t('Time.by_person') }}</option>
                </select>
            </template>
        </ReportToolbar>
        <ReportFilterBar
            :filters="filters"
            :presets="PRESETS"
            :fields="ownTimeOnly ? ['projects'] : ['projects', 'people']"
            :options="{ projects: options.projects.value, people: options.people.value }"
            @apply="apply"
            @step="step"
            @clear="clear"
        />

        <div class="rpt__body vr__body">
        <p v-if="error" class="tv-error">{{ error }}</p>

        <div class="tv-card tv-card--pad vr__bars">
            <div class="vr__section">
                <span class="tv-section-label">{{ groupBy === 'project' ? $t('Time.section_project') : $t('Time.section_person') }}</span>
                <span class="vr__sort" :title="$t('Time.sort_hint')">
                    <button v-for="s in sorts" :key="s.key" type="button" class="tv-pill" :class="{ 'is-active': sortKey === s.key }" @click="setSort(s.key)">{{ $t(s.label) }}{{ sortKey === s.key ? (sortDir > 0 ? ' ↑' : ' ↓') : '' }}</button>
                </span>
            </div>
            <button v-for="g in sortedGroups" :key="g.key" type="button" class="vr__bar-row" :class="{ 'is-active': drill && drill.key === g.key }" :disabled="groupBy !== 'project'" @click="drillInto(g)">
                <span class="vr__bar-name" :title="g.name">{{ g.name || $t('Time.unknown_project') }}</span>
                <span class="vr__track">
                    <span class="vr__fill" :class="toneOf(g)" :style="{ width: `${widthPct(g.actualMinutes)}%` }"></span>
                    <span class="vr__est" :style="{ left: `${widthPct(g.estimatedMinutes)}%` }"></span>
                </span>
                <span class="vr__pct" :class="toneOf(g)">{{ signedPct(g) }}</span>
            </button>
            <div v-if="!groups.length" class="tv-empty"><span>{{ loading ? $t('Time.loading') : $t('Time.variance_empty') }}</span></div>
            <div class="ah-small">{{ $t('Time.bar_hint') }}</div>
        </div>

        <div class="vr__two">
            <div class="tv-card tv-card--pad vr__drivers">
                <span class="tv-section-label">{{ $t('Time.drift_title') }}</span>
                <div v-for="d in drivers" :key="d.key" class="vr__driver">
                    <span class="vr__driver-name">{{ $t(`Time.driver_${d.key}`) }} <small>({{ d.tasks }})</small></span>
                    <span class="vr__mini"><span class="vr__mini-fill" :class="toneOfPct(d.driftPct)" :style="{ width: `${Math.min(100, Math.abs(d.driftPct))}%` }"></span></span>
                    <span class="vr__pct vr__pct--sm">{{ d.driftPct > 0 ? '+' : '' }}{{ d.driftPct }}%</span>
                </div>
            </div>

            <div class="tv-card tv-card--pad vr__table">
                <div class="vr__section">
                    <span class="tv-section-label">{{ drill ? `${$t('Time.col_name')} · ${drill.name}` : $t('Time.largest_title') }}</span>
                    <button v-if="drill" type="button" class="tv-link" @click="drill = null">{{ $t('Time.back_to_summary') }}</button>
                </div>
                <div class="vr__thead">
                    <button type="button" class="vr__th" @click="setTaskSort('name')">{{ $t('Time.col_name') }}</button>
                    <button type="button" class="vr__th" @click="setTaskSort('estimatedMinutes')">{{ $t('Time.col_estimate') }}</button>
                    <button type="button" class="vr__th" @click="setTaskSort('actualMinutes')">{{ $t('Time.col_actual') }}</button>
                    <button type="button" class="vr__th" @click="setTaskSort('variance')">{{ $t('Time.col_delta') }}</button>
                </div>
                <div v-for="r in sortedTasks" :key="r.taskId" class="vr__tr">
                    <span class="vr__td vr__td--name" :title="r.name">{{ r.name }}<small v-if="!drill && r.projectName">{{ r.projectName }}</small></span>
                    <span class="vr__td">{{ formatHm(r.estimatedMinutes) }}</span>
                    <span class="vr__td">{{ formatHm(r.actualMinutes) }}</span>
                    <span class="vr__td" :class="toneOfPct(r.variancePct)">{{ signedDelta(r) }}</span>
                </div>
                <div v-if="!sortedTasks.length" class="ah-small">{{ $t('Time.variance_empty') }}</div>
            </div>
        </div>

        <div class="tv-card vr__takeaway">
            <span v-if="takeaway">{{ $t('Time.takeaway', { project: takeaway.projectName || $t('Time.unknown_project'), pct: `+${takeaway.variancePct}%`, task: takeaway.name, actual: formatHm(takeaway.actualMinutes), estimate: formatHm(takeaway.estimatedMinutes) }) }}</span>
            <span v-else>{{ $t('Time.takeaway_none') }}</span>
        </div>
        </div>
    </div>
</template>

<script setup>
import { ref, computed, inject, onMounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import ReportToolbar from '@/views/Timesheet/report/ReportToolbar.vue';
import ReportFilterBar from '@/views/Timesheet/report/ReportFilterBar.vue';
import { useReportFilters } from '@/views/Timesheet/report/useReportFilters';
import { useReportOptions } from '@/views/Timesheet/report/useReportOptions';
import { useReportExport } from '@/views/Timesheet/report/useReportExport';
import { PRESETS } from '@/views/Timesheet/report/reportRange';
import { hoursOf } from '@/views/Timesheet/report/reportTable';
import { formatHm } from '@/composable/useTimer';

defineOptions({ name: 'VarianceReport' });

const { t } = useI18n();
const companyId = inject('$companyId');
const { filters, range, apply, step, clear } = useReportFilters({ defaultPreset: 'this_month' });
const options = useReportOptions(companyId);
const { exporting, exportReport } = useReportExport((field, value) => options.labelOf(field, value));
const groupBy = ref('project');
const data = ref(null);
const drill = ref(null);
const drillTasks = ref([]);
const loading = ref(false);
const error = ref('');
const sortKey = ref('delta');
const sortDir = ref(-1);
const taskSortKey = ref('variance');
const taskSortDir = ref(-1);

const sorts = [
    { key: 'delta', label: 'Time.col_delta' },
    { key: 'actual', label: 'Time.col_actual' },
    { key: 'name', label: 'Time.col_name' },
];
const fromIso = computed(() => range.value.start);
const toIso = computed(() => range.value.end);
const pctOf = (estimated, actual) => (estimated > 0 ? Math.round(((actual - estimated) / estimated) * 100) : 0);
/* Projects and people narrow the groups on screen; the totals then add up what is left. */
const narrowed = computed(() => filters.value.projects.length || filters.value.people.length);
const keepGroup = (kind, g) => {
    const picked = kind === 'project' ? filters.value.projects : filters.value.people;
    return !picked.length || picked.includes(String(g.key));
};
const totals = computed(() => {
    const raw = (data.value && data.value.totals) || { totalEstimated: 0, totalActual: 0, totalVariance: 0, totalVariancePct: 0 };
    if (!narrowed.value) return raw;
    const totalEstimated = groups.value.reduce((a, g) => a + g.estimatedMinutes, 0);
    const totalActual = groups.value.reduce((a, g) => a + g.actualMinutes, 0);
    return { totalEstimated, totalActual, totalVariance: totalActual - totalEstimated, totalVariancePct: pctOf(totalEstimated, totalActual) };
});
const headline = computed(() => t('Time.head_range_short', {
    est: Math.round(totals.value.totalEstimated / 60),
    act: Math.round(totals.value.totalActual / 60),
    pct: `${totals.value.totalVariancePct > 0 ? '+' : ''}${totals.value.totalVariancePct}%`,
}));
const ownTimeOnly = computed(() => Boolean(data.value && data.value.scope === 'self'));
const groups = computed(() => (data.value ? ((groupBy.value === 'project' ? data.value.byProject : data.value.byPerson) || []).filter((g) => keepGroup(groupBy.value, g)) : []));
const sortedGroups = computed(() => {
    const list = [...groups.value];
    const dir = sortDir.value;
    if (sortKey.value === 'name') list.sort((a, b) => dir * String(a.name).localeCompare(String(b.name)));
    else if (sortKey.value === 'actual') list.sort((a, b) => dir * (a.actualMinutes - b.actualMinutes));
    else list.sort((a, b) => dir * (Math.abs(a.variance) - Math.abs(b.variance)));
    return list;
});
const scaleMax = computed(() => Math.max(1, ...groups.value.map((g) => Math.max(g.actualMinutes, g.estimatedMinutes))));
const widthPct = (m) => Math.min(100, ((Number(m) || 0) / scaleMax.value) * 100);
const toneOfPct = (p) => (p > 25 ? 'is-danger' : (p > 5 ? 'is-warn' : (p < -5 ? 'is-ok' : 'is-flat')));
const toneOf = (g) => toneOfPct(g.variancePct);
const signedPct = (g) => `${g.variancePct > 0 ? '+' : (g.variancePct < 0 ? '−' : '')}${Math.abs(g.variancePct)}%`;
const signedDelta = (r) => `${r.variance > 0 ? '+' : (r.variance < 0 ? '−' : '')}${formatHm(Math.abs(r.variance))}`;
const drivers = computed(() => (data.value && data.value.drivers) || []);
const takeaway = computed(() => (data.value && data.value.takeaway) || null);
const projectNameOf = (id) => { const g = (data.value && data.value.byProject || []).find((p) => p.key === id); return g ? g.name : ''; };
const taskRows = computed(() => (drill.value ? drillTasks.value : ((data.value && data.value.largest) || [])
    .filter((r) => !filters.value.projects.length || filters.value.projects.includes(String(r.projectId)))
    .map((r) => ({ ...r, projectName: projectNameOf(r.projectId) }))));
const sortedTasks = computed(() => {
    const list = [...taskRows.value];
    const k = taskSortKey.value;
    const dir = taskSortDir.value;
    list.sort((a, b) => (k === 'name' ? dir * String(a.name).localeCompare(String(b.name)) : dir * ((k === 'variance' ? Math.abs(a[k]) : a[k]) - (k === 'variance' ? Math.abs(b[k]) : b[k]))));
    return list;
});

const setSort = (key) => { if (sortKey.value === key) sortDir.value = -sortDir.value; else { sortKey.value = key; sortDir.value = key === 'name' ? 1 : -1; } };
const setTaskSort = (key) => { if (taskSortKey.value === key) taskSortDir.value = -taskSortDir.value; else { taskSortKey.value = key; taskSortDir.value = key === 'name' ? 1 : -1; } };

const load = async () => {
    loading.value = true;
    error.value = '';
    try {
        const body = ((await apiRequest('get', `${env.VARIANCE_SUMMARY}?from=${fromIso.value}&to=${toIso.value}`)) || {}).data || {};
        if (!body.status) throw new Error(body.statusText || 'load_failed');
        data.value = body.data;
    } catch (e) {
        error.value = t('Time.load_failed');
        data.value = null;
    } finally {
        loading.value = false;
    }
};
const drillInto = async (g) => {
    if (groupBy.value !== 'project' || !g.key) return;
    if (drill.value && drill.value.key === g.key) { drill.value = null; return; }
    drill.value = g;
    try {
        const body = ((await apiRequest('get', `${env.VARIANCE_REPORT}?projectId=${g.key}`)) || {}).data || {};
        drillTasks.value = body.status ? [...(body.data.tasks || [])].sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance)) : [];
    } catch (e) {
        drillTasks.value = [];
    }
};
const onExport = async (format) => {
    await exportReport(format, {
        name: 'variance',
        title: `${t('Time.variance')} · ${groupBy.value === 'project' ? t('Time.by_project') : t('Time.by_person')}`,
        filters: filters.value,
        columns: [
            { key: 'name', label: groupBy.value === 'project' ? t('Reports.col_project') : t('Reports.col_person'), value: (g) => g.name || '' },
            { key: 'est', label: t('Reports.col_estimated_hours'), value: (g) => hoursOf(g.estimatedMinutes) },
            { key: 'act', label: t('Reports.col_logged_hours'), value: (g) => hoursOf(g.actualMinutes) },
            { key: 'var', label: t('Reports.col_variance_hours'), value: (g) => hoursOf(g.variance) },
            { key: 'pct', label: t('Reports.col_variance_pct'), value: (g) => g.variancePct },
            { key: 'tasks', label: t('Reports.col_tasks'), value: (g) => (g.isTotal ? '' : g.tasks) },
        ],
        rows: sortedGroups.value,
        total: { isTotal: true, name: t('Time.col_total'), estimatedMinutes: totals.value.totalEstimated, actualMinutes: totals.value.totalActual, variance: totals.value.totalVariance, variancePct: totals.value.totalVariancePct },
    });
};

watch(() => [fromIso.value, toIso.value], () => { drill.value = null; load(); });
watch(groupBy, () => { drill.value = null; });
watch(ownTimeOnly, (own) => { if (own) groupBy.value = 'project'; });
onMounted(() => { load(); options.ready(); });
</script>

<style src="../Timesheet/timeV2.css"></style>
<style scoped>
.vr__body { max-width: calc(980px + 2 * var(--page-pad-x, 22px)); width: 100%; box-sizing: border-box; }
.vr__bars { display: flex; flex-direction: column; gap: 11px; }
.vr__section { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.vr__sort { display: flex; gap: 4px; }
.tv-pill { border: 0; cursor: pointer; }
.tv-pill.is-active { background: var(--brand-tint); color: var(--brand); }
.vr__bar-row { display: flex; align-items: center; gap: 10px; width: 100%; border: 0; background: transparent; padding: 0; color: var(--ink); font: inherit; text-align: left; cursor: pointer; border-radius: 6px; }
.vr__bar-row:disabled { cursor: default; }
.vr__bar-row.is-active .vr__bar-name { color: var(--brand); font-weight: 600; }
.vr__bar-name { width: 120px; flex: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vr__track { flex: 1; height: 20px; background: var(--track); border-radius: 5px; position: relative; }
.vr__fill { display: block; height: 100%; background: var(--brand); border-radius: 5px; transition: width var(--t-state) var(--ease); }
.vr__fill.is-danger { background: var(--danger); }
.vr__est { position: absolute; top: -3px; bottom: -3px; border-left: 2px solid var(--ink); }
.vr__pct { width: 80px; flex: none; text-align: right; font: 500 11px/1.2 var(--font-mono); color: var(--ink-2); }
.vr__pct--sm { width: 52px; }
.is-danger.vr__pct, .vr__td.is-danger { color: var(--danger); }
.is-warn.vr__pct, .vr__td.is-warn { color: var(--warn); }
.is-ok.vr__pct, .vr__td.is-ok { color: var(--ok); }
.vr__two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.vr__drivers, .vr__table { display: flex; flex-direction: column; gap: 9px; }
.vr__driver { display: flex; align-items: center; gap: 10px; }
.vr__driver-name { flex: 1; min-width: 0; }
.vr__driver-name small { color: var(--ink-2); font-family: var(--font-mono); }
.vr__mini { width: 110px; height: 6px; background: var(--track); border-radius: 99px; overflow: hidden; }
.vr__mini-fill { display: block; height: 100%; border-radius: 99px; background: var(--ok); }
.vr__mini-fill.is-danger { background: var(--danger); }
.vr__mini-fill.is-warn { background: var(--warn); }
.vr__mini-fill.is-flat { background: var(--ink-3); }
.vr__thead, .vr__tr { display: grid; grid-template-columns: 1fr 64px 64px 72px; gap: 8px; align-items: center; }
.vr__th { border: 0; background: transparent; padding: 0; text-align: right; font: var(--text-label); letter-spacing: .06em; color: var(--ink-2); cursor: pointer; }
.vr__th:first-child { text-align: left; }
.vr__td { font: 500 11.5px/1.2 var(--font-mono); text-align: right; }
.vr__td--name { font: 400 12.5px/1.3 var(--font-ui); text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: flex; flex-direction: column; }
.vr__td--name small { color: var(--ink-2); font-size: 11px; }
.vr__takeaway { margin-top: auto; padding: 11px 13px; border-color: var(--brand-border); line-height: 1.5; }
@media (max-width: 767px) { .vr__two { grid-template-columns: 1fr; } }
</style>
