<template>
    <div v-if="field && needsValue(comparison)" class="cffv">
        <div v-if="LIST_TYPES.includes(field.fieldType)" class="cffv__options" role="group" :aria-label="$t('Filters.cf_choose')">
            <label v-for="option in options" :key="option.id" class="cffv__option">
                <input type="checkbox" :value="String(option.id)" :checked="chosen.includes(String(option.id))" @change="toggle(String(option.id), $event.target.checked)" />
                <span v-if="field.fieldType === 'dropdown'" class="cffv__swatch" :style="{ background: option.color || 'var(--ink-3)' }" aria-hidden="true"></span>
                <span class="cffv__text">{{ option.label || option.value }}</span>
            </label>
            <p v-if="!options.length" class="cffv__empty">{{ $t('Filters.no_data_found') }}</p>
        </div>
        <RelationshipFilterValue v-else-if="field.fieldType === 'relationship'" :field="field" :modelValue="modelValue" @update:modelValue="$emit('update:modelValue', $event)" />
        <select
            v-else-if="field.fieldType === 'checkbox'"
            class="cffv__input"
            :aria-label="$t('Filters.cf_value')"
            :value="modelValue[0] === false ? 'false' : 'true'"
            @change="$emit('update:modelValue', [$event.target.value === 'true'])"
        >
            <option value="true">{{ $t('Filters.Yes') }}</option>
            <option value="false">{{ $t('Filters.No') }}</option>
        </select>
        <input
            v-else
            class="cffv__input"
            :type="inputType"
            :aria-label="$t('Filters.cf_value')"
            :placeholder="$t('Filters.cf_value')"
            :value="modelValue[0] ?? ''"
            @input="onInput($event.target.value)"
        />
    </div>
</template>

<script setup>
import { computed, watch } from "vue";
import { needsValue } from "@/views/Projects/composables/customFieldQuery";
import RelationshipFilterValue from "@/plugins/customFieldView/fieldTypes/RelationshipFilterValue.vue";

defineOptions({ name: "CustomFieldFilterValue" });

const props = defineProps({
    field: { type: Object, default: null },
    comparison: { type: String, default: "" },
    modelValue: { type: Array, default: () => [] },
    people: { type: Array, default: () => [] }
});
const emit = defineEmits(["update:modelValue"]);

const LIST_TYPES = ["dropdown", "people"];
const NUMBER_TYPES = ["number", "money", "rating", "progress", "voting"];
const USER_ID = /^[a-f0-9]{24}$/i;

/* The assignee filter's list also carries "me" and teams; a people field holds people only. */
const peopleOptions = computed(() => props.people
    .filter((person) => USER_ID.test(String(person?.value || "")))
    .map((person) => ({ id: person.value, label: person.name })));
const options = computed(() => (props.field?.fieldType === "people"
    ? peopleOptions.value
    : (props.field?.fieldOptions || []).filter((option) => option && option.id !== undefined && option.id !== null)));
const chosen = computed(() => props.modelValue.map(String));
const inputType = computed(() => {
    if (NUMBER_TYPES.includes(props.field?.fieldType)) return "number";
    if (props.field?.fieldType === "date") return "date";
    return "text";
});

function toggle(id, on) {
    const rest = chosen.value.filter((value) => value !== id);
    emit("update:modelValue", on ? [...rest, id] : rest);
}

function onInput(raw) {
    const text = String(raw ?? "").trim();
    if (!text) {
        emit("update:modelValue", []);
        return;
    }
    if (inputType.value === "number") {
        const number = Number(text);
        emit("update:modelValue", Number.isFinite(number) ? [number] : []);
        return;
    }
    emit("update:modelValue", [text]);
}

/* A checkbox row reads "Yes" before anything is picked, so it starts with that value. */
watch(() => [props.field?.fieldType, props.comparison], ([type, comparison]) => {
    if (type === "checkbox" && needsValue(comparison) && !props.modelValue.length) emit("update:modelValue", [true]);
}, { immediate: true });
</script>

<style>
.cffv { width: 211px; max-width: 100%; }
.cffv__input {
    width: 100%; height: 32px; padding: 0 8px;
    border: 1px solid var(--border); border-radius: 6px;
    background: var(--surface); color: var(--ink);
    font: var(--text-small);
}
.cffv__input:focus-visible { outline: none; box-shadow: var(--focus); }
.cffv__options {
    max-height: 160px; overflow-y: auto; padding: 4px;
    border: 1px solid var(--border); border-radius: 6px;
    background: var(--surface); color: var(--ink);
}
.cffv__option { display: flex; align-items: center; gap: 8px; margin: 0; padding: 4px; border-radius: 6px; cursor: pointer; font: var(--text-small); }
.cffv__option:hover { background: var(--surface-hover); }
.cffv__option input { accent-color: var(--brand); margin: 0; flex: none; }
.cffv__option input:focus-visible { outline: none; box-shadow: var(--focus); }
.cffv__swatch { width: 10px; height: 10px; border-radius: 3px; flex: none; }
.cffv__text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cffv__empty { margin: 0; padding: 4px; font: var(--text-small); color: var(--ink-2); }

@media (max-width: 767px) {
    .cffv { width: 100%; margin-bottom: 20px; }
    .cffv__input { height: 40px; font-size: 16px; }
}
</style>
