<template>
    <div class="ds">
        <CardSkeleton v-if="loading && !tasks.length" :rows="6" />
        <template v-else>
            <div v-if="!tasks.length" class="ds-msg">{{ $t('dashboardCard.due_soon_empty') }}</div>
            <div v-else class="ds-list">
                <div v-for="t in tasks" :key="t.taskId" class="ds-row" @click="openTaskDetail(t)">
                    <span class="ds-due-chip" :class="dueClass(t)">{{ dueLabel(t) }}</span>
                    <div class="ds-main">
                        <div class="ds-title" :title="(t.taskKey ? t.taskKey + ' ' : '') + t.taskName">
                            <b v-if="t.taskKey" class="ds-key">{{ t.taskKey }}</b>
                            <span class="ds-name">{{ t.taskName }}</span>
                        </div>
                        <div class="ds-meta">
                            <span v-if="t.projectName" class="ds-proj" :title="t.projectName">{{ t.projectName }}</span>
                            <span v-if="t.priority" class="ds-pri" :class="'ds-pri-' + priorityRank(t.priority)">{{ t.priority }}</span>
                        </div>
                    </div>
                </div>
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
export default { name: 'DueSoonCard' };
</script>

<script setup>
import { ref, watch, onMounted, inject, provide } from 'vue';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { buildFilterQuery } from '@/composable/commonFunction';
import CardSkeleton from '@/components/atom/CardSkeleton/CardSkeleton.vue';
import TaskDetail from '@/views/TaskDetail/TaskDetail.vue';
import { useI18n } from 'vue-i18n';

const { t: translate } = useI18n();
// Member self-card — my open tasks due within the next N days, soonest first.
// Self-scoped on the backend (caller = req.uid).
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
const tasks = ref([]);
const loading = ref(false);

const PRIORITY_RANK = { urgent: 0, highest: 0, high: 1, medium: 2, normal: 2, low: 3, lowest: 3 };
const priorityRank = (p) => PRIORITY_RANK[String(p || '').toLowerCase()] ?? 2;

const dueLabel = (t) => {
    if (t.daysUntil === null || t.daysUntil === undefined) return '—';
    if (t.daysUntil === 0) return translate('dashboardCard.Today');
    if (t.daysUntil === 1) return translate('dashboardCard.Tomorrow');
    return `${t.daysUntil}d`;
};
const dueClass = (t) => (t.daysUntil <= 0 ? 'ds-due-now' : t.daysUntil <= 2 ? 'ds-due-soon' : 'ds-due-later');

const load = async () => {
    loading.value = true;
    try {
        const fd = Array.isArray(props.filterData) ? props.filterData : Object.values(props.filterData || {});
        const taskMatch = fd.length ? buildFilterQuery(fd, userId && userId.value ? String(userId.value) : '') : null;
        const res = await apiRequest('post', `${env.MY_DUE_SOON}`, { days: Number(props.cardData?.days) || 7, taskMatch });
        const d = res && res.data && res.data.status ? (res.data.data || {}) : {};
        tasks.value = d.tasks || [];
    } catch (e) {
        console.error('DueSoonCard fetch error:', e);
        tasks.value = [];
    } finally {
        loading.value = false;
    }
};

// ─── Task-detail sidebar ───
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
.ds { height: 100%; width: 100%; padding: 8px 10px; overflow: auto; }
.ds-msg { color: #9aa0b4; font-size: 12px; padding: 10px 0; }
.ds-list { display: flex; flex-direction: column; }
.ds-row { display: flex; align-items: center; gap: 8px; padding: 7px 4px; border-bottom: 1px solid #f4f5f9; cursor: pointer; }
.ds-row:hover { background: #f9fafc; }
.ds-due-chip { flex: none; min-width: 44px; text-align: center; font-size: 10.5px; font-weight: 600; padding: 2px 6px; border-radius: 8px; }
.ds-due-now { background: #fee2e2; color: #b91c1c; }
.ds-due-soon { background: #ffedd5; color: #c2410c; }
.ds-due-later { background: #eef2f7; color: #6b7280; }
.ds-main { flex: 1; min-width: 0; }
.ds-title { display: flex; align-items: center; gap: 5px; overflow: hidden; }
.ds-key { color: #0e7490; font-size: 11px; flex: none; }
.ds-name { font-size: 12.5px; color: #2f3546; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ds-meta { display: flex; align-items: center; gap: 8px; margin-top: 2px; }
.ds-proj { font-size: 10.5px; color: #9aa0b4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 60%; }
.ds-pri { font-size: 10px; padding: 0 6px; border-radius: 8px; text-transform: capitalize; }
.ds-pri-0 { background: #fee2e2; color: #b91c1c; }
.ds-pri-1 { background: #ffedd5; color: #c2410c; }
.ds-pri-2 { background: #e0f2fe; color: #0369a1; }
.ds-pri-3 { background: #f3f4f6; color: #6b7280; }
</style>
