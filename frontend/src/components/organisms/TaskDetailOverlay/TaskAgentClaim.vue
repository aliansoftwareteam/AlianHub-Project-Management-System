<template>
    <div v-if="items.length || canHandOver || error" class="tac" data-test="task-agent-claim">
        <p v-for="item in items" :key="item.id" class="tac__line" data-test="claim-line" role="status">
            <span class="tac__text">{{ item.claim ? $t('ProjectManager.claimed_by', { name: item.claim.name }) : $t('ProjectManager.waiting_for_agent') }}</span>
            <span class="ah-chip">{{ $t(`ProjectManager.rule_${item.rule}`) }}</span>
            <button
                v-if="item.canTakeBack"
                type="button"
                class="ah-btn ah-btn--ghost ah-btn--sm"
                data-test="take-back"
                :disabled="busy"
                @click="takeBack(item)"
            >{{ $t('ProjectManager.take_back') }}</button>
        </p>
        <button
            v-if="canHandOver"
            type="button"
            class="ah-btn ah-btn--ghost ah-btn--sm tac__hand"
            data-test="hand-over"
            :disabled="busy"
            @click="handOver"
        >{{ $t('ProjectManager.hand_over') }}</button>
        <p v-if="error" class="tac__error" role="alert" data-test="claim-error">{{ error }}</p>
    </div>
</template>

<script setup>
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { apiRequest } from "@/services";
import * as env from "@/config/env";

defineOptions({ name: "TaskAgentClaim" });

const props = defineProps({
    taskId: { type: String, required: true }
});

const { t } = useI18n();
const items = ref([]);
const canHandOver = ref(false);
const busy = ref(false);
const error = ref("");
let asked = 0;

function take(data) {
    items.value = Array.isArray(data?.items) ? data.items : [];
    canHandOver.value = data?.canHandOver === true;
}

/* A task this person cannot open and a project that does not use the queue answer alike, with nothing to show. */
async function load(taskId) {
    asked += 1;
    const mine = asked;
    take(null);
    error.value = "";
    if (!taskId) return;
    try {
        const res = await apiRequest("get", `${env.AGENT_WORK_QUEUE}/task/${encodeURIComponent(taskId)}`);
        if (mine === asked) take(res?.data?.status ? res.data.data : null);
    } catch (e) {
        if (mine === asked) take(null);
    }
}

async function send(path, fallback) {
    busy.value = true;
    error.value = "";
    const mine = asked;
    try {
        const res = await apiRequest("post", path, {});
        if (res?.data?.status !== true) throw new Error(res?.data?.statusText || t(fallback));
        if (mine === asked) take(res.data.data);
    } catch (e) {
        if (mine === asked) error.value = e?.response?.data?.statusText || e?.message || t(fallback);
    } finally {
        busy.value = false;
    }
}

const takeBack = (item) => send(`${env.AGENT_WORK_QUEUE}/${encodeURIComponent(item.id)}/take-back`, "ProjectManager.take_back_failed");
const handOver = () => send(`${env.AGENT_WORK_QUEUE}/task/${encodeURIComponent(props.taskId)}/hand-over`, "ProjectManager.hand_over_failed");

watch(() => props.taskId, load, { immediate: true });
</script>

<style scoped>
.tac { display: flex; flex: none; flex-direction: column; align-items: flex-start; gap: 4px; min-width: 0; padding: 6px var(--page-pad-x, 18px); border-bottom: 1px solid var(--hairline); background: var(--surface); }
.tac__line { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin: 0; min-width: 0; color: var(--ink-2); font: 400 12px/1.4 var(--font-ui); }
.tac__text { min-width: 0; overflow-wrap: anywhere; }
.tac__error { margin: 0; color: var(--danger); font-size: 12px; overflow-wrap: anywhere; }
</style>
