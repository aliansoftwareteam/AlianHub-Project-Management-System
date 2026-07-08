<template>
    <div class="mt">
        <CardSkeleton v-if="loading && !loaded" :counters="2" :rows="0" />
        <template v-else>
            <div class="mt-head">
                <span class="mt-period">{{ periodLabel }}</span>
                <span class="mt-ratio" :class="{ over: overPlan }" v-if="data.plannedMinutes > 0">{{ ratio }}</span>
            </div>
            <div class="mt-numbers">
                <div class="mt-num-box">
                    <div class="mt-num mt-logged">{{ formatMinutes(data.loggedMinutes) }}</div>
                    <div class="mt-num-label">{{ $t('dashboardCard.show_logged_hours') }}</div>
                </div>
                <div class="mt-num-box">
                    <div class="mt-num mt-planned">{{ formatMinutes(data.plannedMinutes) }}</div>
                    <div class="mt-num-label">{{ $t('dashboardCard.mt_planned') }}</div>
                </div>
                <div class="mt-num-box">
                    <div class="mt-num" :class="overMinutes > 0 ? 'mt-over' : 'mt-ok'">{{ overText }}</div>
                    <div class="mt-num-label">{{ $t('dashboardCard.mt_over_plan') }}</div>
                </div>
            </div>
            <div class="mt-bars">
                <div class="mt-bar-row">
                    <span class="mt-bar-label">{{ $t('dashboardCard.show_logged_hours') }}</span>
                    <div class="mt-track"><div class="mt-fill mt-fill-logged" :style="{ width: barPct(data.loggedMinutes) + '%' }"></div></div>
                </div>
                <div class="mt-bar-row">
                    <span class="mt-bar-label">{{ $t('dashboardCard.mt_planned') }}</span>
                    <div class="mt-track"><div class="mt-fill mt-fill-planned" :style="{ width: barPct(data.plannedMinutes) + '%' }"></div></div>
                </div>
            </div>
            <div v-if="!data.plannedMinutes && !data.loggedMinutes" class="mt-msg">{{ $t('dashboardCard.mt_empty') }}</div>
        </template>
    </div>
</template>

<script>
export default { name: 'MyTimeCard' };
</script>

<script setup>
import { ref, computed, watch, onMounted, inject } from 'vue';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { resolveCardRange, formatMinutes } from '@/composable/useResourceWorkload';
import CardSkeleton from '@/components/atom/CardSkeleton/CardSkeleton.vue';

// Member self-card — my planned (estimated_time) vs logged (timesheets) hours
// for the window. Self-scoped on the backend (caller = req.uid).
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

const globalRange = inject('dashboardGlobalRange', null);
const timerange = computed(() => {
    const v = Number(props.cardData?.timerange);
    return Number.isFinite(v) && v >= 0 && v <= 8 ? v : 3; // default This Week; 0 = Auto
});
const PERIOD_LABELS = { 1: 'Today', 2: 'Yesterday', 3: 'This Week', 4: 'Last Week', 5: 'This Month', 6: 'Last Month', 7: 'This Year', 8: 'Last 30 Days' };
const periodLabel = computed(() => (timerange.value === 0 ? 'Auto' : (PERIOD_LABELS[timerange.value] || 'This Week')));

const data = ref({ plannedMinutes: 0, loggedMinutes: 0 });
const loading = ref(false);
const loaded = ref(false);

const maxVal = computed(() => Math.max(data.value.plannedMinutes, data.value.loggedMinutes) || 1);
const barPct = (v) => Math.round(((v || 0) / maxVal.value) * 100);
const ratio = computed(() => (data.value.plannedMinutes > 0 ? Math.round((data.value.loggedMinutes / data.value.plannedMinutes) * 100) + '%' : '—'));
const overPlan = computed(() => data.value.plannedMinutes > 0 && data.value.loggedMinutes > data.value.plannedMinutes);
// "Over Plan" — time logged beyond the plan. Only meaningful when a plan exists.
const overMinutes = computed(() => {
    const p = data.value.plannedMinutes || 0;
    return p > 0 ? Math.max(0, (data.value.loggedMinutes || 0) - p) : 0;
});
const overText = computed(() => {
    if (!data.value.plannedMinutes) return '—';
    return overMinutes.value > 0 ? '+' + formatMinutes(overMinutes.value) : '0h';
});

const load = async () => {
    loading.value = true;
    try {
        const { dateFrom, dateTo } = resolveCardRange(timerange.value, globalRange && globalRange.value);
        const res = await apiRequest('post', `${env.MY_TIME}`, { dateFrom, dateTo });
        const d = res && res.data && res.data.status ? (res.data.data || {}) : {};
        data.value = { plannedMinutes: d.plannedMinutes || 0, loggedMinutes: d.loggedMinutes || 0 };
        loaded.value = true;
    } catch (e) {
        console.error('MyTimeCard fetch error:', e);
        data.value = { plannedMinutes: 0, loggedMinutes: 0 };
    } finally {
        loading.value = false;
    }
};

watch(() => props.refreshTrigger, load);
watch(() => props.cardData, load, { deep: true });
watch(() => globalRange && globalRange.value, () => { if (timerange.value === 0) load(); }, { deep: true });
onMounted(load);
</script>

<style scoped>
.mt { height: 100%; width: 100%; padding: 10px 12px; overflow: auto; display: flex; flex-direction: column; gap: 10px; }
.mt-msg { color: #9aa0b4; font-size: 12px; }
.mt-head { display: flex; justify-content: space-between; align-items: center; font-size: 11px; }
.mt-period { font-weight: 600; color: #0d9488; }
.mt-ratio { font-weight: 700; color: #0f766e; font-size: 13px; }
.mt-ratio.over { color: #dc2626; }
.mt-numbers { display: flex; gap: 10px; }
.mt-num-box { flex: 1; background: #f5f7fb; border-radius: 8px; padding: 10px; text-align: center; }
.mt-num { font-size: 26px; font-weight: 700; line-height: 1.1; }
.mt-logged { color: #0d9488; }
.mt-planned { color: #6473e8; }
.mt-over { color: #dc2626; }
.mt-ok { color: #9aa0b4; }
.mt-num-label { font-size: 11px; color: #6b7280; margin-top: 2px; }
.mt-bars { display: flex; flex-direction: column; gap: 6px; }
.mt-bar-row { display: flex; align-items: center; gap: 8px; }
.mt-bar-label { width: 56px; font-size: 11px; color: #6b7280; }
.mt-track { flex: 1; height: 12px; background: #eef0f6; border-radius: 4px; overflow: hidden; }
.mt-fill { height: 100%; }
.mt-fill-logged { background: #0d9488; }
.mt-fill-planned { background: #6473e8; }
</style>
