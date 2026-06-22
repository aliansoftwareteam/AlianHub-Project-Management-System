<template>
  <div class="cv-view">
    <div class="cv-view__bar">
      <span class="cv-view__title">Canvas</span>
      <div class="cv-view__chips">
        <button
          v-for="w in WIDGETS"
          :key="w.key"
          type="button"
          class="cv-view__chip"
          :class="{ on: enabled.includes(w.key) }"
          @click="toggle(w.key)"
        >{{ w.label }}</button>
      </div>
    </div>

    <div class="cv-view__board">
      <div v-if="!hasTasks" class="cv-view__empty">No tasks yet — widgets fill in as the project grows.</div>
      <div v-else class="cv-view__grid">
        <template v-for="w in WIDGETS">
          <div v-if="enabled.includes(w.key)" :key="w.key" class="cv-card" :class="'cv-card--' + w.key">
            <div class="cv-card__head">{{ w.label }}</div>

            <div v-if="w.key === 'summary'" class="cv-card__big">
              <div class="cv-card__num">{{ stats.total }}</div>
              <div class="cv-card__sub">{{ stats.donePct }}% complete</div>
              <div class="cv-bar"><div class="cv-bar__fill is-done" :style="{ width: stats.donePct + '%' }"></div></div>
            </div>

            <div v-else-if="w.key === 'status'" class="cv-card__rows">
              <div v-for="s in stats.status" :key="s.key" class="cv-row">
                <span class="cv-row__label">{{ s.label }}</span>
                <div class="cv-bar"><div class="cv-bar__fill" :class="s.cls" :style="{ width: barPct(s.count) + '%' }"></div></div>
                <span class="cv-row__val">{{ s.count }}</span>
              </div>
            </div>

            <div v-else-if="w.key === 'priority'" class="cv-card__rows">
              <div v-for="p in stats.priority" :key="p.key" class="cv-row">
                <span class="cv-row__label">{{ p.label }}</span>
                <div class="cv-bar"><div class="cv-bar__fill" :class="p.cls" :style="{ width: barPct(p.count) + '%' }"></div></div>
                <span class="cv-row__val">{{ p.count }}</span>
              </div>
            </div>

            <div v-else-if="w.key === 'overdue'" class="cv-card__big">
              <div class="cv-card__num" :class="{ danger: stats.overdue > 0 }">{{ stats.overdue }}</div>
              <div class="cv-card__sub">overdue & open</div>
            </div>

            <div v-else-if="w.key === 'upcoming'" class="cv-card__list">
              <div v-if="!stats.upcoming.length" class="cv-card__muted">Nothing due in the next 7 days.</div>
              <div v-for="t in stats.upcoming" :key="t.id" class="cv-up">
                <span class="cv-up__name" :title="t.name">{{ t.name }}</span>
                <span class="cv-up__date">{{ t.due }}</span>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script>
export default { name: 'CanvasView' };
</script>

<script setup>
// VIEW-04 — Canvas / dynamic layouts. A configurable mini-dashboard of project
// insight widgets (summary, status, priority, overdue, upcoming) computed live
// from the task store. Which widgets show is toggleable + persisted per user
// (localStorage). Lightweight, no external lib.
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

const WIDGETS = [
    { key: 'summary', label: 'Summary' },
    { key: 'status', label: 'By status' },
    { key: 'priority', label: 'By priority' },
    { key: 'overdue', label: 'Overdue' },
    { key: 'upcoming', label: 'Upcoming' },
];

const sprintId = computed(() => props.sprints?.[0]?.id || props.sprints?.[0]?._id || '');
function pickTasks(map) {
    const pid = props.projectData?._id;
    const sid = sprintId.value;
    if (!pid || !sid || !map || !map[pid] || !map[pid][sid]) return null;
    const node = map[pid][sid];
    return Array.isArray(node.tasks) ? node.tasks : null;
}
const tasks = computed(() => pickTasks(getters['projectData/tasks']) || pickTasks(getters['projectData/tableTasks']) || []);
const active = computed(() => tasks.value.filter((t) => t && [0, 2, undefined, null].includes(t.deletedStatusKey)));
const hasTasks = computed(() => active.value.length > 0);

const isDone = (t) => (t?.status?.type || t?.statusType) === 'close';
const isProgress = (t) => (t?.status?.type || t?.statusType) === 'inprogress';

const stats = computed(() => {
    const list = active.value;
    const total = list.length;
    const done = list.filter(isDone).length;
    const inprog = list.filter(isProgress).length;
    const todo = total - done - inprog;
    const prio = (p) => list.filter((t) => (t.Task_Priority || '').toUpperCase() === p).length;
    const now = Date.now();
    const soon = now + 7 * 86400000;
    const dated = list.filter((t) => t.DueDate && !isDone(t) && !isNaN(new Date(t.DueDate)));
    const overdue = dated.filter((t) => new Date(t.DueDate).getTime() < now).length;
    const upcoming = dated
        .filter((t) => { const d = new Date(t.DueDate).getTime(); return d >= now && d <= soon; })
        .sort((a, b) => new Date(a.DueDate) - new Date(b.DueDate))
        .slice(0, 6)
        .map((t) => ({ id: String(t._id), name: t.TaskName || t.TaskKey || 'Task', due: new Date(t.DueDate).toLocaleDateString() }));
    return {
        total,
        donePct: total ? Math.round((done / total) * 100) : 0,
        status: [
            { key: 'todo', label: 'To Do', count: todo, cls: 'is-todo' },
            { key: 'inprog', label: 'In Progress', count: inprog, cls: 'is-progress' },
            { key: 'done', label: 'Done', count: done, cls: 'is-done' },
        ],
        priority: [
            { key: 'high', label: 'High', count: prio('HIGH'), cls: 'is-high' },
            { key: 'med', label: 'Medium', count: prio('MEDIUM'), cls: 'is-med' },
            { key: 'low', label: 'Low', count: prio('LOW'), cls: 'is-low' },
        ],
        overdue,
        upcoming,
    };
});
const maxStat = computed(() => Math.max(1, ...stats.value.status.map((s) => s.count), ...stats.value.priority.map((p) => p.count)));
const barPct = (n) => Math.round((n / maxStat.value) * 100);

const storeKey = computed(() => `canvas:${props.projectData?._id || 'p'}:${sprintId.value || 's'}`);
const enabled = ref(WIDGETS.map((w) => w.key));
function loadEnabled() {
    try { const saved = JSON.parse(localStorage.getItem(storeKey.value) || 'null'); if (Array.isArray(saved)) enabled.value = saved; } catch (e) { /* noop */ }
}
function toggle(key) {
    enabled.value = enabled.value.includes(key) ? enabled.value.filter((k) => k !== key) : [...enabled.value, key];
    try { localStorage.setItem(storeKey.value, JSON.stringify(enabled.value)); } catch (e) { /* noop */ }
}

function ensureTasksLoaded() {
    if (tasks.value.length) return;
    const proj = (selectedProject.value && selectedProject.value._id) ? selectedProject.value : props.projectData;
    if (!proj || !proj._id || !Array.isArray(props.sprints) || !props.sprints.length) return;
    try { groupBy(0, true, proj, props.sprints, ref([]), false, 'list', false, true, () => {}); } catch (e) { /* noop */ }
}
onMounted(() => { ensureTasksLoaded(); loadEnabled(); });
watch(() => props.sprints, () => ensureTasksLoaded(), { deep: true });
</script>

<style scoped>
.cv-view { display: flex; flex-direction: column; width: 100%; height: 100%; background: #f7f8fc; }
.cv-view__bar { display: flex; align-items: center; gap: 14px; padding: 8px 14px; border-bottom: 1px solid #e6e7ee; background: #fff; flex: 0 0 auto; flex-wrap: wrap; }
.cv-view__title { font-size: 14px; font-weight: 700; color: #2b2f44; }
.cv-view__chips { display: flex; gap: 6px; flex-wrap: wrap; }
.cv-view__chip { border: 1px solid #d8d8e0; background: #fff; color: #777; border-radius: 14px; padding: 3px 11px; font-size: 12px; cursor: pointer; }
.cv-view__chip.on { background: #eef0ff; border-color: #c7ccf5; color: #2f3a8f; }
.cv-view__board { flex: 1 1 auto; overflow: auto; padding: 16px; }
.cv-view__empty { text-align: center; color: #999; font-size: 14px; padding: 40px; }
.cv-view__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; }
.cv-card { background: #fff; border: 1px solid #e6e7ee; border-radius: 12px; padding: 14px 16px; min-height: 120px; }
.cv-card__head { font-size: 11.5px; text-transform: uppercase; letter-spacing: .04em; color: #9aa0b4; margin-bottom: 10px; }
.cv-card__big { text-align: center; }
.cv-card__num { font-size: 36px; font-weight: 700; color: #2b2f44; line-height: 1; }
.cv-card__num.danger { color: #c0392b; }
.cv-card__sub { font-size: 12px; color: #6b7280; margin-top: 4px; }
.cv-card__rows { display: flex; flex-direction: column; gap: 9px; }
.cv-row { display: flex; align-items: center; gap: 8px; }
.cv-row__label { width: 78px; font-size: 12px; color: #555; }
.cv-row__val { width: 24px; text-align: right; font-size: 12px; color: #333; font-weight: 600; }
.cv-bar { flex: 1; height: 9px; background: #eef0f6; border-radius: 4px; overflow: hidden; }
.cv-bar__fill { height: 100%; background: #8a93b5; }
.cv-bar__fill.is-todo { background: #8a93b5; }
.cv-bar__fill.is-progress { background: #2f6fed; }
.cv-bar__fill.is-done { background: #1c9b5e; }
.cv-bar__fill.is-high { background: #e6593f; }
.cv-bar__fill.is-med { background: #e2a23b; }
.cv-bar__fill.is-low { background: #6c9bd2; }
.cv-card__big + .cv-bar, .cv-card__big .cv-bar { margin-top: 10px; }
.cv-card__list { display: flex; flex-direction: column; gap: 7px; }
.cv-card__muted { font-size: 12px; color: #9aa0b4; }
.cv-up { display: flex; justify-content: space-between; gap: 8px; font-size: 12.5px; }
.cv-up__name { color: #33384a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cv-up__date { color: #9aa0b4; white-space: nowrap; }
</style>
