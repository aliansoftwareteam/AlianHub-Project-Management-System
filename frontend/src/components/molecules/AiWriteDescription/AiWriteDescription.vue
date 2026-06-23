<template>
    <!-- Lightweight, self-contained popover for "Write with AI" on the
         description editor. NOT the heavy PromptSidebar/HubAiSidebar — a
         compact centered card (~440px) on a dim backdrop. Dismissable via
         backdrop click, the ✕, or Cancel. Dark text on white throughout. -->
    <div v-if="modelValue" class="aiwd-backdrop" @click.self="close">
        <div class="aiwd-card" role="dialog" aria-modal="true" @keydown.esc="close">
            <div class="aiwd-header">
                <span class="aiwd-title">{{ $t('AI.ai_write_description') }}</span>
                <button type="button" class="aiwd-close" :aria-label="$t('Projects.cancel')" @click="close">&times;</button>
            </div>

            <!-- STEP 1 — INPUT -->
            <div v-if="step === 'input'" class="aiwd-body">
                <textarea
                    v-model="intent"
                    class="aiwd-textarea"
                    rows="3"
                    :placeholder="$t('AI.ai_desc_intent_placeholder')"
                    @keydown.meta.enter.prevent="generate()"
                    @keydown.ctrl.enter.prevent="generate()"
                ></textarea>
                <p class="aiwd-hint">{{ $t('AI.ai_desc_intent_hint') }}</p>
            </div>

            <!-- STEP 2 — CLARIFY -->
            <div v-else-if="step === 'clarify'" class="aiwd-body">
                <p class="aiwd-hint aiwd-hint-strong">{{ $t('AI.ai_answer_questions') }}</p>
                <div v-for="(q, i) in questions" :key="i" class="aiwd-question">
                    <label class="aiwd-question-label">{{ q.question }}</label>
                    <input
                        v-model="q.answer"
                        type="text"
                        class="aiwd-input"
                        @keydown.enter.prevent="generate()"
                    />
                </div>
            </div>

            <!-- STEP 3 — PREVIEW -->
            <div v-else-if="step === 'preview'" class="aiwd-body">
                <!-- eslint-disable-next-line vue/no-v-html -->
                <div class="aiwd-preview" v-html="previewHtml"></div>
            </div>

            <!-- LOADING -->
            <div v-if="loading" class="aiwd-loading">
                <span class="aiwd-spinner"></span>
                <span>{{ $t('AI.ai_generating') }}</span>
            </div>

            <!-- ERROR -->
            <p v-if="errorMsg" class="aiwd-error">{{ errorMsg }}</p>

            <!-- FOOTER ACTIONS -->
            <div class="aiwd-footer">
                <template v-if="step === 'input'">
                    <button type="button" class="outline-primary aiwd-btn" @click="close">{{ $t('Projects.cancel') }}</button>
                    <button type="button" class="btn-primary aiwd-btn" :disabled="loading" @click="generate()">
                        {{ $t('AI.ai_generate') }}
                    </button>
                </template>
                <template v-else-if="step === 'clarify'">
                    <button type="button" class="outline-primary aiwd-btn" @click="close">{{ $t('Projects.cancel') }}</button>
                    <button type="button" class="btn-primary aiwd-btn" :disabled="loading" @click="generate()">
                        {{ $t('AI.ai_generate') }}
                    </button>
                </template>
                <template v-else-if="step === 'preview'">
                    <button type="button" class="outline-primary aiwd-btn" @click="close">{{ $t('Projects.cancel') }}</button>
                    <button type="button" class="outline-primary aiwd-btn" :disabled="loading" @click="regenerate()">
                        {{ $t('AI.ai_regenerate') }}
                    </button>
                    <button type="button" class="btn-primary aiwd-btn" :disabled="loading" @click="useThis()">
                        {{ $t('AI.ai_use_this') }}
                    </button>
                </template>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import markdownit from 'markdown-it';
import { useI18n } from 'vue-i18n';
import { apiRequest } from '@/services';
import * as env from '@/config/env';

const { t } = useI18n();
const md = markdownit({ html: false, linkify: true, breaks: true });

const props = defineProps({
    modelValue: { type: Boolean, default: false },
    title: { type: String, default: '' },
    taskType: { type: String, default: '' },
    existingDescription: { type: String, default: '' },
});

const emit = defineEmits(['update:modelValue', 'apply']);

// State machine: 'input' -> ('clarify' -> )? 'preview'
const step = ref('input');
const intent = ref('');
const questions = ref([]); // [{ question, answer }]
const generatedMarkdown = ref('');
const loading = ref(false);
const errorMsg = ref('');

const previewHtml = computed(() => {
    try {
        return md.render(generatedMarkdown.value || '');
    } catch (_e) {
        return '';
    }
});

// Reset to a clean input step every time the popover opens so a previous
// session's questions/preview never leak into a new one.
watch(() => props.modelValue, (open) => {
    if (open) {
        step.value = 'input';
        intent.value = '';
        questions.value = [];
        generatedMarkdown.value = '';
        loading.value = false;
        errorMsg.value = '';
    }
});

function close() {
    emit('update:modelValue', false);
}

// Single call into the backend. The backend returns EITHER
// { questions: [...] } (too vague — ask) OR { description: "<md>" }.
// When we already collected answers we forward them, and the backend is
// contractually required to return a description (it never re-asks).
async function generate() {
    errorMsg.value = '';
    loading.value = true;
    try {
        const answers = questions.value
            .filter((q) => (q.answer || '').trim())
            .map((q) => ({ question: q.question, answer: q.answer.trim() }));

        const body = {
            title: props.title || '',
            taskType: props.taskType || '',
            existingDescription: props.existingDescription || '',
            intent: (intent.value || '').trim(),
            answers,
        };

        const res = await apiRequest('post', env.AI_WRITE_DESCRIPTION, body);
        const payload = res?.data || {};

        if (payload.status !== true || !payload.data) {
            errorMsg.value = payload.statusText || t('AI.ai_failed');
            return;
        }

        const data = payload.data;
        // Honour questions only if we haven't already answered a round — the
        // backend won't re-ask once answers are sent, but guard anyway.
        if (Array.isArray(data.questions) && data.questions.length && answers.length === 0) {
            questions.value = data.questions.map((q) => ({ question: q, answer: '' }));
            step.value = 'clarify';
            return;
        }

        if (typeof data.description === 'string' && data.description.trim()) {
            generatedMarkdown.value = data.description.trim();
            step.value = 'preview';
            return;
        }

        errorMsg.value = t('AI.ai_failed');
    } catch (_e) {
        errorMsg.value = t('AI.ai_failed');
    } finally {
        loading.value = false;
    }
}

// Regenerate from preview: keep intent + any collected answers, ask again.
function regenerate() {
    generatedMarkdown.value = '';
    generate();
}

// Approve: hand the exact previewed markdown back to the parent to apply +
// save, then close. Never auto-applies — only on this explicit click.
function useThis() {
    if (!generatedMarkdown.value) return;
    emit('apply', generatedMarkdown.value);
    close();
}
</script>

<style scoped>
.aiwd-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.35);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1050;
}
.aiwd-card {
    width: 440px;
    max-width: calc(100vw - 32px);
    max-height: calc(100vh - 64px);
    overflow-y: auto;
    background: #ffffff;
    color: #1f1f1f;
    border-radius: 8px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
    padding: 16px;
    font-family: 'Roboto', sans-serif;
}
.aiwd-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
}
.aiwd-title {
    font-size: 15px;
    font-weight: 600;
    color: #1f1f1f;
}
.aiwd-close {
    border: none;
    background: transparent;
    font-size: 22px;
    line-height: 1;
    color: #6b6b6b;
    cursor: pointer;
    padding: 0 4px;
}
.aiwd-close:hover { color: #1f1f1f; }
.aiwd-body { margin-bottom: 12px; }
.aiwd-textarea,
.aiwd-input {
    width: 100%;
    border: 1px solid #d7d7d7;
    border-radius: 6px;
    padding: 8px 10px;
    font-size: 13px;
    color: #1f1f1f;
    background: #ffffff;
    font-family: 'Roboto', sans-serif;
    resize: vertical;
    box-sizing: border-box;
}
.aiwd-textarea:focus,
.aiwd-input:focus {
    outline: none;
    border-color: #2f3990;
}
.aiwd-hint {
    font-size: 12px;
    color: #8a8a8a;
    margin: 6px 0 0;
}
.aiwd-hint-strong {
    color: #1f1f1f;
    font-weight: 500;
    margin-bottom: 10px;
    margin-top: 0;
}
.aiwd-question { margin-bottom: 10px; }
.aiwd-question-label {
    display: block;
    font-size: 13px;
    color: #1f1f1f;
    margin-bottom: 4px;
}
.aiwd-preview {
    font-size: 13px;
    line-height: 1.5;
    color: #1f1f1f;
    max-height: 320px;
    overflow-y: auto;
    border: 1px solid #ececec;
    border-radius: 6px;
    padding: 10px 12px;
    background: #fafafa;
    word-break: break-word;
}
.aiwd-preview :deep(h1),
.aiwd-preview :deep(h2),
.aiwd-preview :deep(h3) {
    font-size: 14px;
    font-weight: 600;
    margin: 10px 0 4px;
    color: #1f1f1f;
}
.aiwd-preview :deep(ul),
.aiwd-preview :deep(ol) { padding-left: 18px; margin: 4px 0; }
.aiwd-preview :deep(p) { margin: 4px 0; }
.aiwd-preview :deep(code) {
    background: #eceef5;
    border-radius: 3px;
    padding: 1px 4px;
    font-size: 12px;
}
.aiwd-loading {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: #2f3990;
    margin-bottom: 10px;
}
.aiwd-spinner {
    width: 14px;
    height: 14px;
    border: 2px solid #c7cbe8;
    border-top-color: #2f3990;
    border-radius: 50%;
    display: inline-block;
    animation: aiwd-spin 0.7s linear infinite;
}
@keyframes aiwd-spin {
    to { transform: rotate(360deg); }
}
.aiwd-error {
    font-size: 12px;
    color: #e02d2d;
    margin: 0 0 10px;
}
.aiwd-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
}
.aiwd-btn {
    padding: 0 14px;
    height: 32px;
    font-size: 13px;
    border-radius: 4px;
}
.aiwd-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
}
</style>
