<template>
    <!--
        Single-choice cards with descriptions. Used when each option needs
        explanation (trade-offs aren't obvious from the label).
    -->
    <div class="radio-cards" role="radiogroup">
        <button
            v-for="opt in options"
            :key="opt.value"
            type="button"
            class="radio-cards__card"
            :class="{
                'radio-cards__card--selected': modelValue === opt.value,
                'radio-cards__card--recommended': recommended === opt.value && modelValue !== opt.value,
            }"
            role="radio"
            :aria-checked="modelValue === opt.value"
            @click="emit('update:modelValue', opt.value)"
        >
            <span class="radio-cards__radio" aria-hidden="true">
                <span class="radio-cards__radio-dot" v-if="modelValue === opt.value"></span>
            </span>
            <span class="radio-cards__body">
                <span class="radio-cards__title">
                    {{ opt.label }}
                    <span v-if="recommended === opt.value" class="radio-cards__rec-pill">Recommended</span>
                </span>
                <span v-if="opt.description" class="radio-cards__desc">{{ opt.description }}</span>
            </span>
        </button>
    </div>
</template>

<script setup>
import { defineProps, defineEmits } from 'vue';

defineProps({
    modelValue: { type: [String, Number, null], default: null },
    options: { type: Array, required: true },
    recommended: { type: [String, null], default: null },
});
const emit = defineEmits(['update:modelValue']);
</script>

<style scoped>
.radio-cards {
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.radio-cards__card {
    appearance: none;
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 10px;
    padding: 12px 14px;
    font: inherit;
    color: #2b2b35;
    cursor: pointer;
    text-align: left;
    display: flex;
    align-items: flex-start;
    gap: 12px;
    transition: background-color 0.15s ease, border-color 0.15s ease;
}
.radio-cards__card:hover:not(.radio-cards__card--selected) {
    background: #f8f9fb;
    border-color: #d1d5db;
}
.radio-cards__card--selected {
    background: #eef0ff;
    border-color: #2F3990;
}
.radio-cards__card--recommended {
    border-color: #c7cdfa;
}
.radio-cards__radio {
    flex-shrink: 0;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 1.5px solid #d1d5db;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-top: 2px;
    background: #fff;
}
.radio-cards__card--selected .radio-cards__radio {
    border-color: #2F3990;
}
.radio-cards__radio-dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: #2F3990;
}
.radio-cards__body {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
}
.radio-cards__title {
    font-size: 14px;
    font-weight: 500;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
}
.radio-cards__rec-pill {
    font-size: 10px;
    font-weight: 600;
    color: #2F3990;
    background: #e6e8ff;
    padding: 2px 6px;
    border-radius: 4px;
    letter-spacing: 0.3px;
    text-transform: uppercase;
}
.radio-cards__desc {
    font-size: 12px;
    color: #6b7280;
    line-height: 1.45;
}
</style>
