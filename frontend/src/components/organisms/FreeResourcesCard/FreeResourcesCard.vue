<template>
    <div class="frc">
        <CardSkeleton v-if="loading && !freeRows.length" :rows="5" />
        <template v-else>
            <div class="frc-head">
                <span class="frc-count">{{ freeRows.length }} free / under-utilised</span>
                <span class="frc-sub">planned &lt; {{ thresholdHours }}h and logged &le; {{ loggedThresholdHours }}h today</span>
            </div>
            <div v-if="!freeRows.length" class="frc-msg">{{ $t('dashboardCard.no_free_resources') }}</div>
            <div v-else class="frc-table-wrap">
                <table class="frc-table">
                    <thead>
                        <tr>
                            <th>{{ $t('dashboardCard.lwt_user') }}</th>
                            <th class="frc-num">{{ $t('dashboardCard.show_planned_hours') }}</th>
                            <th class="frc-num">{{ $t('dashboardCard.show_logged_hours') }}</th>
                            <th>{{ $t('dashboardCard.frc_reason') }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="r in freeRows" :key="r._id">
                            <td class="frc-user">{{ r.name }}</td>
                            <td class="frc-num">{{ formatMinutes(r.planned) }}</td>
                            <td class="frc-num">{{ formatMinutes(r.logged) }}</td>
                            <td><span class="frc-tag">{{ r.reason }}</span></td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </template>
    </div>
</template>

<script>
export default { name: 'FreeResourcesCard' };
</script>

<script setup>
import { ref, computed, watch, onMounted, inject } from 'vue';
import { useStore } from 'vuex';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { teamIdToUserId, buildFilterQuery } from '@/composable/commonFunction';
import { resolveIsoRange, formatMinutes } from '@/composable/useResourceWorkload';
import CardSkeleton from '@/components/atom/CardSkeleton/CardSkeleton.vue';

// Resource Utilization card #7 — "Free or in-training resources".
// Reuses employee-workload for TODAY, then flags a user free when they are
// NOT on approved leave and BOTH planned < the planned threshold (default 3h)
// AND logged <= the logged threshold (default 0h = nothing logged) — i.e. the
// user has neither meaningful planned nor logged work. Both thresholds are
// configurable per card.
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

const userId = inject('$userId');
const { getters } = useStore();
const teamsArr = getters['settings/teams'] || [];

const employees = ref([]);
const loading = ref(false);

// Planned threshold: free when planned hours fall UNDER this (default 3h).
const thresholdHours = computed(() => Number(props.cardData?.freeThresholdHours) || 3);
const thresholdMin = computed(() => thresholdHours.value * 60);
// Logged threshold: free when logged hours are AT OR BELOW this (default 0h,
// i.e. nothing logged). Number(...)||0 keeps 0 as a valid configured value.
const loggedThresholdHours = computed(() => Number(props.cardData?.loggedThresholdHours) || 0);
const loggedThresholdMin = computed(() => loggedThresholdHours.value * 60);

const freeRows = computed(() => {
    return (employees.value || [])
        .filter((e) => !(e.onLeave && e.onLeave.approved))
        .map((e) => {
            const planned = Number(e.plannedMinutes) || 0;
            const logged = Number(e.loggedMinutes) || 0;
            const underPlanned = planned < thresholdMin.value;
            const underLogged = logged <= loggedThresholdMin.value;
            // Free ONLY when BOTH are true — the user has neither meaningful
            // planned work nor logged work. Having either one drops them off
            // the list.
            const free = underPlanned && underLogged;
            const plannedPart = planned === 0 ? 'no plan' : `under ${thresholdHours.value}h planned`;
            const loggedPart = loggedThresholdMin.value === 0 ? 'nothing logged' : `≤ ${loggedThresholdHours.value}h logged`;
            const reason = free ? `${plannedPart} · ${loggedPart}` : '';
            return { _id: e._id, name: e.name || '—', planned, logged, free, reason };
        })
        .filter((r) => r.free)
        .sort((a, b) => a.planned - b.planned);
});

const load = async () => {
    loading.value = true;
    try {
        const { dateFrom, dateTo } = resolveIsoRange(1); // today
        const employeeIds = teamIdToUserId(props.cardData?.AssigneeUserId || [], teamsArr);
        const payload = {
            employeeIds: Array.isArray(employeeIds) ? employeeIds : [],
            projectIds: props.cardData?.projectId || [],
            isParentTask: props.cardData?.isParentTask !== false,
            dateFrom,
            dateTo,
            currentOnly: false,
            callerUserId: userId && userId.value ? String(userId.value) : '',
            callerRoleType: props.companyUserDetail?.roleType || 3,
            // Advanced "Add filter" builder → task-field match (buildFilterQuery).
            taskMatch: (() => {
                const fd = Array.isArray(props.filterData) ? props.filterData : Object.values(props.filterData || {});
                return fd.length ? buildFilterQuery(fd, userId && userId.value ? String(userId.value) : '') : null;
            })(),
        };
        const res = await apiRequest('post', `${env.DASHBOARD}/employee-workload`, payload);
        const d = res && res.data && res.data.status ? (res.data.data || {}) : {};
        employees.value = d.employees || [];
    } catch (e) {
        console.error('FreeResourcesCard fetch error:', e);
        employees.value = [];
    } finally {
        loading.value = false;
    }
};

watch(() => props.refreshTrigger, load);
watch(() => props.cardData, load, { deep: true });
watch(() => props.filterData, load, { deep: true });
onMounted(load);
</script>

<style scoped>
.frc { height: 100%; width: 100%; padding: 8px 10px; overflow: auto; display: flex; flex-direction: column; gap: 6px; }
.frc-msg { color: #9aa0b4; font-size: 12px; padding: 10px 0; }
.frc-head { display: flex; flex-direction: column; }
.frc-count { font-size: 12px; font-weight: 600; color: #0d9488; }
.frc-sub { font-size: 10px; color: #9aa0b4; }
.frc-table-wrap { overflow: auto; }
.frc-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.frc-table th { text-align: left; color: #6b7280; font-weight: 600; padding: 4px 6px; border-bottom: 1px solid #eef0f6; position: sticky; top: 0; background: #fff; }
.frc-table th.frc-num { text-align: right; }
.frc-table td { padding: 5px 6px; border-bottom: 1px solid #f4f5f9; color: #3a3f52; }
.frc-num { text-align: right; }
.frc-user { font-weight: 600; white-space: nowrap; }
.frc-tag { font-size: 11px; color: #b45309; background: #fef3c7; border-radius: 4px; padding: 1px 6px; white-space: nowrap; }
</style>
