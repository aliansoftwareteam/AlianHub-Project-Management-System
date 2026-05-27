<template>
    <div class="ewr-card-wrapper" ref="cardRef">
        <!-- Loading skeleton -->
        <div v-if="isLoading && !report.employees.length" class="ewr-loading">
            <Skelaton v-for="i in 4" :key="i" class="ewr-row-skeleton" :style="{ height: '40px', marginBottom: '8px' }"/>
        </div>

        <template v-else>
            <!-- Filter chips -->
            <div class="ewr-chips-row">
                <span class="ewr-chip" :title="$t('dashboardCard.date_range')">
                    <span class="ewr-chip-label">{{ chipLabel('date') }}</span>
                </span>
                <span class="ewr-chip" :title="$t('dashboardCard.employees')">
                    <span class="ewr-chip-label">{{ chipLabel('employees') }}</span>
                </span>
                <span v-if="cardObject.taskType && cardObject.taskType !== 'all'" class="ewr-chip" :title="$t('dashboardCard.task_type')">
                    <span class="ewr-chip-label">{{ cardObject.taskType }}</span>
                </span>
                <span class="ewr-chip-spacer"></span>
                <!-- Search box -->
                <span v-if="isLoading" class="ewr-chip ewr-chip-loading">
                    <span class="ewr-mini-spinner" aria-hidden="true"></span>
                    Refreshing…
                </span>
                <span class="ewr-search-box">
                    <svg class="ewr-search-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                        <circle cx="6.5" cy="6.5" r="4" stroke="currentColor" stroke-width="1.5"/>
                        <line x1="9.7" y1="9.7" x2="13.5" y2="13.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                    </svg>
                    <input
                        v-model="searchQuery"
                        class="ewr-search-input"
                        type="text"
                        placeholder="Search employee…"
                        autocomplete="off"
                    />
                    <span
                        v-if="searchQuery"
                        class="ewr-search-clear"
                        title="Clear search"
                        @click="searchQuery = ''"
                    >&#x2715;</span>
                </span>
                <!-- Colour legend for the Logged Hours column -->
                <span class="ewr-legend" title="Logged Hours colour meaning">
                    <span class="ewr-legend-item">
                        <span class="ewr-legend-dot ewr-legend-dot-estimate"></span>
                        Over estimate
                    </span>
                    <span class="ewr-legend-item">
                        <span class="ewr-legend-dot ewr-legend-dot-planned"></span>
                        Over planned
                    </span>
                </span>
            </div>

            <!-- Empty state — also covers the case where "Hide empty
                 users" filtered everyone out. -->
            <div v-if="!sortedEmployees.length" class="ewr-empty">
                <p class="ewr-empty-text">{{ searchQuery ? `No employees match "${searchQuery}".` : 'No employees match this filter.' }}</p>
            </div>

            <template v-else>
                <!-- Employee table -->
                <div class="ewr-table-wrapper">
                    <table class="ewr-table">
                        <thead>
                            <tr>
                                <th class="ewr-th-expand"></th>
                                <th class="ewr-th-name" @click="setSort('name')">
                                    Employee {{ sortIndicator('name') }}
                                </th>
                                <th class="ewr-th-project">Project</th>
                                <th class="ewr-th-num" @click="setSort('loggedMinutes')">
                                    Logged Hours {{ sortIndicator('loggedMinutes') }}
                                </th>
                                <th class="ewr-th-num" @click="setSort('plannedMinutes')">
                                    Planned Hours {{ sortIndicator('plannedMinutes') }}
                                </th>
                                <th class="ewr-th-num" @click="setSort('commonEstimateMinutes')">
                                    Estimate Hours {{ sortIndicator('commonEstimateMinutes') }}
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            <template v-for="row in sortedEmployees" :key="row._id">
                                <!-- Employee summary row -->
                                <tr
                                    class="ewr-row"
                                    :class="{
                                        'ewr-row-expanded': expanded[row._id],
                                        'ewr-row-clickable': row.assignedTaskCount > 0,
                                        'ewr-row-empty': row.assignedTaskCount === 0,
                                    }"
                                    @click="row.assignedTaskCount > 0 ? toggleExpand(row._id) : null">
                                    <td class="ewr-td-expand">
                                        <span
                                            v-if="row.assignedTaskCount > 0"
                                            class="ewr-chevron"
                                            :class="{ 'ewr-chevron-open': expanded[row._id] }">›</span>
                                    </td>
                                    <td class="ewr-td-name">
                                        <div class="ewr-name-cell">
                                            <UserProfile
                                                :data="{ image: getUserProfile(row._id).Employee_profileImageURL, title: row.name }"
                                                :showDot="getUserProfile(row._id).isOnline"
                                                width="28px"
                                                :thumbnail="'30x30'"
                                            />
                                            <span class="ewr-name-text" :title="row.name">{{ row.name || '—' }}</span>
                                        </div>
                                    </td>
                                    <td class="ewr-td-project ewr-muted">{{ projectCountLabel(row.projectCount) }}</td>
                                    <td
                                        class="ewr-td-num"
                                        :class="loggedHighlightClass(row.loggedMinutes, row.plannedMinutes, row.commonEstimateMinutes)"
                                        :title="loggedHighlightTitle(row.loggedMinutes, row.plannedMinutes, row.commonEstimateMinutes)">
                                        {{ formatMinutes(row.loggedMinutes) }}
                                    </td>
                                    <td class="ewr-td-num">
                                        <span v-if="row.plannedMinutes">{{ formatMinutes(row.plannedMinutes) }}</span>
                                        <span v-else class="ewr-missing" title="No planned hours">—</span>
                                    </td>
                                    <td class="ewr-td-num">
                                        <span v-if="row.commonEstimateMinutes">{{ formatMinutes(row.commonEstimateMinutes) }}</span>
                                        <span v-else class="ewr-missing" title="No estimate set">—</span>
                                    </td>
                                </tr>

                                <!-- Task detail rows — aligned to the same columns -->
                                <template v-if="expanded[row._id]">
                                    <tr v-if="!row.tasks.length" class="ewr-task-tr ewr-task-first ewr-task-last">
                                        <td></td>
                                        <td colspan="5" class="ewr-no-tasks">No tasks for this employee in current filter.</td>
                                    </tr>
                                    <tr
                                        v-for="(t, tIndex) in row.tasks"
                                        :key="t._id"
                                        class="ewr-task-tr"
                                        :class="{
                                            'ewr-task-over': isLoggedOverEstimate(t.loggedMinutes, t.commonEstimateMinutes),
                                            'ewr-task-first': tIndex === 0,
                                            'ewr-task-last': tIndex === row.tasks.length - 1,
                                        }"
                                        :title="isLoggedOverEstimate(t.loggedMinutes, t.commonEstimateMinutes) ? `Over estimate by ${formatMinutes(t.loggedMinutes - t.commonEstimateMinutes)}` : ''">
                                        <td></td>
                                        <td class="ewr-td-task-name">
                                            <img v-if="t.isSubTask" :src="subTaskIcon" class="ewr-subtask-icon" title="Sub task" alt="sub task" />
                                            <span
                                                class="ewr-task-name ewr-task-name-link"
                                                :title="t.TaskName"
                                                @click.stop="openTaskDetail(t)">{{ t.TaskName }}</span>
                                        </td>
                                        <td class="ewr-td-project" :title="t.ProjectName">{{ t.ProjectName || '—' }}</td>
                                        <td
                                            class="ewr-td-num"
                                            :class="loggedHighlightClass(t.loggedMinutes, t.plannedMinutes, t.commonEstimateMinutes)"
                                            :title="loggedHighlightTitle(t.loggedMinutes, t.plannedMinutes, t.commonEstimateMinutes)">
                                            {{ t.loggedMinutes ? formatMinutes(t.loggedMinutes) : '—' }}
                                        </td>
                                        <td class="ewr-td-num">
                                            {{ t.plannedMinutes ? formatMinutes(t.plannedMinutes) : '—' }}
                                        </td>
                                        <td class="ewr-td-num">
                                            {{ t.commonEstimateMinutes ? formatMinutes(t.commonEstimateMinutes) : '—' }}
                                        </td>
                                    </tr>

                                </template>
                            </template>
                        </tbody>
                        <tfoot>
                            <tr class="ewr-total-row">
                                <td></td>
                                <td class="ewr-total-label">Total</td>
                                <td></td>
                                <td class="ewr-td-num">{{ formatMinutes(totals.logged) }}</td>
                                <td class="ewr-td-num">{{ formatMinutes(totals.planned) }}</td>
                                <td class="ewr-td-num">{{ formatMinutes(totals.estimate) }}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>

            </template>
        </template>

        <!-- Task detail sidebar — opened by clicking a task name -->
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

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch, inject, nextTick, provide } from 'vue';
import { useStore } from 'vuex';
import { apiRequest } from '@/services';
import { teamIdToUserId } from '@/composable/commonFunction';
import Skelaton from '@/components/atom/Skelaton/Skelaton.vue';
import UserProfile from '@/components/atom/UserProfile/UserProfile.vue';
import TaskDetail from '@/views/TaskDetail/TaskDetail.vue';
const subTaskIcon = require('@/assets/images/svg/sub_task_image.svg');

const props = defineProps({
    companyUserDetail: { type: Object, default: () => ({}) },
    cardUID: { type: String, required: true },
    cardData: { type: Object, default: () => ({}) },
    allProjectsArrayFilter: { type: Array, default: () => [] },
    taskStatusArray: { type: Object, default: () => ({}) },
    componentId: { type: String, default: '' },
    filterData: { type: [Array, Object], default: () => [] },
});

const userId = inject('$userId');
const companyId = inject('$companyId');
const { getters } = useStore();
// Teams (for expanding "tId_*" team selections into member user ids).
const teamsArr = getters['settings/teams'] || [];
// User profile lookup — reads Employee_profileImageURL directly from the
// users store (same pattern as TaskInSidebar.vue / DashBoardList.vue).
const storeUsers = computed(() => getters['users/users'] || []);
function getUserProfile(id) {
    return storeUsers.value.find((u) => String(u._id) === String(id)) || {};
}

// ─── Task-detail sidebar ────────────────────────────────────────
const isTaskDetail = ref(false);
const detailProjectId = ref('');
const detailSprintId = ref('');
const detailTaskId = ref('');

function openTaskDetail(task) {
    if (!task || !task._id) return;
    detailProjectId.value = task.ProjectID;
    detailSprintId.value = task.sprintId;
    detailTaskId.value = task._id;
    isTaskDetail.value = true;
}
// Mirrors the pattern used by QueueList/Calendar cards: close, then
// (optionally) reopen on the next tick when switching tasks.
function toggleTaskDetail(task, close = false) {
    isTaskDetail.value = false;
    if (close === true) return;
    detailProjectId.value = '';
    detailSprintId.value = '';
    detailTaskId.value = '';
    if (task) {
        nextTick(() => openTaskDetail(task));
    }
}
provide('toggleTaskDetail', toggleTaskDetail);

// Local reactive copies so the watch on cardData doesn't fight us.
const cardObject = ref(JSON.parse(JSON.stringify(props.cardData || {})));
const isLoading = ref(false);
const report = reactive({
    employees: [],
    teamAggregate: { workloadByEmployee: [], taskTypeBreakdown: { learning: 0, actual: 0, unknown: 0 } },
});
const expanded = reactive({});
// Sort is purely UI-side now — driven by clicking column headers.
// Default: employee name A → Z.
const sortKey = ref('name');
const sortDir = ref('asc');
// Search — client-side, filters by employee name.
const searchQuery = ref('');
let refreshTimer = null;

// ─── Helpers ─────────────────────────────────────────────────────
function formatMinutes(min) {
    const n = Number(min) || 0;
    if (n <= 0) return '0h';
    const h = Math.floor(n / 60);
    const m = Math.round(n % 60);
    if (h === 0) return `${m}m`;            // sub-hour → "30m" (not "0h 30m")
    return m === 0 ? `${h}h` : `${h}h ${String(m).padStart(2, '0')}m`;
}

function projectCountLabel(count) {
    if (!count) return '—';
    return `${count} project${count === 1 ? '' : 's'}`;
}

// True when logged time has blown past the (existing) estimate.
function isLoggedOverEstimate(logged, estimate) {
    return Number(estimate) > 0 && (Number(logged) || 0) > Number(estimate);
}
// Over-budget highlighting for the Logged column:
//   - red   when logged time exceeds the task's common estimate
//   - amber when logged time exceeds the employee's own planned hours
// Red takes priority (exceeding the estimate is the more serious case).
// Only flags when the comparison value actually exists (> 0).
function loggedHighlightClass(logged, planned, estimate) {
    const l = Number(logged) || 0;
    if (isLoggedOverEstimate(logged, estimate)) return 'ewr-over-estimate';
    if (Number(planned) > 0 && l > Number(planned)) return 'ewr-over-planned';
    return '';
}
function loggedHighlightTitle(logged, planned, estimate) {
    const l = Number(logged) || 0;
    if (Number(estimate) > 0 && l > Number(estimate)) {
        return `${formatMinutes(l - Number(estimate))} over estimate`;
    }
    if (Number(planned) > 0 && l > Number(planned)) {
        return `${formatMinutes(l - Number(planned))} over planned`;
    }
    return '';
}
const TIMERANGE_LABELS = {
    1: 'Today', 2: 'Yesterday', 3: 'This week', 4: 'Last week',
    5: 'This month', 6: 'Last month', 7: 'Last 30 days',
};
function chipLabel(kind) {
    if (kind === 'date') {
        return TIMERANGE_LABELS[Number(cardObject.value.timerange)] || 'This week';
    }
    if (kind === 'employees') {
        const ids = cardObject.value.AssigneeUserId || [];
        if (!ids.length) return 'All visible';
        return `${ids.length} selected`;
    }
    return '';
}

// ─── Sorting ─────────────────────────────────────────────────────
function setSort(key) {
    if (sortKey.value === key) {
        sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc';
    } else {
        sortKey.value = key;
        sortDir.value = 'desc';
    }
}
function sortIndicator(key) {
    if (sortKey.value !== key) return '';
    return sortDir.value === 'asc' ? '↑' : '↓';
}
const sortedEmployees = computed(() => {
    let list = [...report.employees];
    // "Hide empty users" toggle — drop employees with no tasks in the
    // current filter when enabled.
    if (cardObject.value.hideEmptyEmployees) {
        list = list.filter((r) => r.assignedTaskCount > 0);
    }
    // Search — client-side name filter.
    const q = searchQuery.value.trim().toLowerCase();
    if (q) {
        list = list.filter((r) => (r.name || '').toLowerCase().includes(q));
    }
    const dir = sortDir.value === 'asc' ? 1 : -1;
    list.sort((a, b) => {
        const av = a[sortKey.value];
        const bv = b[sortKey.value];
        if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
        return String(av || '').localeCompare(String(bv || '')) * dir;
    });
    return list;
});

// Team totals — arithmetic sum of each hour column (matches what the
// user sees adding up the column). Safe on an empty list (all zeros).
const totals = computed(() => {
    return (report.employees || []).reduce((acc, r) => {
        acc.logged += Number(r.loggedMinutes) || 0;
        acc.planned += Number(r.plannedMinutes) || 0;
        acc.estimate += Number(r.commonEstimateMinutes) || 0;
        return acc;
    }, { logged: 0, planned: 0, estimate: 0 });
});

// ─── Date range resolution ──────────────────────────────────────
// Accepts the `timerange` numeric id used by the existing card
// catalog conventions (1=today, 2=yesterday, 3=this_week, etc.)
function resolveDateRange(value) {
    const now = new Date();
    const start = new Date(now);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    const id = Number(value);

    switch (id) {
        case 1: { // today
            start.setHours(0, 0, 0, 0);
            return { dateFrom: start.toISOString(), dateTo: end.toISOString() };
        }
        case 2: { // yesterday
            start.setDate(start.getDate() - 1);
            start.setHours(0, 0, 0, 0);
            const yEnd = new Date(start);
            yEnd.setHours(23, 59, 59, 999);
            return { dateFrom: start.toISOString(), dateTo: yEnd.toISOString() };
        }
        case 4: { // last_week
            const day = start.getDay() === 0 ? 6 : start.getDay() - 1;
            start.setDate(start.getDate() - day - 7);
            start.setHours(0, 0, 0, 0);
            const wEnd = new Date(start);
            wEnd.setDate(wEnd.getDate() + 6);
            wEnd.setHours(23, 59, 59, 999);
            return { dateFrom: start.toISOString(), dateTo: wEnd.toISOString() };
        }
        case 5: { // this_month
            start.setDate(1);
            start.setHours(0, 0, 0, 0);
            return { dateFrom: start.toISOString(), dateTo: end.toISOString() };
        }
        case 6: { // last_month
            start.setMonth(start.getMonth() - 1, 1);
            start.setHours(0, 0, 0, 0);
            const mEnd = new Date(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59, 999);
            return { dateFrom: start.toISOString(), dateTo: mEnd.toISOString() };
        }
        case 7: { // last_30_days
            start.setDate(start.getDate() - 30);
            start.setHours(0, 0, 0, 0);
            return { dateFrom: start.toISOString(), dateTo: end.toISOString() };
        }
        case 3: // this_week
        default: {
            const day = start.getDay() === 0 ? 6 : start.getDay() - 1;
            start.setDate(start.getDate() - day);
            start.setHours(0, 0, 0, 0);
            return { dateFrom: start.toISOString(), dateTo: end.toISOString() };
        }
    }
}

// ─── Toggle expanded row ────────────────────────────────────────
function toggleExpand(id) {
    expanded[id] = !expanded[id];
}

// ─── Fetch ─────────────────────────────────────────────────────
async function fetchReport() {
    if (document.hidden) return; // Page Visibility API — skip when tab hidden
    isLoading.value = true;
    try {
        // Field names match the catalog (TotalUrgentTasksComp convention):
        // AssigneeUserId, projectId, statusArray, timerange, isParentTask.
        const { dateFrom, dateTo } = resolveDateRange(cardObject.value.timerange);
        // "Show Assignees" can include teams (stored as "tId_<teamId>").
        // Expand any team selections into their member user ids before
        // sending — otherwise the backend can't match them to users.
        const employeeIds = teamIdToUserId(cardObject.value.AssigneeUserId || [], teamsArr);
        const payload = {
            employeeIds: Array.isArray(employeeIds) ? employeeIds : [],
            projectIds: cardObject.value.projectId || [],
            statusKeys: cardObject.value.statusArray || [],
            isParentTask: cardObject.value.isParentTask !== false,
            dateFrom,
            dateTo,
            callerUserId: userId && userId.value ? String(userId.value) : '',
            callerRoleType: props.companyUserDetail?.roleType || 3,
        };
        const response = await apiRequest('post', '/api/v1/dashboard/employee-workload', payload);
        if (response && response.data && response.data.status) {
            const d = response.data.data || {};
            report.employees = d.employees || [];
            report.teamAggregate = d.teamAggregate || { workloadByEmployee: [], taskTypeBreakdown: { learning: 0, actual: 0, unknown: 0 } };
        }
    } catch (e) {
        console.error('EmployeeWorkloadReportCard fetch error:', e);
    } finally {
        isLoading.value = false;
    }
}

// ─── Auto-refresh with Page Visibility pause ───────────────────
const AUTO_REFRESH_SECONDS = 300; // 5 minutes
function startAutoRefresh() {
    stopAutoRefresh();
    refreshTimer = setInterval(() => {
        if (!document.hidden) fetchReport();
    }, AUTO_REFRESH_SECONDS * 1000);
}
function stopAutoRefresh() {
    if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
    }
}
function handleVisibilityChange() {
    if (!document.hidden) fetchReport();
}

// ─── Lifecycle + reactive config ───────────────────────────────
onMounted(() => {
    fetchReport();
    startAutoRefresh();
    document.addEventListener('visibilitychange', handleVisibilityChange);
});
onBeforeUnmount(() => {
    stopAutoRefresh();
    document.removeEventListener('visibilitychange', handleVisibilityChange);
});

watch(() => props.cardData, (newVal) => {
    if (!newVal) return;
    cardObject.value = JSON.parse(JSON.stringify(newVal));
    fetchReport();
    startAutoRefresh();
}, { deep: true });
</script>

<style scoped src="./style.css"></style>
