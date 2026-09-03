<template>
    <section class="hc-setup" aria-label="Workspace setup">
        <div class="hc-setup__ring" :style="{ '--pct': `${Math.round(doneCount / steps.length * 100)}%` }">
            <span>{{ doneCount }}/{{ steps.length }}</span>
        </div>
        <div class="hc-setup__body">
            <div class="hc-setup__title">{{ $t('HomeV2.setup_title', { company: companyName }) }}</div>
            <div class="hc-setup__steps">
                <template v-for="(step, i) in steps" :key="step.key">
                    <span v-if="i > 0"> · </span>
                    <s v-if="step.done">{{ $t(step.label) }}</s>
                    <strong v-else-if="step.key === active?.key">{{ $t(step.label) }}</strong>
                    <button v-else type="button" @click="$emit('action', step.key)">{{ $t(step.label) }}</button>
                    <span v-if="step.note && !step.done"> {{ $t(step.note) }}</span>
                </template>
            </div>
        </div>
        <button v-if="active" type="button" class="hc-setup__cta" @click="$emit('action', active.key)">{{ $t(active.cta) }}</button>
        <button type="button" class="hc-setup__dismiss" @click="$emit('dismiss')">{{ $t('HomeV2.dismiss') }}</button>
    </section>
</template>

<script setup>
import { computed, defineEmits, defineProps } from "vue";

defineOptions({ name: "SetupChecklist" });

const props = defineProps({
    companyName: { type: String, default: "" },
    steps: { type: Array, default: () => [] }
});
defineEmits(["action", "dismiss"]);

const doneCount = computed(() => props.steps.filter((s) => s.done).length);
const active = computed(() => props.steps.find((s) => !s.done) || null);
</script>
