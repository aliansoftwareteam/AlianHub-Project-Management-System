<template>
    <section class="ask-plan" :aria-busy="turn.status === 'planning'" data-test="ask-plan">
        <p v-if="turn.status === 'planning'" class="ah-small" role="status" data-test="ask-plan-working">{{ $t('Ask.plan_working') }}</p>

        <template v-else-if="turn.status === 'planned'">
            <p class="ask-plan__summary" data-test="ask-plan-summary">{{ turn.plan.summary }}</p>
            <IntentPreview v-for="(preview, i) in turn.plan.changes" :key="i" :preview="preview" :disabled="turn.plan.busy" />
            <ul v-if="turn.plan.cannot.length" class="ask-plan__cannot" data-test="ask-plan-cannot">
                <li v-for="(item, i) in turn.plan.cannot" :key="i">{{ $t('Ask.plan_cannot_item', { text: item.text, reason: item.reason }) }}</li>
            </ul>

            <p v-if="turn.plan.decision === 'pending'" class="ah-small">{{ $t('Ask.plan_waits') }}</p>
            <p v-else-if="turn.plan.decision === 'approved'" class="ah-small" role="status" data-test="ask-plan-approved">{{ $t('Ask.plan_approved') }}</p>
            <p v-else class="ah-small" role="status" data-test="ask-plan-declined">{{ $t('Ask.plan_declined') }}</p>
            <p v-if="turn.plan.error" class="ah-field__error" role="alert" data-test="ask-plan-error">{{ turn.plan.error }}</p>

            <div v-if="turn.plan.decision === 'pending'" class="ask-plan__actions">
                <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="turn.plan.busy" data-test="ask-plan-approve" @click="$emit('decide', 'approve')">
                    {{ turn.plan.busy ? $t('Ask.plan_working_on_it') : $t('Ask.plan_approve') }}
                </button>
                <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="turn.plan.busy" data-test="ask-plan-decline" @click="$emit('decide', 'decline')">{{ $t('Ask.plan_decline') }}</button>
            </div>
        </template>

        <template v-else-if="turn.status === 'plan_none'">
            <p class="ah-empty" data-test="ask-plan-none">
                {{ turn.error }}
                <ConnectAiHint v-if="turn.needsAi" />
            </p>
            <ul v-if="turn.cannot.length" class="ask-plan__cannot" data-test="ask-plan-cannot">
                <li v-for="(item, i) in turn.cannot" :key="i">{{ $t('Ask.plan_cannot_item', { text: item.text, reason: item.reason }) }}</li>
            </ul>
        </template>

        <p v-else-if="turn.status === 'plan_error'" class="ah-field__error" role="alert" data-test="ask-plan-failed">{{ turn.error }}</p>
    </section>
</template>

<script setup>
import IntentPreview from "@/components/molecules/IntentPreview/IntentPreview.vue";
import ConnectAiHint from "@/components/molecules/AiUnavailable/ConnectAiHint.vue";

defineOptions({ name: "AskPlanCard" });

defineProps({ turn: { type: Object, required: true } });
defineEmits(["decide"]);
</script>

<style scoped>
.ask-plan { display: flex; flex-direction: column; gap: var(--sp-3); margin-top: var(--sp-2); }
.ask-plan__summary { margin: 0; color: var(--ink); font-weight: 500; }
.ask-plan__cannot { margin: 0; padding-left: var(--sp-4); color: var(--ink-2); font: var(--text-small); }
.ask-plan__actions { display: flex; flex-wrap: wrap; gap: var(--sp-2); }
</style>
