<template>
    <div class="chart-skeleton-loader">
        <Skelaton v-for="i in 1" :key="i" :class="'skeleton-bar'" />
        <div class="skeleton-legend">
            <Skelaton v-for="i in 4" :key="i" :class="'skeleton-legend-item'" />
        </div>
    </div>
</template>

<script setup>
import { defineComponent } from "vue";

// Component
import Skelaton from '@/components/atom/Skelaton/Skelaton.vue';

defineComponent({
    name: "StackBarChartSkelaton"
})
</script>

<style scoped>
.chart-skeleton-loader {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
    padding: 10px;
    border-radius: 8px;
    animation: fadeIn 0.3s ease-in-out;
}

.skeleton-bar {
    width: 100%;
    height: 60px;
    background: linear-gradient(90deg, var(--fill) 25%, var(--track) 50%, var(--fill) 75%);
    background-size: 200% 100%;
    animation: loading 1.5s infinite ease-in-out;
    border-radius: 4px;
}

.skeleton-legend {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 10px;
    margin-top: 15px;
}

.skeleton-legend-item {
    width: 80px;
    height: 14px;
    border-radius: 5px;
    background: linear-gradient(90deg, var(--fill) 25%, var(--track) 50%, var(--fill) 75%);
    background-size: 400% 400%;
    animation: loading 1.5s infinite ease-in-out;
}

@keyframes loading {
    0% {
        background-position: 100% 0;
    }

    100% {
        background-position: -100% 0;
    }
}

@keyframes fadeIn {
    from {
        opacity: 0;
    }

    to {
        opacity: 1;
    }
}
</style>
