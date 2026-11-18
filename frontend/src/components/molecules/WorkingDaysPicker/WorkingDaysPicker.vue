<template>
    <div class="wdp">
        <div class="wdp__days" role="group" :aria-label="label || $t('Settings.working_days')">
            <label
                v-for="day in WEEK"
                :key="day.value"
                class="wdp__day"
                :class="{ 'is-on': chosen.includes(day.value), 'is-locked': disabled }"
            >
                <input
                    type="checkbox"
                    class="wdp__check"
                    :data-day="day.value"
                    :checked="chosen.includes(day.value)"
                    :disabled="disabled"
                    @change="toggle(day.value, $event)"
                />
                <span>{{ $t(day.label) }}</span>
            </label>
        </div>
        <p v-if="refused" class="wdp__hint" role="status">{{ $t('Settings.working_days_min') }}</p>
    </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { checkWorkingDays } from '@workingDays';

defineOptions({ name: 'WorkingDaysPicker' });

const props = defineProps({
    modelValue: { type: Array, default: () => [] },
    disabled: { type: Boolean, default: false },
    label: { type: String, default: '' },
});
const emit = defineEmits(['update:modelValue']);

const WEEK = [
    { value: 1, label: 'weekName.mon' },
    { value: 2, label: 'weekName.tue' },
    { value: 3, label: 'weekName.wed' },
    { value: 4, label: 'weekName.thu' },
    { value: 5, label: 'weekName.fri' },
    { value: 6, label: 'weekName.sat' },
    { value: 0, label: 'weekName.sun' },
];

const refused = ref(false);
const chosen = computed(() => {
    const week = checkWorkingDays(props.modelValue);
    return week.ok ? week.days : [];
});

function toggle(day, event) {
    const rest = chosen.value.filter((entry) => entry !== day);
    const week = checkWorkingDays(event.target.checked ? [...rest, day] : rest);
    refused.value = !week.ok;
    if (week.ok) emit('update:modelValue', week.days);
    else event.target.checked = true;
}
</script>

<style scoped>
.wdp__days { display: flex; flex-wrap: wrap; gap: var(--sp-2); }
.wdp .wdp__day {
    display: inline-flex; align-items: center; gap: var(--sp-2);
    min-height: 32px; margin: 0; padding: 0 var(--sp-4);
    border: 1px solid var(--border); border-radius: var(--r-input);
    background: var(--surface); color: var(--ink);
    font: 500 12.5px/1 var(--font-ui);
    cursor: pointer;
    transition: border-color var(--t-state) var(--ease), background var(--t-state) var(--ease);
}
.wdp .wdp__day.is-on { border-color: var(--brand); background: var(--brand-tint); }
.wdp .wdp__day:focus-within { box-shadow: var(--focus); }
.wdp .wdp__day.is-locked { cursor: default; color: var(--ink-2); }
.wdp__check { margin: 0; accent-color: var(--brand); }
.wdp__hint { margin: var(--sp-2) 0 0; font: var(--text-small); color: var(--danger-ink); }
</style>
