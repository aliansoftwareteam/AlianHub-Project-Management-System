<template>
    <div class="ah-page rp-page rp-page--flush">
        <div class="rp-desktop-only rp-empty">
            <strong>{{ $t('ReportsV2.desktop_only_title') }}</strong>
            <span>{{ $t('ReportsV2.desktop_only_body') }}</span>
        </div>

        <div class="rp-split rp-builder">
            <aside class="rp-side">
                <div class="rp-card__head">{{ $t('ReportsV2.new_report') }}</div>

                <div class="rp-side__group">
                    <span class="rp-side__label">{{ $t('ReportsV2.source') }}</span>
                    <select v-model="cfg.source" class="rp-select" style="max-width: none" @change="onSourceChange">
                        <option value="tasks">{{ $t('ReportsV2.src_tasks') }}</option>
                        <option value="timelogs">{{ $t('ReportsV2.src_timelogs') }}</option>
                    </select>
                </div>

                <div class="rp-side__group">
                    <span class="rp-side__label">{{ $t('ReportsV2.filters') }}</span>
                    <div v-for="f in activeFilters" :key="f.key" class="rp-filter">
                        <span>{{ f.label }}</span>
                        <button type="button" class="rp-filter__x" :aria-label="$t('ReportsV2.remove_filter')" @click="clearFilter(f.key)">×</button>
                    </div>
                    <select v-model="filterDraft" class="rp-select" style="max-width: none" @change="addFilter">
                        <option value="">{{ $t('ReportsV2.add_filter') }}</option>
                        <option v-for="opt in filterOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
                    </select>
                </div>

                <div class="rp-side__group">
                    <span class="rp-side__label">{{ $t('ReportsV2.group_by') }}</span>
                    <div class="rp-seg">
                        <button
                            v-for="d in dimensions" :key="d.key" type="button"
                            class="rp-seg__btn" :class="{ 'is-active': cfg.dimension === d.key }"
                            @click="setDimension(d.key)"
                        >{{ d.label }}</button>
                    </div>
                </div>

                <div class="rp-side__group">
                    <span class="rp-side__label">{{ $t('ReportsV2.measure') }}</span>
                    <select v-model="cfg.metric" class="rp-select" style="max-width: none" @change="runPreview">
                        <option v-for="m in metrics" :key="m.key" :value="m.key">{{ m.label }}</option>
                    </select>
                </div>

                <div class="rp-side__group">
                    <span class="rp-side__label">{{ $t('ReportsV2.chart') }}</span>
                    <div class="rp-seg">
                        <button
                            v-for="c in CHARTS" :key="c" type="button"
                            class="rp-seg__btn" :class="{ 'is-active': cfg.chartType === c }"
                            @click="cfg.chartType = c"
                        >{{ $t(`ReportsV2.chart_${c}`) }}</button>
                    </div>
                </div>

                <div class="rp-side__group">
                    <span class="rp-side__label">{{ $t('ReportsV2.saved') }}</span>
                    <select v-model="savedPick" class="rp-select" style="max-width: none" @change="loadSaved">
                        <option value="">{{ $t('ReportsV2.saved_pick') }}</option>
                        <option v-for="s in saved" :key="s._id" :value="String(s._id)">{{ s.name }}</option>
                    </select>
                    <select v-model="tplPick" class="rp-select" style="max-width: none" @change="applyTemplate">
                        <option value="">{{ $t('ReportsV2.template_pick') }}</option>
                        <option v-for="tp in templates" :key="tp.key" :value="tp.key">{{ tp.name }}</option>
                    </select>
                </div>
            </aside>

            <main class="rp-split__main">
                <div class="rp-head">
                    <input v-model="reportName" class="rp-name" :placeholder="$t('ReportsV2.name_ph')" />
                    <span class="rp-meta">{{ previewMeta }}</span>
                    <ReportsTabs />
                    <div class="rp-actions">
                        <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="!currentSavedId" @click="showSchedule = !showSchedule">
                            {{ $t('ReportsV2.schedule_email') }}
                        </button>
                        <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="busy || !reportName.trim()" @click="save">
                            {{ busy ? $t('ReportsV2.saving') : $t('ReportsV2.save') }}
                        </button>
                    </div>
                </div>

                <p v-if="message" class="rp-note">{{ message }}</p>

                <div v-if="showSchedule" class="rp-card">
                    <div class="rp-card__head">{{ $t('ReportsV2.schedule_email') }}</div>
                    <div class="rp-sched">
                        <select v-model="sched.cadence" class="rp-select">
                            <option value="daily">{{ $t('ReportsV2.daily') }}</option>
                            <option value="weekly">{{ $t('ReportsV2.weekly') }}</option>
                            <option value="monthly">{{ $t('ReportsV2.monthly') }}</option>
                        </select>
                        <input v-model="sched.recipients" class="ah-input" :class="{ 'ah-input--error': scheduleError }" :placeholder="$t('ReportsV2.recipients_ph')" />
                        <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="!sched.recipients.trim()" @click="createSchedule">
                            {{ $t('ReportsV2.schedule_it') }}
                        </button>
                    </div>
                    <span v-if="scheduleError" class="ah-field__error">{{ scheduleError }}</span>
                    <div v-for="sc in schedules" :key="sc._id" class="rp-row">
                        <span class="rp-row__name">{{ sc.reportName || reportName }}</span>
                        <span class="rp-row__data">{{ $t(`ReportsV2.${sc.cadence}`) }} · {{ (sc.recipients || []).length }}</span>
                        <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" @click="removeSchedule(sc)">{{ $t('ReportsV2.remove') }}</button>
                    </div>
                </div>

                <div class="rp-card rp-preview">
                    <div v-if="rows.length" class="rp-totals">
                        <div>
                            <span class="rp-stat__label">{{ $t('ReportsV2.total') }}</span>
                            <span class="rp-stat__value">{{ formatValue(total) }}</span>
                        </div>
                        <div>
                            <span class="rp-stat__label">{{ $t('ReportsV2.groups') }}</span>
                            <span class="rp-stat__value">{{ rows.length }}</span>
                        </div>
                        <div>
                            <span class="rp-stat__label">{{ $t('ReportsV2.largest') }}</span>
                            <span class="rp-stat__value">{{ formatValue(rows[0].value) }}</span>
                        </div>
                    </div>

                    <div v-if="!rows.length" class="rp-empty">
                        <strong>{{ $t('ReportsV2.no_data_title') }}</strong>
                        <span>{{ $t('ReportsV2.no_data_body') }}</span>
                    </div>

                    <div v-else-if="cfg.chartType === 'table'" class="rp-table">
                        <div class="rp-thead rp-thead--2">
                            <span>{{ dimensionLabel }}</span>
                            <span>{{ metricLabel }}</span>
                        </div>
                        <button v-for="row in rows" :key="row.key" type="button" class="rp-tr rp-tr--2" @click="drill(row)">
                            <span class="rp-tr__name">{{ row.label }}</span>
                            <span class="rp-num">{{ formatValue(row.value) }}</span>
                        </button>
                    </div>

                    <ApexChart
                        v-else
                        :key="cfg.chartType"
                        :type="cfg.chartType"
                        height="300"
                        :options="chartOptions"
                        :series="chartSeries"
                    />

                    <div class="rp-preview__foot">
                        <span>{{ drillHint }}</span>
                        <span class="ah-small">{{ $t('ReportsV2.preview_source', { source: sourceLabel }) }}</span>
                    </div>
                </div>
            </main>
        </div>
    </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import ReportsTabs from '@/views/Projects/Reports/ReportsTabs.vue';

defineOptions({ name: 'CustomReportBuilder' });

const { t } = useI18n();

const CHARTS = ['table', 'bar', 'line', 'pie'];
const DIMENSIONS = {
    tasks: ['status', 'project', 'sprint'],
    timelogs: ['project', 'person', 'month'],
};
const METRICS = {
    tasks: ['count', 'points'],
    timelogs: ['hours', 'entries', 'revenue'],
};
const RANGES = ['1m', '3m', '6m', '12m'];

const cfg = reactive({ source: 'tasks', dimension: 'status', metric: 'count', chartType: 'bar', filters: {} });
const reportName = ref('');
const rows = ref([]);
const unit = ref('count');
const projects = ref([]);
const saved = ref([]);
const savedPick = ref('');
const templates = ref([]);
const tplPick = ref('');
const schedules = ref([]);
const sched = reactive({ cadence: 'weekly', recipients: '' });
const showSchedule = ref(false);
const scheduleError = ref('');
const message = ref('');
const busy = ref(false);
const currentSavedId = ref('');

const projectLabel = (id) => {
    const found = projects.value.find((p) => String(p._id) === String(id));
    return found ? (found.ProjectName || '') : String(id);
};

const dimensions = computed(() => DIMENSIONS[cfg.source].map((key) => ({ key, label: t(`ReportsV2.dim_${key}`) })));
const metrics = computed(() => METRICS[cfg.source].map((key) => ({ key, label: t(`ReportsV2.metric_${key}`) })));
const dimensionLabel = computed(() => t(`ReportsV2.dim_${cfg.dimension}`));
const metricLabel = computed(() => t(`ReportsV2.metric_${cfg.metric}`));
const sourceLabel = computed(() => t(`ReportsV2.src_${cfg.source}`));

const filterOptions = computed(() => {
    const options = projects.value.map((p) => ({ value: `project:${p._id}`, label: `${t('ReportsV2.dim_project')} = ${p.ProjectName || ''}` }));
    if (cfg.source === 'timelogs') {
        RANGES.forEach((r) => options.push({ value: `range:${r}`, label: `${t('ReportsV2.f_date')} = ${t(`ReportsV2.range_${r}`)}` }));
        options.push({ value: 'billable:yes', label: `${t('ReportsV2.f_billable')} = ${t('ReportsV2.yes')}` });
        options.push({ value: 'billable:no', label: `${t('ReportsV2.f_billable')} = ${t('ReportsV2.no')}` });
    }
    return options;
});

const activeFilters = computed(() => Object.keys(cfg.filters).map((key) => {
    const value = cfg.filters[key];
    if (key === 'project') return { key, label: `${t('ReportsV2.dim_project')} = ${projectLabel(value)}` };
    if (key === 'range') return { key, label: `${t('ReportsV2.f_date')} = ${t(`ReportsV2.range_${value}`)}` };
    if (key === 'billable') return { key, label: `${t('ReportsV2.f_billable')} = ${t(value === 'yes' ? 'ReportsV2.yes' : 'ReportsV2.no')}` };
    return { key, label: `${key} = ${value}` };
}));

const filterDraft = ref('');
const addFilter = () => {
    const raw = filterDraft.value;
    filterDraft.value = '';
    if (!raw) return;
    const at = raw.indexOf(':');
    cfg.filters[raw.slice(0, at)] = raw.slice(at + 1);
    runPreview();
};
const clearFilter = (key) => { delete cfg.filters[key]; runPreview(); };

const total = computed(() => rows.value.reduce((a, r) => a + (r.value || 0), 0));
const formatValue = (value) => {
    const n = Number(value) || 0;
    if (unit.value === 'currency') return `${Math.round(n).toLocaleString()}`;
    if (unit.value === 'hours') return `${Math.round(n * 10) / 10}h`;
    return `${Math.round(n * 10) / 10}`;
};

const previewMeta = computed(() => {
    if (!rows.value.length) return '';
    return t('ReportsV2.preview_meta', { groups: rows.value.length, metric: metricLabel.value }).toUpperCase();
});

const drillHint = computed(() => (cfg.dimension === 'project'
    ? t('ReportsV2.drill_hint')
    : t('ReportsV2.drill_hint_none')));

const chartSeries = computed(() => (cfg.chartType === 'pie'
    ? rows.value.map((r) => Math.round((r.value || 0) * 100) / 100)
    : [{ name: metricLabel.value, data: rows.value.map((r) => Math.round((r.value || 0) * 100) / 100) }]));

const chartOptions = computed(() => ({
    chart: {
        id: 'custom-report',
        toolbar: { show: false },
        animations: { enabled: false },
        fontFamily: 'Inter Tight, sans-serif',
        events: { dataPointSelection: (event, ctx, opts) => drill(rows.value[opts.dataPointIndex]) },
    },
    colors: ['#2F3990', '#2f9e7e', '#d98324', '#6b5ce7', '#c1121f', '#9aa0b4'],
    labels: rows.value.map((r) => r.label),
    dataLabels: { enabled: cfg.chartType === 'pie' },
    plotOptions: { bar: { columnWidth: '52%', borderRadius: 4 } },
    stroke: { width: cfg.chartType === 'line' ? 3 : 0, curve: 'straight' },
    legend: { position: 'bottom', fontSize: '11px' },
    grid: { borderColor: 'rgba(0,0,0,.07)' },
    xaxis: { categories: rows.value.map((r) => r.label), labels: { style: { fontSize: '11px' }, hideOverlappingLabels: true } },
    yaxis: { labels: { style: { fontSize: '10px' } } },
}));

const payload = () => ({
    source: cfg.source,
    dimension: cfg.dimension,
    metric: cfg.metric,
    chartType: cfg.chartType,
    filters: { ...cfg.filters },
});

const runPreview = async () => {
    try {
        const body = (await apiRequest('post', `${env.CUSTOM_REPORT}/run`, payload()))?.data;
        rows.value = (body && body.data && body.data.result) || [];
        unit.value = (body && body.data && body.data.unit) || 'count';
    } catch (e) { rows.value = []; }
};

const setDimension = (key) => { cfg.dimension = key; runPreview(); };

const onSourceChange = () => {
    cfg.dimension = DIMENSIONS[cfg.source][0];
    cfg.metric = METRICS[cfg.source][0];
    cfg.filters = {};
    runPreview();
};

// Clicking a group narrows to it and regroups one level finer, so the number on
// screen leads to the rows behind it.
const drill = (row) => {
    if (!row || cfg.dimension !== 'project' || !row.key) return;
    cfg.filters.project = row.key;
    cfg.dimension = cfg.source === 'timelogs' ? 'person' : 'status';
    runPreview();
};

const loadProjects = async () => {
    try {
        const body = (await apiRequest('get', env.PROJECT))?.data;
        const list = Array.isArray(body) ? body : (body && body.data) || [];
        projects.value = list.filter((p) => p && p.status !== 'close' && p.deletedStatusKey !== 1 && p.deletedStatusKey !== 2);
    } catch (e) { projects.value = []; }
};

const listSaved = async () => {
    try {
        const body = (await apiRequest('get', env.CUSTOM_REPORT))?.data;
        saved.value = (body && body.data) || [];
    } catch (e) { saved.value = []; }
};

const loadSaved = async () => {
    const id = savedPick.value;
    if (!id) return;
    try {
        const body = (await apiRequest('get', `${env.CUSTOM_REPORT}/${id}/run`))?.data;
        if (!body || !body.status) return;
        const c = body.data.config || {};
        cfg.source = c.source || 'tasks';
        cfg.dimension = c.dimension || DIMENSIONS[cfg.source][0];
        cfg.metric = c.metric || METRICS[cfg.source][0];
        cfg.chartType = c.chartType || 'bar';
        cfg.filters = { ...(c.filters || {}) };
        reportName.value = body.data.report ? body.data.report.name : '';
        currentSavedId.value = String(id);
        rows.value = body.data.result || [];
        unit.value = body.data.unit || 'count';
    } catch (e) { message.value = t('ReportsV2.load_failed'); }
};

const loadTemplates = async () => {
    try {
        const body = (await apiRequest('get', env.CUSTOM_REPORT_TEMPLATES))?.data;
        templates.value = (body && body.data) || [];
    } catch (e) { templates.value = []; }
};

const applyTemplate = () => {
    const tpl = templates.value.find((x) => x.key === tplPick.value);
    tplPick.value = '';
    if (!tpl) return;
    const c = tpl.config || {};
    cfg.source = c.source || 'tasks';
    cfg.dimension = c.dimension || DIMENSIONS[cfg.source][0];
    cfg.metric = c.metric || METRICS[cfg.source][0];
    cfg.chartType = c.chartType || 'bar';
    cfg.filters = { ...(c.filters || {}) };
    reportName.value = tpl.name;
    currentSavedId.value = '';
    runPreview();
};

const save = async () => {
    if (busy.value || !reportName.value.trim()) return;
    busy.value = true;
    message.value = '';
    try {
        const body = currentSavedId.value
            ? (await apiRequest('put', `${env.CUSTOM_REPORT}/${currentSavedId.value}`, { name: reportName.value.trim(), ...payload() }))?.data
            : (await apiRequest('post', env.CUSTOM_REPORT, { name: reportName.value.trim(), ...payload() }))?.data;
        if (body && body.status && body.data && body.data._id) currentSavedId.value = String(body.data._id);
        message.value = t('ReportsV2.saved_ok');
        await listSaved();
    } catch (e) {
        message.value = t('ReportsV2.save_failed');
    } finally { busy.value = false; }
};

const loadSchedules = async () => {
    try {
        const body = (await apiRequest('get', env.REPORT_SCHEDULES))?.data;
        schedules.value = (body && body.data) || [];
    } catch (e) { schedules.value = []; }
};

const createSchedule = async () => {
    scheduleError.value = '';
    if (!currentSavedId.value) { scheduleError.value = t('ReportsV2.save_first'); return; }
    try {
        const body = (await apiRequest('post', env.REPORT_SCHEDULES, {
            savedReportId: currentSavedId.value,
            cadence: sched.cadence,
            recipients: sched.recipients,
        }))?.data;
        if (body && body.status === false) { scheduleError.value = body.statusText || t('ReportsV2.save_failed'); return; }
        sched.recipients = '';
        await loadSchedules();
    } catch (e) { scheduleError.value = t('ReportsV2.save_failed'); }
};

const removeSchedule = async (sc) => {
    try { await apiRequest('delete', `${env.REPORT_SCHEDULES}/${sc._id}`); await loadSchedules(); } catch (e) { /* reload shows the truth */ }
};

onMounted(() => {
    loadProjects();
    listSaved();
    loadTemplates();
    loadSchedules();
    runPreview();
});
</script>

<style src="@/views/Projects/Reports/reportsV2.css"></style>
<style>
.rp-page--flush { padding: 0; }
.rp-builder { flex: 1; min-height: 0; }
.rp-name { border: 0; background: transparent; font: 600 18px/1.2 var(--font-ui); letter-spacing: -.3px; color: var(--ink); padding: 0; min-width: 220px; }
.rp-name:focus { outline: none; border-bottom: 1.5px solid var(--brand); }
.rp-name::placeholder { color: var(--ink-3); }
.rp-preview { flex: 1; min-height: 0; }
.rp-totals { display: flex; gap: 24px; }
.rp-preview__foot { display: flex; align-items: center; gap: 14px; border-top: 1px solid var(--hairline); padding-top: 10px; margin-top: auto; font-size: 11.5px; color: var(--ink-2); }
.rp-preview__foot .ah-small { margin-left: auto; }
.rp-sched { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.rp-sched .ah-input { flex: 1; min-width: 220px; }
.rp-thead--2, .rp-tr--2 { grid-template-columns: minmax(0, 1fr) 120px; }
@media (max-width: 767px) {
    .rp-builder { display: none; }
}
</style>
