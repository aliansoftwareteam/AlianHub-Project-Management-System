<template>
    <div class="ah-field">
        <label class="ah-field__label" for="fb-rating-max">{{ $t('FieldTypes.rating_max_label') }}</label>
        <input
            id="fb-rating-max"
            class="ah-input"
            :class="{ 'ah-input--error': error }"
            type="number"
            inputmode="numeric"
            step="1"
            data-rating-max
            :min="MAX_RANGE.min"
            :max="MAX_RANGE.max"
            :value="modelValue.fieldRatingMax"
            :aria-describedby="error ? 'fb-rating-max-error' : 'fb-rating-max-hint'"
            @input="$emit('update:modelValue', { ...modelValue, fieldRatingMax: $event.target.value })"
        />
        <span v-if="error" id="fb-rating-max-error" class="ah-field__error">{{ error }}</span>
        <span v-else id="fb-rating-max-hint" class="ftrs__hint">{{ $t('FieldTypes.rating_max_hint', MAX_RANGE) }}</span>
    </div>
</template>

<script setup>
import { MAX_RANGE } from "@fieldTypes/rating";

defineOptions({ name: "RatingFieldSettings" });

defineProps({
    modelValue: { type: Object, required: true },
    error: { type: String, default: "" }
});
defineEmits(["update:modelValue"]);
</script>

<style>
.ftrs__hint { color: var(--ink-2); font: var(--text-small); }
</style>
