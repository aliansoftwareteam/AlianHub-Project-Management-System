<template>
    <span class="glb" :class="{ 'is-full': pct >= 100 }" role="progressbar" :aria-label="label" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="pct">
        <span class="glb__fill" :style="{ width: `${pct}%` }"></span>
    </span>
</template>

<script setup>
import { computed } from "vue";

defineOptions({ name: "GoalBar" });

const props = defineProps({
    value: { type: Number, default: 0 },
    label: { type: String, required: true }
});

const pct = computed(() => Math.min(100, Math.max(0, Math.round(Number(props.value) || 0))));
</script>
