<template>
    <!--
        One clarifying question. Header (category + required + skip),
        question text, optional rationale, the right input element, and an
        AI hint line below.
    -->
    <div
        class="question-card"
        :class="{
            'question-card--answered': answered,
            'question-card--skipped': skipped,
        }"
    >
        <div class="question-card__header">
            <span class="question-card__category">{{ categoryLabel }}</span>
            <span v-if="question.required" class="question-card__required">Required</span>
            <button
                v-if="!skipped"
                type="button"
                class="question-card__skip"
                @click="$emit('skip')"
            >
                Let AI decide
            </button>
            <button
                v-else
                type="button"
                class="question-card__skip question-card__skip--restore"
                @click="$emit('skip')"
            >
                ← Answer this
            </button>
        </div>

        <div class="question-card__question">
            <span>{{ question.question }}</span>
            <button
                v-if="question.rationale"
                type="button"
                class="question-card__why"
                :aria-expanded="showRationale"
                @click="showRationale = !showRationale"
            >
                ⓘ Why we ask
            </button>
        </div>

        <div v-if="showRationale && question.rationale" class="question-card__rationale">
            {{ question.rationale }}
        </div>

        <div v-if="!skipped" class="question-card__input">
            <component
                :is="inputComponent"
                v-bind="inputProps"
                :model-value="answer"
                @update:model-value="$emit('update:answer', $event)"
            />
        </div>

        <div v-if="!skipped && question.hint" class="question-card__hint">
            <span class="question-card__hint-icon">✦</span>
            {{ question.hint }}
        </div>

        <div v-if="skipped" class="question-card__skipped-note">
            The AI will decide this based on the brief. You can restore the question above.
        </div>
    </div>
</template>

<script setup>
import { defineProps, defineEmits, computed, ref } from 'vue';
import SegmentedSelect from './inputs/SegmentedSelect.vue';
import RadioCards from './inputs/RadioCards.vue';
import ToggleChips from './inputs/ToggleChips.vue';
import ToggleSwitch from './inputs/ToggleSwitch.vue';
import PresetChips from './inputs/PresetChips.vue';
import FreeText from './inputs/FreeText.vue';
import SelectDropdown from './inputs/SelectDropdown.vue';

const props = defineProps({
    question: { type: Object, required: true },
    answer: { default: null },
    skipped: { type: Boolean, default: false },
});

defineEmits(['update:answer', 'skip']);

const showRationale = ref(false);

// Plain text labels for the 8 core categories. (Emojis were removed in
// favor of a cleaner, more enterprise-feeling chip.)
const CATEGORY_LABELS = {
    platform:     'Platform',
    features:     'Core Features',
    tech_stack:   'Tech Stack',
    integrations: 'Integrations',
    audience:     'Audience & Scale',
    timeline:     'Timeline',
    budget:       'Budget',
    compliance:   'Compliance & Region',
};

const categoryLabel = computed(() => CATEGORY_LABELS[props.question.category] || 'Other');

const answered = computed(() => {
    if (props.skipped) return false;
    const a = props.answer;
    if (a == null) return false;
    if (Array.isArray(a)) return a.length > 0;
    if (typeof a === 'string') return a.trim().length > 0;
    if (typeof a === 'object') return !!a.value;
    return true; // boolean answers count once set
});

const INPUT_BY_TYPE = {
    segmented: SegmentedSelect,
    radio_cards: RadioCards,
    toggle_chips: ToggleChips,
    toggle: ToggleSwitch,
    preset_chips: PresetChips,
    text: FreeText,
    select_card: SelectDropdown,
};

const inputComponent = computed(() => INPUT_BY_TYPE[props.question.type] || FreeText);

// Each input atom accepts a slightly different prop shape — keep that
// wiring centralized here so QuestionCard's parent doesn't have to know.
const inputProps = computed(() => {
    const q = props.question;
    const base = {};
    if (q.type === 'segmented' || q.type === 'select_card' ||q.type === 'radio_cards') {
        base.options = q.options || [];
        base.recommended = typeof q.recommended === 'string' ? q.recommended : null;
    } else if (q.type === 'toggle_chips') {
        base.options = q.options || [];
        base.recommended = Array.isArray(q.recommended) ? q.recommended : [];
    } else if (q.type === 'toggle') {
        base.recommended = typeof q.recommended === 'boolean' ? q.recommended : null;
    } else if (q.type === 'preset_chips') {
        base.options = q.options || [];
        base.recommended = typeof q.recommended === 'string' ? q.recommended : null;
    } else if (q.type === 'text') {
        base.placeholder = typeof q.recommended === 'string' ? q.recommended : '';
    }
    return base;
});
</script>

<style scoped>
.question-card {
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 12px;
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    transition: border-color 0.15s ease, background-color 0.15s ease;
}
.question-card--skipped {
    background: #fafbfc;
}

.question-card__header {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
}
.question-card__category {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    color: #2F3990;
    background: #e6e8ff;
    padding: 3px 8px;
    border-radius: 4px;
}
.question-card__required {
    font-size: 10px;
    font-weight: 600;
    color: #b07000;
    background: #fff3d6;
    padding: 3px 8px;
    border-radius: 4px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
}
.question-card__skip {
    margin-left: auto;
    appearance: none;
    background: transparent;
    border: none;
    color: #6b7280;
    font-size: 12px;
    cursor: pointer;
    padding: 4px 6px;
    border-radius: 4px;
    transition: background-color 0.15s ease, color 0.15s ease;
}
.question-card__skip:hover {
    background: #f4f5f7;
    color: #2b2b35;
}
.question-card__skip--restore {
    color: #2F3990;
}

.question-card__question {
    font-size: 15px;
    font-weight: 600;
    color: #2b2b35;
    line-height: 1.4;
    display: flex;
    flex-direction: column;
    gap: 4px;
    align-items: flex-start;
}
.question-card__why {
    appearance: none;
    background: transparent;
    border: none;
    color: #6b7280;
    font-size: 11px;
    cursor: pointer;
    padding: 0;
    text-align: left;
}
.question-card__why:hover {
    color: #2F3990;
}
.question-card__rationale {
    font-size: 12px;
    color: #4b5563;
    background: #f8f9fb;
    border-radius: 6px;
    padding: 8px 10px;
    line-height: 1.5;
}

.question-card__input {
    margin-top: 2px;
}

.question-card__hint {
    font-size: 12px;
    color: #6b7280;
    line-height: 1.5;
    display: flex;
    gap: 6px;
    align-items: flex-start;
}
.question-card__hint-icon {
    color: #2F3990;
    flex-shrink: 0;
    margin-top: 1px;
}

.question-card__skipped-note {
    font-size: 12px;
    color: #6b7280;
    font-style: italic;
}
</style>
