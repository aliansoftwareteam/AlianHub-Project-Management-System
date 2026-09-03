<template>
    <div class="dc-body tbs">
        <div class="dc-metric">
            <span class="dc-num">{{ total }}</span>
            <span class="dc-sub">{{ $t('DashV2.tbs_sub', { n: projects.length }) }}</span>
        </div>

        <div class="tbs__rows">
            <div v-for="p in projects" :key="p.projectId" class="dc-row">
                <span class="dc-row__name tbs__name" :title="p.name">{{ p.name }}</span>
                <span class="tbs__bar">
                    <span
                        v-for="seg in segments(p)"
                        :key="seg.key"
                        class="tbs__seg"
                        :style="{ width: seg.width, background: seg.color }"
                        :title="`${seg.name}: ${seg.count}`"
                    ></span>
                </span>
                <span class="dc-row__val">{{ p.total }}</span>
            </div>
        </div>

        <div class="dc-legend tbs__legend">
            <span v-for="s in legend" :key="s.statusKey">
                <i class="dc-legend__key" :style="{ background: s.color }"></i>{{ s.name }}
            </span>
        </div>
    </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, inject } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { resolveCardRange } from '@/composable/useResourceWorkload';
import { useCardMeta } from '@/components/organisms/DashboardCard/useCardMeta';

defineOptions({ name: 'TasksByStatusCard' });

// Where the work sits, per project — stacked bars rather than a pie, so several
// projects can be compared at once. Scope is the server's call: Owner/Admin see
// the company, everyone else sees their own tasks.
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

const projects = ref([]);
const statuses = ref([]);
const total = ref(0);

const timerange = computed(() => {
    const v = Number(props.cardData?.timerange);
    return Number.isFinite(v) && v >= 0 && v <= 8 ? v : 3;
});

const statusSettings = computed(() => {
    const a = props.taskStatusArray;
    const list = Array.isArray(a) ? a : (a && a.settings) || [];
    return Array.isArray(list) ? list : [];
});

const statusMeta = (key) => statusSettings.value.find((s) => Number(s.key) === Number(key)) || {};

const legend = computed(() => statuses.value.map((s) => {
    const m = statusMeta(s.statusKey);
    return {
        statusKey: s.statusKey,
        name: m.name || t('DashV2.tbs_unknown_status'),
        color: m.textColor || 'var(--brand)',
    };
}));

const segments = (project) => legend.value
    .map((s) => {
        const count = Number(project.counts[s.statusKey]) || 0;
        return {
            key: `${project.projectId}-${s.statusKey}`,
            name: s.name,
            color: s.color,
            count,
            width: `${project.total ? (count / project.total) * 100 : 0}%`,
        };
    })
    .filter((seg) => seg.count > 0);

const load = async () => {
    meta.state = 'loading';
    try {
        const { dateFrom, dateTo } = resolveCardRange(timerange.value, globalRange && globalRange.value);
        const res = await apiRequest('post', `${env.TASKS_BY_STATUS}`, {
            byProject: true,
            dateFrom,
            dateTo,
            statusKeys: props.cardData?.statusArray || [],
            projectId: props.cardData?.projectId || [],
            projectMode: props.cardData?.projectMode || 'all',
        });
        const d = res && res.data && res.data.status ? (res.data.data || {}) : {};
        statuses.value = d.statuses || [];
        projects.value = d.projects || [];
        total.value = d.total || 0;
        meta.note = d.scope === 'company' ? t('DashV2.tbs_note_company') : t('DashV2.tbs_note_self');
        meta.state = projects.value.length ? 'ready' : 'empty';
    } catch (e) {
        projects.value = [];
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
.tbs__rows { display: flex; flex-direction: column; gap: 7px; }
.tbs__name { width: 104px; }
.tbs__bar {
    flex: 1 1 auto;
    display: flex;
    height: 18px;
    border-radius: 4px;
    overflow: hidden;
    background: var(--surface-hover);
    min-width: 0;
}
.tbs__seg { height: 100%; }
.tbs__legend { margin-top: auto; padding-top: 4px; }
</style>
