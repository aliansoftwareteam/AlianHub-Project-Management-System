<template>
    <div class="dc-body tle">
        <template v-for="team in teams" :key="team.teamId">
            <button type="button" class="tle__row tle__row--team" @click="toggle(team.teamId)">
                <span class="tle__name">
                    <span class="tle__caret" :class="{ 'is-open': expanded[team.teamId] }">›</span>
                    <span class="tle__label" :title="team.name">{{ team.name }}</span>
                </span>
                <span class="tle__bar">
                    <span class="dc-track dc-track--tall">
                        <span class="dc-fill" :class="{ 'dc-fill--danger': isOver(team) }" :style="{ width: width(team, teamScale) }"></span>
                    </span>
                    <span v-if="team.etaMinutes > 0" class="tle__marker" :style="{ left: markerLeft(team, teamScale) }"></span>
                </span>
                <span class="dc-row__val" :class="deltaTone(team)">{{ delta(team) }}</span>
            </button>

            <template v-if="expanded[team.teamId]">
                <template v-for="u in team.users" :key="u.userId">
                    <button type="button" class="tle__row tle__row--user" @click="toggle(team.teamId + '|' + u.userId)">
                        <span class="tle__name tle__name--user">
                            <span class="tle__caret" :class="{ 'is-open': expanded[team.teamId + '|' + u.userId] }">›</span>
                            <span class="tle__label" :title="u.name">{{ u.name }}</span>
                        </span>
                        <span class="tle__bar">
                            <span class="dc-track dc-track--tall">
                                <span class="dc-fill" :class="{ 'dc-fill--danger': isOver(u) }" :style="{ width: width(u, scaleOf(team.users)) }"></span>
                            </span>
                            <span v-if="u.etaMinutes > 0" class="tle__marker" :style="{ left: markerLeft(u, scaleOf(team.users)) }"></span>
                        </span>
                        <span class="dc-row__val" :class="deltaTone(u)">{{ delta(u) }}</span>
                    </button>

                    <template v-if="expanded[team.teamId + '|' + u.userId]">
                        <div v-for="task in u.tasks" :key="task.taskId" class="tle__row tle__row--task">
                            <span
                                class="tle__name tle__name--task"
                                :class="{ 'tle__name--click': task.taskId && task.projectId }"
                                :title="task.taskName"
                                @click="open(task)"
                            >
                                <b v-if="task.taskKey" class="tle__key">{{ task.taskKey }}</b>
                                <span class="tle__label">{{ task.taskName || '—' }}</span>
                            </span>
                            <span class="tle__bar">
                                <span class="dc-track dc-track--tall">
                                    <span class="dc-fill" :class="{ 'dc-fill--danger': isOver(task) }" :style="{ width: width(task, scaleOf(u.tasks)) }"></span>
                                </span>
                                <span v-if="task.etaMinutes > 0" class="tle__marker" :style="{ left: markerLeft(task, scaleOf(u.tasks)) }"></span>
                            </span>
                            <span class="dc-row__val" :class="deltaTone(task)">{{ delta(task) }}</span>
                        </div>
                    </template>
                </template>
            </template>
        </template>
    </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted, inject } from 'vue';
import { useStore } from 'vuex';
import { useI18n } from 'vue-i18n';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { teamIdToUserId, buildFilterQuery } from '@/composable/commonFunction';
import { resolveCardRange } from '@/composable/useResourceWorkload';
import { openTask } from '@/components/organisms/TaskDetailOverlay/useTaskOverlay';
import { useCardMeta } from '@/components/organisms/DashboardCard/useCardMeta';

defineOptions({ name: 'TeamLoggedVsEtaCard' });

// Logged against estimate, per team and — when opened — per person and per task.
// The bar is the logged time; the dark marker is the estimate it is measured against.
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
const { getters } = useStore();
const teamsArr = getters['settings/teams'] || [];
const globalRange = inject('dashboardGlobalRange', null);

const teams = ref([]);
const expanded = reactive({});
const toggle = (key) => { expanded[key] = !expanded[key]; };

const timerange = computed(() => {
    const v = Number(props.cardData?.timerange);
    return Number.isFinite(v) && v >= 0 && v <= 8 ? v : 3;
});

const scaleOf = (rows) => (rows || []).reduce((m, r) => Math.max(m, r.loggedMinutes || 0, r.etaMinutes || 0), 0) || 1;
const teamScale = computed(() => scaleOf(teams.value));
const width = (row, scale) => `${Math.min(100, Math.round(((row.loggedMinutes || 0) / (scale || 1)) * 100))}%`;
const markerLeft = (row, scale) => `${Math.min(100, Math.round(((row.etaMinutes || 0) / (scale || 1)) * 100))}%`;
const isOver = (row) => row.etaMinutes > 0 && row.loggedMinutes > row.etaMinutes;
const delta = (row) => {
    if (!row.etaMinutes) return '—';
    const pct = Math.round(((row.loggedMinutes - row.etaMinutes) / row.etaMinutes) * 100);
    if (pct === 0) return '0%';
    return `${pct > 0 ? '+' : '−'}${Math.abs(pct)}%`;
};
const deltaTone = (row) => {
    if (!row.etaMinutes) return '';
    return isOver(row) ? 'dc-row__val--danger' : 'dc-row__val--ok';
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
    meta.state = 'loading';
    try {
        const { dateFrom, dateTo } = resolveCardRange(timerange.value, globalRange && globalRange.value);
        const employeeIds = teamIdToUserId(props.cardData?.AssigneeUserId || [], teamsArr);
        const fd = Array.isArray(props.filterData) ? props.filterData : Object.values(props.filterData || {});
        const res = await apiRequest('post', `${env.TEAM_LOGGED_VS_ETA}`, {
            employeeIds: Array.isArray(employeeIds) ? employeeIds : [],
            projectIds: props.cardData?.projectId || [],
            projectMode: props.cardData?.projectMode || 'all',
            statusKeys: props.cardData?.statusArray || [],
            dateFrom,
            dateTo,
            callerUserId: userId && userId.value ? String(userId.value) : '',
            callerRoleType: props.companyUserDetail?.roleType || 3,
            taskMatch: fd.length ? buildFilterQuery(fd, userId && userId.value ? String(userId.value) : '') : null,
        });
        const d = res && res.data && res.data.status ? (res.data.data || {}) : {};
        teams.value = d.teams || [];
        meta.note = t('DashV2.lve_note');
        meta.state = teams.value.length ? 'ready' : 'empty';
    } catch (e) {
        teams.value = [];
        meta.state = 'error';
    }
};

watch(() => props.refreshTrigger, load);
watch(() => props.cardData, load, { deep: true });
watch(() => props.filterData, load, { deep: true });
watch(() => globalRange && globalRange.value, () => { if (timerange.value === 0) load(); }, { deep: true });
onMounted(load);
</script>

<style scoped src="@/components/organisms/DashboardCard/cardBody.css"></style>
<style scoped>
.tle { gap: 7px; }
.tle__row {
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
    padding: 2px 0;
    border: 0;
    background: none;
    text-align: left;
    border-radius: var(--r-chip);
}
.tle__row--team, .tle__row--user { cursor: pointer; }
.tle__row--team:hover, .tle__row--user:hover { background: var(--surface-hover); }
.tle__row:focus-visible { outline: none; box-shadow: var(--focus); }
.tle__name { display: flex; align-items: center; gap: 4px; width: 96px; flex: none; min-width: 0; font-size: 11.5px; color: var(--ink); }
.tle__name--user { padding-left: 10px; }
.tle__name--task { padding-left: 20px; color: var(--ink-2); }
.tle__name--click { cursor: pointer; }
.tle__name--click:hover .tle__label { text-decoration: underline; }
.tle__label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tle__key { font: var(--text-data); color: var(--brand); flex: none; }
.tle__caret { color: var(--ink-3); transition: transform var(--t-state) var(--ease); flex: none; }
.tle__caret.is-open { transform: rotate(90deg); }
.tle__bar { position: relative; display: flex; flex: 1 1 auto; min-width: 0; }
.tle__marker { position: absolute; top: -2px; bottom: -2px; border-left: 2px solid var(--ink); }
</style>
