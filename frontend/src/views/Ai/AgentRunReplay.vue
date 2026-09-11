<template>
    <section :id="REPLAY_SECTION_ID" class="run-replay" data-test="replay">
        <span class="ah-label">{{ $t('Ai.replay_title') }}</span>
        <p class="ah-small run-replay__policy" data-test="replay-policy">{{ $t('Ai.replay_policy') }}</p>
        <div v-if="error" class="ah-field__error" data-test="replay-error">{{ error }}</div>
        <p v-else-if="loading" class="ah-empty">{{ $t('Ai.replay_loading') }}</p>
        <p v-else-if="!calls.length" class="ah-empty run-replay__empty" data-test="replay-none">{{ $t('Ai.replay_none') }}</p>
        <ol v-else class="run-replay__calls">
            <li v-for="(call, i) in calls" :id="call._id ? replayAnchorId(call._id) : undefined" :key="call._id || i" class="run-replay__call" data-test="replay-call">
                <button type="button" class="run-replay__row" :aria-expanded="String(open === i)" :aria-label="open === i ? $t('Ai.replay_hide') : $t('Ai.replay_show')" @click="toggle(i)">
                    <span class="ah-small">{{ $t('Ai.replay_call', { n: i + 1 }) }}</span>
                    <span class="ah-mono ah-small" data-test="replay-model">{{ call.model || $t('Ai.revision_value_empty') }}</span>
                    <span class="ah-small" data-test="replay-tokens">{{ $t('Ai.replay_tokens', tokensOf(call)) }}</span>
                    <span class="ah-small" data-test="replay-cost">{{ costOf(call) }}</span>
                    <span class="ah-small" data-test="replay-duration">{{ $t('Ai.replay_duration', { ms: Number(call.durationMs || 0) }) }}</span>
                    <span class="ah-chip" :class="call.status === 'error' ? 'ah-chip--danger' : 'ah-chip--ok'" data-test="replay-status">{{ $t(call.status === 'error' ? 'Ai.replay_status_error' : 'Ai.replay_status_ok') }}</span>
                </button>
                <div v-if="open === i" class="run-replay__body" data-test="replay-body">
                    <p v-if="call.errorCode" class="ah-small" data-test="replay-error-code">{{ $t('Ai.replay_error_code', { code: call.errorCode }) }}</p>
                    <p v-if="call.truncated" class="ah-small" data-test="replay-truncated">{{ $t('Ai.replay_truncated') }}</p>

                    <span class="ah-label">{{ $t('Ai.replay_system') }}</span>
                    <pre v-if="call.system" class="ah-mono run-replay__pre" data-test="replay-system">{{ call.system }}</pre>
                    <p v-else class="ah-empty">{{ $t('Ai.replay_system_empty') }}</p>

                    <span class="ah-label">{{ $t('Ai.replay_messages') }}</span>
                    <div v-for="(m, j) in messagesOf(call)" :key="j" class="run-replay__message" data-test="replay-message">
                        <span class="ah-mono ah-small">{{ m.role }}</span>
                        <pre class="ah-mono run-replay__pre">{{ m.content }}</pre>
                    </div>

                    <span class="ah-label">{{ $t('Ai.replay_passages') }}</span>
                    <ul v-if="passagesOf(call).length" class="run-replay__passages" data-test="replay-passages">
                        <li v-for="id in passagesOf(call)" :key="id" class="ah-mono ah-small">{{ id }}</li>
                    </ul>
                    <p v-else class="ah-empty" data-test="replay-passages-empty">{{ $t('Ai.replay_passages_empty') }}</p>

                    <span class="ah-label">{{ $t('Ai.replay_response') }}</span>
                    <pre v-if="call.response" class="ah-mono run-replay__pre" data-test="replay-response">{{ call.response }}</pre>
                    <p v-else class="ah-empty">{{ $t('Ai.replay_response_empty') }}</p>

                    <p v-if="call.promptHash" class="ah-mono ah-small run-replay__hash">{{ $t('Ai.replay_prompt_hash', { hash: call.promptHash }) }}</p>
                </div>
            </li>
        </ol>
    </section>
</template>

<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useAgents } from "./useAgents";
import { REPLAY_SECTION_ID, replayAnchorId, replayIdFromHash } from "./replayAnchor";

defineOptions({ name: "AgentRunReplay" });

const props = defineProps({
    runId: { type: String, required: true },
    replayId: { type: String, default: "" }
});

const { t } = useI18n();
const { loadRunReplay } = useAgents();

const calls = ref([]);
const loading = ref(false);
const error = ref("");
const open = ref(-1);

const tokensOf = (call) => ({ input: Number(call?.usage?.inputTokens || 0), output: Number(call?.usage?.outputTokens || 0) });
const costOf = (call) => (typeof call?.costUsd === "number" ? t("Ai.replay_cost", { usd: `$${call.costUsd.toFixed(4)}` }) : t("Ai.replay_cost_unpriced"));
const messagesOf = (call) => (Array.isArray(call?.messages) ? call.messages : []);
const passagesOf = (call) => (Array.isArray(call?.retrievedChunkIds) ? call.retrievedChunkIds : []);
const toggle = (i) => { open.value = open.value === i ? -1 : i; };

const wanted = ref("");

const reveal = async () => {
    if (!wanted.value || loading.value) return;
    const index = calls.value.findIndex((call) => String(call._id) === wanted.value);
    if (index < 0) return;
    const id = wanted.value;
    wanted.value = "";
    open.value = index;
    await nextTick();
    document.getElementById(replayAnchorId(id))?.scrollIntoView?.({ behavior: "smooth", block: "start" });
};

const focus = (id) => {
    wanted.value = String(id || "");
    return reveal();
};

const onHashChange = () => {
    const id = replayIdFromHash(window.location.hash);
    if (id) focus(id);
};

const load = async () => {
    error.value = "";
    open.value = -1;
    if (!props.replayId) {
        calls.value = [];
        return;
    }
    loading.value = true;
    try {
        calls.value = await loadRunReplay(props.runId);
    } catch (e) {
        error.value = e.message;
    } finally {
        loading.value = false;
    }
    await reveal();
};

onMounted(() => {
    wanted.value = replayIdFromHash(window.location.hash);
    window.addEventListener("hashchange", onHashChange);
    load();
});
onBeforeUnmount(() => window.removeEventListener("hashchange", onHashChange));
watch(() => [props.runId, props.replayId], load);

defineExpose({ focus });
</script>

<style>
.run-replay { margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--hairline); display: flex; flex-direction: column; gap: 6px; }
.run-replay__policy { margin: 0; color: var(--ink-2); }
.run-replay__empty { margin: 4px 0 0; }
.run-replay__calls { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.run-replay__call { border: 1px solid var(--hairline); border-radius: 7px; }
.run-replay__row { width: 100%; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 6px 10px; background: transparent; border: 0; color: var(--ink); text-align: left; cursor: pointer; font: inherit; }
.run-replay__body { display: flex; flex-direction: column; gap: 6px; padding: 8px 10px 10px; border-top: 1px solid var(--hairline); }
.run-replay__pre { margin: 0; max-height: 280px; overflow: auto; white-space: pre-wrap; word-break: break-word; padding: 8px; border-radius: 6px; background: var(--surface-3, var(--surface-2, transparent)); border: 1px solid var(--hairline); font-size: 12px; }
.run-replay__message { display: flex; flex-direction: column; gap: 2px; }
.run-replay__passages { margin: 0; padding-left: 18px; max-height: 160px; overflow: auto; }
.run-replay__hash { margin: 0; color: var(--ink-2); overflow-x: auto; }
</style>
