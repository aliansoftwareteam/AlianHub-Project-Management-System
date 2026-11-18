<template>
    <div class="chart-skeleton-loader">
        <Skelaton :class="'skeleton-chart'" />
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
    name: "PieChartSkelaton"
})

</script>

<style scoped>
.chart-skeleton-loader {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin: 20px 0;
    animation: fadeIn 0.3s ease-in-out;
}

.skeleton-chart {
    width: 250px;
    height: 250px;
    border-radius: 50%;
    background: linear-gradient(90deg, var(--fill) 25%, var(--track) 50%, var(--fill) 75%);
    background-size: 400% 400%;
    animation: loading 1.5s infinite ease-in-out;
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
    border-radius: 4px;
    background: linear-gradient(90deg, var(--fill) 25%, var(--track) 50%, var(--fill) 75%);
    background-size: 400% 400%;
    animation: loading 1.5s infinite ease-in-out;
}

/* Animations */
@keyframes loading {
    0% {
        background-position: 100% 50%;
    }

    100% {
        background-position: 0% 50%;
    }
}

@keyframes fadeIn {
    0% {
        opacity: 0;
    }

    100% {
        opacity: 1;
    }
}
</style>