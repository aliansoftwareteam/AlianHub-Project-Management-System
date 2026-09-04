<template>
    <div class="dc-body frc">
        <div class="dc-metric">
            <span class="dc-num">{{ formatMinutes(totalFreeMinutes) }}</span>
            <span class="dc-sub">{{ $t('Dash.free_headline', { n: freeRows.length }) }}</span>
        </div>

        <div class="frc__rows">
            <div v-for="row in freeRows" :key="row._id" class="dc-row">
                <span class="dc-row__name" :title="row.name">{{ row.name }}</span>
                <span class="dc-track">
                    <span class="dc-fill" :style="{ width: barWidth(row) }"></span>
                </span>
                <span class="dc-row__val">{{ formatMinutes(row.free) }}</span>
            </div>
        </div>

        <p class="dc-note frc__note">{{ $t('Dash.free_rule', { planned: thresholdHours, logged: loggedThresholdHours }) }}</p>
    </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, inject } from 'vue';
import { useStore } from 'vuex';
import { useI18n } from 'vue-i18n';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { teamIdToUserId, buildFilterQuery } from '@/composable/commonFunction';
import { resolveIsoRange, formatMinutes } from '@/composable/useResourceWorkload';
import { ASSIGNEE_FIELD, resolveAssigneeFilter, passesAssigneeFilter, isFree } from '@/composable/freeResourceRules';
import { useCardMeta } from '@/components/organisms/DashboardCard/useCardMeta';

defineOptions({ name: 'FreeResourcesCard' });

// Who has room today, and how much. A person is free when they are not on
// approved leave and have neither a meaningful plan nor logged time; the hours
// shown are what is left of their working day after both.
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
const userId = inject('$userId');
const { getters } = useStore();

const employees = ref([]);

const filterRows = () => (Array.isArray(props.filterData) ? props.filterData : Object.values(props.filterData || {}))
    .filter((r) => r && r.name && r.comparisonsData && r.comparisonsData.length);

// Assignee is a PERSON filter here, not a task filter: as a task filter it
// would zero co-assignees' workload and mark busy people free.
const isAssigneeRow = (r) => r.name.value === ASSIGNEE_FIELD;
const assigneeUserFilter = computed(() =>
    resolveAssigneeFilter(filterRows(), (ids) => teamIdToUserId(ids, getters['settings/teams'] || [])));

const thresholdHours = computed(() => {
    const v = props.cardData?.freeThresholdHours;
    return v === undefined || v === null || v === '' ? 3 : Number(v);
});
const thresholdMin = computed(() => thresholdHours.value * 60);
const loggedThresholdHours = computed(() => Number(props.cardData?.loggedThresholdHours) || 0);
const loggedThresholdMin = computed(() => loggedThresholdHours.value * 60);
const dayMinutes = computed(() => (Number(props.cardData?.capacityHours) || 8) * 60);

const freeRows = computed(() => {
    const filter = assigneeUserFilter.value;
    return (employees.value || [])
        .filter((e) => !(e.onLeave && e.onLeave.approved))
        .filter((e) => passesAssigneeFilter(e._id, filter))
        .map((e) => {
            const planned = Number(e.plannedMinutes) || 0;
            const logged = Number(e.loggedMinutes) || 0;
            return {
                _id: e._id,
                name: e.name || '—',
                free: Math.max(0, dayMinutes.value - planned - logged),
                isFree: isFree(planned, logged, thresholdMin.value, loggedThresholdMin.value),
            };
        })
        .filter((r) => r.isFree)
        .sort((a, b) => b.free - a.free);
});
const totalFreeMinutes = computed(() => freeRows.value.reduce((a, r) => a + r.free, 0));
const barWidth = (row) => `${Math.min(100, Math.round((row.free / dayMinutes.value) * 100))}%`;

const load = async () => {
    meta.state = 'loading';
    try {
        const { dateFrom, dateTo } = resolveIsoRange(1);
        const assignablePool = (getters['settings/companyUsers'] || [])
            .filter((u) => u && u.isDelete === false && u.roleType !== 1 && u.roleType !== 2)
            .map((u) => String(u.userId));
        const selectedIds = teamIdToUserId(props.cardData?.AssigneeUserId || [], getters['settings/teams'] || []);
        const poolSet = new Set(assignablePool);
        const employeeIds = (Array.isArray(selectedIds) && selectedIds.length)
            ? selectedIds.filter((id) => poolSet.has(String(id)))
            : assignablePool;
        // An empty pool means the store has not loaded yet, or every selected user is
        // ineligible. Never send [] — the backend reads that as "no filter" and would
        // fetch every user, past the deleted/admin exclusions above.
        if (!employeeIds.length) {
            employees.value = [];
            meta.state = 'empty';
            return;
        }
        const res = await apiRequest('post', `${env.DASHBOARD}/employee-workload`, {
            employeeIds,
            projectIds: props.cardData?.projectId || [],
            projectMode: props.cardData?.projectMode || 'all',
            isParentTask: props.cardData?.isParentTask !== false,
            dateFrom,
            dateTo,
            currentOnly: false,
            callerUserId: userId && userId.value ? String(userId.value) : '',
            callerRoleType: props.companyUserDetail?.roleType || 3,
            taskMatch: (() => {
                const fd = filterRows().filter((r) => !isAssigneeRow(r));
                return fd.length ? buildFilterQuery(fd, userId && userId.value ? String(userId.value) : '') : null;
            })(),
        });
        const d = res && res.data && res.data.status ? (res.data.data || {}) : {};
        employees.value = d.employees || [];
        meta.note = t('Dash.free_note');
        meta.state = freeRows.value.length ? 'ready' : 'empty';
    } catch (e) {
        employees.value = [];
        meta.state = 'error';
    }
};

watch(() => props.refreshTrigger, load);
watch(() => props.cardData, load, { deep: true });
watch(() => props.filterData, load, { deep: true });
watch(() => (getters['settings/companyUsers'] || []).length, load);
onMounted(load);
</script>

<style scoped src="@/components/organisms/DashboardCard/cardBody.css"></style>
<style scoped>
.frc__rows { display: flex; flex-direction: column; gap: 7px; }
.frc__note { margin: auto 0 0; }
</style>
