<template>
    <!--
        Yes / No switch. modelValue is a boolean. Recommended state shows
        a small hint label.
    -->
    <div class="toggle-switch">
        <button
            type="button"
            class="toggle-switch__track"
            :class="{ 'toggle-switch__track--on': modelValue === true }"
            role="switch"
            :aria-checked="modelValue === true"
            @click="emit('update:modelValue', !modelValue)"
        >
            <span class="toggle-switch__thumb"></span>
        </button>
        <span class="toggle-switch__label">{{ modelValue === true ? yesLabel : noLabel }}</span>
        <span
            v-if="recommended !== null && recommended !== undefined && modelValue !== recommended"
            class="toggle-switch__rec"
        >
            ✦ recommended: {{ recommended ? yesLabel : noLabel }}
        </span>
    </div>
</template>

<script setup>
import { defineProps, defineEmits } from 'vue';

defineProps({
    modelValue: { type: [Boolean, null], default: null },
    recommended: { type: [Boolean, null], default: null },
    yesLabel: { type: String, default: 'Yes' },
    noLabel: { type: String, default: 'No' },
});
const emit = defineEmits(['update:modelValue']);
</script>

<style scoped>
.toggle-switch {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
}
.toggle-switch__track {
    appearance: none;
    width: 40px;
    height: 22px;
    background: #d1d5db;
    border-radius: 999px;
    border: none;
    position: relative;
    cursor: pointer;
    transition: background-color 0.15s ease;
    padding: 0;
}
.toggle-switch__track--on {
    background: #2F3990;
}
.toggle-switch__thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 18px;
    height: 18px;
    background: #fff;
    border-radius: 50%;
    transition: transform 0.15s ease;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
}
.toggle-switch__track--on .toggle-switch__thumb {
    transform: translateX(18px);
}
.toggle-switch__label {
    font-size: 13px;
    color: #2b2b35;
    font-weight: 500;
}
.toggle-switch__rec {
    font-size: 11px;
    color: #2F3990;
}
</style>
