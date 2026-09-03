<template>
    <div class="ah-page tv-page ap">
        <div class="tv-head">
            <h1 class="tv-title">{{ $t('TimeV2.approvals') }}</h1>
            <span v-if="count" class="ap__count">{{ count }}</span>
            <nav class="tv-tabs ap__tabs" aria-label="Approval types">
                <button v-for="f in filters" :key="f.key" type="button" class="tv-tab" :class="{ 'is-active': filter === f.key }" @click="filter = f.key">{{ $t(f.label) }}</button>
            </nav>
        </div>

        <div v-if="!isManager" class="tv-empty"><span>{{ $t('TimeV2.no_access') }}</span></div>
        <template v-else>
            <p v-if="error" class="tv-error">{{ error }}</p>
            <p v-else-if="notice" class="tv-ok">{{ notice }}</p>

            <div class="ap__list">
                <article v-for="card in visibleCards" :key="card.key" class="tv-card ap__card" :class="{ 'ap__card--agent': card.kind === 'agent' }">
                    <div class="ap__who">
                        <span v-if="card.kind === 'agent'" class="ah-avatar ah-avatar--agent">◉</span>
                        <span v-else class="ah-avatar" :style="{ background: card.color }">
                            <img v-if="card.avatar" :src="card.avatar" :alt="card.name" />
                            <template v-else>{{ initial(card.name) }}</template>
                        </span>
                        <div class="ap__who-text">
                            <div class="ap__title">{{ card.title }}</div>
                            <div class="ap__sub">{{ card.sub }}</div>
                        </div>
                        <span v-if="card.kind === 'agent'" class="ah-chip ah-chip--agent">AGENT</span>
                    </div>

                    <div v-if="card.kind === 'timesheet'" class="ap__facts">
                        <span>{{ $t('TimeV2.billable_h', { h: formatHm(card.row.billableMinutes) }) }}</span>
                        <span>{{ $t('TimeV2.internal_h', { h: formatHm(card.row.nonBillableMinutes) }) }}</span>
                        <span v-if="card.row.overMinutes > 0" class="is-warn">{{ $t('TimeV2.over_cap', { h: formatHm(card.row.overMinutes) }) }}</span>
                    </div>
                    <div v-if="card.kind === 'leave' && card.overlap" class="ap__warn">{{ card.overlap }}</div>
                    <div v-if="card.kind === 'leave' && card.row.reason" class="ap__reason">{{ card.row.reason }}</div>
                    <div v-if="card.kind === 'agent'" class="ap__reason">{{ card.row.detail }}</div>

                    <div v-if="rejecting === card.key" class="ap__reject">
                        <input v-model="rejectReason" class="ah-input" :class="{ 'ah-input--error': rejectError }" :placeholder="$t('TimeV2.reject_reason_ph')" @keyup.enter="confirmReject(card)" />
                        <p v-if="rejectError" class="ah-field__error">{{ rejectError }}</p>
                        <div class="tv-row-actions">
                            <button type="button" class="ah-btn ah-btn--danger ah-btn--grow" :disabled="!!busy" @click="confirmReject(card)">{{ $t('TimeV2.confirm_reject') }}</button>
                            <button type="button" class="ah-btn ah-btn--secondary" :disabled="!!busy" @click="cancelReject">{{ $t('TimeV2.cancel') }}</button>
                        </div>
                    </div>
                    <div v-else class="tv-row-actions">
                        <button type="button" class="ah-btn ah-btn--primary ah-btn--grow" :disabled="!!busy" @click="approve(card)">
                            {{ busy === card.key ? $t('TimeV2.approving') : $t('TimeV2.approve') }}
                        </button>
                        <button v-if="card.kind === 'timesheet'" type="button" class="ah-btn ah-btn--secondary" @click="openDetail(card.row)">{{ $t('TimeV2.detail') }}</button>
                        <button v-if="card.kind === 'agent'" type="button" class="ah-btn ah-btn--secondary" :title="card.row.detail">{{ $t('TimeV2.why') }}</button>
                        <button type="button" class="ah-btn ah-btn--secondary tv-btn-danger-outline" :disabled="!!busy" @click="startReject(card)">{{ $t('TimeV2.reject') }}</button>
                    </div>
                </article>

                <div v-if="filter === 'agent' && !agentProposals.length" class="tv-empty">
                    <strong>{{ $t('TimeV2.agent_section') }}</strong>
                    <span>{{ $t('TimeV2.agent_empty') }}</span>
                </div>
                <div v-else-if="!visibleCards.length && !loading" class="tv-empty">
                    <strong>{{ $t('TimeV2.queue_empty_title') }}</strong>
                    <span>{{ $t('TimeV2.queue_empty') }}</span>
                </div>
                <div v-else-if="loading && !visibleCards.length" class="ah-small">{{ $t('TimeV2.loading') }}</div>
            </div>
        </template>
    </div>
</template>

<script setup>
import { ref, computed, inject, onMounted } from 'vue';
import { useStore } from 'vuex';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import moment from 'moment';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { useGetterFunctions } from '@/composable';
import { formatHm } from '@/composable/useTimer';

/**
 * @typedef {Object} AgentProposal
 * @property {string} id
 * @property {string} agentName
 * @property {string} summary       one line, e.g. "Daily PM · 2 sprint moves"
 * @property {string} detail        why the agent proposes it
 * @property {boolean} reversible
 * @property {string} createdAt
 */

defineOptions({ name: 'ApprovalsQueue' });

const { getters } = useStore();
const router = useRouter();
const { t } = useI18n();
const { getUser } = useGetterFunctions();
const companyId = inject('$companyId');
const currentUserId = inject('$userId');

const cid = computed(() => (companyId && companyId.value) || '');
const uid = computed(() => (currentUserId && currentUserId.value) || localStorage.getItem('userId') || '');
const isManager = computed(() => [1, 2].includes((getters['settings/companyUserDetail'] || {}).roleType));

const filters = [
    { key: 'all', label: 'TimeV2.filter_all' },
    { key: 'timesheet', label: 'TimeV2.filter_time' },
    { key: 'leave', label: 'TimeV2.filter_leave' },
    { key: 'agent', label: 'TimeV2.filter_ai' },
];
const filter = ref('all');
const timesheets = ref([]);
const leave = ref([]);
const approvedLeave = ref([]);
/** @type {import('vue').Ref<AgentProposal[]>} */
const agentProposals = ref([]);
const loading = ref(false);
const error = ref('');
const notice = ref('');
const busy = ref('');
const rejecting = ref('');
const rejectReason = ref('');
const rejectError = ref('');

const PALETTE = ['var(--brand)', 'var(--ok)', 'var(--warn)', 'var(--agent)'];
const colorFor = (id) => PALETTE[String(id || '').split('').reduce((s, c) => s + c.charCodeAt(0), 0) % PALETTE.length];
const initial = (name) => (name || '?').trim().charAt(0).toUpperCase();
const nameOf = (id) => { const u = getUser(id) || {}; return u.Employee_Name || ''; };
const rangeLabel = (s, e) => {
    const a = moment(s);
    const b = moment(e);
    if (a.isSame(b, 'day')) return a.format('MMM D');
    return a.isSame(b, 'month') ? `${a.format('MMM D')}–${b.format('D')}` : `${a.format('MMM D')} – ${b.format('MMM D')}`;
};
const overlapText = (row) => {
    const names = approvedLeave.value
        .filter((o) => String(o.userId) !== String(row.userId) && moment(o.startDate).isSameOrBefore(row.endDate, 'day') && moment(o.endDate).isSameOrAfter(row.startDate, 'day'))
        .map((o) => o.userName || nameOf(o.userId))
        .filter(Boolean);
    return names.length ? t('TimeV2.leave_overlap', { names: [...new Set(names)].join(', ') }) : '';
};

const cards = computed(() => {
    const ts = timesheets.value.map((row) => ({
        kind: 'timesheet', key: `ts-${row._id}`, row, at: row.submittedAt,
        name: row.userName || nameOf(row.userId), avatar: row.userAvatar, color: colorFor(row.userId),
        title: t('TimeV2.ts_card_title', { name: row.userName || nameOf(row.userId) }),
        sub: t('TimeV2.week_of', { date: moment(row.periodStart).format('MMM D'), h: formatHm(row.totalMinutes) }),
    }));
    const lv = leave.value.map((row) => {
        const days = Number(row.totalDays) || 0;
        const range = rangeLabel(row.startDate, row.endDate);
        return {
            kind: 'leave', key: `pto-${row._id}`, row, at: row.createdAt,
            name: row.userName || nameOf(row.userId), avatar: '', color: colorFor(row.userId),
            title: t('TimeV2.leave_title', { name: row.userName || nameOf(row.userId), type: t(`Pto.types.${row.type}`) }),
            sub: days === 1 ? t('TimeV2.leave_one', { range }) : t('TimeV2.leave_range', { range, days }),
            overlap: overlapText(row),
        };
    });
    const ag = agentProposals.value.map((row) => ({
        kind: 'agent', key: `ag-${row.id}`, row, at: row.createdAt, name: row.agentName, avatar: '', color: 'var(--agent)',
        title: row.summary, sub: `${row.agentName}${row.reversible ? ` · ${t('TimeV2.reversible')}` : ''}`,
    }));
    return [...ts, ...lv, ...ag].sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0));
});
const visibleCards = computed(() => cards.value.filter((c) => filter.value === 'all' || c.kind === filter.value));
const count = computed(() => cards.value.length);

const bodyOf = (res) => (res && res.data) || {};
const load = async () => {
    loading.value = true;
    error.value = '';
    try {
        const from = moment().format('YYYY-MM-DD');
        const to = moment().add(120, 'days').format('YYYY-MM-DD');
        const [q, p, a] = await Promise.all([
            apiRequest('get', `${env.TIMESHEET_APPROVAL_QUEUE}?hoursPerDay=8`),
            apiRequest('get', `${env.PTO}?status=pending&pageSize=50`),
            apiRequest('get', `${env.PTO}?status=approved&from=${from}&to=${to}&pageSize=50`),
        ]);
        timesheets.value = bodyOf(q).status ? bodyOf(q).data || [] : [];
        leave.value = bodyOf(p).status ? bodyOf(p).data || [] : [];
        approvedLeave.value = bodyOf(a).status ? bodyOf(a).data || [] : [];
    } catch (e) {
        error.value = t('TimeV2.load_failed');
    } finally {
        loading.value = false;
    }
};
const flash = (msg) => { notice.value = msg; setTimeout(() => { if (notice.value === msg) notice.value = ''; }, 3000); };
const me = () => ({ id: uid.value, name: nameOf(uid.value) });

const decide = async (card, action, reason) => {
    if (card.kind === 'timesheet') {
        const body = bodyOf(await apiRequest('post', `${env.TIMESHEET_APPROVAL}/${card.row._id}/review`, { action, reason, userData: me() }));
        if (!body.status) throw new Error(body.statusText);
        timesheets.value = timesheets.value.filter((r) => r._id !== card.row._id);
    } else if (card.kind === 'leave') {
        const body = bodyOf(await apiRequest('put', `${env.PTO}/${card.row._id}/status`, { status: action === 'approve' ? 'approved' : 'rejected', reason }));
        if (!body.status) throw new Error(body.statusText);
        leave.value = leave.value.filter((r) => r._id !== card.row._id);
    } else {
        agentProposals.value = agentProposals.value.filter((r) => r.id !== card.row.id);
    }
};
const approve = async (card) => {
    if (busy.value) return;
    busy.value = card.key;
    error.value = '';
    try {
        await decide(card, 'approve');
        flash(t('TimeV2.approved_ok'));
    } catch (e) {
        error.value = t('TimeV2.action_failed');
    } finally {
        busy.value = '';
    }
};
const startReject = (card) => { rejecting.value = card.key; rejectReason.value = ''; rejectError.value = ''; };
const cancelReject = () => { rejecting.value = ''; rejectReason.value = ''; rejectError.value = ''; };
const confirmReject = async (card) => {
    const reason = rejectReason.value.trim();
    if (!reason) { rejectError.value = t('TimeV2.reason_required'); return; }
    if (busy.value) return;
    busy.value = card.key;
    error.value = '';
    try {
        await decide(card, 'reject', reason);
        cancelReject();
        flash(t('TimeV2.rejected_ok'));
    } catch (e) {
        error.value = t('TimeV2.action_failed');
    } finally {
        busy.value = '';
    }
};
const openDetail = (row) => {
    router.push({ name: 'User Timesheet', params: { cid: cid.value }, query: { userId: row.userId, week: moment(row.periodStart).format('YYYY-MM-DD') } });
};

onMounted(() => { if (isManager.value) load(); });
</script>

<style src="../Timesheet/timeV2.css"></style>
<style scoped>
.ap { max-width: 720px; }
.ap__count { background: var(--brand); color: #fff; font: 700 10px/1 var(--font-ui); padding: 4px 7px; border-radius: 9px; }
.ap__tabs { margin-left: 4px; }
.ap__list { display: flex; flex-direction: column; gap: 10px; }
.ap__card { padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; border-radius: 14px; }
.ap__card--agent { border-color: rgba(107, 92, 231, .35); }
.ap__who { display: flex; align-items: center; gap: 8px; }
.ap__who .ah-avatar { width: 26px; height: 26px; font-size: 10px; }
.ap__who-text { flex: 1; min-width: 0; }
.ap__title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ap__sub { font-size: 11.5px; color: var(--ink-2); }
.ap__facts { display: flex; gap: 8px; flex-wrap: wrap; font: 500 11px/1.2 var(--font-mono); color: var(--ink-2); }
.ap__facts .is-warn { color: var(--warn-ink); }
.ap__warn { padding: 9px 11px; background: var(--warn-bg); border-radius: 8px; font-size: 12px; line-height: 1.45; color: var(--warn-ink); }
.ap__reason { font-size: 12px; color: var(--ink-2); line-height: 1.45; }
.ap__reject { display: flex; flex-direction: column; gap: 6px; }
</style>
