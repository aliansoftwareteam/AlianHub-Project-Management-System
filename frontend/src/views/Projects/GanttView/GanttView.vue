<template>
    <div class="ah-page gv">
        <div v-if="isMobile" class="gv__mobile">
            <div class="ah-empty gv__mobile-card">
                <div class="gv__mobile-title">{{ $t('ViewsV2.desktop_only_title') }}</div>
                <p class="gv__mobile-text">{{ $t('ViewsV2.desktop_only_gantt') }}</p>
            </div>
        </div>

        <template v-else>
            <div class="gv__bar">
                <div class="ah-tabs gv__zoom">
                    <button
                        v-for="z in zoomLevels"
                        :key="z.key"
                        type="button"
                        class="ah-tab"
                        :class="{ 'is-on': zoom === z.key }"
                        @click="setZoom(z.key)"
                    >{{ z.label }}</button>
                </div>
                <button
                    type="button"
                    class="ah-btn ah-btn--sm gv__toggle"
                    :class="showCritical ? 'ah-btn--outline' : 'ah-btn--secondary'"
                    :aria-pressed="showCritical"
                    @click="toggleCritical"
                >{{ $t('ViewsV2.critical_path') }}</button>
                <button
                    type="button"
                    class="ah-btn ah-btn--sm gv__toggle"
                    :class="showBaseline ? 'ah-btn--outline' : 'ah-btn--secondary'"
                    :aria-pressed="showBaseline"
                    @click="toggleBaseline"
                >{{ $t('ViewsV2.baseline') }}</button>
                <span v-if="readOnly" class="ah-chip ah-chip--warn">{{ $t('ViewsV2.view_only') }}</span>
                <div class="ah-toolbar__spacer"></div>
                <span class="ah-mono gv__count">
                    {{ $t('ViewsV2.scheduled_count', { n: scheduled.length }) }}
                    <template v-if="unscheduled.length"> · {{ $t('ViewsV2.unscheduled_count', { n: unscheduled.length }) }}</template>
                </span>
                <button type="button" class="ah-btn ah-btn--outline ah-btn--sm" @click="replanOpen = !replanOpen">
                    <span class="gv__spark">✦</span> {{ $t('ViewsV2.replan') }}
                </button>
            </div>

            <div class="gv__main">
                <div v-if="loadError" class="gv__msg ah-empty">
                    {{ $t('ViewsV2.gantt_module_missing') }}
                    <code>cd frontend &amp;&amp; npm install</code>
                </div>
                <template v-else>
                    <div ref="ganttEl" class="gv__chart"></div>
                    <div v-if="!scheduled.length && !loading" class="gv__empty ah-empty">
                        {{ $t('ViewsV2.gantt_empty') }}
                    </div>
                </template>

                <aside v-if="unscheduled.length" class="gv__tray ah-scroll">
                    <div class="gv__tray-head">
                        <span class="ah-label">{{ $t('ViewsV2.unscheduled') }}</span>
                        <span class="ah-mono gv__tray-count">{{ unscheduled.length }}</span>
                    </div>
                    <div v-for="t in unscheduled" :key="t._id" class="gv__tray-item" @click="open(t)">
                        <span class="gv__tray-name" :title="t.TaskName">{{ t.TaskName || t.TaskKey }}</span>
                        <button v-if="!readOnly" type="button" class="ah-btn ah-btn--ghost ah-btn--sm" @click.stop="schedule(t)">
                            {{ $t('ViewsV2.schedule') }}
                        </button>
                    </div>
                </aside>

                <div v-if="replanOpen" class="gv__replan">
                    <button type="button" class="gv__replan-close" :aria-label="$t('ViewsV2.close')" @click="replanOpen = false">×</button>
                    <p v-for="(line, i) in replanLines" :key="i" class="gv__replan-line">
                        <span v-if="i === 0" class="gv__replan-tag">✦ {{ $t('ViewsV2.replan') }}:</span> {{ line }}
                    </p>
                    <p v-for="p in proposals" :key="p._id" class="gv__replan-line">
                        <span class="gv__replan-tag">✦ {{ p.agentName }}:</span> {{ p.what }}
                        <router-link class="gv__replan-link" :to="{ name: 'AiInbox', params: { cid: companyId } }">{{ $t('ViewsV2.review') }}</router-link>
                    </p>
                </div>
            </div>
        </template>
    </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, inject, nextTick } from 'vue';
import { useStore } from 'vuex';
import { useI18n } from 'vue-i18n';
import { useCustomComposable, useGetterFunctions } from '@/composable';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import taskClass from '@/utils/TaskOperations';
import { taskListHelper } from '@/views/Projects/helper.js';
import { criticalPath } from '@/views/Projects/composables/criticalPath';
import { openTask } from '@/components/organisms/TaskDetailOverlay/useTaskOverlay';

defineOptions({ name: 'GanttView' });

const props = defineProps({
    projectData: { type: Object, default: () => ({}) },
    sprints: { type: Array, default: () => [] },
});

const { getters } = useStore();
const { t } = useI18n();
const { checkPermission } = useCustomComposable();
const { getUser } = useGetterFunctions();
const { groupBy } = taskListHelper();
const selectedProject = inject('selectedProject', ref({}));
const companyId = inject('$companyId', ref(''));
const clientWidth = inject('$clientWidth', ref(1440));

const ganttEl = ref(null);
const loadError = ref(false);
const loading = ref(true);
const milestones = ref([]);
const proposals = ref([]);
const zoomLevels = computed(() => [
    { key: 'Day', label: t('ViewsV2.zoom_days') },
    { key: 'Week', label: t('ViewsV2.zoom_weeks') },
    { key: 'Month', label: t('ViewsV2.zoom_months') },
]);
const zoom = ref('Week');
const showCritical = ref(true);
const showBaseline = ref(true);
const replanOpen = ref(false);

let gantt = null;     // dhtmlx instance (lazy-loaded)
let ready = false;    // init complete
let suppress = false; // guard: programmatic re-renders must not fire write handlers
let eventIds = [];
let baselineLayer = null;

const isMobile = computed(() => Number(clientWidth.value || 0) > 0 && Number(clientWidth.value) < 768);

/* ----------------------- data in: from the live Vuex store ----------------------- */
// Same task source the List/Table views use, so socket-driven updates flow in for free.
const sprintIds = computed(() => (props.sprints || []).map((s) => String((s && (s.id || s._id)) || '')).filter(Boolean));

function pickTasks(map) {
    const pid = props.projectData?._id;
    if (!pid || !map || !map[pid]) return [];
    const byProject = map[pid];
    const ids = sprintIds.value.length ? sprintIds.value : Object.keys(byProject);
    return ids.reduce((all, sid) => {
        const node = byProject[sid];
        return Array.isArray(node?.tasks) ? all.concat(node.tasks) : all;
    }, []);
}
const tasks = computed(() => {
    const merged = [...pickTasks(getters['projectData/tasks']), ...pickTasks(getters['projectData/tableTasks'])];
    const seen = new Set();
    return merged.filter((task) => {
        const id = String(task?._id || '');
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
    });
});

// active = not deleted (0 active, 2 archived, undefined legacy)
const activeTasks = computed(() => tasks.value.filter((task) => task && [0, 2, undefined, null].includes(task.deletedStatusKey)));
const scheduled = computed(() => activeTasks.value.filter((task) => task.startDate && task.DueDate));
const unscheduled = computed(() => activeTasks.value.filter((task) => !(task.startDate && task.DueDate)));

const readOnly = computed(() =>
    checkPermission('task.task_due_date', selectedProject.value?.isGlobalPermission ?? props.projectData?.isGlobalPermission) !== true
);

const sprintName = (id) => {
    const hit = (props.sprints || []).find((s) => String(s.id || s._id) === String(id));
    return (hit && (hit.name || hit.sprintName)) || t('ViewsV2.sprint_fallback');
};

const blocksOf = (task) => (task.relations || []).filter((r) => r.type === 'blocks').map((r) => String(r.taskId));

const critical = computed(() => criticalPath(scheduled.value.map((task) => ({
    id: String(task._id), startDate: task.startDate, DueDate: task.DueDate, blocks: blocksOf(task),
}))));
// The toggle decides what is painted, not what is known: Replan reads the chain either way.
const criticalIds = computed(() => (showCritical.value ? new Set(critical.value.path) : new Set()));

/* The last dated plan the task carried before this one. Only a real earlier date
 * counts — an invented baseline would read as a slip that never happened. */
const baselineEnd = (task) => {
    const history = Array.isArray(task.dueDateDeadLine) ? task.dueDateDeadLine : [];
    const first = history
        .map((entry) => {
            const value = typeof entry === 'string' ? (() => { try { return JSON.parse(entry); } catch (e) { return null; } })() : entry;
            const date = value && (value.date || value);
            const time = date ? new Date(date.seconds ? date.seconds * 1000 : date).getTime() : NaN;
            return Number.isNaN(time) ? null : time;
        })
        .filter(Boolean)
        .sort((a, b) => a - b)[0];
    if (!first) return null;
    return first < new Date(task.DueDate).getTime() ? new Date(first) : null;
};

// Re-render only when something the chart actually shows has changed.
const signature = computed(() =>
    JSON.stringify(scheduled.value.map((task) => [
        task._id, task.TaskName, task.startDate, task.DueDate, task.ParentTaskId || 0, task.sprintId || '',
        task.status?.type || task.statusType || '', task.Task_Leader || '',
        blocksOf(task),
    ]))
);

/* ----------------------------------- helpers ----------------------------------- */
function progressOf(task) {
    const type = task?.status?.type || task?.statusType;
    if (type === 'close') return 1;
    if (type === 'inprogress') return 0.5;
    return 0;
}
function findTask(id) { return activeTasks.value.find((task) => String(task._id) === String(id)); }
function buildProjectData() {
    const p = props.projectData || {};
    return { _id: p._id, ProjectName: p.ProjectName, CompanyId: p.CompanyId };
}
function buildUserData() {
    const uid = localStorage.getItem('userId');
    const me = (getters['users/users'] || []).find((u) => String(u._id) === String(uid)) || {};
    return { Employee_Name: me.Employee_Name || '', id: uid, companyOwnerId: getters['settings/companyOwnerDetail']?.userId || '' };
}
function open(task) {
    if (!task || !task._id) return;
    openTask({
        companyId: companyId.value,
        projectId: task.ProjectID || props.projectData?._id,
        sprintId: task.sprintId,
        folderId: task.folderObjId || task.sprintArray?.folderId || '',
        taskId: task._id,
    });
}

function toGanttData() {
    const data = scheduled.value.map((task) => {
        const parent = task.ParentTaskId ? String(task.ParentTaskId) : '';
        const sprintGroup = task.sprintId ? `sp_${task.sprintId}` : 0;
        const line = baselineEnd(task);
        return {
            id: String(task._id),
            text: task.TaskName || task.TaskKey || t('ViewsV2.untitled'),
            start_date: new Date(task.startDate),
            end_date: new Date(task.DueDate),
            sprintGroup,
            parent: parent || sprintGroup,
            progress: progressOf(task),
            open: true,
            owner: task.Task_Leader || (Array.isArray(task.AssigneeUserId) ? task.AssigneeUserId[0] : '') || '',
            baseline_end: line,
            critical: criticalIds.value.has(String(task._id)),
        };
    });
    const ids = new Set(data.map((d) => d.id));
    // A parent outside the visible set would make dhtmlx throw; the task falls back
    // to its sprint band.
    data.forEach((d) => {
        if (d.parent && !String(d.parent).startsWith('sp_') && !ids.has(String(d.parent))) {
            d.parent = d.sprintGroup || 0;
        }
    });
    // Sprint bands exist only where something actually sits under them — an empty
    // project row has no dates to derive and dhtmlx renders it as NaN.
    const groups = [...new Set(data.map((d) => d.parent).filter((p) => String(p).startsWith('sp_')))]
        .map((groupId) => ({
            id: groupId,
            text: sprintName(String(groupId).slice(3)),
            type: gantt?.config?.types?.project || 'project',
            open: true,
            parent: 0,
            readonly: true,
        }));

    // dependency arrows: only emit from the 'blocks' side (relations are stored
    // bidirectionally, so this avoids duplicate links). 'blocks' => finish-to-start ('0').
    const links = [];
    scheduled.value.forEach((task) => {
        blocksOf(task).forEach((target) => {
            if (ids.has(String(task._id)) && ids.has(target)) {
                links.push({ id: `${task._id}_${target}`, source: String(task._id), target, type: '0' });
            }
        });
    });
    // Project milestones as read-only diamond markers.
    (milestones.value || []).forEach((m) => {
        if (m && m.date) {
            data.push({
                id: `ms_${m._id}`,
                text: m.milestoneName || t('ViewsV2.milestone'),
                start_date: new Date(m.date),
                type: (gantt && gantt.config && gantt.config.types ? gantt.config.types.milestone : 'milestone'),
                readonly: true,
                parent: 0,
            });
        }
    });
    return { data: groups.concat(data), links };
}

function renderData() {
    if (!ready || !gantt) return;
    suppress = true;
    try {
        gantt.clearAll();
        gantt.parse(toGanttData());
        placeToday();
    } finally {
        suppress = false;
    }
}

let todayMarker = null;
function placeToday() {
    if (!gantt || typeof gantt.addMarker !== 'function') return;
    try {
        if (todayMarker) gantt.deleteMarker(todayMarker);
        todayMarker = gantt.addMarker({ start_date: new Date(), css: 'gv-today', text: t('ViewsV2.today') });
    } catch (e) { /* markers are decoration */ }
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
    gantt.config.scale_height = 34;
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
        gantt.config.scales = [{ unit: 'week', step: 1, format: '%M %d' }];
    }
}
function setZoom(level) {
    zoom.value = level;
    applyScales(level);
    if (ready && gantt) gantt.render();
}
function toggleCritical() {
    showCritical.value = !showCritical.value;
    renderData();
}
function toggleBaseline() {
    showBaseline.value = !showBaseline.value;
    if (ready && gantt) gantt.render();
}

/* --------------------------------- replan panel --------------------------------- */
const replanLines = computed(() => {
    const path = critical.value.path || [];
    if (!path.length) return [t('ViewsV2.replan_none')];
    const chain = path.map((id) => findTask(id)).filter(Boolean);
    const last = chain[chain.length - 1];
    const end = last ? new Date(last.DueDate) : null;
    const lines = [t('ViewsV2.replan_chain', {
        n: chain.length,
        days: critical.value.durationDays,
        date: end ? end.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '',
    })];
    const now = Date.now();
    const late = chain.find((task) => new Date(task.DueDate).getTime() < now && (task.status?.type || task.statusType) !== 'close');
    if (late) lines.push(t('ViewsV2.replan_late', { task: late.TaskName || late.TaskKey }));
    return lines;
});

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

function ownerCell(task) {
    if (!task || String(task.id).startsWith('sp_') || String(task.id).startsWith('ms_')) return '';
    if (!task.owner) return `<span class="gv-unassigned">${t('ViewsV2.unassigned')}</span>`;
    const user = getUser(task.owner) || {};
    const name = user.Employee_Name || '';
    return `<span class="gv-owner" title="${name.replace(/"/g, '')}">${(name.trim().charAt(0) || '?').toUpperCase()}</span>`;
}

onMounted(async () => {
    if (isMobile.value) { loading.value = false; return; }
    ensureTasksLoaded();
    loadProposals();
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
        gantt.config.row_height = 36;
        gantt.config.bar_height = 16;
        gantt.config.show_markers = true;
        gantt.config.columns = [
            { name: 'text', label: t('ViewsV2.col_task'), tree: true, width: 236, resize: true },
            { name: 'owner', label: '', align: 'center', width: 48, template: ownerCell },
        ];
        gantt.templates.task_text = () => '';
        gantt.templates.task_class = (start, end, task) => {
            const classes = [];
            if (String(task.id).startsWith('sp_')) classes.push('gv-group');
            if (task.critical) classes.push('gv-critical');
            return classes.join(' ');
        };
        gantt.templates.grid_row_class = (start, end, task) => (String(task.id).startsWith('sp_') ? 'gv-grid-group' : '');
        gantt.templates.link_class = (link) => (criticalIds.value.has(String(link.source)) && criticalIds.value.has(String(link.target)) ? 'gv-link-critical' : '');
        applyScales(zoom.value);

        gantt.init(ganttEl.value);

        // Baseline runs as its own layer so the actual bar keeps dhtmlx's own drag maths.
        if (typeof gantt.addTaskLayer === 'function') {
            baselineLayer = gantt.addTaskLayer((task) => {
                if (!showBaseline.value || !task.baseline_end || !task.start_date) return false;
                const el = document.createElement('div');
                el.className = 'gv-baseline';
                const left = gantt.posFromDate(task.start_date);
                const right = gantt.posFromDate(task.baseline_end);
                el.style.left = `${Math.min(left, right)}px`;
                el.style.width = `${Math.max(2, Math.abs(right - left))}px`;
                el.style.top = `${gantt.getTaskTop(task.id) + gantt.getTaskHeight() - 4}px`;
                return el;
            });
        }

        eventIds.push(gantt.attachEvent('onAfterTaskDrag', (id) => persistDates(id)));
        eventIds.push(gantt.attachEvent('onAfterLinkAdd', (id, link) => persistLinkAdd(id, link)));
        eventIds.push(gantt.attachEvent('onAfterLinkDelete', (id, link) => persistLinkDelete(link)));
        eventIds.push(gantt.attachEvent('onTaskDblClick', (id) => {
            const task = findTask(id);
            if (task) open(task);
            return false;
        }));

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

async function loadProposals() {
    try {
        const res = await apiRequest('get', `${env.AGENT_PROPOSALS}?status=pending`);
        const rows = res?.data?.status ? (res.data.data || []) : [];
        const pid = String(props.projectData?._id || '');
        proposals.value = rows.filter((p) => !pid || String(p.projectId || '') === pid).slice(0, 2);
    } catch (e) {
        proposals.value = [];
    }
}

watch(signature, () => { if (ready && !suppress) renderData(); });
watch(criticalIds, () => { if (ready && !suppress) renderData(); });

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
            if (baselineLayer && typeof gantt.removeTaskLayer === 'function') gantt.removeTaskLayer(baselineLayer);
            if (todayMarker && typeof gantt.deleteMarker === 'function') gantt.deleteMarker(todayMarker);
            gantt.clearAll();
            // Intentionally NOT calling gantt.destructor() — destructing the shared
            // singleton breaks re-init when the Gantt tab is reopened (tasksStore undefined).
        }
    } catch (e) { /* ignore */ }
    eventIds = [];
    baselineLayer = null;
    todayMarker = null;
    gantt = null;
    ready = false;
});
</script>

<style scoped src="./style.css"></style>
