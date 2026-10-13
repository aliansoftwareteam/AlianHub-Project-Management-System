<template>
    <svg class="ei" :data-illustration="shown" viewBox="0 0 96 72" width="96" height="72" fill="none" aria-hidden="true" focusable="false">
        <ellipse class="ei__tint" cx="48" cy="40" rx="42" ry="28" />
        <g v-if="shown === 'tasks'">
            <rect class="ei__paper" x="26" y="12" width="44" height="48" rx="5" />
            <rect class="ei__accent-fill" x="32" y="20" width="9" height="9" rx="2.5" />
            <path class="ei__on-accent" d="M34.2 24.6l1.7 1.7 3-3.4" />
            <path class="ei__line" d="M46 24.5h17" />
            <rect class="ei__box" x="32" y="33" width="9" height="9" rx="2.5" />
            <path class="ei__line" d="M46 37.5h13" />
            <rect class="ei__box" x="32" y="46" width="9" height="9" rx="2.5" />
            <path class="ei__line" d="M46 50.5h16" />
        </g>
        <g v-else-if="shown === 'docs'">
            <path class="ei__paper" d="M30 10h24l12 12v36a4 4 0 0 1-4 4H30a4 4 0 0 1-4-4V14a4 4 0 0 1 4-4z" />
            <path class="ei__box" d="M54 10v8a4 4 0 0 0 4 4h8" />
            <path class="ei__accent" d="M33 31h14" />
            <path class="ei__line" d="M33 39h26M33 46h26M33 53h16" />
        </g>
        <g v-else-if="shown === 'chat'">
            <path class="ei__paper" d="M20 14h34a5 5 0 0 1 5 5v16a5 5 0 0 1-5 5H34l-8 7v-7h-6a5 5 0 0 1-5-5V19a5 5 0 0 1 5-5z" />
            <path class="ei__line" d="M23 24h24M23 31h16" />
            <path class="ei__accent-fill" d="M50 34h26a5 5 0 0 1 5 5v12a5 5 0 0 1-5 5h-3v6l-7-6H50a5 5 0 0 1-5-5V39a5 5 0 0 1 5-5z" />
            <path class="ei__on-accent" d="M53 43h20M53 49h12" />
        </g>
        <g v-else-if="shown === 'time'">
            <circle class="ei__paper" cx="48" cy="36" r="24" />
            <path class="ei__line" d="M48 17v3M48 52v3M29 36h3M64 36h3" />
            <path class="ei__accent" d="M48 24v12l8 6" />
            <circle class="ei__accent-fill" cx="48" cy="36" r="2.5" />
        </g>
        <g v-else-if="shown === 'search'">
            <circle class="ei__paper" cx="43" cy="32" r="18" />
            <path class="ei__accent" d="M56.5 45.5L70 59" />
            <path class="ei__line" d="M37 26l12 12M49 26L37 38" />
        </g>
        <g v-else-if="shown === 'inbox'">
            <path class="ei__paper" d="M22 42l9-21a4 4 0 0 1 3.7-2.5h26.6A4 4 0 0 1 65 21l9 21v13a5 5 0 0 1-5 5H27a5 5 0 0 1-5-5z" />
            <path class="ei__box" d="M22 42h15a3 3 0 0 1 3 3 8 8 0 0 0 16 0 3 3 0 0 1 3-3h15" />
            <circle class="ei__ok-fill" cx="48" cy="27" r="8" />
            <path class="ei__ok" d="M44.5 27.2l2.5 2.5 4.6-5" />
        </g>
        <g v-else-if="shown === 'people'">
            <circle class="ei__paper" cx="27" cy="32" r="7" />
            <path class="ei__paper" d="M14 58a13 13 0 0 1 26 0z" />
            <circle class="ei__paper" cx="69" cy="32" r="7" />
            <path class="ei__paper" d="M56 58a13 13 0 0 1 26 0z" />
            <circle class="ei__accent-fill" cx="48" cy="26" r="9" />
            <path class="ei__accent-fill" d="M31 60a17 17 0 0 1 34 0z" />
        </g>
        <g v-else>
            <rect class="ei__paper" x="22" y="26" width="52" height="34" rx="5" />
            <path class="ei__box" d="M22 37h18a2 2 0 0 1 2 2 6 6 0 0 0 12 0 2 2 0 0 1 2-2h18" />
            <path class="ei__accent" d="M48 8v9M39 12l4 6M57 12l-4 6" />
        </g>
    </svg>
</template>

<script>
export const ILLUSTRATIONS = ["tasks", "docs", "chat", "time", "search", "inbox", "people", "generic"];
</script>

<script setup>
import { computed, defineProps } from "vue";

const props = defineProps({
    name: { type: String, default: "generic" }
});

const shown = computed(() => (ILLUSTRATIONS.includes(props.name) ? props.name : "generic"));
</script>

<style scoped>
.ei { display: block; flex: none; color: var(--ink-2); }
.ei__tint { fill: var(--brand-tint); }
.ei__paper { fill: var(--surface); stroke: var(--border); stroke-width: 1.5; stroke-linejoin: round; }
.ei__box { stroke: var(--border); stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.ei__line { stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
.ei__accent { stroke: var(--brand); stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }
.ei__accent-fill { fill: var(--brand); }
.ei__on-accent { stroke: var(--on-brand); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.ei__ok-fill { fill: var(--ok-bg); stroke: var(--ok); stroke-width: 1.5; }
.ei__ok { stroke: var(--ok-ink); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
</style>
