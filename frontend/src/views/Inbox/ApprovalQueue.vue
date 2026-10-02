<template>
    <section class="aq" data-test="approval-queue" :aria-label="t('Inbox.tab_approval')">
        <div v-if="reviewing" ref="reviewEl" class="aq__review" role="group" tabindex="-1" :aria-labelledby="REVIEW_TITLE_ID" data-test="queue-review">
            <h2 :id="REVIEW_TITLE_ID" class="aq__review-title">{{ t('Inbox.queue_review_title', { n: reviewRows.length }, reviewRows.length) }}</h2>
            <p class="aq__lead">{{ t('Inbox.queue_review_lead') }}</p>
            <ol class="aq__review-list">
                <li v-for="p in reviewRows" :key="p.proposalId" class="aq__review-item" data-test="queue-review-item">
                    <div class="aq__what"><strong>{{ whoOf(p) }}</strong> {{ t('Inbox.wants_to') }} {{ titleOf(p) }}</div>
                    <ul class="aq__changes">
                        <li v-for="(change, i) in readChanges(p)" :key="i" class="aq__change">
                            <span class="aq__change-label">{{ changeText(change) }}</span>
                            <span v-if="!change.reversible" class="ah-chip ah-chip--warn">{{ t('Ai.not_reversible') }}</span>
                        </li>
                    </ul>
                    <p v-if="choiceOf(p)" class="aq__lead" data-test="queue-review-parts">{{ t('Inbox.queue_parts_left_out') }}</p>
                </li>
            </ol>
            <div class="aq__actions">
                <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="busy || !reviewRows.length" data-test="queue-bulk-confirm" @click="approveReviewed">
                    {{ busy ? t('Inbox.queue_approving') : t('Inbox.queue_approve_n', { n: reviewRows.length }, reviewRows.length) }}
                </button>
                <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :disabled="busy" data-test="queue-bulk-cancel" @click="closeReview">{{ t('Ai.cancel') }}</button>
            </div>
        </div>
        <div v-else-if="selectable.length > 1" class="aq__bulk">
            <input
                :id="SELECT_ALL_ID"
                type="checkbox"
                class="ah-check"
                data-test="queue-select-all"
                :checked="allPicked"
                :indeterminate.prop="pickedIds.length > 0 && !allPicked"
                :disabled="busy"
                @change="toggleAll($event.target.checked)"
            />
            <label :for="SELECT_ALL_ID" class="aq__bulk-label">{{ t('Inbox.queue_select_all') }}</label>
            <span v-if="pickedIds.length" class="aq__bulk-count">{{ t('Inbox.queue_selected', { n: pickedIds.length }) }}</span>
            <button ref="reviewButton" type="button" class="ah-btn ah-btn--primary ah-btn--sm aq__bulk-go" :disabled="busy || !pickedIds.length" data-test="queue-bulk-review" @click="openReview">
                {{ t('Inbox.queue_review') }}
            </button>
        </div>

        <p v-if="summary" class="aq__summary" role="status" data-test="queue-summary">{{ summary }}</p>

        <ul class="aq__list">
            <li v-for="p in proposals" :key="p.proposalId" class="aq__row" :class="{ 'is-locked': p.locked }" data-test="queue-row" :data-id="p.proposalId">
                <div class="aq__head">
                    <input
                        v-if="!p.locked"
                        type="checkbox"
                        class="ah-check"
                        data-test="queue-select"
                        :checked="pickedIds.includes(p.proposalId)"
                        :disabled="busy || reviewing"
                        :aria-label="t('Inbox.queue_select_one', { what: titleOf(p) })"
                        @change="toggleOne(p.proposalId, $event.target.checked)"
                    />
                    <span class="ah-avatar ah-avatar--agent" aria-hidden="true"><ShellIcon name="agent" :size="12" /></span>
                    <span class="aq__what"><strong>{{ whoOf(p) }}</strong> {{ t('Inbox.wants_to') }} {{ titleOf(p) }}</span>
                    <span v-if="p.locked" class="ah-chip ah-chip--warn" data-test="queue-locked">{{ t(lockedByRights(p) ? 'Inbox.queue_locked_rights' : 'Inbox.queue_locked') }}</span>
                    <span v-if="p.tainted" class="ah-chip ah-chip--warn">{{ t('Audit.tainted') }}</span>
                    <time v-if="stamp(p.createdAt)" class="aq__when" :title="p.createdAt">{{ stamp(p.createdAt) }}</time>
                </div>

                <p class="aq__why"><span class="aq__label">{{ t('Ai.why') }}</span> {{ whyOf(p) || t('Time.why_no_reason') }}</p>

                <div class="aq__label">{{ t('Inbox.queue_changes_label') }}</div>
                <ul class="aq__changes">
                    <li v-for="(change, i) in shownChanges(p)" :key="i" class="aq__change">
                        <IntentPreview
                            v-if="change.preview"
                            class="aq__intent"
                            :preview="change.preview"
                            :choosable="canPick(p)"
                            :left-out="leftOut[pickKey(p, i)] || []"
                            :disabled="busy || reviewing"
                            @update:left-out="leftOut[pickKey(p, i)] = $event"
                            @open-task="emit('open-task', $event)"
                        />
                        <span v-else class="aq__change-label">{{ changeLabel(t, change) }}</span>
                        <span v-if="!change.reversible" class="ah-chip ah-chip--warn" data-test="queue-permanent">{{ t('Ai.not_reversible') }}</span>
                        <button
                            v-if="isEditing(p)"
                            type="button"
                            class="ah-btn ah-btn--ghost ah-btn--sm"
                            data-test="queue-drop"
                            :aria-label="t('Inbox.queue_drop_named', { change: changeText(change) })"
                            @click="kept.splice(i, 1)"
                        >{{ t('Ai.drop') }}</button>
                        <SlackPostPreview v-if="change.action === SLACK_POST" class="aq__slack" :change="change" />
                    </li>
                </ul>

                <p v-if="errors[p.proposalId]" class="ah-field__error aq__error" role="alert" data-test="queue-row-error">{{ errors[p.proposalId] }}</p>

                <p v-if="p.locked" class="aq__locked-note" data-test="queue-locked-note">{{ t(lockedByRights(p) ? 'Ai.rights_locked' : 'Ai.gate_locked') }}</p>
                <div v-if="declining === p.proposalId && mayDecline(p)" class="aq__decline">
                    <div class="aq__label">{{ t('Ai.decline_reason_title') }}</div>
                    <div class="aq__chips" role="group" :aria-label="t('Ai.decline_reason_title')">
                        <button
                            v-for="key in DECLINE_REASONS"
                            :key="key"
                            type="button"
                            class="ah-chip aq__reason"
                            :class="{ 'is-on': declineReason === key }"
                            :aria-pressed="declineReason === key ? 'true' : 'false'"
                            :data-reason="key"
                            @click="pickReason(key)"
                        >{{ t(`Ai.decline_reason_${key}`) }}</button>
                    </div>
                    <input
                        v-model.trim="declineNote"
                        type="text"
                        class="ah-input aq__note"
                        maxlength="200"
                        data-test="queue-decline-note"
                        :placeholder="t('Ai.decline_reason_placeholder')"
                        :aria-label="t('Ai.decline_reason_other')"
                        @input="declineReason = ''"
                    />
                    <div class="aq__actions">
                        <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="busy || !declineValue" data-test="queue-decline-send" @click="decline(p, declineValue)">{{ t('Ai.decline') }}</button>
                        <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :disabled="busy" data-test="queue-decline-cancel" @click="declining = ''">{{ t('Ai.cancel') }}</button>
                        <button type="button" class="aq__skip" :disabled="busy" data-test="queue-decline-skip" @click="decline(p, '')">{{ t('Ai.decline_no_reason') }}</button>
                    </div>
                </div>
                <div v-else-if="p.locked" class="aq__actions">
                    <button
                        v-if="mayDecline(p)"
                        type="button"
                        class="ah-btn ah-btn--secondary ah-btn--sm"
                        :disabled="busy || reviewing"
                        data-test="queue-decline"
                        :aria-label="t('Inbox.queue_decline_named', { what: titleOf(p) })"
                        @click="openDecline(p)"
                    >{{ t('Inbox.decline') }}</button>
                </div>
                <div
                    v-else-if="alwaysFor === p.proposalId"
                    :ref="holdAlwaysPanel"
                    class="aq__decline aq__always"
                    role="group"
                    tabindex="-1"
                    :aria-label="t('Inbox.always_title')"
                    data-test="queue-always-panel"
                >
                    <div class="aq__label">{{ t('Inbox.always_title') }}</div>
                    <p class="aq__lead">{{ t('Inbox.always_body', { agent: whoOf(p), kind: alwaysKindOf(p) }) }}</p>
                    <p class="aq__lead">{{ t('Inbox.always_limits', { days: STANDING_DAYS }) }}</p>
                    <div class="aq__actions">
                        <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="busy" data-test="queue-always-confirm" @click="approveAlways(p)">{{ t('Inbox.always_confirm') }}</button>
                        <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :disabled="busy" data-test="queue-always-cancel" @click="alwaysFor = ''">{{ t('Ai.cancel') }}</button>
                    </div>
                </div>
                <div v-else class="aq__actions">
                    <button
                        type="button"
                        class="ah-btn ah-btn--primary ah-btn--sm"
                        :disabled="busy || reviewing || !changesOf(p).length"
                        data-test="queue-approve"
                        :aria-label="t('Inbox.queue_approve_named', { what: titleOf(p) })"
                        @click="approve(p)"
                    >{{ t('Inbox.approve') }}</button>
                    <button
                        v-if="p.editable"
                        type="button"
                        class="ah-btn ah-btn--secondary ah-btn--sm"
                        :disabled="busy || reviewing"
                        data-test="queue-edit"
                        :aria-pressed="isEditing(p) ? 'true' : 'false'"
                        :aria-label="t('Inbox.queue_edit_named', { what: titleOf(p) })"
                        @click="toggleEdit(p)"
                    >{{ isEditing(p) ? t('Ai.done_editing') : t('Inbox.queue_edit') }}</button>
                    <button
                        type="button"
                        class="ah-btn ah-btn--ghost ah-btn--sm"
                        :disabled="busy || reviewing"
                        data-test="queue-decline"
                        :aria-label="t('Inbox.queue_decline_named', { what: titleOf(p) })"
                        @click="openDecline(p)"
                    >{{ t('Inbox.decline') }}</button>
                    <button
                        v-if="p.always"
                        type="button"
                        class="ah-btn ah-btn--ghost ah-btn--sm"
                        :disabled="busy || reviewing || isEditing(p)"
                        data-test="queue-always"
                        :aria-label="t('Inbox.always_named', { what: titleOf(p) })"
                        @click="openAlways(p)"
                    >{{ t('Inbox.always') }}</button>
                </div>
            </li>
        </ul>

        <div v-if="applied.length" class="aq__done" data-test="queue-applied-list">
            <h2 class="aq__review-title">{{ t('Inbox.always_done_title') }}</h2>
            <p class="aq__lead">{{ t('Inbox.always_done_lead') }}</p>
            <ul class="aq__list">
                <li v-for="p in applied" :key="p.proposalId" class="aq__row aq__row--done" data-test="queue-applied" :data-id="p.proposalId">
                    <div class="aq__head">
                        <span class="ah-avatar ah-avatar--agent" aria-hidden="true"><ShellIcon name="agent" :size="12" /></span>
                        <span class="aq__what"><strong>{{ whoOf(p) }}</strong> {{ t('Inbox.always_did') }} {{ titleOf(p) }}</span>
                        <time v-if="stamp(p.createdAt)" class="aq__when" :title="p.createdAt">{{ stamp(p.createdAt) }}</time>
                        <button
                            type="button"
                            class="ah-btn ah-btn--secondary ah-btn--sm"
                            :disabled="busy"
                            data-test="queue-applied-undo"
                            :aria-label="t('Inbox.always_undo_named', { what: titleOf(p) })"
                            @click="undoApplied(p)"
                        >{{ t('Inbox.undo') }}</button>
                    </div>
                    <p v-if="errors[p.proposalId]" class="ah-field__error aq__error" role="alert">{{ errors[p.proposalId] }}</p>
                </li>
            </ul>
        </div>
    </section>
</template>

<script setup>
import { computed, nextTick, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useGetterFunctions } from '@/composable';
import { sendProposalDecision } from '@/composable/agentProposals';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';
import IntentPreview from '@/components/molecules/IntentPreview/IntentPreview.vue';
import { intentSummary, intentTitle } from '@/components/molecules/IntentPreview/intentLines';
import { chosenParts } from '@/components/molecules/IntentPreview/planPicks';
import SlackPostPreview from '@/views/Ai/SlackPostPreview.vue';
import { DECLINE_REASONS } from '@/views/Ai/episodeText';
import { proposalTitle } from '@/views/Ai/plainLabels';
import { agentActionLabel, changeLabel } from '@/views/Ai/agentActionLabels';
import { findingFix, findingReasons } from '@/views/Projects/ProjectDetail/findingText';
import { plainReason } from '@/views/Ai/auditWords';
import { decideEach, decideOne } from './approvalQueue';

defineOptions({ name: 'ApprovalQueue' });

const props = defineProps({
    proposals: { type: Array, required: true },
    applied: { type: Array, default: () => [] },
    stamp: { type: Function, default: () => '' },
});
const emit = defineEmits(['decided', 'undone', 'open-task']);

const SLACK_POST = 'slack.message.post';
const SOURCE_MCP = 'mcp';
const SOURCE_SYSTEM = 'system';
const DECLINE_REASON_MAX = 200;
const STANDING_DAYS = 90;
const REVIEW_TITLE_ID = 'aq-review-title';
const SELECT_ALL_ID = 'aq-select-all';

const { t, te } = useI18n();
const { getUser } = useGetterFunctions();

const busy = ref(false);
const picked = ref([]);
const reviewing = ref(false);
const reviewIds = ref([]);
const reviewEl = ref(null);
const reviewButton = ref(null);
const summary = ref('');
const errors = reactive({});
const editing = ref('');
const kept = ref([]);
const declining = ref('');
const declineReason = ref('');
const declineNote = ref('');
const alwaysFor = ref('');
let alwaysPanel = null;
const holdAlwaysPanel = (el) => { alwaysPanel = el; };

// A connected agent's proposal is filed under its tool's name and description, which is no sentence for a person.
const onlyPreview = (p) => (p.source === SOURCE_MCP && (p.changes || []).length === 1 ? p.changes[0].preview : null);
/* A change the project's rules filed is worded here from the facts it carries; its stored text is the fallback. */
const titleOf = (p) => (p.finding && findingFix(t, p.finding)) || intentTitle(t, p.batch || onlyPreview(p)) || proposalTitle(t, p);
const whyOf = (p) => (p.finding && findingReasons(t, p.finding).join(' · ')) || plainReason(t, te, p.why);
const changeText = (change) => intentSummary(t, change.preview) || changeLabel(t, change);
const alwaysKindOf = (p) => agentActionLabel(t, p.changes?.[0]?.action, p.alwaysKind);
// The preview is the server's reading of a change for this viewer, never part of the change sent back.
const asFiled = (change) => Object.fromEntries(Object.entries(change).filter(([key]) => key !== 'preview'));
const whoOf = (p) => {
    if (p.source === SOURCE_SYSTEM) return t('Inbox.queue_system_for', { project: p.finding?.projectName || p.agentName });
    const person = p.source === SOURCE_MCP && p.requestedBy ? getUser(p.requestedBy)?.Employee_Name : '';
    return person ? t('Inbox.queue_for', { agent: p.agentName, person }) : p.agentName;
};

const lockedByRights = (p) => p.lockedWhy === 'own_rights';
// A row that is not the reader's to approve can still be theirs to decline: one their own agent asked for.
const mayDecline = (p) => !p.locked || p.mayDecline === true;
const selectable = computed(() => props.proposals.filter((p) => !p.locked));
const pickedIds = computed(() => selectable.value.map((p) => p.proposalId).filter((id) => picked.value.includes(id)));
const allPicked = computed(() => selectable.value.length > 0 && pickedIds.value.length === selectable.value.length);
// Read from the queue as it stands now: a row decided elsewhere since the list was shown is not approved.
const reviewRows = computed(() => selectable.value.filter((p) => reviewIds.value.includes(p.proposalId)));

const toggleOne = (id, on) => { picked.value = on ? [...new Set([...picked.value, id])] : picked.value.filter((x) => x !== id); };
const toggleAll = (on) => { picked.value = on ? selectable.value.map((p) => p.proposalId) : []; };

const isEditing = (p) => editing.value === p.proposalId;
const changesOf = (p) => (isEditing(p) ? kept.value : p.changes || []);
// A batch is read as one card: how many tasks, what changes on them and which tasks, not a line for each change.
const readChanges = (p) => (p.batch ? [{ preview: p.batch, label: '', reversible: (p.changes || []).every((change) => change.reversible) }] : p.changes || []);
const shownChanges = (p) => (isEditing(p) ? kept.value : readChanges(p));
// The parts of a plan the person unticked, by proposal and change. Only their places in the stored plan are sent back.
const leftOut = reactive({});
const pickKey = (p, i) => `${p.proposalId}:${i}`;
const forgetPicks = (p) => Object.keys(leftOut).filter((key) => key.startsWith(`${p.proposalId}:`)).forEach((key) => { delete leftOut[key]; });
const canPick = (p) => !p.locked && !p.batch && !isEditing(p);
const choiceOf = (p) => {
    if (p.batch || isEditing(p)) return null;
    const parts = {};
    (p.changes || []).forEach((change, i) => {
        const chosen = chosenParts(change.preview, leftOut[pickKey(p, i)]);
        if (chosen) parts[i] = chosen;
    });
    return Object.keys(parts).length ? { parts } : null;
};
const toggleEdit = (p) => {
    if (isEditing(p)) { editing.value = ''; return; }
    forgetPicks(p);
    editing.value = p.proposalId;
    kept.value = (p.changes || []).map((change) => ({ ...change }));
};

const send = (id, verb, body) => decideOne(sendProposalDecision, id, verb, body, t('Inbox.action_failed'));
const failuresLine = (unapplied) => (unapplied.length ? t('Ai.applied_with_failures', { n: unapplied.length, error: unapplied[0].error || '' }) : '');
const settle = (p, verb, result) => {
    if (!result.ok) { errors[p.proposalId] = result.error; return; }
    delete errors[p.proposalId];
    forgetPicks(p);
    picked.value = picked.value.filter((id) => id !== p.proposalId);
    emit('decided', { id: p.proposalId, verb, undo: Boolean(result.undo), ...(result.madeProjects?.length ? { madeProjects: result.madeProjects } : {}) });
};

const approve = async (p) => {
    const edited = isEditing(p) && kept.value.length !== (p.changes || []).length;
    busy.value = true;
    summary.value = '';
    const result = await send(p.proposalId, 'approve', edited ? { changes: kept.value.map(asFiled) } : choiceOf(p) || {});
    busy.value = false;
    if (result.ok) { editing.value = ''; summary.value = failuresLine(result.unapplied); }
    settle(p, 'approve', result);
};

const pickReason = (key) => {
    declineReason.value = declineReason.value === key ? '' : key;
    declineNote.value = '';
};
const declineValue = computed(() => declineReason.value || declineNote.value.slice(0, DECLINE_REASON_MAX));
const openDecline = (p) => {
    alwaysFor.value = '';
    declining.value = p.proposalId;
    declineReason.value = '';
    declineNote.value = '';
};
const decline = async (p, reason) => {
    busy.value = true;
    summary.value = '';
    const result = await send(p.proposalId, 'decline', reason ? { reason } : {});
    busy.value = false;
    if (result.ok) declining.value = '';
    settle(p, 'decline', result);
};

const openAlways = async (p) => {
    declining.value = '';
    alwaysFor.value = p.proposalId;
    await nextTick();
    alwaysPanel?.focus();
};
const approveAlways = async (p) => {
    busy.value = true;
    summary.value = '';
    const result = await send(p.proposalId, 'approve', { always: true });
    busy.value = false;
    if (result.ok) {
        alwaysFor.value = '';
        summary.value = result.standing ? t('Inbox.always_made', { agent: whoOf(p) }) : failuresLine(result.unapplied);
    }
    settle(p, 'approve', result);
};
const undoApplied = async (p) => {
    busy.value = true;
    const result = await send(p.proposalId, 'undo', {});
    busy.value = false;
    if (!result.ok) { errors[p.proposalId] = result.error; return; }
    delete errors[p.proposalId];
    summary.value = result.left.length ? t('Inbox.queue_undo_left', { why: result.left[0] }) : '';
    emit('undone', { id: p.proposalId });
};

const openReview = async () => {
    reviewIds.value = [...pickedIds.value];
    editing.value = '';
    declining.value = '';
    alwaysFor.value = '';
    reviewing.value = true;
    await nextTick();
    reviewEl.value?.focus();
};
const closeReview = async () => {
    reviewing.value = false;
    reviewIds.value = [];
    await nextTick();
    reviewButton.value?.focus();
};
const approveReviewed = async () => {
    const rows = [...reviewRows.value];
    if (!rows.length) return;
    busy.value = true;
    summary.value = '';
    const byId = new Map(rows.map((p) => [p.proposalId, p]));
    const results = await decideEach(rows.map((p) => p.proposalId), (id) => send(id, 'approve', choiceOf(byId.get(id)) || {}), (result) => settle(byId.get(result.id), 'approve', result));
    busy.value = false;
    const approved = results.filter((r) => r.ok);
    const failed = results.length - approved.length;
    summary.value = [
        t('Inbox.queue_bulk_done', { ok: approved.length, n: results.length }),
        failed ? t('Inbox.queue_bulk_failed', { n: failed }, failed) : '',
        failuresLine(approved.flatMap((r) => r.unapplied)),
    ].filter(Boolean).join(' ');
    await closeReview();
};
</script>

<style scoped>
.aq { display: flex; flex-direction: column; gap: var(--sp-3, 8px); min-width: 0; }
.aq__list, .aq__changes, .aq__review-list { list-style: none; margin: 0; padding: 0; }
.aq__list { display: flex; flex-direction: column; gap: var(--sp-3, 8px); }
.aq__bulk, .aq__review, .aq__row {
    background: var(--surface); border: 1px solid var(--hairline); border-radius: var(--r-lg, 10px);
    padding: calc(var(--cell-pad-y, 9px) + 2px) var(--cell-pad-x, 13px);
}
.aq__bulk { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.aq__bulk-label { font: 500 var(--fs-md, 13px)/var(--lh-snug, 1.3) var(--font-ui); color: var(--ink); cursor: pointer; }
.aq__bulk-count { color: var(--ink-2); font-size: var(--fs-sm, 11.5px); }
.aq__bulk-go { margin-left: auto; }
.aq__review { display: flex; flex-direction: column; gap: var(--gap-row, 7px); border-color: var(--brand); outline: none; }
.aq__review:focus-visible { box-shadow: var(--focus); }
.aq__review-title { margin: 0; font: 600 var(--fs-lg, 14px)/1.3 var(--font-ui); color: var(--ink); }
.aq__lead, .aq__summary, .aq__locked-note { margin: 0; color: var(--ink-2); font-size: var(--fs-sm, 11.5px); line-height: 1.45; }
.aq__summary { padding: 0 2px; color: var(--ink); }
.aq__review-list { display: flex; flex-direction: column; gap: var(--sp-3, 8px); max-height: 40dvh; overflow: auto; }
.aq__review-item { padding-top: var(--sp-3, 8px); border-top: 1px solid var(--hairline); display: flex; flex-direction: column; gap: 4px; }
.aq__row { border-left: 3px solid var(--agent); display: flex; flex-direction: column; gap: var(--gap-row, 7px); min-width: 0; }
.aq__row.is-locked, .aq__row--done { border-left-color: var(--border); }
.aq__done { display: flex; flex-direction: column; gap: var(--sp-3, 8px); padding-top: var(--sp-3, 8px); }
.aq__always:focus-visible { outline: none; box-shadow: var(--focus); }
.aq__head { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; min-width: 0; }
.aq__what { flex: 1 1 12ch; min-width: 0; overflow-wrap: anywhere; color: var(--ink); }
.aq__what strong { font-weight: 600; }
.aq__when { margin-left: auto; font: 400 var(--fs-sm, 10px)/1 var(--font-ui); color: var(--ink-2); flex: none; }
.aq__label { font: var(--text-label); color: var(--ink-2); text-transform: uppercase; letter-spacing: .04em; }
.aq__why { margin: 0; color: var(--ink); line-height: 1.45; overflow-wrap: anywhere; white-space: pre-line; }
.aq__why .aq__label { margin-right: 6px; }
.aq__changes { display: flex; flex-direction: column; gap: 4px; }
.aq__change { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; padding: 5px 8px; border-radius: var(--r-sm, 6px); background: var(--fill); color: var(--ink); min-width: 0; }
.aq__change-label { flex: 1 1 12ch; min-width: 0; overflow-wrap: anywhere; }
.aq__intent { flex: 1 1 16ch; }
.aq__slack { flex: 1 1 100%; margin: 4px 0 0; }
.aq__error { margin: 0; }
.aq__actions { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.aq__actions .ah-btn--sm { height: var(--control-h, 28px); padding: 0 var(--sp-4, 10px); font-size: var(--fs-sm, 11.5px); }
.aq__decline { display: flex; flex-direction: column; gap: 8px; padding-top: var(--sp-3, 8px); border-top: 1px solid var(--hairline); }
.aq__chips { display: flex; flex-wrap: wrap; gap: 6px; }
.aq__reason { border: 1px solid transparent; cursor: pointer; }
.aq__reason.is-on { background: var(--brand-tint); color: var(--brand); border-color: var(--brand); }
.aq__reason:focus-visible, .aq__skip:focus-visible { outline: none; box-shadow: var(--focus); }
.ah-input.aq__note { max-width: 420px; }
.aq__skip { border: 0; background: transparent; color: var(--ink-2); font: var(--text-small); cursor: pointer; text-decoration: underline; padding: 0 4px; min-height: var(--hit-min); }
@media (max-width: 767px) {
    .aq__actions .ah-btn--sm, .aq__bulk .ah-btn--sm { height: 44px; padding: 0 14px; font-size: var(--fs-md, 13px); }
    .aq__reason { min-height: 36px; }
    .ah-input.aq__note { max-width: none; }
    .aq__bulk-go { margin-left: 0; flex: 1 1 100%; }
    .aq__when { margin-left: 0; }
}
</style>
