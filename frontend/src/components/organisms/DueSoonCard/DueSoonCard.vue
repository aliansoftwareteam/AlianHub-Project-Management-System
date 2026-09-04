<template>
    <div class="dc-body ds">
        <div class="dc-metric">
            <span class="dc-num" :class="{ 'dc-num--danger': counts.overdue > 0 }">{{ counts.overdue }}</span>
            <span class="dc-sub">{{ $t('Dash.due_summary', { today: counts.today, week: counts.week }) }}</span>
        </div>

        <div class="dc-spark" :aria-label="$t('Dash.due_chart_label')">
            <div
                v-for="bucket in buckets"
                :key="bucket.key"
                class="dc-spark__bar"
                :class="bucket.tone"
                :style="{ height: barHeight(bucket.count) }"
                :title="`${bucket.label}: ${bucket.count}`"
            ></div>
        </div>
        <div class="dc-spark__labels">
            <span v-for="bucket in buckets" :key="'l' + bucket.key">{{ bucket.label }}</span>
        </div>

        <div class="dc-list ds__list">
            <div v-for="t in visibleTasks" :key="t.taskId" class="dc-item dc-item--click" @click="open(t)">
                <span class="ds__due" :class="dueTone(t)">{{ dueLabel(t) }}</span>
                <span class="dc-item__text" :title="t.taskName">
                    <b v-if="t.taskKey" class="ds__key">{{ t.taskKey }}</b>{{ t.taskName }}
                </span>
                <span v-if="t.projectName" class="dc-item__meta ds__proj" :title="t.projectName">{{ t.projectName }}</span>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, inject } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { buildFilterQuery } from '@/composable/commonFunction';
import { openTask } from '@/components/organisms/TaskDetailOverlay/useTaskOverlay';
import { useCardMeta } from '@/components/organisms/DashboardCard/useCardMeta';

defineOptions({ name: 'DueSoonCard' });

// Member self-card — what is late, due today and due this week, then the tasks
// themselves. Self-scoped on the backend (caller = req.uid).
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
const userId = inject('$userId', ref(''));
const companyId = inject('$companyId', ref(''));
const tasks = ref([]);

const counts = computed(() => {
    const list = tasks.value;
    return {
        overdue: list.filter((x) => Number(x.daysUntil) < 0).length,
        today: list.filter((x) => Number(x.daysUntil) === 0).length,
        week: list.filter((x) => Number(x.daysUntil) >= 0 && Number(x.daysUntil) <= 6).length,
    };
});

const buckets = computed(() => {
    const dayLabels = t('Dash.due_day_labels').split(',');
    const rows = [{ key: 'ovr', label: dayLabels[0], count: counts.value.overdue, tone: 'dc-spark__bar--danger' }];
    for (let d = 0; d <= 5; d += 1) {
        rows.push({
            key: `d${d}`,
            label: d === 0 ? dayLabels[1] : shortDay(d),
            count: tasks.value.filter((x) => Number(x.daysUntil) === d).length,
            tone: d === 0 ? 'dc-spark__bar--strong' : '',
        });
    }
    return rows;
});
const maxBucket = computed(() => Math.max(1, ...buckets.value.map((b) => b.count)));
const barHeight = (n) => `${Math.max(6, Math.round((n / maxBucket.value) * 100))}%`;

function shortDay(offset) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 3).toUpperCase();
}

const visibleTasks = computed(() => tasks.value.slice(0, 6));

const dueLabel = (task) => {
    const d = Number(task.daysUntil);
    if (!Number.isFinite(d)) return '—';
    if (d < 0) return t('Dash.due_late', { n: Math.abs(d) });
    if (d === 0) return t('Dash.due_today');
    if (d === 1) return t('Dash.due_tomorrow');
    return t('Dash.due_in_days', { n: d });
};
const dueTone = (task) => {
    const d = Number(task.daysUntil);
    if (d < 0) return 'ds__due--late';
    if (d <= 1) return 'ds__due--now';
    return 'ds__due--later';
};

const open = (task) => {
    if (!task || !task.taskId || !task.projectId) return;
    openTask({
        companyId: companyId.value,
        projectId: task.projectId,
        sprintId: task.sprintId || '',
        folderId: task.folderId || '',
        taskId: task.taskId,
    });
};

const load = async () => {
    meta.state = tasks.value.length ? meta.state : 'loading';
    try {
        const fd = Array.isArray(props.filterData) ? props.filterData : Object.values(props.filterData || {});
        const taskMatch = fd.length ? buildFilterQuery(fd, userId && userId.value ? String(userId.value) : '') : null;
        const res = await apiRequest('post', `${env.MY_DUE_SOON}`, {
            days: Number(props.cardData?.days) || 7,
            includeOverdue: true,
            taskMatch,
            projectId: props.cardData?.projectId || [],
            projectMode: props.cardData?.projectMode || 'all',
        });
        const d = res && res.data && res.data.status ? (res.data.data || {}) : {};
        tasks.value = d.tasks || [];
        meta.note = tasks.value.length > visibleTasks.value.length
            ? t('Dash.due_note_more', { shown: visibleTasks.value.length, total: tasks.value.length })
            : t('Dash.due_note');
        meta.state = tasks.value.length ? 'ready' : 'empty';
    } catch (e) {
        meta.state = 'error';
        tasks.value = [];
    }
};

watch(() => props.refreshTrigger, load);
watch(() => props.cardData, load, { deep: true });
watch(() => props.filterData, load, { deep: true });
onMounted(load);
</script>

<style scoped src="@/components/organisms/DashboardCard/cardBody.css"></style>
<style scoped>
.ds__list { margin-top: 2px; }
.ds__due {
    flex: none;
    min-width: 46px;
    text-align: center;
    font: var(--text-data);
    font-size: 10px;
    padding: 2px 6px;
    border-radius: var(--r-chip);
}
.ds__due--late { background: var(--danger-bg); color: var(--danger-ink); }
.ds__due--now { background: var(--warn-bg); color: var(--warn-ink); }
.ds__due--later { background: var(--surface-2); color: var(--ink-label); }
.ds__key { font: var(--text-data); color: var(--brand); margin-right: 5px; }
.ds__proj { max-width: 34%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
