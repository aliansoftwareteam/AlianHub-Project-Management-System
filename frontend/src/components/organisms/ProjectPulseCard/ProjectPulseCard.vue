<template>
    <div class="ppc">
        <div v-if="loading" class="ppc-msg">…</div>
        <template v-else>
            <div class="ppc-counters">
                <div class="ppc-counter">
                    <div class="ppc-num">{{ data.activeProjects }}</div>
                    <div class="ppc-num-label">{{ $t('dashboardCard.active_projects') }}</div>
                </div>
                <div class="ppc-counter">
                    <div class="ppc-num ppc-num-accent">{{ data.workingProjects }}</div>
                    <div class="ppc-num-label">{{ $t('dashboardCard.working_projects') }} · {{ periodLabel }}</div>
                </div>
            </div>

            <div class="ppc-mix">
                <div class="ppc-mix-title">{{ $t('dashboardCard.project_type_mix') }}</div>
                <div v-if="!data.typeMix.length" class="ppc-msg">{{ $t('dashboardCard.no_data_available') }}</div>
                <div v-else class="ppc-bars">
                    <div v-for="row in data.typeMix" :key="row.type" class="ppc-bar-row">
                        <span class="ppc-label" :title="row.type">{{ row.type }}</span>
                        <div class="ppc-track"><div class="ppc-fill" :style="{ width: pct(row.count) + '%' }"></div></div>
                        <span class="ppc-val">{{ row.count }}</span>
                    </div>
                </div>
            </div>
        </template>
    </div>
</template>

<script>
export default { name: 'ProjectPulseCard' };
</script>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { apiRequest } from '@/services';
import * as env from '@/config/env';

// Resource Utilization card #1-3. Self-fetching from
// POST /api/v1/dashboard/project-utilization-summary. The `timerange`
// config drives ONLY the "working projects" window; active count and
// type mix are point-in-time company state.
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

const data = ref({ activeProjects: 0, workingProjects: 0, typeMix: [] });
const loading = ref(false);

const maxVal = computed(() => data.value.typeMix.reduce((m, r) => Math.max(m, r.count || 0), 0) || 1);
const pct = (v) => Math.round(((v || 0) / maxVal.value) * 100);

const timerange = computed(() => Number(props.cardData?.timerange) || 1);
const PERIOD_LABELS = {
    1: 'Today', 2: 'Yesterday', 3: 'This Week', 4: 'Last Week',
    5: 'This Month', 6: 'Last Month', 7: 'This Year', 8: 'Last 30 Days',
};
const periodLabel = computed(() => PERIOD_LABELS[timerange.value] || 'Today');

// Compact date-range resolver (ids match the card catalog convention).
function resolveDateRange(value) {
    const now = new Date();
    const start = new Date(now);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    switch (Number(value)) {
        case 2: { // yesterday
            start.setDate(start.getDate() - 1); start.setHours(0, 0, 0, 0);
            const yEnd = new Date(start); yEnd.setHours(23, 59, 59, 999);
            return { dateFrom: start.toISOString(), dateTo: yEnd.toISOString() };
        }
        case 3: { // this_week (Mon-based)
            const day = start.getDay() === 0 ? 6 : start.getDay() - 1;
            start.setDate(start.getDate() - day); start.setHours(0, 0, 0, 0);
            return { dateFrom: start.toISOString(), dateTo: end.toISOString() };
        }
        case 4: { // last_week
            const day = start.getDay() === 0 ? 6 : start.getDay() - 1;
            start.setDate(start.getDate() - day - 7); start.setHours(0, 0, 0, 0);
            const wEnd = new Date(start); wEnd.setDate(wEnd.getDate() + 6); wEnd.setHours(23, 59, 59, 999);
            return { dateFrom: start.toISOString(), dateTo: wEnd.toISOString() };
        }
        case 5: { // this_month
            start.setDate(1); start.setHours(0, 0, 0, 0);
            return { dateFrom: start.toISOString(), dateTo: end.toISOString() };
        }
        case 6: { // last_month
            start.setMonth(start.getMonth() - 1, 1); start.setHours(0, 0, 0, 0);
            const mEnd = new Date(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59, 999);
            return { dateFrom: start.toISOString(), dateTo: mEnd.toISOString() };
        }
        case 7: { // this_year
            start.setMonth(0, 1); start.setHours(0, 0, 0, 0);
            return { dateFrom: start.toISOString(), dateTo: end.toISOString() };
        }
        case 8: { // last_30_days
            start.setDate(start.getDate() - 30); start.setHours(0, 0, 0, 0);
            return { dateFrom: start.toISOString(), dateTo: end.toISOString() };
        }
        case 1:
        default: { // today
            start.setHours(0, 0, 0, 0);
            return { dateFrom: start.toISOString(), dateTo: end.toISOString() };
        }
    }
}

const load = async () => {
    loading.value = true;
    try {
        const { dateFrom, dateTo } = resolveDateRange(timerange.value);
        const res = await apiRequest('post', `${env.PROJECT_UTILIZATION_SUMMARY}`, { dateFrom, dateTo });
        const body = res && res.data;
        if (body && body.status) {
            data.value = {
                activeProjects: body.data.activeProjects || 0,
                workingProjects: body.data.workingProjects || 0,
                typeMix: body.data.typeMix || [],
            };
        }
    } catch (e) {
        console.error('ProjectPulseCard fetch error:', e);
    } finally {
        loading.value = false;
    }
};

watch(() => props.refreshTrigger, load);
watch(() => props.cardData, load, { deep: true });
onMounted(load);
</script>

<style scoped>
.ppc { height: 100%; width: 100%; padding: 10px 12px; overflow: auto; display: flex; flex-direction: column; gap: 12px; }
.ppc-msg { color: #9aa0b4; font-size: 12px; padding: 8px 0; }
.ppc-counters { display: flex; gap: 12px; }
.ppc-counter { flex: 1; background: #f5f7fb; border-radius: 8px; padding: 10px; text-align: center; }
.ppc-num { font-size: 32px; font-weight: 700; color: #0f766e; line-height: 1.1; }
.ppc-num-accent { color: #0d9488; }
.ppc-num-label { font-size: 11px; color: #6b7280; margin-top: 2px; }
.ppc-mix-title { font-size: 12px; font-weight: 600; color: #3a3f52; margin-bottom: 6px; }
.ppc-bars { display: flex; flex-direction: column; gap: 6px; }
.ppc-bar-row { display: flex; align-items: center; gap: 8px; }
.ppc-label { width: 38%; font-size: 12px; color: #3a3f52; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-transform: capitalize; }
.ppc-track { flex: 1; height: 12px; background: #eef0f6; border-radius: 4px; overflow: hidden; }
.ppc-fill { height: 100%; background: #0d9488; }
.ppc-val { width: 34px; text-align: right; font-size: 12px; color: #3a3f52; }
</style>
