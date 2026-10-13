<template>
    <div class="dc-body risk">
        <div class="dc-metric">
            <span class="dc-num" :class="{ 'dc-num--danger': counts.total > 0 }" data-test="risk-total">{{ counts.total }}</span>
            <span class="dc-sub">{{ $t('Dash.risk_summary', { overdue: counts.overdue, blocked: counts.blocked, stalled: counts.stalled }) }}</span>
        </div>

        <ul class="dc-list risk__list">
            <li v-for="task in visibleTasks" :key="task.taskId">
                <button type="button" class="dc-item dc-item--click risk__row" data-test="risk-row" @click="open(task)">
                    <span class="risk__reason" :class="`risk__reason--${task.reasons[0]}`" data-test="risk-reason">{{ reasonLabel(task) }}</span>
                    <span class="dc-item__text" :title="task.taskName">
                        <b v-if="task.taskKey" class="risk__key">{{ task.taskKey }}</b>{{ task.taskName }}
                    </span>
                    <span v-if="task.projectName" class="dc-item__meta risk__proj" :title="task.projectName">{{ task.projectName }}</span>
                </button>
            </li>
        </ul>
    </div>
</template>

<script setup>
import { computed, inject, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { openTask } from '@/components/organisms/TaskDetailOverlay/useTaskOverlay';
import { useCardMeta } from '@/components/organisms/DashboardCard/useCardMeta';

defineOptions({ name: 'AtRiskTodayCard' });

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

const SHOWN = 8;

const { t } = useI18n();
const meta = useCardMeta();
const companyId = inject('$companyId', ref(''));
const counts = ref({ overdue: 0, blocked: 0, stalled: 0, total: 0 });
const tasks = ref([]);

const visibleTasks = computed(() => tasks.value.slice(0, SHOWN));

const reasonLabel = (task) => (task.reasons[0] === 'overdue'
    ? t('Dash.risk_overdue_days', { n: task.daysLate })
    : t(`Dash.risk_${task.reasons[0]}`));

const open = (task) => {
    if (!task.taskId || !task.projectId) return;
    openTask({ companyId: companyId.value, projectId: task.projectId, sprintId: task.sprintId || '', folderId: task.folderId || '', taskId: task.taskId });
};

const load = async () => {
    meta.state = tasks.value.length ? meta.state : 'loading';
    try {
        const res = await apiRequest('post', env.AT_RISK, { tz: new Date().getTimezoneOffset() });
        if (!res?.data?.status) throw new Error(res?.data?.statusText || 'at-risk failed');
        const d = res.data.data || {};
        counts.value = { overdue: 0, blocked: 0, stalled: 0, total: 0, ...(d.counts || {}) };
        tasks.value = d.tasks || [];
        meta.note = counts.value.total > visibleTasks.value.length
            ? t('Dash.risk_note_more', { shown: visibleTasks.value.length, total: counts.value.total })
            : t('Dash.risk_note');
        meta.updatedAt = Date.now();
        meta.state = tasks.value.length ? 'ready' : 'empty';
    } catch (e) {
        tasks.value = [];
        meta.state = 'error';
    }
};

watch(() => props.refreshTrigger, load);
onMounted(load);
</script>

<style scoped src="@/components/organisms/DashboardCard/cardBody.css"></style>
<style scoped>
.risk__list { list-style: none; margin: 2px 0 0; padding: 0; }
.risk__row { width: 100%; border: 0; border-bottom: 1px solid var(--hairline); background: transparent; text-align: left; font: inherit; }
.risk__list li:last-child .risk__row { border-bottom: 0; }
.risk__row:focus-visible { outline: none; box-shadow: var(--focus); }
.risk__reason {
    flex: none;
    min-width: 54px;
    text-align: center;
    font: var(--text-data);
    font-size: var(--fs-2xs, 10px);
    padding: 2px var(--sp-2);
    border-radius: var(--r-chip);
}
.risk__reason--overdue { background: var(--danger-bg); color: var(--danger-ink); }
.risk__reason--blocked { background: var(--warn-bg); color: var(--warn-ink); }
.risk__reason--stalled { background: var(--surface-2); color: var(--ink-label); }
.risk__key { font: var(--text-data); color: var(--brand); margin-right: calc(var(--sp-1) + 1px); }
.risk__proj { max-width: 34%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (max-width: 767px) {
    .risk__row { min-height: max(var(--hit-min), 44px); }
}
</style>
