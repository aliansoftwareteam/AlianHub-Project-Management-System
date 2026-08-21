<template>
    <svg class="fi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
        <g v-if="name === 'external'">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
        </g>
        <g v-else-if="name === 'trash'">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 6V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2" />
            <line x1="10" y1="11" x2="10" y2="17" />
            <line x1="14" y1="11" x2="14" y2="17" />
        </g>
        <g v-else-if="name === 'eye'">
            <path d="M1.5 12S5 5.5 12 5.5 22.5 12 22.5 12 19 18.5 12 18.5 1.5 12 1.5 12z" />
            <circle cx="12" cy="12" r="3" />
        </g>
        <g v-else-if="name === 'eye-off'">
            <path d="M9.9 5.7A9.9 9.9 0 0 1 12 5.5c7 0 10.5 6.5 10.5 6.5a19 19 0 0 1-2.7 3.7" />
            <path d="M6.3 7.4A18.6 18.6 0 0 0 1.5 12S5 18.5 12 18.5a9.7 9.7 0 0 0 4-.8" />
            <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
            <line x1="3" y1="3" x2="21" y2="21" />
        </g>
        <g v-else-if="name === 'align-left'">
            <line x1="4" y1="7" x2="20" y2="7" />
            <line x1="4" y1="12" x2="14" y2="12" />
            <line x1="4" y1="17" x2="17" y2="17" />
        </g>
        <g v-else-if="name === 'align-center'">
            <line x1="4" y1="7" x2="20" y2="7" />
            <line x1="7" y1="12" x2="17" y2="12" />
            <line x1="5" y1="17" x2="19" y2="17" />
        </g>
        <g v-else-if="name === 'align-right'">
            <line x1="4" y1="7" x2="20" y2="7" />
            <line x1="10" y1="12" x2="20" y2="12" />
            <line x1="7" y1="17" x2="20" y2="17" />
        </g>
        <g v-else-if="name === 'pencil'">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
        </g>
        <g v-else-if="name === 'close'">
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
        </g>
        <g v-else-if="name === 'table'">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <line x1="3" y1="9" x2="21" y2="9" />
            <line x1="3" y1="14" x2="21" y2="14" />
            <line x1="9" y1="9" x2="9" y2="20" />
        </g>
        <g v-else-if="name === 'back'">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="11 18 5 12 11 6" />
        </g>
        <g v-else-if="name === 'plus'">
            <circle cx="12" cy="12" r="9" />
            <line x1="12" y1="8" x2="12" y2="16" />
            <line x1="8" y1="12" x2="16" y2="12" />
        </g>
    </svg>
</template>

<script setup>
import { defineProps } from 'vue';

defineProps({ name: { type: String, required: true } });
</script>

<style scoped>
.fi { width: 1em; height: 1em; display: block; flex: 0 0 auto; }
</style>
