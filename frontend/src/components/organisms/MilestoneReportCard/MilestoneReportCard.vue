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

            <!-- By status mini-bars -->
            <div v-if="data.byStatus.length" class="mrc-status">
                <div class="mrc-section-title">{{ $t('dashboardCard.milestone_by_status') }}</div>
                <div class="mrc-bars">
                    <div v-for="row in data.byStatus" :key="row.status" class="mrc-bar-row">
                        <span class="mrc-dot" :style="dotStyle(row.status)"></span>
                        <span class="mrc-status-label" :title="statusLabel(row.status)">{{ statusLabel(row.status) }}</span>
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

const isManagement = computed(() => [1, 2].includes(props.companyUserDetail?.roleType));

const maxStatus = computed(() => data.value.byStatus.reduce((m, r) => Math.max(m, r.count || 0), 0) || 1);
const statusPct = (v) => Math.round(((v || 0) / maxStatus.value) * 100);

const formatAmount = (n) => {
    const num = Number(n) || 0;
    return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
};

// A milestone status is stored as a colour value; render it as a swatch when
// it looks like a hex colour, otherwise fall back to a neutral dot + label.
const isHexColor = (s) => typeof s === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(s);
const dotStyle = (status) => ({ backgroundColor: isHexColor(status) ? status : '#cbd2e0' });
const statusLabel = (status) => (isHexColor(status) || !status) ? '—' : status;

const load = async () => {
    if (!isManagement.value) return;
    loading.value = true;
    try {
        const res = await apiRequest('post', `${env.MILESTONE_SUMMARY}`, {});
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
.mrc-section-title { font-size: 12px; font-weight: 600; color: #3a3f52; margin-bottom: 6px; }
.mrc-total-grid { display: flex; flex-wrap: wrap; gap: 12px; }
.mrc-total { flex: 1 1 120px; background: #f5f7fb; border-radius: 8px; padding: 10px; text-align: center; }
.mrc-total-amount { font-size: 20px; font-weight: 700; color: #0f766e; line-height: 1.2; word-break: break-word; }
.mrc-total-label { font-size: 11px; color: #6b7280; margin-top: 2px; }
.mrc-bars { display: flex; flex-direction: column; gap: 6px; }
.mrc-bar-row { display: flex; align-items: center; gap: 8px; }
.mrc-dot { width: 10px; height: 10px; border-radius: 50%; flex: 0 0 auto; }
.mrc-status-label { width: 30%; font-size: 12px; color: #3a3f52; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mrc-track { flex: 1; height: 12px; background: #eef0f6; border-radius: 4px; overflow: hidden; }
.mrc-fill { height: 100%; background: #0d9488; }
.mrc-val { width: 34px; text-align: right; font-size: 12px; color: #3a3f52; }
.mrc-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.mrc-item { display: flex; align-items: center; gap: 8px; }
.mrc-item-main { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.mrc-item-name { font-size: 12px; color: #3a3f52; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mrc-item-project { font-size: 11px; color: #9aa0b4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mrc-item-amount { font-size: 12px; font-weight: 600; color: #0f766e; white-space: nowrap; }
.mrc-footer { margin-top: auto; padding-top: 4px; }
.mrc-link { font-size: 12px; color: #0d9488; cursor: pointer; text-decoration: none; }
.mrc-link:hover { text-decoration: underline; }
</style>
