<template>
    <div v-if="coverage" class="cov" role="list">
        <span
            v-for="point in POINTS"
            :key="point"
            role="listitem"
            class="cov__chip"
            :class="coverage[point] === 'met' ? 'cov__chip--met' : 'cov__chip--missing'"
            :title="coverage[point] === 'met' ? $t('AiProject.coverage_met') : $t('AiProject.coverage_missing')"
        >
            <span class="cov__mark" aria-hidden="true">{{ coverage[point] === 'met' ? '✓' : '·' }}</span>
            {{ $t(`AiProject.point_${point}`) }}
        </span>
    </div>
</template>

<script setup>
import { defineProps } from 'vue';
import { POINTS } from './points';

defineProps({
    coverage: { type: Object, default: null },
});
</script>

<style scoped>
.cov {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}
.cov__chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 10px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 500;
    border: 1px solid transparent;
}
.cov__chip--met {
    background: #dcfce7;
    color: #15803d;
}
.cov__chip--missing {
    background: #fff7ed;
    color: #9a3412;
    border-color: #fed7aa;
}
.cov__mark { font-weight: 700; }
</style>
