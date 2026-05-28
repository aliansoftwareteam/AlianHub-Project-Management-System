<template>
    <!--
        Once `generating` flips to true (the user clicked "Generate plan"
        and we're waiting on the LLM), the whole step becomes
        non-interactive — pointer-events: none on the root prevents any
        further answer edits, skips, or back-clicks until the plan call
        resolves. The visual cue is a slight dim so the user understands
        the screen is intentionally locked.
    -->
    <div
        class="clarify-step"
        :class="{ 'clarify-step--locked': generating }"
        :aria-busy="generating || null"
    >
        <!-- AI's "here's what I heard" banner -->
        <div v-if="understanding" class="clarify-step__understanding">
            <span class="clarify-step__understanding-icon">✦</span>
            <span class="clarify-step__understanding-text">{{ understanding }}</span>
        </div>

        <div v-if="!loading" class="clarify-step__meta">
            <span class="clarify-step__count">
                {{ questions.length }} {{ questions.length === 1 ? 'question' : 'questions' }} ·
                {{ estimatedMinutes }}
            </span>
        </div>

        <!-- Skeleton placeholders while the LLM is generating questions -->
        <template v-if="loading">
            <div
                v-for="n in 5"
                :key="`sk-${n}`"
                class="clarify-step__skeleton"
                aria-hidden="true"
            >
                <div class="clarify-step__skeleton-line clarify-step__skeleton-line--short"></div>
                <div class="clarify-step__skeleton-line"></div>
                <div class="clarify-step__skeleton-pills">
                    <span></span><span></span><span></span>
                </div>
            </div>
        </template>

        <!-- Error state -->
        <div v-else-if="errorMessage" class="clarify-step__error">
            <p class="clarify-step__error-title">Couldn't draft clarifying questions</p>
            <p class="clarify-step__error-msg">{{ errorMessage }}</p>
            <div class="clarify-step__error-actions">
                <button type="button" class="clarify-step__btn clarify-step__btn--ghost" @click="$emit('retry')">Try again</button>
                <button type="button" class="clarify-step__btn" @click="$emit('skip-all')">Skip and generate plan</button>
            </div>
        </div>

        <!-- Question list (grouped by category if many; flat otherwise) -->
        <template v-else>
            <template v-if="groupedView">
                <div
                    v-for="group in groups"
                    :key="group.category"
                    class="clarify-step__group"
                >
                    <div class="clarify-step__group-header">
                        <span class="clarify-step__group-title">{{ group.label }}</span>
                        <span class="clarify-step__group-meta">
                            {{ group.answered }} of {{ group.total }} answered
                        </span>
                    </div>
                    <div class="clarify-step__group-questions">
                        <QuestionCard
                            v-for="q in group.questions"
                            :key="q.id"
                            :question="q"
                            :answer="answers[q.id]"
                            :skipped="!!skipped[q.id]"
                            @update:answer="setAnswer(q.id, $event)"
                            @skip="toggleSkip(q.id)"
                        />
                    </div>
                </div>
            </template>
            <template v-else>
                <div class="clarify-step__questions">
                    <QuestionCard
                        v-for="q in questions"
                        :key="q.id"
                        :question="q"
                        :answer="answers[q.id]"
                        :skipped="!!skipped[q.id]"
                        @update:answer="setAnswer(q.id, $event)"
                        @skip="toggleSkip(q.id)"
                    />
                </div>
            </template>
        </template>

        <!-- Sticky bottom action bar -->
        <div v-if="!loading && !errorMessage" class="clarify-step__actions">
            <button
                type="button"
                class="clarify-step__btn clarify-step__btn--ghost"
                @click="$emit('back')"
            >
                ← Back
            </button>
            <button
                type="button"
                class="clarify-step__btn clarify-step__btn--ghost"
                :disabled="generating"
                @click="onLetAIDecide"
            >
                Let AI decide everything
            </button>
            <button
                type="button"
                class="clarify-step__btn clarify-step__btn--primary"
                :disabled="!canSubmit || generating"
                @click="onSubmit"
            >
                <span v-if="generating">Generating plan…</span>
                <span v-else-if="hasMissingRequired">Answer required questions</span>
                <span v-else>Generate plan ({{ counterText }})</span>
            </button>
        </div>
    </div>
</template>

<script setup>
import { defineProps, defineEmits, computed, reactive, watch } from 'vue';
import QuestionCard from './QuestionCard.vue';

const props = defineProps({
    loading: { type: Boolean, default: false },
    generating: { type: Boolean, default: false },
    understanding: { type: String, default: '' },
    questions: { type: Array, default: () => [] },
    errorMessage: { type: String, default: '' },
});

const emit = defineEmits(['submit', 'back', 'retry', 'skip-all']);

// Local answer + skipped state, keyed by question.id. Reset whenever the
// upstream questions array changes (e.g. user edited Step 1 description).
const answers = reactive({});
const skipped = reactive({});

watch(
    () => props.questions,
    (qs) => {
        // Clear old keys
        for (const k of Object.keys(answers)) delete answers[k];
        for (const k of Object.keys(skipped)) delete skipped[k];
        // Pre-fill recommended answers as defaults (the consultative move:
        // the AI already has an opinion, user can keep / change / skip).
        for (const q of qs || []) {
            if (q && q.id && q.recommended != null && q.type !== 'text') {
                answers[q.id] = cloneRecommended(q);
            }
        }
    },
    { immediate: true, deep: false },
);

function cloneRecommended(q) {
    const r = q.recommended;
    if (Array.isArray(r)) return [...r];
    return r;
}

function setAnswer(id, value) {
    answers[id] = value;
    // Touching a value clears the skipped flag for that question.
    if (skipped[id]) delete skipped[id];
}

function toggleSkip(id) {
    if (skipped[id]) {
        delete skipped[id];
    } else {
        skipped[id] = true;
        // Wipe any partial answer so we send a clean "skipped" upstream.
        delete answers[id];
    }
}

// ── grouping ─────────────────────────────────────────────────────────
// Plain-text group labels for the 8 core categories. Groups render in
// the spec sequence regardless of LLM order (see GROUP_ORDER below).
const GROUP_LABELS = {
    platform:     'Platform',
    features:     'Core Features',
    tech_stack:   'Tech Stack',
    integrations: 'Integrations',
    audience:     'Audience & Scale',
    timeline:     'Timeline',
    budget:       'Budget',
    compliance:   'Compliance & Region',
};
const GROUP_ORDER = [
    'platform', 'features', 'tech_stack', 'integrations',
    'audience', 'timeline', 'budget', 'compliance',
];

const groupedView = computed(() => (props.questions || []).length > 6);

const groups = computed(() => {
    const map = new Map();
    for (const q of props.questions || []) {
        const cat = q.category || 'other';
        if (!map.has(cat)) map.set(cat, []);
        map.get(cat).push(q);
    }
    // Render groups in spec order (Platform first, Compliance last).
    // Any unknown categories fall back to alphabetical at the end.
    const knownInOrder = GROUP_ORDER.filter((c) => map.has(c));
    const unknown = [...map.keys()].filter((c) => !GROUP_ORDER.includes(c)).sort();
    const out = [];
    for (const cat of [...knownInOrder, ...unknown]) {
        const qs = map.get(cat);
        const answeredCount = qs.filter((q) => isAnswered(q)).length;
        out.push({
            category: cat,
            label: GROUP_LABELS[cat] || 'Other',
            questions: qs,
            total: qs.length,
            answered: answeredCount,
        });
    }
    return out;
});

function isAnswered(q) {
    if (skipped[q.id]) return false;
    const a = answers[q.id];
    if (a == null) return false;
    if (Array.isArray(a)) return a.length > 0;
    if (typeof a === 'string') return a.trim().length > 0;
    if (typeof a === 'object') return !!a.value;
    return true;
}

// ── derived state ────────────────────────────────────────────────────
const answeredCount = computed(() => (props.questions || []).filter((q) => isAnswered(q)).length);

const hasMissingRequired = computed(() => {
    return (props.questions || []).some((q) => q.required && !isAnswered(q) && !skipped[q.id]);
});

const canSubmit = computed(() => !hasMissingRequired.value);

const counterText = computed(() => `${answeredCount.value}/${(props.questions || []).length}`);

const estimatedMinutes = computed(() => {
    const n = (props.questions || []).length;
    if (n === 0) return '';
    if (n <= 3) return '~30 seconds';
    if (n <= 6) return '~1 minute';
    if (n <= 9) return '~2 minutes';
    return '~3 minutes';
});

// ── emit shape ───────────────────────────────────────────────────────
// Build the clarifications array the backend expects:
//   [{ id, question, category, type, answer, skipped }]
function buildClarifications({ skipAll = false } = {}) {
    return (props.questions || []).map((q) => {
        const isSkipped = skipAll || !!skipped[q.id] || !isAnswered(q);
        return {
            id: q.id,
            question: q.question,
            category: q.category,
            type: q.type,
            answer: isSkipped ? null : answers[q.id],
            skipped: isSkipped,
        };
    });
}

function onSubmit() {
    if (!canSubmit.value) return;
    emit('submit', buildClarifications());
}

function onLetAIDecide() {
    emit('submit', buildClarifications({ skipAll: true }));
}
</script>

<style scoped>
.clarify-step {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding-bottom: 80px; /* leave room for sticky action bar */
}
/* Active during plan generation — blocks every interactive element under
   the step (inputs, skip links, Back, Let-AI-decide, even the primary
   button itself) so the user cannot mutate state mid-flight. Slight dim
   communicates the locked state visually. The CTA spinner remains
   visible because it lives on a button whose `disabled` attribute is
   also set — both signals reinforce the same affordance. */
.clarify-step--locked {
    pointer-events: none;
    opacity: 0.65;
    user-select: none;
}

.clarify-step__understanding {
    display: flex;
    gap: 10px;
    background: #eef0ff;
    border: 1px solid #c7cdfa;
    border-radius: 10px;
    padding: 12px 14px;
    font-size: 13px;
    color: #2b2b35;
    line-height: 1.5;
}
.clarify-step__understanding-icon {
    color: #2F3990;
    flex-shrink: 0;
    font-size: 14px;
    line-height: 1.5;
}
.clarify-step__understanding-text {
    flex: 1;
}

.clarify-step__meta {
    font-size: 12px;
    color: #6b7280;
}

.clarify-step__group {
    display: flex;
    flex-direction: column;
    gap: 10px;
}
.clarify-step__group-header {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 0 4px;
}
.clarify-step__group-title {
    font-size: 13px;
    font-weight: 600;
    color: #2b2b35;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}
.clarify-step__group-meta {
    font-size: 11px;
    color: #9aa0a6;
    margin-left: auto;
}
.clarify-step__group-questions,
.clarify-step__questions {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

/* Skeleton */
.clarify-step__skeleton {
    background: #fff;
    border: 1px solid #f0f1f3;
    border-radius: 12px;
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 10px;
}
.clarify-step__skeleton-line {
    height: 12px;
    background: linear-gradient(90deg, #f0f1f3 0%, #e5e7eb 50%, #f0f1f3 100%);
    background-size: 200% 100%;
    animation: shimmer 1.4s infinite;
    border-radius: 4px;
}
.clarify-step__skeleton-line--short {
    width: 30%;
    height: 10px;
}
.clarify-step__skeleton-pills {
    display: flex;
    gap: 8px;
    margin-top: 4px;
}
.clarify-step__skeleton-pills span {
    width: 70px;
    height: 28px;
    border-radius: 999px;
    background: linear-gradient(90deg, #f0f1f3 0%, #e5e7eb 50%, #f0f1f3 100%);
    background-size: 200% 100%;
    animation: shimmer 1.4s infinite;
}
@keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
}

/* Error */
.clarify-step__error {
    background: #fff5f5;
    border: 1px solid #fecaca;
    border-radius: 10px;
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.clarify-step__error-title {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: #c5343a;
}
.clarify-step__error-msg {
    margin: 0;
    font-size: 12px;
    color: #4b5563;
    line-height: 1.5;
}
.clarify-step__error-actions {
    display: flex;
    gap: 8px;
    margin-top: 4px;
}

/* Action bar */
.clarify-step__actions {
    position: sticky;
    bottom: 0;
    margin: 0 -18px -18px;
    padding: 12px 18px;
    background: #fff;
    border-top: 1px solid #f0f1f3;
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
}
.clarify-step__btn {
    appearance: none;
    border: 1px solid transparent;
    border-radius: 8px;
    padding: 8px 14px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;
    white-space: nowrap;
}
.clarify-step__btn--ghost {
    background: transparent;
    border-color: #e5e7eb;
    color: #4b5563;
}
.clarify-step__btn--ghost:hover:not(:disabled) {
    background: #f4f5f7;
    border-color: #d1d5db;
}
.clarify-step__btn--primary {
    background: #2F3990;
    color: #fff;
    border-color: #2F3990;
    margin-left: auto;
}
.clarify-step__btn--primary:hover:not(:disabled) {
    background: #252D75;
    border-color: #252D75;
}
.clarify-step__btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
</style>
