<template>
    <div class="lwt">
        <div v-if="loading && !rows.length" class="lwt-msg">…</div>
        <template v-else>
            <div class="lwt-head">
                <span class="lwt-count">{{ rows.length }} {{ rows.length === 1 ? 'person' : 'people' }} working now</span>
            </div>
            <div v-if="!rows.length" class="lwt-msg">{{ $t('dashboardCard.no_one_working_now') }}</div>
            <div v-else class="lwt-table-wrap">
                <table class="lwt-table">
                    <thead>
                        <tr>
                            <th>{{ $t('dashboardCard.lwt_user') }}</th>
                            <th>{{ $t('dashboardCard.lwt_task') }}</th>
                            <th>{{ $t('dashboardCard.location') }}</th>
                            <th class="lwt-num">{{ $t('dashboardCard.lwt_task_logged') }}</th>
                            <th class="lwt-num">{{ $t('dashboardCard.lwt_logged_today') }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="r in rows" :key="r.key">
                            <td class="lwt-user">{{ r.user }}</td>
                            <td class="lwt-task">
                                <div class="lwt-task-line">
                                    <span class="lwt-running" title="Tracker running">●</span>
                                    <span class="lwt-task-name" :title="r.task">{{ r.task }}</span>
                                </div>
                                <div v-if="r.comment" class="lwt-comment" :title="r.comment">{{ r.comment }}</div>
                            </td>
                            <td class="lwt-proj" :title="r.project">{{ r.project || '—' }}</td>
                            <td class="lwt-num">{{ formatMinutes(r.logged) }}</td>
                            <td class="lwt-num lwt-day">{{ formatMinutes(r.dayLogged) }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </template>
    </div>
</template>

<script>
export default { name: 'ActiveWorkTableCard' };
</script>

<script setup>
import { ref, watch, onMounted, inject } from 'vue';
import { useStore } from 'vuex';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { teamIdToUserId, buildFilterQuery } from '@/composable/commonFunction';
import { resolveIsoRange, formatMinutes } from '@/composable/useResourceWorkload';

// Resource Utilization card #4 — the "Live Work Table". Reuses the
// employee-workload resolver in `currentOnly` mode (employees with a tracker
// running right now) and flattens it into a who-is-working-on-what list.
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

const load = async () => {
    loading.value = true;
    try {
        const { dateFrom, dateTo } = resolveIsoRange(1); // today for hour context
        const employeeIds = teamIdToUserId(props.cardData?.AssigneeUserId || [], teamsArr);
        const payload = {
            employeeIds: Array.isArray(employeeIds) ? employeeIds : [],
            projectIds: props.cardData?.projectId || [],
            isParentTask: props.cardData?.isParentTask !== false,
            dateFrom,
            dateTo,
            currentOnly: true,
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
        const flat = [];
        (d.employees || []).forEach((emp) => {
            (emp.tasks || []).forEach((t) => {
                if (!t.isTracking) return; // only live-tracked tasks
                flat.push({
                    key: `${emp._id}|${t._id}`,
                    user: emp.name || '—',
                    task: t.TaskName || '—',
                    project: t.ProjectName || '',
                    logged: t.loggedMinutes || 0,
                    // The person's TOTAL logged today (all tasks), not just this one.
                    dayLogged: emp.dayLoggedMinutes || 0,
                    // Work comment from the timesheet (running/latest log).
                    comment: t.logDescription || '',
                });
            });
        });
        rows.value = flat;
    } catch (e) {
        console.error('ActiveWorkTableCard fetch error:', e);
        rows.value = [];
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
.lwt { height: 100%; width: 100%; padding: 8px 10px; overflow: auto; display: flex; flex-direction: column; gap: 6px; }
.lwt-msg { color: #9aa0b4; font-size: 12px; padding: 10px 0; }
.lwt-head { font-size: 12px; font-weight: 600; color: #0d9488; }
.lwt-table-wrap { overflow: auto; }
.lwt-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.lwt-table th { text-align: left; color: #6b7280; font-weight: 600; padding: 4px 6px; border-bottom: 1px solid #eef0f6; position: sticky; top: 0; background: #fff; }
/* Numeric column headers must right-align to line up with their right-aligned
   values (the element+class rule above otherwise wins over .lwt-num). */
.lwt-table th.lwt-num { text-align: right; }
.lwt-table td { padding: 5px 6px; border-bottom: 1px solid #f4f5f9; color: #3a3f52; }
.lwt-num { text-align: right; white-space: nowrap; min-width: 66px; }
.lwt-user { font-weight: 600; white-space: nowrap; }
.lwt-proj { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lwt-task { max-width: 260px; }
.lwt-task-line { display: flex; align-items: center; overflow: hidden; }
.lwt-task-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lwt-comment { font-size: 10px; color: #9aa0b4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 1px; }
.lwt-running { color: #16a34a; margin-right: 5px; font-size: 10px; flex: none; }
.lwt-day { font-weight: 600; color: #0f766e; }
</style>
