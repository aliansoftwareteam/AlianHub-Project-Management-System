<template>
  <div class="agile-report">
    <div class="agile-report__bar">
      <select v-model="selectedSprintId" class="agile-report__select" @change="load">
        <option value="">Select a sprint…</option>
        <option v-for="s in sprintOptions" :key="s._id" :value="s._id">{{ s.name }}</option>
      </select>
      <div class="agile-report__toggle">
        <button :class="{ active: metric === 'points' }" @click="metric = 'points'">Points</button>
        <button :class="{ active: metric === 'count' }" @click="metric = 'count'">Tasks</button>
      </div>
      <button class="agile-report__pdf" :disabled="!hasData" @click="exportPdf">Export PDF</button>
    </div>
    <div v-if="loading" class="agile-report__msg">Loading…</div>
    <div v-else-if="!selectedSprintId" class="agile-report__msg">Pick a sprint to see its burndown.</div>
    <div v-else-if="!hasData" class="agile-report__msg">{{ emptyMsg || 'No data for this sprint yet.' }}</div>
    <ApexChart v-else ref="chartRef" type="line" height="360" :options="chartOptions" :series="series" />
  </div>
</template>

<script>
export default { name: 'BurndownChart' };
</script>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { apiRequest } from '@/services';
import { downloadReportPdf, chartImage } from './reportsPdf';

const props = defineProps({
    projectData: { type: Object, default: () => ({}) },
    sprints: { type: Array, default: () => [] },
});

const selectedSprintId = ref('');
const metric = ref('points'); // 'points' | 'count'
const loading = ref(false);
const emptyMsg = ref('');
const data = ref(null); // { sprintName, totalCount, totalPoints, days:[...] }
const chartRef = ref(null);

const sprintOptions = computed(() =>
    (props.sprints || [])
        .filter((s) => s && s._id)
        .map((s) => ({ _id: s._id, name: s.name || s.sprintName || 'Sprint' }))
);

const hasData = computed(() => !!(data.value && data.value.days && data.value.days.length));
const categories = computed(() => (data.value && data.value.days ? data.value.days : []).map((d) => d.date));
const actualKey = computed(() => (metric.value === 'points' ? 'remainingPoints' : 'remainingCount'));
const idealKey = computed(() => (metric.value === 'points' ? 'idealPoints' : 'ideal'));

const series = computed(() => {
    const days = (data.value && data.value.days) || [];
    return [
        { name: 'Ideal', data: days.map((d) => Number(d[idealKey.value]) || 0) },
        {
            name: metric.value === 'points' ? 'Remaining points' : 'Remaining tasks',
            // null = a day the sprint has not reached. Coercing it to 0 would
            // draw a running sprint as finished for the rest of its box.
            data: days.map((d) => (d[actualKey.value] === null || d[actualKey.value] === undefined ? null : Number(d[actualKey.value]))),
        },
    ];
});

const chartOptions = computed(() => ({
    chart: { id: 'burndown', toolbar: { show: false }, animations: { enabled: false } },
    colors: ['#bdbdbd', '#2F3990'],
    stroke: { curve: 'straight', width: [2, 3], dashArray: [6, 0] },
    markers: { size: 0 },
    xaxis: { categories: categories.value, labels: { rotate: -45, hideOverlappingLabels: true } },
    yaxis: { min: 0, title: { text: metric.value === 'points' ? 'Points remaining' : 'Tasks remaining' } },
    legend: { position: 'top' },
    title: { text: data.value && data.value.sprintName ? `Burndown — ${data.value.sprintName}` : 'Sprint burndown' },
}));

const load = async () => {
    if (!selectedSprintId.value) { data.value = null; return; }
    loading.value = true;
    emptyMsg.value = '';
    try {
        const res = await apiRequest('get', `/api/v1/agile/burndown?sprintId=${encodeURIComponent(selectedSprintId.value)}`);
        if (res.data && res.data.status) {
            data.value = res.data.data || null;
            if (!hasData.value) emptyMsg.value = res.data.statusText || '';
        } else {
            data.value = null;
            emptyMsg.value = (res.data && res.data.statusText) || 'Could not load burndown.';
        }
    } catch (e) {
        data.value = null;
        emptyMsg.value = 'Could not load burndown.';
    } finally {
        loading.value = false;
    }
};

const exportPdf = async () => {
    const image = await chartImage(chartRef);
    const isPoints = metric.value === 'points';
    await downloadReportPdf('burndown', {
        title: 'Sprint Burndown',
        subtitle: (data.value && data.value.sprintName) || '',
        filename: `burndown-${(data.value && data.value.sprintName) || 'sprint'}`,
        image,
        meta: [
            `Metric: ${isPoints ? 'Story points' : 'Task count'}`,
            `Total ${isPoints ? 'points' : 'tasks'}: ${isPoints ? (data.value && data.value.totalPoints) || 0 : (data.value && data.value.totalCount) || 0}`,
        ],
    });
};

onMounted(() => {
    if (sprintOptions.value.length) {
        selectedSprintId.value = sprintOptions.value[0]._id;
        load();
    }
});
</script>

<style scoped>
.agile-report { padding: 12px; }
.agile-report__bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
.agile-report__select { border: 1px solid #d9d9d9; border-radius: 6px; padding: 6px 10px; font-size: 13px; min-width: 200px; background: #fff; }
.agile-report__toggle button { border: 1px solid #d9d9d9; background: #fff; padding: 5px 12px; font-size: 12px; cursor: pointer; }
.agile-report__toggle button:first-child { border-radius: 6px 0 0 6px; }
.agile-report__toggle button:last-child { border-radius: 0 6px 6px 0; border-left: none; }
.agile-report__toggle button.active { background: #2F3990; color: #fff; border-color: #2F3990; }
.agile-report__pdf { margin-left: auto; border: 1px solid #2F3990; color: #2F3990; background: #fff; border-radius: 6px; padding: 6px 14px; font-size: 13px; cursor: pointer; }
.agile-report__pdf:disabled { opacity: 0.5; cursor: not-allowed; }
.agile-report__msg { color: #888; font-size: 14px; padding: 40px; text-align: center; }
</style>
