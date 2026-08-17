<template>
    <div class="wtt">
        <CardSkeleton v-if="loading && !rows.length" :rows="5" />
        <template v-else>
            <div v-if="!rows.length" class="wtt-msg">{{ $t('dashboardCard.no_data_available') }}</div>
            <div v-else class="wtt-table-wrap">
                <table class="wtt-table">
                    <thead>
                        <tr>
                            <th>{{ $t('dashboardCard.lwt_user') }}</th>
                            <th>{{ $t('dashboardCard.location') }}</th>
                            <th class="wtt-num">{{ $t('dashboardCard.wtt_total_worked') }}</th>
                            <th class="wtt-num">{{ $t('dashboardCard.wtt_in_progress') }}</th>
                            <th class="wtt-num">{{ $t('dashboardCard.wtt_in_review') }}</th>
                            <th class="wtt-num">{{ $t('dashboardCard.wtt_backlog') }}</th>
                            <th class="wtt-num">{{ $t('dashboardCard.wtt_complete') }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="r in rows" :key="r.key">
                            <td class="wtt-user">{{ r.user }}</td>
                            <td class="wtt-proj" :title="r.project">{{ r.project || '—' }}</td>
                            <td class="wtt-num wtt-total">{{ r.total }}</td>
                            <td class="wtt-num">{{ dash(r.progress) }}</td>
                            <td class="wtt-num">{{ dash(r.review) }}</td>
                            <td class="wtt-num">{{ dash(r.backlog) }}</td>
                            <td class="wtt-num">{{ dash(r.complete) }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </template>
    </div>
</template>

<script>
export default { name: 'WorkedTasksTableCard' };
</script>

<script setup>
import { ref, computed, watch, onMounted, inject } from 'vue';
import { useStore } from 'vuex';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { teamIdToUserId, buildFilterQuery } from '@/composable/commonFunction';
import { resolveCardRange, bucketForStatus } from '@/composable/useResourceWorkload';
import CardSkeleton from '@/components/atom/CardSkeleton/CardSkeleton.vue';

// Resource Utilization card #11 — "Table of worked tasks, date-range wise".
// Reuses employee-workload for the selected range; splits each user×project's
// logged minutes into the four canonical status buckets (name-matched).
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

const rows = ref([]);
const loading = ref(false);

// Period lives in the card-header dropdown; 0 = Auto → dashboard range.
const globalRange = inject('dashboardGlobalRange', null);
const timerange = computed(() => {
    const v = Number(props.cardData?.timerange);
    return Number.isFinite(v) && v >= 0 && v <= 8 ? v : 3; // default this week
});

const dash = (v) => (v ? v : '—');

const load = async () => {
    loading.value = true;
    try {
        const { dateFrom, dateTo } = resolveCardRange(timerange.value, globalRange && globalRange.value);
        const employeeIds = teamIdToUserId(props.cardData?.AssigneeUserId || [], teamsArr);
        const payload = {
            employeeIds: Array.isArray(employeeIds) ? employeeIds : [],
            projectIds: props.cardData?.projectId || [],
            projectMode: props.cardData?.projectMode || 'all',
            statusKeys: props.cardData?.statusArray || [],
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

        // Group by user × project, splitting logged minutes into buckets.
        // Count DISTINCT tasks the user worked on (logged time > 0) per
        // project, bucketed by where each task CURRENTLY sits. Each task lands
        // in exactly one bucket, so the four columns sum to the total.
        const grouped = {};
        (d.employees || []).forEach((emp) => {
            (emp.tasks || []).forEach((t) => {
                const logged = Number(t.loggedMinutes) || 0;
                if (!logged) return; // "worked upon" = actually logged time
                const projKey = t.ProjectID || t.ProjectName || 'none';
                const key = `${emp._id}|${projKey}`;
                if (!grouped[key]) {
                    grouped[key] = {
                        key, user: emp.name || '—', project: t.ProjectName || '',
                        total: 0, progress: 0, review: 0, backlog: 0, complete: 0,
                    };
                }
                const bucket = bucketForStatus(t.status && t.status.text, t.statusType);
                grouped[key][bucket] += 1;   // count of tasks in this status
                grouped[key].total += 1;     // total tasks worked in this project
            });
        });
        rows.value = Object.values(grouped).sort((a, b) => b.total - a.total);
    } catch (e) {
        console.error('WorkedTasksTableCard fetch error:', e);
        rows.value = [];
    } finally {
        loading.value = false;
    }
};

watch(() => props.refreshTrigger, load);
watch(() => props.cardData, load, { deep: true });
watch(() => props.filterData, load, { deep: true });
// Auto mode — track the dashboard-level range.
watch(() => globalRange && globalRange.value, () => { if (timerange.value === 0) load(); }, { deep: true });
onMounted(load);
</script>

<style scoped>
.wtt { height: 100%; width: 100%; padding: 8px 10px; overflow: auto; display: flex; flex-direction: column; gap: 6px; }
.wtt-msg { color: #9aa0b4; font-size: 12px; padding: 10px 0; }
.wtt-table-wrap { overflow: auto; }
.wtt-table { width: 100%; border-collapse: collapse; font-size: 12px; white-space: nowrap; }
.wtt-table th { text-align: left; color: #6b7280; font-weight: 600; padding: 4px 6px; border-bottom: 1px solid #eef0f6; position: sticky; top: 0; background: #fff; }
.wtt-table th.wtt-num { text-align: right; }
.wtt-table td { padding: 5px 6px; border-bottom: 1px solid #f4f5f9; color: #3a3f52; }
.wtt-num { text-align: right; }
.wtt-user { font-weight: 600; }
.wtt-proj { max-width: 160px; overflow: hidden; text-overflow: ellipsis; }
.wtt-total { font-weight: 600; color: #0f766e; }
</style>
