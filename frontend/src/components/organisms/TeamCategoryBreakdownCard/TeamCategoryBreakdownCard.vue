<template>
    <div class="tcb">
        <div v-if="loading && !teams.length" class="tcb-msg">…</div>
        <template v-else>
            <div class="tcb-head">
                <span class="tcb-period">{{ periodLabel }}</span>
                <span class="tcb-dim-box" title="Group logged time by">
                    <select v-model="dimension" class="tcb-dim" @change="load">
                        <option value="type">{{ $t('dashboardCard.dim_type') }}</option>
                        <option value="effort_nature">{{ $t('dashboardCard.dim_effort_nature') }}</option>
                        <option value="work_category">{{ $t('dashboardCard.dim_work_category') }}</option>
                        <option value="billable">{{ $t('dashboardCard.dim_billable') }}</option>
                    </select>
                </span>
            </div>
            <div v-if="!teams.length" class="tcb-msg">{{ $t('dashboardCard.no_data_available') }}</div>
            <div v-else class="tcb-list">
                <div v-for="team in teams" :key="team.teamId" class="tcb-team">
                    <div class="tcb-team-head" @click="toggle(team.teamId)">
                        <span class="tcb-caret" :class="{ open: expanded[team.teamId] }">›</span>
                        <span class="tcb-team-name">{{ team.name }}</span>
                        <span class="tcb-team-total">{{ formatMinutes(team.totalMinutes) }}</span>
                    </div>
                    <div v-if="expanded[team.teamId]" class="tcb-types">
                        <div v-for="b in team.buckets" :key="b.label" class="tcb-type">
                            <div class="tcb-type-row" @click="toggle(team.teamId + '|' + b.label)">
                                <span class="tcb-caret sm" :class="{ open: expanded[team.teamId + '|' + b.label] }">›</span>
                                <span class="tcb-type-name" :title="b.label">{{ b.label }}</span>
                                <div class="tcb-track"><div class="tcb-fill" :style="{ width: pct(b.minutes, team.totalMinutes) + '%' }"></div></div>
                                <span class="tcb-type-val">{{ formatMinutes(b.minutes) }}</span>
                            </div>
                            <div v-if="expanded[team.teamId + '|' + b.label]" class="tcb-users">
                                <div v-for="u in b.users" :key="u.userId" class="tcb-user-row">
                                    <span class="tcb-user-name" :title="u.name">{{ u.name }}</span>
                                    <span class="tcb-user-val">{{ formatMinutes(u.minutes) }}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </template>
    </div>
</template>

<script>
export default { name: 'TeamCategoryBreakdownCard' };
</script>

<script setup>
import { ref, reactive, computed, watch, onMounted, inject } from 'vue';
import { useStore } from 'vuex';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { teamIdToUserId, buildFilterQuery } from '@/composable/commonFunction';
import { resolveIsoRange, formatMinutes } from '@/composable/useResourceWorkload';

// Resource Utilization card #5 — "Team Effort Breakdown". Logged time grouped
// Team → Bucket → User, where the bucket dimension is chosen inline:
// task type / effort nature / work category / billable.
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

const teams = ref([]);
const loading = ref(false);
const expanded = reactive({});
const toggle = (key) => { expanded[key] = !expanded[key]; };

// Inline dimension selector — defaults from saved config, else "type".
const dimension = ref(['type', 'effort_nature', 'work_category', 'billable'].includes(props.cardData?.dimension)
    ? props.cardData.dimension : 'type');

const timerange = computed(() => Number(props.cardData?.timerange) || 3);
const PERIOD_LABELS = { 1: 'Today', 2: 'Yesterday', 3: 'This Week', 4: 'Last Week', 5: 'This Month', 6: 'Last Month', 7: 'This Year', 8: 'Last 30 Days' };
const periodLabel = computed(() => PERIOD_LABELS[timerange.value] || 'This Week');

const pct = (v, total) => (total > 0 ? Math.round((v / total) * 100) : 0);

const load = async () => {
    loading.value = true;
    try {
        const { dateFrom, dateTo } = resolveIsoRange(timerange.value);
        const employeeIds = teamIdToUserId(props.cardData?.AssigneeUserId || [], teamsArr);
        const payload = {
            dimension: dimension.value,
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
        const res = await apiRequest('post', `${env.TEAM_TASKTYPE_BREAKDOWN}`, payload);
        const d = res && res.data && res.data.status ? (res.data.data || {}) : {};
        teams.value = d.teams || [];
    } catch (e) {
        console.error('TeamCategoryBreakdownCard fetch error:', e);
        teams.value = [];
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
.tcb { height: 100%; width: 100%; padding: 8px 10px; overflow: auto; display: flex; flex-direction: column; gap: 6px; }
.tcb-msg { color: #9aa0b4; font-size: 12px; padding: 10px 0; }
.tcb-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 11px; }
.tcb-period { font-weight: 600; color: #0d9488; }
.tcb-dim-box { display: inline-flex; align-items: center; }
.tcb-dim { font-size: 11px; color: #3a3f52; border: 1px solid #e5e7eb; border-radius: 6px; padding: 2px 6px; background: #fff; cursor: pointer; }
.tcb-team { border-bottom: 1px solid #f1f2f7; }
.tcb-team-head { display: flex; align-items: center; gap: 8px; padding: 6px 2px; cursor: pointer; }
.tcb-team-name { font-weight: 600; font-size: 13px; color: #2f3546; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tcb-team-total { font-size: 12px; color: #0f766e; font-weight: 600; }
.tcb-caret { display: inline-block; transition: transform .15s; color: #9aa0b4; font-size: 14px; flex: none; }
.tcb-caret.sm { font-size: 12px; }
.tcb-caret.open { transform: rotate(90deg); }
.tcb-types { padding: 2px 0 6px 20px; }
.tcb-type-row { display: flex; align-items: center; gap: 8px; padding: 3px 0; cursor: pointer; }
.tcb-type-name { width: 26%; font-size: 12px; color: #3a3f52; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-transform: capitalize; }
.tcb-track { flex: 1; height: 11px; background: #eef0f6; border-radius: 4px; overflow: hidden; }
.tcb-fill { height: 100%; background: #0d9488; }
.tcb-type-val { width: 54px; text-align: right; font-size: 11px; color: #3a3f52; }
.tcb-users { padding: 2px 0 4px 26px; }
.tcb-user-row { display: flex; justify-content: space-between; padding: 2px 0; font-size: 11px; color: #6b7280; }
.tcb-user-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
