<template>
    <div class="dc-body vel">
        <div class="dc-metric">
            <span class="dc-num" data-test="velocity-average">{{ scale.average }}</span>
            <span class="dc-sub">{{ scale.forecast.ok ? $t('Dash.velocity_next', { low: scale.forecast.low, high: scale.forecast.high }) : $t('Dash.velocity_avg', { n: rows.length }) }}</span>
        </div>

        <div class="rp-bars vel__bars">
            <div v-for="(row, i) in rows" :key="row.sprintId || i" class="rp-bar" data-test="velocity-sprint">
                <div class="rp-bar__pair vel__pair">
                    <span
                        class="rp-bar__fill"
                        :class="{ 'is-current': i === rows.length - 1 }"
                        :style="{ height: scale.heightOf(scale.completedOf(row)) }"
                        :title="$t('Reports.completed_n', { n: scale.completedOf(row) })"
                    ></span>
                    <span
                        class="rp-bar__fill is-committed"
                        :style="{ height: scale.heightOf(row.committed) }"
                        :title="$t('Reports.committed_n', { n: row.committed })"
                    ></span>
                </div>
                <span class="rp-bar__label" :class="{ 'is-current': i === rows.length - 1 }" :title="row.name">{{ shortName(row.name) }}</span>
            </div>
        </div>

        <div class="rp-legend">
            <span><i style="background: var(--ok)"></i>{{ $t('Reports.legend_completed') }}</span>
            <span><i class="rp-bar__fill is-committed"></i>{{ $t('Reports.legend_committed') }}</span>
        </div>
    </div>
</template>

<script setup>
import { computed, ref, watch, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useCardMeta } from '@/components/organisms/DashboardCard/useCardMeta';
import { fetchVelocity, velocityScale } from '@/views/Projects/Reports/composables/agileReports';

defineOptions({ name: 'VelocityCard' });

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

const DEFAULT_SPRINTS = 6;
const MIN_SPRINTS = 2;
const MAX_SPRINTS = 12;
const BAR_HEIGHT = 96;

const { t } = useI18n();
const meta = useCardMeta();
const rows = ref([]);

const projectId = computed(() => String(props.cardData?.projectId || ''));
const sprintCount = computed(() => {
    const n = Math.round(Number(props.cardData?.sprintCount));
    return Number.isFinite(n) && n > 0 ? Math.min(MAX_SPRINTS, Math.max(MIN_SPRINTS, n)) : DEFAULT_SPRINTS;
});
const scale = computed(() => velocityScale(rows.value, { window: sprintCount.value, barHeight: BAR_HEIGHT }));

const shortName = (name) => String(name || '').replace(/sprint\s*/i, 'S').slice(0, 6);

const load = async () => {
    if (!projectId.value) {
        rows.value = [];
        meta.emptyText = t('Dash.velocity_pick_project');
        meta.state = 'empty';
        return;
    }
    meta.state = 'loading';
    meta.error = '';
    try {
        const data = await fetchVelocity(projectId.value, sprintCount.value);
        rows.value = Array.isArray(data.sprints) ? data.sprints : [];
        const skipped = Number(data.skipped) || 0;
        meta.note = skipped ? t('Reports.velocity_skipped', { n: skipped }) : t('Reports.last_n_sprints', { n: rows.value.length });
        meta.emptyText = t('Dash.velocity_no_sprints');
        meta.state = rows.value.length ? 'ready' : 'empty';
    } catch (e) {
        rows.value = [];
        meta.error = e && e.response && [403, 404].includes(e.response.status) ? t('Dash.velocity_no_access') : '';
        meta.state = 'error';
    }
};

watch(() => props.refreshTrigger, load);
watch(() => [projectId.value, sprintCount.value], load);
onMounted(load);
</script>

<style scoped src="@/components/organisms/DashboardCard/cardBody.css"></style>
<style src="@/views/Projects/Reports/reportsV2.css"></style>
<style scoped>
.vel__bars { gap: var(--sp-3); min-height: 0; padding-top: var(--sp-1); }
.vel__pair { height: 96px; }
</style>
