<template>
    <teleport to="body" :disabled="!teleport">
        <div v-if="state.open" class="aff-layer">
            <div class="aff-backdrop" aria-hidden="true" @click="close"></div>
            <div
                ref="dialogEl"
                class="aff"
                role="dialog"
                aria-modal="true"
                :aria-labelledby="headingId"
                tabindex="-1"
                @keydown="onKey"
            >
                <h2 :id="headingId" class="aff__heading">
                    <span class="aff__mark" aria-hidden="true">✦</span>
                    {{ $t('AiFields.dialog_title', { field: state.field?.fieldTitle || '' }) }}
                </h2>
                <p class="aff__hint">{{ bulk ? $t('AiFields.dialog_bulk', { n: state.taskIds.length }) : $t('AiFields.dialog_single') }}</p>

                <p v-if="state.phase === PHASE.OFF" class="aff__note" role="status">{{ $t('AiFields.ai_off') }}</p>
                <p v-else-if="state.phase === PHASE.PREVIEWING" class="aff__hint" role="status">{{ $t('AiFields.previewing') }}</p>
                <p v-else-if="state.phase === PHASE.ERROR" class="aff__error" role="alert">{{ errorText }}</p>

                <template v-if="showProposals">
                    <ul class="aff__list">
                        <li v-for="proposal in state.proposals" :key="proposal.taskId" class="aff__item" data-ai-proposal>
                            <span v-if="proposal.taskName" class="aff__task">{{ proposal.taskName }}</span>
                            <AiProposalValue v-if="!proposal.empty" class="aff__value" :field="state.field" :proposal="proposal" />
                            <template v-else>
                                <span class="aff__empty" :class="{ 'aff__empty--failed': proposal.invalid }">{{ $t(emptyKey(proposal)) }}</span>
                                <button
                                    v-if="proposal.invalid"
                                    type="button"
                                    class="ah-btn ah-btn--ghost ah-btn--sm aff__retry"
                                    data-ai-retry
                                    :disabled="proposal.retrying"
                                    @click="retryAiProposal(proposal.taskId)"
                                >{{ $t('AiFields.retry') }}</button>
                            </template>
                        </li>
                    </ul>
                    <p v-if="bulk" class="aff__hint">{{ $t('AiFields.preview_note', { shown: state.proposals.length, n: state.taskIds.length }) }}</p>
                </template>

                <div v-if="job" class="aff__job">
                    <div
                        class="aff__bar"
                        role="progressbar"
                        :aria-valuenow="String(job.processed || 0)"
                        aria-valuemin="0"
                        :aria-valuemax="String(job.total || 0)"
                        :aria-label="$t('AiFields.job_progress_label')"
                    >
                        <span class="aff__bar-fill" :style="{ width: `${percent}%` }"></span>
                    </div>
                    <p class="aff__hint" aria-live="polite">{{ $t('AiFields.job_progress', { processed: job.processed || 0, total: job.total || 0 }) }}</p>
                    <p v-if="state.phase === PHASE.FINISHED" class="aff__note" role="status">{{ finishedText }}</p>
                </div>

                <div class="aff__foot">
                    <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" data-ai-fill-close @click="close">
                        {{ finished ? $t('AiFields.close') : $t('AiFields.cancel') }}
                    </button>
                    <button
                        v-if="state.phase === PHASE.PREVIEW || state.phase === PHASE.APPLYING"
                        ref="confirmEl"
                        type="button"
                        class="ah-btn ah-btn--primary ah-btn--sm"
                        data-ai-fill-confirm
                        :disabled="!canConfirm"
                        @click="confirmAiFill"
                    >{{ bulk ? $t('AiFields.fill_n', { n: state.taskIds.length }) : $t('AiFields.apply') }}</button>
                </div>
                <p v-if="state.phase === PHASE.PREVIEW" class="aff__hint">{{ $t('AiFields.spend_note') }}</p>
            </div>
        </div>
    </teleport>
</template>

<script setup>
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { PHASE, aiFieldFill as state, closeAiFill, confirmAiFill, isBulkFill, retryAiProposal } from "@/composable/aiFieldFill";
import AiProposalValue from "./AiProposalValue.vue";

defineOptions({ name: "AiFieldFillDialog" });

defineProps({
    teleport: { type: Boolean, default: true }
});

const { t } = useI18n();
const headingId = "ai-field-fill-heading";
const dialogEl = ref(null);
const confirmEl = ref(null);
let returnFocus = null;

const bulk = computed(() => isBulkFill());
const job = computed(() => state.job);
const finished = computed(() => state.phase === PHASE.FINISHED || state.phase === PHASE.ERROR || state.phase === PHASE.OFF);
const showProposals = computed(() => [PHASE.PREVIEW, PHASE.APPLYING].includes(state.phase) && state.proposals.length);
const canConfirm = computed(() => state.phase === PHASE.PREVIEW && (bulk.value || state.proposals.some((proposal) => proposal.proposalId)));
const percent = computed(() => (job.value?.total ? Math.round(((job.value.processed || 0) / job.value.total) * 100) : 0));

const STOP_REASONS = ["ai_off", "daily_limit", "budget", "no_provider", "interrupted", "error"];

const finishedText = computed(() => {
    const current = job.value || {};
    const counts = { filled: current.filled || 0, skipped: current.skipped || 0, failed: current.failed || 0 };
    if (current.status === "done") return t(counts.failed ? "AiFields.job_done_failed" : "AiFields.job_done", counts);
    return t(`AiFields.stop_${STOP_REASONS.includes(current.stopReason) ? current.stopReason : "error"}`);
});

const EMPTY_REASONS = ["no_fit", "no_source", "no_answer", "not_found", "forbidden", "not_in_project", "not_for_task_type", "invalid", "out_of_range", "date_rule"];

const errorText = computed(() => {
    if (STOP_REASONS.includes(state.errorCode)) return t(`AiFields.stop_${state.errorCode}`);
    if (EMPTY_REASONS.includes(state.errorCode)) return t(`AiFields.empty_${state.errorCode}`);
    if (state.errorCode === "expired") return t("AiFields.preview_expired");
    return state.error || t("AiFields.fill_failed");
});
const emptyKey = (proposal) => `AiFields.empty_${EMPTY_REASONS.includes(proposal.reason) ? proposal.reason : "no_answer"}`;

function close() {
    closeAiFill();
}

function onKey(event) {
    if (event.key === "Escape") {
        event.stopPropagation();
        close();
    }
}

watch(() => state.open, async (open) => {
    if (open) {
        returnFocus = typeof document !== "undefined" ? document.activeElement : null;
        await nextTick();
        dialogEl.value?.focus();
    } else if (returnFocus && typeof returnFocus.focus === "function") {
        returnFocus.focus();
        returnFocus = null;
    }
});

watch(() => state.phase, async (phase) => {
    if (phase !== PHASE.PREVIEW) return;
    await nextTick();
    confirmEl.value?.focus();
});
</script>

<style scoped>
.aff-layer { position: fixed; inset: 0; z-index: 1000; }
.aff-backdrop { position: absolute; inset: 0; background: rgba(0, 0, 0, .36); }
.aff {
    position: absolute; top: 10vh; left: 50%; transform: translateX(-50%);
    box-sizing: border-box; width: 520px; max-width: calc(100vw - 32px); max-height: 80dvh; overflow: auto;
    display: flex; flex-direction: column; gap: 10px; padding: 16px;
    border-radius: var(--r-modal, 16px); background: var(--surface); color: var(--ink);
    box-shadow: var(--shadow-modal); font-family: var(--font-ui); font-size: 12.5px;
}
.aff:focus { outline: none; }
.aff__heading { display: flex; align-items: center; gap: 6px; margin: 0; font: 600 14px/1.3 var(--font-ui); color: var(--ink); }
.aff__mark { color: var(--brand); }
.aff__hint { margin: 0; color: var(--ink-2); font-size: 11.5px; }
.aff__note { margin: 0; color: var(--ink); }
.aff__error { margin: 0; color: var(--danger); }
.aff__list { display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 0; list-style: none; }
.aff__item {
    display: flex; flex-direction: column; gap: 3px; padding: 8px 10px;
    border: 1px solid var(--hairline); border-radius: var(--r-input, 8px); background: var(--surface-2);
}
.aff__task { font-weight: 600; color: var(--ink); overflow-wrap: anywhere; }
.aff__value { white-space: pre-wrap; overflow-wrap: anywhere; color: var(--ink); }
.aff__empty { color: var(--ink-2); font-style: italic; }
.aff__empty--failed { color: var(--danger); font-style: normal; }
.aff__retry { align-self: flex-start; }
.aff__job { display: flex; flex-direction: column; gap: 6px; }
.aff__bar { height: 6px; border-radius: 999px; background: var(--surface-2); overflow: hidden; }
.aff__bar-fill { display: block; height: 100%; background: var(--brand); transition: width var(--t-state, .2s) var(--ease, ease); }
.aff__foot { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; border-top: 1px solid var(--hairline); padding-top: 12px; }
@media (max-width: 767px) {
    .aff { top: 6dvh; }
    .aff__foot .ah-btn { flex: 1 1 auto; min-height: 36px; }
}
</style>
