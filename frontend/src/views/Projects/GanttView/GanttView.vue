<template>
  <div class="gantt-view">
    <div v-if="!hasProject" class="gantt-view__pick">{{ $t('Projects.gantt_select_project') }}</div>
    <template v-else>
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
        <span v-if="readOnly" class="gantt-view__ro">{{ $t('Projects.gantt_view_only') }}</span>
        <span class="gantt-view__count">
          {{ $t('Projects.gantt_scheduled_count', { n: scheduled.length }) }}
        </span>
      </div>

      <div
        v-if="unscheduled.length"
        class="gantt-view__nodates"
      >
        <span class="gantt-view__nodates-label">{{ $t('Projects.gantt_no_dates') }}</span>
        <ul class="gantt-view__nodates-list">
          <li
            v-for="t in unscheduled"
            :key="t._id"
            class="gantt-view__nodates-item"
            :draggable="!readOnly"
            @dragstart="onStackDrag($event, t)"
            :title="t.TaskName || t.TaskKey"
          >
            <span class="gantt-view__nodates-name">{{ t.TaskName || t.TaskKey }}</span>
            <button
              v-if="!readOnly"
              type="button"
              class="gantt-view__nodates-btn"
              @click="schedule(t)"
            >{{ $t('Projects.gantt_schedule') }}</button>
          </li>
        </ul>
      </div>

      <div
        v-if="collisionCount"
        class="gantt-view__hint"
        role="status"
      >{{ $t('Projects.gantt_collision') }}</div>

      <div class="gantt-view__main">
        <div v-if="loadError" class="gantt-view__msg">
          Couldn't load the Gantt module. Install the dependency and reload:
          <code>cd frontend &amp;&amp; npm install</code>
        </div>
        <template v-else>
          <div
            ref="ganttEl"
            class="gantt-view__chart"
            @dragover.prevent="onChartDragOver"
            @drop="onChartDrop"
          ></div>
          <div v-if="!scheduled.length && !loading" class="gantt-view__empty">
            {{ $t('Projects.gantt_empty') }}
          </div>
        </template>
      </div>
    </template>
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
const collisionCount = ref(0);

let gantt = null;
let ready = false;
let suppress = false;
let eventIds = [];
let todayMarker = null;

const hasProject = computed(() => Boolean(props.projectData && props.projectData._id));
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

const activeTasks = computed(() => tasks.value.filter((t) => t && [0, 2, undefined, null].includes(t.deletedStatusKey)));
const scheduled = computed(() => activeTasks.value.filter((t) => t.startDate && t.DueDate));
const unscheduled = computed(() => activeTasks.value.filter((t) => !(t.startDate && t.DueDate)));

const readOnly = computed(() =>
    checkPermission('task.task_due_date', selectedProject.value?.isGlobalPermission ?? props.projectData?.isGlobalPermission) !== true
);

const signature = computed(() =>
    JSON.stringify(scheduled.value.map((t) => [
        t._id, t.TaskName, t.startDate, t.DueDate, t.ParentTaskId || 0,
        t.status?.type || t.statusType || '',
        (t.relations || []).filter((r) => r.type === 'blocks').map((r) => r.taskId),
    ]))
);

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

function collisionsFrom(list) {
    const byId = new Map(list.map((t) => [String(t._id), t]));
    let n = 0;
    list.forEach((t) => {
        (t.relations || []).forEach((rel) => {
            if (rel.type !== 'blocks') return;
            const target = byId.get(String(rel.taskId));
            if (!target || !target.startDate || !t.DueDate) return;
            if (new Date(target.startDate).getTime() < new Date(t.DueDate).getTime()) n += 1;
        });
    });
    return n;
}

function collidingLinkIds() {
    const ids = new Set();
    const byId = new Map(scheduled.value.map((t) => [String(t._id), t]));
    scheduled.value.forEach((t) => {
        (t.relations || []).forEach((rel) => {
            if (rel.type !== 'blocks') return;
            const target = byId.get(String(rel.taskId));
            if (!target || !target.startDate || !t.DueDate) return;
            if (new Date(target.startDate).getTime() < new Date(t.DueDate).getTime()) {
                ids.add(`${t._id}_${rel.taskId}`);
            }
        });
    });
    return ids;
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
    data.forEach((d) => { if (d.parent && !ids.has(String(d.parent))) d.parent = 0; });

    const links = [];
    scheduled.value.forEach((t) => {
        (t.relations || []).forEach((rel) => {
            if (rel.type === 'blocks' && ids.has(String(t._id)) && ids.has(String(rel.taskId))) {
                links.push({ id: `${t._id}_${rel.taskId}`, source: String(t._id), target: String(rel.taskId), type: '0' });
            }
        });
    });
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
        collisionCount.value = collisionsFrom(scheduled.value);
    } finally {
        suppress = false;
    }
}

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
    }).then(() => {
        collisionCount.value = collisionsFrom(scheduled.value.map((row) => (
            String(row._id) === String(id)
                ? { ...row, startDate: g.start_date, DueDate: g.end_date }
                : row
        )));
    }).catch((e) => console.error('Gantt: updateDates failed', e));
}
function persistLinkAdd(id, link) {
    if (suppress) return;
    if (String(link.type) !== '0') {
        rollbackLink(id);
        return;
    }
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
function datesForSchedule(anchor) {
    const start = new Date(anchor || Date.now());
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { startDate: start, DueDate: end };
}
function schedule(task, anchor) {
    const dates = datesForSchedule(anchor);
    taskClass.updateDates({
        firebaseObj: dates,
        projectData: buildProjectData(),
        taskData: task,
        userData: buildUserData(),
    }).catch((e) => console.error('Gantt: schedule failed', e));
}
function onStackDrag(event, task) {
    if (readOnly.value) return;
    event.dataTransfer.setData('text/task-id', String(task._id));
    event.dataTransfer.effectAllowed = 'copyMove';
}
function onChartDragOver(event) {
    if (readOnly.value) return;
    event.dataTransfer.dropEffect = 'move';
}
function onChartDrop(event) {
    if (readOnly.value) return;
    event.preventDefault();
    const id = event.dataTransfer.getData('text/task-id');
    const task = unscheduled.value.find((row) => String(row._id) === String(id));
    if (!task) return;
    let anchor = new Date();
    try {
        if (gantt && typeof gantt.dateFromPos === 'function' && gantt.$task) {
            const rect = gantt.$task.getBoundingClientRect();
            const scrollX = (gantt.getScrollState && gantt.getScrollState().x) || 0;
            const pos = gantt.dateFromPos(event.clientX - rect.left + scrollX);
            if (pos) anchor = pos;
        }
    } catch (e) { /* today */ }
    schedule(task, anchor);
}

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

function ensureTasksLoaded() {
    if (!hasProject.value || tasks.value.length) return;
    const proj = (selectedProject.value && selectedProject.value._id) ? selectedProject.value : props.projectData;
    if (!proj || !proj._id || !Array.isArray(props.sprints) || !props.sprints.length) return;
    try {
        groupBy(0, true, proj, props.sprints, ref([]), false, 'list', false, true, () => {});
    } catch (e) {
        console.error('Gantt: task-load trigger failed', e);
    }
}

function applyKilnSkin() {
    if (!gantt) return;
    gantt.config.auto_scheduling = false;
    gantt.config.highlight_critical_path = false;
    gantt.config.drag_progress = false;
    gantt.config.fit_tasks = true;
    gantt.config.details_on_dblclick = false;
    gantt.config.drag_move = !readOnly.value;
    gantt.config.drag_resize = !readOnly.value;
    gantt.config.drag_links = !readOnly.value;
    gantt.config.readonly = readOnly.value;
    gantt.config.date_format = '%Y-%m-%d %H:%i';
    gantt.config.columns = [
        { name: 'text', label: 'Task', tree: true, width: 220, resize: true },
    ];
    gantt.templates.link_class = (link) => (collidingLinkIds().has(String(link.id)) ? 'gantt-link--collision' : '');
}

onMounted(async () => {
    if (!hasProject.value) {
        loading.value = false;
        return;
    }
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

    gantt = mod.gantt || mod.default || mod;

    await nextTick();
    if (!ganttEl.value || !gantt) { loading.value = false; return; }

    try {
        if (typeof gantt.plugins === 'function') {
            try { gantt.plugins({ marker: true, auto_scheduling: false, critical_path: false }); } catch (e) { /* gpl build */ }
        }
        applyKilnSkin();
        applyScales(zoom.value);
        gantt.init(ganttEl.value);

        eventIds.push(gantt.attachEvent('onBeforeLinkAdd', (id, link) => String(link.type) === '0'));
        eventIds.push(gantt.attachEvent('onAfterTaskDrag', (id) => persistDates(id)));
        eventIds.push(gantt.attachEvent('onAfterLinkAdd', (id, link) => persistLinkAdd(id, link)));
        eventIds.push(gantt.attachEvent('onAfterLinkDelete', (id, link) => persistLinkDelete(link)));

        ready = true;
        renderData();
        try {
            if (typeof gantt.addMarker === 'function') {
                todayMarker = gantt.addMarker({ start_date: new Date(), css: 'gantt-today-line', text: '' });
            }
        } catch (e) { /* today cell css fallback */ }
    } catch (e) {
        console.error('Gantt: init failed', e);
        loadError.value = true;
    }
    loading.value = false;

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
watch(hasProject, (ok) => { if (ok) ensureTasksLoaded(); });

watch(readOnly, (ro) => {
    if (!ready || !gantt) return;
    gantt.config.readonly = ro;
    gantt.config.drag_move = !ro;
    gantt.config.drag_resize = !ro;
    gantt.config.drag_links = !ro;
    gantt.render();
});

watch(() => props.sprints, () => ensureTasksLoaded(), { deep: true });

onBeforeUnmount(() => {
    try {
        if (gantt) {
            eventIds.forEach((id) => gantt.detachEvent(id));
            if (todayMarker != null && typeof gantt.deleteMarker === 'function') {
                try { gantt.deleteMarker(todayMarker); } catch (e) { /* ignore */ }
            }
            gantt.clearAll();
        }
    } catch (e) { /* ignore */ }
    eventIds = [];
    gantt = null;
    ready = false;
});
</script>

<style scoped>
.gantt-view {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    background: #f4ead8;
    color: #1b2f28;
}
.gantt-view__pick,
.gantt-view__empty,
.gantt-view__msg {
    padding: 28px 16px;
    text-align: center;
    color: #1b2f28;
    font-size: 14px;
}
.gantt-view__bar {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 8px 12px;
    border-bottom: 1px solid #d8cbb3;
    flex: 0 0 auto;
    background: #f4ead8;
}
.gantt-view__zoom {
    display: inline-flex;
    border: 1px solid #1b2f28;
    border-radius: 6px;
    overflow: hidden;
}
.gantt-view__zoom button {
    border: none;
    background: #f4ead8;
    color: #1b2f28;
    padding: 5px 14px;
    font-size: 13px;
    cursor: pointer;
}
.gantt-view__zoom button + button { border-left: 1px solid #1b2f28; }
.gantt-view__zoom button.active { background: #1b2f28; color: #f4ead8; }
.gantt-view__ro {
    font-size: 12px;
    color: #c45c26;
    background: #f4ead8;
    border: 1px solid #c45c26;
    border-radius: 4px;
    padding: 2px 8px;
}
.gantt-view__count { margin-left: auto; font-size: 12px; color: #1b2f28; }
.gantt-view__nodates {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 12px;
    border-bottom: 1px solid #d8cbb3;
    background: #f4ead8;
    min-height: 36px;
    overflow-x: auto;
}
.gantt-view__nodates-label {
    flex: 0 0 auto;
    font-size: 11px;
    letter-spacing: .04em;
    text-transform: uppercase;
    color: #1b2f28;
    font-weight: 700;
}
.gantt-view__nodates-list {
    display: flex;
    gap: 8px;
    list-style: none;
    margin: 0;
    padding: 0;
}
.gantt-view__nodates-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px;
    border: 1px solid #1b2f28;
    border-radius: 999px;
    background: #f4ead8;
    max-width: 220px;
}
.gantt-view__nodates-name {
    font-size: 12px;
    color: #1b2f28;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.gantt-view__nodates-btn {
    border: none;
    background: #c45c26;
    color: #f4ead8;
    border-radius: 999px;
    font-size: 11px;
    padding: 2px 8px;
    cursor: pointer;
    white-space: nowrap;
}
.gantt-view__hint {
    background: #f4ead8;
    color: #c45c26;
    border-bottom: 1px solid #c45c26;
    font-size: 12px;
    padding: 6px 12px;
}
.gantt-view__main { position: relative; flex: 1 1 auto; display: flex; min-height: 360px; }
.gantt-view__chart { flex: 1 1 auto; height: 100%; min-height: 360px; background: #fbf6ec; }
.gantt-view__msg code { background: #f4ead8; padding: 2px 6px; border-radius: 4px; pointer-events: auto; }
</style>

<style>
.gantt-view .gantt_grid,
.gantt-view .gantt_grid_scale,
.gantt-view .gantt_grid_data .gantt_row,
.gantt-view .gantt_grid_data .gantt_row.odd {
    background-color: #f4ead8 !important;
    color: #1b2f28;
    border-color: #d8cbb3 !important;
}
.gantt-view .gantt_task_line {
    background-color: #1b2f28 !important;
    border-color: #1b2f28 !important;
    border-radius: 4px;
}
.gantt-view .gantt_task_progress {
    background-color: rgba(244, 234, 216, 0.28) !important;
}
.gantt-view .gantt_task_content {
    color: #f4ead8 !important;
}
.gantt-view .gantt_task_link .gantt_line_wrapper div {
    background-color: #1b2f28;
}
.gantt-view .gantt_task_link .gantt_link_arrow {
    border-color: #1b2f28;
}
.gantt-view .gantt_task_link.gantt-link--collision .gantt_line_wrapper div {
    background-color: #c45c26 !important;
}
.gantt-view .gantt_task_link.gantt-link--collision .gantt_link_arrow {
    border-left-color: #c45c26 !important;
    border-right-color: #c45c26 !important;
    border-top-color: #c45c26 !important;
    border-bottom-color: #c45c26 !important;
}
.gantt-view .gantt_now,
.gantt-view .gantt_current,
.gantt-view .gantt-today-line {
    background-color: #c45c26 !important;
    width: 2px;
}
.gantt-view .gantt_task_cell.gantt_today,
.gantt-view .gantt_scale_cell.gantt_today {
    box-shadow: inset 2px 0 0 #c45c26;
}
</style>
