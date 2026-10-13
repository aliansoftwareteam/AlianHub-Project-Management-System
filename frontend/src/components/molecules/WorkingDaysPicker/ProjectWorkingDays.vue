<template>
    <div class="pwd">
        <p class="pwd__label">{{ $t('ProjectDetails.working_days') }}</p>
        <label class="pwd__inherit" :class="{ 'is-locked': !editable }">
            <input
                type="checkbox"
                class="ah-check"
                data-inherit
                :checked="inherits"
                :disabled="!editable"
                @change="save($event.target.checked ? null : companyWeek)"
            />
            <span>{{ $t('ProjectDetails.working_days_company') }}</span>
        </label>
        <WorkingDaysPicker
            :modelValue="week"
            :disabled="!editable || inherits"
            :label="$t('ProjectDetails.working_days')"
            @update:modelValue="save"
        />
    </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { checkWorkingDays, workingDaysFor } from '@workingDays';
import WorkingDaysPicker from '@/components/molecules/WorkingDaysPicker/WorkingDaysPicker.vue';

defineOptions({ name: 'ProjectWorkingDays' });

const props = defineProps({
    project: { type: Object, default: () => ({}) },
    company: { type: Object, default: () => ({}) },
    editable: { type: Boolean, default: false },
});
const emit = defineEmits(['update']);

/* Shown from the click until the saved project comes back, so the control does not snap back while the request is out. */
const draft = ref(undefined);
watch(() => props.project?.workingDays, () => { draft.value = undefined; });

const stored = computed(() => (draft.value === undefined ? props.project?.workingDays : draft.value));
const inherits = computed(() => !checkWorkingDays(stored.value).ok);
const companyWeek = computed(() => workingDaysFor(props.company));
const week = computed(() => workingDaysFor(props.company, { workingDays: stored.value }));

function save(value) {
    draft.value = value;
    emit('update', value);
}
</script>

<style scoped>
.pwd { margin-top: var(--sp-3); padding: var(--sp-5) 0 var(--sp-3); border-top: 1px solid var(--hairline); }
.pwd__label { margin: 0 0 var(--sp-3); font: 500 14px/1.5 var(--font-ui); color: var(--ink); }
.pwd .pwd__inherit {
    display: inline-flex; align-items: center; gap: var(--sp-3);
    margin: 0 0 var(--sp-4);
    font: var(--text-small); color: var(--ink);
    cursor: pointer;
}
.pwd .pwd__inherit.is-locked { cursor: default; color: var(--ink-2); }
</style>
