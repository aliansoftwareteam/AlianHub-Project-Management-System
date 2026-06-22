<template>
  <div class="map-view">
    <div class="map-view__bar">
      <span class="map-view__count">
        {{ placedTasks.length }} placed<template v-if="unplaced.length"> · {{ unplaced.length }} to place</template>
      </span>
      <span v-if="placingTask" class="map-view__hint">
        Click anywhere on the map to place <b>{{ placingTask.TaskName || placingTask.TaskKey }}</b>
        <button type="button" class="map-view__hint-x" @click="placingId = ''">cancel</button>
      </span>
      <button
        v-if="placedTasks.length"
        type="button"
        class="map-view__clear"
        @click="clearAll"
      >Clear all</button>
    </div>

    <div class="map-view__main">
      <div class="map-view__canvas" :class="{ 'is-placing': !!placingId }">
        <svg
          ref="svgEl"
          class="map-view__svg"
          :viewBox="`0 0 ${W} ${H}`"
          preserveAspectRatio="xMidYMid meet"
          @click="onMapClick"
        >
          <defs>
            <linearGradient id="mvOcean" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#eef4fb" />
              <stop offset="100%" stop-color="#dde9f6" />
            </linearGradient>
          </defs>

          <!-- ocean -->
          <rect x="0" y="0" :width="W" :height="H" fill="url(#mvOcean)" stroke="#c7d6e8" />

          <!-- graticule -->
          <g class="map-view__grid">
            <line
              v-for="ln in lngLines"
              :key="'lng' + ln.deg"
              :x1="ln.x" y1="0" :x2="ln.x" :y2="H"
              :class="{ 'is-prime': ln.deg === 0 }"
            />
            <line
              v-for="lt in latLines"
              :key="'lat' + lt.deg"
              x1="0" :y1="lt.y" :x2="W" :y2="lt.y"
              :class="{ 'is-equator': lt.deg === 0 }"
            />
          </g>

          <!-- degree labels -->
          <g class="map-view__labels">
            <text v-for="ln in lngLines" :key="'lngL' + ln.deg" :x="ln.x" :y="H - 4" text-anchor="middle">{{ lngLabel(ln.deg) }}</text>
            <text v-for="lt in latLines" :key="'latL' + lt.deg" x="4" :y="lt.y - 3">{{ latLabel(lt.deg) }}</text>
          </g>

          <!-- pins -->
          <g
            v-for="p in placedTasks"
            :key="p._id"
            class="map-view__pin"
            :class="{ 'is-selected': selectedId === String(p._id) }"
            :transform="`translate(${p.x}, ${p.y})`"
            @click.stop="selectMarker(p._id)"
          >
            <path
              class="map-view__pin-body"
              :fill="p.color"
              d="M0,0 C-9,-14 -7,-26 0,-26 C7,-26 9,-14 0,0 Z"
            />
            <circle class="map-view__pin-dot" cx="0" cy="-18" r="4.5" fill="#fff" />
            <title>{{ p.TaskName || p.TaskKey }} — {{ fmtLatLng(p.lat, p.lng) }}</title>
          </g>
        </svg>

        <div v-if="!activeTasks.length" class="map-view__empty">
          No tasks in this sprint yet.
        </div>
      </div>

      <aside class="map-view__side">
        <div v-if="selectedTask" class="map-view__card">
          <div class="map-view__card-head">
            <span class="map-view__dot" :style="{ background: statusColor(selectedTask) }"></span>
            <span class="map-view__card-name" :title="selectedTask.TaskName">{{ selectedTask.TaskName || selectedTask.TaskKey }}</span>
            <button type="button" class="map-view__card-x" @click="selectedId = ''">×</button>
          </div>
          <div class="map-view__card-meta">
            <span v-if="selectedTask.TaskKey" class="map-view__key">{{ selectedTask.TaskKey }}</span>
            <span class="map-view__coord">{{ fmtLatLng(placements[selectedId].lat, placements[selectedId].lng) }}</span>
          </div>
          <button type="button" class="map-view__remove" @click="removePlacement(selectedId)">Remove from map</button>
        </div>

        <h4 class="map-view__side-title">To place ({{ unplaced.length }})</h4>
        <ul class="map-view__list">
          <li
            v-for="t in unplaced"
            :key="t._id"
            class="map-view__item"
            :class="{ 'is-active': placingId === String(t._id) }"
          >
            <span class="map-view__dot" :style="{ background: statusColor(t) }"></span>
            <span class="map-view__item-name" :title="t.TaskName">{{ t.TaskName || t.TaskKey }}</span>
            <button type="button" class="map-view__place" @click="startPlacing(t._id)">
              {{ placingId === String(t._id) ? 'Placing…' : 'Place' }}
            </button>
          </li>
          <li v-if="!unplaced.length" class="map-view__all-placed">All tasks placed.</li>
        </ul>
      </aside>
    </div>
  </div>
</template>

<script>
export default { name: 'MapView' };
</script>

<script setup>
import { ref, computed, onMounted, watch, inject } from 'vue';
import { useStore } from 'vuex';
import { taskListHelper } from '@/views/Projects/helper.js';

const props = defineProps({
    projectData: { type: Object, default: () => ({}) },
    sprints: { type: Array, default: () => [] },
});

const { getters } = useStore();
const { groupBy } = taskListHelper();
const selectedProject = inject('selectedProject', ref({}));

// equirectangular world canvas (2:1)
const W = 1000;
const H = 500;

const svgEl = ref(null);
const placingId = ref('');
const selectedId = ref('');
// { [taskId]: { lat, lng } } — personal, per-browser (localStorage)
const placements = ref({});

/* ----------------------- data in: from the live Vuex store ----------------------- */
const sprintId = computed(() => props.sprints?.[0]?.id || props.sprints?.[0]?._id || '');

function pickTasks(map) {
    const pid = props.projectData?._id;
    const sid = sprintId.value;
    if (!pid || !sid || !map || !map[pid] || !map[pid][sid]) return null;
    const node = map[pid][sid];
    return Array.isArray(node.tasks) ? node.tasks : null;
}
const tasks = computed(() =>
    pickTasks(getters['projectData/tasks']) || pickTasks(getters['projectData/tableTasks']) || []
);
// active = not deleted (0 active, 2 archived, undefined legacy)
const activeTasks = computed(() => tasks.value.filter((t) => t && [0, 2, undefined, null].includes(t.deletedStatusKey)));

/* --------------------------------- projection ---------------------------------- */
function project(lat, lng) {
    return { x: ((Number(lng) + 180) / 360) * W, y: ((90 - Number(lat)) / 180) * H };
}
function unproject(x, y) {
    return { lng: (x / W) * 360 - 180, lat: 90 - (y / H) * 180 };
}

/* ----------------------------------- status ------------------------------------ */
function statusColor(task) {
    const type = task?.status?.type || task?.statusType;
    if (type === 'close') return '#27ae60';
    if (type === 'inprogress') return '#f1a33a';
    return '#9aa3b2';
}

/* ------------------------------- placed / unplaced ------------------------------ */
const placedTasks = computed(() =>
    activeTasks.value
        .filter((t) => placements.value[String(t._id)])
        .map((t) => {
            const loc = placements.value[String(t._id)];
            const pt = project(loc.lat, loc.lng);
            return { ...t, lat: loc.lat, lng: loc.lng, x: pt.x, y: pt.y, color: statusColor(t) };
        })
);
const unplaced = computed(() => activeTasks.value.filter((t) => !placements.value[String(t._id)]));

const placingTask = computed(() => activeTasks.value.find((t) => String(t._id) === placingId.value) || null);
const selectedTask = computed(() => {
    if (!selectedId.value || !placements.value[selectedId.value]) return null;
    return activeTasks.value.find((t) => String(t._id) === selectedId.value) || null;
});

/* ----------------------------------- labels ------------------------------------ */
const lngLines = computed(() => {
    const out = [];
    for (let d = -180; d <= 180; d += 30) out.push({ deg: d, x: project(0, d).x });
    return out;
});
const latLines = computed(() => {
    const out = [];
    for (let d = -90; d <= 90; d += 30) out.push({ deg: d, y: project(d, 0).y });
    return out;
});
function lngLabel(d) { return d === 0 ? '0°' : `${Math.abs(d)}°${d > 0 ? 'E' : 'W'}`; }
function latLabel(d) { return d === 0 ? '0°' : `${Math.abs(d)}°${d > 0 ? 'N' : 'S'}`; }
function fmtLatLng(lat, lng) {
    const la = Number(lat); const ln = Number(lng);
    return `${Math.abs(la).toFixed(2)}°${la >= 0 ? 'N' : 'S'}, ${Math.abs(ln).toFixed(2)}°${ln >= 0 ? 'E' : 'W'}`;
}

/* ----------------------------------- actions ----------------------------------- */
function startPlacing(id) {
    placingId.value = placingId.value === String(id) ? '' : String(id);
    selectedId.value = '';
}
function selectMarker(id) {
    selectedId.value = selectedId.value === String(id) ? '' : String(id);
}
function onMapClick(e) {
    if (!placingId.value || !svgEl.value) { selectedId.value = ''; return; }
    const rect = svgEl.value.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    // the svg is letterboxed (xMidYMid meet) into a 2:1 box, but the canvas itself is 2:1,
    // so the rendered area matches the viewBox aspect — straight ratio mapping is correct.
    const sx = ((e.clientX - rect.left) / rect.width) * W;
    const sy = ((e.clientY - rect.top) / rect.height) * H;
    const { lat, lng } = unproject(sx, sy);
    placements.value = {
        ...placements.value,
        [placingId.value]: { lat: Math.max(-90, Math.min(90, lat)), lng: Math.max(-180, Math.min(180, lng)) },
    };
    selectedId.value = placingId.value;
    placingId.value = '';
}
function removePlacement(id) {
    const next = { ...placements.value };
    delete next[String(id)];
    placements.value = next;
    if (selectedId.value === String(id)) selectedId.value = '';
}
function clearAll() {
    placements.value = {};
    selectedId.value = '';
    placingId.value = '';
}

/* --------------------------------- persistence --------------------------------- */
function storeKey() {
    return `map:${props.projectData?._id || ''}:${sprintId.value || ''}`;
}
function loadPlacements() {
    try {
        const raw = localStorage.getItem(storeKey());
        placements.value = raw ? (JSON.parse(raw) || {}) : {};
    } catch (e) { placements.value = {}; }
}
watch(placements, (val) => {
    try { localStorage.setItem(storeKey(), JSON.stringify(val || {})); } catch (e) { /* quota / private mode */ }
}, { deep: true });
watch(sprintId, () => { selectedId.value = ''; placingId.value = ''; loadPlacements(); });

/* ----------------------------------- lifecycle --------------------------------- */
// Mirror the other views: make sure the project's task list is in the store on a
// direct load into this tab (otherwise the store is empty and nothing plots).
function ensureTasksLoaded() {
    if (tasks.value.length) return;
    const proj = (selectedProject.value && selectedProject.value._id) ? selectedProject.value : props.projectData;
    if (!proj || !proj._id || !Array.isArray(props.sprints) || !props.sprints.length) return;
    try {
        groupBy(0, true, proj, props.sprints, ref([]), false, 'list', false, true, () => {});
    } catch (e) {
        console.error('Map: task-load trigger failed', e);
    }
}

onMounted(() => {
    loadPlacements();
    ensureTasksLoaded();
});
watch(() => props.sprints, () => ensureTasksLoaded(), { deep: true });
</script>

<style scoped>
.map-view { display: flex; flex-direction: column; width: 100%; height: 100%; background: #fff; }
.map-view__bar { display: flex; align-items: center; gap: 14px; padding: 8px 12px; border-bottom: 1px solid #eee; flex: 0 0 auto; }
.map-view__count { font-size: 12px; color: #888; }
.map-view__hint { font-size: 12px; color: #2F3990; background: #eef0ff; border: 1px solid #cdd2f5; border-radius: 4px; padding: 2px 8px; display: inline-flex; align-items: center; gap: 8px; }
.map-view__hint-x { border: none; background: transparent; color: #2F3990; text-decoration: underline; cursor: pointer; font-size: 12px; padding: 0; }
.map-view__clear { margin-left: auto; border: 1px solid #d8d8e0; background: #fff; color: #666; border-radius: 5px; font-size: 12px; padding: 3px 10px; cursor: pointer; }
.map-view__clear:hover { border-color: #c0392b; color: #c0392b; }

.map-view__main { position: relative; flex: 1 1 auto; display: flex; min-height: 380px; }
.map-view__canvas { position: relative; flex: 1 1 auto; min-width: 0; padding: 12px; overflow: auto; }
.map-view__canvas.is-placing { cursor: crosshair; }
.map-view__svg { display: block; width: 100%; height: auto; max-height: 100%; border-radius: 6px; }

.map-view__grid line { stroke: #c2d2e6; stroke-width: 1; }
.map-view__grid line.is-prime,
.map-view__grid line.is-equator { stroke: #9bb4d4; stroke-width: 1.4; }
.map-view__labels text { fill: #8190a6; font-size: 11px; }

.map-view__pin { cursor: pointer; }
.map-view__pin-body { stroke: #fff; stroke-width: 1.5; transition: transform .1s ease; }
.map-view__pin.is-selected .map-view__pin-body { stroke: #2F3990; stroke-width: 2.5; }
.map-view__pin:hover .map-view__pin-body { transform: scale(1.12); }

.map-view__empty { position: absolute; top: 50%; left: 0; right: 0; transform: translateY(-50%); text-align: center; color: #999; font-size: 14px; pointer-events: none; }

.map-view__side { width: 230px; flex: 0 0 auto; border-left: 1px solid #eee; padding: 10px; overflow: auto; background: #fafafe; }
.map-view__card { border: 1px solid #cdd2f5; background: #fff; border-radius: 6px; padding: 8px; margin-bottom: 12px; }
.map-view__card-head { display: flex; align-items: center; gap: 6px; }
.map-view__card-name { flex: 1 1 auto; font-size: 13px; font-weight: 600; color: #333; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.map-view__card-x { border: none; background: transparent; color: #999; font-size: 16px; line-height: 1; cursor: pointer; padding: 0 2px; }
.map-view__card-meta { display: flex; align-items: center; gap: 8px; margin: 6px 0; flex-wrap: wrap; }
.map-view__key { font-size: 11px; color: #2F3990; background: #eef0ff; border-radius: 3px; padding: 1px 6px; }
.map-view__coord { font-size: 11px; color: #777; }
.map-view__remove { width: 100%; border: 1px solid #e3b4ae; background: #fff; color: #c0392b; border-radius: 5px; font-size: 12px; padding: 4px; cursor: pointer; }
.map-view__remove:hover { background: #c0392b; color: #fff; }

.map-view__side-title { font-size: 12px; text-transform: uppercase; color: #999; margin: 0 0 8px; letter-spacing: .04em; }
.map-view__list { list-style: none; margin: 0; padding: 0; }
.map-view__item { display: flex; align-items: center; gap: 6px; padding: 6px 0; border-bottom: 1px dashed #eee; }
.map-view__item.is-active { background: #f3f5ff; }
.map-view__dot { width: 9px; height: 9px; border-radius: 50%; flex: 0 0 auto; }
.map-view__item-name { flex: 1 1 auto; font-size: 13px; color: #444; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.map-view__place { border: 1px solid #2F3990; color: #2F3990; background: #fff; border-radius: 5px; font-size: 12px; padding: 3px 8px; cursor: pointer; white-space: nowrap; }
.map-view__place:hover { background: #2F3990; color: #fff; }
.map-view__all-placed { font-size: 12px; color: #aaa; padding: 8px 0; }
</style>
