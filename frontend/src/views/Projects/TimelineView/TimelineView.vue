<template>
  <div class="tl-view">
    <div class="tl-view__bar">
      <span class="tl-view__title">Timeline</span>
      <span class="tl-view__count">
        {{ scheduled.length }} scheduled<template v-if="unscheduled.length"> · {{ unscheduled.length }} unscheduled</template>
      </span>
    </div>

    <div class="tl-view__main">
      <div v-if="!scheduled.length" class="tl-view__empty">
        No scheduled tasks yet — give a task a start &amp; due date to see it on the timeline.
      </div>

      <div v-else class="tl-view__chart">
        <!-- month axis -->
        <div class="tl-view__axis">
          <div class="tl-view__axis-label"></div>
          <div class="tl-view__axis-track">
            <span v-for="(m, i) in monthTicks" :key="i" class="tl-view__tick" :style="{ left: m.left + '%' }">{{ m.label }}</span>
          </div>
        </div>

        <!-- rows -->
        <div v-for="t in scheduled" :key="t._id" class="tl-view__row">
          <div class="tl-view__row-label" :title="t.TaskName || t.TaskKey">
            <span class="tl-view__key" v-if="t.TaskKey">{{ t.TaskKey }}</span>{{ t.TaskName || 'Untitled' }}
          </div>
          <div class="tl-view__row-track">
            <div
              class="tl-view__barseg"
              :class="statusClass(t)"
              :style="{ left: barLeft(t) + '%', width: barWidth(t) + '%' }"
              :title="`${fmt(t.startDate)} → ${fmt(t.DueDate)}`"
            >
              <span class="tl-view__barseg-text">{{ t.TaskName || t.TaskKey }}</span>
            </div>
          </div>
        </div>
      </div>

      <aside v-if="unscheduled.length" class="tl-view__tray">
        <h4 class="tl-view__tray-title">Unscheduled ({{ unscheduled.length }})</h4>
        <ul class="tl-view__tray-list">
          <li v-for="t in unscheduled" :key="t._id" class="tl-view__tray-item" :title="t.TaskName || t.TaskKey">
            {{ t.TaskName || t.TaskKey }}
          </li>
        </ul>
      </aside>
    </div>
  </div>
</template>

<script>
export default { name: 'TimelineView' };
</script>

<script setup>
// VIEW-01 — read-only Timeline. Plots tasks with a start + due date as bars on a
// shared date axis. Lightweight (no external lib); reads tasks from the same live
// Vuex store the List/Gantt views use, so socket updates flow in for free.
import { ref, computed, onMounted, inject, watch } from 'vue';
import { useStore } from 'vuex';
import { taskListHelper } from '@/views/Projects/helper.js';

const props = defineProps({
    projectData: { type: Object, default: () => ({}) },
    sprints: { type: Array, default: () => [] },
});

const { getters } = useStore();
const { groupBy } = taskListHelper();
const selectedProject = inject('selectedProject', ref({}));

const sprintId = computed(() => props.sprints?.[0]?.id || props.sprints?.[0]?._id || '');
function pickTasks(map) {
    const pid = props.projectData?._id;
    const sid = sprintId.value;
    if (!pid || !sid || !map || !map[pid] || !map[pid][sid]) return null;
    const node = map[pid][sid];
    return Array.isArray(node.tasks) ? node.tasks : null;
}
const tasks = computed(() => pickTasks(getters['projectData/tasks']) || pickTasks(getters['projectData/tableTasks']) || []);
const activeTasks = computed(() => tasks.value.filter((t) => t && [0, 2, undefined, null].includes(t.deletedStatusKey)));

const scheduled = computed(() => activeTasks.value
    .filter((t) => t.startDate && t.DueDate && !isNaN(new Date(t.startDate)) && !isNaN(new Date(t.DueDate)))
    .slice()
    .sort((a, b) => new Date(a.startDate) - new Date(b.startDate)));
const unscheduled = computed(() => activeTasks.value.filter((t) => !(t.startDate && t.DueDate)));

const range = computed(() => {
    if (!scheduled.value.length) return { min: 0, max: 1 };
    let min = Infinity; let max = -Infinity;
    scheduled.value.forEach((t) => {
        min = Math.min(min, new Date(t.startDate).getTime());
        max = Math.max(max, new Date(t.DueDate).getTime());
    });
    if (min === max) max = min + 86400000; // 1-day pad so a single same-day task is visible
    return { min, max };
});
const pct = (ms) => {
    const { min, max } = range.value;
    return Math.max(0, Math.min(100, ((ms - min) / (max - min)) * 100));
};
const barLeft = (t) => pct(new Date(t.startDate).getTime());
const barWidth = (t) => Math.max(1.5, pct(new Date(t.DueDate).getTime()) - barLeft(t));

const monthTicks = computed(() => {
    const { min, max } = range.value;
    if (!isFinite(min) || max <= min) return [];
    const ticks = [];
    const d = new Date(min);
    d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0);
    let guard = 0;
    while (d.getTime() <= max && guard++ < 60) {
        const ms = d.getTime();
        if (ms >= min) ticks.push({ left: pct(ms), label: d.toLocaleString('default', { month: 'short', year: '2-digit' }) });
        d.setUTCMonth(d.getUTCMonth() + 1);
    }
    return ticks;
});

const statusClass = (t) => {
    const type = t?.status?.type || t?.statusType;
    if (type === 'close') return 'is-done';
    if (type === 'inprogress') return 'is-progress';
    return 'is-todo';
};
const fmt = (d) => (d ? new Date(d).toLocaleDateString() : '');

function ensureTasksLoaded() {
    if (tasks.value.length) return;
    const proj = (selectedProject.value && selectedProject.value._id) ? selectedProject.value : props.projectData;
    if (!proj || !proj._id || !Array.isArray(props.sprints) || !props.sprints.length) return;
    try { groupBy(0, true, proj, props.sprints, ref([]), false, 'list', false, true, () => {}); } catch (e) { /* noop */ }
}
onMounted(ensureTasksLoaded);
watch(() => props.sprints, () => ensureTasksLoaded(), { deep: true });
</script>

<style scoped>
.tl-view { display: flex; flex-direction: column; width: 100%; height: 100%; background: #fff; }
.tl-view__bar { display: flex; align-items: center; gap: 14px; padding: 8px 14px; border-bottom: 1px solid #eee; flex: 0 0 auto; }
.tl-view__title { font-size: 14px; font-weight: 700; color: #2b2f44; }
.tl-view__count { margin-left: auto; font-size: 12px; color: #888; }
.tl-view__main { position: relative; flex: 1 1 auto; display: flex; min-height: 360px; overflow: hidden; }
.tl-view__chart { flex: 1 1 auto; overflow: auto; padding-bottom: 12px; }
.tl-view__empty { position: absolute; top: 48px; left: 0; right: 0; text-align: center; color: #999; font-size: 14px; padding: 20px; }
.tl-view__axis { display: flex; position: sticky; top: 0; background: #fafbff; border-bottom: 1px solid #eee; z-index: 1; }
.tl-view__axis-label { width: 240px; flex: 0 0 240px; }
.tl-view__axis-track { position: relative; flex: 1 1 auto; height: 26px; }
.tl-view__tick { position: absolute; top: 5px; font-size: 11px; color: #9aa0b4; transform: translateX(-50%); white-space: nowrap; }
.tl-view__tick::before { content: ''; position: absolute; top: -5px; left: 50%; width: 1px; height: 100%; background: #eef0f6; }
.tl-view__row { display: flex; align-items: center; border-bottom: 1px solid #f4f4f8; }
.tl-view__row-label { width: 240px; flex: 0 0 240px; padding: 7px 12px; font-size: 13px; color: #3a3f52; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tl-view__key { color: #7b68ee; font-weight: 600; margin-right: 6px; }
.tl-view__row-track { position: relative; flex: 1 1 auto; height: 34px; }
.tl-view__barseg { position: absolute; top: 7px; height: 20px; border-radius: 5px; display: flex; align-items: center; padding: 0 8px; overflow: hidden; min-width: 6px; }
.tl-view__barseg-text { font-size: 11px; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tl-view__barseg.is-todo { background: #8a93b5; }
.tl-view__barseg.is-progress { background: #2f6fed; }
.tl-view__barseg.is-done { background: #1c9b5e; }
.tl-view__tray { width: 210px; flex: 0 0 auto; border-left: 1px solid #eee; padding: 10px; overflow: auto; background: #fafafe; }
.tl-view__tray-title { font-size: 12px; text-transform: uppercase; color: #999; margin: 0 0 8px; letter-spacing: .04em; }
.tl-view__tray-list { list-style: none; margin: 0; padding: 0; }
.tl-view__tray-item { padding: 6px 0; border-bottom: 1px dashed #eee; font-size: 13px; color: #444; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
