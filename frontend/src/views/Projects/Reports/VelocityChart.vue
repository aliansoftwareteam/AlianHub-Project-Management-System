<template>
  <div class="agile-report">
    <div class="agile-report__bar">
      <span class="agile-report__label">Last {{ limit }} completed sprints — committed vs completed (points)</span>
      <span v-if="skipped" class="agile-report__note">{{ skipped }} older sprint(s) skipped — no commitment was recorded when they ran.</span>
      <button class="agile-report__pdf" :disabled="!hasData" @click="exportPdf">Export PDF</button>
    </div>
    <div v-if="loading" class="agile-report__msg">Loading…</div>
    <div v-else-if="!hasData" class="agile-report__msg">
      No completed sprints yet. Velocity is measured from what a sprint committed to when it started, so a sprint has to be started and completed before it appears here.
    </div>
    <ApexChart v-else ref="chartRef" type="line" height="360" :options="chartOptions" :series="series" />
  </div>
</template>

<script>
export default { name: 'VelocityChart' };
</script>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { apiRequest } from '@/services';
import { downloadReportPdf, chartImage } from './reportsPdf';

const props = defineProps({
    projectData: { type: Object, default: () => ({}) },
});

const limit = 10;
const loading = ref(false);
const rows = ref([]); // [{ name, committed, completed, rollingAvg }]
const skipped = ref(0);
const chartRef = ref(null);

const hasData = computed(() => rows.value.length > 0);

const series = computed(() => [
    { name: 'Committed', type: 'column', data: rows.value.map((r) => Number(r.committed) || 0) },
    { name: 'Completed', type: 'column', data: rows.value.map((r) => Number(r.completed) || 0) },
    { name: 'Avg (3-sprint)', type: 'line', data: rows.value.map((r) => Number(r.rollingAvg) || 0) },
]);

const chartOptions = computed(() => ({
    chart: { id: 'velocity', toolbar: { show: false }, animations: { enabled: false } },
    colors: ['#9aa0d4', '#2F3990', '#e8a33d'],
    stroke: { width: [0, 0, 3] },
    plotOptions: { bar: { columnWidth: '55%' } },
    dataLabels: { enabled: false },
    xaxis: { categories: rows.value.map((r) => r.name) },
    yaxis: { min: 0, title: { text: 'Story points' } },
    legend: { position: 'top' },
    title: { text: 'Velocity' },
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
        title: 'Velocity',
        filename: 'velocity',
        image,
        tableHead: ['Sprint', 'Committed', 'Completed', 'Avg (3)'],
        tableRows: rows.value.map((r) => [r.name, r.committed, r.completed, r.rollingAvg]),
    });
};

onMounted(load);
</script>

<style scoped>
.agile-report { padding: 12px; }
.agile-report__bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
.agile-report__label { font-size: 13px; color: #555; }
.agile-report__note { font-size: 11.5px; color: #8b90a0; }
.agile-report__pdf { margin-left: auto; border: 1px solid #2F3990; color: #2F3990; background: #fff; border-radius: 6px; padding: 6px 14px; font-size: 13px; cursor: pointer; }
.agile-report__pdf:disabled { opacity: 0.5; cursor: not-allowed; }
.agile-report__msg { color: #888; font-size: 14px; padding: 40px; text-align: center; }
</style>
