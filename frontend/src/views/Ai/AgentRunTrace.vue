<template>
    <div class="run-trace" data-test="run-trace">
        <div class="run-trace__head">
            <span class="ah-label">{{ $t('Ai.trace_title') }}</span>
            <template v-if="traceId">
                <span class="ah-mono ah-small run-trace__id" data-test="trace-id">{{ traceId }}</span>
                <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :aria-label="$t('Ai.trace_copy_label')" data-test="copy-trace-id" @click="copy">{{ $t('Ai.trace_copy') }}</button>
            </template>
            <a v-if="replayId && canViewReplay" class="ah-small run-trace__replay" :href="replayAnchor(replayId)" data-test="view-replay" @click.prevent="emit('view-replay', replayId)">{{ $t('Ai.trace_view_replay') }}</a>
        </div>

        <p v-if="!hasSteps" class="ah-small run-trace__empty" data-test="trace-empty">{{ $t('Ai.trace_empty') }}</p>
        <ol v-if="entries.length" class="run-trace__list">
            <li v-for="(e, i) in entries" :key="`${e.kind}-${i}`" class="run-trace__row" :data-test="`trace-${e.kind}`">
                <span class="ah-chip ah-chip--mono">{{ $t(e.kind === 'step' ? 'Ai.trace_kind_step' : 'Ai.trace_kind_tool') }}</span>
                <span class="ah-mono run-trace__name">{{ e.kind === 'step' ? e.node : e.action }}</span>
                <span v-if="statusOf(e)" class="ah-chip" :class="CHIP[statusOf(e)]" data-test="trace-status">{{ $t(`Ai.trace_status_${statusOf(e)}`) }}</span>
                <span v-if="decisionOf(e)" class="ah-chip" :class="CHIP[decisionOf(e)]" data-test="trace-decision">{{ $t(`Ai.trace_decision_${decisionOf(e)}`) }}</span>
                <span class="ah-small run-trace__metrics">
                    <span v-if="isNumber(e.durationMs)" data-test="trace-duration">{{ duration(e.durationMs) }}</span>
                    <span v-if="isNumber(e.tokens)" data-test="trace-tokens">{{ $t('Ai.trace_tokens', { n: e.tokens }) }}</span>
                    <span v-if="isNumber(e.costUsd)" data-test="trace-cost">{{ $t('Ai.trace_cost', { usd: Number(e.costUsd).toFixed(4) }) }}</span>
                </span>
            </li>
        </ol>
    </div>
</template>

<script setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import { replayAnchor } from "./replayAnchor";

defineOptions({ name: "AgentRunTrace" });

const props = defineProps({
    run: { type: Object, required: true },
    canViewReplay: { type: Boolean, default: false }
});
const emit = defineEmits(["view-replay"]);

const { t } = useI18n();
const $toast = useToast();

const CHIP = {
    ok: "ah-chip--ok", applied: "ah-chip--ok", act: "ah-chip--ok", approved: "ah-chip--ok",
    interrupted: "ah-chip--warn", pending: "ah-chip--warn", propose: "ah-chip--warn", edited: "ah-chip--warn",
    error: "ah-chip--danger", failed: "ah-chip--danger", refused: "ah-chip--danger", refuse: "ah-chip--danger", declined: "ah-chip--danger", undone: "ah-chip--danger"
};
const STATUSES = ["ok", "error", "interrupted", "pending", "applied", "failed", "refused"];
const DECISIONS = ["act", "propose", "refuse", "approved", "declined", "edited", "undone"];

const traceId = computed(() => props.run?.traceId || "");
const replayId = computed(() => props.run?.replayId || "");
const entries = computed(() => {
    if (Array.isArray(props.run?.trace)) return props.run.trace;
    const steps = Array.isArray(props.run?.steps) ? props.run.steps : [];
    return steps.map((s) => ({ kind: "step", node: s.node, status: s.status, at: s.startedAt, durationMs: s.durationMs, tokens: s.tokens, costUsd: s.costUsd }));
});
const hasSteps = computed(() => entries.value.some((e) => e.kind === "step"));

const isNumber = (v) => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v));
const statusOf = (e) => (STATUSES.includes(e.status) ? e.status : "");
const decisionOf = (e) => {
    const base = String(e.decision || "").split(":")[0];
    return DECISIONS.includes(base) ? base : "";
};
const duration = (ms) => (Number(ms) < 1000 ? t("Ai.trace_duration_ms", { n: Math.round(Number(ms)) }) : t("Ai.trace_duration_s", { n: (Number(ms) / 1000).toFixed(1) }));

const copy = async () => {
    try {
        await navigator.clipboard.writeText(traceId.value);
        $toast.success(t("Ai.trace_copied"), { position: "top-right" });
    } catch (e) {
        $toast.error(t("Ai.trace_copy_failed"), { position: "top-right" });
    }
};
</script>

<style>
.run-trace { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid var(--hairline); }
.run-trace__head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.run-trace__id { color: var(--ink-2); overflow-wrap: anywhere; }
.run-trace__empty { margin: 0; color: var(--ink-2); }
.run-trace__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.run-trace__row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font: var(--text-small); }
.run-trace__name { color: var(--ink); }
.run-trace__metrics { display: flex; gap: 10px; flex-wrap: wrap; color: var(--ink-2); margin-left: auto; }
</style>
