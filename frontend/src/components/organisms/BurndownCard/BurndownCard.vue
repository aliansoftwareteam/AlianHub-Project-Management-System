<template>
    <div class="dc-body burn">
        <div class="dc-metric">
            <span class="dc-num" data-test="burndown-remaining">{{ remainingNow }}</span>
            <span class="dc-sub">{{ metric === 'count' ? $t('Dash.burndown_tasks_left', { total }) : $t('Dash.burndown_points_left', { total }) }}</span>
        </div>
        <div class="rp-chart rp-chart--burndown burn__chart">
            <ApexChart type="line" height="100%" :options="options" :series="series" />
        </div>
        <div class="dc-legend">
            <span><i class="dc-legend__key burn__key--remaining"></i>{{ $t('Reports.remaining') }}</span>
            <span><i class="dc-legend__key burn__key--ideal"></i>{{ $t('Reports.ideal') }}</span>
        </div>
    </div>
</template>

<script setup>
import { computed, ref, watch, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useCardMeta } from '@/components/organisms/DashboardCard/useCardMeta';
import { burndownOptions, burndownSeries, fetchBurndown } from '@/views/Projects/Reports/composables/agileReports';
import { useChartTokens } from '@/utils/chartTokens';
import { burndownCardOptions } from './burndownCardOptions';

defineOptions({ name: 'BurndownCard' });

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
const chartTokens = useChartTokens();
const report = ref(null);

const sprintId = computed(() => String(props.cardData?.sprintId || ''));
const metric = computed(() => (props.cardData?.metric === 'count' ? 'count' : 'points'));
const days = computed(() => ((report.value && report.value.days) || []).filter(Boolean));

const series = computed(() => burndownSeries(days.value, {
    metric: metric.value,
    remaining: t('Reports.remaining'),
    ideal: t('Reports.ideal'),
}));
const options = computed(() => burndownCardOptions(burndownOptions(days.value, { id: `burndown-${props.cardUID}` }), chartTokens.value));

const total = computed(() => Number(report.value && (metric.value === 'count' ? report.value.totalCount : report.value.totalPoints)) || 0);
const remainingNow = computed(() => {
    const reached = series.value[0].data.filter((v) => v !== null);
    return reached.length ? reached[reached.length - 1] : 0;
});

const load = async () => {
    if (!sprintId.value) {
        report.value = null;
        meta.emptyText = t('Dash.burndown_pick_sprint');
        meta.state = 'empty';
        return;
    }
    meta.state = 'loading';
    meta.error = '';
    try {
        report.value = await fetchBurndown(sprintId.value);
        meta.note = report.value.sprintName || '';
        meta.emptyText = t('Dash.burndown_no_tasks');
        meta.state = days.value.length ? 'ready' : 'empty';
    } catch (e) {
        report.value = null;
        meta.error = e && e.response && [403, 404].includes(e.response.status) ? t('Dash.burndown_no_access') : '';
        meta.state = 'error';
    }
};

watch(() => props.refreshTrigger, load);
watch(() => [sprintId.value, metric.value], load);
onMounted(load);
</script>

<style scoped src="@/components/organisms/DashboardCard/cardBody.css"></style>
<style src="@/views/Projects/Reports/reportsV2.css"></style>
<style scoped>
.burn__chart { flex: 1 1 auto; min-height: 140px; }
.burn__chart :deep(.apexcharts-xaxis-label), .burn__chart :deep(.apexcharts-yaxis-label) { font-size: var(--fs-2xs, 10px); }
.burn__key--remaining { background: var(--brand); }
.burn__key--ideal { background: transparent; border-top: 1.5px dashed var(--ink-3); border-radius: 0; height: 0; }
</style>
