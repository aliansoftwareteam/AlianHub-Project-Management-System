<template>
<div v-if="!currentCompany?.planFeature?.userTimesheet">
    <UpgradePlan
        :buttonText="$t('Upgrades.upgrade_your_plan')"
        :lastTitle="$t('conformationmsg.to_unlock_user_timesheet')"
        :secondTitle="$t('Upgrades.unlimited')"
        :firstTitle="$t('Upgrades.upgrade_to')"
        :message="$t('Upgrades.the_feature_not_available')"
    />
</div>
<NotFound v-else-if="!allowed" />
<div v-else class="ah-page tv-page ut2">
    <div class="tv-head">
        <h1 class="tv-title">{{ $t('TimeV2.my_timesheet') }}</h1>
        <span class="tv-range">
            <button type="button" :aria-label="$t('TimeV2.prev_week')" @click="shiftWeek(-1)">‹</button>
            <span>{{ rangeLabel }}</span>
            <button type="button" :aria-label="$t('TimeV2.next_week')" @click="shiftWeek(1)">›</button>
        </span>
        <span class="ah-chip" :class="statusChip.cls" :title="statusChip.title">{{ statusChip.label }}</span>
        <TimesheetTabs active="mine" />
        <div class="tv-actions">
            <span v-if="timer.running.value" class="ah-chip ah-chip--ok ut2-timer">
                <span class="ah-dot ah-dot--ok"></span>
                <span class="tv-mono">{{ formatClock(timer.elapsed.value, true) }}</span>
                <span class="ut2-timer__task" :title="timer.active.value.taskName">{{ timer.active.value.taskName }}</span>
                <button type="button" class="tv-link" :disabled="busy.timer" @click="stopTimer">{{ $t('TimeV2.stop') }}</button>
            </span>
            <span v-else-if="liveSession" class="ah-chip ah-chip--ok ut2-timer" :title="$t('TimeV2.running_desktop')">
                <span class="ah-dot ah-dot--ok"></span>
                <span class="ut2-timer__task">{{ liveSession.taskName }}</span>
            </span>
            <select v-if="isEveryone" v-model="personId" class="tv-select" :title="$t('TimeV2.me')">
                <option value="">{{ $t('TimeV2.me') }}</option>
                <option v-for="u in otherUsers" :key="u._id" :value="u._id">{{ u.Employee_Name }}</option>
            </select>
            <select v-model="projectId" class="tv-select" :title="$t('TimeV2.all_projects')">
                <option value="">{{ $t('TimeV2.all_projects') }}</option>
                <option v-for="p in projectList" :key="p._id" :value="String(p._id)">{{ p.ProjectName }}</option>
            </select>
            <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="openLog()">{{ $t('TimeV2.log_time') }}</button>
            <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="busy.export" @click="exportCsv">
                {{ busy.export ? $t('TimeV2.exporting') : $t('TimeV2.export') }}
            </button>
            <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="!canSubmit || busy.submit" @click="submitWeek">
                {{ busy.submit ? $t('TimeV2.submitting') : (isRejected ? $t('TimeV2.resubmit_week') : $t('TimeV2.submit_week')) }}
            </button>
        </div>
    </div>

    <p v-if="error" class="tv-error">{{ error }}</p>
    <p v-else-if="notice" class="tv-ok">{{ notice }}</p>

    <div class="ut2-scroll ah-scroll">
        <div class="tv-card ut2-grid" :style="{ '--days': days.length || 7 }" :class="{ 'is-loading': loading }">
            <div class="ut2-row ut2-row--head">
                <span class="ut2-task">{{ $t('TimeV2.col_task') }}</span>
                <span v-for="d in days" :key="d.date" :class="{ 'is-today': d.date === today, 'is-off': d.weekend || d.pto }" :title="d.pto ? $t('TimeV2.pto') : ''">{{ dayLabel(d) }}</span>
                <span>{{ $t('TimeV2.col_total') }}</span>
            </div>
            <div v-if="!displayRows.length" class="ut2-empty">
                <div v-if="loading" class="ah-small">{{ $t('TimeV2.loading') }}</div>
                <div v-else class="tv-empty">
                    <span>{{ $t('TimeV2.empty_week') }}</span>
                    <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" @click="openLog()">{{ $t('TimeV2.log_time') }}</button>
                </div>
            </div>
            <div v-for="row in displayRows" :key="row.taskId" class="ut2-row">
                <div class="ut2-task">
                    <span class="tv-sq" :style="{ background: row.projectColor || 'var(--brand)' }"></span>
                    <span class="ut2-task__name" :title="row.projectName || ''">{{ row.taskName || row.taskId }}</span>
                    <button
                        type="button"
                        class="ut2-bill"
                        :class="{ 'is-on': row.billable }"
                        :title="$t('TimeV2.toggle_billable')"
                        :disabled="busy.billable === row.taskId || !row.entryIds.length"
                        @click="toggleBillable(row)"
                    >{{ row.billable ? $t('TimeV2.billable') : $t('TimeV2.non_billable') }}</button>
                </div>
                <button
                    v-for="d in days"
                    :key="d.date"
                    type="button"
                    class="ut2-cell"
                    :class="{ 'is-empty': !cellMinutes(row, d), 'is-off': d.weekend || d.pto, 'is-live': isLiveCell(row, d), 'is-today': d.date === today }"
                    :disabled="!canEdit || d.date > today"
                    @click="openLog(row, d)"
                >{{ cellText(row, d) }}</button>
                <span class="ut2-total">{{ formatMinutes(rowTotal(row)) }}</span>
            </div>
            <div class="ut2-row ut2-row--total">
                <span class="ut2-task">{{ $t('TimeV2.total_capacity', { h: hoursPerDay }) }}</span>
                <span v-for="d in days" :key="d.date" :class="{ 'is-today': d.date === today, 'is-empty': !dayTotal(d), 'is-off': d.weekend || d.pto }">{{ dayTotal(d) ? formatMinutes(dayTotal(d)) : '—' }}</span>
                <span>{{ formatMinutes(weekTotal) }}</span>
            </div>
        </div>
    </div>

    <div class="tv-note">
        <div class="tv-card">
            <span class="ah-dot" :class="previous.dot"></span>
            <span class="ut2-prev">{{ $t('TimeV2.last_week') }} <strong>{{ previous.label }}</strong><span v-if="previous.detail">, {{ previous.detail }}</span><span v-if="previous.hours"> · {{ previous.hours }}</span></span>
        </div>
        <div v-if="underHint" class="tv-card">
            <span class="tv-spark">✦</span>
            <span class="ut2-hint">{{ underHint.text }}</span>
            <button type="button" class="tv-link ut2-hint__cta" @click="openLog(null, underHint.day, underHint.minutes)">{{ $t('TimeV2.add_hours', { h: formatHm(underHint.minutes) }) }}</button>
        </div>
    </div>

    <transition name="ah-slide-right">
        <aside v-if="logOpen" class="ut2-panel">
            <LogTimeSheet mode="panel" :prefill="logPrefill" :recentTasks="recentTasks" @close="logOpen = false" @logged="onLogged" />
        </aside>
    </transition>
</div>
</template>

<script setup>
import { ref, computed, inject, onMounted, watch } from 'vue';
import { useStore } from 'vuex';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import moment from 'moment';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { useCustomComposable, useGetterFunctions } from '@/composable';
import { useTimer, formatClock, formatMinutes, formatHm } from '@/composable/useTimer';
import UpgradePlan from '@/components/atom/UpgradYourPlanComponent/UpgradYourPlanComponent.vue';
import NotFound from '@/views/NotFound.vue';
import TimesheetTabs from '@/views/Timesheet/TimesheetTabs.vue';
import LogTimeSheet from '@/views/TimeLog/LogTimeSheet.vue';

defineOptions({ name: 'UserTimesheet' });

const { getters } = useStore();
const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const { checkPermission } = useCustomComposable();
const { getUser } = useGetterFunctions();
const companyId = inject('$companyId');
const currentUserId = inject('$userId');
const clientWidth = inject('$clientWidth');
const timer = useTimer();

const cid = computed(() => (companyId && companyId.value) || '');
const uid = computed(() => (currentUserId && currentUserId.value) || localStorage.getItem('userId') || '');
const currentCompany = computed(() => getters['settings/selectedCompany']);
const companyUserDetail = computed(() => getters['settings/companyUserDetail'] || {});
const isPrivileged = computed(() => [1, 2].includes(companyUserDetail.value.roleType));
const permission = computed(() => checkPermission('sheet_settings.user_timesheet'));
const allowed = computed(() => permission.value !== null && permission.value !== undefined);
const isEveryone = computed(() => permission.value === true || permission.value === 2);
const otherUsers = computed(() => (getters['users/users'] || []).filter((u) => u._id !== uid.value));

const weekStart = ref(moment(route.query.week || undefined).startOf('isoWeek'));
const personId = ref(String(route.query.userId || '') === uid.value ? '' : String(route.query.userId || ''));
const projectId = ref('');
const projectList = ref([]);
const hoursPerDay = ref(8);
const days = ref([]);
const rows = ref([]);
const totals = ref({ byDay: {}, weekMinutes: 0, billableMinutes: 0, capacityMinutes: 0 });
const approval = ref({ current: null, previous: null });
const underCapacity = ref([]);
const loading = ref(false);
const error = ref('');
const notice = ref('');
const busy = ref({ submit: false, export: false, billable: '', timer: false });
const logOpen = ref(false);
const logPrefill = ref({});

const today = computed(() => moment().format('YYYY-MM-DD'));
const startIso = computed(() => weekStart.value.format('YYYY-MM-DD'));
const endIso = computed(() => weekStart.value.clone().add(6, 'days').format('YYYY-MM-DD'));
const rangeLabel = computed(() => `${weekStart.value.format('MMM D')} – ${weekStart.value.clone().add(6, 'days').format('MMM D')}`);
const targetUser = computed(() => personId.value || uid.value);
const isMe = computed(() => targetUser.value === uid.value);
const canEdit = computed(() => isMe.value && !(approval.value.current && approval.value.current.status === 'approved'));
const timeZone = computed(() => (getUser(uid.value) || {}).timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
const liveSession = computed(() => (isMe.value ? timer.sessions.value.find((s) => s.live) : null) || null);
const liveMinutes = computed(() => (timer.running.value ? Math.floor(timer.elapsed.value / 60) : 0));
const liveTaskId = computed(() => (isMe.value ? (timer.active.value && timer.active.value.taskId) || (liveSession.value && liveSession.value.taskId) || '' : ''));

const dayLabel = (d) => moment(d.date).format('ddd').toUpperCase();
const displayRows = computed(() => {
    const list = rows.value.map((r) => ({ ...r }));
    const live = timer.active.value || liveSession.value;
    if (liveTaskId.value && live && !list.some((r) => r.taskId === liveTaskId.value)) {
        list.unshift({
            taskId: live.taskId, taskName: live.taskName || '', projectId: live.projectId || '', projectName: live.projectName || '',
            projectColor: live.projectColor || '', sprintId: live.sprintId || '', billable: live.billable !== false, byDay: {}, total: 0, entryIds: [],
        });
    }
    return list;
});
const isLiveCell = (row, d) => d.date === today.value && !!liveTaskId.value && row.taskId === liveTaskId.value;
const liveExtra = (row, d) => (isLiveCell(row, d) && timer.running.value ? liveMinutes.value : 0);
const cellMinutes = (row, d) => (row.byDay[d.date] || 0) + liveExtra(row, d);
const cellText = (row, d) => {
    const m = cellMinutes(row, d);
    if (!m) return isLiveCell(row, d) ? '● 0:00' : '—';
    return `${isLiveCell(row, d) ? '● ' : ''}${formatMinutes(m)}`;
};
const rowTotal = (row) => row.total + (row.taskId === liveTaskId.value && timer.running.value ? liveMinutes.value : 0);
const dayTotal = (d) => (totals.value.byDay[d.date] || 0) + (d.date === today.value && timer.running.value && liveTaskId.value ? liveMinutes.value : 0);
const weekTotal = computed(() => totals.value.weekMinutes + (timer.running.value && liveTaskId.value ? liveMinutes.value : 0));

const statusOf = (doc) => (doc && doc.status) || 'draft';
const statusChip = computed(() => {
    const doc = approval.value.current;
    const status = statusOf(doc);
    const cls = { submitted: 'ah-chip--warn', approved: 'ah-chip--ok', rejected: 'ah-chip--danger' }[status] || '';
    const label = t(`TimeV2.status_${status}`);
    const title = status === 'rejected' && doc.rejectionReason ? t('TimeV2.reason', { reason: doc.rejectionReason }) : '';
    return { cls, label: title ? `${label} · ${doc.rejectionReason}` : label, title };
});
const isRejected = computed(() => statusOf(approval.value.current) === 'rejected');
const canSubmit = computed(() => (isMe.value || isPrivileged.value) && ['draft', 'rejected'].includes(statusOf(approval.value.current)));
const previous = computed(() => {
    const doc = approval.value.previous;
    const status = statusOf(doc);
    const hours = doc ? formatHm(doc.totalMinutes) : '';
    const who = doc && doc.reviewerName;
    if (status === 'submitted') return { dot: 'ah-dot--warn', label: t('TimeV2.status_submitted').toLowerCase(), detail: who ? t('TimeV2.awaiting_named', { name: who }) : t('TimeV2.awaiting_approval'), hours };
    if (status === 'approved') return { dot: 'ah-dot--ok', label: t('TimeV2.status_approved').toLowerCase(), detail: who ? t('TimeV2.approved_by', { name: who }) : '', hours };
    if (status === 'rejected') return { dot: 'ah-dot--danger', label: t('TimeV2.status_rejected').toLowerCase(), detail: doc.rejectionReason ? t('TimeV2.reason', { reason: doc.rejectionReason }) : (who ? t('TimeV2.rejected_by', { name: who }) : ''), hours };
    return { dot: 'ut2-dot--none', label: t('TimeV2.not_submitted'), detail: '', hours: '' };
});
const underHint = computed(() => {
    if (!isMe.value || !underCapacity.value.length) return null;
    const list = underCapacity.value;
    const gap = list.reduce((s, d) => s + d.gapMinutes, 0);
    const names = list.map((d) => moment(d.date).format('ddd'));
    const text = list.length === 1
        ? t('TimeV2.under_capacity_one', { day: names[0], h: formatHm(gap) })
        : t('TimeV2.under_capacity_many', { days: `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`, h: formatHm(gap) });
    return { text, day: list[list.length - 1].date, minutes: list[list.length - 1].gapMinutes };
});
const recentTasks = computed(() => rows.value.map((r) => ({ taskId: r.taskId, taskName: r.taskName, projectId: r.projectId, projectName: r.projectName, sprintId: r.sprintId, projectColor: r.projectColor })));

const load = async () => {
    loading.value = true;
    error.value = '';
    try {
        const qs = new URLSearchParams({ start: startIso.value, end: endIso.value, userId: targetUser.value, projectId: projectId.value, hoursPerDay: String(hoursPerDay.value), timeZone: timeZone.value });
        const body = ((await apiRequest('get', `${env.TIMESHEET_WEEK}?${qs.toString()}`)) || {}).data || {};
        if (!body.status) throw new Error(body.statusText || 'load_failed');
        const d = body.data;
        days.value = d.days || [];
        rows.value = d.rows || [];
        totals.value = d.totals || { byDay: {}, weekMinutes: 0, billableMinutes: 0, capacityMinutes: 0 };
        approval.value = d.approval || { current: null, previous: null };
        underCapacity.value = d.underCapacity || [];
        hoursPerDay.value = d.hoursPerDay || 8;
    } catch (e) {
        error.value = t('TimeV2.load_failed');
    } finally {
        loading.value = false;
    }
};
const loadProjects = async () => {
    try {
        const b = ((await apiRequest('get', env.PROJECT)) || {}).data;
        const list = Array.isArray(b) ? b : (b && b.data) || [];
        projectList.value = list.filter((p) => p && p.status !== 'close' && p.deletedStatusKey !== 1 && p.deletedStatusKey !== 2);
    } catch (e) {
        projectList.value = [];
    }
};
const shiftWeek = (n) => { weekStart.value = weekStart.value.clone().add(n, 'weeks'); };
const flash = (msg) => { notice.value = msg; setTimeout(() => { if (notice.value === msg) notice.value = ''; }, 4000); };

const submitWeek = async () => {
    if (!canSubmit.value || busy.value.submit) return;
    busy.value.submit = true;
    error.value = '';
    try {
        const me = getUser(uid.value) || {};
        const body = ((await apiRequest('post', `${env.TIMESHEET_APPROVAL}/submit`, {
            periodStart: startIso.value, periodEnd: endIso.value, periodType: 'week',
            userId: targetUser.value, userData: { id: uid.value, name: me.Employee_Name || '' },
        })) || {}).data || {};
        if (!body.status) throw new Error(body.statusText || 'submit_failed');
        approval.value = { ...approval.value, current: body.data };
        flash(t('TimeV2.submitted_ok'));
    } catch (e) {
        error.value = e.message || t('TimeV2.action_failed');
    } finally {
        busy.value.submit = false;
    }
};
const exportCsv = async () => {
    if (busy.value.export) return;
    busy.value.export = true;
    try {
        const s = new Date(`${startIso.value}T00:00:00`);
        const e = new Date(`${endIso.value}T23:59:59`);
        const res = await apiRequest('post', `${env.TIMESHEET}/export-csv`, {
            userArray: [targetUser.value], projectArray: projectId.value ? [projectId.value] : [],
            start: Math.floor(s.getTime() / 1000), end: Math.floor(e.getTime() / 1000),
        });
        const csv = typeof (res && res.data) === 'string' ? res.data : '';
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `timesheet-${startIso.value}_${endIso.value}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    } catch (e) {
        error.value = t('TimeV2.action_failed');
    } finally {
        busy.value.export = false;
    }
};
const toggleBillable = async (row) => {
    if (busy.value.billable) return;
    busy.value.billable = row.taskId;
    try {
        const body = ((await apiRequest('put', env.TIMESHEET_BILLABLE_ENTRIES, { entryIds: row.entryIds, billable: !row.billable })) || {}).data || {};
        if (!body.status) throw new Error(body.statusText);
        const target = rows.value.find((r) => r.taskId === row.taskId);
        if (target) target.billable = !row.billable;
        totals.value.billableMinutes = rows.value.reduce((s, r) => s + (r.billable ? r.total : 0), 0);
    } catch (e) {
        error.value = t('TimeV2.action_failed');
    } finally {
        busy.value.billable = '';
    }
};
const stopTimer = async () => {
    if (busy.value.timer) return;
    busy.value.timer = true;
    try {
        const stopped = await timer.stop();
        if (stopped) flash(t('TimeV2.logged_ok', { h: formatHm(stopped.minutes), task: stopped.taskName }));
        await load();
    } catch (e) {
        error.value = t('TimeV2.log_failed');
    } finally {
        busy.value.timer = false;
    }
};
const openLog = (row, day, minutes) => {
    const date = day && day.date ? day.date : (typeof day === 'string' ? day : '');
    const task = row ? { taskId: row.taskId, taskName: row.taskName, projectId: row.projectId, projectName: row.projectName, sprintId: row.sprintId, projectColor: row.projectColor } : null;
    if (clientWidth && clientWidth.value < 768) {
        router.push({ name: 'LogTime', params: { cid: cid.value }, query: { taskId: task ? task.taskId : undefined, date: date || undefined, minutes: minutes || undefined } });
        return;
    }
    logPrefill.value = { task, date, minutes: minutes || 0, key: Date.now() };
    logOpen.value = true;
};
const onLogged = (info) => {
    if (info && info.message) flash(info.message);
    load();
};

watch([personId, projectId, weekStart], load);
onMounted(() => {
    if (!allowed.value) return;
    load();
    loadProjects();
    timer.reconcile();
});
</script>

<style src="../timeV2.css"></style>
<style scoped>
.ut2-timer { height: 26px; gap: 8px; max-width: 320px; }
.ut2-timer__task { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; max-width: 160px; }
.ut2-scroll { overflow-x: auto; }
.ut2-grid { min-width: calc(220px + var(--days) * 70px + 98px); font-size: 12.5px; overflow: hidden; transition: opacity var(--t-state) var(--ease); }
.ut2-grid.is-loading { opacity: .6; }
.ut2-row { display: grid; grid-template-columns: minmax(220px, 1fr) repeat(var(--days), 64px) 70px; gap: 6px; padding: 10px 14px; align-items: center; text-align: center; font: 500 12px/1.2 var(--font-mono); border-bottom: 1px solid var(--hairline); }
.ut2-row:last-child { border-bottom: 0; }
.ut2-row--head { padding: 9px 14px; font: var(--text-label); letter-spacing: .06em; color: var(--ink-3); }
.ut2-row--head .is-today { color: var(--brand); }
.ut2-row--total { background: var(--surface-2); font-weight: 600; border-bottom: 0; }
.ut2-row--total .ut2-task { font: 600 12.5px/1.2 var(--font-ui); }
.ut2-row--total .is-today { color: var(--brand); }
.ut2-row .is-empty { color: var(--ink-3); }
.ut2-row .is-off { opacity: .7; }
.ut2-task { text-align: left; font: 400 12.5px/1.3 var(--font-ui); display: flex; align-items: center; gap: 8px; min-width: 0; }
.ut2-task__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ut2-bill { margin-left: auto; flex: none; height: 20px; padding: 0 7px; border-radius: var(--r-chip); border: 1px solid var(--border); background: transparent; color: var(--ink-2); font: 600 10.5px/1 var(--font-ui); cursor: pointer; transition: background var(--t-state) var(--ease), color var(--t-state) var(--ease); }
.ut2-bill.is-on { background: var(--brand-tint); border-color: transparent; color: var(--brand); }
.ut2-bill:disabled { opacity: .5; cursor: default; }
.ut2-cell { height: 30px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--ink); font: inherit; cursor: pointer; transition: background var(--t-state) var(--ease), border-color var(--t-state) var(--ease); }
.ut2-cell:hover:not(:disabled) { background: var(--surface-hover); border-color: var(--hairline); }
.ut2-cell:disabled { cursor: default; }
.ut2-cell.is-empty { color: var(--ink-3); }
.ut2-cell.is-live { color: var(--ok); font-weight: 600; }
.ut2-cell.is-today:not(.is-live):not(.is-empty) { color: var(--brand); }
.ut2-total { font-weight: 600; }
.ut2-empty { padding: 14px; }
.ut2-dot--none { background: var(--border); }
.ut2-prev strong { font-weight: 600; }
.ut2-hint { flex: 1; min-width: 0; }
.ut2-hint__cta { margin-left: auto; }
.ut2-panel { position: fixed; top: 0; right: 0; bottom: 0; width: var(--panel-w); z-index: 45; background: var(--surface); border-left: 1px solid var(--hairline); box-shadow: var(--shadow-pop); display: flex; flex-direction: column; }
@media (max-width: 767px) {
    .ut2-panel { width: 100%; }
    .ut2-row { grid-template-columns: minmax(160px, 1fr) repeat(var(--days), 56px) 64px; }
    /* The week grid scrolls sideways inside its card; the empty-state text must not
       scroll away with it. Sticky to the scroller's left edge, sized to the viewport. */
    .ut2-grid { overflow: visible; } /* otherwise the grid, not the scroller, is the sticky container */
    .ut2-empty { position: sticky; left: 0; max-width: calc(100vw - 92px); }
}
</style>
