<template>
    <div class="vr-wrap">
        <div class="vr-topbar">
            <router-link :to="{ name: 'Home', params: { cid: cid } }" class="vr-home" title="Home">
                <img src="@/assets/images/svg/Home.svg" alt="Home" />
            </router-link>
            <h1 class="vr-title">{{ $t('Header.Variance_Report') }}</h1>
            <select v-model="projectId" class="form-control vr-proj" @change="load">
                <option value="">{{ $t('VarianceReport.select_project') }}</option>
                <option v-for="p in projects" :key="p._id" :value="String(p._id)">{{ p.ProjectName || '(untitled)' }}</option>
            </select>
            <button class="vr-btn" :disabled="!data" @click="exportReport('csv')">{{ $t('VarianceReport.export_csv') }}</button>
            <button class="vr-btn" :disabled="!data" @click="exportReport('xlsx')">{{ $t('VarianceReport.export_excel') }}</button>
        </div>

        <div class="vr-body">
            <div v-if="!projectId" class="vr-placeholder">{{ $t('VarianceReport.pick') }}</div>
            <template v-else>
                <div v-if="data" class="vr-totals">
                    <div class="vr-stat"><b>{{ fmt(data.totals.totalEstimated) }}</b><span>{{ $t('VarianceReport.estimated') }}</span></div>
                    <div class="vr-stat"><b>{{ fmt(data.totals.totalActual) }}</b><span>{{ $t('VarianceReport.actual') }}</span></div>
                    <div class="vr-stat" :class="varClass(data.totals.totalVariance)">
                        <b>{{ signed(data.totals.totalVariance) }}</b>
                        <span>{{ $t('VarianceReport.variance') }} ({{ data.totals.totalVariancePct }}%)</span>
                    </div>
                    <div class="vr-stat over"><b>{{ data.totals.over }}</b><span>{{ $t('VarianceReport.over') }}</span></div>
                    <div class="vr-stat under"><b>{{ data.totals.under }}</b><span>{{ $t('VarianceReport.under') }}</span></div>
                </div>
                <div class="vr-table-wrap">
                    <table class="vr-table">
                        <thead>
                            <tr>
                                <th>{{ $t('VarianceReport.task') }}</th>
                                <th>{{ $t('VarianceReport.estimated') }}</th>
                                <th>{{ $t('VarianceReport.actual') }}</th>
                                <th>{{ $t('VarianceReport.variance') }}</th>
                                <th>%</th>
                                <th>{{ $t('VarianceReport.status') }}</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="r in (data ? data.tasks : [])" :key="r.taskId">
                                <td class="vr-name" :title="r.name">{{ r.name }}</td>
                                <td>{{ fmt(r.estimatedMinutes) }}</td>
                                <td>{{ fmt(r.actualMinutes) }}</td>
                                <td :class="varClass(r.variance)">{{ signed(r.variance) }}</td>
                                <td :class="varClass(r.variance)">{{ r.variancePct }}%</td>
                                <td><span class="vr-badge" :class="r.status">{{ $t('VarianceReport.s_' + r.status.replace('-', '_')) }}</span></td>
                            </tr>
                            <tr v-if="data && !data.tasks.length"><td colspan="6" class="vr-placeholder">{{ $t('VarianceReport.no_tasks') }}</td></tr>
                        </tbody>
                    </table>
                </div>
            </template>
        </div>
    </div>
</template>

<script>
export default { name: 'VarianceReport' };
</script>

<script setup>
import { ref, computed, onMounted, inject } from 'vue';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { downloadExport } from '@/composable/exportDownload';

// REP-04 — estimate-vs-actual variance. Pick a project → per-task estimate
// (tasks.totalEstimatedTime) vs actual (summed timesheet minutes) with over/under
// highlighting + a rolled-up total. Server-computed + companyId-scoped.
const companyIdRef = inject('$companyId');
const cid = computed(() => (companyIdRef && companyIdRef.value) || companyIdRef || '');

const projects = ref([]);
const projectId = ref('');
const data = ref(null);

const fmt = (min) => {
    const m = Math.abs(Number(min) || 0);
    const h = Math.floor(m / 60);
    const r = m % 60;
    return h ? `${h}h ${r}m` : `${r}m`;
};
const signed = (min) => {
    const m = Number(min) || 0;
    return (m > 0 ? '+' : (m < 0 ? '-' : '')) + fmt(m);
};
const varClass = (v) => (v > 0 ? 'over' : (v < 0 ? 'under' : ''));

const loadProjects = async () => {
    try {
        const b = (await apiRequest('get', env.PROJECT))?.data;
        projects.value = Array.isArray(b) ? b : (b && b.data) || [];
    } catch (e) { projects.value = []; }
};
const load = async () => {
    if (!projectId.value) { data.value = null; return; }
    try {
        const b = (await apiRequest('get', `${env.VARIANCE_REPORT}?projectId=${projectId.value}`))?.data;
        data.value = (b && b.status) ? b.data : null;
    } catch (e) { data.value = null; }
};
const exportReport = (format) => {
    if (!data.value) return;
    const tt = data.value.totals;
    downloadExport(format, {
        filename: 'variance-report',
        sheetName: 'Variance',
        tableHead: ['Task', 'Estimated (min)', 'Actual (min)', 'Variance (min)', 'Variance %', 'Status'],
        tableRows: data.value.tasks.map((r) => [r.name, r.estimatedMinutes, r.actualMinutes, r.variance, r.variancePct, r.status]),
        totalRow: ['Total', tt.totalEstimated, tt.totalActual, tt.totalVariance, tt.totalVariancePct, ''],
    });
};

onMounted(loadProjects);
</script>

<style scoped>
.vr-wrap { display: flex; flex-direction: column; height: calc(100dvh - 46px); }
.vr-topbar { display: flex; align-items: center; gap: 14px; padding: 12px 20px; border-bottom: 1px solid #e6e7ee; }
.vr-home img { width: 20px; height: 20px; }
.vr-title { font-size: 18px; margin: 0; flex: 0 0 auto; }
.vr-proj { max-width: 280px; margin-left: auto; }
.vr-btn { background: #fff; color: #2f3a8f; border: 1px solid #cdd2e6; border-radius: 7px; padding: 7px 12px; font-size: 12.5px; cursor: pointer; }
.vr-btn:disabled { opacity: .5; cursor: default; }
.vr-body { flex: 1; overflow-y: auto; padding: 18px 22px; }
.vr-placeholder { color: #9aa0b4; font-size: 13px; padding: 16px 4px; }
.vr-totals { display: flex; flex-wrap: wrap; gap: 22px; background: #f7f8fc; border: 1px solid #e6e7ee; border-radius: 10px; padding: 14px 18px; margin-bottom: 16px; }
.vr-stat { display: flex; flex-direction: column; }
.vr-stat b { font-size: 20px; color: #3a3f52; }
.vr-stat span { font-size: 11.5px; color: #6b7280; }
.vr-stat.over b, td.over { color: #c0392b; }
.vr-stat.under b, td.under { color: #1c7a43; }
.vr-table-wrap { overflow-x: auto; border: 1px solid #e6e7ee; border-radius: 8px; }
.vr-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.vr-table th { text-align: left; background: #f7f8fc; color: #3a3f52; font-weight: 700; padding: 9px 12px; border-bottom: 1px solid #e6e7ee; white-space: nowrap; }
.vr-table td { padding: 9px 12px; border-bottom: 1px solid #f0f1f6; color: #3a3f52; white-space: nowrap; }
.vr-name { max-width: 320px; overflow: hidden; text-overflow: ellipsis; }
.vr-badge { font-size: 10.5px; font-weight: 700; border-radius: 5px; padding: 2px 7px; }
.vr-badge.over { background: #fdecec; color: #c0392b; }
.vr-badge.under { background: #e7f6ee; color: #1c7a43; }
.vr-badge.on-track { background: #eef1fb; color: #2f3a8f; }
.vr-badge.no-estimate { background: #fff8e6; color: #9a6b00; }
</style>
