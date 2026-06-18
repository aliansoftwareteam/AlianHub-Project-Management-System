<template>
  <div class="agile-report">
    <div class="agile-report__bar">
      <span class="agile-report__label">Cumulative flow — last {{ days }} days</span>
      <button class="agile-report__pdf" :disabled="!hasData" @click="exportPdf">Export PDF</button>
    </div>
    <div v-if="loading" class="agile-report__msg">Loading…</div>
    <div v-else-if="!hasData" class="agile-report__msg">No task history yet.</div>
    <ApexChart v-else ref="chartRef" type="area" height="360" :options="chartOptions" :series="series" />
  </div>
</template>

<script>
export default { name: 'CFDChart' };
</script>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { apiRequest } from '@/services';
import { downloadReportPdf, chartImage } from './reportsPdf';

const props = defineProps({
    projectData: { type: Object, default: () => ({}) },
});

const days = 30;
const loading = ref(false);
const rows = ref([]); // [{ date, open, inprogress, onhold, close }]
const chartRef = ref(null);

// Bottom-to-top stack: Done at the bottom (grows), To-do at the top.
const BANDS = [
    { key: 'close', label: 'Done', color: '#3aaa6f' },
    { key: 'onhold', label: 'On hold', color: '#e8a33d' },
    { key: 'inprogress', label: 'In progress', color: '#2F3990' },
    { key: 'open', label: 'To do', color: '#9aa0d4' },
];

const hasData = computed(() => rows.value.length > 0);
const series = computed(() => BANDS.map((b) => ({ name: b.label, data: rows.value.map((d) => Number(d[b.key]) || 0) })));

const chartOptions = computed(() => ({
    chart: { id: 'cfd', type: 'area', stacked: true, toolbar: { show: false }, animations: { enabled: false } },
    colors: BANDS.map((b) => b.color),
    dataLabels: { enabled: false },
    stroke: { curve: 'straight', width: 1 },
    fill: { type: 'solid', opacity: 0.85 },
    xaxis: { categories: rows.value.map((d) => d.date), labels: { rotate: -45, hideOverlappingLabels: true } },
    yaxis: { min: 0, title: { text: 'Tasks' } },
    legend: { position: 'top' },
    title: { text: 'Cumulative Flow Diagram' },
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
    await downloadReportPdf('cfd', { title: 'Cumulative Flow Diagram', filename: 'cfd', image });
};

onMounted(load);
</script>

<style scoped>
.agile-report { padding: 12px; }
.agile-report__bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
.agile-report__label { font-size: 13px; color: #555; }
.agile-report__pdf { margin-left: auto; border: 1px solid #2F3990; color: #2F3990; background: #fff; border-radius: 6px; padding: 6px 14px; font-size: 13px; cursor: pointer; }
.agile-report__pdf:disabled { opacity: 0.5; cursor: not-allowed; }
.agile-report__msg { color: #888; font-size: 14px; padding: 40px; text-align: center; }
</style>
