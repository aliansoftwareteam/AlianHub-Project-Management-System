<template>
    <label class="ftps">
        <input
            type="checkbox"
            class="ah-check"
            data-people-multiple
            :checked="modelValue.fieldMultiple !== false"
            @change="$emit('update:modelValue', { ...modelValue, fieldMultiple: $event.target.checked })"
        />
        <span>
            <span class="ftps__label">{{ $t('FieldTypes.people_multiple_label') }}</span>
            <span class="ftps__hint">{{ $t('FieldTypes.people_multiple_hint') }}</span>
        </span>
    </label>
</template>

<script setup>
defineOptions({ name: "PeopleFieldSettings" });

defineProps({
    modelValue: { type: Object, required: true },
    error: { type: String, default: "" }
});
defineEmits(["update:modelValue"]);
</script>

<style>
.ftps { display: flex; align-items: flex-start; gap: 8px; margin: 0; cursor: pointer; }
.ftps__label { display: block; color: var(--ink); font: var(--text-body); }
.ftps__hint { display: block; color: var(--ink-2); font: var(--text-small); }
</style>
