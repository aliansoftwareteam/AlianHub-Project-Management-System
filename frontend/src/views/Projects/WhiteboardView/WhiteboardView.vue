<template>
  <div class="wb-view">
    <div class="wb-view__bar">
      <span class="wb-view__title">Whiteboard</span>
      <span class="wb-view__count">{{ cards.length }} cards</span>
      <button class="wb-view__btn" type="button" @click="autoArrange">Auto-arrange</button>
    </div>
    <div ref="boardEl" class="wb-view__board">
      <div v-if="!cards.length" class="wb-view__empty">No tasks yet — tasks appear here as movable cards.</div>
      <div
        v-for="c in cards"
        :key="c.id"
        class="wb-view__card"
        :class="[c.kind, { dragging: dragId === c.id }]"
        :style="pos[c.id] ? { left: pos[c.id].x + 'px', top: pos[c.id].y + 'px' } : { left: '16px', top: '16px' }"
        @mousedown="startDrag(c.id, $event)"
      >
        <span v-if="c.key" class="wb-view__card-key">{{ c.key }}</span>
        <span class="wb-view__card-name">{{ c.name }}</span>
      </div>
    </div>
  </div>
</template>

<script>
export default { name: 'WhiteboardView' };
</script>

<script setup>
// VIEW-03 — Whiteboard. Tasks as freely draggable cards on a board. Positions are
// saved per user (localStorage, keyed by project+sprint) as a v1; shared/persisted
// positions are a documented follow-up. Reads the same live Vuex task store.
import { ref, computed, reactive, onMounted, onBeforeUnmount, inject, watch } from 'vue';
import { useStore } from 'vuex';
import { taskListHelper } from '@/views/Projects/helper.js';

const props = defineProps({
    projectData: { type: Object, default: () => ({}) },
    sprints: { type: Array, default: () => [] },
});

const { getters } = useStore();
const { groupBy } = taskListHelper();
const selectedProject = inject('selectedProject', ref({}));

const boardEl = ref(null);
const CARD_W = 180;
const GAP = 16;
const ROW_H = 92;

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
const kindOf = (t) => { const ty = t?.status?.type || t?.statusType; return ty === 'close' ? 'is-done' : ty === 'inprogress' ? 'is-progress' : 'is-todo'; };
const cards = computed(() => activeTasks.value.map((t) => ({ id: String(t._id), key: t.TaskKey, name: t.TaskName || 'Untitled', kind: kindOf(t) })));

const storeKey = computed(() => `wb:${props.projectData?._id || 'p'}:${sprintId.value || 's'}`);
const pos = reactive({});
const perRow = () => Math.max(1, Math.floor(((boardEl.value && boardEl.value.clientWidth) || 900) / (CARD_W + GAP)));
function gridPos(i) { const n = perRow(); return { x: (i % n) * (CARD_W + GAP) + GAP, y: Math.floor(i / n) * ROW_H + GAP }; }
function loadPos() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(storeKey.value) || '{}') || {}; } catch (e) { saved = {}; }
    cards.value.forEach((c, i) => { pos[c.id] = saved[c.id] || pos[c.id] || gridPos(i); });
}
function savePos() { try { localStorage.setItem(storeKey.value, JSON.stringify(pos)); } catch (e) { /* noop */ } }
function autoArrange() { cards.value.forEach((c, i) => { pos[c.id] = gridPos(i); }); savePos(); }

let dragId = null; let offX = 0; let offY = 0;
const dragRef = ref(null);
function startDrag(id, e) {
    dragId = id; dragRef.value = id;
    const r = e.currentTarget.getBoundingClientRect();
    offX = e.clientX - r.left; offY = e.clientY - r.top;
    window.addEventListener('mousemove', onDrag);
    window.addEventListener('mouseup', endDrag);
    e.preventDefault();
}
function onDrag(e) {
    if (!dragId || !boardEl.value) return;
    const b = boardEl.value.getBoundingClientRect();
    pos[dragId] = {
        x: Math.max(0, e.clientX - b.left - offX + boardEl.value.scrollLeft),
        y: Math.max(0, e.clientY - b.top - offY + boardEl.value.scrollTop),
    };
}
function endDrag() {
    if (dragId) savePos();
    dragId = null; dragRef.value = null;
    window.removeEventListener('mousemove', onDrag);
    window.removeEventListener('mouseup', endDrag);
}

function ensureTasksLoaded() {
    if (tasks.value.length) return;
    const proj = (selectedProject.value && selectedProject.value._id) ? selectedProject.value : props.projectData;
    if (!proj || !proj._id || !Array.isArray(props.sprints) || !props.sprints.length) return;
    try { groupBy(0, true, proj, props.sprints, ref([]), false, 'list', false, true, () => {}); } catch (e) { /* noop */ }
}
onMounted(() => { ensureTasksLoaded(); loadPos(); });
watch(cards, () => loadPos());
watch(() => props.sprints, () => ensureTasksLoaded(), { deep: true });
onBeforeUnmount(() => { window.removeEventListener('mousemove', onDrag); window.removeEventListener('mouseup', endDrag); });
</script>

<style scoped>
.wb-view { display: flex; flex-direction: column; width: 100%; height: 100%; background: #fff; }
.wb-view__bar { display: flex; align-items: center; gap: 14px; padding: 8px 14px; border-bottom: 1px solid #eee; flex: 0 0 auto; }
.wb-view__title { font-size: 14px; font-weight: 700; color: #2b2f44; }
.wb-view__count { font-size: 12px; color: #888; }
.wb-view__btn { margin-left: auto; border: 1px solid #d8d8e0; background: #fff; color: #444; border-radius: 6px; padding: 5px 12px; font-size: 12px; cursor: pointer; }
.wb-view__btn:hover { background: #f2f3fb; }
.wb-view__board { position: relative; flex: 1 1 auto; min-height: 360px; overflow: auto; background:
    linear-gradient(#f4f5fa 1px, transparent 1px) 0 0 / 24px 24px,
    linear-gradient(90deg, #f4f5fa 1px, transparent 1px) 0 0 / 24px 24px, #fff; }
.wb-view__empty { position: absolute; top: 48px; left: 0; right: 0; text-align: center; color: #999; font-size: 14px; }
.wb-view__card { position: absolute; width: 180px; min-height: 64px; box-sizing: border-box; background: #fff; border: 1px solid #e0e2ee; border-left: 4px solid #8a93b5; border-radius: 8px; padding: 8px 10px; box-shadow: 0 1px 4px rgba(0,0,0,.08); cursor: grab; user-select: none; }
.wb-view__card.dragging { cursor: grabbing; box-shadow: 0 6px 18px rgba(0,0,0,.18); z-index: 5; }
.wb-view__card.is-progress { border-left-color: #2f6fed; }
.wb-view__card.is-done { border-left-color: #1c9b5e; }
.wb-view__card-key { display: block; font-size: 11px; font-weight: 600; color: #7b68ee; margin-bottom: 3px; }
.wb-view__card-name { font-size: 13px; color: #33384a; }
</style>
