<template>
    <span class="ah-chip ah-chip--warn ah-chip--sm" :title="$t('Demo.simulated_hint')" data-test="simulated-chip">
        {{ $t('Demo.simulated') }}<span class="ah-sr-only">: {{ $t('Demo.simulated_hint') }}</span>
    </span>
</template>

<script setup>
defineOptions({ name: "SimulatedChip" });
</script>
