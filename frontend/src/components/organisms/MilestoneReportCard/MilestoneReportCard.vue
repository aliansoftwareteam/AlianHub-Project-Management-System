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

            <!-- Recent milestones mini-list (amounts consolidated to USD) -->
            <div v-if="data.recent.length" class="mrc-recent">
                <div class="mrc-section-title">{{ $t('dashboardCard.recent_milestones') }}</div>
                <ul class="mrc-list">
                    <li v-for="(m, i) in data.recent" :key="i" class="mrc-item">
                        <span class="mrc-dot" :style="dotStyle(m.status)"></span>
                        <span class="mrc-item-main">
                            <span class="mrc-item-name" :title="m.milestoneName">{{ m.milestoneName || '—' }}</span>
                            <span class="mrc-item-project" :title="m.projectName">{{ m.projectName }}</span>
                        </span>
                        <span class="mrc-item-amount">{{ usd(m.amountUsd) }}</span>
                    </li>
                </ul>
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
.mrc-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.mrc-item { display: flex; align-items: center; gap: 8px; min-width: 0; }
.mrc-item-main { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.mrc-item-name { font-size: 12px; color: #3a3f52; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mrc-item-project { font-size: 11px; color: #9aa0b4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mrc-item-amount { font-size: 12px; font-weight: 600; color: #0f766e; white-space: nowrap; }
.mrc-footer { flex: 0 0 auto; margin-top: 8px; border-top: 1px solid #eef0f6; padding-top: 8px; display: flex; flex-direction: column; align-items: center; gap: 2px; }
.mrc-alltime { font-size: 11px; color: #9aa0b4; }
.mrc-link { font-size: 12px; color: #0d9488; cursor: pointer; text-decoration: none; }
.mrc-link:hover { text-decoration: underline; }
</style>
