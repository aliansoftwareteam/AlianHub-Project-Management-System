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
import { computed, getCurrentInstance, inject, ref, unref, watch, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { useCardMeta } from '@/components/organisms/DashboardCard/useCardMeta';
import { AI_ACCESS, AI_STATE, aiAccessFor, aiAvailability, messageKeysFor } from '@/composable/aiAvailability';
import { answerHtml } from '@/views/Ai/askMarkdown';
import { messageKey, sourceLink } from '@/views/Ai/askWhy';
import { recallAskAnswer, rememberAskAnswer } from './askCardCache';

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

const { t } = useI18n();
const meta = useCardMeta();
const userId = inject('$userId', ref(''));
const companyId = inject('$companyId', ref(''));
const router = getCurrentInstance()?.proxy?.$router || null;

const result = ref(null);

const question = computed(() => String(props.cardData?.question || '').trim());
const projectId = computed(() => String(props.cardData?.projectId || ''));
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
    meta.emptyText = text;
    meta.state = 'empty';
};

const showAnswer = (answer) => {
    result.value = answer;
    const minutes = Math.floor((Date.now() - answer.askedAt) / 60000);
    meta.note = minutes >= 1 ? t('Dash.ask_note_asked', { n: minutes }) : t('Dash.ask_note');
    meta.state = 'ready';
};

const cacheKey = () => ({ companyId: unref(companyId), userId: unref(userId), question: question.value, projectId: projectId.value });

const load = async (fresh = false) => {
    meta.error = '';
    if (!question.value) return showEmpty(t('Dash.ask_pick_question'));
    if (access.value === AI_ACCESS.UNKNOWN) {
        meta.state = 'loading';
        return undefined;
    }
    if (access.value === AI_ACCESS.OFF || access.value === AI_ACCESS.UNCONFIGURED) return showEmpty(availabilityText(aiAvailability.state));
    if (access.value === AI_ACCESS.NOT_PERMITTED) return showEmpty(t('Dash.ask_not_permitted'));

    const key = cacheKey();
    const kept = fresh ? null : recallAskAnswer(key);
    if (kept) return showAnswer(kept);

    meta.state = 'loading';
    try {
        const res = await apiRequest('post', env.AI_ASK, {
            question: question.value,
            mode: 'ask',
            ...(projectId.value ? { projectId: projectId.value } : {}),
        });
        const body = (res && res.data) || {};
        if (!body.status) {
            if (body.code === 'ai_off') return showEmpty(availabilityText(offState()));
            result.value = null;
            meta.error = body.code === 'ai_budget_exhausted' ? t('Dash.ask_budget_exhausted') : '';
            meta.state = 'error';
            return undefined;
        }
        const data = body.data || {};
        if (data.configured === false) return showEmpty(availabilityText(AI_STATE.UNCONFIGURED));
        if (!String(data.answer || '').trim()) return showEmpty(t(messageKey(data.emptyCode) || 'Dash.ask_no_answer'));
        return showAnswer(rememberAskAnswer(key, { answer: data.answer, cited: data.cited || [] }));
    } catch (e) {
        result.value = null;
        meta.state = 'error';
        return undefined;
    }
};

watch(() => props.refreshTrigger, () => load(true));
watch(() => [question.value, projectId.value, unref(userId)], () => load());
watch(access, () => load());
onMounted(() => load());
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
    line-height: 1.55;
    color: var(--ink);
    overflow-wrap: anywhere;
}
.askc__answer :deep(p) { margin: 0 0 6px; }
.askc__answer :deep(ul), .askc__answer :deep(ol) { margin: 0 0 6px; padding-left: 18px; }
.askc__answer :deep(.ask-cite) {
    font: var(--text-data);
    color: var(--brand);
    text-decoration: none;
}
.askc__answer :deep(a.ask-cite:hover) { text-decoration: underline; }
.askc__cites { display: flex; flex-direction: column; gap: 4px; margin-top: auto; }
.askc__ref {
    flex: none;
    font: var(--text-data);
    color: var(--brand);
    text-decoration: none;
}
a.askc__ref:hover { text-decoration: underline; }
</style>
