<template>
    <div class="ach">
        <CardSkeleton v-if="loading && !loaded" :counters="4" :rows="4" />
        <template v-else>
            <!-- KPI row -->
            <div class="ach-stats">
                <div class="ach-stat">
                    <div class="ach-num">{{ data.completedCount }}</div>
                    <div class="ach-label">{{ $t('dashboardCard.ach_completed') }}</div>
                </div>
                <div class="ach-stat">
                    <div class="ach-num ach-ok">{{ pctLabel(data.onEstimateRate) }}</div>
                    <div class="ach-label">{{ $t('dashboardCard.ach_on_estimate') }}</div>
                </div>
                <div class="ach-stat">
                    <div class="ach-num ach-ok">{{ pctLabel(data.onTimeRate) }}</div>
                    <div class="ach-label">{{ $t('dashboardCard.ach_on_time') }}</div>
                </div>
                <div class="ach-stat">
                    <div class="ach-num ach-streak">{{ data.currentStreak }}<span class="ach-fire" v-if="data.currentStreak > 0">🔥</span></div>
                    <div class="ach-label">{{ $t('dashboardCard.ach_streak') }}</div>
                </div>
            </div>

            <!-- Tabs -->
            <div class="ach-tabs">
                <button
                    v-for="tab in tabs"
                    :key="tab.key"
                    class="ach-tab"
                    :class="{ active: activeTab === tab.key }"
                    @click="activeTab = tab.key"
                >
                    {{ tab.label }}<span class="ach-tab-count">{{ tab.items.length }}</span>
                </button>
            </div>

            <div v-if="!activeItems.length" class="ach-msg">{{ activeTabDef.empty }}</div>
            <div v-else class="ach-list">
                <div v-for="t in activeItems" :key="t.taskId" class="ach-row">
                    <span class="ach-task ach-task-link" :title="(t.taskKey ? t.taskKey + ' ' : '') + t.taskName" @click="openTaskDetail(t)" @mousedown.stop>
                        <b v-if="t.taskKey" class="ach-key">{{ t.taskKey }}</b> {{ t.taskName }}
                    </span>
                    <span class="ach-hours" :title="'Logged / Estimate'">{{ formatMinutes(t.logged) }} / {{ t.estimate ? formatMinutes(t.estimate) : '—' }}</span>
                    <span class="ach-reason" :class="reasonClass" :title="reasonTitle(t)">{{ reasonText(t) }}</span>
                </div>
            </div>
        </template>

        <!-- Task detail sidebar — opened by clicking a task (same pattern as the other cards). -->
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
export default { name: 'MyAchievementsCard' };
</script>

<script setup>
import { ref, computed, watch, onMounted, inject, provide } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { buildFilterQuery } from '@/composable/commonFunction';
import { resolveCardRange, formatMinutes } from '@/composable/useResourceWorkload';
import CardSkeleton from '@/components/atom/CardSkeleton/CardSkeleton.vue';
import TaskDetail from '@/views/TaskDetail/TaskDetail.vue';

// Member self-card — completion scorecard for the selected window with KPIs
// (completed / on-estimate % / on-time % / streak) plus tabs that bucket the
// completed tasks by outcome. Self-scoped on the backend (caller = req.uid).
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
const globalRange = inject('dashboardGlobalRange', null);
const timerange = computed(() => {
    const v = Number(props.cardData?.timerange);
    return Number.isFinite(v) && v >= 0 && v <= 8 ? v : 5; // default This Month; 0 = Auto
});

const userId = inject('$userId', ref(''));
const EMPTY = { completedCount: 0, onEstimateRate: null, onTimeRate: null, currentStreak: 0, recent: [] };
const data = ref({ ...EMPTY });
const loading = ref(false);
const loaded = ref(false);
const activeTab = ref('wins');

const pctLabel = (v) => (v === null || v === undefined ? '—' : v + '%');

// Per-row reason chip — tab-aware, so Overdue vs Needs-Improvement rows read
// clearly differently: Overdue shows how late; Needs-Improvement shows how much
// over estimate; Achievements shows the clean win.
const daysLate = (t) => {
    if (!t.dueDate || !t.completedAt) return null;
    const due = new Date(t.dueDate); due.setHours(23, 59, 59, 999);
    const d = Math.ceil((new Date(t.completedAt).getTime() - due.getTime()) / 86400000);
    return d > 0 ? d : null;
};
const reasonClass = computed(() => (activeTab.value === 'overdue' ? 'reason-late' : activeTab.value === 'needs' ? 'reason-over' : 'reason-ok'));
const reasonText = (t) => {
    if (activeTab.value === 'overdue') { const dl = daysLate(t); return dl ? `${dl}d late` : 'Late'; }
    if (activeTab.value === 'needs') { const over = (t.logged || 0) - (t.estimate || 0); return over > 0 ? `+${formatMinutes(over)} over` : 'Over est.'; }
    return 'On time';
};
const reasonTitle = (t) => {
    if (activeTab.value === 'overdue') { const dl = daysLate(t); return dl ? `Completed ${dl} day(s) after the due date` : 'Completed after the due date'; }
    if (activeTab.value === 'needs') { return `Logged ${formatMinutes(t.logged)} vs ${t.estimate ? formatMinutes(t.estimate) : '—'} estimate`; }
    return 'Completed on time and within estimate';
};

// Outcome buckets — MUTUALLY EXCLUSIVE (each completed task lands in exactly
// one), so the tabs don't overlap and their counts sum to completedCount.
// Precedence: a missed deadline is the bigger miss, so "Overdue" wins over
// "Needs Improvement".
//   Overdue          = late (onTime === false), whatever the estimate
//   Needs Improve.   = on time BUT over estimate (met deadline, underestimated)
//   Achievements     = on time AND within (or no) estimate — a clean delivery
const overdue = computed(() => data.value.recent.filter((r) => r.onTime === false));
const needs = computed(() => data.value.recent.filter((r) => r.onTime !== false && r.within === false));
const wins = computed(() => data.value.recent.filter((r) => r.onTime !== false && r.within !== false));

const tabs = computed(() => [
    { key: 'wins', label: t('dashboardCard.ach_tab_wins'), items: wins.value, empty: t('dashboardCard.ach_tab_wins_empty') },
    { key: 'overdue', label: t('dashboardCard.ach_tab_overdue'), items: overdue.value, empty: t('dashboardCard.ach_tab_overdue_empty') },
    { key: 'needs', label: t('dashboardCard.ach_tab_needs'), items: needs.value, empty: t('dashboardCard.ach_tab_needs_empty') },
]);
const activeTabDef = computed(() => tabs.value.find((x) => x.key === activeTab.value) || tabs.value[0]);
const activeItems = computed(() => activeTabDef.value.items);

const load = async () => {
    loading.value = true;
    try {
        const { dateFrom, dateTo } = resolveCardRange(timerange.value, globalRange && globalRange.value);
        const fd = Array.isArray(props.filterData) ? props.filterData : Object.values(props.filterData || {});
        const taskMatch = fd.length ? buildFilterQuery(fd, userId && userId.value ? String(userId.value) : '') : null;
        const res = await apiRequest('post', `${env.MY_ACHIEVEMENTS}`, { dateFrom, dateTo, taskMatch });
        const d = res && res.data && res.data.status ? (res.data.data || {}) : {};
        data.value = { ...EMPTY, ...d, recent: d.recent || [] };
        loaded.value = true;
    } catch (e) {
        console.error('MyAchievementsCard fetch error:', e);
        data.value = { ...EMPTY };
    } finally {
        loading.value = false;
    }
};

// ─── Task-detail sidebar (same pattern as the other cards) ───
const companyId = inject('$companyId', ref(''));
const isTaskDetail = ref(false);
const detailProjectId = ref('');
const detailSprintId = ref('');
const detailTaskId = ref('');
function openTaskDetail(t) {
    if (!t || !t.taskId || !t.projectId) return;
    detailProjectId.value = t.projectId;
    detailSprintId.value = t.sprintId || '';
    detailTaskId.value = t.taskId;
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
watch(() => props.filterData, load, { deep: true });
watch(() => globalRange && globalRange.value, () => { if (timerange.value === 0) load(); }, { deep: true });
onMounted(load);
</script>

<style scoped>
.ach { height: 100%; width: 100%; padding: 8px 10px; overflow: auto; display: flex; flex-direction: column; gap: 8px; }
.ach-msg { color: #9aa0b4; font-size: 12px; padding: 8px 0; }
.ach-stats { display: flex; gap: 8px; }
.ach-stat { flex: 1; background: #f5f7fb; border-radius: 8px; padding: 8px 4px; text-align: center; }
.ach-num { font-size: 22px; font-weight: 700; color: #2f3546; line-height: 1.1; }
.ach-ok { color: #0f766e; }
.ach-streak { color: #b45309; }
.ach-fire { font-size: 13px; margin-left: 2px; }
.ach-label { font-size: 10px; color: #6b7280; margin-top: 3px; }
.ach-tabs { display: flex; gap: 4px; border-bottom: 1px solid #eef0f6; }
.ach-tab { border: none; background: none; padding: 6px 8px; font-size: 11.5px; color: #6b7280; cursor: pointer; border-bottom: 2px solid transparent; display: inline-flex; align-items: center; gap: 5px; }
.ach-tab:hover { color: #3a3f52; }
.ach-tab.active { color: #0d9488; border-bottom-color: #0d9488; font-weight: 600; }
.ach-tab-count { font-size: 10px; background: #eef2f7; color: #6b7280; border-radius: 8px; padding: 0 6px; }
.ach-tab.active .ach-tab-count { background: #d1fae5; color: #047857; }
.ach-list { display: flex; flex-direction: column; }
.ach-row { display: flex; align-items: center; gap: 8px; padding: 5px 2px; border-bottom: 1px solid #f4f5f9; font-size: 11.5px; }
.ach-task { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #3a3f52; }
.ach-task-link { cursor: pointer; }
.ach-task-link:hover { color: #0e7490; text-decoration: underline; }
.ach-key { color: #0e7490; font-size: 10.5px; }
.ach-hours { flex: none; color: #6b7280; font-variant-numeric: tabular-nums; white-space: nowrap; }
.ach-reason { flex: none; min-width: 68px; text-align: center; font-size: 10px; font-weight: 600; padding: 1px 8px; border-radius: 8px; white-space: nowrap; }
.reason-ok { background: #d1fae5; color: #047857; }
.reason-late { background: #fee2e2; color: #b91c1c; }
.reason-over { background: #fef3c7; color: #b45309; }
</style>
