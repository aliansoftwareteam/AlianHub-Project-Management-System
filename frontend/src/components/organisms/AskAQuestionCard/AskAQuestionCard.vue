<template>
    <div class="dc-body askc">
        <p class="askc__question" :title="question">{{ question }}</p>
        <div class="askc__answer" data-test="ask-card-answer" @click="followCite" v-html="html"></div>
        <div v-if="cited.length" class="askc__cites">
            <span class="dc-sub">{{ $t('Parity.cited') }}</span>
            <div class="dc-list">
                <div v-for="source in cited" :key="source.ref" class="dc-item" data-test="ask-card-cite">
                    <router-link v-if="linkOf(source)" :to="linkOf(source)" class="askc__ref">{{ source.ref }}</router-link>
                    <span v-else class="askc__ref">{{ source.ref }}</span>
                    <span class="dc-item__text" :title="source.title">{{ source.title }}</span>
                    <span v-if="source.project" class="dc-item__meta">{{ source.project }}</span>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, getCurrentInstance, inject, ref, unref, watch, onMounted, onBeforeUnmount } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { REPORT_TIMEOUT_MS, useCardMeta } from '@/components/organisms/DashboardCard/useCardMeta';
import { AI_ACCESS, AI_STATE, aiAccessFor, aiAvailability, loadAiAvailability, messageKeysFor } from '@/composable/aiAvailability';
import { answerHtml } from '@/views/Ai/askMarkdown';
import { messageKey, sourceLink } from '@/views/Ai/askWhy';

defineOptions({ name: 'AskAQuestionCard' });

const props = defineProps({
    cardUID: { type: [String, Number], default: '' },
    componentId: { type: String, default: '' },
    cardData: { type: Object, default: () => ({}) },
    filterData: { type: [Array, Object], default: () => [] },
    refreshTrigger: { type: [Number, String], default: 0 },
    companyUserDetail: { type: Object, default: () => ({}) },
    allProjectsArrayFilter: { type: Array, default: () => [] },
    taskStatusArray: { type: [Array, Object], default: () => ({}) },
});

const { t, locale } = useI18n();
const meta = useCardMeta();
const dashboardId = inject('dashboardId', ref(''));
const companyId = inject('$companyId', ref(''));
const router = getCurrentInstance()?.proxy?.$router || null;

const result = ref(null);

const question = computed(() => String(props.cardData?.question || '').trim());
const projectId = computed(() => String(props.cardData?.projectId || ''));
const refreshAfter = computed(() => String(props.cardData?.refreshAfter ?? ''));
const access = computed(() => aiAccessFor());

const cited = computed(() => ((result.value && result.value.cited) || []).filter((s) => s && s.ref));
const linkOf = (source) => sourceLink(source, unref(companyId));
const hrefOf = (source) => {
    const to = linkOf(source);
    if (!to || !router) return '';
    try {
        return router.resolve(to).href || '';
    } catch {
        return '';
    }
};
const html = computed(() => (result.value ? answerHtml(result.value.answer, { cited: cited.value, hrefOf }) : ''));

const followCite = (event) => {
    const link = event.target && typeof event.target.closest === 'function' ? event.target.closest('a.ask-cite') : null;
    if (!link || !router || event.metaKey || event.ctrlKey || event.shiftKey || event.button) return;
    const source = cited.value.find((s) => s.ref === link.getAttribute('data-cite'));
    const to = source && linkOf(source);
    if (!to) return;
    event.preventDefault();
    router.push(to);
};

const availabilityText = (state) => {
    const keys = messageKeysFor({
        state,
        canConfigureInstance: aiAvailability.canConfigureInstance,
        canManageWorkspace: aiAvailability.canManageWorkspace,
    });
    return keys ? t(keys.body) : '';
};
const offState = () => ([AI_STATE.OFF_INSTANCE, AI_STATE.OFF_WORKSPACE].includes(aiAvailability.state) ? aiAvailability.state : AI_STATE.OFF_WORKSPACE);

const showEmpty = (text) => {
    result.value = null;
    meta.updatedAt = null;
    meta.emptyText = text;
    meta.state = 'empty';
};

const showError = (text = '') => {
    result.value = null;
    meta.updatedAt = null;
    meta.error = text;
    meta.state = 'error';
};

const whenOf = (askedAt) => {
    const date = new Date(askedAt);
    const style = { dateStyle: 'medium', timeStyle: 'short' };
    try {
        return date.toLocaleString(locale?.value || undefined, style);
    } catch {
        return date.toLocaleString(undefined, style);
    }
};

const showAnswer = (answer, { stale = false } = {}) => {
    if (!String(answer.answer || '').trim()) return showEmpty(t('Dash.ask_no_answer'));
    result.value = { answer: answer.answer, cited: answer.cited || [] };
    meta.updatedAt = answer.askedAt || Date.now();
    meta.note = stale ? t('Dash.ask_note_from', { when: whenOf(meta.updatedAt) }) : t('Dash.ask_note');
    meta.state = 'ready';
    return undefined;
};

const showReply = (body) => {
    if (!body.status) {
        if (body.code === 'ai_off') return showEmpty(availabilityText(offState()));
        if (body.code === 'ai_budget_exhausted') return showError(t('Dash.ask_budget_exhausted'));
        return showError(body.code === 'budget_unavailable' ? t('Dash.ask_budget_unavailable') : '');
    }
    const data = body.data || {};
    if (data.configured === false) return showEmpty(t('ConnectAi.card_no_model'));
    if (!String(data.answer || '').trim()) return showEmpty(t(messageKey(data.emptyCode) || 'Dash.ask_no_answer'));
    return showAnswer(data);
};

const cardUrl = () => `${env.AI_ASK_CARD}/${encodeURIComponent(unref(dashboardId))}/${encodeURIComponent(props.cardUID)}`;
const asking = () => ({ question: question.value, ...(projectId.value ? { projectId: projectId.value } : {}) });

/* The server keeps the answer for this viewer. An open reads it and asks only when there is none for this question
   and scope, or when the kept one is past the card's limit and the server says an ask is due. */
const request = async (fresh, isCurrent) => {
    if (!fresh) {
        const kept = ((await apiRequest('get', cardUrl()))?.data || {}).data || {};
        if (!isCurrent()) return;
        const stored = kept.stored;
        if (stored && stored.question === question.value && String(stored.projectId || '') === projectId.value) {
            showAnswer(stored, { stale: Boolean(kept.stale) });
            if (!kept.refreshDue) return;
            const renewed = await apiRequest('post', cardUrl(), asking()).then((res) => res?.data || {}, () => ({}));
            if (isCurrent() && renewed.status && renewed.data && !renewed.data.kept) showReply(renewed);
            return;
        }
    }
    meta.state = 'loading';
    const res = await apiRequest('post', cardUrl(), fresh ? { ...asking(), fresh: true } : asking());
    if (isCurrent()) showReply(res?.data || {});
};

let run = 0;
let inFlight = null;
let lastFresh = false;
let availabilityDeadline = null;

const awaitAvailability = () => {
    meta.state = 'loading';
    availabilityDeadline = setTimeout(() => {
        if (access.value === AI_ACCESS.UNKNOWN) showError(t('Dash.ask_availability_unknown'));
    }, REPORT_TIMEOUT_MS);
};

const reportWithoutAsking = () => {
    if (!question.value) return showEmpty(t('Dash.ask_pick_question')) || true;
    if (access.value === AI_ACCESS.UNKNOWN) return awaitAvailability() || true;
    if (access.value === AI_ACCESS.UNCONFIGURED) return showEmpty(t('ConnectAi.card_no_model')) || true;
    if (access.value === AI_ACCESS.OFF) return showEmpty(availabilityText(aiAvailability.state)) || true;
    if (access.value === AI_ACCESS.NOT_PERMITTED) return showEmpty(t('Dash.ask_not_permitted')) || true;
    if (!unref(dashboardId)) return showError() || true;
    return false;
};

const load = (fresh = false) => {
    clearTimeout(availabilityDeadline);
    meta.error = '';
    if (reportWithoutAsking()) {
        run += 1;
        inFlight = null;
        return undefined;
    }
    const key = JSON.stringify([fresh, unref(dashboardId), props.cardUID, question.value, projectId.value]);
    if (inFlight && inFlight.key === key) return inFlight.promise;

    run += 1;
    const mine = run;
    const isCurrent = () => mine === run;
    lastFresh = fresh;
    meta.state = 'loading';
    const promise = request(fresh, isCurrent)
        .catch(() => { if (isCurrent()) showError(); })
        .finally(() => { if (inFlight && inFlight.promise === promise) inFlight = null; });
    inFlight = { key, promise };
    return promise;
};

/* The shell's refresh and its "Try again" both arrive here. After an error it repeats the load that failed, so a
   kept answer that could not be read is read again rather than paid for again. */
const onRefresh = () => {
    if (access.value === AI_ACCESS.UNKNOWN && !aiAvailability.loaded) loadAiAvailability(unref(companyId));
    load(meta.state === 'error' ? lastFresh : true);
};

watch(() => props.refreshTrigger, onRefresh);
watch(() => [unref(dashboardId), question.value, projectId.value, refreshAfter.value], () => load());
watch(access, () => load());
onMounted(() => load());
onBeforeUnmount(() => {
    clearTimeout(availabilityDeadline);
    run += 1;
});
</script>

<style scoped src="@/components/organisms/DashboardCard/cardBody.css"></style>
<style scoped>
.askc__question {
    margin: 0;
    font: var(--text-small);
    font-weight: 600;
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.askc__answer {
    font: var(--text-small);
    line-height: var(--lh-body, 1.55);
    color: var(--ink);
    overflow-wrap: anywhere;
}
.askc__answer :deep(p) { margin: 0 0 var(--sp-2); }
.askc__answer :deep(ul), .askc__answer :deep(ol) { margin: 0 0 var(--sp-2); padding-left: calc(var(--sp-7) + 2px); }
.askc__answer :deep(.ask-cite) {
    font: var(--text-data);
    color: var(--brand);
    text-decoration: none;
}
.askc__answer :deep(a.ask-cite:hover) { text-decoration: underline; }
.askc__cites { display: flex; flex-direction: column; gap: var(--sp-1); margin-top: auto; }
.askc__ref {
    flex: none;
    font: var(--text-data);
    color: var(--brand);
    text-decoration: none;
}
a.askc__ref:hover { text-decoration: underline; }
@media (max-width: 767px) {
    a.askc__ref { display: inline-flex; align-items: center; min-height: var(--hit-min); }
}
</style>
