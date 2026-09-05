<template>
    <!--
        Wizard-style Clarify step. One question per page with a step
        indicator, option rows with keyboard shortcuts, an "Other" free-
        text escape, Skip / Next at the bottom. Modelled on the AskUserQuestion
        popup pattern. Self-contained — no QuestionCard, no input atoms.
    -->
    <div
        class="cw"
        :class="{ 'cw--locked': generating }"
        :aria-busy="generating || null"
        @keydown="onKeydown"
    >
        <!-- Loading skeleton -->
        <div v-if="loading" class="cw__skeleton" aria-hidden="true">
            <div class="cw__skeleton-line cw__skeleton-line--short"></div>
            <div class="cw__skeleton-line"></div>
            <div class="cw__skeleton-rows">
                <div class="cw__skeleton-row" v-for="n in 4" :key="n"></div>
            </div>
        </div>

        <!-- Error -->
        <div v-else-if="errorMessage" class="cw__error">
            <p class="cw__error-title">Couldn't draft clarifying questions</p>
            <p class="cw__error-msg">{{ errorMessage }}</p>
            <div class="cw__error-actions">
                <button type="button" class="cw__btn cw__btn--ghost" @click="$emit('retry')">Try again</button>
                <button type="button" class="cw__btn cw__btn--primary" @click="$emit('skip-all')">Skip and generate plan</button>
            </div>
        </div>

        <!-- Wizard card -->
        <div v-else-if="currentQuestion" class="cw__card">
            <header class="cw__head">
                <span class="cw__step">{{ currentIndex + 1 }}/{{ questions.length }}</span>
                <h3 class="cw__question">
                    {{ currentQuestion.question }}<span v-if="currentQuestion.required" class="cw__req" aria-label="Required">*</span>
                </h3>
                <button
                    type="button"
                    class="cw__close"
                    :disabled="generating"
                    aria-label="Close"
                    @click="$emit('back')"
                >×</button>
            </header>

            <p v-if="currentQuestion.hint" class="cw__hint">{{ currentQuestion.hint }}</p>

            <!-- Free text (type === 'text') -->
            <div v-if="isFreeText" class="cw__options">
                <textarea
                    v-model="textDraft"
                    class="cw__textarea"
                    :placeholder="textPlaceholder"
                    rows="4"
                    maxlength="500"
                    @input="onTextDraftInput"
                />
            </div>

            <!-- Option rows for everything else -->
            <div v-else class="cw__options">
                <button
                    v-for="(opt, i) in renderableOptions"
                    :key="String(opt.value)"
                    type="button"
                    class="cw__option"
                    :class="{ 'cw__option--selected': isSelected(opt.value) }"
                    @click="onOptionClick(opt.value)"
                >
                    <span class="cw__option-body">
                        <span class="cw__option-label">
                            <span class="cw__option-text">{{ opt.label }}</span>
                            <span v-if="isRecommended(opt.value)" class="cw__rec">Recommended</span>
                        </span>
                        <span v-if="opt.description" class="cw__option-desc">{{ opt.description }}</span>
                    </span>
                    <kbd v-if="i < 9" class="cw__kbd">{{ i + 1 }}</kbd>
                </button>

                <!-- Inline text field that appears under the rows when the
                     user selected "Custom" (preset_chips) — same pattern as
                     "Other" but baked into the question's own options. -->
                <input
                    v-if="showCustomInput"
                    v-model="customDraft"
                    type="text"
                    class="cw__inline-input"
                    :placeholder="customPlaceholder"
                    maxlength="200"
                    @input="onCustomDraftInput"
                />

                <!-- "Other" escape — appears as the last row for single-select
                     types (segmented / radio_cards / select_card). User can
                     type a free-text answer that overrides the structured pick. -->
                <div
                    v-if="allowOther"
                    class="cw__option cw__option--other"
                    :class="{ 'cw__option--selected': isOtherSelected }"
                >
                    <span class="cw__option-body">
                        <span class="cw__option-label">
                            <span class="cw__option-text">Other</span>
                        </span>
                        <input
                            v-model="otherDraft"
                            type="text"
                            class="cw__other-input"
                            placeholder="Type your own answer here"
                            maxlength="200"
                            @focus="selectOther"
                            @input="onOtherDraftInput"
                        />
                    </span>
                    <kbd class="cw__kbd">{{ renderableOptions.length + 1 }}</kbd>
                </div>
            </div>

            <!-- Footer: Back on far-left, Let-AI-decide + Skip + Next on right -->
            <footer class="cw__foot">
                <!-- ← Back: previous question when on Q2+, back to Step 1 when on Q1 -->
                <button
                    type="button"
                    class="cw__btn cw__btn--ghost"
                    :disabled="generating"
                    @click="onBack"
                >
                    <span class="cw__back-arrow">←</span>
                    {{ currentIndex > 0 ? 'Previous' : 'Back' }}
                </button>
                <span class="cw__spacer"></span>
                <button
                    type="button"
                    class="cw__btn cw__btn--link"
                    :disabled="generating"
                    @click="onLetAIDecideAll"
                >
                    Let AI decide
                </button>
                <button
                    v-if="allowUnknown"
                    type="button"
                    class="cw__btn cw__btn--ghost"
                    :class="{ 'cw__btn--unknown-active': isUnknownSelected }"
                    :disabled="generating"
                    @click="onUnknown"
                >
                    {{ $t('AiProject.unknown_yet') }}
                </button>
                <button
                    type="button"
                    class="cw__btn cw__btn--ghost"
                    :disabled="generating"
                    @click="onSkip"
                >
                    Skip
                </button>
                <button
                    type="button"
                    class="cw__btn cw__btn--primary"
                    :disabled="!canAdvance || generating"
                    @click="onNext"
                >
                    <span v-if="generating">{{ $t('AiProject.generating_plan') }}</span>
                    <span v-else>{{ isLastQuestion ? $t('AiProject.continue') : 'Next' }}</span>
                    <kbd v-if="!generating" class="cw__kbd cw__kbd--inline">Enter</kbd>
                </button>
            </footer>
        </div>
    </div>
</template>

<script setup>
import { defineProps, defineEmits, computed, reactive, ref, watch } from 'vue';

const props = defineProps({
    loading: { type: Boolean, default: false },
    generating: { type: Boolean, default: false },
    understanding: { type: String, default: '' },
    questions: { type: Array, default: () => [] },
    errorMessage: { type: String, default: '' },
});

const emit = defineEmits(['submit', 'back', 'retry', 'skip-all']);

// ── Wizard state ────────────────────────────────────────────────────
// `answers` and `skipped` are keyed by question.id and persist across
// navigation between wizard pages. `currentIndex` drives which page is
// shown. `*Draft` refs hold the in-progress text for the inline inputs.
const currentIndex = ref(0);
const answers = reactive({});
const skipped = reactive({});
const unknown = reactive({});
const otherDraft = ref('');
const customDraft = ref('');
const textDraft = ref('');

// Reset everything when a fresh question set arrives.
watch(
    () => props.questions,
    (qs) => {
        currentIndex.value = 0;
        for (const k of Object.keys(answers)) delete answers[k];
        for (const k of Object.keys(skipped)) delete skipped[k];
        for (const k of Object.keys(unknown)) delete unknown[k];
        // Pre-fill recommended answers so the user can hit Enter to accept.
        for (const q of qs || []) {
            if (q && q.id && q.recommended != null && q.type !== 'text') {
                answers[q.id] = cloneRecommended(q.recommended);
            }
        }
        loadDraftsForCurrent(qs && qs[0]);
    },
    { immediate: true, deep: false },
);

// Whenever the wizard page changes, hydrate the local drafts from the
// stored answer for THAT question (so navigating back and forth keeps
// the "Other" or "Custom" text the user already typed).
watch(currentIndex, (i) => {
    loadDraftsForCurrent(props.questions[i]);
});

function loadDraftsForCurrent(q) {
    otherDraft.value = '';
    customDraft.value = '';
    textDraft.value = '';
    if (!q) return;
    const a = answers[q.id];
    if (q.type === 'text') {
        textDraft.value = typeof a === 'string' ? a : '';
    } else if (typeof a === 'object' && a !== null) {
        if (a.value === 'custom' && a.customText) customDraft.value = a.customText;
        if (a.value === '__other__' && a.customText) otherDraft.value = a.customText;
    }
}

function cloneRecommended(r) {
    if (Array.isArray(r)) return [...r];
    return r;
}

// ── Current question accessors ──────────────────────────────────────
const currentQuestion = computed(() => props.questions[currentIndex.value] || null);
const currentAnswer = computed(() => (currentQuestion.value ? answers[currentQuestion.value.id] : undefined));
const isLastQuestion = computed(() => currentIndex.value >= props.questions.length - 1);
const isFreeText = computed(() => currentQuestion.value?.type === 'text');
const isMultiSelect = computed(() => currentQuestion.value?.type === 'toggle_chips');
const isPresetChips = computed(() => currentQuestion.value?.type === 'preset_chips');
const allowOther = computed(() => ['segmented', 'radio_cards', 'select_card'].includes(currentQuestion.value?.type));
const allowUnknown = computed(() => !!currentQuestion.value && currentQuestion.value.allowUnknown !== false);
const isUnknownSelected = computed(() => !!currentQuestion.value && !!unknown[currentQuestion.value.id]);

// Render `toggle` as two synthetic Yes/No rows so the same row template
// works across every type. For everything else we use the question's
// own options array.
const renderableOptions = computed(() => {
    const q = currentQuestion.value;
    if (!q) return [];
    if (q.type === 'toggle') {
        return [
            { value: true, label: 'Yes' },
            { value: false, label: 'No' },
        ];
    }
    return Array.isArray(q.options) ? q.options : [];
});

const showCustomInput = computed(() => {
    if (!isPresetChips.value) return false;
    const a = currentAnswer.value;
    const sel = typeof a === 'object' && a !== null ? a.value : a;
    return sel === 'custom';
});

const customPlaceholder = computed(() => 'Type your answer here');
const textPlaceholder = computed(() => {
    const r = currentQuestion.value?.recommended;
    return typeof r === 'string' && r.length ? r : 'Type your answer here…';
});

const isOtherSelected = computed(() => {
    if (!allowOther.value) return false;
    const a = currentAnswer.value;
    return typeof a === 'object' && a !== null && a.value === '__other__';
});

// ── Selection helpers ──────────────────────────────────────────────
function isSelected(value) {
    const a = currentAnswer.value;
    if (a == null) return false;
    if (isMultiSelect.value) {
        return Array.isArray(a) && a.map(String).includes(String(value));
    }
    if (typeof a === 'object' && a !== null) {
        if (a.value === '__other__') return false; // structured rows not selected when Other is active
        return String(a.value) === String(value);
    }
    return String(a) === String(value);
}

function isRecommended(value) {
    const r = currentQuestion.value?.recommended;
    if (r == null) return false;
    if (Array.isArray(r)) return r.map(String).includes(String(value));
    return String(r) === String(value);
}

// ── Click / input handlers ─────────────────────────────────────────
function onOptionClick(value) {
    const q = currentQuestion.value;
    if (!q) return;
    if (skipped[q.id]) delete skipped[q.id];
    if (unknown[q.id]) delete unknown[q.id];

    if (isMultiSelect.value) {
        const cur = Array.isArray(answers[q.id]) ? [...answers[q.id]] : [];
        const v = String(value);
        const idx = cur.map(String).indexOf(v);
        if (idx === -1) cur.push(value);
        else cur.splice(idx, 1);
        answers[q.id] = cur;
        return;
    }

    // preset_chips with "custom" → keep the object shape, preserve any
    // existing customText so a click-back doesn't wipe what the user typed.
    if (isPresetChips.value && value === 'custom') {
        answers[q.id] = { value: 'custom', customText: customDraft.value || '' };
        return;
    }

    // Single-select normal pick — clear Other state if it was set.
    answers[q.id] = value;
    otherDraft.value = '';
}

function selectOther() {
    const q = currentQuestion.value;
    if (!q || !allowOther.value) return;
    if (skipped[q.id]) delete skipped[q.id];
    if (unknown[q.id]) delete unknown[q.id];
    answers[q.id] = { value: '__other__', customText: otherDraft.value };
}

function onOtherDraftInput() {
    const q = currentQuestion.value;
    if (!q) return;
    if (skipped[q.id]) delete skipped[q.id];
    if (unknown[q.id]) delete unknown[q.id];
    answers[q.id] = { value: '__other__', customText: otherDraft.value };
}

function onCustomDraftInput() {
    const q = currentQuestion.value;
    if (!q) return;
    answers[q.id] = { value: 'custom', customText: customDraft.value };
}

function onTextDraftInput() {
    const q = currentQuestion.value;
    if (!q) return;
    if (skipped[q.id]) delete skipped[q.id];
    if (unknown[q.id]) delete unknown[q.id];
    answers[q.id] = textDraft.value;
}

// ── Validation ─────────────────────────────────────────────────────
function isAnswered(q) {
    if (skipped[q.id]) return false;
    const a = answers[q.id];
    if (a == null) return false;
    if (Array.isArray(a)) return a.length > 0;
    if (typeof a === 'string') return a.trim().length > 0;
    if (typeof a === 'object') {
        // Object shape — only counted as answered if customText present
        // (e.g. Other / Custom) or if value is a non-empty string.
        if (a.value === 'custom' || a.value === '__other__') {
            return typeof a.customText === 'string' && a.customText.trim().length > 0;
        }
        return a.value != null;
    }
    if (typeof a === 'boolean') return true;
    return true;
}

const canAdvance = computed(() => {
    const q = currentQuestion.value;
    if (!q) return false;
    if (skipped[q.id] || unknown[q.id]) return true;
    if (!q.required) return true;   // optional → can always advance
    return isAnswered(q);
});

// ── Navigation ─────────────────────────────────────────────────────
function onBack() {
    if (props.generating) return;
    if (currentIndex.value > 0) {
        // Navigate to the previous question within the wizard.
        currentIndex.value -= 1;
    } else {
        // Already on Q1 — go back to Step 1 (Describe).
        emit('back');
    }
}

function onNext() {
    if (!canAdvance.value || props.generating) return;
    if (isLastQuestion.value) {
        emit('submit', buildClarifications());
        return;
    }
    currentIndex.value += 1;
}

function advanceOrSubmit() {
    if (isLastQuestion.value) {
        emit('submit', buildClarifications());
    } else {
        currentIndex.value += 1;
    }
}

function onSkip() {
    const q = currentQuestion.value;
    if (!q || props.generating) return;
    skipped[q.id] = true;
    delete unknown[q.id];
    delete answers[q.id];
    advanceOrSubmit();
}

// "I don't know yet" is an answer in its own right: the brief states an
// assumption for it, whereas a skip is silence.
function onUnknown() {
    const q = currentQuestion.value;
    if (!q || props.generating) return;
    unknown[q.id] = true;
    delete skipped[q.id];
    delete answers[q.id];
    advanceOrSubmit();
}

function onLetAIDecideAll() {
    if (props.generating) return;
    emit('submit', buildClarifications({ skipAll: true }));
}

// [{ id, point, question, category, type, answer, skipped, unknown }]
function buildClarifications({ skipAll = false } = {}) {
    return (props.questions || []).map((q) => {
        const isUnknown = !skipAll && !!unknown[q.id];
        const isSkipped = !isUnknown && (skipAll || !!skipped[q.id] || !isAnswered(q));
        return {
            id: q.id,
            point: q.point || null,
            question: q.question,
            category: q.category,
            type: q.type,
            answer: isSkipped || isUnknown ? null : answers[q.id],
            skipped: isSkipped,
            unknown: isUnknown,
        };
    });
}

// ── Keyboard ───────────────────────────────────────────────────────
function onKeydown(evt) {
    if (props.generating || props.loading || props.errorMessage) return;
    const tag = (evt.target && evt.target.tagName) || '';
    const inTextarea = tag === 'TEXTAREA';

    // Enter advances (except inside a textarea, where Enter inserts a newline).
    if (evt.key === 'Enter' && !inTextarea) {
        evt.preventDefault();
        onNext();
        return;
    }

    // ArrowLeft goes back (previous question or Step 1 if on Q1).
    if (evt.key === 'ArrowLeft' && tag !== 'INPUT' && !inTextarea) {
        evt.preventDefault();
        onBack();
        return;
    }

    // Number keys 1–9 pick the corresponding option. Skip when typing in
    // an input field so the digit goes into the field instead.
    if (tag === 'INPUT' || inTextarea) return;
    if (/^[1-9]$/.test(evt.key)) {
        const idx = parseInt(evt.key, 10) - 1;
        const opts = renderableOptions.value;
        if (idx < opts.length) {
            evt.preventDefault();
            onOptionClick(opts[idx].value);
        } else if (idx === opts.length && allowOther.value) {
            // The "Other" row is the row after the structured options.
            evt.preventDefault();
            selectOther();
        }
    }
}
</script>

<style scoped>
.cw {
    display: flex;
    flex-direction: column;
    gap: 14px;
}
.cw--locked {
    pointer-events: none;
    opacity: 0.65;
    user-select: none;
}

/* ── Card surface ──────────────────────────────────────────────── */
.cw__card {
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 14px;
    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    padding: 18px 18px 14px;
    display: flex;
    flex-direction: column;
    gap: 14px;
}

/* ── Header ────────────────────────────────────────────────────── */
.cw__head {
    display: flex;
    align-items: center;
    gap: 12px;
}
.cw__step {
    flex-shrink: 0;
    font-size: 11px;
    font-weight: 600;
    color: #2F3990;
    background: #eef0ff;
    padding: 3px 8px;
    border-radius: 999px;
    letter-spacing: 0.2px;
}
.cw__question {
    margin: 0;
    flex: 1;
    font-size: 15px;
    font-weight: 600;
    color: #2b2b35;
    line-height: 1.4;
    min-width: 0;
}
.cw__req {
    color: #b07000;
    font-weight: 700;
    margin-left: 2px;
}
.cw__close {
    appearance: none;
    background: transparent;
    border: none;
    color: #9aa0a6;
    font-size: 20px;
    line-height: 1;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    cursor: pointer;
    flex-shrink: 0;
    transition: background-color 0.15s ease, color 0.15s ease;
}
.cw__close:hover:not(:disabled) {
    background: #f4f5f7;
    color: #2b2b35;
}
.cw__close:disabled {
    opacity: 0.4;
    cursor: not-allowed;
}

/* ── Hint line ─────────────────────────────────────────────────── */
.cw__hint {
    margin: 0;
    font-size: 12px;
    color: #6b7280;
    line-height: 1.5;
}

/* ── Options list ──────────────────────────────────────────────── */
.cw__options {
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.cw__option {
    appearance: none;
    background: #f8f9fb;
    border: 1px solid transparent;
    border-radius: 10px;
    padding: 12px 14px;
    text-align: left;
    cursor: pointer;
    display: flex;
    align-items: flex-start;
    gap: 10px;
    transition: background-color 0.15s ease, border-color 0.15s ease;
    font: inherit;
    color: inherit;
}
.cw__option:hover:not(.cw__option--selected) {
    background: #f1f3f7;
}
.cw__option--selected {
    background: #eef0ff;
    border-color: #c7cdfa;
}
.cw__option--other {
    cursor: default;
    align-items: center;
}
.cw__option-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
}
.cw__option-label {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    font-size: 14px;
    font-weight: 500;
    color: #2b2b35;
}
.cw__option-text {
    overflow: hidden;
    text-overflow: ellipsis;
}
.cw__rec {
    font-size: 10px;
    font-weight: 600;
    color: #2F3990;
    background: #e6e8ff;
    padding: 2px 6px;
    border-radius: 4px;
    letter-spacing: 0.3px;
    text-transform: uppercase;
}
.cw__option-desc {
    font-size: 12px;
    color: #6b7280;
    line-height: 1.45;
}
.cw__kbd {
    flex-shrink: 0;
    margin-left: 8px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 22px;
    height: 22px;
    padding: 0 6px;
    font-size: 11px;
    font-family: inherit;
    color: #6b7280;
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 4px;
}

/* "Other" / "Custom" inline inputs */
.cw__inline-input,
.cw__other-input {
    appearance: none;
    border: 1px solid #e5e7eb;
    background: #fff;
    border-radius: 6px;
    padding: 6px 10px;
    font-size: 13px;
    color: #2b2b35;
    outline: none;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
    width: 100%;
}
.cw__inline-input:focus,
.cw__other-input:focus {
    border-color: #2F3990;
    box-shadow: 0 0 0 3px rgba(47, 57, 144, 0.18);
}
.cw__inline-input::placeholder,
.cw__other-input::placeholder {
    color: #9aa0a6;
}

/* Free-text textarea */
.cw__textarea {
    width: 100%;
    border: 1px solid #e5e7eb;
    border-radius: 10px;
    padding: 10px 12px;
    font-size: 13px;
    color: #2b2b35;
    background: #fff;
    outline: none;
    resize: vertical;
    min-height: 90px;
    max-height: 240px;
    font-family: inherit;
    line-height: 1.5;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.cw__textarea:focus {
    border-color: #2F3990;
    box-shadow: 0 0 0 3px rgba(47, 57, 144, 0.18);
}
.cw__textarea::placeholder {
    color: #9aa0a6;
}

/* ── Footer ────────────────────────────────────────────────────── */
.cw__foot {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-top: 4px;
    border-top: 1px solid #f0f1f3;
    margin-top: 4px;
    padding-top: 12px;
}
.cw__spacer {
    flex: 1;
}
.cw__btn {
    appearance: none;
    border: 1px solid transparent;
    border-radius: 8px;
    padding: 8px 14px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;
    white-space: nowrap;
    display: inline-flex;
    align-items: center;
    gap: 6px;
}
.cw__btn--ghost {
    background: transparent;
    border-color: #e5e7eb;
    color: #4b5563;
}
.cw__btn--ghost:hover:not(:disabled) {
    background: #f4f5f7;
    border-color: #d1d5db;
}
.cw__btn--unknown-active {
    background: #fff7ed;
    border-color: #fdba74;
    color: #9a3412;
}
.cw__btn--link {
    background: transparent;
    border-color: transparent;
    color: #6b7280;
    padding: 6px 8px;
}
.cw__btn--link:hover:not(:disabled) {
    color: #2F3990;
    background: transparent;
}
.cw__btn--primary {
    background: #2F3990;
    color: #fff;
    border-color: #2F3990;
}
.cw__btn--primary:hover:not(:disabled) {
    background: #252D75;
    border-color: #252D75;
}
.cw__btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
.cw__back-arrow {
    font-size: 14px;
    line-height: 1;
}
.cw__kbd--inline {
    color: rgba(255, 255, 255, 0.9);
    background: rgba(255, 255, 255, 0.15);
    border-color: rgba(255, 255, 255, 0.25);
}
.cw__btn--ghost .cw__kbd--inline,
.cw__btn--link .cw__kbd--inline {
    color: #6b7280;
    background: #fff;
    border-color: #e5e7eb;
}

/* ── Skeleton (loading questions) ─────────────────────────────── */
.cw__skeleton {
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 14px;
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 12px;
}
.cw__skeleton-line {
    height: 12px;
    border-radius: 4px;
    background: linear-gradient(90deg, #f0f1f3 0%, #e5e7eb 50%, #f0f1f3 100%);
    background-size: 200% 100%;
    animation: cw-shimmer 1.4s infinite;
}
.cw__skeleton-line--short {
    width: 30%;
    height: 10px;
}
.cw__skeleton-rows {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 6px;
}
.cw__skeleton-row {
    height: 44px;
    border-radius: 10px;
    background: linear-gradient(90deg, #f4f5f7 0%, #eaecf0 50%, #f4f5f7 100%);
    background-size: 200% 100%;
    animation: cw-shimmer 1.4s infinite;
}
@keyframes cw-shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
}

/* ── Error state ──────────────────────────────────────────────── */
.cw__error {
    background: #fff5f5;
    border: 1px solid #fecaca;
    border-radius: 10px;
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.cw__error-title {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: #c5343a;
}
.cw__error-msg {
    margin: 0;
    font-size: 12px;
    color: #4b5563;
    line-height: 1.5;
}
.cw__error-actions {
    display: flex;
    gap: 8px;
    margin-top: 4px;
}
</style>
