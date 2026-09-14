<template>
    <div class="project-dashboard w-100 h-100 overflow-auto">
        <!-- Active person filter chip -->
        <div v-if="!loading && !error && activePerson !== null" class="pd-filter-bar">
            <span class="pd-filter-label">{{ $t('projectDashboard.showing') }}</span>
            <span class="pd-chip">
                {{ activePersonName }}
                <span class="pd-chip-x" title="Clear" @click="clearPerson">&times;</span>
            </span>
        </div>

        <!-- Loading -->
        <div v-if="loading" class="pd-grid">
            <div v-for="n in 5" :key="n" class="pd-card pd-skeleton"></div>
        </div>

        <!-- Error -->
        <div v-else-if="error" class="pd-state">
            <p class="pd-state-title">{{ $t('projectDashboard.failed') }}</p>
            <p class="pd-state-msg">{{ error }}</p>
            <button class="pd-retry" @click="fetchMetrics">{{ $t('projectDashboard.retry') }}</button>
        </div>

        <template v-else>
            <!-- How the numbers are calculated -->
            <div class="pd-note">
                <svg class="pd-note-i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-5M12 8h.01"/></svg>
                <span>{{ $t('projectDashboard.calc_note') }}</span>
            </div>

            <!-- Cards -->
            <div class="pd-grid">
                <!-- 1. Total tasks -->
                <div class="pd-card">
                    <div class="pd-icon pd-icon-blue">
                        <svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10"/></svg>
                    </div>
                    <div class="pd-label">{{ $t('projectDashboard.total_tasks') }}</div>
                    <div class="pd-value">{{ view.totalTasks }}</div>
                </div>

                <!-- 2. Completed tasks -->
                <div class="pd-card">
                    <div class="pd-icon pd-icon-green">
                        <svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>
                    </div>
                    <div class="pd-label">{{ $t('projectDashboard.completed_tasks') }}</div>
                    <div class="pd-value">{{ view.completedTasks }}<span class="pd-sub">/ {{ view.totalTasks }}</span></div>
                </div>

                <!-- 2b. Unassigned tasks (project-level KPI; hidden while a person is filtered) -->
                <div v-if="scope === 'project' && activePerson === null" class="pd-card">
                    <div class="pd-icon pd-icon-amber">
                        <svg viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="3.8"/><path d="M5 19.5c0-3.9 3.1-6 7-6s7 2.1 7 6"/></svg>
                    </div>
                    <div class="pd-label">{{ $t('projectDashboard.unassigned_tasks') }}</div>
                    <div class="pd-value">{{ unassignedCount }}</div>
                </div>

                <!-- 3. Task completion vs remaining ratio (by count) -->
                <div class="pd-card">
                    <div class="pd-label">{{ $t('projectDashboard.completion_ratio') }}</div>
                    <div class="pd-donut-row">
                        <svg class="pd-donut" viewBox="0 0 42 42" aria-hidden="true">
                            <circle class="pd-donut-bg" cx="21" cy="21" r="15.915" />
                            <circle class="pd-donut-fg" cx="21" cy="21" r="15.915"
                                :stroke-dasharray="`${view.taskCompletionPct} ${100 - view.taskCompletionPct}`" stroke-dashoffset="25" />
                            <text x="21" y="22.5" class="pd-donut-text">{{ view.taskCompletionPct }}%</text>
                        </svg>
                        <div class="pd-legend">
                            <div><span class="pd-dot pd-dot-green"></span>{{ $t('projectDashboard.completed') }} {{ view.taskCompletionPct }}%</div>
                            <div><span class="pd-dot pd-dot-gray"></span>{{ $t('projectDashboard.remaining') }} {{ view.taskRemainingPct }}%</div>
                        </div>
                    </div>
                </div>

                <!-- 4. Overall project completion (by effort) -->
                <div class="pd-card">
                    <div class="pd-label">{{ $t('projectDashboard.overall_completion') }}</div>
                    <div class="pd-value pd-value-lg">{{ view.overallCompletionPct }}%</div>
                    <div class="pd-bar"><div class="pd-bar-fill" :style="{ width: view.overallCompletionPct + '%' }"></div></div>
                    <div class="pd-hint">{{ $t('projectDashboard.by_effort') }}</div>
                </div>

                <!-- 5. Estimate hours: total in centre, split into logged vs remaining -->
                <div class="pd-card">
                    <div class="pd-label">{{ $t('projectDashboard.estimate_hours') }}</div>
                    <div class="pd-donut-row">
                        <svg class="pd-donut" viewBox="0 0 42 42" aria-hidden="true">
                            <circle class="pd-donut-bg pd-donut-bg-amber" cx="21" cy="21" r="15.915" />
                            <circle class="pd-donut-fg pd-donut-fg-navy" cx="21" cy="21" r="15.915"
                                :stroke-dasharray="`${loggedPct} ${100 - loggedPct}`" stroke-dashoffset="25" />
                            <text x="21" y="21" class="pd-donut-text pd-donut-text-sm" :style="{ fontSize: hoursFontSize + 'px' }">{{ formatHours(view.totalEstimateHours) }}h</text>
                        </svg>
                        <div class="pd-legend">
                            <div><span class="pd-dot pd-dot-navy"></span>{{ $t('projectDashboard.logged') }} {{ formatHours(view.loggedHours) }}h</div>
                            <div><span class="pd-dot pd-dot-amber"></span>{{ $t('projectDashboard.remaining') }} {{ formatHours(view.remainingEstimateHours) }}h</div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- By Person breakdown (only when the viewer can see the whole project) -->
            <div v-if="scope === 'project' && people.length" class="pd-people">
                <div class="pd-people-head">
                    <span class="pd-people-title">{{ $t('projectDashboard.by_person') }}</span>
                    <span class="pd-people-count">{{ people.length }}</span>
                    <span class="pd-people-hint">{{ $t('projectDashboard.click_to_filter') }}</span>
                </div>
                <div class="pd-table-wrap">
                    <table class="pd-table">
                        <thead>
                            <tr>
                                <th :class="thClass('name')" @click="sortBy('name')">{{ $t('projectDashboard.person') }}</th>
                                <th class="num" :class="thClass('tasks')" @click="sortBy('tasks')">{{ $t('projectDashboard.tasks') }}</th>
                                <th class="num" :class="thClass('completed')" @click="sortBy('completed')">{{ $t('projectDashboard.completed') }}</th>
                                <th class="num" :class="thClass('completionPct')" @click="sortBy('completionPct')">{{ $t('projectDashboard.completion') }}</th>
                                <th class="num" :class="thClass('estimateHours')" @click="sortBy('estimateHours')">{{ $t('projectDashboard.estimated') }}</th>
                                <th class="num" :class="thClass('loggedHours')" @click="sortBy('loggedHours')">{{ $t('projectDashboard.logged') }}</th>
                                <th class="num" :class="thClass('remainingHours')" @click="sortBy('remainingHours')">{{ $t('projectDashboard.remaining') }}</th>
                                <th class="num" :class="thClass('overdue')" @click="sortBy('overdue')">{{ $t('projectDashboard.overdue') }}</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="p in sortedPeople" :key="p.userId || 'unassigned'"
                                class="pd-row" :class="{ active: p.userId === activePerson }"
                                @click="togglePerson(p.userId)">
                                <td class="pd-person">
                                    <span class="pd-avatar" :style="avatarStyle(p.userId)">{{ initials(p.userId) }}</span>
                                    <span class="pd-person-name">{{ personName(p.userId) }}</span>
                                </td>
                                <td class="num">{{ p.tasks }}</td>
                                <td class="num">{{ p.completed }}</td>
                                <td class="num"><span class="pd-pill" :class="pctClass(p.completionPct)">{{ p.completionPct }}%</span></td>
                                <td class="num">{{ formatHours(p.estimateHours) }}h</td>
                                <td class="num">{{ formatHours(p.loggedHours) }}h</td>
                                <td class="num">{{ formatHours(p.remainingHours) }}h</td>
                                <td class="num"><span :class="{ 'pd-overdue': p.overdue > 0 }">{{ p.overdue }}</span></td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </template>
    </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useStore } from 'vuex';
import * as env from '@/config/env';
import { apiRequest } from '../../../services';
import { useGetterFunctions } from '@/composable';

const props = defineProps({
    projectData: { type: Object, default: () => ({}) },
});

const { getUser } = useGetterFunctions();
const { getters } = useStore();

const EMPTY = {
    scope: 'project',
    totalTasks: 0, completedTasks: 0, remainingTasks: 0, overdueTasks: 0,
    taskCompletionPct: 0, taskRemainingPct: 0, overallCompletionPct: 0,
    totalEstimateMinutes: 0, remainingEstimateMinutes: 0, loggedMinutes: 0,
    totalEstimateHours: 0, remainingEstimateHours: 0,
    byPerson: [],
};

const loading = ref(false);
const error = ref('');
const metrics = ref({ ...EMPTY });
const activePerson = ref(null);      // userId string, '' (unassigned) or null (whole project)
const sortKey = ref('tasks');
const sortDir = ref('desc');

const projectId = computed(() => (props.projectData && props.projectData._id ? String(props.projectData._id) : ''));
const scope = computed(() => metrics.value.scope);

// Show only ACTIVE members of this project — the same roster the Workload view
// uses (the users store), narrowed to the project's assignees for a private
// space. This drops the "Unassigned" bucket and anyone who has tasks but is no
// longer an active member of the project.
const allUsers = computed(() => getters['users/users'] || []);
const memberIds = computed(() => {
    const priv = props.projectData && props.projectData.isPrivateSpace === true;
    const assignees = Array.isArray(props.projectData && props.projectData.AssigneeUserId)
        ? props.projectData.AssigneeUserId.map(String) : [];
    const set = new Set();
    (allUsers.value || []).forEach((u) => {
        const id = u && u._id ? String(u._id) : '';
        if (id && (!priv || assignees.includes(id))) set.add(id);
    });
    return set;
});
const people = computed(() => {
    const raw = Array.isArray(metrics.value.byPerson) ? metrics.value.byPerson : [];
    const ids = memberIds.value;
    // Active project members + the Unassigned bucket (userId ''); only drop
    // ex-members / inactive users who still carry old task assignments.
    return raw.filter((p) => p.userId === '' || (p.userId && ids.has(String(p.userId))));
});

// Project-level KPI: how many tasks have no assignee (the '' bucket). Stays a
// whole-project figure regardless of any person filter.
const unassignedCount = computed(() => {
    const row = people.value.find((p) => p.userId === '');
    return row ? (Number(row.tasks) || 0) : 0;
});

const formatHours = (h) => {
    const n = Number(h) || 0;
    return Number.isInteger(n) ? n : n.toFixed(1);
};

// --- person name / avatar ---
const personName = (uid) => (uid ? (getUser(uid)?.Employee_Name || '—') : 'Unassigned');
const activePersonName = computed(() => (activePerson.value === null ? '' : personName(activePerson.value)));
const initials = (uid) => {
    if (!uid) return 'U';
    const n = getUser(uid)?.Employee_Name || '';
    return n.split(' ').filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';
};
const avatarStyle = (uid) => {
    const colors = ['#2f3990', '#1a9e5f', '#d97706', '#7c3aed', '#0891b2', '#db2777'];
    let h = 0; const s = String(uid || 'u');
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return { background: colors[h % colors.length] };
};

// --- the cards read from `view`: whole-project totals, or the selected person's row ---
const activeRow = computed(() => (activePerson.value === null ? null : people.value.find((p) => p.userId === activePerson.value)));

// Whole-view totals come straight from the backend, which counts each task
// ONCE — a task shared by several people is counted a single time here (the
// per-person double-count only exists in the By-Person breakdown below). So
// these are the ACTUAL project totals (or, for a member, their own totals).
const wholeAggregate = computed(() => ({
    totalTasks: metrics.value.totalTasks,
    completedTasks: metrics.value.completedTasks,
    taskCompletionPct: metrics.value.taskCompletionPct,
    taskRemainingPct: metrics.value.taskRemainingPct,
    overallCompletionPct: metrics.value.overallCompletionPct,
    totalEstimateHours: metrics.value.totalEstimateHours,
    remainingEstimateHours: metrics.value.remainingEstimateHours,
    loggedHours: Math.round(((Number(metrics.value.loggedMinutes) || 0) / 60) * 10) / 10,
}));

const view = computed(() => {
    const r = activeRow.value;
    if (!r) return wholeAggregate.value;
    const est = Number(r.estimateHours) || 0;
    const logg = Number(r.loggedHours) || 0;
    return {
        totalTasks: r.tasks,
        completedTasks: r.completed,
        taskCompletionPct: r.completionPct,
        taskRemainingPct: r.tasks ? (100 - r.completionPct) : 0,
        overallCompletionPct: est > 0 ? Math.round((logg / est) * 100) : 0,
        totalEstimateHours: r.estimateHours,
        remainingEstimateHours: r.remainingHours,
        loggedHours: r.loggedHours,
    };
});

const loggedPct = computed(() => {
    const est = Number(view.value.totalEstimateHours) || 0;
    return est > 0 ? Math.round(((Number(view.value.loggedHours) || 0) / est) * 100) : 0;
});
const hoursFontSize = computed(() => {
    const s = `${formatHours(view.value.totalEstimateHours)}h`;
    return Math.min(9, Math.round((41 / Math.max(s.length, 1)) * 10) / 10);
});

// --- table sorting + person filter ---
const sortedPeople = computed(() => {
    const arr = [...people.value];
    const k = sortKey.value;
    const dir = sortDir.value === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
        if (k === 'name') {
            const av = personName(a.userId).toLowerCase();
            const bv = personName(b.userId).toLowerCase();
            return av < bv ? -1 * dir : av > bv ? 1 * dir : 0;
        }
        return ((Number(a[k]) || 0) - (Number(b[k]) || 0)) * dir;
    });
    return arr;
});
const sortBy = (k) => {
    if (sortKey.value === k) sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc';
    else { sortKey.value = k; sortDir.value = k === 'name' ? 'asc' : 'desc'; }
};
const thClass = (k) => ({ sorted: sortKey.value === k, asc: sortKey.value === k && sortDir.value === 'asc', desc: sortKey.value === k && sortDir.value === 'desc' });
const pctClass = (p) => (p >= 100 ? 'ok' : p >= 50 ? 'mid' : 'low');

const togglePerson = (uid) => { activePerson.value = activePerson.value === uid ? null : uid; };
const clearPerson = () => { activePerson.value = null; };

async function fetchMetrics() {
    const pid = projectId.value;
    if (!pid) { metrics.value = { ...EMPTY }; return; }
    loading.value = true;
    error.value = '';
    try {
        const res = await apiRequest('get', `${env.PROJECT_DASHBOARD}/${pid}`);
        const body = res && res.data;
        if (body && body.status && body.data) {
            metrics.value = { ...EMPTY, ...body.data };
        } else {
            error.value = (body && body.statusText) || 'Unexpected response.';
        }
    } catch (e) {
        error.value = (e && (e.response?.data?.statusText || e.message)) || 'Request failed.';
    } finally {
        loading.value = false;
    }
}

onMounted(fetchMetrics);
watch(projectId, (n, o) => { if (n && n !== o) { activePerson.value = null; fetchMetrics(); } });
</script>

<style scoped>
.project-dashboard { padding: 16px; background: var(--canvas); color: var(--ink); }

.pd-note { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 14px; padding: 10px 12px; background: var(--brand-tint); border: 1px solid var(--brand-border); border-radius: var(--r-card); font: var(--text-small); color: var(--ink-2); }
.pd-note-i { width: 15px; height: 15px; flex-shrink: 0; margin-top: 1px; fill: none; stroke: var(--brand); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }

.pd-filter-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
.pd-filter-label { font: var(--text-small); font-weight: 600; color: var(--ink-2); }
.pd-chip { display: inline-flex; align-items: center; gap: 8px; font: var(--text-small); font-weight: 700; color: var(--brand); background: var(--brand-tint); border: 1px solid var(--brand-border); border-radius: 20px; padding: 4px 6px 4px 12px; }
.pd-chip-x { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 50%; background: var(--brand-ring); cursor: pointer; font-size: 15px; line-height: 1; }
.pd-chip-x:hover { background: var(--brand-border); }

.pd-grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }

.pd-card { background: var(--surface); border: 1px solid var(--hairline); border-radius: var(--r-card); padding: 18px; min-height: 132px; box-shadow: var(--shadow-card); display: flex; flex-direction: column; gap: 6px; }

.pd-icon { width: 38px; height: 38px; border-radius: 10px; display: flex; align-items: center; justify-content: center; margin-bottom: 4px; }
.pd-icon svg { width: 20px; height: 20px; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.pd-icon-blue { background: var(--brand-tint); } .pd-icon-blue svg { stroke: var(--brand); }
.pd-icon-green { background: var(--ok-bg); } .pd-icon-green svg { stroke: var(--ok); }
.pd-icon-amber { background: var(--warn-bg); } .pd-icon-amber svg { stroke: var(--warn); }

.pd-label { font-size: 13px; font-weight: 600; color: var(--ink-2); }
.pd-value { font: var(--text-display); color: var(--ink); margin-top: auto; }
.pd-value-lg { font-size: 34px; }
.pd-sub { font-size: 15px; font-weight: 600; color: var(--ink-2); margin-left: 4px; }
.pd-hint { font-size: 11.5px; color: var(--ink-2); }

.pd-bar { height: 8px; border-radius: 6px; background: var(--track); overflow: hidden; margin-top: 4px; }
.pd-bar-fill { height: 100%; border-radius: 6px; background: linear-gradient(90deg, var(--brand-deep), var(--brand)); transition: width .4s ease; }

.pd-donut-row { display: flex; align-items: center; gap: 16px; margin-top: auto; }
.pd-donut { width: 96px; height: 96px; }
.pd-donut-bg { fill: none; stroke: var(--track); stroke-width: 5; }
.pd-donut-fg { fill: none; stroke: var(--ok); stroke-width: 5; stroke-linecap: round; transition: stroke-dasharray .5s ease; transform: rotate(-90deg); transform-origin: center; }
.pd-donut-text { font: var(--text-label); fill: var(--ink); text-anchor: middle; }
.pd-donut-text-sm { dominant-baseline: central; }
.pd-legend { font: var(--text-small); font-weight: 600; color: var(--ink-2); display: flex; flex-direction: column; gap: 8px; }
.pd-dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 7px; }
.pd-dot-green { background: var(--ok); }
.pd-dot-gray { background: var(--ink-3); }
.pd-dot-navy { background: var(--brand); }
.pd-dot-amber { background: var(--warn); }
.pd-donut-bg-amber { stroke: var(--warn-bg); }
.pd-donut-fg-navy { stroke: var(--brand); }

/* By Person */
.pd-people { margin-top: 22px; background: var(--surface); border: 1px solid var(--hairline); border-radius: var(--r-card); box-shadow: var(--shadow-card); overflow: hidden; }
.pd-people-head { display: flex; align-items: center; gap: 10px; padding: 14px 16px; border-bottom: 1px solid var(--hairline); }
.pd-people-title { font: var(--text-h3); color: var(--ink); }
.pd-people-count { font: var(--text-data); color: var(--ink-2); background: var(--fill); border-radius: 20px; padding: 1px 9px; }
.pd-people-hint { font-size: 11.5px; color: var(--ink-2); margin-left: auto; }

.pd-table-wrap { overflow-x: auto; }
.pd-table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 640px; }
.pd-table th { text-align: left; font: var(--text-label); color: var(--ink-label); text-transform: uppercase; letter-spacing: .06em; padding: 10px 14px; cursor: pointer; white-space: nowrap; user-select: none; }
.pd-table th.num, .pd-table td.num { text-align: right; }
.pd-table th.sorted { color: var(--brand); }
.pd-table th.asc::after { content: " ↑"; }
.pd-table th.desc::after { content: " ↓"; }
.pd-table td { padding: 11px 14px; border-top: 1px solid var(--hairline); color: var(--ink); white-space: nowrap; }
.pd-row { cursor: pointer; transition: background .12s; }
.pd-row:hover { background: var(--surface-hover); }
.pd-row.active { background: var(--brand-tint); }
.pd-row.active td { border-top-color: var(--brand-border); }

.pd-person { display: flex; align-items: center; gap: 10px; }
.pd-avatar { width: 26px; height: 26px; border-radius: 50%; color: var(--rail-ink-strong); font-size: 10px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
.pd-person-name { font-weight: 600; color: var(--ink); }

.pd-pill { display: inline-block; min-width: 40px; text-align: center; font-weight: 700; font-size: 12px; border-radius: 20px; padding: 2px 8px; }
.pd-pill.ok { background: var(--ok-bg); color: var(--ok-ink); }
.pd-pill.mid { background: var(--warn-bg); color: var(--warn-ink); }
.pd-pill.low { background: var(--danger-bg); color: var(--danger-ink); }
.pd-overdue { color: var(--danger-ink); font-weight: 700; }

/* states */
.pd-state { text-align: center; padding: 48px 16px; }
.pd-state-title { font-size: 15px; font-weight: 700; color: var(--danger-ink); }
.pd-state-msg { font: var(--text-body); color: var(--ink-2); margin-top: 6px; word-break: break-word; }
.pd-retry { margin-top: 14px; padding: 8px 18px; border-radius: var(--r-input); border: 1px solid var(--border); background: var(--surface); font-weight: 700; font-size: 13px; color: var(--brand); cursor: pointer; }
.pd-retry:hover { background: var(--surface-hover); }

.pd-skeleton { position: relative; overflow: hidden; background: var(--fill); border-color: var(--fill); }
.pd-skeleton::after { content: ""; position: absolute; inset: 0; transform: translateX(-100%); background: linear-gradient(90deg, transparent, var(--surface-hover), transparent); animation: pd-shimmer 1.2s infinite; }
@keyframes pd-shimmer { 100% { transform: translateX(100%); } }
</style>
