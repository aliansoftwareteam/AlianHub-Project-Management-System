<template>
    <div class="run-detail">
        <div v-if="error" class="ah-field__error">{{ error }}</div>
        <div v-else-if="!run" class="ah-empty">{{ $t('Ai.loading') }}</div>
        <template v-else>
            <div v-if="episode" class="run-episode" data-test="episode">
                <span class="ah-label">{{ $t('Ai.episode_title') }}</span>
                <ul class="run-episode__stats">
                    <li>{{ $t('Ai.episode_proposed', { n: episode.proposed }) }}</li>
                    <li>{{ $t('Ai.episode_acted', { n: episode.acted }) }}</li>
                    <li>{{ $t('Ai.episode_approved', { n: episode.approved }) }}</li>
                    <li data-test="episode-declined">{{ declinedLine }}</li>
                    <li data-test="episode-reverted">{{ $t(episode.reverted ? 'Ai.episode_reverted_yes' : 'Ai.episode_reverted_no') }}</li>
                </ul>
            </div>
            <p v-if="run.status === 'waiting_approval'" class="ah-small run-detail__waiting" data-test="waiting">{{ $t('Ai.episode_waiting') }}</p>

            <div class="run-detail__head">
                <span class="ah-label">{{ $t('Ai.decisions_title') }}</span>
                <span v-if="run.revertedAt" class="ah-chip ah-chip--dark">{{ $t('Ai.reverted_at', { at: when(run.revertedAt) }) }}</span>
                <span v-else-if="run.windowEndsAt" class="ah-small">{{ windowOpen ? $t('Ai.revert_window_until', { at: when(run.windowEndsAt) }) : $t('Ai.revert_window_closed') }}</span>
            </div>

            <p v-if="!decisions.length" class="ah-empty run-detail__empty">{{ $t('Ai.no_decisions') }}</p>
            <ul v-else class="run-decisions">
                <li v-for="(d, i) in decisions" :key="`${d.action}-${i}`" class="run-decisions__row">
                    <span class="ah-mono run-decisions__action">{{ d.action }}</span>
                    <span class="ah-chip" :class="chip(d.decision)">{{ $t(`Ai.decision_${d.decision}`) }}</span>
                    <span class="ah-small run-decisions__reason">{{ d.reason }}</span>
                </li>
            </ul>

            <div v-if="result" class="run-detail__result">
                <span>{{ $t('Ai.reverted_n', { n: result.reverted }) }}</span>
                <template v-if="result.failed.length">
                    <span>{{ $t('Ai.revert_partial', { n: result.failed.length }) }}</span>
                    <ul class="run-detail__failed">
                        <li v-for="f in result.failed" :key="f.action"><span class="ah-mono">{{ f.action }}</span> · {{ f.reason }}</li>
                    </ul>
                </template>
            </div>

            <div v-if="revertable" class="ai-actions run-detail__actions">
                <button type="button" class="ah-btn ah-btn--danger ah-btn--sm" :disabled="busy" @click="revert">{{ busy ? $t('Ai.reverting') : $t('Ai.revert_run') }}</button>
            </div>
        </template>
    </div>
</template>

<script setup>
import { computed, inject, onMounted, ref } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import { useAgents, canRevertRun } from "./useAgents";

defineOptions({ name: "AgentRunDetail" });

const props = defineProps({ runId: { type: String, required: true } });
const emit = defineEmits(["reverted"]);

const { t } = useI18n();
const $toast = useToast();
const { getters } = useStore();
const userId = inject("$userId", null);
const { loadRun, revertRun } = useAgents();

const run = ref(null);
const error = ref("");
const busy = ref(false);
const result = ref(null);

const privileged = computed(() => [1, 2].includes(Number(getters["settings/companyUserDetail"]?.roleType)));
const decisions = computed(() => (Array.isArray(run.value?.decisions) ? run.value.decisions : []));
const windowOpen = computed(() => !run.value?.windowEndsAt || new Date(run.value.windowEndsAt).getTime() > Date.now());
const revertable = computed(() => canRevertRun(run.value, { userId: userId?.value ?? userId, privileged: privileged.value }));

const DECLINE_REASONS = ["too_many_changes", "wrong_tone", "needs_person", "not_now"];
const count = (v) => Number(v || 0);
const episode = computed(() => {
    const e = run.value?.episode;
    if (!e || typeof e !== "object") return null;
    return { proposed: count(e.proposed), acted: count(e.acted), approved: count(e.approved), declined: count(e.declined), reverted: Boolean(e.reverted), reason: e.reason || e.declinedReason || "" };
});
const declinedLine = computed(() => {
    const e = episode.value;
    if (!e) return "";
    if (!e.reason) return t("Ai.episode_declined", { n: e.declined });
    const reason = DECLINE_REASONS.includes(e.reason) ? t(`Ai.decline_reason_${e.reason}`) : e.reason;
    return t("Ai.episode_declined_reason", { n: e.declined, reason });
});

const when = (at) => (at ? new Date(at).toLocaleString() : "");
const chip = (decision) => (decision === "act" ? "ah-chip--ok" : decision === "refuse" ? "ah-chip--danger" : "ah-chip--warn");

const load = async () => {
    error.value = "";
    try {
        run.value = await loadRun(props.runId);
    } catch (e) {
        error.value = e.message;
    }
};

const revert = async () => {
    busy.value = true;
    try {
        const out = await revertRun(props.runId);
        result.value = { reverted: Number(out?.reverted || 0), failed: Array.isArray(out?.failed) ? out.failed : [] };
        $toast.success(t("Ai.reverted_n", { n: result.value.reverted }), { position: "top-right" });
        await load();
        emit("reverted", result.value);
    } catch (e) {
        $toast.error(e.message, { position: "top-right" });
    } finally {
        busy.value = false;
    }
};

onMounted(load);
</script>

<style>
.run-detail { margin: 8px 0 4px 0; padding: 10px 12px; border: 1px solid var(--hairline); border-radius: 9px; background: var(--surface-2, transparent); }
.run-detail__head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.run-episode { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid var(--hairline); }
.run-episode__stats { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px 14px; font: var(--text-small); color: var(--ink); }
.run-detail__waiting { margin: 0 0 10px; }
.run-detail__empty { margin: 8px 0 0; }
.run-decisions { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.run-decisions__row { display: flex; align-items: center; gap: 10px; font: var(--text-small); flex-wrap: wrap; }
.run-decisions__action { color: var(--ink); }
.run-decisions__reason { color: var(--ink-2); flex: 1; min-width: 160px; }
.run-detail__result { margin-top: 10px; font: var(--text-small); color: var(--ink-2); display: flex; flex-direction: column; gap: 4px; }
.run-detail__failed { margin: 0; padding-left: 18px; }
.run-detail__actions { margin-top: 10px; }
</style>
