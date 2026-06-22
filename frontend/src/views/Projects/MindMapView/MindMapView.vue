<template>
  <div class="mm-view">
    <div class="mm-view__bar">
      <span class="mm-view__title">Mind Map</span>
      <span class="mm-view__count">{{ nodeCount }} nodes</span>
    </div>
    <div class="mm-view__main">
      <div v-if="!hasTasks" class="mm-view__empty">No tasks yet — add tasks to see the project mind map.</div>
      <div v-else class="mm-view__scroll">
        <svg :width="dims.w" :height="dims.h" class="mm-view__svg">
          <path v-for="(e, i) in edges" :key="'e' + i" :d="edgePath(e)" class="mm-view__edge" />
          <g v-for="n in nodes" :key="n.id" :transform="`translate(${n.x}, ${n.y})`" class="mm-view__node" :class="n.kind">
            <rect :width="NODE_W" :height="NODE_H" rx="7" />
            <text :x="10" :y="NODE_H / 2 + 4">{{ trim(n.name) }}</text>
          </g>
        </svg>
      </div>
    </div>
  </div>
</template>

<script>
export default { name: 'MindMapView' };
</script>

<script setup>
// VIEW-02 — read-only Mind Map. Renders the project → parent-task → subtask
// hierarchy as an SVG node tree. Lightweight (no external lib); reads the same
// live Vuex task store the other views use.
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

const NODE_W = 190;
const NODE_H = 34;
const COL_W = 250;
const ROW_H = 46;

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
const hasTasks = computed(() => activeTasks.value.length > 0);

const kindOf = (t) => {
    const type = t?.status?.type || t?.statusType;
    if (type === 'close') return 'is-done';
    if (type === 'inprogress') return 'is-progress';
    return 'is-todo';
};

// Build root → parent tasks → subtasks, then a bottom-up tidy layout.
const layout = computed(() => {
    const list = activeTasks.value;
    const parents = list.filter((t) => !t.ParentTaskId);
    const childrenOf = (pid) => list.filter((t) => t.ParentTaskId && String(t.ParentTaskId) === String(pid));
    const root = {
        id: 'root', name: props.projectData?.ProjectName || 'Project', kind: 'is-root',
        children: parents.map((p) => ({
            id: String(p._id), name: p.TaskName || p.TaskKey || 'Task', kind: kindOf(p),
            children: childrenOf(p._id).map((c) => ({ id: String(c._id), name: c.TaskName || c.TaskKey || 'Task', kind: kindOf(c), children: [] })),
        })),
    };
    let leaf = 0;
    let maxDepth = 0;
    const place = (node, depth) => {
        node.x = depth * COL_W;
        maxDepth = Math.max(maxDepth, depth);
        if (node.children.length) {
            node.children.forEach((c) => place(c, depth + 1));
            node.y = (node.children[0].y + node.children[node.children.length - 1].y) / 2;
        } else {
            node.y = leaf * ROW_H;
            leaf += 1;
        }
    };
    place(root, 0);
    const nodes = [];
    const edges = [];
    const walk = (node) => {
        nodes.push({ id: node.id, name: node.name, x: node.x, y: node.y, kind: node.kind });
        node.children.forEach((c) => {
            edges.push({ x1: node.x + NODE_W, y1: node.y + NODE_H / 2, x2: c.x, y2: c.y + NODE_H / 2 });
            walk(c);
        });
    };
    walk(root);
    return { nodes, edges, w: (maxDepth + 1) * COL_W + 40, h: Math.max(leaf, 1) * ROW_H + 20 };
});

const nodes = computed(() => layout.value.nodes);
const edges = computed(() => layout.value.edges);
const dims = computed(() => ({ w: layout.value.w, h: layout.value.h }));
const nodeCount = computed(() => nodes.value.length);

const edgePath = (e) => {
    const mx = (e.x1 + e.x2) / 2;
    return `M ${e.x1} ${e.y1} C ${mx} ${e.y1}, ${mx} ${e.y2}, ${e.x2} ${e.y2}`;
};
const trim = (s) => { const str = String(s || ''); return str.length > 24 ? `${str.slice(0, 23)}…` : str; };

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
.mm-view { display: flex; flex-direction: column; width: 100%; height: 100%; background: #fff; }
.mm-view__bar { display: flex; align-items: center; gap: 14px; padding: 8px 14px; border-bottom: 1px solid #eee; flex: 0 0 auto; }
.mm-view__title { font-size: 14px; font-weight: 700; color: #2b2f44; }
.mm-view__count { margin-left: auto; font-size: 12px; color: #888; }
.mm-view__main { position: relative; flex: 1 1 auto; min-height: 360px; overflow: hidden; }
.mm-view__empty { position: absolute; top: 48px; left: 0; right: 0; text-align: center; color: #999; font-size: 14px; padding: 20px; }
.mm-view__scroll { width: 100%; height: 100%; overflow: auto; padding: 16px; }
.mm-view__edge { fill: none; stroke: #cfd4e6; stroke-width: 1.6; }
.mm-view__node rect { fill: #fff; stroke: #8a93b5; stroke-width: 1.4; }
.mm-view__node text { font-size: 12px; fill: #33384a; }
.mm-view__node.is-root rect { fill: #2f3a8f; stroke: #2f3a8f; }
.mm-view__node.is-root text { fill: #fff; font-weight: 700; }
.mm-view__node.is-progress rect { stroke: #2f6fed; }
.mm-view__node.is-done rect { stroke: #1c9b5e; }
.mm-view__node.is-done text { fill: #1c7a43; }
</style>
