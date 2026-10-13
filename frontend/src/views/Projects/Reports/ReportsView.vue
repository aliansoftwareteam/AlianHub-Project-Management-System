<template>
  <div class="ah-page reports-view">
    <div class="reports-view__tabs">
      <button v-for="t in tabs" :key="t.key" :class="{ active: tab === t.key }" @click="tab = t.key">{{ t.label }}</button>
    </div>
    <div class="reports-view__body">
      <BurndownChart v-if="tab === 'burndown'" :projectData="projectData" :sprints="sprints" />
      <VelocityChart v-else-if="tab === 'velocity'" :projectData="projectData" />
      <CFDChart v-else-if="tab === 'cfd'" :projectData="projectData" />
      <SprintReport v-else-if="tab === 'sprint'" :projectData="projectData" :sprints="sprints" />
    </div>
  </div>
</template>

<script>
export default { name: 'ReportsView' };
</script>

<script setup>
import { ref } from 'vue';
import BurndownChart from './BurndownChart.vue';
import VelocityChart from './VelocityChart.vue';
import CFDChart from './CFDChart.vue';
import SprintReport from './SprintReport.vue';

defineProps({
    projectData: { type: Object, default: () => ({}) },
    sprints: { type: Array, default: () => [] },
});

const tab = ref('burndown');
const tabs = [
    { key: 'burndown', label: 'Burndown' },
    { key: 'velocity', label: 'Velocity' },
    { key: 'cfd', label: 'Cumulative Flow' },
    { key: 'sprint', label: 'Sprint Report' },
];
</script>

<style scoped>
.reports-view { width: 100%; padding: 8px 12px; background: var(--surface); }
.reports-view__tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--hairline); margin-bottom: 8px; }
.reports-view__tabs button { border: none; background: none; padding: 10px 16px; font-size: 14px; cursor: pointer; color: var(--ink-2); border-bottom: 2px solid transparent; }
.reports-view__tabs button.active { color: var(--brand); border-bottom-color: var(--brand); font-weight: 600; }
.reports-view__body { width: 100%; }

/* ApexCharts hardcodes light-grey chrome of its own, which is invisible on a dark
   card. The legend is the one part the library sets inline, so it needs !important. */
.reports-view :deep(.apexcharts-gridline), .reports-view :deep(.apexcharts-grid-borders line) { stroke: var(--hairline); }
.reports-view :deep(.apexcharts-xaxis-label), .reports-view :deep(.apexcharts-yaxis-label),
.reports-view :deep(.apexcharts-xaxis-title-text), .reports-view :deep(.apexcharts-yaxis-title-text) { fill: var(--ink-2); }
.reports-view :deep(.apexcharts-title-text) { fill: var(--ink); }
.reports-view :deep(.apexcharts-legend-text) { color: var(--ink-2) !important; }
.reports-view :deep(.apexcharts-tooltip.apexcharts-theme-light) { background: var(--surface); border-color: var(--border); color: var(--ink); }
.reports-view :deep(.apexcharts-tooltip.apexcharts-theme-light .apexcharts-tooltip-title) { background: var(--surface-2); border-bottom-color: var(--hairline); }
</style>
