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
        <form class="pcr__form" :class="{ 'is-stack': action === 'transcript' }" @submit.prevent="compose">
            <textarea
                v-if="action === 'transcript'"
                v-model="instruction"
                class="pcr__input pcr__input--area"
                rows="6"
                :placeholder="placeholder"
                :disabled="busy"
            ></textarea>
            <input
                v-else
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
        <p v-if="notice && !brief" class="pcr__notice" :class="{ 'is-answer': Boolean(answer) }">{{ notice }}</p>
        <div v-if="brief" class="pcr__brief">
            <p class="pcr__summary">{{ brief.markdown }}</p>
            <ol v-if="brief.items.length" class="pcr__items">
                <li v-for="(item, index) in brief.items" :key="'ai-' + index">
                    <span class="pcr__item-title">{{ item.title }}</span>
                    <span v-if="item.owner" class="pcr__item-meta">{{ item.owner }}</span>
                    <span v-if="item.due" class="pcr__item-meta">{{ item.due }}</span>
                    <p v-if="item.notes" class="pcr__item-notes">{{ item.notes }}</p>
                </li>
            </ol>
            <button
                v-if="projectId && brief.items.length"
                type="button"
                class="pcr__tasks"
                @click="turnIntoTasks"
            >{{ $t('Projects.pages_turn_into_tasks') }}</button>
            <p v-else-if="brief.items.length" class="pcr__need-project">{{ $t('Projects.pages_transcript_need_project') }}</p>
        </div>
        <WorkspaceAskCitations v-if="answer && citations.length" :citations="citations" />
    </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToast } from 'vue-toast-notification';
import { apiRequest } from '@/services';
import WorkspaceAskCitations from '@/components/molecules/Pages/WorkspaceAskCitations.vue';
import { extractAlianQuestion } from '@/utils/alianMention';

const { t } = useI18n();
const $toast = useToast();

const props = defineProps({
    pageId: { type: String, default: '' },
    title: { type: String, default: '' },
    currentText: { type: String, default: '' },
    projectId: { type: String, default: '' },
});

const emit = defineEmits(['apply', 'turn-into-tasks']);

const actions = [
    { key: 'draft', label: 'Projects.pages_compose_draft' },
    { key: 'expand', label: 'Projects.pages_compose_expand' },
    { key: 'summarize', label: 'Projects.pages_compose_summarize' },
    { key: 'outline', label: 'Projects.pages_compose_outline' },
    { key: 'rewrite', label: 'Projects.pages_compose_rewrite' },
    { key: 'ask', label: 'Projects.pages_compose_ask' },
    { key: 'workspace', label: 'Projects.pages_compose_workspace' },
    { key: 'transcript', label: 'Projects.pages_compose_transcript' },
];

const action = ref('draft');
const instruction = ref('');
const busy = ref(false);
const notice = ref('');
const answer = ref('');
const citations = ref([]);
const brief = ref(null);
const configured = ref(true);

const needsQuestion = computed(() => action.value === 'ask' || action.value === 'workspace');
const isTranscript = computed(() => action.value === 'transcript');
const placeholder = computed(() => {
    if (action.value === 'ask') return t('Projects.pages_ask_placeholder');
    if (action.value === 'workspace') return t('Projects.pages_workspace_ask_placeholder');
    if (action.value === 'transcript') return t('Projects.pages_transcript_placeholder');
    return t('Projects.pages_compose_placeholder');
});
const goLabel = computed(() => {
    if (isTranscript.value) return t('Projects.pages_transcript_go');
    return needsQuestion.value ? t('Projects.pages_ask') : t('Projects.pages_compose');
});

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
    citations.value = [];
    brief.value = null;
    notice.value = t('Projects.pages_ai_missing');
}

function turnIntoTasks() {
    if (!props.projectId || !brief.value) return;
    const seed = String(brief.value.requirementsText || '').trim()
        || [brief.value.markdown, ...(brief.value.items || []).map((item) => item && item.title)].filter(Boolean).join('\n\n');
    if (!seed) return;
    emit('turn-into-tasks', seed);
}

function isMissing(payload) {
    return Boolean(payload?.isNotAi || (payload && payload.status === false && /not integrated/i.test(payload.statusText || '')));
}

function compose() {
    if (busy.value) return;
    const alian = isTranscript.value ? { mentioned: false, question: '' } : extractAlianQuestion(instruction.value);
    if (isTranscript.value && !instruction.value.trim()) {
        answer.value = '';
        citations.value = [];
        brief.value = null;
        notice.value = t('Projects.pages_transcript_needed');
        return;
    }
    if (needsQuestion.value && !instruction.value.trim() && !alian.mentioned) {
        answer.value = '';
        citations.value = [];
        brief.value = null;
        notice.value = t('Projects.pages_ask_needed');
        return;
    }
    if (alian.mentioned && !alian.question) {
        answer.value = '';
        citations.value = [];
        brief.value = null;
        notice.value = t('Projects.pages_ask_needed');
        return;
    }
    busy.value = true;
    notice.value = '';
    answer.value = '';
    citations.value = [];
    brief.value = null;

    const useWorkspace = action.value === 'workspace' || alian.mentioned;
    const question = alian.mentioned ? alian.question : instruction.value;
    const request = useWorkspace
        ? apiRequest('post', '/api/v2/pages/ask-workspace', { question })
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
        if (useWorkspace || action.value === 'ask' || action.value === 'transcript' || payload.apply === false) {
            const markdown = payload.markdown || payload.previewText || '';
            answer.value = markdown;
            citations.value = Array.isArray(payload.citations) ? payload.citations : [];
            if (action.value === 'transcript' || payload.action === 'transcript') {
                const items = Array.isArray(payload.actionItems)
                    ? payload.actionItems.filter((item) => item && item.title)
                    : [];
                brief.value = {
                    markdown,
                    items,
                    requirementsText: String(payload.requirementsText || ''),
                };
                notice.value = '';
            } else {
                notice.value = markdown;
            }
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
.pcr__form.is-stack {
    flex-direction: column;
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
.pcr__input--area {
    height: auto;
    min-height: 120px;
    padding: 10px 12px;
    resize: vertical;
    line-height: 1.45;
    font-family: inherit;
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
.pcr__form.is-stack .pcr__go {
    align-self: flex-end;
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
.pcr__brief {
    background: var(--kiln-canvas);
    border: 1px solid var(--kiln-line);
    border-left: 3px solid var(--kiln-ember);
    border-radius: var(--kiln-radius-sm);
    padding: 12px 14px;
    color: var(--kiln-ink);
    max-height: 320px;
    overflow: auto;
}
.pcr__summary {
    margin: 0;
    white-space: pre-wrap;
    font-size: 13px;
    line-height: 1.55;
}
.pcr__items {
    margin: 12px 0 0;
    padding: 0 0 0 18px;
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.pcr__item-title {
    font-family: var(--kiln-font-display);
    font-weight: 600;
    font-size: 14px;
    color: var(--kiln-ink);
}
.pcr__item-meta {
    margin-left: 8px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--kiln-ember);
}
.pcr__item-notes {
    margin: 4px 0 0;
    font-size: 12px;
    color: var(--kiln-muted);
    line-height: 1.4;
}
.pcr__tasks {
    margin-top: 12px;
    height: 36px;
    padding: 0 14px;
    border: 0;
    border-radius: var(--kiln-radius-sm);
    background: var(--kiln-ink);
    color: var(--kiln-paper);
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    font-size: 11px;
    cursor: pointer;
}
.pcr__need-project {
    margin: 10px 0 0;
    font-size: 12px;
    color: var(--kiln-muted);
}
</style>
