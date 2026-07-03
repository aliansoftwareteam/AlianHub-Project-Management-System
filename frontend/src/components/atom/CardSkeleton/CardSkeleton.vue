<template>
    <div class="cskel" aria-hidden="true">
        <div v-if="counters" class="cskel-counters">
            <div v-for="n in counters" :key="'c' + n" class="cskel-shimmer cskel-counter"></div>
        </div>
        <div
            v-for="n in rows"
            :key="n"
            class="cskel-shimmer cskel-row"
            :style="{ width: ROW_WIDTHS[(n - 1) % ROW_WIDTHS.length] }"
        ></div>
    </div>
</template>

<script>
export default { name: 'CardSkeleton' };
</script>

<script setup>
// Shared shimmer placeholder for the self-fetching dashboard cards while
// their data loads. `counters` renders a row of stat-box blocks (Project
// Pulse / On Leave style) above the plain rows.
defineProps({
    rows: { type: Number, default: 4 },
    counters: { type: Number, default: 0 },
});

// Slightly varied widths so the placeholder reads as content, not stripes.
const ROW_WIDTHS = ['100%', '92%', '97%', '85%'];
</script>

<style scoped>
.cskel { display: flex; flex-direction: column; gap: 9px; padding: 8px 10px; width: 100%; }
.cskel-counters { display: flex; gap: 10px; }
.cskel-counter { flex: 1; height: 56px; border-radius: 8px; }
.cskel-row { height: 18px; border-radius: 4px; }
.cskel-shimmer {
    background: linear-gradient(90deg, #eef0f6 25%, #e3e7f1 37%, #eef0f6 63%);
    background-size: 400% 100%;
    animation: cskel-shimmer 1.4s ease infinite;
}
@keyframes cskel-shimmer {
    0% { background-position: 100% 0; }
    100% { background-position: 0 0; }
}
</style>
