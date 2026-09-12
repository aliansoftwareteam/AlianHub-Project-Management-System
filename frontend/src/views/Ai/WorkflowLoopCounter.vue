<template>
    <div v-if="loop" class="wf-loop" data-test="loop">
        <div class="wf-loop__head">
            <span class="ah-label">{{ $t('Workflows.loop_title') }}</span>
            <span class="ah-chip" :class="loop.running ? 'ah-chip--brand' : 'ah-chip--dark'" data-test="loop-state">
                {{ $t(loop.running ? 'Workflows.loop_running' : 'Workflows.loop_stopped') }}
            </span>
        </div>

        <div class="wf-loop__meter" data-test="loop-iterations">
            <span class="ah-small">{{ iterationsLabel }}</span>
            <progress v-if="loop.cap" class="wf-loop__bar" :max="loop.cap" :value="Math.min(loop.iterations, loop.cap)" :aria-label="$t('Workflows.loop_iterations_label')"></progress>
        </div>

        <div class="wf-loop__meter" data-test="loop-budget">
            <span class="ah-small ah-mono">{{ budgetLabel }}</span>
            <progress v-if="loop.budgetUsd" class="wf-loop__bar" :max="loop.budgetUsd" :value="Math.min(loop.budgetUsedUsd, loop.budgetUsd)" :aria-label="$t('Workflows.loop_budget_label')"></progress>
        </div>

        <p v-if="loop.stoppedBy" class="ah-small wf-loop__stopped" data-test="loop-stopped-by">{{ stoppedLabel }}</p>

        <button
            v-if="canManage && loop.stoppable"
            type="button"
            class="ah-btn ah-btn--secondary ah-btn--sm"
            :disabled="busy"
            data-test="loop-stop"
            @click="$emit('stop')"
        >{{ $t('Workflows.loop_stop') }}</button>
    </div>
</template>

<script setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { loopStateOf } from "./workflowRun";

defineOptions({ name: "WorkflowLoopCounter" });

const props = defineProps({
    step: { type: Object, required: true },
    canManage: { type: Boolean, default: false },
    busy: { type: Boolean, default: false }
});

defineEmits(["stop"]);

const { t } = useI18n();

const loop = computed(() => loopStateOf(props.step));

const iterationsLabel = computed(() => (loop.value.cap
    ? t("Workflows.loop_iterations", { n: loop.value.iterations, max: loop.value.cap })
    : t("Workflows.loop_iterations_uncapped", { n: loop.value.iterations })));

const budgetLabel = computed(() => (loop.value.budgetUsd
    ? t("Workflows.loop_budget", { used: loop.value.budgetUsedUsd.toFixed(2), cap: loop.value.budgetUsd.toFixed(2) })
    : t("Workflows.loop_budget_uncapped", { used: loop.value.budgetUsedUsd.toFixed(2) })));

/* The hourly run limit is the one stop that names something outside the loop:
 * which agent ran out of its allowance, and when the hour lets it start again. */
const stoppedLabel = computed(() => {
    const limit = loop.value.runLimit;
    if (loop.value.stoppedBy === "run_limit" && limit) {
        return t("Workflows.loop_stopped_run_limit_detail", {
            used: Number(limit.used) || 0,
            limit: Number(limit.limit) || 0,
            at: limit.resetsAt ? new Date(limit.resetsAt).toLocaleString() : ""
        });
    }
    return t(`Workflows.loop_stopped_${loop.value.stoppedBy}`);
});
</script>
