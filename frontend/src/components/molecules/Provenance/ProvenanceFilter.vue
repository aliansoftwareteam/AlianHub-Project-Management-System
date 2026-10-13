<template>
    <span class="pv-filter" :class="{ 'is-active': modelValue !== ALL }">
        <select
            class="pv-filter__select"
            :aria-label="$t('Provenance.filter_label')"
            :value="modelValue"
            @change="$emit('update:modelValue', $event.target.value)"
        >
            <option v-for="option in DONE_BY_OPTIONS" :key="option" :value="option">
                {{ $t('Provenance.done_by', { value: $t(`Provenance.opt_${option}`) }) }}
            </option>
        </select>
        <ShellIcon name="chevronDown" :size="12" class="pv-filter__caret" aria-hidden="true" />
    </span>
</template>

<script setup>
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { ALL, DONE_BY_OPTIONS } from "./doneByQuery";
import "./style.css";

defineOptions({ name: "ProvenanceFilter" });

defineProps({
    modelValue: { type: String, default: ALL }
});
defineEmits(["update:modelValue"]);
</script>
