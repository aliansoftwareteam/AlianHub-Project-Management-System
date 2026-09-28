<template>
    <section class="ah-card mc-sum mc-ask" :aria-label="$t('AiMention.ask_channel')" @keydown.esc.stop="$emit('close')">
        <div class="mc-sum-head">
            <ShellIcon name="ai" :size="14" />
            <b>{{ $t('AiMention.ask_channel') }}</b>
            <button
                type="button"
                class="mc-icon-btn"
                :title="$t('AiMention.close')"
                :aria-label="$t('AiMention.close')"
                @click="$emit('close')"
            ><ShellIcon name="x" :size="14" /></button>
        </div>

        <form class="mc-ask-form" @submit.prevent="ask">
            <label class="ah-small" :for="inputId">{{ $t('AiMention.ask_label') }}</label>
            <textarea
                :id="inputId"
                ref="input"
                v-model="question"
                class="ah-input ah-textarea mc-ask-input"
                rows="2"
                data-test="ask-channel-input"
                :placeholder="$t('AiMention.ask_placeholder')"
                @keydown.enter.exact.prevent="ask"
            ></textarea>
            <div class="mc-ask-actions">
                <span class="ah-small mc-ask-private">{{ $t('AiMention.private_note') }}</span>
                <button type="submit" class="ah-btn ah-btn--primary ah-btn--sm" data-test="ask-channel-send" :disabled="asking || !question.trim()">
                    {{ asking ? $t('AiMention.asking') : $t('AiMention.ask') }}
                </button>
            </div>
        </form>

        <div role="status" aria-live="polite">
            <p v-if="error" class="ah-field__error">{{ error }}</p>
        </div>

        <template v-if="result">
            <div class="mc-sum-text mc-ai-answer" data-test="ask-channel-answer" v-html="answerBody" @click="followCitation"></div>
            <div class="mc-ask-actions">
                <span v-if="posted" class="ah-small" role="status">{{ $t('AiMention.posted') }}</span>
                <button
                    v-else
                    type="button"
                    class="ah-btn ah-btn--outline ah-btn--sm"
                    data-test="ask-channel-post"
                    :disabled="posting"
                    @click="post"
                >{{ $t('AiMention.post_to_channel') }}</button>
            </div>
        </template>
    </section>
</template>

<script setup>
import { computed, defineEmits, defineProps, getCurrentInstance, inject, nextTick, onMounted, ref, unref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { aiAnswerHtml, citationTarget } from '@/utils/aiMention';

const props = defineProps({
    projectId: { type: String, default: '' },
    sprintId: { type: String, default: '' },
    taskId: { type: String, default: '' },
});

defineEmits(['close']);

const { t } = useI18n();
const companyId = inject('$companyId', '');
const instance = getCurrentInstance();
const routerOf = () => (instance && instance.proxy && instance.proxy.$router) || null;
const inputId = `mc-ask-${useId()}`;

const input = ref(null);
const question = ref('');
const asking = ref(false);
const posting = ref(false);
const posted = ref(false);
const error = ref('');
const result = ref(null);

const thread = () => ({ projectId: props.projectId, sprintId: props.sprintId, taskId: props.taskId });
const asRow = (data) => ({ message: data.answer, aiCitations: data.cited || [] });
const answerBody = computed(() => (result.value ? aiAnswerHtml(asRow(result.value), { router: routerOf(), companyId: unref(companyId) }) : ''));

const ERROR_KEYS = { ai_off: 'AiMention.off', unconfigured: 'AiMention.unconfigured', rate_limited: 'AiMention.rate_limited', share_refused: 'AiMention.ask_again' };
const errorFrom = (body) => t(ERROR_KEYS[body && body.code] || 'AiMention.failed');

async function ask() {
    if (asking.value || !question.value.trim()) return;
    asking.value = true;
    error.value = '';
    result.value = null;
    posted.value = false;
    try {
        const response = await apiRequest('post', env.AI_CHAT_ASK, { ...thread(), question: question.value.trim() });
        const body = response && response.data;
        if (body && body.status) result.value = body.data;
        else error.value = errorFrom(body);
    } catch (e) {
        error.value = errorFrom(e && e.response && e.response.data);
    } finally {
        asking.value = false;
    }
}

async function post() {
    if (!result.value || posting.value) return;
    posting.value = true;
    error.value = '';
    try {
        const { question: asked, answer, cited, shareToken } = result.value;
        const response = await apiRequest('post', env.AI_CHAT_ASK_POST, { ...thread(), question: asked, answer, cited, shareToken });
        const body = response && response.data;
        if (body && body.status) posted.value = true;
        else error.value = errorFrom(body);
    } catch (e) {
        error.value = errorFrom(e && e.response && e.response.data);
    } finally {
        posting.value = false;
    }
}

function followCitation(event) {
    const to = result.value && citationTarget(event, asRow(result.value), unref(companyId));
    const router = routerOf();
    if (!to || !router) return;
    event.preventDefault();
    router.push(to);
}

onMounted(() => nextTick(() => input.value && input.value.focus()));
</script>

<style scoped>
.mc-ask-form { display: flex; flex-direction: column; gap: 6px; }
.mc-ask-input { width: 100%; box-sizing: border-box; resize: vertical; }
.mc-ask-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
.mc-ask-private { margin-right: auto; color: var(--ink-2); }
.mc-ai-answer { max-height: 40vh; overflow: auto; }
.mc-ai-answer :deep(p), .mc-ai-answer :deep(ul), .mc-ai-answer :deep(ol) { margin: 0 0 6px; }
.mc-ai-answer :deep(ul), .mc-ai-answer :deep(ol) { padding-left: 20px; }
.mc-ai-answer :deep(.ask-cite) { color: var(--brand); font-weight: 600; }
</style>
