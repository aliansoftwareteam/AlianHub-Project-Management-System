<template>
    <!--
        Multi-choice chip selector. modelValue is an array of selected
        option values. AI-recommended chips show a small ✦ when not
        already selected.
    -->
    <div class="toggle-chips" role="group">
        <button
            v-for="opt in options"
            :key="opt.value"
            type="button"
            class="toggle-chips__chip"
            :class="{
                'toggle-chips__chip--selected': isSelected(opt.value),
                'toggle-chips__chip--recommended': isRecommended(opt.value) && !isSelected(opt.value),
            }"
            :aria-pressed="isSelected(opt.value)"
            @click="toggle(opt.value)"
        >
            <span v-if="isRecommended(opt.value) && !isSelected(opt.value)" class="toggle-chips__rec" aria-hidden="true">✦</span>
            <span v-if="isSelected(opt.value)" class="toggle-chips__check" aria-hidden="true">✓</span>
            {{ opt.label }}
        </button>
    </div>
</template>

<script setup>
import { defineProps, defineEmits, computed } from 'vue';

const props = defineProps({
    modelValue: { type: Array, default: () => [] },
    options: { type: Array, required: true },
    recommended: { type: Array, default: () => [] },
});
const emit = defineEmits(['update:modelValue']);

const selectedSet = computed(() => new Set((props.modelValue || []).map(String)));
const recommendedSet = computed(() => new Set((props.recommended || []).map(String)));

function isSelected(value) { return selectedSet.value.has(String(value)); }
function isRecommended(value) { return recommendedSet.value.has(String(value)); }

function toggle(value) {
    const v = String(value);
    const current = (props.modelValue || []).map(String);
    const next = current.includes(v)
        ? current.filter((x) => x !== v)
        : [...current, v];
    emit('update:modelValue', next);
}
</script>

<style scoped>
.toggle-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}
.toggle-chips__chip {
    appearance: none;
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 999px;
    padding: 7px 14px;
    font-size: 13px;
    color: #374151;
    cursor: pointer;
    transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;
    display: inline-flex;
    align-items: center;
    gap: 6px;
}
.toggle-chips__chip:hover:not(.toggle-chips__chip--selected) {
    background: #f4f5f7;
    border-color: #d1d5db;
}
.toggle-chips__chip--selected {
    background: #eef0ff;
    border-color: #2F3990;
    color: #2b2b35;
    font-weight: 500;
}
.toggle-chips__chip--recommended {
    border-color: #c7cdfa;
}
.toggle-chips__rec {
    color: #2F3990;
    font-size: 11px;
    line-height: 1;
}
.toggle-chips__check {
    color: #2F3990;
    font-size: 12px;
    line-height: 1;
    font-weight: 700;
}
</style>
