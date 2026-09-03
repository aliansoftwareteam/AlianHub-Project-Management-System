<template>
    <div class="dc-body mt">
        <div class="dc-metric">
            <span class="dc-num dc-num--mono">{{ clock(data.loggedMinutes) }}</span>
            <span class="dc-sub">{{ plannedLabel }}</span>
        </div>

        <div class="dc-track">
            <div class="dc-fill" :class="{ 'dc-fill--danger': overPlan }" :style="{ width: progress + '%' }"></div>
        </div>

        <div class="dc-stats mt__stats">
            <div>
                <div class="dc-stat__num dc-stat__num--sm">{{ formatMinutes(data.loggedMinutes) }}</div>
                <div class="dc-stat__label">{{ $t('DashV2.logged') }}</div>
            </div>
            <div>
                <div class="dc-stat__num dc-stat__num--sm">{{ data.plannedMinutes ? formatMinutes(data.plannedMinutes) : '—' }}</div>
                <div class="dc-stat__label">{{ $t('DashV2.planned') }}</div>
            </div>
            <div>
                <div class="dc-stat__num dc-stat__num--sm" :class="overPlan ? 'dc-stat__num--danger' : 'dc-stat__num--ok'">{{ deltaText }}</div>
                <div class="dc-stat__label">{{ $t('DashV2.vs_plan') }}</div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, inject } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { resolveCardRange, formatMinutes } from '@/composable/useResourceWorkload';
import { useCardMeta } from '@/components/organisms/DashboardCard/useCardMeta';

defineOptions({ name: 'MyTimeCard' });

// Member self-card — my logged hours against my plan for the window.
// Self-scoped on the backend (caller = req.uid).
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
const meta = useCardMeta();
const globalRange = inject('dashboardGlobalRange', null);
const data = ref({ plannedMinutes: 0, loggedMinutes: 0 });

const timerange = computed(() => {
    const v = Number(props.cardData?.timerange);
    return Number.isFinite(v) && v >= 0 && v <= 8 ? v : 3;
});

const clock = (min) => {
    const n = Math.max(0, Number(min) || 0);
    return `${Math.floor(n / 60)}:${String(Math.round(n % 60)).padStart(2, '0')}`;
};
const progress = computed(() => {
    const plan = data.value.plannedMinutes;
    if (!plan) return data.value.loggedMinutes ? 100 : 0;
    return Math.min(100, Math.round((data.value.loggedMinutes / plan) * 100));
});
const overPlan = computed(() => data.value.plannedMinutes > 0 && data.value.loggedMinutes > data.value.plannedMinutes);
const plannedLabel = computed(() => (data.value.plannedMinutes
    ? t('DashV2.of_planned', { hours: formatMinutes(data.value.plannedMinutes) })
    : t('DashV2.no_plan_set')));
const deltaText = computed(() => {
    const plan = data.value.plannedMinutes;
    if (!plan) return '—';
    const diff = data.value.loggedMinutes - plan;
    return `${diff > 0 ? '+' : diff < 0 ? '−' : ''}${formatMinutes(Math.abs(diff))}`;
});

const load = async () => {
    meta.state = 'loading';
    try {
        const { dateFrom, dateTo } = resolveCardRange(timerange.value, globalRange && globalRange.value);
        const res = await apiRequest('post', `${env.MY_TIME}`, { dateFrom, dateTo });
        const d = res && res.data && res.data.status ? (res.data.data || {}) : {};
        data.value = { plannedMinutes: d.plannedMinutes || 0, loggedMinutes: d.loggedMinutes || 0 };
        meta.note = t('DashV2.my_time_note');
        meta.state = (data.value.plannedMinutes || data.value.loggedMinutes) ? 'ready' : 'empty';
    } catch (e) {
        data.value = { plannedMinutes: 0, loggedMinutes: 0 };
        meta.state = 'error';
    }
};

watch(() => props.refreshTrigger, load);
watch(() => props.cardData, load, { deep: true });
watch(() => globalRange && globalRange.value, () => { if (timerange.value === 0) load(); }, { deep: true });
onMounted(load);
</script>

<style scoped src="@/components/organisms/DashboardCard/cardBody.css"></style>
<style scoped>
.mt__stats { margin-top: 2px; }
.dc-stat__num--sm { font-size: 16px; }
</style>
