<template>
  <div class="agile-report">
    <div class="agile-report__bar">
      <span class="agile-report__label">{{ $t('Reports.cfd_last_days', { days }) }}</span>
      <button class="agile-report__pdf" :disabled="!hasData" @click="exportPdf">{{ $t('Reports.export_pdf') }}</button>
    </div>
    <div v-if="loading" class="agile-report__msg">{{ $t('Reports.loading') }}</div>
    <div v-else-if="!hasData" class="agile-report__msg">{{ $t('Reports.cfd_no_history') }}</div>
    <ApexChart v-else ref="chartRef" type="area" height="360" :options="chartOptions" :series="series" />
  </div>
</template>

<script>
export default { name: 'CFDChart' };
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
const days = 30;
const loading = ref(false);
const rows = ref([]); // [{ date, open, inprogress, onhold, close }]
const chartRef = ref(null);

// Bottom-to-top stack: Done at the bottom (grows), To-do at the top.
// The band colours are data series, not theme colours: they stay literal so the
// four stacked bands never collapse into the same hue.
const BANDS = [
    { key: 'close', label: 'Reports.cfd_band_done', color: '#3aaa6f' },
    { key: 'onhold', label: 'Reports.cfd_band_on_hold', color: '#e8a33d' },
    { key: 'inprogress', label: 'Reports.cfd_band_in_progress', color: '#2F3990' },
    { key: 'open', label: 'Reports.cfd_band_to_do', color: '#9aa0d4' },
];

const hasData = computed(() => rows.value.length > 0);
const series = computed(() => BANDS.map((b) => ({ name: t(b.label), data: rows.value.map((d) => Number(d[b.key]) || 0) })));

const chartOptions = computed(() => ({
    chart: { id: 'cfd', type: 'area', stacked: true, toolbar: { show: false }, animations: { enabled: false } },
    colors: BANDS.map((b) => b.color),
    dataLabels: { enabled: false },
    stroke: { curve: 'straight', width: 1 },
    fill: { type: 'solid', opacity: 0.85 },
    xaxis: { categories: rows.value.map((d) => d.date), labels: { rotate: -45, hideOverlappingLabels: true } },
    yaxis: { min: 0, title: { text: t('Reports.cfd_axis_tasks') } },
    legend: { position: 'top' },
    title: { text: t('Reports.cfd_chart_title') },
}));

const load = async () => {
    const pid = props.projectData && props.projectData._id;
    if (!pid) return;
    loading.value = true;
    try {
        const res = await apiRequest('get', `/api/v1/agile/cfd?projectId=${encodeURIComponent(pid)}`);
        rows.value = (res.data && res.data.status && res.data.data && res.data.data.days) ? res.data.data.days : [];
    } catch (e) {
        rows.value = [];
    } finally {
        loading.value = false;
    }
};

const exportPdf = async () => {
    const image = await chartImage(chartRef);
    await downloadReportPdf('cfd', { title: t('Reports.cfd_chart_title'), filename: 'cfd', image });
};

onMounted(load);
</script>

<style scoped>
.agile-report { padding: 12px; }
.agile-report__bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
.agile-report__label { font-size: 13px; color: var(--ink-2); }
.agile-report__pdf { margin-left: auto; border: 1px solid var(--brand); color: var(--brand); background: var(--surface); border-radius: var(--r-chip); padding: 6px 14px; font-size: 13px; cursor: pointer; }
.agile-report__pdf:disabled { opacity: 0.5; cursor: not-allowed; }
.agile-report__msg { color: var(--ink-2); font-size: 14px; padding: 40px; text-align: center; }
</style>
