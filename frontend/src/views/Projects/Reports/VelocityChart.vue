<template>
  <div class="agile-report">
    <div class="agile-report__bar">
      <span class="agile-report__label">{{ $t('Reports.velocity_last_sprints', { n: limit }) }}</span>
      <span v-if="skipped" class="agile-report__note">{{ $t('Reports.velocity_skipped', { n: skipped }) }}</span>
      <button class="agile-report__pdf" :disabled="!hasData" @click="exportPdf">{{ $t('Reports.export_pdf') }}</button>
    </div>
    <div v-if="loading" class="agile-report__msg">{{ $t('Reports.loading') }}</div>
    <div v-else-if="!hasData" class="agile-report__msg">
      {{ $t('Reports.velocity_empty') }}
    </div>
    <ApexChart v-else ref="chartRef" type="line" height="360" :options="chartOptions" :series="series" />
  </div>
</template>

<script>
export default { name: 'VelocityChart' };
</script>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest } from '@/services';
import { downloadReportPdf, chartImage } from './reportsPdf';

const props = defineProps({
    projectData: { type: Object, default: () => ({}) },
});

const { t } = useI18n();
const limit = 10;
const loading = ref(false);
const rows = ref([]); // [{ name, committed, completed, rollingAvg }]
const skipped = ref(0);
const chartRef = ref(null);

const hasData = computed(() => rows.value.length > 0);

const series = computed(() => [
    { name: t('Reports.velocity_series_committed'), type: 'column', data: rows.value.map((r) => Number(r.committed) || 0) },
    { name: t('Reports.velocity_series_completed'), type: 'column', data: rows.value.map((r) => Number(r.completed) || 0) },
    { name: t('Reports.velocity_series_rolling_avg'), type: 'line', data: rows.value.map((r) => Number(r.rollingAvg) || 0) },
]);

const chartOptions = computed(() => ({
    chart: { id: 'velocity', toolbar: { show: false }, animations: { enabled: false } },
    // Committed, completed and the rolling average are data series, not theme
    // colours: they stay literal so the three stay mutually distinguishable.
    colors: ['#9aa0d4', '#2F3990', '#e8a33d'],
    stroke: { width: [0, 0, 3] },
    plotOptions: { bar: { columnWidth: '55%' } },
    dataLabels: { enabled: false },
    xaxis: { categories: rows.value.map((r) => r.name) },
    yaxis: { min: 0, title: { text: t('Reports.velocity_axis_points') } },
    legend: { position: 'top' },
    title: { text: t('Reports.velocity') },
}));

const load = async () => {
    const pid = props.projectData && props.projectData._id;
    if (!pid) return;
    loading.value = true;
    try {
        const res = await apiRequest('get', `/api/v1/agile/velocity?projectId=${encodeURIComponent(pid)}&limit=${limit}`);
        rows.value = (res.data && res.data.status && res.data.data && res.data.data.sprints) ? res.data.data.sprints : [];
        skipped.value = (res.data && res.data.data && Number(res.data.data.skipped)) || 0;
    } catch (e) {
        rows.value = [];
    } finally {
        loading.value = false;
    }
};

const exportPdf = async () => {
    const image = await chartImage(chartRef);
    await downloadReportPdf('velocity', {
        title: t('Reports.velocity'),
        filename: 'velocity',
        image,
        tableHead: [t('Reports.sprint'), t('Reports.velocity_series_committed'), t('Reports.velocity_series_completed'), t('Reports.velocity_table_rolling_avg')],
        tableRows: rows.value.map((r) => [r.name, r.committed, r.completed, r.rollingAvg]),
    });
};

onMounted(load);
</script>

<style scoped>
.agile-report { padding: 12px; }
.agile-report__bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
.agile-report__label { font-size: 13px; color: var(--ink-2); }
.agile-report__note { font-size: 11.5px; color: var(--ink-2); }
.agile-report__pdf { margin-left: auto; border: 1px solid var(--brand); color: var(--brand); background: var(--surface); border-radius: var(--r-chip); padding: 6px 14px; font-size: 13px; cursor: pointer; }
.agile-report__pdf:disabled { opacity: 0.5; cursor: not-allowed; }
.agile-report__msg { color: var(--ink-2); font-size: 14px; padding: 40px; text-align: center; }
</style>
