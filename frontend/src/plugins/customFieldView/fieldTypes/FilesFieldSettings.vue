<template>
    <div class="ftfs">
        <div class="ah-field">
            <label class="ah-field__label" for="fb-files-max">{{ $t('FieldTypes.files_max_label') }}</label>
            <input
                id="fb-files-max"
                class="ah-input"
                :class="{ 'ah-input--error': error }"
                type="number"
                inputmode="numeric"
                step="1"
                data-files-max
                :min="MAX_RANGE.min"
                :max="MAX_RANGE.max"
                :value="modelValue.fieldFilesMax"
                :aria-describedby="error ? 'fb-files-max-error' : 'fb-files-max-hint'"
                @input="$emit('update:modelValue', { ...modelValue, fieldFilesMax: $event.target.value })"
            />
            <span v-if="error" id="fb-files-max-error" class="ah-field__error">{{ error }}</span>
            <span v-else id="fb-files-max-hint" class="ftfs__hint">{{ $t('FieldTypes.files_max_hint', MAX_RANGE) }}</span>
        </div>
        <div class="ah-field">
            <label class="ah-field__label" for="fb-files-kind">{{ $t('FieldTypes.files_kind_label') }}</label>
            <select
                id="fb-files-kind"
                class="ah-input"
                data-files-kind
                :value="modelValue.fieldFilesKind || 'any'"
                @change="$emit('update:modelValue', { ...modelValue, fieldFilesKind: $event.target.value })"
            >
                <option v-for="kind in KINDS" :key="kind" :value="kind">{{ $t(`FieldTypes.files_kind_${kind}`) }}</option>
            </select>
        </div>
    </div>
</template>

<script setup>
import { KINDS, MAX_RANGE } from "@fieldTypes/files";

defineOptions({ name: "FilesFieldSettings" });

defineProps({
    modelValue: { type: Object, required: true },
    error: { type: String, default: "" }
});
defineEmits(["update:modelValue"]);
</script>

<style>
.ftfs { display: flex; flex-direction: column; gap: 16px; }
.ftfs__hint { color: var(--ink-2); font: var(--text-small); }
</style>
