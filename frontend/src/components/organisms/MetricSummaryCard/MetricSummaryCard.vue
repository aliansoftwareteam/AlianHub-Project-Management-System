<template>
    <div class="msc">
        <CardSkeleton v-if="loading" :rows="mode === 'number' ? 2 : 4" />
        <template v-else-if="mode === 'number'">
            <div class="msc-number">{{ totalValue }}</div>
            <div class="msc-number-label">{{ $t('dashboardCard.total_tasks_card_title') }}</div>
        </template>
        <template v-else>
            <div v-if="!rows.length" class="msc-msg">{{ $t('dashboardCard.no_data_available') }}</div>
            <div v-else class="msc-bars">
                <div v-for="r in rows" :key="r.label" class="msc-bar-row">
                    <span class="msc-label" :title="r.label">{{ r.label }}</span>
                    <div class="msc-track"><div class="msc-fill" :style="{ width: pct(r.value) + '%' }"></div></div>
                    <span class="msc-val">{{ r.value }}</span>
                </div>
            </div>
        </template>
    </div>
</template>

<script>
export default { name: 'MetricSummaryCard' };
</script>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import CardSkeleton from '@/components/atom/CardSkeleton/CardSkeleton.vue';

// REP-03 — a self-contained dashboard card. It fetches its OWN data from the
// REP-02 report engine (POST /reports/custom/run), so it needs no backend
// card-resolver and can't affect the existing dashboard cards. Its config is
// chosen by componentId; an optional project filter comes from cardData.
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

const CONFIG = {
    TasksByStatusCard: { dimension: 'status', metric: 'count', mode: 'bar' },
    TasksByProjectCard: { dimension: 'project', metric: 'count', mode: 'bar' },
    TotalTasksCard: { dimension: 'status', metric: 'count', mode: 'number' },
};
const cfg = computed(() => CONFIG[props.componentId] || CONFIG.TasksByStatusCard);
const mode = computed(() => cfg.value.mode);

const rows = ref([]);
const loading = ref(false);
const maxVal = computed(() => rows.value.reduce((m, r) => Math.max(m, r.value || 0), 0) || 1);
const totalValue = computed(() => rows.value.reduce((a, r) => a + (r.value || 0), 0));
const pct = (v) => Math.round(((v || 0) / maxVal.value) * 100);

const projectId = computed(() => {
    const p = props.cardData && props.cardData.projectId;
    if (Array.isArray(p)) return p[0] || '';
    return p || '';
});

const load = async () => {
    loading.value = true;
    try {
        const body = (await apiRequest('post', `${env.CUSTOM_REPORT}/run`, {
            dimension: cfg.value.dimension,
            metric: cfg.value.metric,
            filters: projectId.value ? { project: String(projectId.value) } : {},
        }))?.data;
        rows.value = (body && body.data && body.data.result) || [];
    } catch (e) { rows.value = []; } finally { loading.value = false; }
};

watch(() => props.refreshTrigger, load);
watch(projectId, load);
onMounted(load);
</script>

<style scoped>
.msc { height: 100%; width: 100%; padding: 6px 8px; overflow: auto; display: flex; flex-direction: column; }
.msc-msg { color: #9aa0b4; font-size: 12px; padding: 10px; }
.msc-number { font-size: 40px; font-weight: 700; color: #2f3a8f; text-align: center; margin-top: auto; }
.msc-number-label { font-size: 12px; color: #6b7280; text-align: center; margin-bottom: auto; }
.msc-bars { display: flex; flex-direction: column; gap: 7px; }
.msc-bar-row { display: flex; align-items: center; gap: 8px; }
.msc-label { width: 38%; font-size: 12px; color: #3a3f52; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.msc-track { flex: 1; height: 14px; background: #eef0f6; border-radius: 4px; overflow: hidden; }
.msc-fill { height: 100%; background: #2f3a8f; }
.msc-val { width: 44px; text-align: right; font-size: 12px; color: #3a3f52; }
</style>
