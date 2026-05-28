<template>
    <!--
        Single-choice bucket chips with a "Custom" escape that reveals a
        small free-text input. modelValue is either:
          - the chosen option's `value` (string), or
          - { value: 'custom', customText: '...' } when the user picks custom.
    -->
    <div class="preset-chips">
        <div class="preset-chips__row">
            <button
                v-for="opt in options"
                :key="opt.value"
                type="button"
                class="preset-chips__chip"
                :class="{
                    'preset-chips__chip--selected': isSelected(opt.value),
                    'preset-chips__chip--recommended': recommended === opt.value && !isSelected(opt.value),
                }"
                @click="pick(opt.value)"
            >
                <span v-if="recommended === opt.value && !isSelected(opt.value)" class="preset-chips__rec" aria-hidden="true">✦</span>
                {{ opt.label }}
            </button>
        </div>
        <input
            v-if="isCustomSelected"
            v-model="customText"
            type="text"
            class="preset-chips__custom-input"
            placeholder="Type your answer…"
            maxlength="200"
            @input="emitCustom"
        />
    </div>
</template>

<script setup>
import { defineProps, defineEmits, computed, ref, watch } from 'vue';

const props = defineProps({
    modelValue: { type: [String, Object, null], default: null },
    options: { type: Array, required: true },
    recommended: { type: [String, null], default: null },
});
const emit = defineEmits(['update:modelValue']);

const selectedValue = computed(() => {
    if (props.modelValue == null) return null;
    if (typeof props.modelValue === 'string') return props.modelValue;
    if (typeof props.modelValue === 'object' && props.modelValue.value) return props.modelValue.value;
    return null;
});

const isCustomSelected = computed(() => selectedValue.value === 'custom');
const customText = ref(typeof props.modelValue === 'object' && props.modelValue ? (props.modelValue.customText || '') : '');

watch(() => props.modelValue, (val) => {
    if (typeof val === 'object' && val) {
        customText.value = val.customText || '';
    } else if (typeof val === 'string' && val !== 'custom') {
        customText.value = '';
    }
});

function isSelected(value) {
    return selectedValue.value === value;
}

function pick(value) {
    if (value === 'custom') {
        emit('update:modelValue', { value: 'custom', customText: customText.value || '' });
    } else {
        emit('update:modelValue', value);
    }
}

function emitCustom() {
    emit('update:modelValue', { value: 'custom', customText: customText.value });
}
</script>

<style scoped>
.preset-chips {
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.preset-chips__row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}
.preset-chips__chip {
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
.preset-chips__chip:hover:not(.preset-chips__chip--selected) {
    background: #f4f5f7;
    border-color: #d1d5db;
}
.preset-chips__chip--selected {
    background: #eef0ff;
    border-color: #2F3990;
    color: #2b2b35;
    font-weight: 500;
}
.preset-chips__chip--recommended {
    border-color: #c7cdfa;
}
.preset-chips__rec {
    color: #2F3990;
    font-size: 11px;
    line-height: 1;
}
.preset-chips__custom-input {
    width: 100%;
    max-width: 360px;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 7px 10px;
    font-size: 13px;
    background: #f8f9fb;
    outline: none;
    transition: border-color 0.15s ease, background-color 0.15s ease;
}
.preset-chips__custom-input:focus {
    border-color: #2F3990;
    background: #fff;
    box-shadow: 0 0 0 3px rgba(47, 57, 144, 0.18);
}
</style>
