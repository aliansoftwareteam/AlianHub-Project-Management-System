<template>
    <div class="tle">
        <CardSkeleton v-if="loading && !teams.length" :rows="5" />
        <template v-else>
            <div class="tle-head">
                <span class="tle-hint">{{ $t('dashboardCard.tle_pct_hint') }}</span>
            </div>
            <div v-if="!teams.length" class="tle-msg">{{ $t('dashboardCard.no_data_available') }}</div>

            <div v-else class="tle-table">
                <!-- Column header -->
                <div class="tle-row tle-header">
                    <span class="tle-c-name">{{ $t('dashboardCard.lwt_user') }}</span>
                    <span class="tle-c-num">{{ $t('dashboardCard.tle_logged') }}</span>
                    <span class="tle-c-num">{{ $t('dashboardCard.tle_eta') }}</span>
                    <span class="tle-c-pct" :title="$t('dashboardCard.tle_pct_hint')">%</span>
                </div>

                <!-- Level 1 — Team -->
                <template v-for="team in teams" :key="team.teamId">
                    <div class="tle-row tle-team-row" @click="toggle(team.teamId)">
                        <span class="tle-c-name tle-indent-team">
                            <span class="tle-caret" :class="{ open: expanded[team.teamId] }">›</span>
                            <span class="tle-name tle-team-name" :title="team.name">{{ team.name }}</span>
                        </span>
                        <span class="tle-c-num tle-logged">{{ formatMinutes(team.loggedMinutes) }}</span>
                        <span class="tle-c-num">{{ formatMinutes(team.etaMinutes) }}</span>
                        <span class="tle-c-pct" :class="overClass(team)">{{ ratio(team) }}</span>
                    </div>

                    <!-- Level 2 — User -->
                    <template v-if="expanded[team.teamId]">
                        <template v-for="u in team.users" :key="u.userId">
                            <div class="tle-row tle-user-row" @click="toggle(team.teamId + '|' + u.userId)">
                                <span class="tle-c-name tle-indent-user">
                                    <span class="tle-caret sm" :class="{ open: expanded[team.teamId + '|' + u.userId] }">›</span>
                                    <span class="tle-name tle-user-name" :title="u.name">{{ u.name }}</span>
                                </span>
                                <span class="tle-c-num tle-logged">{{ formatMinutes(u.loggedMinutes) }}</span>
                                <span class="tle-c-num">{{ formatMinutes(u.etaMinutes) }}</span>
                                <span class="tle-c-pct" :class="overClass(u)">{{ ratio(u) }}</span>
                            </div>

                            <!-- Level 3 — Task -->
                            <template v-if="expanded[team.teamId + '|' + u.userId]">
                                <div v-for="t in u.tasks" :key="t.taskId" class="tle-row tle-task-row">
                                    <span class="tle-c-name tle-indent-task">
                                        <span
                                            class="tle-task-link"
                                            :class="{ 'tle-task-clickable': t.taskId && t.projectId }"
                                            :title="(t.taskKey ? t.taskKey + ' ' : '') + (t.taskName || '')"
                                            @click.stop="openTaskDetail(t)"
                                            @mousedown.stop
                                        >
                                            <span v-if="t.taskKey" class="tle-task-key">{{ t.taskKey }}</span>
                                            <span class="tle-task-name">{{ t.taskName || '—' }}</span>
                                            <span v-if="t.projectName" class="tle-task-proj">· {{ t.projectName }}</span>
                                        </span>
                                    </span>
                                    <span class="tle-c-num tle-logged">{{ formatMinutes(t.loggedMinutes) }}</span>
                                    <span class="tle-c-num">{{ formatMinutes(t.etaMinutes) }}</span>
                                    <span class="tle-c-pct" :class="overClass(t)">{{ ratio(t) }}</span>
                                </div>
                            </template>
                        </template>
                    </template>
                </template>
            </div>
        </template>

        <!-- Task detail sidebar — opened by clicking a task row (same pattern as LiveWorkCard). -->
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
export default { name: 'TeamLoggedVsEtaCard' };
</script>

<script setup>
import { ref, reactive, computed, watch, onMounted, inject, provide } from 'vue';
import { useStore } from 'vuex';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { teamIdToUserId, buildFilterQuery } from '@/composable/commonFunction';
import { resolveCardRange, formatMinutes } from '@/composable/useResourceWorkload';
import CardSkeleton from '@/components/atom/CardSkeleton/CardSkeleton.vue';
import TaskDetail from '@/views/TaskDetail/TaskDetail.vue';

// Resource Utilization card #6 — per-team logged vs estimate (ETA),
// drill-down: Team → User → Task, in an aligned table layout.
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
const companyId = inject('$companyId', ref(''));
const { getters } = useStore();
const teamsArr = getters['settings/teams'] || [];

const teams = ref([]);
const loading = ref(false);
const expanded = reactive({});
const toggle = (key) => { expanded[key] = !expanded[key]; };

// ─── Task-detail sidebar (same pattern as LiveWorkCard) ───
const isTaskDetail = ref(false);
const detailProjectId = ref('');
const detailSprintId = ref('');
const detailTaskId = ref('');
function openTaskDetail(t) {
    if (!t || !t.taskId || !t.projectId) return;
    detailProjectId.value = t.projectId;
    detailSprintId.value = t.sprintId || '';
    detailTaskId.value = t.taskId;
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

// Period lives in the card-header dropdown; 0 = Auto → dashboard range.
const globalRange = inject('dashboardGlobalRange', null);
const timerange = computed(() => {
    const v = Number(props.cardData?.timerange);
    return Number.isFinite(v) && v >= 0 && v <= 8 ? v : 3;
});

// Ratio + over-budget flag work on any node with logged/eta minutes.
const ratio = (n) => (n.etaMinutes > 0 ? Math.round((n.loggedMinutes / n.etaMinutes) * 100) + '%' : '—');
const overClass = (n) => (n.etaMinutes > 0 && n.loggedMinutes > n.etaMinutes ? 'over' : '');

const load = async () => {
    loading.value = true;
    try {
        const { dateFrom, dateTo } = resolveCardRange(timerange.value, globalRange && globalRange.value);
        const employeeIds = teamIdToUserId(props.cardData?.AssigneeUserId || [], teamsArr);
        const payload = {
            employeeIds: Array.isArray(employeeIds) ? employeeIds : [],
            projectIds: props.cardData?.projectId || [],
            statusKeys: props.cardData?.statusArray || [],
            dateFrom,
            dateTo,
            callerUserId: userId && userId.value ? String(userId.value) : '',
            callerRoleType: props.companyUserDetail?.roleType || 3,
            // Advanced "Add filter" builder → task-field match (buildFilterQuery).
            taskMatch: (() => {
                const fd = Array.isArray(props.filterData) ? props.filterData : Object.values(props.filterData || {});
                return fd.length ? buildFilterQuery(fd, userId && userId.value ? String(userId.value) : '') : null;
            })(),
        };
        const res = await apiRequest('post', `${env.TEAM_LOGGED_VS_ETA}`, payload);
        const d = res && res.data && res.data.status ? (res.data.data || {}) : {};
        teams.value = d.teams || [];
    } catch (e) {
        console.error('TeamLoggedVsEtaCard fetch error:', e);
        teams.value = [];
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
.tle { height: 100%; width: 100%; padding: 8px 10px; overflow: hidden; display: flex; flex-direction: column; gap: 6px; }
.tle-msg { color: #9aa0b4; font-size: 12px; padding: 10px 0; }
.tle-head { display: flex; justify-content: flex-end; align-items: center; gap: 8px; font-size: 11px; }
.tle-hint { color: #9aa0b4; font-size: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* Table: a shared 4-column grid so every level's numbers line up. Hierarchy
   is shown only by indenting the NAME cell, so numeric columns never shift. */
/* The table is the scroll area — flex:1 + min-height:0 lets it take the
   remaining card height and scroll when expanded (instead of being shrunk and
   clipping user rows). */
.tle-table { border: 1px solid #eef0f6; border-radius: 6px; overflow: auto; flex: 1 1 auto; min-height: 0; }
.tle-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 82px 82px 52px;
    align-items: center;
    border-bottom: 1px solid #f1f2f7;
}
.tle-row:last-child { border-bottom: none; }

.tle-c-name { display: flex; align-items: center; gap: 6px; min-width: 0; padding: 6px 8px; overflow: hidden; }
.tle-c-num { text-align: right; padding: 6px 8px; border-left: 1px solid #f1f2f7; font-variant-numeric: tabular-nums; }
.tle-c-pct { text-align: right; padding: 6px 8px; border-left: 1px solid #f1f2f7; font-weight: 600; color: #0f766e; font-variant-numeric: tabular-nums; }
.tle-c-pct.over { color: #dc2626; }

/* Header */
.tle-header { background: #f7f8fb; font-size: 10px; text-transform: uppercase; letter-spacing: .03em; color: #8a91a3; position: sticky; top: 0; z-index: 1; }
.tle-header .tle-c-name { padding-left: 8px; }

/* Rows by level */
.tle-team-row { background: #fbfcfe; cursor: pointer; font-size: 13px; }
.tle-team-row:hover { background: #f4f7fb; }
.tle-user-row { cursor: pointer; font-size: 12px; }
.tle-user-row:hover { background: #f9fafc; }
.tle-task-row { font-size: 11px; color: #6b7280; }

/* Indentation of the name cell per level (numeric cols stay aligned) */
.tle-indent-team { padding-left: 8px; }
.tle-indent-user { padding-left: 24px; }
.tle-indent-task { padding-left: 42px; }

.tle-caret { display: inline-block; transition: transform .15s; color: #9aa0b4; font-size: 13px; flex: none; }
.tle-caret.sm { font-size: 11px; }
.tle-caret.open { transform: rotate(90deg); }

.tle-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tle-team-name { font-weight: 600; color: #2f3546; }
.tle-user-name { font-weight: 600; color: #3a3f52; }
.tle-logged { color: #0f766e; }

/* Task name spans the row; only clickable when it can open a task. */
.tle-task-link { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1 1 auto; }
.tle-task-link.tle-task-clickable { cursor: pointer; }
.tle-task-link.tle-task-clickable:hover .tle-task-name { text-decoration: underline; }
.tle-task-key { color: #0d9488; font-weight: 600; flex: none; }
.tle-task-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tle-task-proj { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #9aa0b4; }
</style>
