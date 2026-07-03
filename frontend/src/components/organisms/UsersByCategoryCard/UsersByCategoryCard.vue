<template>
    <div class="ubc">
        <!-- Loading skeleton -->
        <template v-if="loading && !report.rows.length">
            <div class="ubc-skel-bar"></div>
            <div v-for="n in 5" :key="n" class="ubc-skel-row"><div class="ubc-skel"></div></div>
        </template>

        <!-- Not configured yet — the category template lives in the card's
             settings (the gear icon opens the standard edit-card modal). -->
        <div v-else-if="!isConfigured" class="ubc-config">
            <svg viewBox="0 0 48 48" width="40" height="40" fill="none" aria-hidden="true">
                <rect x="6" y="9" width="36" height="7" rx="2" fill="#E5E7F5"/>
                <rect x="6" y="20.5" width="26" height="7" rx="2" fill="#EDEFF7"/>
                <rect x="6" y="32" width="30" height="7" rx="2" fill="#F1F3F9"/>
            </svg>
            <p class="ubc-config-title">{{ $t('dashboardCard.users_by_category_card_title') }}</p>
            <p class="ubc-config-text">Open this card's settings (the ⚙ icon) and assign your task types to categories (Development, Marketing, UI/UX, QA) to see the task count per person.</p>
        </div>

        <!-- Configured but nothing logged in the window -->
        <div v-else-if="!report.rows.length" class="ubc-empty">
            <p>{{ $t('dashboardCard.no_data_available') }}</p>
        </div>

        <!-- Data -->
        <template v-else>
            <div class="ubc-head">
                <span class="ubc-users-badge">{{ report.userCount }} {{ report.userCount === 1 ? 'user' : 'users' }}</span>
                <span v-if="loading" class="ubc-refreshing"><span class="ubc-mini-spinner" aria-hidden="true"></span>Loading…</span>
            </div>

            <!-- Short explanatory note so the numbers read as task counts. -->
            <p class="ubc-note">
                <svg viewBox="0 0 16 16" width="12" height="12" fill="none" aria-hidden="true">
                    <circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.3"/>
                    <line x1="8" y1="7.3" x2="8" y2="11.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
                    <circle cx="8" cy="4.6" r="0.9" fill="currentColor"/>
                </svg>
                <span>{{ $t('dashboardCard.users_by_category_hint') }}</span>
            </p>

            <!-- Summary: team split as a horizontal stacked bar + legend -->
            <div class="ubc-summary">
                <div class="ubc-stack" :title="`Total ${report.totals.grand} ${report.totals.grand === 1 ? 'task' : 'tasks'}`">
                    <span
                        v-for="seg in summarySegments"
                        :key="seg.key"
                        class="ubc-stack-seg"
                        :style="{ width: seg.pct + '%', background: seg.color }"
                        :title="`${seg.label}: ${seg.count} ${seg.count === 1 ? 'task' : 'tasks'} (${Math.round(seg.pct)}%)`"
                    ></span>
                </div>
                <div class="ubc-legend">
                    <span v-for="seg in summarySegments" :key="seg.key" class="ubc-legend-item">
                        <span class="ubc-legend-dot" :style="{ background: seg.color }"></span>
                        <span class="ubc-legend-label">{{ seg.label }}</span>
                        <span class="ubc-legend-val">{{ seg.count }}</span>
                    </span>
                </div>
            </div>

            <!-- Per-user table -->
            <div class="ubc-table-wrap">
                <table class="ubc-table">
                    <thead>
                        <tr>
                            <th class="ubc-th-user" @click="setSort('userName')">User {{ sortIndicator('userName') }}</th>
                            <th v-for="col in columns" :key="col.key" class="ubc-th-num" @click="setSort(col.key)">
                                <span class="ubc-col-dot" :style="{ background: col.color }"></span>{{ col.label }} {{ sortIndicator(col.key) }}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="row in sortedRows" :key="row.userId">
                            <td class="ubc-td-user">
                                <UserProfile
                                    :data="{ image: getUserProfile(row.userId).Employee_profileImageURL, title: row.userName }"
                                    :showDot="getUserProfile(row.userId).isOnline"
                                    width="26px"
                                    :thumbnail="'30x30'"
                                />
                                <span class="ubc-user-name" :title="row.userName">{{ row.userName }}</span>
                            </td>
                            <td v-for="col in columns" :key="col.key" class="ubc-td-num">
                                <span v-if="cellCount(row, col) > 0">{{ cellCount(row, col) }}</span>
                                <span v-else class="ubc-zero">—</span>
                            </td>
                        </tr>
                    </tbody>
                    <tfoot>
                        <tr class="ubc-total-row">
                            <td class="ubc-total-label">Total</td>
                            <td v-for="col in columns" :key="col.key" class="ubc-td-num">{{ colTotal(col) }}</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </template>
    </div>
</template>

<script>
export default { name: 'UsersByCategoryCard' };
</script>

<script setup>
import { ref, computed, watch, onMounted, inject } from 'vue';
import { useStore } from 'vuex';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { teamIdToUserId } from '@/composable/commonFunction';
import UserProfile from '@/components/atom/UserProfile/UserProfile.vue';

// AHE-3789 — "Work by Category" card. Buckets each user's logged hours into a
// category → task-type template and shows a team-split summary bar + a sortable
// per-user table. All filters (projects / teams-users / include-subtasks + the
// category template) live in the STANDARD edit-card settings modal, saved into
// this card's cardData — no separate config modal. Period + refresh live in the
// card chrome. Read-only; fetches the additive POST /dashboard/project-metrics.
const props = defineProps({
    cardUID: { type: [String, Number], default: '' },
    componentId: { type: String, default: '' },
    cardData: { type: Object, default: () => ({}) },
    filterData: { type: Object, default: () => ({}) },
    refreshTrigger: { type: [Number, String], default: 0 },
    companyUserDetail: { type: Object, default: () => ({}) },
    allProjectsArrayFilter: { type: Array, default: () => [] },
    taskStatusArray: { type: [Array, Object], default: () => [] },
});

const { getters } = useStore();
const userIdRef = inject('$userId', ref(''));

const CAT_COLORS = ['#2F3990', '#0e7490', '#7c3aed', '#c2410c', '#16a34a', '#db2777'];
const DEFAULT_TIMERANGE = 3; // This Week

const teamsArr = computed(() => getters['settings/teams'] || []);
const storeUsers = computed(() => getters['users/users'] || []);
function getUserProfile(id) {
    return storeUsers.value.find((u) => String(u._id) === String(id)) || {};
}

// ─── Config (read straight from cardData — saved by the edit-card modal) ──
const cfg = computed(() => {
    const cd = props.cardData || {};
    return {
        categoryMap: (cd.categoryMap && typeof cd.categoryMap === 'object' && !Array.isArray(cd.categoryMap)) ? cd.categoryMap : {},
        projectIds: Array.isArray(cd.projectId) ? cd.projectId : [],
        assigneeIds: Array.isArray(cd.AssigneeUserId) ? cd.AssigneeUserId : [],
        includeSubtasks: cd.isParentTask !== false,
    };
});
const isConfigured = computed(() =>
    Object.values(cfg.value.categoryMap || {}).some((a) => Array.isArray(a) && a.length));
// 0 = Auto → follow the dashboard's global date range.
const normalizeTimerange = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 && n <= 8 ? n : DEFAULT_TIMERANGE;
};
const timerange = ref(normalizeTimerange(props.cardData?.timerange));
const globalRange = inject('dashboardGlobalRange', null);

// ─── Report data ────────────────────────────────────────────────
function emptyReport() {
    return { categories: [], rows: [], totals: { byCategory: {}, grand: 0 }, userCount: 0 };
}
const report = ref(emptyReport());
const loading = ref(false);

function catColor(i) { return CAT_COLORS[i % CAT_COLORS.length]; }
const columns = computed(() =>
    (report.value.categories || []).map((c, i) => ({ key: c, label: c, color: catColor(i) })));
const summarySegments = computed(() => {
    const r = report.value;
    const segs = (r.categories || []).map((c, i) => ({ key: c, label: c, count: (r.totals?.byCategory?.[c]) || 0, color: catColor(i) }));
    const total = segs.reduce((s, x) => s + x.count, 0) || 1;
    return segs.filter((s) => s.count > 0).map((s) => ({ ...s, pct: (s.count / total) * 100 }));
});
function cellCount(row, col) {
    return (row.categories && row.categories[col.key]) || 0;
}
function colTotal(col) {
    return report.value.totals?.byCategory?.[col.key] || 0;
}

// ─── Sorting ─────────────────────────────────────────────────────
const sortKey = ref('total');
const sortDir = ref('desc');
function setSort(key) {
    if (sortKey.value === key) sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc';
    else { sortKey.value = key; sortDir.value = key === 'userName' ? 'asc' : 'desc'; }
}
function sortIndicator(key) {
    if (sortKey.value !== key) return '';
    return sortDir.value === 'asc' ? '↑' : '↓';
}
const sortedRows = computed(() => {
    const rows = [...(report.value.rows || [])];
    const k = sortKey.value;
    const dir = sortDir.value === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
        if (k === 'userName') return String(a.userName || '').localeCompare(String(b.userName || '')) * dir;
        let av, bv;
        if (k === 'total') { av = a.total || 0; bv = b.total || 0; }
        else { av = (a.categories && a.categories[k]) || 0; bv = (b.categories && b.categories[k]) || 0; }
        return (av - bv) * dir;
    });
    return rows;
});

// ─── Helpers ─────────────────────────────────────────────────────
function resolveDateRange(value) {
    if (Number(value) === 0 && globalRange && globalRange.value && globalRange.value.dateFrom) {
        return { dateFrom: globalRange.value.dateFrom, dateTo: globalRange.value.dateTo };
    }
    const now = new Date();
    const start = new Date(now);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    const id = Number(value);
    switch (id) {
        case 1: { start.setHours(0, 0, 0, 0); return { dateFrom: start.toISOString(), dateTo: end.toISOString() }; }
        case 2: { start.setDate(start.getDate() - 1); start.setHours(0, 0, 0, 0); const e = new Date(start); e.setHours(23, 59, 59, 999); return { dateFrom: start.toISOString(), dateTo: e.toISOString() }; }
        case 4: { const d = start.getDay() === 0 ? 6 : start.getDay() - 1; start.setDate(start.getDate() - d - 7); start.setHours(0, 0, 0, 0); const e = new Date(start); e.setDate(e.getDate() + 6); e.setHours(23, 59, 59, 999); return { dateFrom: start.toISOString(), dateTo: e.toISOString() }; }
        case 5: { start.setDate(1); start.setHours(0, 0, 0, 0); return { dateFrom: start.toISOString(), dateTo: end.toISOString() }; }
        case 6: { start.setMonth(start.getMonth() - 1, 1); start.setHours(0, 0, 0, 0); const e = new Date(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59, 999); return { dateFrom: start.toISOString(), dateTo: e.toISOString() }; }
        case 7: { start.setMonth(0, 1); start.setHours(0, 0, 0, 0); return { dateFrom: start.toISOString(), dateTo: end.toISOString() }; }
        case 8: { start.setDate(start.getDate() - 30); start.setHours(0, 0, 0, 0); return { dateFrom: start.toISOString(), dateTo: end.toISOString() }; }
        case 3:
        default: { const d = start.getDay() === 0 ? 6 : start.getDay() - 1; start.setDate(start.getDate() - d); start.setHours(0, 0, 0, 0); return { dateFrom: start.toISOString(), dateTo: end.toISOString() }; }
    }
}
function cleanCategoryMap(map) {
    const out = {};
    Object.keys(map || {}).forEach((c) => {
        const arr = Array.isArray(map[c]) ? map[c].filter(Boolean) : [];
        if (arr.length) out[c] = arr;
    });
    return out;
}

// ─── Fetch ───────────────────────────────────────────────────────
async function load() {
    if (!isConfigured.value) { report.value = emptyReport(); return; }
    loading.value = true;
    try {
        const { dateFrom, dateTo } = resolveDateRange(timerange.value);
        const assignees = teamIdToUserId(cfg.value.assigneeIds || [], teamsArr.value);
        const payload = {
            metric: 'users_by_category',
            categoryMap: cleanCategoryMap(cfg.value.categoryMap),
            projectIds: cfg.value.projectIds || [],
            userIds: Array.isArray(assignees) ? assignees : [],
            includeSubtasks: cfg.value.includeSubtasks,
            dateFrom,
            dateTo,
            callerUserId: (userIdRef && userIdRef.value) ? String(userIdRef.value) : '',
            callerRoleType: Number(props.companyUserDetail?.roleType) || 3,
        };
        const resp = (await apiRequest('post', `${env.DASHBOARD}/project-metrics`, payload))?.data;
        report.value = (resp && resp.status && resp.data) ? { ...emptyReport(), ...resp.data } : emptyReport();
    } catch (e) {
        console.error('UsersByCategoryCard fetch error:', e);
        report.value = emptyReport();
    } finally {
        loading.value = false;
    }
}

// ─── Lifecycle ───────────────────────────────────────────────────
onMounted(load);
watch(() => props.refreshTrigger, load);
// Re-fetch whenever the saved config changes (edit-card save) or the chrome
// period changes.
watch(() => props.cardData, (cd) => {
    if (cd && cd.timerange !== undefined) timerange.value = normalizeTimerange(cd.timerange);
    load();
}, { deep: true });
// Auto mode — track the dashboard-level range.
watch(() => globalRange && globalRange.value, () => { if (timerange.value === 0) load(); }, { deep: true });
</script>

<style scoped>
.ubc { height: 100%; width: 100%; padding: 6px 8px; overflow: hidden; display: flex; flex-direction: column; font-family: Roboto, sans-serif; }

/* Header */
.ubc-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; flex-shrink: 0; }
.ubc-users-badge { font-size: 12px; font-weight: 600; color: #6B7280; }
.ubc-note { display: flex; align-items: flex-start; gap: 5px; font-size: 11px; color: #8b90a3; margin: 0 0 8px; line-height: 1.45; flex-shrink: 0; }
.ubc-note svg { flex-shrink: 0; margin-top: 1px; color: #a3a8ba; }
.ubc-refreshing { font-size: 11px; color: #9aa0b4; display: inline-flex; align-items: center; gap: 5px; }
.ubc-mini-spinner { width: 11px; height: 11px; border: 2px solid #d7dae6; border-top-color: #2F3990; border-radius: 50%; animation: ubc-spin .7s linear infinite; }
@keyframes ubc-spin { to { transform: rotate(360deg); } }

/* Config / empty */
.ubc-config { flex: 1 1 auto; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 12px; }
.ubc-config-title { font-size: 14px; font-weight: 600; color: #1F212A; margin: 8px 0 4px; }
.ubc-config-text { font-size: 12px; color: #6B7280; max-width: 320px; margin: 0; line-height: 1.5; }
.ubc-empty { flex: 1 1 auto; display: flex; align-items: center; justify-content: center; color: #9aa0b4; font-size: 12px; }

/* Summary */
.ubc-summary { flex-shrink: 0; margin-bottom: 8px; }
.ubc-stack { display: flex; width: 100%; height: 12px; border-radius: 6px; overflow: hidden; background: #F1F3F9; }
.ubc-stack-seg { height: 100%; transition: width .3s ease; }
.ubc-legend { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 8px; }
.ubc-legend-item { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: #4A5061; }
.ubc-legend-dot { width: 9px; height: 9px; border-radius: 2px; flex-shrink: 0; }
.ubc-legend-label { color: #4A5061; }
.ubc-legend-val { color: #1F212A; font-weight: 600; }

/* Table */
.ubc-table-wrap { flex: 1 1 auto; min-height: 0; overflow: auto; border: 1px solid #E5E7EB; border-radius: 8px; }
.ubc-table { width: 100%; border-collapse: collapse; font-size: 13px; color: #1F212A; }
.ubc-table thead th { position: sticky; top: 0; z-index: 3; background: #FAFBFC; color: #4A5061; font-weight: 600; text-align: left; padding: 9px 10px; border-bottom: 1px solid #E5E7EB; box-shadow: inset 0 -1px 0 #E5E7EB; white-space: nowrap; cursor: pointer; user-select: none; box-sizing: border-box; }
.ubc-th-num { text-align: center; }
.ubc-col-dot { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 5px; vertical-align: middle; }
.ubc-table tbody td { padding: 8px 10px; border-bottom: 1px solid #F1F3F9; vertical-align: middle; }
.ubc-table tbody tr:hover td { background: #FAFBFC; }
.ubc-td-user { display: flex; align-items: center; gap: 8px; max-width: 220px; }
.ubc-user-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.ubc-td-num { text-align: center; white-space: nowrap; font-variant-numeric: tabular-nums; }
.ubc-zero { color: #cbd0dd; }
.ubc-total-row td { position: sticky; bottom: 0; z-index: 2; background: #F7F8FB; border-top: 1px solid #E5E7EB; box-shadow: inset 0 1px 0 #E5E7EB; font-weight: 600; padding: 9px 10px; }
.ubc-total-label { color: #4A5061; }

/* Skeleton */
.ubc-skel-bar { height: 12px; border-radius: 6px; margin-bottom: 12px; background: linear-gradient(90deg, #eef0f6 25%, #e3e7f1 37%, #eef0f6 63%); background-size: 400% 100%; animation: ubc-shim 1.4s ease infinite; }
.ubc-skel-row { padding: 6px 4px; }
.ubc-skel { height: 16px; border-radius: 4px; background: linear-gradient(90deg, #eef0f6 25%, #e3e7f1 37%, #eef0f6 63%); background-size: 400% 100%; animation: ubc-shim 1.4s ease infinite; }
@keyframes ubc-shim { 0% { background-position: 100% 0; } 100% { background-position: 0 0; } }
</style>
