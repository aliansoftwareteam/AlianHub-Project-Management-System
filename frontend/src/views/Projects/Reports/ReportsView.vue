<template>
  <div class="reports-view">
    <div class="reports-view__tabs">
      <button v-for="t in tabs" :key="t.key" :class="{ active: tab === t.key }" @click="tab = t.key">{{ t.label }}</button>
    </div>
    <div class="reports-view__body">
      <BurndownChart v-if="tab === 'burndown'" :projectData="projectData" :sprints="sprints" />
      <VelocityChart v-else-if="tab === 'velocity'" :projectData="projectData" />
      <CFDChart v-else-if="tab === 'cfd'" :projectData="projectData" />
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

defineProps({
    projectData: { type: Object, default: () => ({}) },
    sprints: { type: Array, default: () => [] },
});

const tab = ref('burndown');
const tabs = [
    { key: 'burndown', label: 'Burndown' },
    { key: 'velocity', label: 'Velocity' },
    { key: 'cfd', label: 'Cumulative Flow' },
];
</script>

<style scoped>
.reports-view { width: 100%; padding: 8px 12px; background: #fff; }
.reports-view__tabs { display: flex; gap: 4px; border-bottom: 1px solid #e6e6e6; margin-bottom: 8px; }
.reports-view__tabs button { border: none; background: none; padding: 10px 16px; font-size: 14px; cursor: pointer; color: #666; border-bottom: 2px solid transparent; }
.reports-view__tabs button.active { color: #2F3990; border-bottom-color: #2F3990; font-weight: 600; }
.reports-view__body { width: 100%; }
</style>
