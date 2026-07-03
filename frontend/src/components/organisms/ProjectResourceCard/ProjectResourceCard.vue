<template>
    <div class="prc">
        <template v-if="loading">
            <div class="prc-skel prc-skel-num"></div>
            <div class="prc-skel prc-skel-lbl"></div>
        </template>
        <template v-else>
            <div class="prc-clickzone" role="button" :title="$t('dashboardCard.plm_click_hint')" @click="openDrill">
                <div class="prc-number">{{ data.count || 0 }}</div>
                <div class="prc-number-label">{{ $t('dashboardCard.running_projects_card_title') }}</div>
            </div>
        </template>

        <ProjectListModal
            :modelValue="drillOpen"
            :title="$t('dashboardCard.running_projects_card_title')"
            :projects="drillProjects"
            :loading="drillLoading"
            @close="drillOpen = false"
        />
    </div>
</template>

<script>
export default { name: 'ProjectResourceCard' };
</script>

<script setup>
import { ref, watch, onMounted, inject } from 'vue';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import ProjectListModal from '@/components/molecules/ProjectListModal/ProjectListModal.vue';

// AHE-3789 — Running Projects card. Fetches a companyId-scoped count of active
// projects that had logged time in the selected period, from the additive,
// read-only POST /dashboard/project-metrics endpoint. No effect on other cards.
// Clicking the number opens a drill-down modal listing those projects.
const props = defineProps({
    cardUID: { type: [String, Number], default: '' },
    componentId: { type: String, default: '' },
    cardData: { type: Object, default: () => ({}) },
    filterData: { type: Object, default: () => ({}) },
    refreshTrigger: { type: [Number, String], default: 0 },
    companyUserDetail: { type: Object, default: () => ({}) },
    allProjectsArrayFilter: { type: Array, default: () => [] },
    taskStatusArray: { type: Array, default: () => [] },
});

const DEFAULT_RANGE = 1; // Today

const userIdRef = inject('$userId', ref(''));
const globalRange = inject('dashboardGlobalRange', null);
const data = ref({});
const loading = ref(false);

// 0 = Auto → follow the dashboard's global date range.
const effectiveTimerange = () => {
    const v = Number(props.cardData && props.cardData.timerange);
    return Number.isFinite(v) && v >= 0 && v <= 8 ? v : DEFAULT_RANGE;
};

// Resolve a timerange id (1..8, matching the other dashboard cards) to an
// absolute [from, to] window. Browser-side dates are fine here.
function resolveRange(id) {
    if (Number(id) === 0 && globalRange && globalRange.value && globalRange.value.dateFrom) {
        return { from: globalRange.value.dateFrom, to: globalRange.value.dateTo };
    }
    const now = new Date();
    const sod = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
    const eod = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
    let from = sod(now);
    let to = eod(now);
    switch (Number(id)) {
        case 2: { const y = new Date(now); y.setDate(now.getDate() - 1); from = sod(y); to = eod(y); break; }
        case 3: { const s = new Date(now); s.setDate(now.getDate() - now.getDay()); from = sod(s); to = eod(now); break; }
        case 4: { const s = new Date(now); s.setDate(now.getDate() - now.getDay() - 7); const e = new Date(s); e.setDate(s.getDate() + 6); from = sod(s); to = eod(e); break; }
        case 5: { from = new Date(now.getFullYear(), now.getMonth(), 1); to = eod(now); break; }
        case 6: { from = new Date(now.getFullYear(), now.getMonth() - 1, 1); to = eod(new Date(now.getFullYear(), now.getMonth(), 0)); break; }
        case 7: { from = new Date(now.getFullYear(), 0, 1); to = eod(now); break; }
        case 8: { const s = new Date(now); s.setDate(now.getDate() - 29); from = sod(s); to = eod(now); break; }
        default: break; // case 1 / unknown → today
    }
    return { from: from.toISOString(), to: to.toISOString() };
}

const buildPayload = (extra = {}) => {
    const r = resolveRange(effectiveTimerange());
    return {
        metric: 'running_projects',
        dateFrom: r.from,
        dateTo: r.to,
        callerUserId: (userIdRef && userIdRef.value) || '',
        callerRoleType: Number(props.companyUserDetail && props.companyUserDetail.roleType) || 3,
        ...extra,
    };
};

const load = async () => {
    loading.value = true;
    try {
        const resp = (await apiRequest('post', `${env.DASHBOARD}/project-metrics`, buildPayload()))?.data;
        data.value = (resp && resp.data) || {};
    } catch (e) {
        data.value = {};
    } finally {
        loading.value = false;
    }
};

// ─── Drill-down modal ───
const drillOpen = ref(false);
const drillLoading = ref(false);
const drillProjects = ref([]);
const openDrill = async () => {
    drillOpen.value = true;
    drillLoading.value = true;
    try {
        const resp = (await apiRequest('post', `${env.DASHBOARD}/project-metrics`, buildPayload({ includeProjects: true })))?.data;
        drillProjects.value = (resp && resp.data && resp.data.projects) || [];
    } catch (e) {
        drillProjects.value = [];
    } finally {
        drillLoading.value = false;
    }
};

watch(() => props.refreshTrigger, load);
watch(() => props.cardData && props.cardData.timerange, load);
// Auto mode — track the dashboard-level range.
watch(() => globalRange && globalRange.value, () => { if (effectiveTimerange() === 0) load(); }, { deep: true });
onMounted(load);
</script>

<style scoped>
.prc { height: 100%; width: 100%; padding: 6px 8px; overflow: hidden; display: flex; flex-direction: column; }
.prc-clickzone { display: flex; flex-direction: column; flex: 1; cursor: pointer; border-radius: 8px; transition: background-color 0.15s ease; }
.prc-clickzone:hover { background: #f5f7fb; }
.prc-number { font-size: 40px; font-weight: 700; color: #0e7490; text-align: center; margin-top: auto; }
.prc-number-label { font-size: 12px; color: #6b7280; text-align: center; margin-bottom: auto; }
.prc-skel { background: linear-gradient(90deg, #eef0f6 25%, #e3e7f1 37%, #eef0f6 63%); background-size: 400% 100%; animation: prc-shimmer 1.4s ease infinite; border-radius: 4px; }
@keyframes prc-shimmer { 0% { background-position: 100% 0; } 100% { background-position: 0 0; } }
.prc-skel-num { width: 90px; height: 40px; margin: auto auto 8px auto; }
.prc-skel-lbl { width: 110px; height: 12px; margin: 0 auto auto auto; }
</style>
