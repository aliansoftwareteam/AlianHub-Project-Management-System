<template>
    <div class="chart-skeleton-loader">
        <div class="skeleton-bar-chart">
            <Skelaton v-for="i in 7" :key="i" :class="'skeleton-bar'" />
        </div>
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
    name: "BarChartSkelaton"
})
</script>

<style scoped>
/* Skeleton Loader Container */
.skeleton-bar-chart {
    display: flex;
    align-items: flex-end;
    justify-content: center;
    gap: 50px;
    width: 100%;
    height: 300px;
    max-width: 600px;
    margin: 20px auto;
    border-bottom: 1px solid var(--border);
}

.skeleton-bar {
    width: 40px;
    /* Adjust width as needed */
    background: linear-gradient(180deg, var(--fill) 25%, var(--track) 50%, var(--fill) 75%);
    background-size: 400% 400%;
    animation: loading 1.5s infinite ease-in-out;
}

/* Different heights to mimic actual data */
.skeleton-bar:nth-child(1) {
    height: 30%;
}

.skeleton-bar:nth-child(2) {
    height: 50%;
}

.skeleton-bar:nth-child(3) {
    height: 80%;
}

.skeleton-bar:nth-child(4) {
    height: 60%;
}

.skeleton-bar:nth-child(5) {
    height: 40%;
}

.skeleton-bar:nth-child(6) {
    height: 70%;
}

.skeleton-bar:nth-child(7) {
    height: 90%;
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

/* Animation */
@keyframes loading {
    0% {
        background-position: 50% 100%;
    }

    100% {
        background-position: 50% 0%;
    }
}
</style>