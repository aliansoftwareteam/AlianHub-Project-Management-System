<template>
    <div class="dc-body ppc">
        <div class="dc-stats">
            <button type="button" class="ppc__stat" @click="openDrill('active')">
                <span class="dc-stat__num">{{ data.activeProjects }}</span>
                <span class="dc-stat__label">{{ $t('Dash.pulse_active') }}</span>
            </button>
            <button type="button" class="ppc__stat" @click="openDrill('working')">
                <span class="dc-stat__num dc-stat__num--ok">{{ data.workingProjects }}</span>
                <span class="dc-stat__label">{{ $t('Dash.pulse_working') }}</span>
            </button>
            <div class="ppc__stat ppc__stat--static">
                <span class="dc-stat__num">{{ idleProjects }}</span>
                <span class="dc-stat__label">{{ $t('Dash.pulse_idle') }}</span>
            </div>
        </div>

        <div class="ppc__mix">
            <div class="ah-label ppc__mix-title">{{ $t('Dash.pulse_mix') }}</div>
            <div v-if="!data.typeMix.length" class="dc-sub">{{ $t('Dash.pulse_no_types') }}</div>
            <div v-else class="ppc__bars">
                <button v-for="row in data.typeMix" :key="row.type" type="button" class="dc-row ppc__bar-row" @click="openDrill(row.type)">
                    <span class="dc-row__name" :title="row.type">{{ row.type }}</span>
                    <span class="dc-track"><span class="dc-fill" :style="{ width: pct(row.count) + '%' }"></span></span>
                    <span class="dc-row__val">{{ row.count }}</span>
                </button>
            </div>
        </div>

        <ProjectListModal
            :modelValue="drillOpen"
            :title="drillTitle"
            :projects="drillProjects"
            :loading="drillLoading"
            :showWorked="true"
            @close="drillOpen = false"
        />
    </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, inject } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { resolveCardRange } from '@/composable/useResourceWorkload';
import ProjectListModal from '@/components/molecules/ProjectListModal/ProjectListModal.vue';
import { useCardMeta } from '@/components/organisms/DashboardCard/useCardMeta';

defineOptions({ name: 'ProjectPulseCard' });

// How the work is going: how many projects are live, how many were actually
// worked on in the window, and the mix of what they are. Clicking any figure
// opens the projects behind it.
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

const data = ref({ activeProjects: 0, workingProjects: 0, typeMix: [] });

const maxVal = computed(() => data.value.typeMix.reduce((m, r) => Math.max(m, r.count || 0), 0) || 1);
const pct = (v) => Math.round(((v || 0) / maxVal.value) * 100);
const idleProjects = computed(() => Math.max(0, data.value.activeProjects - data.value.workingProjects));

const timerange = computed(() => {
    const v = Number(props.cardData?.timerange);
    return Number.isFinite(v) && v >= 0 && v <= 8 ? v : 1;
});
const projectIds = computed(() => (Array.isArray(props.cardData?.projectId) ? props.cardData.projectId : []));
const projectMode = computed(() => props.cardData?.projectMode || 'all');

const load = async () => {
    meta.state = 'loading';
    try {
        const { dateFrom, dateTo } = resolveCardRange(timerange.value, globalRange && globalRange.value);
        const res = await apiRequest('post', `${env.PROJECT_UTILIZATION_SUMMARY}`, {
            dateFrom, dateTo, projectId: projectIds.value, projectMode: projectMode.value,
        });
        const bodyData = res && res.data;
        if (bodyData && bodyData.status) {
            data.value = {
                activeProjects: bodyData.data.activeProjects || 0,
                workingProjects: bodyData.data.workingProjects || 0,
                typeMix: bodyData.data.typeMix || [],
            };
        }
        meta.note = t('Dash.pulse_note');
        meta.state = data.value.activeProjects ? 'ready' : 'empty';
    } catch (e) {
        meta.state = 'error';
    }
};

const drillOpen = ref(false);
const drillLoading = ref(false);
const drillFilter = ref('active');
const allDrillProjects = ref([]);

const drillTitle = computed(() => {
    if (drillFilter.value === 'active') return t('Dash.pulse_active');
    if (drillFilter.value === 'working') return t('Dash.pulse_working');
    return drillFilter.value;
});
const drillProjects = computed(() => {
    if (drillFilter.value === 'active') return allDrillProjects.value;
    if (drillFilter.value === 'working') return allDrillProjects.value.filter((p) => p.isWorking);
    return allDrillProjects.value.filter((p) => p.type === drillFilter.value);
});

const openDrill = async (filter) => {
    drillFilter.value = filter;
    drillOpen.value = true;
    drillLoading.value = true;
    try {
        const { dateFrom, dateTo } = resolveCardRange(timerange.value, globalRange && globalRange.value);
        const res = await apiRequest('post', `${env.PROJECT_UTILIZATION_SUMMARY}`, {
            dateFrom, dateTo, includeProjects: true, projectId: projectIds.value, projectMode: projectMode.value,
        });
        const bodyData = res && res.data;
        allDrillProjects.value = (bodyData && bodyData.status && bodyData.data.projects) || [];
    } catch (e) {
        allDrillProjects.value = [];
    } finally {
        drillLoading.value = false;
    }
};

watch(() => props.refreshTrigger, load);
watch(() => props.cardData, load, { deep: true });
watch(() => globalRange && globalRange.value, () => { if (timerange.value === 0) load(); }, { deep: true });
onMounted(load);
</script>

<style scoped src="@/components/organisms/DashboardCard/cardBody.css"></style>
<style scoped>
.ppc__stat {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 0;
    border: 0;
    background: none;
    text-align: left;
    cursor: pointer;
    border-radius: var(--r-chip);
}
.ppc__stat--static { cursor: default; }
.ppc__stat:not(.ppc__stat--static):hover .dc-stat__label { color: var(--brand); }
.ppc__stat:focus-visible { outline: none; box-shadow: var(--focus); }
.ppc__mix { display: flex; flex-direction: column; gap: 6px; min-height: 0; }
.ppc__mix-title { color: var(--ink-label); }
.ppc__bars { display: flex; flex-direction: column; gap: 6px; }
.ppc__bar-row {
    width: 100%;
    padding: 2px 0;
    border: 0;
    background: none;
    cursor: pointer;
    border-radius: var(--r-chip);
    text-transform: capitalize;
}
.ppc__bar-row:hover .dc-fill { background: var(--brand-deep); }
.ppc__bar-row:focus-visible { outline: none; box-shadow: var(--focus); }
</style>
