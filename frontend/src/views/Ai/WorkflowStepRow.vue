<template>
    <div class="wf-step" :class="[`wf-step--${status}`, { 'wf-step--child': child }]" :data-step="step.stepId" :data-status="status" data-test="step">
        <span class="ah-dot" :class="dotClass"></span>
        <span class="ah-mono wf-step__id" data-test="step-id">{{ step.stepId }}</span>
        <span class="ah-chip ah-chip--dark wf-step__type" data-test="step-type">{{ $t(`Workflows.type_${type}`) }}</span>
        <span class="ah-chip wf-step__status" :class="chipClass" data-test="step-status">{{ $t(`Workflows.status_${status}`) }}</span>
        <span class="ah-small wf-step__duration" data-test="step-duration">{{ durationLabel }}</span>
        <span class="ah-mono ah-small wf-step__cost" data-test="step-cost">{{ costLabel }}</span>
        <span class="wf-step__spacer"></span>
        <slot />
    </div>
</template>

<script setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { durationMsOf, stepCostOf, stepStatusOf, stepTypeOf } from "./workflowRun";

defineOptions({ name: "WorkflowStepRow" });

const props = defineProps({
    step: { type: Object, required: true },
    child: { type: Boolean, default: false }
});

const { t } = useI18n();

const status = computed(() => stepStatusOf(props.step));
const type = computed(() => stepTypeOf(props.step));

const CHIPS = { success: "ah-chip--ok", failed: "ah-chip--danger", running: "ah-chip--brand", pending: "ah-chip--warn", skipped: "ah-chip--dark", stopped: "ah-chip--dark" };
const DOTS = { success: "ah-dot--ok", failed: "ah-dot--danger", running: "ah-dot--ok", pending: "ah-dot--warn" };

const chipClass = computed(() => CHIPS[status.value] || "ah-chip--dark");
const dotClass = computed(() => DOTS[status.value] || "");

const durationLabel = computed(() => {
    const ms = durationMsOf(props.step);
    if (ms === null) return t("Workflows.duration_unstarted");
    if (ms < 1000) return t("Workflows.duration_ms", { n: Math.round(ms) });
    if (ms < 60000) return t("Workflows.duration_s", { n: (ms / 1000).toFixed(1) });
    return t("Workflows.duration_m", { n: (ms / 60000).toFixed(1) });
});

const costLabel = computed(() => {
    const usd = stepCostOf(props.step);
    return usd > 0 ? t("Workflows.cost_usd", { usd: usd.toFixed(2) }) : t("Workflows.cost_none");
});
</script>
