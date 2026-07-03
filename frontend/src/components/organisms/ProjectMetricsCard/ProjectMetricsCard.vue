<template>
    <div class="ppm">
        <template v-if="loading">
            <template v-if="mode === 'number'">
                <div class="ppm-skel ppm-skel-num"></div>
                <div class="ppm-skel ppm-skel-lbl"></div>
            </template>
            <div v-else class="ppm-bars">
                <div v-for="n in 4" :key="n" class="ppm-bar-row">
                    <div class="ppm-skel ppm-skel-barlabel"></div>
                    <div class="ppm-skel ppm-skel-bartrack"></div>
                </div>
            </div>
        </template>
        <template v-else-if="mode === 'number'">
            <div class="ppm-clickzone" role="button" :title="$t('dashboardCard.plm_click_hint')" @click="openDrill(null)">
                <div class="ppm-number">{{ count }}</div>
                <div class="ppm-number-label">{{ $t('dashboardCard.active_projects_card_title') }}</div>
            </div>
        </template>
        <template v-else>
            <div v-if="!typeRows.length" class="ppm-msg">{{ $t('dashboardCard.no_data_available') }}</div>
            <div v-else class="ppm-bars">
                <div v-for="r in typeRows" :key="r.key" class="ppm-bar-row ppm-clickable" role="button" :title="$t('dashboardCard.plm_click_hint')" @click="openDrill(r)">
                    <span class="ppm-label" :title="r.label">{{ r.label }}</span>
                    <div class="ppm-track"><div class="ppm-fill" :style="{ width: pct(r.value) + '%' }"></div></div>
                    <span class="ppm-val">{{ r.value }}</span>
                </div>
            </div>
        </template>

        <ProjectListModal
            :modelValue="drillOpen"
            :title="drillTitle"
            :projects="drillProjects"
            :loading="drillLoading"
            @close="drillOpen = false"
        />
    </div>
</template>

<script>
export default { name: 'ProjectMetricsCard' };
</script>

<script setup>
import { ref, computed, watch, onMounted, inject } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import ProjectListModal from '@/components/molecules/ProjectListModal/ProjectListModal.vue';

// AHE-3789 — company-wide project-progress cards. Both fetch a server-side,
// companyId-scoped count from POST /dashboard/project-metrics, so the totals
// reflect ALL active projects in the company — not just the private spaces the
// viewer happens to belong to. Additive + read-only; no effect on other cards.
//   ActiveProjectsCard  → count of active projects (statusType !== 'close')
//   ProjectsByTypeCard  → active projects grouped by ProjectType
// Clicking the number / a type bar opens a drill-down modal listing the
// projects behind it (includeProjects mode of the same endpoint).
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
    ActiveProjectsCard: { metric: 'active_projects', mode: 'number' },
    ProjectsByTypeCard: { metric: 'projects_by_type', mode: 'bar' },
};
const cfg = computed(() => CONFIG[props.componentId] || CONFIG.ActiveProjectsCard);
const mode = computed(() => cfg.value.mode);

// Friendly labels for known ProjectType codes; unknown values fall back to raw.
const TYPE_LABELS = {
    Fix: 'Fixed', Fixed: 'Fixed', Hourly: 'Hourly',
    InHouse: 'In House', 'In House': 'In House', Retainer: 'Retainer',
};

const { t } = useI18n();
const data = ref({});
const loading = ref(false);
const count = computed(() => Number(data.value.count) || 0);
const typeRows = computed(() =>
    (Array.isArray(data.value.rows) ? data.value.rows : []).map((r) => ({
        key: r.key,
        value: r.value,
        label: TYPE_LABELS[r.key] || (r.key === 'unspecified' ? 'Unspecified' : r.key),
    }))
);
const maxVal = computed(() => typeRows.value.reduce((m, r) => Math.max(m, r.value || 0), 0) || 1);
const pct = (v) => Math.round(((v || 0) / maxVal.value) * 100);

const userIdRef = inject('$userId', ref(''));
const basePayload = () => ({
    metric: cfg.value.metric,
    callerUserId: (userIdRef && userIdRef.value) || '',
    callerRoleType: Number(props.companyUserDetail && props.companyUserDetail.roleType) || 3,
});
const load = async () => {
    loading.value = true;
    try {
        const resp = (await apiRequest('post', `${env.DASHBOARD}/project-metrics`, basePayload()))?.data;
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
const drillRow = ref(null); // null = whole count; else the clicked type row
const allDrillProjects = ref([]);

const drillTitle = computed(() => (drillRow.value
    ? `${t('dashboardCard.projects_by_type_card_title')} · ${drillRow.value.label}`
    : t('dashboardCard.active_projects_card_title')));
const drillProjects = computed(() => (drillRow.value
    ? allDrillProjects.value.filter((p) => p.type === drillRow.value.key)
    : allDrillProjects.value));

const openDrill = async (row) => {
    drillRow.value = row;
    drillOpen.value = true;
    drillLoading.value = true;
    try {
        const resp = (await apiRequest('post', `${env.DASHBOARD}/project-metrics`, { ...basePayload(), includeProjects: true }))?.data;
        allDrillProjects.value = (resp && resp.data && resp.data.projects) || [];
    } catch (e) {
        allDrillProjects.value = [];
    } finally {
        drillLoading.value = false;
    }
};

watch(() => props.refreshTrigger, load);
onMounted(load);
</script>

<style scoped>
.ppm { height: 100%; width: 100%; padding: 6px 8px; overflow: auto; display: flex; flex-direction: column; }
.ppm-msg { color: #9aa0b4; font-size: 12px; padding: 10px; }
.ppm-clickzone { display: flex; flex-direction: column; flex: 1; cursor: pointer; border-radius: 8px; transition: background-color 0.15s ease; }
.ppm-clickzone:hover { background: #f5f7fb; }
.ppm-clickable { cursor: pointer; border-radius: 4px; }
.ppm-clickable:hover { background: #f5f7fb; }
.ppm-number { font-size: 40px; font-weight: 700; color: #0e7490; text-align: center; margin-top: auto; }
.ppm-number-label { font-size: 12px; color: #6b7280; text-align: center; margin-bottom: auto; }
.ppm-bars { display: flex; flex-direction: column; gap: 7px; }
.ppm-bar-row { display: flex; align-items: center; gap: 8px; }
.ppm-label { width: 40%; font-size: 12px; color: #3a3f52; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ppm-track { flex: 1; height: 14px; background: #eef0f6; border-radius: 4px; overflow: hidden; }
.ppm-fill { height: 100%; background: #0e7490; }
.ppm-val { width: 44px; text-align: right; font-size: 12px; color: #3a3f52; }
.ppm-skel { background: linear-gradient(90deg, #eef0f6 25%, #e3e7f1 37%, #eef0f6 63%); background-size: 400% 100%; animation: ppm-shimmer 1.4s ease infinite; border-radius: 4px; }
@keyframes ppm-shimmer { 0% { background-position: 100% 0; } 100% { background-position: 0 0; } }
.ppm-skel-num { width: 90px; height: 40px; margin: auto auto 8px auto; }
.ppm-skel-lbl { width: 110px; height: 12px; margin: 0 auto auto auto; }
.ppm-skel-barlabel { width: 40%; height: 12px; }
.ppm-skel-bartrack { flex: 1; height: 14px; }
</style>
