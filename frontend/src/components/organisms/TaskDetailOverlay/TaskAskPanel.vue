<template>
    <section class="task-ask" :aria-label="$t('TaskAi.ask')" @keydown.esc.stop.prevent="$emit('close')">
        <form class="task-ask__form" data-test="task-ask-form" @submit.prevent="submit">
            <input
                ref="input"
                v-model="question"
                class="ah-input task-ask__input"
                data-test="task-ask-input"
                type="text"
                maxlength="500"
                :aria-label="$t('TaskAi.ask_label')"
                :placeholder="$t('TaskAi.ask_placeholder')"
            />
            <div class="task-ask__actions">
                <button type="submit" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="busy">{{ $t('TaskAi.ask_submit') }}</button>
                <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" @click="$emit('close')">{{ $t('TaskAi.ask_close') }}</button>
            </div>
        </form>
        <p class="task-ask__scope">{{ $t('TaskAi.ask_scope') }}</p>
        <div aria-live="polite">
            <p v-if="busy" class="task-ask__status">{{ $t('TaskAi.asking') }}</p>
            <p v-else-if="answer" class="task-ask__answer" data-test="task-ask-answer">{{ answer }}</p>
        </div>
        <div v-if="!busy && cited.length" class="task-ask__sources">
            <span class="task-ask__sources-label">{{ $t('TaskAi.ask_sources') }}</span>
            <span v-for="source in cited" :key="`${source.kind}-${source.ref}`" class="ah-chip task-ask__source">{{ source.title }}</span>
        </div>
        <p v-if="error" class="task-ask__error" role="alert">{{ error }}</p>
    </section>
</template>

<script setup>
import { nextTick, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { aiErrorKey, payloadOf } from "./aiErrors";

defineOptions({ name: "TaskAskPanel" });

const props = defineProps({
    taskId: { type: String, required: true }
});
defineEmits(["close"]);

const { t } = useI18n();
const input = ref(null);
const question = ref("");
const answer = ref("");
const cited = ref([]);
const busy = ref(false);
const error = ref("");

async function submit() {
    const text = question.value.trim();
    if (!text) {
        error.value = t("TaskAi.ask_empty");
        return;
    }
    busy.value = true;
    error.value = "";
    answer.value = "";
    cited.value = [];
    try {
        const response = await apiRequest("post", env.AI_ASK, { question: text, taskId: props.taskId });
        const payload = response?.data || {};
        if (payload.status !== true) error.value = t(aiErrorKey(payload));
        else if (payload.data?.configured === false) error.value = t("TaskAi.unconfigured");
        else {
            answer.value = payload.data?.answer || "";
            cited.value = payload.data?.cited || [];
            if (!answer.value) error.value = t("TaskAi.failed");
        }
    } catch (err) {
        error.value = t(aiErrorKey(payloadOf(err)));
    } finally {
        busy.value = false;
    }
}

onMounted(() => nextTick(() => input.value && input.value.focus()));
</script>

<style scoped>
.task-ask {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px;
    border: 1px solid var(--hairline);
    border-radius: 9px;
    background: var(--surface-2);
    color: var(--ink);
    min-width: 0;
}
.task-ask__form { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.task-ask__input { flex: 1 1 220px; min-width: 0; height: 32px; }
.task-ask__actions { display: flex; gap: 6px; }
.task-ask__scope,
.task-ask__status { margin: 0; font: 400 12px/1.4 var(--font-ui); color: var(--ink-2); }
.task-ask__answer { margin: 0; font: 400 13px/1.55 var(--font-ui); color: var(--ink); white-space: pre-wrap; overflow-wrap: anywhere; }
.task-ask__sources { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.task-ask__sources-label { font: 500 11.5px/1.3 var(--font-ui); color: var(--ink-2); }
.task-ask__source { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.task-ask__error { margin: 0; font: 400 12.5px/1.4 var(--font-ui); color: var(--danger-ink); }
@media (max-width: 480px) {
    .task-ask__actions { flex: 1 1 100%; }
    .task-ask__actions .ah-btn { flex: 1 1 auto; }
}
</style>
