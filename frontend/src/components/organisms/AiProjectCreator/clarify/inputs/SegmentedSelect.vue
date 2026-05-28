<template>
    <!--
        Single-choice pill selector. 2–4 short options laid out as a row of
        pills. The AI-recommended option carries a small ✦ glyph.
    -->
    <div class="segmented-select" role="radiogroup">
        <button
            v-for="opt in options"
            :key="opt.value"
            type="button"
            class="segmented-select__pill"
            :class="{
                'segmented-select__pill--selected': modelValue === opt.value,
                'segmented-select__pill--recommended': recommended === opt.value && modelValue !== opt.value,
            }"
            role="radio"
            :aria-checked="modelValue === opt.value"
            @click="emit('update:modelValue', opt.value)"
        >
            <span v-if="recommended === opt.value" class="segmented-select__rec" aria-hidden="true">✦</span>
            {{ opt.label }}
        </button>
    </div>
</template>

<script setup>
import { defineProps, defineEmits } from 'vue';

defineProps({
    modelValue: { type: [String, Number, Boolean, null], default: null },
    options: {
        type: Array,
        required: true,
        // each: { value, label }
    },
    recommended: { type: [String, null], default: null },
});
const emit = defineEmits(['update:modelValue']);
</script>

<style scoped>
.segmented-select {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}
.segmented-select__pill {
    appearance: none;
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 999px;
    padding: 8px 16px;
    font-size: 13px;
    color: #374151;
    cursor: pointer;
    transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
}
.segmented-select__pill:hover:not(.segmented-select__pill--selected) {
    background: #f4f5f7;
    border-color: #d1d5db;
}
.segmented-select__pill--selected {
    background: #eef0ff;
    border-color: #2F3990;
    color: #2b2b35;
    font-weight: 500;
}
.segmented-select__pill--recommended {
    border-color: #c7cdfa;
}
.segmented-select__rec {
    color: #2F3990;
    font-size: 11px;
    line-height: 1;
}
</style>
