<template>
  <div class="gantt-view">
    <div class="gantt-view__bar">
      <div class="gantt-view__zoom">
        <button
          v-for="z in zoomLevels"
          :key="z"
          type="button"
          :class="{ active: zoom === z }"
          @click="setZoom(z)"
        >{{ z }}</button>
      </div>
      <span v-if="readOnly" class="gantt-view__ro">View only</span>
      <span class="gantt-view__count">
        {{ scheduled.length }} scheduled<template v-if="unscheduled.length"> · {{ unscheduled.length }} unscheduled</template>
      </span>
    </div>

    <div class="gantt-view__main">
      <div v-if="loadError" class="gantt-view__msg">
        Couldn't load the Gantt module. Install the dependency and reload:
        <code>cd frontend &amp;&amp; npm install</code>
      </div>
      <template v-else>
        <div ref="ganttEl" class="gantt-view__chart"></div>
        <div v-if="!scheduled.length && !loading" class="gantt-view__empty">
          No scheduled tasks yet — give a task a start &amp; due date (or use the Unscheduled tray) to see it on the timeline.
        </div>
      </template>

      <aside v-if="unscheduled.length" class="gantt-view__tray">
        <h4 class="gantt-view__tray-title">Unscheduled ({{ unscheduled.length }})</h4>
        <ul class="gantt-view__tray-list">
          <li v-for="t in unscheduled" :key="t._id" class="gantt-view__tray-item">
            <span class="gantt-view__tray-name" :title="t.TaskName">{{ t.TaskName || t.TaskKey }}</span>
            <button v-if="!readOnly" type="button" class="gantt-view__tray-btn" @click="schedule(t)">Schedule</button>
          </li>
        </ul>
      </aside>
    </div>
  </div>
</template>

<script>
export default { name: 'GanttView' };
</script>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, inject, nextTick } from 'vue';
import { useStore } from 'vuex';
import { useCustomComposable } from '@/composable';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import taskClass from '@/utils/TaskOperations';
import { taskListHelper } from '@/views/Projects/helper.js';

const props = defineProps({
    projectData: { type: Object, default: () => ({}) },
    sprints: { type: Array, default: () => [] },
});

const { getters } = useStore();
const { checkPermission } = useCustomComposable();
const { groupBy } = taskListHelper();
const selectedProject = inject('selectedProject', ref({}));

const ganttEl = ref(null);
const loadError = ref(false);
const loading = ref(true);
const milestones = ref([]);
const zoomLevels = ['Day', 'Week', 'Month'];
const zoom = ref('Week');

let gantt = null;     // dhtmlx instance (lazy-loaded)
let ready = false;    // init complete
let suppress = false; // guard: programmatic re-renders must not fire write handlers
let eventIds = [];

/* ----------------------- data in: from the live Vuex store ----------------------- */
// Same task source the List/Table views use, so socket-driven updates flow in for free.
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
const scheduled = computed(() => activeTasks.value.filter((t) => t.startDate && t.DueDate));
const unscheduled = computed(() => activeTasks.value.filter((t) => !(t.startDate && t.DueDate)));

const readOnly = computed(() =>
    checkPermission('task.task_due_date', selectedProject.value?.isGlobalPermission ?? props.projectData?.isGlobalPermission) !== true
);

// Re-render only when something the chart actually shows has changed.
const signature = computed(() =>
    JSON.stringify(scheduled.value.map((t) => [
        t._id, t.TaskName, t.startDate, t.DueDate, t.ParentTaskId || 0,
        t.status?.type || t.statusType || '',
        (t.relations || []).filter((r) => r.type === 'blocks').map((r) => r.taskId),
    ]))
);

/* ----------------------------------- helpers ----------------------------------- */
function progressOf(task) {
    const type = task?.status?.type || task?.statusType;
    if (type === 'close') return 1;
    if (type === 'inprogress') return 0.5;
    return 0;
}
function findTask(id) { return activeTasks.value.find((t) => String(t._id) === String(id)); }
function buildProjectData() {
    const p = props.projectData || {};
    return { _id: p._id, ProjectName: p.ProjectName, CompanyId: p.CompanyId };
}
function buildUserData() {
    const uid = localStorage.getItem('userId');
    const me = (getters['users/users'] || []).find((u) => String(u._id) === String(uid)) || {};
    return { Employee_Name: me.Employee_Name || '', id: uid, companyOwnerId: getters['settings/companyOwnerDetail']?.userId || '' };
}

function toGanttData() {
    const data = scheduled.value.map((t) => ({
        id: String(t._id),
        text: t.TaskName || t.TaskKey || 'Untitled',
        start_date: new Date(t.startDate),
        end_date: new Date(t.DueDate),
        parent: (t.ParentTaskId && String(t.ParentTaskId)) || 0,
        progress: progressOf(t),
        open: true,
    }));
    const ids = new Set(data.map((d) => d.id));
    // drop parent refs pointing outside the visible set (else dhtmlx throws)
    data.forEach((d) => { if (d.parent && !ids.has(String(d.parent))) d.parent = 0; });

    // dependency arrows: only emit from the 'blocks' side (relations are stored
    // bidirectionally, so this avoids duplicate links). 'blocks' => finish-to-start ('0').
    const links = [];
    scheduled.value.forEach((t) => {
        (t.relations || []).forEach((rel) => {
            if (rel.type === 'blocks' && ids.has(String(t._id)) && ids.has(String(rel.taskId))) {
                links.push({ id: `${t._id}_${rel.taskId}`, source: String(t._id), target: String(rel.taskId), type: '0' });
            }
        });
    });
    // Project milestones as read-only diamond markers.
    (milestones.value || []).forEach((m) => {
        if (m && m.date) {
            data.push({
                id: `ms_${m._id}`,
                text: m.milestoneName || 'Milestone',
                start_date: new Date(m.date),
                type: (gantt && gantt.config && gantt.config.types ? gantt.config.types.milestone : 'milestone'),
                readonly: true,
                parent: 0,
            });
        }
    });
    return { data, links };
}

function renderData() {
    if (!ready || !gantt) return;
    suppress = true;
    try {
        gantt.clearAll();
        gantt.parse(toGanttData());
    } finally {
        suppress = false;
    }
}

/* ------------------------------------ writes ------------------------------------ */
function persistDates(id) {
    if (suppress) return;
    const g = gantt.getTask(id);
    const task = findTask(id);
    if (!g || !task) return;
    taskClass.updateDates({
        firebaseObj: { startDate: g.start_date, DueDate: g.end_date },
        projectData: buildProjectData(),
        taskData: task,
        userData: buildUserData(),
    }).catch((e) => console.error('Gantt: updateDates failed', e));
}
function persistLinkAdd(id, link) {
    if (suppress) return;
    apiRequest('post', '/api/v2/tasks/relations', {
        action: 'add', taskId: link.source, relatedTaskId: link.target, type: 'blocks', userData: buildUserData(),
    }).then((res) => {
        if (!res?.data?.status) rollbackLink(id);
    }).catch((e) => {
        console.error('Gantt: link add failed', e);
        rollbackLink(id);
    });
}
function rollbackLink(id) {
    suppress = true;
    try { gantt.deleteLink(id); } catch (e) { /* ignore */ } finally { suppress = false; }
}
function persistLinkDelete(link) {
    if (suppress) return;
    apiRequest('post', '/api/v2/tasks/relations', {
        action: 'remove', taskId: link.source, relatedTaskId: link.target, userData: buildUserData(),
    }).catch((e) => console.error('Gantt: link remove failed', e));
}
function schedule(task) {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setDate(end.getDate() + 1);
    taskClass.updateDates({
        firebaseObj: { startDate: start, DueDate: end },
        projectData: buildProjectData(),
        taskData: task,
        userData: buildUserData(),
    }).catch((e) => console.error('Gantt: schedule failed', e));
}

/* ------------------------------------- zoom ------------------------------------- */
function applyScales(level) {
    if (!gantt) return;
    gantt.config.scale_height = 50;
    if (level === 'Day') {
        gantt.config.scales = [
            { unit: 'day', step: 1, format: '%d %M' },
            { unit: 'hour', step: 6, format: '%H:%i' },
        ];
    } else if (level === 'Month') {
        gantt.config.scales = [
            { unit: 'month', step: 1, format: '%F %Y' },
            { unit: 'week', step: 1, format: 'W%W' },
        ];
    } else {
        gantt.config.scales = [
            { unit: 'week', step: 1, format: 'Week #%W' },
            { unit: 'day', step: 1, format: '%D' },
        ];
    }
}
function setZoom(level) {
    zoom.value = level;
    applyScales(level);
    if (ready && gantt) gantt.render();
}

/* ----------------------------------- lifecycle ---------------------------------- */
// Ensure the project's task list is in the store. Other views (List/Table/Board) trigger
// this load via taskListHelper on mount; Gantt must too — otherwise a direct reload INTO
// the Gantt tab finds an empty store and renders nothing (it only worked when another view
// had already populated it). Mirrors ListView's onMounted loader (state.tasks via Mongo).
function ensureTasksLoaded() {
    if (tasks.value.length) return; // already loaded (e.g. arrived here from another view)
    const proj = (selectedProject.value && selectedProject.value._id) ? selectedProject.value : props.projectData;
    if (!proj || !proj._id || !Array.isArray(props.sprints) || !props.sprints.length) return;
    try {
        groupBy(0, true, proj, props.sprints, ref([]), false, 'list', false, true, () => {});
    } catch (e) {
        console.error('Gantt: task-load trigger failed', e);
    }
}

onMounted(async () => {
    ensureTasksLoaded();
    let mod;
    try {
        mod = await import(/* webpackChunkName: "dhtmlx-gantt" */ 'dhtmlx-gantt');
    } catch (e) {
        console.error('Gantt: failed to load dhtmlx-gantt', e);
        loadError.value = true;
        loading.value = false;
        return;
    }
    try { await import(/* webpackChunkName: "dhtmlx-gantt-css" */ 'dhtmlx-gantt/codebase/dhtmlxgantt.css'); } catch (e) { /* styling only */ }

    // Use the dhtmlx singleton (fully initialised on import). We deliberately do NOT
    // call getGanttInstance()/destructor(): re-initialising a destructed instance throws
    // "Cannot read properties of undefined (reading 'tasksStore')" when the Gantt tab is
    // reopened. We re-init the singleton each mount, detaching handlers + clearing on unmount.
    gantt = mod.gantt || mod.default || mod;

    await nextTick();
    if (!ganttEl.value || !gantt) { loading.value = false; return; }

    try {
        gantt.config.date_format = '%Y-%m-%d %H:%i';
        gantt.config.readonly = readOnly.value;
        gantt.config.drag_move = !readOnly.value;
        gantt.config.drag_resize = !readOnly.value;
        gantt.config.drag_links = !readOnly.value;
        gantt.config.drag_progress = false;
        gantt.config.fit_tasks = true;
        gantt.config.columns = [
            { name: 'text', label: 'Task', tree: true, width: 220, resize: true },
            { name: 'start_date', label: 'Start', align: 'center', width: 90 },
            { name: 'duration', label: 'Days', align: 'center', width: 54 },
        ];
        applyScales(zoom.value);

        gantt.init(ganttEl.value);

        eventIds.push(gantt.attachEvent('onAfterTaskDrag', (id) => persistDates(id)));
        eventIds.push(gantt.attachEvent('onAfterLinkAdd', (id, link) => persistLinkAdd(id, link)));
        eventIds.push(gantt.attachEvent('onAfterLinkDelete', (id, link) => persistLinkDelete(link)));

        ready = true;
        renderData();
    } catch (e) {
        console.error('Gantt: init failed', e);
        loadError.value = true;
    }
    loading.value = false;

    // Milestones as read-only diamond markers — best-effort; re-render when they arrive.
    try {
        const pid = props.projectData && props.projectData._id;
        if (pid) {
            const res = await apiRequest('get', `${env.MILESTONE_PROJECT}/${pid}`);
            const list = Array.isArray(res && res.data) ? res.data : ((res && res.data && Array.isArray(res.data.data)) ? res.data.data : []);
            milestones.value = list
                .map((m) => ({ _id: m._id, milestoneName: m.milestoneName, date: [m.dueDate, m.endDate, m.startDate].find((d) => d && d !== 0) }))
                .filter((m) => m.date);
            renderData();
        }
    } catch (e) { /* milestones optional */ }
});

watch(signature, () => { if (ready && !suppress) renderData(); });

watch(readOnly, (ro) => {
    if (!ready || !gantt) return;
    gantt.config.readonly = ro;
    gantt.config.drag_move = !ro;
    gantt.config.drag_resize = !ro;
    gantt.config.drag_links = !ro;
    gantt.render();
});

// Sprints can arrive after mount on a fresh reload — trigger the load once they're present.
watch(() => props.sprints, () => ensureTasksLoaded(), { deep: true });

onBeforeUnmount(() => {
    try {
        if (gantt) {
            eventIds.forEach((id) => gantt.detachEvent(id));
            gantt.clearAll();
            // Intentionally NOT calling gantt.destructor() — destructing the shared
            // singleton breaks re-init when the Gantt tab is reopened (tasksStore undefined).
        }
    } catch (e) { /* ignore */ }
    eventIds = [];
    gantt = null;
    ready = false;
});
</script>

<style scoped>
.gantt-view { display: flex; flex-direction: column; width: 100%; height: 100%; background: #fff; }
.gantt-view__bar { display: flex; align-items: center; gap: 14px; padding: 8px 12px; border-bottom: 1px solid #eee; flex: 0 0 auto; }
.gantt-view__zoom { display: inline-flex; border: 1px solid #d8d8e0; border-radius: 6px; overflow: hidden; }
.gantt-view__zoom button { border: none; background: #fff; color: #555; padding: 5px 14px; font-size: 13px; cursor: pointer; }
.gantt-view__zoom button + button { border-left: 1px solid #d8d8e0; }
.gantt-view__zoom button.active { background: #2F3990; color: #fff; }
.gantt-view__ro { font-size: 12px; color: #b06a00; background: #fff5e6; border: 1px solid #ffd591; border-radius: 4px; padding: 2px 8px; }
.gantt-view__count { margin-left: auto; font-size: 12px; color: #888; }
.gantt-view__main { position: relative; flex: 1 1 auto; display: flex; min-height: 360px; }
.gantt-view__chart { flex: 1 1 auto; height: 100%; min-height: 360px; }
.gantt-view__empty,
.gantt-view__msg { position: absolute; top: 48px; left: 0; right: 0; text-align: center; color: #999; font-size: 14px; padding: 20px; pointer-events: none; }
.gantt-view__msg code { background: #f3f3f7; padding: 2px 6px; border-radius: 4px; pointer-events: auto; }
.gantt-view__tray { width: 210px; flex: 0 0 auto; border-left: 1px solid #eee; padding: 10px; overflow: auto; background: #fafafe; }
.gantt-view__tray-title { font-size: 12px; text-transform: uppercase; color: #999; margin: 0 0 8px; letter-spacing: .04em; }
.gantt-view__tray-list { list-style: none; margin: 0; padding: 0; }
.gantt-view__tray-item { display: flex; align-items: center; gap: 6px; padding: 6px 0; border-bottom: 1px dashed #eee; }
.gantt-view__tray-name { flex: 1 1 auto; font-size: 13px; color: #444; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gantt-view__tray-btn { border: 1px solid #2F3990; color: #2F3990; background: #fff; border-radius: 5px; font-size: 12px; padding: 3px 8px; cursor: pointer; white-space: nowrap; }
.gantt-view__tray-btn:hover { background: #2F3990; color: #fff; }
</style>
