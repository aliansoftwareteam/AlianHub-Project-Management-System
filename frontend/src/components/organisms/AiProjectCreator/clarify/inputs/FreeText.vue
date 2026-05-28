<template>
    <!-- Free-form short answer. Last-resort input type. -->
    <textarea
        class="free-text__input"
        :value="modelValue || ''"
        :placeholder="placeholder || 'Type your answer…'"
        maxlength="500"
        rows="2"
        @input="onInput"
    />
</template>

<script setup>
import { defineProps, defineEmits } from 'vue';

defineProps({
    modelValue: { type: [String, null], default: '' },
    placeholder: { type: String, default: '' },
});
const emit = defineEmits(['update:modelValue']);

function onInput(e) {
    emit('update:modelValue', e.target.value);
}
</script>

<style scoped>
.free-text__input {
    width: 100%;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 8px 10px;
    font-size: 13px;
    background: #f8f9fb;
    outline: none;
    resize: vertical;
    min-height: 60px;
    max-height: 200px;
    transition: border-color 0.15s ease, background-color 0.15s ease;
    font-family: inherit;
    color: #2b2b35;
}
.free-text__input:focus {
    border-color: #2F3990;
    background: #fff;
    box-shadow: 0 0 0 3px rgba(47, 57, 144, 0.18);
}
.free-text__input::placeholder {
    color: #9aa0a6;
}
</style>
