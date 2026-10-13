<template>
    <label class="ftvs">
        <input
            type="checkbox"
            class="ah-check"
            data-voters-shown
            :checked="modelValue.fieldVotersShown !== false"
            @change="$emit('update:modelValue', { ...modelValue, fieldVotersShown: $event.target.checked })"
        />
        <span>
            <span class="ftvs__label">{{ $t('FieldTypes.voting_shown_label') }}</span>
            <span class="ftvs__hint">{{ $t('FieldTypes.voting_shown_hint') }}</span>
        </span>
    </label>
</template>

<script setup>
defineOptions({ name: "VotingFieldSettings" });

defineProps({
    modelValue: { type: Object, required: true },
    error: { type: String, default: "" }
});
defineEmits(["update:modelValue"]);
</script>

<style>
.ftvs { display: flex; align-items: flex-start; gap: 8px; margin: 0; cursor: pointer; }
.ftvs__label { display: block; color: var(--ink); font: var(--text-body); }
.ftvs__hint { display: block; color: var(--ink-2); font: var(--text-small); }
</style>
