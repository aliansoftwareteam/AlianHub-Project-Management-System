<template>
    <div class="tss">
        <CardSkeleton v-if="loading && !loaded" :counters="3" :rows="4" />
        <template v-else>
            <!-- One box per status the card is configured to show. The box IS the
                 selector: clicking it opens that status's tasks below. -->
            <div v-if="!boxes.length" class="tss-msg">{{ $t('dashboardCard.tss_no_status') }}</div>
            <div v-else class="tss-boxes">
                <button
                    v-for="b in boxes"
                    :key="b.statusKey"
                    type="button"
                    class="tss-box"
                    :class="{ 'is-active': activeStatus === b.statusKey }"
                    :style="{ '--tss-accent': b.color }"
                    :title="$t('dashboardCard.tss_open_status', { status: b.name })"
                    @click="toggleStatus(b.statusKey)"
                >
                    <span class="tss-num">{{ b.count }}</span>
                    <span class="tss-name" :title="b.name">{{ b.name }}</span>
                </button>
            </div>

            <div class="tss-meta">
                <span>{{ $t('dashboardCard.tss_total', { n: total }) }}</span>
                <span class="tss-scope">{{ scopeLabel }}</span>
            </div>

            <!-- The drill-down. Only present once a box is picked, so the card stays a
                 set of counters until someone asks for the detail behind one. -->
            <template v-if="activeStatus !== null">
                <div class="tss-drill-head">
                    <span class="tss-drill-title">
                        <span class="tss-dot" :style="{ backgroundColor: activeMeta.color }"></span>
                        {{ activeMeta.name }}
                    </span>
                    <!-- Searches the whole status on the server, not the rows already on
                         screen — the list is capped, so a client-side filter would search
                         50 of 51 and look like the task simply is not there. -->
                    <input
                        v-model="search"
                        type="search"
                        class="tss-search"
                        :placeholder="$t('dashboardCard.tss_search_placeholder')"
                        @mousedown.stop
                        @keydown.stop
                    />
                    <button type="button" class="tss-clear" @click="clearStatus">✕</button>
                </div>

                <div v-if="drillLoading" class="tss-msg">{{ $t('dashboardCard.tss_loading_tasks') }}</div>
                <div v-else-if="!rows.length" class="tss-msg">
                    {{ search ? $t('dashboardCard.tss_no_match', { q: search }) : $t('dashboardCard.tss_no_tasks') }}
                </div>
                <div v-else class="tss-table-wrap">
                    <table class="tss-table">
                        <thead>
                            <tr>
                                <th class="tss-th tss-th--task">{{ $t('dashboardCard.tss_col_task') }}</th>
                                <th class="tss-th tss-th--who">{{ $t('dashboardCard.tss_col_employee') }}</th>
                                <th class="tss-th tss-th--num">{{ $t('dashboardCard.tss_col_estimate') }}</th>
                                <th class="tss-th tss-th--num">{{ $t('dashboardCard.tss_col_logged') }}</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="r in rows" :key="r.taskId" class="tss-tr">
                                <td class="tss-td tss-td--task">
                                    <span
                                        class="tss-task"
                                        :class="{ 'tss-task--link': r.projectId }"
                                        :title="(r.taskKey ? r.taskKey + ' ' : '') + r.taskName"
                                        @click="openTaskDetail(r)"
                                        @mousedown.stop
                                    >
                                        <b v-if="r.taskKey" class="tss-key">{{ r.taskKey }}</b> {{ r.taskName }}
                                    </span>
                                </td>
                                <td class="tss-td tss-td--who" :title="whoTitle(r)">{{ who(r) }}</td>
                                <td class="tss-td tss-td--num">{{ r.estimateMinutes ? formatMinutes(r.estimateMinutes) : '—' }}</td>
                                <td class="tss-td tss-td--num" :class="{ 'tss-over': isOver(r) }">
                                    {{ r.loggedMinutes ? formatMinutes(r.loggedMinutes) : '—' }}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                    <div v-if="rows.length >= ROW_LIMIT" class="tss-capped">
                        {{ $t('dashboardCard.tss_capped', { n: ROW_LIMIT }) }}
                    </div>
                </div>
            </template>
        </template>

        <!-- Task detail sidebar — same pattern the other cards use. -->
        <TaskDetail
            v-if="isTaskDetail"
            :companyId="companyId"
            :projectId="detailProjectId"
            :sprintId="detailSprintId"
            :taskId="detailTaskId"
            :isTaskDetailSideBar="isTaskDetail"
            @toggleTaskDetail="toggleTaskDetail"
            :zIndex="7"
        />
    </div>
</template>

<script>
export default { name: 'TaskStatusSummaryCard' };
</script>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, inject, provide } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { resolveCardRange, formatMinutes } from '@/composable/useResourceWorkload';
import CardSkeleton from '@/components/atom/CardSkeleton/CardSkeleton.vue';
import TaskDetail from '@/views/TaskDetail/TaskDetail.vue';

// Task counts per status for the selected window, with a per-status drill-down.
//
// Statuses are per-project and fully configurable, so nothing here is hardcoded: the
// boxes come from whatever the card's `status` setting selected, resolved against the
// company's own status list (settings/AllTaskStatus, handed down as taskStatusArray).
//
// Scoping is the SERVER's call — Owner/Admin get the company, everyone else gets their
// own tasks. The card only reports which it got.
const props = defineProps({
    cardUID: { type: [String, Number], default: '' },
    componentId: { type: String, default: '' },
    cardData: { type: Object, default: () => ({}) },
    filterData: { type: [Array, Object], default: () => [] },
    refreshTrigger: { type: [Number, String], default: 0 },
    companyUserDetail: { type: Object, default: () => ({}) },
    allProjectsArrayFilter: { type: Array, default: () => [] },
    taskStatusArray: { type: [Array, Object], default: () => ({}) },
});

const { t } = useI18n();
const companyId = inject('$companyId', ref(''));
const globalRange = inject('dashboardGlobalRange', null);

const ROW_LIMIT = 50;

const timerange = computed(() => {
    const v = Number(props.cardData?.timerange);
    return Number.isFinite(v) && v >= 0 && v <= 8 ? v : 3; // default This Week; 0 = Auto
});

const counts = ref({});          // statusKey -> count, from the server
const total = ref(0);
const scope = ref('self');
const rows = ref([]);
const loading = ref(false);
const loaded = ref(false);
const drillLoading = ref(false);
const activeStatus = ref(null);
const search = ref('');

// The company's status list: { key, name, textColor }. Same shape the pie/bar cards read.
const statusSettings = computed(() => {
    const a = props.taskStatusArray;
    const list = Array.isArray(a) ? a : (a && a.settings) || [];
    return Array.isArray(list) ? list : [];
});

// Which statuses this card shows. The `status` setting stores the selected keys; an
// empty selection means "all of them", so a newly added card is useful immediately.
const selectedKeys = computed(() => {
    const v = props.cardData?.statusArray;
    const keys = (Array.isArray(v) ? v : []).map(Number).filter((n) => Number.isFinite(n));
    return keys.length ? keys : statusSettings.value.map((s) => Number(s.key));
});

const boxes = computed(() => selectedKeys.value.map((key) => {
    const meta = statusSettings.value.find((s) => Number(s.key) === key) || {};
    return {
        statusKey: key,
        name: meta.name || t('dashboardCard.tss_unknown_status'),
        color: meta.textColor || '#6473e8',
        // A status with nothing in it still gets a box: "zero in review" is a real
        // answer, and boxes appearing and vanishing between periods reads as broken.
        count: Number(counts.value[key]) || 0,
    };
}));

const activeMeta = computed(() => boxes.value.find((b) => b.statusKey === activeStatus.value)
    || { name: '', color: '#6473e8' });

const scopeLabel = computed(() => (scope.value === 'company'
    ? t('dashboardCard.tss_scope_company')
    : t('dashboardCard.tss_scope_self')));

const who = (r) => (r.assignees && r.assignees.length
    ? r.assignees.map((a) => a.name).join(', ')
    : '—');
const whoTitle = (r) => (r.assignees && r.assignees.length > 1
    ? t('dashboardCard.tss_assignees', { n: r.assignees.length }) + ': ' + who(r)
    : who(r));
const isOver = (r) => !!r.estimateMinutes && r.loggedMinutes > r.estimateMinutes;

const requestBody = (statusKey) => {
    const { dateFrom, dateTo } = resolveCardRange(timerange.value, globalRange && globalRange.value);
    return {
        dateFrom,
        dateTo,
        statusKeys: props.cardData?.statusArray || [],
        projectId: props.cardData?.projectId || [],
        projectMode: props.cardData?.projectMode || 'all',
        // Search only means anything alongside a drill-down; it narrows the open list,
        // never the counters.
        ...(statusKey === null || statusKey === undefined
            ? {}
            : { statusKey, limit: ROW_LIMIT, search: search.value.trim() }),
    };
};

const load = async () => {
    loading.value = true;
    // Whichever status was open stays open across a reload, so changing the period does
    // not silently collapse the detail the user was reading.
    if (activeStatus.value !== null) drillLoading.value = true;
    try {
        const res = await apiRequest('post', `${env.TASKS_BY_STATUS}`, requestBody(activeStatus.value));
        const d = (res && res.data && res.data.status) ? (res.data.data || {}) : {};
        const map = {};
        (d.statuses || []).forEach((s) => { map[Number(s.statusKey)] = Number(s.count) || 0; });
        counts.value = map;
        total.value = Number(d.total) || 0;
        scope.value = d.scope || 'self';
        rows.value = d.rows || [];
        loaded.value = true;
    } catch (e) {
        console.error('TaskStatusSummaryCard fetch error:', e);
        counts.value = {};
        total.value = 0;
        rows.value = [];
    } finally {
        loading.value = false;
        drillLoading.value = false;
    }
};

const toggleStatus = (key) => {
    activeStatus.value = activeStatus.value === key ? null : key;
    // A search belongs to the list it was typed into; carrying it into the next status
    // would show an empty list and no obvious reason why.
    search.value = '';
    if (activeStatus.value === null) { rows.value = []; return; }
    load();
};
const clearStatus = () => { activeStatus.value = null; rows.value = []; search.value = ''; };

// Typing is a burst; one request per keystroke is not. Only the settled value is asked for.
let searchTimer = null;
watch(search, () => {
    if (activeStatus.value === null) return;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(load, 350);
});
onUnmounted(() => clearTimeout(searchTimer));

// ─── Task-detail sidebar (same pattern as the other cards) ───
const isTaskDetail = ref(false);
const detailProjectId = ref('');
const detailSprintId = ref('');
const detailTaskId = ref('');
function openTaskDetail(r) {
    if (!r || !r.taskId || !r.projectId) return;
    detailProjectId.value = r.projectId;
    detailSprintId.value = r.sprintId || '';
    detailTaskId.value = r.taskId;
    isTaskDetail.value = true;
}
function toggleTaskDetail(_task, close = false) {
    isTaskDetail.value = false;
    if (close === true) return;
    detailProjectId.value = '';
    detailSprintId.value = '';
    detailTaskId.value = '';
}
provide('toggleTaskDetail', toggleTaskDetail);

watch(() => props.refreshTrigger, load);
watch(() => props.cardData, load, { deep: true });
// Auto mode only — otherwise the card's own period wins and the global picker is noise.
watch(() => globalRange && globalRange.value, () => { if (timerange.value === 0) load(); }, { deep: true });
onMounted(load);
</script>

<style scoped>
/* The card itself does NOT scroll: the counters, the total line and the drill-down header
   stay put, and only the task list moves. That is what lets the table header stick — a
   sticky header needs a scroll container with a bounded height, and the card body has no
   bound. Same shape MilestoneReportCard and the Inbox page use. */
.tss { height: 100%; width: 100%; padding: 8px 10px; overflow: hidden; display: flex; flex-direction: column; gap: 8px; }
.tss-msg { color: #9aa0b4; font-size: 12px; padding: 8px 0; }

/* Counter row. Wraps rather than scrolls: a status that fell off the right edge is a
   status nobody counts. */
.tss-boxes { display: flex; flex-wrap: wrap; gap: 8px; flex: 0 0 auto; }
.tss-box {
    flex: 1 1 96px;
    min-width: 88px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: #f5f7fb;
    padding: 8px 6px;
    text-align: center;
    cursor: pointer;
    transition: background .12s ease, border-color .12s ease, box-shadow .12s ease;
    display: flex;
    flex-direction: column;
    gap: 3px;
}
.tss-box:hover { background: #eef2fb; }
/* The accent only appears on the selected box, so the row stays calm until you pick one. */
.tss-box.is-active {
    background: #fff;
    border-color: var(--tss-accent);
    box-shadow: inset 0 -3px 0 0 var(--tss-accent);
}
.tss-num { font-size: 22px; font-weight: 700; color: #2f3546; line-height: 1.1; font-variant-numeric: tabular-nums; }
.tss-box.is-active .tss-num { color: var(--tss-accent); }
.tss-name { font-size: 10px; color: #6b7280; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.tss-meta { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; font-size: 11px; color: #9aa0b4; }
.tss-scope { font-weight: 600; color: #6b7280; white-space: nowrap; }

.tss-drill-head { display: flex; align-items: center; gap: 8px; border-top: 1px solid #eef0f6; padding-top: 8px; flex: 0 0 auto; }
/* The status name keeps its width; the search box takes the slack between it and ✕. */
.tss-drill-title { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: #3a3f52; flex: 0 0 auto; }
.tss-dot { width: 9px; height: 9px; border-radius: 50%; flex: 0 0 auto; }
.tss-search {
    flex: 1 1 auto;
    min-width: 0;
    max-width: 260px;
    margin-left: auto;
    height: 26px;
    padding: 0 9px;
    border: 1px solid #e3e6ef;
    border-radius: 6px;
    background: #fff;
    font-size: 11.5px;
    color: #3a3f52;
    outline: none;
}
.tss-search::placeholder { color: #b0b6c6; }
.tss-search:focus { border-color: #6473e8; }
.tss-clear { border: none; background: none; padding: 0 2px; font-size: 12px; color: #9aa0b4; cursor: pointer; flex: 0 0 auto; }
.tss-clear:hover { color: #3a3f52; }

/* The list is the only thing that scrolls, and it takes whatever height the card has left.
   `min-height: 0` is what allows it to shrink inside the flex column — without it the
   region grows to fit its rows and the card clips instead of scrolling. */
.tss-table-wrap { flex: 1 1 auto; min-height: 0; overflow: auto; }
.tss-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.tss-th {
    position: sticky;
    top: 0;
    z-index: 1;
    /* Opaque, or the rows show through as they pass under it. */
    background: #fff;
    font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .02em;
    color: #9aa0b4; text-align: left; padding: 4px 8px 5px 0;
    /* An inset shadow rather than border-bottom: with border-collapse the border belongs
       to the table grid and scrolls away from a sticky cell, leaving the header floating
       over the rows with no edge. */
    box-shadow: inset 0 -1px 0 #eef0f6;
}
.tss-th--who { width: 26%; }
.tss-th--num { width: 74px; text-align: right; }
/* The list region carries the scrollbar, so without this the last column sits under it and
   the numbers read as clipped. The width above already reserves the column; this is the gap. */
.tss-th:last-child, .tss-td:last-child { padding-right: 14px; }
.tss-tr { border-bottom: 1px solid #f4f5f9; }
.tss-tr:last-child { border-bottom: none; }
.tss-td { padding: 6px 8px 6px 0; font-size: 11.5px; color: #3a3f52; vertical-align: middle; }
.tss-td--task, .tss-td--who { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tss-td--who { color: #6b7280; }
.tss-td--num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
/* Logged past the estimate is the one thing worth colouring in this table. */
.tss-over { color: #b45309; font-weight: 600; }
.tss-task { display: inline-block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom; }
.tss-task--link { cursor: pointer; }
.tss-task--link:hover { color: #0e7490; text-decoration: underline; }
.tss-key { color: #0e7490; font-size: 10.5px; }
/* Inside the scroll region, so it sits after the last row rather than pinned to the card. */
.tss-capped { font-size: 10px; color: #9aa0b4; padding: 6px 0 2px; }
</style>
