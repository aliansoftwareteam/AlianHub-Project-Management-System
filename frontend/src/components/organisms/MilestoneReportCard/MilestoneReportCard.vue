<template>
    <div class="mrc">
        <CardSkeleton v-if="loading" :counters="2" :rows="4" />

        <!-- Owner/Admin only. Non-management users should never see this card
             (it's filtered out of the catalog), but guard the content too. -->
        <div v-else-if="!isManagement" class="mrc-msg">{{ $t('dashboardCard.milestone_management_only') }}</div>

        <template v-else>
            <!-- Totals by currency -->
            <div class="mrc-totals">
                <div v-if="!data.totalsByCurrency.length" class="mrc-msg">{{ $t('dashboardCard.no_milestones') }}</div>
                <div v-else class="mrc-total-grid">
                    <div v-for="row in data.totalsByCurrency" :key="row.currency" class="mrc-total">
                        <div class="mrc-total-amount">{{ row.currency }} {{ formatAmount(row.totalAmount) }}</div>
                        <div class="mrc-total-label">{{ row.count }} {{ $t('dashboardCard.milestones') }}</div>
                    </div>
                </div>
            </div>

            <!-- By status mini-bars — also the status filter selector. Click a
                 row to drill the totals + recent list into that status. -->
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

            <!-- Recent milestones mini-list -->
            <div v-if="data.recent.length" class="mrc-recent">
                <div class="mrc-section-title">{{ $t('dashboardCard.recent_milestones') }}</div>
                <ul class="mrc-list">
                    <li v-for="(m, i) in data.recent" :key="i" class="mrc-item">
                        <span class="mrc-dot" :style="dotStyle(m.status)"></span>
                        <span class="mrc-item-main">
                            <span class="mrc-item-name" :title="m.milestoneName">{{ m.milestoneName || '—' }}</span>
                            <span class="mrc-item-project" :title="m.projectName">{{ m.projectName }}</span>
                        </span>
                        <span class="mrc-item-amount">{{ m.currency }} {{ formatAmount(m.amount) }}</span>
                    </li>
                </ul>
            </div>

            <!-- Link to the full Milestone Report page -->
            <div class="mrc-footer">
                <a class="mrc-link" role="button" @click="openReport">{{ $t('dashboardCard.view_full_report') }}</a>
            </div>
        </template>
    </div>
</template>

<script>
export default { name: 'MilestoneReportCard' };
</script>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import CardSkeleton from '@/components/atom/CardSkeleton/CardSkeleton.vue';

// Simple company-wide billing-milestone report for the management dashboard.
// Self-fetching from POST /api/v1/dashboard/milestone-summary. Owner/Admin
// only — the server also gates the data and returns an empty payload for
// anyone else.
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

const data = ref({ totalsByCurrency: [], byStatus: [], recent: [], totalCount: 0 });
const loading = ref(false);
const selectedStatus = ref(''); // active status drill-down ('' = all)

const isManagement = computed(() => [1, 2].includes(props.companyUserDetail?.roleType));

const maxStatus = computed(() => data.value.byStatus.reduce((m, r) => Math.max(m, r.count || 0), 0) || 1);
const statusPct = (v) => Math.round(((v || 0) / maxStatus.value) * 100);

const formatAmount = (n) => {
    const num = Number(n) || 0;
    return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
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
        const res = await apiRequest('post', `${env.MILESTONE_SUMMARY}`, selectedStatus.value ? { status: selectedStatus.value } : {});
        const body = res && res.data;
        if (body && body.status && body.data) {
            data.value = {
                totalsByCurrency: body.data.totalsByCurrency || [],
                byStatus: body.data.byStatus || [],
                recent: body.data.recent || [],
                totalCount: body.data.totalCount || 0,
            };
        }
    } catch (e) {
        console.error('MilestoneReportCard fetch error:', e);
    } finally {
        loading.value = false;
    }
};

// Status filter (drill-down): clicking a By-Status row filters the currency
// totals + recent list to that status; clicking the same row (or the ✕) clears.
// byStatus always returns full from the server, so the selector stays intact.
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
    router.push({ name: 'Milestone Report', params: { cid } });
};

watch(() => props.refreshTrigger, load);
onMounted(load);
</script>

<style scoped>
.mrc { height: 100%; width: 100%; padding: 10px 12px; overflow: auto; display: flex; flex-direction: column; gap: 12px; }
.mrc-msg { color: #9aa0b4; font-size: 12px; padding: 8px 0; }
.mrc-section-title { font-size: 12px; font-weight: 600; color: #3a3f52; margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.mrc-clear { border: none; background: none; padding: 0; font-size: 11px; font-weight: 600; color: #0d9488; cursor: pointer; white-space: nowrap; }
.mrc-clear:hover { text-decoration: underline; }
.mrc-total-grid { display: flex; flex-wrap: wrap; gap: 12px; }
.mrc-total { flex: 1 1 120px; background: #f5f7fb; border-radius: 8px; padding: 10px; text-align: center; }
.mrc-total-amount { font-size: 20px; font-weight: 700; color: #0f766e; line-height: 1.2; word-break: break-word; }
.mrc-total-label { font-size: 11px; color: #6b7280; margin-top: 2px; }
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
.mrc-footer { margin-top: auto; padding-top: 4px; }
.mrc-link { font-size: 12px; color: #0d9488; cursor: pointer; text-decoration: none; }
.mrc-link:hover { text-decoration: underline; }
</style>
