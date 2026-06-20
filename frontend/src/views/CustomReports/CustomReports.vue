<template>
    <div class="cr-wrap">
        <div class="cr-topbar">
            <router-link :to="{ name: 'Home', params: { cid: cid } }" class="cr-home" title="Home">
                <img src="@/assets/images/svg/Home.svg" alt="Home" />
            </router-link>
            <h1 class="cr-title">{{ $t('Header.Custom_Report') }}</h1>
        </div>

        <div class="cr-body">
            <!-- Builder -->
            <div class="cr-builder">
                <div class="cr-field">
                    <label>{{ $t('CustomReport.group_by') }}</label>
                    <select v-model="cfg.dimension" class="form-control" @change="runPreview">
                        <option value="status">{{ $t('CustomReport.d_status') }}</option>
                        <option value="project">{{ $t('CustomReport.d_project') }}</option>
                        <option value="sprint">{{ $t('CustomReport.d_sprint') }}</option>
                    </select>
                </div>
                <div class="cr-field">
                    <label>{{ $t('CustomReport.measure') }}</label>
                    <select v-model="cfg.metric" class="form-control" @change="runPreview">
                        <option value="count">{{ $t('CustomReport.m_count') }}</option>
                        <option value="points">{{ $t('CustomReport.m_points') }}</option>
                    </select>
                </div>
                <div class="cr-field">
                    <label>{{ $t('CustomReport.chart') }}</label>
                    <select v-model="cfg.chartType" class="form-control">
                        <option value="bar">{{ $t('CustomReport.c_bar') }}</option>
                        <option value="pie">{{ $t('CustomReport.c_pie') }}</option>
                        <option value="table">{{ $t('CustomReport.c_table') }}</option>
                    </select>
                </div>
                <div class="cr-field">
                    <label>{{ $t('CustomReport.project') }}</label>
                    <select v-model="cfg.filters.project" class="form-control" @change="runPreview">
                        <option value="">{{ $t('CustomReport.all_projects') }}</option>
                        <option v-for="p in projects" :key="p._id" :value="String(p._id)">{{ p.ProjectName || '(untitled)' }}</option>
                    </select>
                </div>
                <div class="cr-save">
                    <input v-model="reportName" class="form-control" :placeholder="$t('CustomReport.name_ph')" />
                    <button class="cr-btn" :disabled="busy || !reportName.trim()" @click="save">{{ busy ? $t('CustomReport.saving') : $t('CustomReport.save') }}</button>
                    <button class="cr-btn" :disabled="!result.length" @click="exportReport('csv')">{{ $t('CustomReport.export_csv') }}</button>
                    <button class="cr-btn" :disabled="!result.length" @click="exportReport('xlsx')">{{ $t('CustomReport.export_excel') }}</button>
                </div>
            </div>

            <!-- Preview -->
            <div class="cr-preview">
                <div v-if="!result.length" class="cr-empty">{{ $t('CustomReport.no_data') }}</div>

                <table v-else-if="cfg.chartType === 'table'" class="cr-table">
                    <thead><tr><th>{{ dimLabel }}</th><th>{{ metricLabel }}</th></tr></thead>
                    <tbody>
                        <tr v-for="row in result" :key="row.label"><td>{{ row.label }}</td><td>{{ row.value }}</td></tr>
                        <tr class="cr-total"><td>{{ $t('CustomReport.total') }}</td><td>{{ total }}</td></tr>
                    </tbody>
                </table>

                <div v-else class="cr-bars">
                    <div v-for="row in result" :key="row.label" class="cr-bar-row">
                        <span class="cr-bar-label" :title="row.label">{{ row.label }}</span>
                        <div class="cr-bar-track"><div class="cr-bar-fill" :style="{ width: pct(row.value) + '%' }"></div></div>
                        <span class="cr-bar-val">{{ row.value }}<template v-if="cfg.chartType === 'pie'"> ({{ share(row.value) }}%)</template></span>
                    </div>
                </div>
            </div>

            <!-- Saved reports -->
            <div class="cr-saved">
                <h3 class="m-0">{{ $t('CustomReport.saved_list') }}</h3>
                <div v-if="!saved.length" class="cr-empty">{{ $t('CustomReport.none_saved') }}</div>
                <div v-for="s in saved" :key="s._id" class="cr-saved-item">
                    <button class="cr-saved-name" @click="loadSaved(s)">{{ s.name }}</button>
                    <button class="cr-mini del" @click="removeSaved(s)">{{ $t('CustomReport.delete') }}</button>
                </div>
            </div>
        </div>
    </div>
</template>

<script>
export default { name: 'CustomReportBuilder' };
</script>

<script setup>
import { ref, reactive, computed, onMounted, inject } from 'vue';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { downloadExport } from '@/composable/exportDownload';

// REP-02 — custom report builder. Pick a dimension + metric + project filter +
// chart type, preview live, save, and reload a saved report. The backend
// resolves the config via a whitelisted query engine (no arbitrary fields).
const companyIdRef = inject('$companyId');
const cid = computed(() => (companyIdRef && companyIdRef.value) || companyIdRef || '');

const cfg = reactive({ dimension: 'status', metric: 'count', chartType: 'bar', filters: { project: '' } });
const reportName = ref('');
const projects = ref([]);
const result = ref([]);
const saved = ref([]);
const busy = ref(false);

const DIM_LABELS = { status: 'Status', project: 'Project', sprint: 'Sprint' };
const METRIC_LABELS = { count: 'Task count', points: 'Story points' };
const dimLabel = computed(() => DIM_LABELS[cfg.dimension] || cfg.dimension);
const metricLabel = computed(() => METRIC_LABELS[cfg.metric] || cfg.metric);
const total = computed(() => result.value.reduce((a, r) => a + (r.value || 0), 0));
const maxVal = computed(() => result.value.reduce((m, r) => Math.max(m, r.value || 0), 0) || 1);
const pct = (v) => Math.round(((v || 0) / maxVal.value) * 100);
const share = (v) => (total.value ? Math.round(((v || 0) / total.value) * 100) : 0);

const payload = () => ({
    source: 'tasks', dimension: cfg.dimension, metric: cfg.metric, chartType: cfg.chartType,
    filters: cfg.filters.project ? { project: cfg.filters.project } : {},
});

const runPreview = async () => {
    try {
        const body = (await apiRequest('post', `${env.CUSTOM_REPORT}/run`, payload()))?.data;
        result.value = (body && body.data && body.data.result) || [];
    } catch (e) { result.value = []; }
};
const loadProjects = async () => {
    try {
        const body = (await apiRequest('get', env.PROJECT))?.data;
        projects.value = Array.isArray(body) ? body : (body && body.data) || [];
    } catch (e) { projects.value = []; }
};
const loadSaved = async (s) => {
    try {
        const body = (await apiRequest('get', `${env.CUSTOM_REPORT}/${s._id}/run`))?.data;
        if (body && body.status) {
            const c = body.data.config || {};
            cfg.dimension = c.dimension || 'status';
            cfg.metric = c.metric || 'count';
            cfg.chartType = c.chartType || 'bar';
            cfg.filters.project = (c.filters && c.filters.project) || '';
            reportName.value = body.data.report ? body.data.report.name : '';
            result.value = body.data.result || [];
        }
    } catch (e) { /* surfaced via empty preview */ }
};
const listSaved = async () => {
    try {
        const body = (await apiRequest('get', env.CUSTOM_REPORT))?.data;
        saved.value = (body && body.data) || [];
    } catch (e) { saved.value = []; }
};
const save = async () => {
    if (busy.value || !reportName.value.trim()) return;
    busy.value = true;
    try {
        await apiRequest('post', env.CUSTOM_REPORT, { name: reportName.value.trim(), ...payload() });
        await listSaved();
    } catch (e) { /* surfaced via reload */ } finally { busy.value = false; }
};
const removeSaved = async (s) => {
    try { await apiRequest('delete', `${env.CUSTOM_REPORT}/${s._id}`); await listSaved(); } catch (e) { /* noop */ }
};
const exportReport = (format) => {
    if (!result.value.length) return;
    downloadExport(format, {
        filename: 'custom-report',
        sheetName: 'Custom Report',
        tableHead: [dimLabel.value, metricLabel.value],
        tableRows: result.value.map((r) => [r.label, r.value]),
        totalRow: ['Total', total.value],
    });
};

onMounted(() => { loadProjects(); listSaved(); runPreview(); });
</script>

<style scoped>
.cr-wrap { display: flex; flex-direction: column; height: calc(100dvh - 46px); }
.cr-topbar { display: flex; align-items: center; gap: 14px; padding: 12px 20px; border-bottom: 1px solid #e6e7ee; }
.cr-home img { width: 20px; height: 20px; }
.cr-title { font-size: 18px; margin: 0; }
.cr-body { flex: 1; overflow-y: auto; padding: 18px 22px; display: grid; grid-template-columns: 1fr 280px; grid-template-areas: "builder saved" "preview saved"; gap: 18px; align-content: start; }
@media (max-width: 860px) { .cr-body { grid-template-columns: 1fr; grid-template-areas: "builder" "preview" "saved"; } }
.cr-builder { grid-area: builder; display: flex; flex-wrap: wrap; gap: 14px; align-items: flex-end; background: #f7f8fc; border: 1px solid #e6e7ee; border-radius: 10px; padding: 14px 16px; }
.cr-field { display: flex; flex-direction: column; gap: 5px; }
.cr-field > label { font-size: 12px; font-weight: 600; color: #3a3f52; }
.cr-field .form-control { min-width: 150px; }
.cr-save { display: flex; gap: 8px; align-items: center; margin-left: auto; }
.cr-preview { grid-area: preview; background: #fff; border: 1px solid #e6e7ee; border-radius: 10px; padding: 16px; min-height: 200px; }
.cr-empty { color: #9aa0b4; font-size: 13px; padding: 18px 4px; }
.cr-bars { display: flex; flex-direction: column; gap: 9px; }
.cr-bar-row { display: flex; align-items: center; gap: 10px; }
.cr-bar-label { width: 150px; font-size: 12.5px; color: #3a3f52; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cr-bar-track { flex: 1; height: 16px; background: #eef0f6; border-radius: 4px; overflow: hidden; }
.cr-bar-fill { height: 100%; background: #2f3a8f; }
.cr-bar-val { width: 90px; text-align: right; font-size: 12.5px; color: #3a3f52; }
.cr-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.cr-table th { text-align: left; background: #f7f8fc; padding: 8px 12px; border-bottom: 1px solid #e6e7ee; color: #3a3f52; }
.cr-table td { padding: 8px 12px; border-bottom: 1px solid #f0f1f6; color: #3a3f52; }
.cr-table .cr-total td { font-weight: 700; background: #fafbff; }
.cr-saved { grid-area: saved; background: #fff; border: 1px solid #e6e7ee; border-radius: 10px; padding: 14px; height: fit-content; }
.cr-saved h3 { font-size: 14px; margin-bottom: 10px; }
.cr-saved-item { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 0; border-bottom: 1px solid #f0f1f6; }
.cr-saved-name { background: none; border: none; color: #2f3a8f; font-size: 13px; cursor: pointer; text-align: left; flex: 1; }
.cr-mini { border: none; border-radius: 5px; padding: 3px 8px; font-size: 11.5px; cursor: pointer; }
.cr-mini.del { background: #eef0f6; color: #c0392b; }
.cr-btn { background: #2f3a8f; color: #fff; border: none; border-radius: 7px; padding: 8px 15px; font-size: 13px; cursor: pointer; }
.cr-btn:disabled { opacity: .55; cursor: default; }
</style>
