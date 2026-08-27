<template>
    <div class="nu">
        <CardSkeleton v-if="loading && !tasks.length" :rows="6" />
        <template v-else>
            <div v-if="!tasks.length" class="nu-msg">{{ $t('dashboardCard.next_up_empty') }}</div>
            <div v-else class="nu-list">
                <div v-for="(t, i) in tasks" :key="t.taskId" class="nu-row" role="button" tabindex="0" @click="openTaskDetail(t)" @keydown.enter="openTaskDetail(t)" @keydown.space.prevent="openTaskDetail(t)">
                    <span class="nu-rank">{{ i + 1 }}</span>
                    <div class="nu-main">
                        <div class="nu-title" :title="(t.taskKey ? t.taskKey + ' ' : '') + t.taskName">
                            <b v-if="t.taskKey" class="nu-key">{{ t.taskKey }}</b>
                            <span class="nu-name">{{ t.taskName }}</span>
                        </div>
                        <div class="nu-meta">
                            <span v-if="t.projectName" class="nu-proj" :title="t.projectName">{{ t.projectName }}</span>
                            <span v-if="t.priority" class="nu-pri" :class="'nu-pri-' + priorityRank(t.priority)">{{ t.priority }}</span>
                        </div>
                    </div>
                    <span class="nu-due" :class="{ 'nu-due-over': t.overdue, 'nu-due-none': !t.dueDate }">{{ dueLabel(t) }}</span>
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
export default { name: 'NextUpCard' };
</script>

<script setup>
import { ref, watch, onMounted, inject, provide } from 'vue';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { buildFilterQuery } from '@/composable/commonFunction';
import CardSkeleton from '@/components/atom/CardSkeleton/CardSkeleton.vue';
import TaskDetail from '@/views/TaskDetail/TaskDetail.vue';
import { resolveTaskOpenIds } from '@/utils/taskOpenProjectId';
import { useI18n } from 'vue-i18n';

const { t: translate } = useI18n();
// Member self-card — my open tasks ordered by due date then priority.
// Self-scoped on the backend (caller = req.uid); no filters/range needed.
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
    if (!t.dueDate) return '—';
    const d = new Date(t.dueDate);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const day = new Date(d); day.setHours(0, 0, 0, 0);
    const diff = Math.round((day - today) / 86400000);
    if (diff === 0) return translate('dashboardCard.Today');
    if (diff === 1) return translate('dashboardCard.Tomorrow');
    if (diff === -1) return translate('dashboardCard.Yesterday');
    if (diff < 0) return translate('dashboardCard.overdue_days', { n: Math.abs(diff) });
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

const load = async () => {
    loading.value = true;
    try {
        const fd = Array.isArray(props.filterData) ? props.filterData : Object.values(props.filterData || {});
        const taskMatch = fd.length ? buildFilterQuery(fd, userId && userId.value ? String(userId.value) : '') : null;
        const res = await apiRequest('post', `${env.MY_NEXT_TASKS}`, { limit: Number(props.cardData?.limit) || 8, taskMatch, projectId: props.cardData?.projectId || [], projectMode: props.cardData?.projectMode || 'all' });
        const d = res && res.data && res.data.status ? (res.data.data || {}) : {};
        tasks.value = d.tasks || [];
    } catch (e) {
        console.error('NextUpCard fetch error:', e);
        tasks.value = [];
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
    const ids = resolveTaskOpenIds(r);
    if (!ids.taskId) return;
    detailProjectId.value = ids.projectId;
    detailSprintId.value = ids.sprintId;
    detailTaskId.value = ids.taskId;
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
.nu { height: 100%; width: 100%; padding: 8px 10px; overflow: auto; }
.nu-msg { color: #9aa0b4; font-size: 12px; padding: 10px 0; }
.nu-list { display: flex; flex-direction: column; }
.nu-row { display: flex; align-items: center; gap: 8px; padding: 7px 4px; border-bottom: 1px solid #f4f5f9; cursor: pointer; }
.nu-row:hover { background: #f9fafc; }
.nu-rank { flex: none; width: 18px; height: 18px; border-radius: 50%; background: #eef2f7; color: #6b7280; font-size: 10px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
.nu-main { flex: 1; min-width: 0; }
.nu-title { display: flex; align-items: center; gap: 5px; overflow: hidden; }
.nu-key { color: #0e7490; font-size: 11px; flex: none; }
.nu-name { font-size: 12.5px; color: #2f3546; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nu-meta { display: flex; align-items: center; gap: 8px; margin-top: 2px; }
.nu-proj { font-size: 10.5px; color: #9aa0b4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 60%; }
.nu-pri { font-size: 10px; padding: 0 6px; border-radius: 8px; text-transform: capitalize; }
.nu-pri-0 { background: #fee2e2; color: #b91c1c; }
.nu-pri-1 { background: #ffedd5; color: #c2410c; }
.nu-pri-2 { background: #e0f2fe; color: #0369a1; }
.nu-pri-3 { background: #f3f4f6; color: #6b7280; }
.nu-due { flex: none; font-size: 11px; color: #3a3f52; white-space: nowrap; }
.nu-due-over { color: #dc2626; font-weight: 600; }
.nu-due-none { color: #c2c7d2; }
</style>
