<template>
    <div class="ah-page parity-page">
        <AiSidebar />
        <div class="parity-page__main">
            <div class="ah-toolbar">
                <div class="ah-toolbar__title">{{ $t('ParityV2.ask_title') }}</div>
                <div class="ah-toolbar__spacer"></div>
                <div class="ah-tabs ask__modes">
                    <button type="button" class="ah-tab" :class="{ 'is-active': mode === 'ask' }" @click="mode = 'ask'">{{ $t('ParityV2.mode_ask') }}</button>
                    <button type="button" class="ah-tab" :class="{ 'is-active': mode === 'research' }" @click="mode = 'research'">{{ $t('ParityV2.mode_research') }}</button>
                </div>
            </div>

            <div class="parity-page__body ah-scroll">
                <div class="ask__head">
                    <span class="ask__glyph"><ShellIcon name="ai" :size="16" /></span>
                    <div>
                        <div class="ah-h3">{{ $t('ParityV2.ask_title') }}</div>
                        <p class="parity-lead" style="margin-top:2px">{{ $t('ParityV2.ask_lead') }}</p>
                    </div>
                </div>

                <div class="ask__box">
                    <label class="ah-field__label" for="ask-q">{{ $t('ParityV2.your_question') }}</label>
                    <textarea
                        id="ask-q"
                        v-model="question"
                        class="ask__input"
                        :placeholder="$t('ParityV2.ask_placeholder')"
                        @keydown.enter.exact.prevent="submit"
                    ></textarea>
                    <div class="ask__sources">
                        <span v-for="kind in sources.kinds || []" :key="kind.key" class="ah-chip">{{ kind.label }}</span>
                        <span v-for="conn in sources.connected || []" :key="conn.type" class="ah-chip">{{ conn.name }}</span>
                        <span class="ah-small">{{ $t('ParityV2.n_projects_searchable', { n: (sources.projects || []).length }) }}</span>
                        <button type="button" class="ah-btn ah-btn--primary ah-btn--sm ask__go" :disabled="!question.trim() || busy" @click="submit">
                            {{ busy ? $t('ParityV2.thinking') : (mode === 'research' ? $t('ParityV2.research_go') : $t('ParityV2.ask_go')) }}
                        </button>
                    </div>
                </div>

                <p class="ah-small">{{ sources.note || $t('ParityV2.scope_note') }}</p>
                <p v-if="error" class="ah-field__error">{{ error }}</p>

                <section v-if="notConfigured" class="ah-card">
                    <div class="ah-card__head"><span class="ah-h3">{{ $t('ParityV2.no_model_title') }}</span></div>
                    <div class="ah-card__body">
                        <p class="parity-lead">{{ $t('ParityV2.no_model_body') }}</p>
                        <p class="ah-label" style="margin-top:12px">{{ $t('ParityV2.would_search') }}</p>
                        <div class="ask__cites">
                            <div v-for="source in answer.sources || []" :key="source.id" class="ask__cite">
                                <span class="ask__cite-ref">{{ source.ref }}</span>
                                <span>{{ source.title }}<span v-if="source.project" class="ah-muted"> · {{ source.project }}</span></span>
                            </div>
                            <p v-if="!(answer.sources || []).length" class="ah-empty">{{ $t('ParityV2.nothing_to_search') }}</p>
                        </div>
                    </div>
                </section>

                <section v-else-if="answer.answer" class="ah-card">
                    <div class="ah-card__head">
                        <span class="ah-h3">{{ answer.mode === 'research' ? $t('ParityV2.report') : $t('ParityV2.answer') }}</span>
                        <span v-if="answer.usage" class="parity-count">{{ answer.usage.model }}</span>
                    </div>
                    <div class="ah-card__body">
                        <div class="ask__answer">{{ answer.answer }}</div>
                        <div v-if="(answer.cited || []).length" class="ask__cites">
                            <div class="ah-label">{{ $t('ParityV2.cited') }}</div>
                            <div v-for="source in answer.cited" :key="source.id" class="ask__cite">
                                <span class="ask__cite-ref">{{ source.ref }}</span>
                                <span>{{ source.title }}<span v-if="source.project" class="ah-muted"> · {{ source.project }}</span></span>
                            </div>
                        </div>
                    </div>
                </section>

                <p v-else-if="answer.empty" class="ah-empty">{{ answer.empty }}</p>

                <div class="ah-label">{{ $t('ParityV2.quick_actions') }}</div>
                <div class="ask__cards">
                    <button
                        v-for="card in cards"
                        :key="card.key"
                        type="button"
                        class="ask__card"
                        :class="{ 'ask__card--research': card.research }"
                        @click="runCard(card)"
                    >
                        <strong>{{ $t(`ParityV2.qa_${card.key}`) }}</strong>
                        <span>{{ $t(`ParityV2.qa_${card.key}_sub`) }}</span>
                    </button>
                </div>

                <div class="ask__foot">
                    <span v-if="recent.length">{{ $t('ParityV2.recent') }} {{ recent.join(' · ') }}</span>
                    <span style="margin-left:auto">{{ $t('ParityV2.model_line') }}</span>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import AiSidebar from "./AiSidebar.vue";

// Ask (13i). The sources it may search are listed before the question is asked,
// the answer cites what it used, and with no provider configured the screen says
// so and still shows the sources instead of failing.
defineOptions({ name: "AskPage" });

const { t } = useI18n();

const question = ref("");
const mode = ref("ask");
const busy = ref(false);
const error = ref("");
const answer = ref({});
const sources = ref({});
const recent = ref([]);

const cards = [
    { key: "standup", prompt: "ParityV2.qa_standup_prompt" },
    { key: "tasks_from", prompt: "ParityV2.qa_tasks_from_prompt" },
    { key: "summarize", prompt: "ParityV2.qa_summarize_prompt" },
    { key: "who_knows", prompt: "ParityV2.qa_who_knows_prompt" },
    { key: "dashboard", prompt: "ParityV2.qa_dashboard_prompt" },
    { key: "research", prompt: "ParityV2.qa_research_prompt", research: true }
];

const notConfigured = computed(() => answer.value.configured === false);

const submit = async () => {
    if (!question.value.trim()) return;
    busy.value = true;
    error.value = "";
    try {
        const res = await apiRequest("post", env.AI_ASK, { question: question.value.trim(), mode: mode.value });
        if (!res?.data?.status) { error.value = res?.data?.statusText || t("ParityV2.ask_failed"); return; }
        answer.value = res.data.data || {};
        recent.value = [question.value.trim(), ...recent.value].slice(0, 2);
    } catch (e) {
        error.value = e?.response?.data?.statusText || e.message;
    } finally {
        busy.value = false;
    }
};

const runCard = (card) => {
    question.value = t(card.prompt);
    mode.value = card.research ? "research" : "ask";
    submit();
};

onMounted(async () => {
    const res = await apiRequest("get", env.AI_ASK_SOURCES);
    if (res?.data?.status) sources.value = res.data.data || {};
});
</script>

<style>
@import "./parity.css";
</style>
