<template>
    <fieldset class="ftt">
        <legend class="ftt__label">{{ $t('Fields.task_types_label') }}</legend>
        <p class="ftt__hint">{{ $t('Fields.task_types_hint') }}</p>
        <div v-if="options.length" class="ftt__list">
            <label v-for="option in options" :key="option.key" class="ftt__option" :class="{ 'is-on': chosen.includes(option.key) }">
                <input
                    type="checkbox"
                    class="ftt__check"
                    :checked="chosen.includes(option.key)"
                    @change="toggle(option.key, $event.target.checked)"
                />
                <TaskTypeIcon v-if="option.taskType" :taskType="option.taskType" class="ftt__icon" aria-hidden="true" />
                <span class="ftt__name">{{ option.missing ? $t('Fields.task_type_missing', { key: option.key }) : option.name }}</span>
            </label>
        </div>
        <p v-else class="ftt__hint">{{ $t('Fields.task_types_empty') }}</p>
    </fieldset>
</template>

<script setup>
import { computed } from "vue";
import { fieldTaskTypes } from "@fieldTaskTypes";
import TaskTypeIcon from "@/components/atom/TaskTypeIcon/TaskTypeIcon.vue";
import { useTaskTypeOptions } from "@/plugins/customFieldView/taskTypeOptions";

defineOptions({ name: "FieldTaskTypesPicker" });

const props = defineProps({
    modelValue: { type: Array, default: () => [] }
});
const emit = defineEmits(["update:modelValue"]);

const chosen = computed(() => fieldTaskTypes({ fieldTaskTypes: props.modelValue }));
const options = useTaskTypeOptions(chosen);

function toggle(key, on) {
    const rest = chosen.value.filter((entry) => entry !== key);
    emit("update:modelValue", on ? [...rest, key] : rest);
}
</script>

<style scoped>
.ftt { margin: 12px 0 0; padding: 0; border: 0; min-width: 0; }
.ftt__label { padding: 0; margin-bottom: 4px; font-size: 13px; font-weight: 600; color: var(--ink); }
.ftt__hint { margin: 0 0 8px; font-size: 11.5px; line-height: 1.45; color: var(--ink-label); }
.ftt__list { display: flex; flex-wrap: wrap; gap: 6px; }
.ftt__option {
    display: inline-flex; align-items: center; gap: 6px;
    min-height: 32px; max-width: 100%;
    padding: 4px 10px;
    border: 1px solid var(--border); border-radius: 999px;
    background: var(--surface); color: var(--ink);
    font-size: 12.5px;
    cursor: pointer;
    transition: border-color var(--t-state) var(--ease), background var(--t-state) var(--ease);
}
.ftt__option:hover { border-color: var(--brand); }
.ftt__option.is-on { border-color: var(--brand); background: var(--brand-tint); }
.ftt__option:focus-within { box-shadow: var(--focus); }
.ftt__check { margin: 0; accent-color: var(--brand); }
.ftt__icon { width: 16px; height: 16px; }
.ftt__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
