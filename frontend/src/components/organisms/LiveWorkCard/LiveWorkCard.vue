<template>
    <div class="lwc">
        <template v-if="loading">
            <div v-for="n in 4" :key="n" class="lwc-skel-row">
                <div class="lwc-skel"></div>
            </div>
        </template>
        <template v-else-if="!rows.length">
            <div class="lwc-msg">{{ $t('dashboardCard.no_live_work') }}</div>
        </template>
        <template v-else>
            <!-- Header: total users tracking + search by user name -->
            <div class="lwc-head">
                <span class="lwc-count">
                    <span class="lwc-dot"></span>{{ userCount }} {{ userCount === 1 ? 'user' : 'users' }} tracking
                    <span class="lwc-proj-count">· {{ projectCount }} {{ projectCount === 1 ? 'project' : 'projects' }}</span>
                </span>
                <input v-model="search" class="lwc-search" type="text" placeholder="Search user…" />
            </div>
            <div v-if="!filteredRows.length" class="lwc-msg">No users match “{{ search }}”.</div>
            <div v-else class="lwc-table-wrap">
                <table class="lwc-table">
                    <thead>
                        <tr>
                            <th class="lwc-th-user">User</th>
                            <th class="lwc-th-task">Task</th>
                            <th class="lwc-th-proj">Project</th>
                            <th class="lwc-th-memo">Working on</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="r in filteredRows" :key="r.userId + '|' + r.taskId">
                            <td class="lwc-td-user">
                                <span class="lwc-dot" title="Tracking now"></span>
                                <span class="lwc-user-name" :title="r.userName">{{ r.userName }}</span>
                            </td>
                            <td class="lwc-td-task">
                                <span
                                    class="lwc-task-link"
                                    :title="(r.taskKey ? r.taskKey + ' ' : '') + r.taskName"
                                    @click.stop="openTaskDetail(r)"
                                    @mousedown.stop
                                >
                                    <b v-if="r.taskKey">{{ r.taskKey }}</b> {{ r.taskName }}
                                </span>
                            </td>
                            <td class="lwc-td-proj" :title="r.projectName">{{ r.projectName || '—' }}</td>
                            <td class="lwc-td-memo" :title="r.memo">{{ r.memo || '—' }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </template>

        <!-- Task detail sidebar — opened by clicking a task (same pattern as
             EmployeeWorkloadReportCard). -->
        <TaskDetail
            v-if="isTaskDetail"
            :companyId="companyId"
            :projectId="detailProjectId"
            :sprintId="detailSprintId"
            :taskId="detailTaskId"
            :isTaskDetailSideBar="isTaskDetail"
            @toggleTaskDetail="toggleTaskDetail"
            :zIndex="7"
        />
    </div>
</template>

<script>
export default { name: 'LiveWorkCard' };
</script>

<script setup>
import { ref, computed, watch, onMounted, inject, provide } from 'vue';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import TaskDetail from '@/views/TaskDetail/TaskDetail.vue';

// AHE-3789 — Live Work card. Who has a tracker running RIGHT NOW
// (startTimeTracker within the last 10 min), the task/project, and the tracker
// memo (LogDescription — what they typed they're working on). Fetches from the
// additive, read-only POST /dashboard/project-metrics endpoint; the header
// refresh icon re-fetches. Clicking a task opens the TaskDetail sidebar.
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

const userIdRef = inject('$userId', ref(''));
const companyId = inject('$companyId', ref(''));
const data = ref({});
const loading = ref(false);
const search = ref('');

const rows = computed(() => (Array.isArray(data.value.rows) ? data.value.rows : []));
const userCount = computed(() => new Set(rows.value.map((r) => r.userId)).size);
// Distinct projects currently being worked on (rows carry the task's project).
const projectCount = computed(() => new Set(rows.value.map((r) => r.projectId).filter(Boolean)).size);
const filteredRows = computed(() => {
    const q = search.value.trim().toLowerCase();
    if (!q) return rows.value;
    return rows.value.filter((r) => (r.userName || '').toLowerCase().includes(q));
});

const load = async () => {
    loading.value = true;
    try {
        const resp = (await apiRequest('post', `${env.DASHBOARD}/project-metrics`, {
            metric: 'live_work',
            callerUserId: (userIdRef && userIdRef.value) || '',
            callerRoleType: Number(props.companyUserDetail && props.companyUserDetail.roleType) || 3,
        }))?.data;
        data.value = (resp && resp.data) || {};
    } catch (e) {
        data.value = {};
    } finally {
        loading.value = false;
    }
};

// ─── Task-detail sidebar (same pattern as EmployeeWorkloadReportCard) ───
const isTaskDetail = ref(false);
const detailProjectId = ref('');
const detailSprintId = ref('');
const detailTaskId = ref('');
function openTaskDetail(r) {
    if (!r || !r.taskId || !r.projectId) return;
    detailProjectId.value = r.projectId;
    detailSprintId.value = r.sprintId || '';
    detailTaskId.value = r.taskId;
    isTaskDetail.value = true;
}
function toggleTaskDetail(_task, close = false) {
    isTaskDetail.value = false;
    if (close === true) return;
    detailProjectId.value = '';
    detailSprintId.value = '';
    detailTaskId.value = '';
}
provide('toggleTaskDetail', toggleTaskDetail);

watch(() => props.refreshTrigger, load);
onMounted(load);
</script>

<style scoped>
.lwc { height: 100%; width: 100%; padding: 6px 8px; overflow: hidden; display: flex; flex-direction: column; }
.lwc-msg { color: #9aa0b4; font-size: 12px; padding: 10px; }

/* Header: count + search */
.lwc-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; flex-shrink: 0; }
.lwc-count { font-size: 12px; font-weight: 600; color: #4A5061; display: inline-flex; align-items: center; white-space: nowrap; }
.lwc-proj-count { font-weight: 500; color: #6b7280; margin-left: 5px; }
.lwc-search { font-size: 12px; color: #3a3f52; border: 1px solid #E5E7EB; border-radius: 6px; padding: 3px 8px; max-width: 160px; min-width: 0; outline: none; transition: border-color 0.15s ease, box-shadow 0.15s ease; }
.lwc-search:focus { border-color: #2F3990; box-shadow: 0 0 0 2px rgba(47, 57, 144, 0.12); }

/* Table — styled to match the Employee Workload & Activity card. */
.lwc-table-wrap { flex: 1 1 auto; min-height: 0; overflow: auto; border: 1px solid #E5E7EB; border-radius: 8px; }
.lwc-table { width: 100%; border-collapse: collapse; font-size: 13px; color: #1F212A; }
.lwc-table thead th { position: sticky; top: 0; background: #FAFBFC; color: #4A5061; font-weight: 600; text-align: left; padding: 9px 10px; border-bottom: 1px solid #E5E7EB; white-space: nowrap; box-sizing: border-box; }
.lwc-table tbody td { padding: 8px 10px; border-bottom: 1px solid #F1F3F9; vertical-align: middle; max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lwc-table tbody tr:last-child td { border-bottom: 0; }
.lwc-table tbody tr:hover td { background: #FAFBFC; }
.lwc-td-user { font-weight: 600; white-space: nowrap; }
.lwc-task-link { color: #0e7490; cursor: pointer; }
.lwc-task-link:hover { text-decoration: underline; }
.lwc-task-link b { color: #0e7490; }
.lwc-td-proj { color: #6B7280; }
.lwc-td-memo { color: #4A5061; }
.lwc-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #16a34a; margin-right: 6px; vertical-align: middle; box-shadow: 0 0 0 0 rgba(22, 163, 74, 0.5); animation: lwc-pulse 1.8s infinite; }
@keyframes lwc-pulse { 0% { box-shadow: 0 0 0 0 rgba(22, 163, 74, 0.5); } 70% { box-shadow: 0 0 0 6px rgba(22, 163, 74, 0); } 100% { box-shadow: 0 0 0 0 rgba(22, 163, 74, 0); } }

/* Loading skeleton */
.lwc-skel-row { padding: 6px 4px; }
.lwc-skel { height: 16px; border-radius: 4px; background: linear-gradient(90deg, #eef0f6 25%, #e3e7f1 37%, #eef0f6 63%); background-size: 400% 100%; animation: lwc-shimmer 1.4s ease infinite; }
@keyframes lwc-shimmer { 0% { background-position: 100% 0; } 100% { background-position: 0 0; } }
</style>
