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
                <!-- When a description already exists, offer a clear, plain
                     choice: the safe non-destructive "Add" (default) or
                     "Rewrite" (replace). Empty descriptions skip this. -->
                <div v-if="hasExisting" class="aiwd-modes">
                    <button type="button" class="aiwd-mode" :class="{ 'aiwd-mode-active': mode === 'add' }" @click="mode = 'add'">{{ $t('AI.ai_desc_mode_add') }}</button>
                    <button type="button" class="aiwd-mode" :class="{ 'aiwd-mode-active': mode === 'rewrite' }" @click="mode = 'rewrite'">{{ $t('AI.ai_desc_mode_rewrite') }}</button>
                </div>
                <textarea
                    v-model="intent"
                    class="aiwd-textarea"
                    rows="3"
                    :placeholder="placeholderText"
                    @keydown.meta.enter.prevent="generate()"
                    @keydown.ctrl.enter.prevent="generate()"
                ></textarea>
                <p class="aiwd-hint">{{ hintText }}</p>
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
                        {{ applyLabel }}
                    </button>
                </template>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import markdownit from 'markdown-it';
import { richHtml } from '@/utils/richHtml';
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

// 'add' = append the generated snippet to the existing description (safe
// default when one exists); 'rewrite' = replace the whole description. Set on
// open based on whether a description already exists.
const mode = ref('rewrite');
const hasExisting = computed(() => (props.existingDescription || '').trim().length > 0);
const placeholderText = computed(() => (mode.value === 'add'
    ? t('AI.ai_desc_add_placeholder')
    : t('AI.ai_desc_intent_placeholder')));
const hintText = computed(() => (mode.value === 'add'
    ? t('AI.ai_desc_add_hint')
    : t('AI.ai_desc_intent_hint')));
const applyLabel = computed(() => (mode.value === 'add'
    ? t('AI.ai_desc_mode_add')
    : t('AI.ai_use_this')));

const previewHtml = computed(() => {
    try {
        return richHtml(md.render(generatedMarkdown.value || ''));
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
        mode.value = hasExisting.value ? 'add' : 'rewrite';
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
            mode: mode.value,
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
    // The preview already shows the FULL final description (for both Add and
    // Rewrite), so the parent just applies it.
    emit('apply', { text: generatedMarkdown.value });
    close();
}
</script>

<style scoped>
.aiwd-backdrop {
    position: fixed;
    inset: 0;
    background: var(--scrim);
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
    background: var(--surface);
    color: var(--ink);
    border-radius: 8px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
    padding: 16px;
    font-family: var(--font-ui);
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
    color: var(--ink);
}
.aiwd-close {
    border: none;
    background: transparent;
    font-size: 22px;
    line-height: 1;
    color: var(--ink-2);
    cursor: pointer;
    padding: 0 4px;
}
.aiwd-close:hover { color: var(--ink); }
.aiwd-body { margin-bottom: 12px; }
.aiwd-modes {
    display: inline-flex;
    margin-bottom: 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
}
.aiwd-mode {
    border: none;
    background: var(--surface);
    color: var(--ink-2);
    font-size: 12px;
    font-weight: 500;
    padding: 6px 14px;
    cursor: pointer;
    font-family: var(--font-ui);
}
.aiwd-mode + .aiwd-mode { border-left: 1px solid var(--border); }
.aiwd-mode-active { background: var(--brand); color: var(--on-brand); }
.aiwd-textarea,
.aiwd-input {
    width: 100%;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 10px;
    font-size: 13px;
    color: var(--ink);
    background: var(--surface);
    font-family: var(--font-ui);
    resize: vertical;
    box-sizing: border-box;
}
.aiwd-textarea:focus,
.aiwd-input:focus {
    outline: none;
    border-color: var(--brand);
}
.aiwd-hint {
    font-size: 12px;
    color: var(--ink-2);
    margin: 6px 0 0;
}
.aiwd-hint-strong {
    color: var(--ink);
    font-weight: 500;
    margin-bottom: 10px;
    margin-top: 0;
}
.aiwd-question { margin-bottom: 10px; }
.aiwd-question-label {
    display: block;
    font-size: 13px;
    color: var(--ink);
    margin-bottom: 4px;
}
.aiwd-preview {
    font-size: 13px;
    line-height: 1.5;
    color: var(--ink);
    max-height: 320px;
    overflow-y: auto;
    border: 1px solid var(--hairline);
    border-radius: 6px;
    padding: 10px 12px;
    background: var(--surface-2);
    word-break: break-word;
}
.aiwd-preview :deep(h1),
.aiwd-preview :deep(h2),
.aiwd-preview :deep(h3) {
    font-size: 14px;
    font-weight: 600;
    margin: 10px 0 4px;
    color: var(--ink);
}
.aiwd-preview :deep(ul),
.aiwd-preview :deep(ol) { padding-left: 18px; margin: 4px 0; }
.aiwd-preview :deep(p) { margin: 4px 0; }
.aiwd-preview :deep(code) {
    background: var(--fill);
    border-radius: 3px;
    padding: 1px 4px;
    font-size: 12px;
}
.aiwd-loading {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--brand);
    margin-bottom: 10px;
}
.aiwd-spinner {
    width: 14px;
    height: 14px;
    border: 2px solid var(--brand-border);
    border-top-color: var(--brand);
    border-radius: 50%;
    display: inline-block;
    animation: aiwd-spin 0.7s linear infinite;
}
@keyframes aiwd-spin {
    to { transform: rotate(360deg); }
}
.aiwd-error {
    font-size: 12px;
    color: var(--danger);
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
