<template>
    <div class="pcr">
        <div class="pcr__actions">
            <button
                v-for="item in actions"
                :key="item.key"
                type="button"
                class="pcr__chip"
                :class="{ 'is-on': action === item.key }"
                @click="action = item.key"
            >{{ $t(item.label) }}</button>
        </div>
        <form class="pcr__form" @submit.prevent="compose">
            <input
                v-model="instruction"
                type="text"
                class="pcr__input"
                :placeholder="placeholder"
                :disabled="busy"
            />
            <button type="submit" class="pcr__go" :disabled="busy">
                {{ busy ? $t('Projects.pages_composing') : goLabel }}
            </button>
        </form>
        <p v-if="notice" class="pcr__notice" :class="{ 'is-answer': Boolean(answer) }">{{ notice }}</p>
    </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToast } from 'vue-toast-notification';
import { apiRequest } from '@/services';

const { t } = useI18n();
const $toast = useToast();

const props = defineProps({
    pageId: { type: String, default: '' },
    title: { type: String, default: '' },
    currentText: { type: String, default: '' },
});

const emit = defineEmits(['apply']);

const actions = [
    { key: 'draft', label: 'Projects.pages_compose_draft' },
    { key: 'expand', label: 'Projects.pages_compose_expand' },
    { key: 'summarize', label: 'Projects.pages_compose_summarize' },
    { key: 'outline', label: 'Projects.pages_compose_outline' },
    { key: 'rewrite', label: 'Projects.pages_compose_rewrite' },
    { key: 'ask', label: 'Projects.pages_compose_ask' },
    { key: 'workspace', label: 'Projects.pages_compose_workspace' },
];

const action = ref('draft');
const instruction = ref('');
const busy = ref(false);
const notice = ref('');
const answer = ref('');
const configured = ref(true);

const needsQuestion = computed(() => action.value === 'ask' || action.value === 'workspace');
const placeholder = computed(() => {
    if (action.value === 'ask') return t('Projects.pages_ask_placeholder');
    if (action.value === 'workspace') return t('Projects.pages_workspace_ask_placeholder');
    return t('Projects.pages_compose_placeholder');
});
const goLabel = computed(() => (
    needsQuestion.value ? t('Projects.pages_ask') : t('Projects.pages_compose')
));

onMounted(() => {
    apiRequest('get', '/api/v2/pages/ai-status')
        .then((response) => {
            configured.value = Boolean(response.data?.status && response.data.data?.configured);
            if (!configured.value) notice.value = t('Projects.pages_ai_missing');
        })
        .catch(() => {
            configured.value = false;
            notice.value = t('Projects.pages_ai_missing');
        });
});

function showMissing() {
    configured.value = false;
    answer.value = '';
    notice.value = t('Projects.pages_ai_missing');
}

function isMissing(payload) {
    return Boolean(payload?.isNotAi || (payload && payload.status === false && /not integrated/i.test(payload.statusText || '')));
}

function compose() {
    if (busy.value) return;
    if (needsQuestion.value && !instruction.value.trim()) {
        answer.value = '';
        notice.value = t('Projects.pages_ask_needed');
        return;
    }
    busy.value = true;
    notice.value = '';
    answer.value = '';

    const request = action.value === 'workspace'
        ? apiRequest('post', '/api/v2/pages/ask-workspace', { question: instruction.value })
        : apiRequest('post', '/api/v2/pages/ai', {
            action: action.value,
            title: props.title,
            instruction: instruction.value,
            currentText: props.currentText,
            pageId: props.pageId || undefined,
        });

    request.then((response) => {
        if (isMissing(response.data)) {
            showMissing();
            return;
        }
        if (!response.data?.status) {
            $toast.error(response.data?.statusText || t('Toast.something_went_wrong'), { position: 'top-right' });
            return;
        }
        const payload = response.data.data || {};
        if (action.value === 'ask' || action.value === 'workspace' || payload.apply === false) {
            answer.value = payload.markdown || payload.previewText || '';
            notice.value = answer.value;
            return;
        }
        emit('apply', {
            mode: action.value === 'expand' ? 'append' : 'replace',
            blocks: payload.blocks,
        });
        $toast.success(t('Projects.pages_ai_applied'), { position: 'top-right' });
    }).catch((error) => {
        console.error('ERROR in page compose: ', error);
        $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
    }).finally(() => {
        busy.value = false;
    });
}
</script>

<style scoped>
.pcr {
    border-top: 3px solid var(--kiln-ember);
    background: var(--kiln-paper);
    padding: 10px 18px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.pcr__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}
.pcr__chip {
    border: 1px solid var(--kiln-line);
    background: transparent;
    color: var(--kiln-ink-soft);
    font-family: var(--kiln-font-body);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 4px 10px;
    border-radius: 999px;
    cursor: pointer;
}
.pcr__chip.is-on {
    background: var(--kiln-ink);
    border-color: var(--kiln-ink);
    color: var(--kiln-paper);
}
.pcr__form {
    display: flex;
    gap: 8px;
}
.pcr__input {
    flex: 1 1 auto;
    min-width: 0;
    height: 40px;
    border: 1px solid var(--kiln-line);
    border-radius: var(--kiln-radius-sm);
    background: var(--kiln-canvas);
    padding: 0 12px;
    font-size: 14px;
    color: var(--kiln-text);
    outline: none;
}
.pcr__input:focus {
    border-color: var(--kiln-ember);
}
.pcr__go {
    flex: 0 0 auto;
    height: 40px;
    padding: 0 16px;
    border: 0;
    border-radius: var(--kiln-radius-sm);
    background: var(--kiln-ember);
    color: #fffaf3;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    font-size: 12px;
    cursor: pointer;
}
.pcr__go:disabled {
    opacity: 0.55;
    cursor: default;
}
.pcr__notice {
    margin: 0;
    font-size: 12px;
    color: var(--kiln-muted);
}
.pcr__notice.is-answer {
    white-space: pre-wrap;
    color: var(--kiln-ink);
    background: var(--kiln-canvas);
    border: 1px solid var(--kiln-line);
    border-radius: var(--kiln-radius-sm);
    padding: 10px 12px;
    font-size: 13px;
    line-height: 1.5;
    max-height: 220px;
    overflow: auto;
}
</style>
