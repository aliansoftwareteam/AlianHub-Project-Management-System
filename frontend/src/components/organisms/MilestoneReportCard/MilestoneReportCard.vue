<template>
    <div class="mrc">
        <CardSkeleton v-if="loading" :counters="2" :rows="4" />

        <!-- Owner/Admin only. Non-management users should never see this card
             (it's filtered out of the catalog), but guard the content too. -->
        <div v-else-if="!isManagement" class="mrc-msg">{{ $t('dashboardCard.milestone_management_only') }}</div>

        <template v-else>
            <!-- Scrollable content; the "View full report" footer is pinned
                 below this area so it stays visible without scrolling. -->
            <div class="mrc-scroll">
            <!-- Hero: single consolidated tile — total RECEIVABLE (USD) for the
                 selected period, with the received vs outstanding split. -->
            <div class="mrc-hero">
                <div class="mrc-hero-top">
                    <span class="mrc-hero-label">{{ $t('dashboardCard.milestone_receivable') }}</span>
                    <span class="mrc-hero-period">{{ periodLabel }}</span>
                </div>
                <div class="mrc-hero-amount">{{ usd(data.due.receivableUsd) }}</div>
                <div class="mrc-hero-sub">{{ data.due.receivableCount }} {{ $t('dashboardCard.milestones') }}</div>

                <!-- Received (green) fills from the left; the remaining track is
                     Outstanding (amber). -->
                <div class="mrc-split-track" :title="receivedPct + '% ' + $t('dashboardCard.milestone_received')">
                    <div class="mrc-split-fill" :style="{ width: receivedPct + '%' }"></div>
                </div>
                <div class="mrc-split-legend">
                    <span class="mrc-leg">
                        <span class="mrc-leg-dot mrc-leg-dot--received"></span>
                        {{ $t('dashboardCard.milestone_received') }} <b>{{ usd(data.due.receivedUsd) }}</b>
                    </span>
                    <span class="mrc-leg">
                        <span class="mrc-leg-dot mrc-leg-dot--outstanding"></span>
                        {{ $t('dashboardCard.milestone_outstanding') }} <b>{{ usd(data.due.outstandingUsd) }}</b>
                    </span>
                </div>
            </div>

            <!-- Nothing due in the selected period (whole card is period-scoped). -->
            <div v-if="!data.byStatus.length && !data.recent.length" class="mrc-msg">
                {{ $t('dashboardCard.milestone_none_in_period') }}
            </div>

            <!-- By status mini-bars — also the status filter selector. Click a
                 row to drill the recent list into that status. -->
            <div v-if="data.byStatus.length" class="mrc-status">
                <div class="mrc-section-title">
                    <span>{{ $t('dashboardCard.milestone_by_status') }}</span>
                    <button v-if="selectedStatus" type="button" class="mrc-clear" title="Clear status filter" @click="clearStatus">
                        {{ statusLabel(selectedStatus) }} ✕
                    </button>
                </div>
                <div class="mrc-bars">
                    <div
                        v-for="row in data.byStatus"
                        :key="row.status"
                        class="mrc-bar-row"
                        :class="{ 'mrc-bar-row--active': selectedStatus === row.status, 'mrc-bar-row--dim': selectedStatus && selectedStatus !== row.status }"
                        role="button"
                        :title="`Filter by ${statusLabel(row.status)}`"
                        @click="toggleStatus(row.status)"
                    >
                        <span class="mrc-dot" :style="dotStyle(row.status)"></span>
                        <span class="mrc-status-label">{{ statusLabel(row.status) }}</span>
                        <div class="mrc-track"><div class="mrc-fill" :style="{ width: statusPct(row.count) + '%' }"></div></div>
                        <span class="mrc-val">{{ row.count }}</span>
                    </div>
                </div>
            </div>

            <!-- Milestone timeline table: rows ordered by due date (past →
                 today → upcoming) with dedicated Milestone / Date / Amount
                 columns. The status dot still encodes the billing status; the
                 Date cell carries a temporal pill (Overdue / Past / Due today /
                 Upcoming) relative to today. -->
            <div v-if="data.recent.length" class="mrc-recent">
                <div class="mrc-section-title">{{ $t('dashboardCard.milestone_timeline') }}</div>
                <table class="mrc-table">
                    <thead>
                        <tr>
                            <th class="mrc-th mrc-th--name">{{ $t('dashboardCard.milestone_col_name') }}</th>
                            <th class="mrc-th mrc-th--date">{{ $t('dashboardCard.milestone_col_date') }}</th>
                            <th class="mrc-th mrc-th--amount">{{ $t('dashboardCard.milestone_col_amount') }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="(m, i) in data.recent" :key="i" class="mrc-tr">
                            <td class="mrc-td mrc-td--name">
                                <span class="mrc-dot" :style="dotStyle(m.status)"></span>
                                <span class="mrc-item-main">
                                    <span
                                        class="mrc-item-name"
                                        :class="{ 'mrc-item-name--link': m.projectId }"
                                        :role="m.projectId ? 'button' : null"
                                        :title="m.projectId ? $t('dashboardCard.milestone_open_project') : m.milestoneName"
                                        @click="openProject(m)"
                                    >{{ m.milestoneName || '—' }}</span>
                                    <span class="mrc-item-project" :title="m.projectName">{{ m.projectName }}</span>
                                </span>
                            </td>
                            <td class="mrc-td mrc-td--date">
                                <span class="mrc-due">{{ formatDue(m.dueDate) || '—' }}</span>
                                <span
                                    v-if="whenOf(m)"
                                    class="mrc-when"
                                    :class="'mrc-when--' + whenOf(m).key"
                                >{{ whenOf(m).label }}</span>
                            </td>
                            <td class="mrc-td mrc-td--amount">{{ usd(m.amountUsd) }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            </div>

            <!-- Pinned footer (outside the scroll area): all-time consolidated
                 total + open the full report in a new tab. -->
            <div class="mrc-footer">
                <span class="mrc-alltime">
                    {{ $t('dashboardCard.milestone_all_time') }}: {{ usd(data.allTime.totalUsd) }}
                    <template v-if="!data.ratesLive"> · {{ $t('dashboardCard.milestone_rates_approx') }}</template>
                </span>
                <a class="mrc-link" role="button" @click="openReport">{{ $t('dashboardCard.view_full_report') }}</a>
            </div>
        </template>
    </div>
</template>

<script>
export default { name: 'MilestoneReportCard' };
</script>

<script setup>
import { ref, computed, watch, inject, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { resolveCardRange } from '@/composable/useResourceWorkload';
import CardSkeleton from '@/components/atom/CardSkeleton/CardSkeleton.vue';

// Company-wide billing-milestone report for the management dashboard.
// Self-fetching from POST /api/v1/dashboard/milestone-summary. Owner/Admin
// only — the server also gates the data and returns an empty payload for
// anyone else. All money is consolidated to USD server-side (live FX rates).
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

const { t: translate } = useI18n();
const route = useRoute();
const router = useRouter();

const data = ref({
    currency: 'USD',
    due: { receivableUsd: 0, receivedUsd: 0, outstandingUsd: 0, receivableCount: 0, receivedCount: 0 },
    allTime: { totalUsd: 0, count: 0 },
    byStatus: [], recent: [], totalCount: 0, period: null, ratesLive: true,
});
const loading = ref(false);
const selectedStatus = ref(''); // active status drill-down ('' = all)

const isManagement = computed(() => [1, 2].includes(props.companyUserDetail?.roleType));

// Shared card period: 0 = Auto → follow the dashboard's global range. The
// period dropdown lives in the card header (HomePage PROJECT_PERIOD_CARDS);
// we just consume cardData.timerange and resolve it to a date window.
const globalRange = inject('dashboardGlobalRange', null);
const timerange = computed(() => {
    const v = Number(props.cardData?.timerange);
    return Number.isFinite(v) && v >= 0 && v <= 8 ? v : 5; // default: This Month
});
const PERIOD_LABELS = {
    0: 'Auto', 1: 'Today', 2: 'Yesterday', 3: 'This Week', 4: 'Last Week',
    5: 'This Month', 6: 'Last Month', 7: 'This Year', 8: 'Last 30 Days',
};
const periodLabel = computed(() => PERIOD_LABELS[timerange.value] || 'This Month');

const maxStatus = computed(() => data.value.byStatus.reduce((m, r) => Math.max(m, r.count || 0), 0) || 1);
const statusPct = (v) => Math.round(((v || 0) / maxStatus.value) * 100);

// Received portion of the period's receivable, for the split bar (0–100%).
const receivedPct = computed(() => {
    const r = Number(data.value.due?.receivableUsd) || 0;
    if (r <= 0) return 0;
    return Math.min(100, Math.round(((Number(data.value.due?.receivedUsd) || 0) / r) * 100));
});

// USD money formatter — "$ 1,234.56".
const usd = (n) => `$ ${(Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

// Due-date formatter — "Jun 12" (adds the year only when it isn't the current
// one, e.g. a range spanning New Year).
const formatDue = (ms) => {
    const t = Number(ms) || 0;
    if (t <= 0) return '';
    const d = new Date(t);
    const opts = { month: 'short', day: 'numeric' };
    if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    return d.toLocaleDateString(undefined, opts);
};

// Temporal bucket of a milestone relative to TODAY, driving the timeline pill.
// dueDate before today = past, today = present, after = future. A past-due
// milestone that's already RELEASED is settled, so it reads as "Past" (neutral)
// rather than the alarming "Overdue" — the dot already shows it's released.
const whenOf = (m) => {
    const t = Number(m && m.dueDate) || 0;
    if (t <= 0) return null;
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const endToday = startToday + 24 * 60 * 60 * 1000 - 1;
    if (t > endToday) return { key: 'future', label: translate('dashboardCard.milestone_upcoming') };
    if (t >= startToday) return { key: 'present', label: translate('dashboardCard.milestone_due_today') };
    const settled = String(m.status || '') === 'RELEASED';
    return settled
        ? { key: 'past', label: translate('dashboardCard.milestone_past') }
        : { key: 'overdue', label: translate('dashboardCard.milestone_overdue') };
};

// Milestone status is a billing enum (RELEASED / FUNDED / NOT_FUNDED /
// RELEASE_REQUEST_SENT / empty). Map each to a human-readable label + colour
// (matching the full Milestone Report); unknown values are title-cased so a
// new enum never shows raw underscores.
const STATUS_META = {
    RELEASED:             { label: 'Released',             color: '#1c7a43' },
    FUNDED:               { label: 'Funded',               color: '#0d9488' },
    NOT_FUNDED:           { label: 'Not Funded',           color: '#e08a1e' },
    RELEASE_REQUEST_SENT: { label: 'Release Request Sent', color: '#3b6fe0' },
};
const titleCase = (s) => String(s).toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const statusMeta = (status) => {
    if (!status || status === 'No Status') return { label: 'No Status', color: '#cbd2e0' };
    return STATUS_META[status] || { label: titleCase(status), color: '#cbd2e0' };
};
const statusLabel = (status) => statusMeta(status).label;
const dotStyle = (status) => ({ backgroundColor: statusMeta(status).color });

const load = async () => {
    if (!isManagement.value) return;
    loading.value = true;
    try {
        // Period window (This Month by default) → the "due milestones" panel.
        const { dateFrom, dateTo } = resolveCardRange(timerange.value, globalRange && globalRange.value);
        const payload = { dateFrom, dateTo };
        if (selectedStatus.value) payload.status = selectedStatus.value;
        const res = await apiRequest('post', `${env.MILESTONE_SUMMARY}`, payload);
        const body = res && res.data;
        if (body && body.status && body.data) {
            const d = body.data;
            data.value = {
                currency: d.currency || 'USD',
                due: d.due || { receivableUsd: 0, receivedUsd: 0, outstandingUsd: 0, receivableCount: 0, receivedCount: 0 },
                allTime: d.allTime || { totalUsd: 0, count: 0 },
                byStatus: d.byStatus || [],
                recent: d.recent || [],
                totalCount: d.totalCount || 0,
                period: d.period || null,
                ratesLive: d.ratesLive !== false,
            };
        }
    } catch (e) {
        console.error('MilestoneReportCard fetch error:', e);
    } finally {
        loading.value = false;
    }
};

// Status filter (drill-down): clicking a By-Status row filters the recent list
// to that status; clicking the same row (or the ✕) clears. byStatus always
// returns full from the server, so the selector stays intact.
const toggleStatus = (status) => {
    selectedStatus.value = selectedStatus.value === status ? '' : status;
    load();
};
const clearStatus = () => {
    if (!selectedStatus.value) return;
    selectedStatus.value = '';
    load();
};

const openReport = () => {
    const cid = route.params.cid;
    if (!cid) return;
    // Open the full Milestone Report in a NEW TAB (resolve the SPA route → URL).
    const routeData = router.resolve({ name: 'Milestone Report', params: { cid } });
    window.open(routeData.href, '_blank', 'noopener');
};

// Clicking a milestone title opens its parent project's detail page (same
// route + query the Milestone Report uses). No-op when the row has no project.
const openProject = (m) => {
    const cid = route.params.cid;
    if (!cid || !m || !m.projectId) return;
    router.push({ name: 'Project', params: { cid, id: m.projectId }, query: { tab: 'ProjectDetail' } });
};

watch(() => props.refreshTrigger, load);
// Re-fetch when the header period dropdown changes (writes cardData.timerange).
watch(() => props.cardData, load, { deep: true });
// Auto mode — track the dashboard-level range.
watch(() => globalRange && globalRange.value, () => { if (timerange.value === 0) load(); }, { deep: true });
onMounted(load);
</script>

<style scoped>
.mrc { height: 100%; width: 100%; padding: 10px 12px; overflow: hidden; display: flex; flex-direction: column; }
.mrc-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; display: flex; flex-direction: column; gap: 12px; padding-right: 8px; }
.mrc-msg { color: #9aa0b4; font-size: 12px; padding: 8px 0; }
.mrc-section-title { font-size: 12px; font-weight: 600; color: #3a3f52; margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.mrc-clear { border: none; background: none; padding: 0; font-size: 11px; font-weight: 600; color: #0d9488; cursor: pointer; white-space: nowrap; }
.mrc-clear:hover { text-decoration: underline; }

/* Hero: single consolidated receivable tile + received/outstanding split. */
.mrc-hero { background: #f5f7fb; border-radius: 10px; padding: 14px; }
.mrc-hero-top { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.mrc-hero-label { font-size: 12px; font-weight: 600; color: #3a3f52; text-transform: uppercase; letter-spacing: .02em; }
.mrc-hero-period { font-size: 11px; font-weight: 600; color: #0d9488; white-space: nowrap; }
.mrc-hero-amount { font-size: 28px; font-weight: 700; color: #0f766e; line-height: 1.15; margin-top: 2px; word-break: break-word; }
.mrc-hero-sub { font-size: 11px; color: #6b7280; margin-top: 2px; }
.mrc-split-track { position: relative; height: 8px; border-radius: 5px; background: #f0a54a; overflow: hidden; margin-top: 12px; }
.mrc-split-fill { height: 100%; background: #28c76f; }
.mrc-split-legend { display: flex; flex-wrap: wrap; gap: 6px 16px; margin-top: 8px; }
.mrc-leg { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: #3a3f52; }
.mrc-leg b { font-weight: 700; }
.mrc-leg-dot { width: 9px; height: 9px; border-radius: 50%; flex: 0 0 auto; }
.mrc-leg-dot--received { background: #28c76f; }
.mrc-leg-dot--outstanding { background: #f0a54a; }

.mrc-bars { display: flex; flex-direction: column; gap: 6px; }
.mrc-bar-row { display: flex; align-items: center; gap: 8px; min-width: 0; cursor: pointer; padding: 2px 4px; margin: 0 -4px; border-radius: 6px; transition: background .12s ease, opacity .12s ease; }
.mrc-bar-row:hover { background: #f5f7fb; }
.mrc-bar-row--active { background: #eaf5f2; }
.mrc-bar-row--dim { opacity: .5; }
.mrc-dot { width: 10px; height: 10px; border-radius: 50%; flex: 0 0 auto; }
.mrc-status-label { width: 30%; font-size: 12px; color: #3a3f52; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mrc-track { flex: 1; height: 12px; background: #eef0f6; border-radius: 4px; overflow: hidden; }
.mrc-fill { height: 100%; background: #0d9488; }
.mrc-val { width: 34px; text-align: right; font-size: 12px; color: #3a3f52; }
/* Timeline table: dedicated Milestone / Date / Amount columns. */
.mrc-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.mrc-th { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .02em; color: #9aa0b4; text-align: left; padding: 0 8px 6px 0; border-bottom: 1px solid #eef0f6; }
/* Date + Amount are fixed-width; Milestone (no width) absorbs the rest. */
.mrc-th--date { width: 92px; }
.mrc-th--amount { width: 96px; text-align: right; padding-right: 0; }
.mrc-tr { border-bottom: 1px solid #f4f5f9; }
.mrc-tr:last-child { border-bottom: none; }
.mrc-td { padding: 7px 8px 7px 0; vertical-align: middle; font-size: 12px; color: #3a3f52; }
.mrc-td--name { display: flex; align-items: center; gap: 8px; min-width: 0; }
.mrc-td--amount { text-align: right; font-weight: 600; color: #0f766e; white-space: nowrap; padding-right: 0; }
.mrc-item-main { display: flex; flex-direction: column; min-width: 0; }
.mrc-item-name { font-size: 12px; color: #3a3f52; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mrc-item-name--link { cursor: pointer; }
.mrc-item-name--link:hover { color: #0d9488; text-decoration: underline; }
.mrc-item-project { font-size: 11px; color: #9aa0b4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mrc-due { display: block; font-size: 12px; color: #3a3f52; white-space: nowrap; }

/* Temporal pill: past → present → future within the selected range. */
.mrc-when { display: inline-block; margin-top: 2px; font-size: 10px; font-weight: 600; line-height: 1.4; padding: 1px 6px; border-radius: 9px; white-space: nowrap; }
.mrc-when--overdue { color: #b42318; background: #fde8e6; }
.mrc-when--past { color: #5b6472; background: #eef0f6; }
.mrc-when--present { color: #0f766e; background: #d5f2ec; }
.mrc-when--future { color: #2f52c4; background: #e6ecfb; }
.mrc-footer { flex: 0 0 auto; margin-top: 8px; border-top: 1px solid #eef0f6; padding-top: 8px; display: flex; flex-direction: column; align-items: center; gap: 2px; }
.mrc-alltime { font-size: 11px; color: #9aa0b4; }
.mrc-link { font-size: 12px; color: #0d9488; cursor: pointer; text-decoration: none; }
.mrc-link:hover { text-decoration: underline; }
</style>
