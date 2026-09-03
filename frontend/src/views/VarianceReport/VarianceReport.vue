<template>
    <div class="ah-page tv-page vr">
        <div class="tv-head">
            <h1 class="tv-title vr__title">{{ $t('TimeV2.variance') }}</h1>
            <span class="tv-range">
                <button type="button" :aria-label="$t('TimeV2.prev_month')" @click="shift(-1)">‹</button>
                <span>{{ headline }}</span>
                <button type="button" :aria-label="$t('TimeV2.next_month')" @click="shift(1)">›</button>
            </span>
            <div class="tv-actions">
                <select v-model="groupBy" class="tv-select">
                    <option value="project">{{ $t('TimeV2.by_project') }}</option>
                    <option value="person">{{ $t('TimeV2.by_person') }}</option>
                </select>
                <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="!groups.length" @click="exportReport">{{ $t('TimeV2.export') }}</button>
            </div>
        </div>

        <p v-if="error" class="tv-error">{{ error }}</p>

        <div class="tv-card tv-card--pad vr__bars">
            <div class="vr__section">
                <span class="tv-section-label">{{ groupBy === 'project' ? $t('TimeV2.section_project') : $t('TimeV2.section_person') }}</span>
                <span class="vr__sort" :title="$t('TimeV2.sort_hint')">
                    <button v-for="s in sorts" :key="s.key" type="button" class="tv-pill" :class="{ 'is-active': sortKey === s.key }" @click="setSort(s.key)">{{ $t(s.label) }}{{ sortKey === s.key ? (sortDir > 0 ? ' ↑' : ' ↓') : '' }}</button>
                </span>
            </div>
            <button v-for="g in sortedGroups" :key="g.key" type="button" class="vr__bar-row" :class="{ 'is-active': drill && drill.key === g.key }" :disabled="groupBy !== 'project'" @click="drillInto(g)">
                <span class="vr__bar-name" :title="g.name">{{ g.name || $t('TimeV2.unknown_project') }}</span>
                <span class="vr__track">
                    <span class="vr__fill" :class="toneOf(g)" :style="{ width: `${widthPct(g.actualMinutes)}%` }"></span>
                    <span class="vr__est" :style="{ left: `${widthPct(g.estimatedMinutes)}%` }"></span>
                </span>
                <span class="vr__pct" :class="toneOf(g)">{{ signedPct(g) }}</span>
            </button>
            <div v-if="!groups.length" class="tv-empty"><span>{{ loading ? $t('TimeV2.loading') : $t('TimeV2.variance_empty') }}</span></div>
            <div class="ah-small">{{ $t('TimeV2.bar_hint') }}</div>
        </div>

        <div class="vr__two">
            <div class="tv-card tv-card--pad vr__drivers">
                <span class="tv-section-label">{{ $t('TimeV2.drift_title') }}</span>
                <div v-for="d in drivers" :key="d.key" class="vr__driver">
                    <span class="vr__driver-name">{{ $t(`TimeV2.driver_${d.key}`) }} <small>({{ d.tasks }})</small></span>
                    <span class="vr__mini"><span class="vr__mini-fill" :class="toneOfPct(d.driftPct)" :style="{ width: `${Math.min(100, Math.abs(d.driftPct))}%` }"></span></span>
                    <span class="vr__pct vr__pct--sm">{{ d.driftPct > 0 ? '+' : '' }}{{ d.driftPct }}%</span>
                </div>
            </div>

            <div class="tv-card tv-card--pad vr__table">
                <div class="vr__section">
                    <span class="tv-section-label">{{ drill ? `${$t('TimeV2.col_name')} · ${drill.name}` : $t('TimeV2.largest_title') }}</span>
                    <button v-if="drill" type="button" class="tv-link" @click="drill = null">{{ $t('TimeV2.back_to_summary') }}</button>
                </div>
                <div class="vr__thead">
                    <button type="button" class="vr__th" @click="setTaskSort('name')">{{ $t('TimeV2.col_name') }}</button>
                    <button type="button" class="vr__th" @click="setTaskSort('estimatedMinutes')">{{ $t('TimeV2.col_estimate') }}</button>
                    <button type="button" class="vr__th" @click="setTaskSort('actualMinutes')">{{ $t('TimeV2.col_actual') }}</button>
                    <button type="button" class="vr__th" @click="setTaskSort('variance')">{{ $t('TimeV2.col_delta') }}</button>
                </div>
                <div v-for="r in sortedTasks" :key="r.taskId" class="vr__tr">
                    <span class="vr__td vr__td--name" :title="r.name">{{ r.name }}<small v-if="!drill && r.projectName">{{ r.projectName }}</small></span>
                    <span class="vr__td">{{ formatHm(r.estimatedMinutes) }}</span>
                    <span class="vr__td">{{ formatHm(r.actualMinutes) }}</span>
                    <span class="vr__td" :class="toneOfPct(r.variancePct)">{{ signedDelta(r) }}</span>
                </div>
                <div v-if="!sortedTasks.length" class="ah-small">{{ $t('TimeV2.variance_empty') }}</div>
            </div>
        </div>

        <div class="tv-card vr__takeaway">
            <span v-if="takeaway">{{ $t('TimeV2.takeaway', { project: takeaway.projectName || $t('TimeV2.unknown_project'), pct: `+${takeaway.variancePct}%`, task: takeaway.name, actual: formatHm(takeaway.actualMinutes), estimate: formatHm(takeaway.estimatedMinutes) }) }}</span>
            <span v-else>{{ $t('TimeV2.takeaway_none') }}</span>
        </div>
    </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import moment from 'moment';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { downloadExport } from '@/composable/exportDownload';
import { formatHm } from '@/composable/useTimer';

defineOptions({ name: 'VarianceReport' });

const { t } = useI18n();
const month = ref(moment().startOf('month'));
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
    { key: 'delta', label: 'TimeV2.col_delta' },
    { key: 'actual', label: 'TimeV2.col_actual' },
    { key: 'name', label: 'TimeV2.col_name' },
];
const fromIso = computed(() => month.value.format('YYYY-MM-DD'));
const toIso = computed(() => month.value.clone().endOf('month').format('YYYY-MM-DD'));
const totals = computed(() => (data.value && data.value.totals) || { totalEstimated: 0, totalActual: 0, totalVariancePct: 0 });
const headline = computed(() => t('TimeV2.head_range', {
    range: month.value.format('MMM').toUpperCase(),
    est: Math.round(totals.value.totalEstimated / 60),
    act: Math.round(totals.value.totalActual / 60),
    pct: `${totals.value.totalVariancePct > 0 ? '+' : ''}${totals.value.totalVariancePct}%`,
}));
const groups = computed(() => (data.value ? (groupBy.value === 'project' ? data.value.byProject : data.value.byPerson) || [] : []));
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
const taskRows = computed(() => (drill.value ? drillTasks.value : ((data.value && data.value.largest) || []).map((r) => ({ ...r, projectName: projectNameOf(r.projectId) }))));
const sortedTasks = computed(() => {
    const list = [...taskRows.value];
    const k = taskSortKey.value;
    const dir = taskSortDir.value;
    list.sort((a, b) => (k === 'name' ? dir * String(a.name).localeCompare(String(b.name)) : dir * ((k === 'variance' ? Math.abs(a[k]) : a[k]) - (k === 'variance' ? Math.abs(b[k]) : b[k]))));
    return list;
});

const setSort = (key) => { if (sortKey.value === key) sortDir.value = -sortDir.value; else { sortKey.value = key; sortDir.value = key === 'name' ? 1 : -1; } };
const setTaskSort = (key) => { if (taskSortKey.value === key) taskSortDir.value = -taskSortDir.value; else { taskSortKey.value = key; taskSortDir.value = key === 'name' ? 1 : -1; } };
const shift = (n) => { month.value = month.value.clone().add(n, 'months'); drill.value = null; };

const load = async () => {
    loading.value = true;
    error.value = '';
    try {
        const body = ((await apiRequest('get', `${env.VARIANCE_SUMMARY}?from=${fromIso.value}&to=${toIso.value}`)) || {}).data || {};
        if (!body.status) throw new Error(body.statusText || 'load_failed');
        data.value = body.data;
    } catch (e) {
        error.value = t('TimeV2.load_failed');
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
const exportReport = () => {
    downloadExport('csv', {
        filename: `variance-${month.value.format('YYYY-MM')}`,
        sheetName: 'Variance',
        tableHead: [groupBy.value === 'project' ? 'Project' : 'Person', 'Estimated (min)', 'Actual (min)', 'Variance (min)', 'Variance %', 'Tasks'],
        tableRows: sortedGroups.value.map((g) => [g.name, g.estimatedMinutes, g.actualMinutes, g.variance, g.variancePct, g.tasks]),
        totalRow: ['Total', totals.value.totalEstimated, totals.value.totalActual, totals.value.totalVariance, totals.value.totalVariancePct, ''],
    });
};

watch(month, load);
watch(groupBy, () => { drill.value = null; });
onMounted(load);
</script>

<style src="../Timesheet/timeV2.css"></style>
<style scoped>
.vr { max-width: 980px; }
.vr__title { font-size: 15px; }
.vr__bars { display: flex; flex-direction: column; gap: 11px; }
.vr__section { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.vr__sort { display: flex; gap: 4px; }
.tv-pill { border: 0; cursor: pointer; }
.tv-pill.is-active { background: var(--brand-tint); color: var(--brand); }
.vr__bar-row { display: flex; align-items: center; gap: 10px; width: 100%; border: 0; background: transparent; padding: 0; color: var(--ink); font: inherit; text-align: left; cursor: pointer; border-radius: 6px; }
.vr__bar-row:disabled { cursor: default; }
.vr__bar-row.is-active .vr__bar-name { color: var(--brand); font-weight: 600; }
.vr__bar-name { width: 120px; flex: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vr__track { flex: 1; height: 20px; background: rgba(0, 0, 0, .06); border-radius: 5px; position: relative; }
:root[data-theme="dark"] .vr__track { background: rgba(255, 255, 255, .08); }
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
.vr__driver-name small { color: var(--ink-3); font-family: var(--font-mono); }
.vr__mini { width: 110px; height: 6px; background: rgba(0, 0, 0, .07); border-radius: 99px; overflow: hidden; }
:root[data-theme="dark"] .vr__mini { background: rgba(255, 255, 255, .1); }
.vr__mini-fill { display: block; height: 100%; border-radius: 99px; background: var(--ok); }
.vr__mini-fill.is-danger { background: var(--danger); }
.vr__mini-fill.is-warn { background: var(--warn); }
.vr__mini-fill.is-flat { background: var(--ink-3); }
.vr__thead, .vr__tr { display: grid; grid-template-columns: 1fr 64px 64px 72px; gap: 8px; align-items: center; }
.vr__th { border: 0; background: transparent; padding: 0; text-align: right; font: var(--text-label); letter-spacing: .06em; color: var(--ink-3); cursor: pointer; }
.vr__th:first-child { text-align: left; }
.vr__td { font: 500 11.5px/1.2 var(--font-mono); text-align: right; }
.vr__td--name { font: 400 12.5px/1.3 var(--font-ui); text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: flex; flex-direction: column; }
.vr__td--name small { color: var(--ink-2); font-size: 11px; }
.vr__takeaway { margin-top: auto; padding: 11px 13px; border-color: rgba(47, 57, 144, .25); line-height: 1.5; }
@media (max-width: 767px) { .vr__two { grid-template-columns: 1fr; } }
</style>
