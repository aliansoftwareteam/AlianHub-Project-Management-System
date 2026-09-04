<template>
    <section class="ah-card">
        <div class="ah-card__head">
            <span class="ah-h3">{{ $t('Parity.outcomes_title') }}</span>
            <span class="parity-count">{{ $t('Parity.n_runs', { n: runs.length }) }}</span>
        </div>

        <div class="outcome">
            <div class="outcome__head">
                <span class="outcome__tag">{{ $t('Parity.declined_tag') }}</span>
                <span class="outcome__title">{{ $t('Parity.declined_title') }}</span>
            </div>
            <div v-for="(item, i) in declines" :key="`d${i}`" class="outcome__quote">
                <span class="ah-avatar ah-avatar--agent"><ShellIcon name="agent" :size="13" /></span>
                <span><strong>{{ item.agentName }}:</strong> {{ item.reason }}</span>
            </div>
            <div v-for="run in failed" :key="run._id" class="outcome__quote">
                <span class="ah-avatar ah-avatar--agent"><ShellIcon name="agent" :size="13" /></span>
                <span><strong>{{ run.agentName }}:</strong> {{ run.error || run.outcome || $t('Parity.failed_generic') }}</span>
            </div>
            <p v-if="!declines.length && !failed.length" class="ah-empty">{{ $t('Parity.no_declines') }}</p>
            <p class="outcome__rule">{{ $t('Parity.declined_rule') }}</p>
        </div>

        <div class="outcome">
            <div class="outcome__head">
                <span class="outcome__tag outcome__tag--warn">{{ $t('Parity.handback_tag') }}</span>
                <span class="outcome__title">{{ $t('Parity.handback_title') }}</span>
            </div>
            <p v-if="!handedBack.length" class="ah-empty">{{ $t('Parity.no_handbacks') }}</p>
            <div v-for="run in handedBack" :key="run._id" class="outcome__quote">
                <span class="ah-avatar ah-avatar--agent"><ShellIcon name="agent" :size="13" /></span>
                <span><strong>{{ run.agentName }}:</strong> {{ run.outcome || $t('Parity.handback_generic') }}</span>
            </div>
            <p class="outcome__rule">{{ $t('Parity.handback_rule') }}</p>
        </div>

        <div class="outcome">
            <div class="outcome__head">
                <span class="outcome__tag outcome__tag--danger">{{ $t('Parity.stop_tag') }}</span>
                <span class="outcome__title">{{ $t('Parity.stop_title') }}</span>
            </div>
            <p v-if="!open.length" class="ah-empty">{{ $t('Parity.no_open_runs') }}</p>
            <div v-for="run in open" :key="run._id" class="outcome__run">
                <span class="outcome__run-body">
                    <strong>{{ run.agentName }}</strong>
                    <span class="ah-mono"> · {{ minutes(run) }} · {{ money(run) }}{{ capOf(run) }}</span>
                    <span v-if="run.skill"> · {{ run.skill }}</span>
                </span>
                <button type="button" class="ah-btn ah-btn--danger ah-btn--sm" :disabled="stopping === run._id" @click="$emit('stop', run)">
                    {{ stopping === run._id ? $t('Parity.stopping') : $t('Parity.stop') }}
                </button>
            </div>
            <p class="outcome__rule">{{ $t('Parity.stop_rule') }}</p>
        </div>

        <div class="outcome">
            <p class="outcome__law"><strong>{{ $t('Parity.law_label') }}</strong> {{ $t('Parity.law_body') }}</p>
        </div>
    </section>
</template>

<script setup>
import { computed } from "vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";

// The three ways an assignment ends badly (30c), read off the real run list:
// declined before starting, handed back partway, or going wrong and stopped.
defineOptions({ name: "AgentOutcomes" });

const props = defineProps({
    runs: { type: Array, default: () => [] },
    agents: { type: Array, default: () => [] },
    declines: { type: Array, default: () => [] },
    stopping: { type: String, default: "" }
});

defineEmits(["stop"]);

const OPEN = ["queued", "running", "waiting_approval"];

const failed = computed(() => props.runs.filter((r) => r.status === "failed").slice(0, 3));
const handedBack = computed(() => props.runs.filter((r) => r.status === "waiting_approval" || (r.status === "done" && r.outcome)).slice(0, 3));
const open = computed(() => props.runs.filter((r) => OPEN.includes(r.status)));

const minutes = (run) => {
    const ms = run.elapsedMs || (run.startedAt ? Date.now() - new Date(run.startedAt).getTime() : 0);
    return `${Math.max(0, Math.round(ms / 60000))} min`;
};
const money = (run) => `$${Number((run.spend && run.spend.usd) || 0).toFixed(2)}`;
const capOf = (run) => {
    const agent = props.agents.find((a) => String(a._id) === String(run.agentId));
    return agent && Number(agent.spendCapUsd) > 0 ? ` / $${Number(agent.spendCapUsd).toFixed(0)}` : "";
};
</script>

<style>
@import "./parity.css";
</style>
