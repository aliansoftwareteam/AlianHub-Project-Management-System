<template>
    <div class="run-detail">
        <div v-if="error" class="ah-field__error">{{ error }}</div>
        <div v-else-if="!run" class="ah-empty">{{ $t('Ai.loading') }}</div>
        <template v-else>
            <p v-if="unreached" class="ah-small run-detail__waiting" data-test="episode-not-reached">{{ $t('Ai.episode_not_reached') }}</p>
            <div v-else-if="episode" class="run-episode" data-test="episode">
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

            <div v-if="failure" class="run-failure" data-test="failure">
                <span class="ah-label">{{ $t('Ai.failure_title') }}</span>
                <span class="ah-chip ah-chip--danger" data-test="failure-type">{{ $t(`Ai.failure_type_${failure.type}`) }}</span>
                <dl class="run-failure__meta">
                    <template v-if="failure.code">
                        <dt>{{ $t('Ai.failure_code') }}</dt>
                        <dd class="ah-mono" data-test="failure-code">{{ failure.code }}</dd>
                    </template>
                    <template v-if="failure.provider">
                        <dt>{{ $t('Ai.failure_provider') }}</dt>
                        <dd data-test="failure-provider">
                            <span>{{ failure.provider }}</span>
                            <span v-if="failure.model" class="ah-mono" data-test="failure-model">{{ failure.model }}</span>
                        </dd>
                    </template>
                    <template v-if="failure.requestId">
                        <dt>{{ $t('Ai.failure_request_id') }}</dt>
                        <dd>
                            <span class="ah-mono" data-test="failure-request-id">{{ failure.requestId }}</span>
                            <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" data-test="copy-request-id" :title="$t('Ai.failure_copy_request_id')" :aria-label="$t('Ai.failure_copy_request_id')" @click="copyRequestId">{{ $t('Ai.failure_copy_request_id') }}</button>
                        </dd>
                    </template>
                </dl>
            </div>

            <div class="run-detail__pin" data-test="pinned-revision">
                <span class="ah-label">{{ $t('Ai.run_pinned_title') }}</span>
                <router-link v-if="pinnedN > 0" class="ah-chip ah-chip--brand run-detail__revision" :to="revisionLink" data-test="revision-link">{{ $t('Ai.run_revision', { n: pinnedN }) }}</router-link>
                <span v-else class="ah-chip ah-chip--dark" data-test="revision-zero">{{ $t('Ai.run_revision_zero') }}</span>
                <span v-if="skillIdentity" class="ah-mono ah-small" data-test="skill-identity">{{ skillIdentity }}</span>
            </div>

            <AgentRunTrace :run="run" />

            <div class="run-detail__head">
                <span class="ah-label">{{ $t('Ai.decisions_title') }}</span>
                <span v-if="run.revertedAt" class="ah-chip ah-chip--dark">{{ $t('Ai.reverted_at', { at: when(run.revertedAt) }) }}</span>
                <span v-else-if="deadline" class="ah-small" data-test="undo-deadline">{{ windowOpen ? $t('Ai.undo_until', { at: when(deadline) }) : $t('Ai.undo_window_closed_at', { at: when(deadline) }) }}</span>
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

            <div v-if="control !== 'hidden'" class="ai-actions run-detail__actions">
                <button type="button" class="ah-btn ah-btn--danger ah-btn--sm" :disabled="busy || control === 'closed'" :title="control === 'closed' ? $t('Ai.undo_window_passed') : ''" @click="revert">{{ busy ? $t('Ai.reverting') : $t('Ai.revert_run') }}</button>
                <span v-if="control === 'closed'" class="ah-small" data-test="undo-reason">{{ $t('Ai.undo_window_passed') }}</span>
            </div>

            <AgentRunReplay v-if="privileged" :run-id="runId" :replay-id="run.replayId || ''" />
        </template>
    </div>
</template>

<script setup>
import { computed, inject, onMounted, ref } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import { useAgents, revertControlState, undoDeadlineOf, pinnedRevisionOf } from "./useAgents";
import { normaliseEpisode, declinedLine as declinedText } from "./episodeText";
import AgentRunReplay from "./AgentRunReplay.vue";
import AgentRunTrace from "./AgentRunTrace.vue";

defineOptions({ name: "AgentRunDetail" });

const props = defineProps({ runId: { type: String, required: true } });
const emit = defineEmits(["reverted"]);

const { t } = useI18n();
const $toast = useToast();
const { getters } = useStore();
const userId = inject("$userId", null);
const companyId = inject("$companyId", null);
const { loadRun, revertRun } = useAgents();

const run = ref(null);
const error = ref("");
const busy = ref(false);
const result = ref(null);

const pinnedN = computed(() => pinnedRevisionOf(run.value));
const revisionLink = computed(() => ({ name: "AiAgent", params: { cid: companyId?.value ?? companyId, id: String(run.value?.agentId || "") }, query: { rev: pinnedN.value }, hash: "#revisions" }));
const skillIdentity = computed(() => {
    const s = run.value?.skillRevision;
    if (!s || !s.key) return run.value?.skill ? t("Ai.run_skill_identity_nohash", { key: run.value.skill }) : "";
    if (Number.isInteger(s.n) && s.n > 0) return t("Ai.run_skill_identity_n", { key: s.key, n: s.n });
    return s.hash ? t("Ai.run_skill_identity", { key: s.key, hash: s.hash }) : t("Ai.run_skill_identity_nohash", { key: s.key });
});

const privileged = computed(() => [1, 2].includes(Number(getters["settings/companyUserDetail"]?.roleType)));
const decisions = computed(() => (Array.isArray(run.value?.decisions) ? run.value.decisions : []));
const deadline = computed(() => undoDeadlineOf(run.value));
const windowOpen = computed(() => !deadline.value || new Date(deadline.value).getTime() > Date.now());
const control = computed(() => revertControlState(run.value, { userId: userId?.value ?? userId, privileged: privileged.value }));

const UNREACHED = ["failed", "skipped", "stopped"];
const unreached = computed(() => UNREACHED.includes(run.value?.status));
const episode = computed(() => (unreached.value ? null : normaliseEpisode(run.value?.episode)));
const declinedLine = computed(() => (episode.value ? declinedText(episode.value, t) : ""));

const FAILURE_TYPES = ["rate_limit", "quota", "auth", "permission", "invalid_request", "context_length", "content_filter", "not_found", "overloaded", "server", "timeout", "network", "unknown"];
const failure = computed(() => {
    const f = run.value?.failure;
    if (!f || typeof f !== "object") return null;
    return { ...f, type: FAILURE_TYPES.includes(f.type) ? f.type : "unknown" };
});

const copyRequestId = async () => {
    try {
        await navigator.clipboard.writeText(failure.value.requestId);
        $toast.success(t("Ai.failure_request_id_copied"), { position: "top-right" });
    } catch (e) {
        $toast.error(e.message, { position: "top-right" });
    }
};

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
.run-failure { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid var(--hairline); }
.run-failure__meta { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 0; font: var(--text-small); }
.run-failure__meta dt { color: var(--ink-2); }
.run-failure__meta dd { margin: 0; color: var(--ink); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.run-detail__pin { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
.run-detail__revision { text-decoration: none; }
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
.run-detail__actions { margin-top: 10px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
</style>
