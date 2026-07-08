<template>
    <div class="mlv">
        <div v-if="!configuredProjects.length" class="mlv-msg">{{ $t('dashboardCard.my_leave_setup_hint') }}</div>
        <CardSkeleton v-else-if="loading && !rows.length" :rows="5" />
        <template v-else>
            <div v-if="!rows.length" class="mlv-msg">{{ $t('dashboardCard.my_leave_empty') }}</div>
            <div v-else class="mlv-table-wrap">
                <table class="mlv-table">
                    <thead>
                        <tr>
                            <th>{{ $t('dashboardCard.on_leave_ticket') }}</th>
                            <th>{{ $t('dashboardCard.on_leave_period') }}</th>
                            <th>{{ $t('dashboardCard.status') }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="r in rows" :key="r.taskId">
                            <td class="mlv-ticket" :title="(r.taskKey ? r.taskKey + ' ' : '') + r.taskName">
                                <span class="mlv-task-link" @click.stop="openTaskDetail(r)" @mousedown.stop>
                                    <b v-if="r.taskKey">{{ r.taskKey }}</b> {{ r.taskName }}
                                </span>
                            </td>
                            <td class="mlv-dates">{{ periodOf(r) }}</td>
                            <td><span class="mlv-status" :style="statusStyle(r.statusKey)">{{ statusName(r.statusKey) }}</span></td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </template>

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
export default { name: 'MyLeaveCard' };
</script>

<script setup>
import { ref, computed, watch, onMounted, inject, provide } from 'vue';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { buildFilterQuery } from '@/composable/commonFunction';
import CardSkeleton from '@/components/atom/CardSkeleton/CardSkeleton.vue';
import TaskDetail from '@/views/TaskDetail/TaskDetail.vue';

// Member self-card — my own leave tickets (in the configured leave project)
// across all statuses, so I can see where each request stands. Self-scoped
// on the backend (caller = req.uid).
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

const userId = inject('$userId', ref(''));
const rows = ref([]);
const loading = ref(false);
const configuredProjects = computed(() => (Array.isArray(props.cardData?.projectId) ? props.cardData.projectId : []));

// statusKey → { name, color } from the company status settings (same shape as OnLeaveCard).
const statusList = computed(() => {
    const src = props.taskStatusArray;
    return Array.isArray(src) ? src : (src && Array.isArray(src.settings) ? src.settings : []);
});
const statusName = (key) => statusList.value.find((s) => s.key === key)?.name || '—';
const statusStyle = (key) => {
    const color = statusList.value.find((s) => s.key === key)?.color;
    return color ? { backgroundColor: `${color}22`, color } : {};
};

const fmt = (d) => (d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '');
const periodOf = (r) => {
    const from = fmt(r.startDate);
    const to = fmt(r.dueDate);
    if (from && to && from !== to) return `${from} – ${to}`;
    return from || to || '—';
};

const load = async () => {
    if (!configuredProjects.value.length) return;
    loading.value = true;
    try {
        const fd = Array.isArray(props.filterData) ? props.filterData : Object.values(props.filterData || {});
        const taskMatch = fd.length ? buildFilterQuery(fd, userId && userId.value ? String(userId.value) : '') : null;
        const res = await apiRequest('post', `${env.MY_LEAVE}`, { projectIds: configuredProjects.value, taskMatch });
        const d = res && res.data && res.data.status ? (res.data.data || {}) : {};
        rows.value = d.rows || [];
    } catch (e) {
        console.error('MyLeaveCard fetch error:', e);
        rows.value = [];
    } finally {
        loading.value = false;
    }
};

// ─── Task-detail sidebar (same pattern as OnLeaveCard) ───
const companyId = inject('$companyId', ref(''));
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
watch(() => props.cardData, load, { deep: true });
watch(() => props.filterData, load, { deep: true });
onMounted(load);
</script>

<style scoped>
.mlv { height: 100%; width: 100%; padding: 8px 10px; overflow: auto; }
.mlv-msg { color: #9aa0b4; font-size: 12px; padding: 10px 0; }
.mlv-table-wrap { overflow: auto; }
.mlv-table { width: 100%; border-collapse: collapse; font-size: 12px; white-space: nowrap; }
.mlv-table th { text-align: left; color: #6b7280; font-weight: 600; padding: 4px 6px; border-bottom: 1px solid #eef0f6; position: sticky; top: 0; background: #fff; }
.mlv-table td { padding: 5px 6px; border-bottom: 1px solid #f4f5f9; color: #3a3f52; }
.mlv-ticket { max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
.mlv-task-link { color: #0e7490; cursor: pointer; }
.mlv-task-link:hover { text-decoration: underline; }
.mlv-task-link b { color: #0e7490; font-size: 11px; }
.mlv-dates { color: #6b7280; }
.mlv-status { display: inline-block; padding: 1px 8px; border-radius: 10px; background: #f3f4f6; font-size: 11px; }
</style>
