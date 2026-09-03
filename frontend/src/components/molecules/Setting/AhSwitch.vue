<template>
    <button
        type="button"
        role="switch"
        class="ah-switch"
        :class="{ 'is-on': modelValue, 'is-disabled': disabled, 'ah-switch--sm': small }"
        :aria-checked="modelValue ? 'true' : 'false'"
        :aria-label="label"
        :title="label"
        :disabled="disabled"
        @click="emit('update:modelValue', !modelValue)"
    >
        <span class="ah-switch__knob"></span>
    </button>
</template>

<script setup>
defineOptions({ name: "AhSwitch" });
defineProps({
    modelValue: { type: Boolean, default: false },
    disabled: { type: Boolean, default: false },
    small: { type: Boolean, default: false },
    label: { type: String, default: "" }
});
const emit = defineEmits(["update:modelValue"]);
</script>

<style>
.ah-switch {
    position: relative;
    width: 34px;
    height: 20px;
    border-radius: 10px;
    border: 0;
    padding: 0;
    background: var(--border);
    cursor: pointer;
    flex: none;
    transition: background var(--t-state) var(--ease);
}
.ah-switch--sm { width: 30px; height: 18px; }
.ah-switch__knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 2px rgba(0, 0, 0, .18);
    transition: transform var(--t-state) var(--ease);
}
.ah-switch--sm .ah-switch__knob { width: 14px; height: 14px; }
.ah-switch.is-on { background: var(--brand); }
.ah-switch.is-on .ah-switch__knob { transform: translateX(14px); }
.ah-switch--sm.is-on .ah-switch__knob { transform: translateX(12px); }
.ah-switch:focus-visible { outline: none; box-shadow: var(--focus); }
.ah-switch.is-disabled, .ah-switch:disabled { opacity: .5; cursor: not-allowed; }
</style>
