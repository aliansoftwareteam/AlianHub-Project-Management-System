<template>
    <div v-if="failure" class="wf-failure" data-test="failure">
        <div class="wf-failure__head">
            <span class="ah-label">{{ $t('Workflows.failure_title') }}</span>
            <span class="ah-chip" :class="failure.deterministic ? 'ah-chip--danger' : 'ah-chip--warn'" data-test="failure-kind">
                {{ $t(failure.deterministic ? 'Workflows.failure_deterministic' : 'Workflows.failure_transient') }}
            </span>
            <span v-if="failure.code" class="ah-mono ah-small" data-test="failure-code">{{ failure.code }}</span>
        </div>

        <p class="wf-failure__message" data-test="failure-message">{{ failure.message || $t('Workflows.failure_no_message') }}</p>

        <p class="ah-small wf-failure__why" data-test="failure-why">
            {{ $t(failure.deterministic ? 'Workflows.failure_deterministic_why' : 'Workflows.failure_transient_why') }}
        </p>

        <dl class="wf-failure__meta">
            <dt>{{ $t('Workflows.failure_attempts') }}</dt>
            <dd data-test="failure-attempts">{{ $t('Workflows.failure_attempts_of', { n: failure.attempts, max: failure.maxAttempts }) }}</dd>
            <template v-if="failure.backoff">
                <dt>{{ $t('Workflows.failure_backoff') }}</dt>
                <dd data-test="failure-backoff">{{ backoffLabel }}</dd>
            </template>
        </dl>

        <div v-if="canManage" class="ai-actions wf-failure__actions">
            <button
                v-if="failure.control"
                type="button"
                class="ah-btn ah-btn--sm"
                :class="failure.control === 'skip' ? 'ah-btn--secondary' : 'ah-btn--primary'"
                :disabled="busy"
                :data-test="`control-${failure.control}`"
                @click="$emit('control', failure.control)"
            >{{ $t(`Workflows.control_${failure.control}`) }}</button>
            <button
                v-if="failure.compensable"
                type="button"
                class="ah-btn ah-btn--danger ah-btn--sm"
                :disabled="busy"
                data-test="control-compensate"
                @click="$emit('control', 'compensate')"
            >{{ $t('Workflows.control_compensate') }}</button>
            <span class="ah-small wf-failure__hint" data-test="control-hint">{{ $t(`Workflows.control_hint_${failure.control || 'none'}`) }}</span>
        </div>
        <p v-else class="ah-small" data-test="read-only">{{ $t('Workflows.read_only') }}</p>
    </div>
</template>

<script setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { failureOf } from "./workflowRun";

defineOptions({ name: "WorkflowFailedStep" });

const props = defineProps({
    step: { type: Object, required: true },
    canManage: { type: Boolean, default: false },
    busy: { type: Boolean, default: false }
});

defineEmits(["control"]);

const { t } = useI18n();

const failure = computed(() => failureOf(props.step));

const backoffLabel = computed(() => {
    const { ms, at } = failure.value.backoff;
    const seconds = Math.round(ms / 1000);
    const wait = seconds >= 60 ? t("Workflows.backoff_m", { n: (seconds / 60).toFixed(1) }) : t("Workflows.backoff_s", { n: seconds });
    return at ? t("Workflows.backoff_at", { wait, at: new Date(at).toLocaleString() }) : wait;
});
</script>
