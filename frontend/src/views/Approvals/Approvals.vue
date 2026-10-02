<template>
    <div class="ah-page tv-page ap">
        <div class="tv-head">
            <h1 class="tv-title">{{ $t('Time.approvals') }}</h1>
            <span v-if="count" class="ap__count">{{ count }}</span>
            <TimesheetTabs active="approvals" />
            <nav class="tv-tabs ap__tabs" :aria-label="$t('Time.approval_types')">
                <button v-for="f in filters" :key="f.key" type="button" class="tv-tab" :class="{ 'is-active': filter === f.key }" @click="filter = f.key">{{ $t(f.label) }}</button>
            </nav>
        </div>

        <div v-if="!isManager" class="tv-empty"><span>{{ $t('Time.no_access') }}</span></div>
        <template v-else>
            <p v-if="error" class="tv-error">{{ error }}</p>
            <p v-else-if="notice" class="tv-ok" role="status">{{ notice }}</p>
            <p v-if="proposalsFailed && filter !== 'timesheet' && filter !== 'leave'" class="tv-error">{{ $t('Time.agent_load_failed') }}</p>

            <div class="ap__list">
                <div v-if="visibleSheetIds.length" class="tv-card ap__bulk">
                    <div class="ap__bulk-pick">
                        <input
                            id="ap-select-all"
                            ref="selectAllBox"
                            type="checkbox"
                            class="ah-check"
                            data-test="ts-select-all"
                            :checked="allSelected"
                            :indeterminate.prop="someSelected"
                            :disabled="!!busy"
                            @change="toggleAll($event.target.checked)"
                        />
                        <label for="ap-select-all" class="ap__bulk-label">{{ $t('Time.bulk_select_all') }}</label>
                    </div>
                    <div v-if="selection.length" class="ap__bulk-bar" role="group" :aria-label="$t('Time.bulk_actions')" data-test="ts-bulk-bar">
                        <span class="ap__bulk-count">{{ $t('Time.bulk_selected', { n: selection.length }) }}</span>
                        <template v-if="sendingBack">
                            <input
                                ref="bulkNoteInput"
                                v-model="bulkNote"
                                class="ah-input ap__bulk-note"
                                :class="{ 'ah-input--error': bulkNoteError }"
                                data-test="ts-bulk-note"
                                maxlength="500"
                                :aria-label="$t('Time.bulk_note_label')"
                                :aria-invalid="String(!!bulkNoteError)"
                                :aria-describedby="bulkNoteError ? 'ap-bulk-note-error' : null"
                                :placeholder="$t('Time.reject_reason_ph')"
                                @keyup.enter="confirmSendBack"
                                @keydown.esc="cancelSendBack"
                            />
                            <button type="button" class="ah-btn ah-btn--danger" :disabled="!!busy" data-test="ts-bulk-confirm-send-back" @click="confirmSendBack">{{ $t('Time.bulk_send_back') }}</button>
                            <button type="button" class="ah-btn ah-btn--secondary" :disabled="!!busy" @click="cancelSendBack">{{ $t('Time.cancel') }}</button>
                            <p v-if="bulkNoteError" id="ap-bulk-note-error" class="ah-field__error ap__bulk-error">{{ bulkNoteError }}</p>
                        </template>
                        <template v-else>
                            <button type="button" class="ah-btn ah-btn--primary" :disabled="!!busy" data-test="ts-bulk-approve" @click="reviewSelection('approve')">
                                {{ busy === BULK ? $t('Time.approving') : $t('Time.approve') }}
                            </button>
                            <button ref="sendBackButton" type="button" class="ah-btn ah-btn--secondary tv-btn-danger-outline" :disabled="!!busy" data-test="ts-bulk-send-back" @click="startSendBack">{{ $t('Time.bulk_send_back') }}</button>
                        </template>
                    </div>
                </div>
                <article v-for="card in visibleCards" :key="card.key" class="tv-card ap__card" :class="{ 'ap__card--agent': card.kind === 'agent' }">
                    <div class="ap__who">
                        <input
                            v-if="card.kind === 'timesheet'"
                            type="checkbox"
                            class="ah-check"
                            data-test="ts-select"
                            :checked="selection.includes(card.row._id)"
                            :disabled="!!busy"
                            :aria-label="$t('Time.bulk_select_one', { name: card.name })"
                            @change="toggleOne(card.row._id, $event.target.checked)"
                        />
                        <span v-if="card.kind === 'agent'" class="ah-avatar ah-avatar--agent">◉</span>
                        <span v-else class="ah-avatar" :style="{ background: card.color }">
                            <AvatarImage :src="card.avatar" :alt="card.name">{{ initial(card.name) }}</AvatarImage>
                        </span>
                        <div class="ap__who-text">
                            <div class="ap__title">{{ card.title }}</div>
                            <div class="ap__sub">{{ card.sub }}</div>
                        </div>
                        <span v-if="card.kind === 'agent'" class="ah-chip ah-chip--agent">{{ $t('Time.agent_tag') }}</span>
                        <span v-if="card.own" class="ah-chip ah-chip--warn" data-test="own-week" :title="$t('Time.own_week_hint')">{{ $t('Time.own_week') }}</span>
                    </div>

                    <div v-if="card.kind === 'timesheet'" class="ap__facts">
                        <span>{{ $t('Time.billable_h', { h: formatHm(card.row.billableMinutes) }) }}</span>
                        <span>{{ $t('Time.internal_h', { h: formatHm(card.row.nonBillableMinutes) }) }}</span>
                        <span v-if="card.row.overMinutes > 0" class="is-warn">{{ $t('Time.over_cap', { h: formatHm(card.row.overMinutes) }) }}</span>
                    </div>
                    <div v-if="card.kind === 'leave' && card.overlap" class="ap__warn">{{ card.overlap }}</div>
                    <div v-if="card.kind === 'leave' && card.row.reason" class="ap__reason">{{ card.row.reason }}</div>
                    <div v-if="card.kind === 'agent'" class="ap__reason">{{ card.row.detail }}</div>

                    <div v-if="rejecting === card.key" class="ap__reject">
                        <input v-model="rejectReason" class="ah-input" :class="{ 'ah-input--error': rejectError }" :placeholder="$t('Time.reject_reason_ph')" @keyup.enter="confirmReject(card)" />
                        <p v-if="rejectError" class="ah-field__error">{{ rejectError }}</p>
                        <div class="tv-row-actions">
                            <button type="button" class="ah-btn ah-btn--danger ah-btn--grow" :disabled="!!busy" @click="confirmReject(card)">{{ $t('Time.confirm_reject') }}</button>
                            <button type="button" class="ah-btn ah-btn--secondary" :disabled="!!busy" @click="cancelReject">{{ $t('Time.cancel') }}</button>
                        </div>
                    </div>
                    <div v-else class="tv-row-actions">
                        <button type="button" class="ah-btn ah-btn--primary ah-btn--grow" :disabled="!!busy" @click="approve(card)">
                            {{ busy === card.key ? $t('Time.approving') : $t('Time.approve') }}
                        </button>
                        <button v-if="card.kind === 'timesheet'" type="button" class="ah-btn ah-btn--secondary" @click="openDetail(card.row)">{{ $t('Time.detail') }}</button>
                        <button
                            v-if="card.kind === 'agent'"
                            :ref="(el) => setWhyButton(card.key, el)"
                            type="button"
                            class="ah-btn ah-btn--secondary"
                            aria-haspopup="dialog"
                            :aria-expanded="String(whyKey === card.key)"
                            data-test="proposal-why"
                            @click="openWhy(card)"
                        >{{ $t('Time.why') }}</button>
                        <button type="button" class="ah-btn ah-btn--secondary tv-btn-danger-outline" :disabled="!!busy" @click="startReject(card)">{{ $t('Time.reject') }}</button>
                    </div>
                </article>

                <EmptyState
                    v-if="filter === 'agent' && !agentProposals.length && !proposalsFailed"
                    illustration="inbox"
                    data-test="approvals-empty-agent"
                    :title="$t('Time.agent_section')"
                    :message="$t('Time.agent_empty')"
                />
                <EmptyState
                    v-else-if="!visibleCards.length && !loading"
                    illustration="inbox"
                    data-test="approvals-empty"
                    :title="$t('Time.queue_empty_title')"
                    :message="$t('Time.queue_empty')"
                    :action-label="filter === 'all' ? '' : $t('Time.show_all_approvals')"
                    @action="filter = 'all'"
                />
                <div v-else-if="loading && !visibleCards.length" class="ah-small">{{ $t('Time.loading') }}</div>
            </div>
        </template>
        <ProposalWhyDialog v-if="whyCard" :proposal="whyCard.row" @close="closeWhy" />
    </div>
</template>

<script setup>
import EmptyState from '@/components/atom/EmptyState/EmptyState.vue';
import AvatarImage from '@/components/atom/AvatarImage/AvatarImage.vue';
import { ref, computed, inject, nextTick, onMounted, watch } from 'vue';
import { useStore } from 'vuex';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import moment from 'moment';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { useGetterFunctions } from '@/composable';
import { formatHm } from '@/composable/useTimer';
import { canApprove } from './approvalAccess';
import TimesheetTabs from '@/views/Timesheet/TimesheetTabs.vue';
import { fetchPendingProposals, sendProposalDecision } from '@/composable/agentProposals';
import { showProjects } from '@/composable/approvedProjects';
import { madeProjectIds } from '@/composable/approvedProjectIds';
import ProposalWhyDialog from './ProposalWhyDialog.vue';
import { proposalTitle } from '@/views/Ai/plainLabels';
import { changeLabel } from '@/views/Ai/agentActionLabels';

/**
 * @typedef {Object} AgentProposal
 * @property {string} id
 * @property {string} agentName
 * @property {string} summary       one line, e.g. "Daily PM · 2 sprint moves"
 * @property {string} detail        why the agent proposes it
 * @property {boolean} reversible
 * @property {{label: string, reversible: boolean}[]} changes
 * @property {string} createdAt
 */

defineOptions({ name: 'ApprovalsQueue' });

const store = useStore();
const { getters } = store;
const router = useRouter();
const { t } = useI18n();
const { getUser } = useGetterFunctions();
const companyId = inject('$companyId');
const currentUserId = inject('$userId');

const cid = computed(() => (companyId && companyId.value) || '');
const uid = computed(() => (currentUserId && currentUserId.value) || localStorage.getItem('userId') || '');
const isManager = computed(() => canApprove(getters['settings/companyUserDetail']));

const filters = [
    { key: 'all', label: 'Time.filter_all' },
    { key: 'timesheet', label: 'Time.filter_time' },
    { key: 'leave', label: 'Time.filter_leave' },
    { key: 'agent', label: 'Time.filter_ai' },
];
const filter = ref('all');
const timesheets = ref([]);
const leave = ref([]);
const approvedLeave = ref([]);
/** @type {import('vue').Ref<AgentProposal[]>} */
const agentProposals = ref([]);
const proposalsFailed = ref(false);
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
    return names.length ? t('Time.leave_overlap', { names: [...new Set(names)].join(', ') }) : '';
};

// The stored total is the week as first submitted; the split beside it is the week as it stands, so the card shows their sum.
const weekMinutes = (row) => (row.billableMinutes == null && row.nonBillableMinutes == null
    ? row.totalMinutes
    : (Number(row.billableMinutes) || 0) + (Number(row.nonBillableMinutes) || 0));
const oldestFirst = (list) => list.sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0));

const cards = computed(() => {
    const ts = timesheets.value.map((row) => ({
        kind: 'timesheet', key: `ts-${row._id}`, row, at: row.submittedAt, own: String(row.userId) === String(uid.value),
        name: row.userName || nameOf(row.userId), avatar: row.userAvatar, color: colorFor(row.userId),
        title: t('Time.ts_card_title', { name: row.userName || nameOf(row.userId) }),
        sub: t('Time.week_of', { date: moment(row.periodStart).format('MMM D'), h: formatHm(weekMinutes(row)) }),
    }));
    const lv = leave.value.map((row) => {
        const days = Number(row.totalDays) || 0;
        const range = rangeLabel(row.startDate, row.endDate);
        return {
            kind: 'leave', key: `pto-${row._id}`, row, at: row.createdAt,
            name: row.userName || nameOf(row.userId), avatar: '', color: colorFor(row.userId),
            title: t('Time.leave_title', { name: row.userName || nameOf(row.userId), type: t(`Pto.types.${row.type}`) }),
            sub: days === 1 ? t('Time.leave_one', { range }) : t('Time.leave_range', { range, days }),
            overlap: overlapText(row),
        };
    });
    const ag = agentProposals.value.map((row) => ({
        kind: 'agent', key: `ag-${row.id}`, row, at: row.createdAt, name: row.agentName, avatar: '', color: 'var(--agent)',
        title: row.summary, sub: `${row.agentName}${row.reversible ? ` · ${t('Time.reversible')}` : ''}`,
    }));
    return [ts, lv, ag].flatMap(oldestFirst);
});
const visibleCards = computed(() => cards.value.filter((c) => filter.value === 'all' || c.kind === filter.value));
const count = computed(() => cards.value.length);

const bodyOf = (res) => (res && res.data) || {};

/** @returns {AgentProposal} */
const toAgentProposal = (p) => {
    const changes = Array.isArray(p.changes) ? p.changes : [];
    return {
        id: String(p._id), agentName: p.agentName || '', summary: proposalTitle(t, p), detail: p.why || '',
        reversible: changes.length > 0 && changes.every((c) => c && c.reversible), createdAt: p.createdAt,
        changes: changes.filter(Boolean).map((c) => ({ label: changeLabel(t, c) || c.action || '', reversible: Boolean(c.reversible) })),
    };
};
const loadProposals = async () => {
    proposalsFailed.value = false;
    try {
        agentProposals.value = (await fetchPendingProposals()).map(toAgentProposal);
    } catch (e) {
        agentProposals.value = [];
        proposalsFailed.value = true;
    }
};
const load = async () => {
    loading.value = true;
    error.value = '';
    const proposalsLoaded = loadProposals();
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
        error.value = t('Time.load_failed');
    } finally {
        await proposalsLoaded;
        loading.value = false;
    }
};
const flash = (msg, ms = 3000) => { notice.value = msg; setTimeout(() => { if (notice.value === msg) notice.value = ''; }, ms); };
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
        const body = bodyOf(await sendProposalDecision(card.row.id, action === 'approve' ? 'approve' : 'decline', reason ? { reason } : {}));
        if (!body.status) throw new Error(body.statusText);
        showProjects(store, madeProjectIds(body.data));
        agentProposals.value = agentProposals.value.filter((r) => r.id !== card.row.id);
    }
};
const approve = async (card) => {
    if (busy.value) return;
    busy.value = card.key;
    error.value = '';
    try {
        await decide(card, 'approve');
        flash(t('Time.approved_ok'));
    } catch (e) {
        error.value = t('Time.action_failed');
    } finally {
        busy.value = '';
    }
};
const startReject = (card) => { rejecting.value = card.key; rejectReason.value = ''; rejectError.value = ''; };
const cancelReject = () => { rejecting.value = ''; rejectReason.value = ''; rejectError.value = ''; };
const confirmReject = async (card) => {
    const reason = rejectReason.value.trim();
    if (!reason) { rejectError.value = t('Time.reason_required'); return; }
    if (busy.value) return;
    busy.value = card.key;
    error.value = '';
    try {
        await decide(card, 'reject', reason);
        cancelReject();
        flash(t('Time.rejected_ok'));
    } catch (e) {
        error.value = t('Time.action_failed');
    } finally {
        busy.value = '';
    }
};

const BULK = 'bulk';
const BULK_REVIEW_MAX = 100;
const SKIP_REASONS = ['already_reviewed', 'not_allowed', 'not_found'];
const STILL_WAITING = ['not_allowed', 'failed'];
const selectedIds = ref([]);
const sendingBack = ref(false);
const bulkNote = ref('');
const bulkNoteError = ref('');
const selectAllBox = ref(null);
const bulkNoteInput = ref(null);
const sendBackButton = ref(null);

const visibleSheetIds = computed(() => visibleCards.value.filter((c) => c.kind === 'timesheet').map((c) => c.row._id));
const selection = computed(() => visibleSheetIds.value.filter((id) => selectedIds.value.includes(id)));
const allSelected = computed(() => selection.value.length > 0 && selection.value.length === visibleSheetIds.value.length);
const someSelected = computed(() => selection.value.length > 0 && !allSelected.value);
const toggleOne = (id, on) => { selectedIds.value = on ? [...new Set([...selectedIds.value, id])] : selectedIds.value.filter((x) => x !== id); };
const toggleAll = (on) => { selectedIds.value = on ? [...visibleSheetIds.value] : []; };
watch(() => selection.value.length, (n) => { if (!n) sendingBack.value = false; });

const bulkSummary = (results) => {
    const count = (outcome, reason) => results.filter((r) => r.outcome === outcome && (!reason || r.reason === reason)).length;
    const parts = [];
    if (count('approved')) parts.push(t('Time.bulk_approved_n', { n: count('approved') }));
    if (count('sent_back')) parts.push(t('Time.bulk_sent_back_n', { n: count('sent_back') }));
    [...new Set(results.filter((r) => r.outcome === 'skipped').map((r) => r.reason))].forEach((reason) => {
        parts.push(t('Time.bulk_skipped_n', { n: count('skipped', reason), reason: t(`Time.bulk_reason_${SKIP_REASONS.includes(reason) ? reason : 'failed'}`) }));
    });
    return parts.join(', ');
};
const applyBulkResults = (results) => {
    const gone = results.filter((r) => r.outcome !== 'skipped' || !STILL_WAITING.includes(r.reason)).map((r) => r.id);
    timesheets.value = timesheets.value.filter((r) => !gone.includes(r._id));
    selectedIds.value = selectedIds.value.filter((id) => !gone.includes(id));
};
const reviewSelection = async (action, reason) => {
    const ids = [...selection.value];
    if (busy.value || !ids.length) return;
    busy.value = BULK;
    error.value = '';
    const results = [];
    try {
        for (let i = 0; i < ids.length; i += BULK_REVIEW_MAX) {
            const body = bodyOf(await apiRequest('post', `${env.TIMESHEET_APPROVAL}/bulk-review`, { ids: ids.slice(i, i + BULK_REVIEW_MAX), action, ...(reason ? { reason } : {}) }));
            if (!body.status) throw new Error(body.statusText);
            results.push(...((body.data && body.data.results) || []));
        }
        sendingBack.value = false;
        flash(bulkSummary(results), 6000);
    } catch (e) {
        error.value = t('Time.action_failed');
    } finally {
        applyBulkResults(results);
        busy.value = '';
    }
    await nextTick();
    if (!selection.value.length && selectAllBox.value) selectAllBox.value.focus();
};
const startSendBack = async () => {
    sendingBack.value = true;
    bulkNote.value = '';
    bulkNoteError.value = '';
    await nextTick();
    if (bulkNoteInput.value) bulkNoteInput.value.focus();
};
const cancelSendBack = async () => {
    sendingBack.value = false;
    bulkNoteError.value = '';
    await nextTick();
    if (sendBackButton.value) sendBackButton.value.focus();
};
const confirmSendBack = () => {
    const note = bulkNote.value.trim();
    if (!note) { bulkNoteError.value = t('Time.bulk_note_required'); return; }
    bulkNoteError.value = '';
    reviewSelection('reject', note);
};

const whyKey = ref('');
const whyButtons = new Map();
const whyCard = computed(() => cards.value.find((c) => c.key === whyKey.value) || null);
const setWhyButton = (key, el) => { if (el) whyButtons.set(key, el); else whyButtons.delete(key); };
const openWhy = (card) => { whyKey.value = card.key; };
const closeWhy = async () => {
    const key = whyKey.value;
    whyKey.value = '';
    await nextTick();
    const button = whyButtons.get(key);
    if (button && button.isConnected) button.focus();
};
const openDetail = (row) => {
    router.push({ name: 'User Timesheet', params: { cid: cid.value }, query: { userId: row.userId, week: moment(row.periodStart).format('YYYY-MM-DD') } });
};

onMounted(() => { if (isManager.value) load(); });
</script>

<style src="../Timesheet/timeV2.css"></style>
<style scoped>
.ap { max-width: 720px; }
.ap__count { background: var(--brand); color: var(--on-brand); font: 700 10px/1 var(--font-ui); padding: 4px 7px; border-radius: 9px; }
.ap__tabs { margin-left: auto; }
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
.ap__bulk { position: sticky; top: 0; z-index: 1; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; padding: 6px 14px; border-radius: 14px; }
.ap__bulk-pick { display: flex; align-items: center; gap: 8px; min-height: 40px; }
.ap__bulk-label { font-size: 12px; color: var(--ink-2); cursor: pointer; }
.ap__bulk-bar { flex: 1; min-width: 0; display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 6px; }
.ap__bulk-bar .ah-btn { min-height: 40px; }
.ap__bulk-count { margin-right: auto; font-size: 12px; font-weight: 600; white-space: nowrap; }
.ah-input.ap__bulk-note { flex: 1 1 180px; min-width: 0; }
.ap__bulk-error { flex-basis: 100%; margin: 0; }
</style>
