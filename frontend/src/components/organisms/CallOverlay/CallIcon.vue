<template>
    <!-- Inline SVG rather than image files: these render on both the white ringing card
         and the dark call window, so they have to take their colour from the button. -->
    <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <template v-if="name === 'phone'">
            <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.4 2.1L8.1 9.6a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.4c.8.3 1.7.5 2.6.6a2 2 0 0 1 1.7 2Z" />
        </template>
        <template v-else-if="name === 'hangup'">
            <!-- The same handset, rotated — the universal "end call" shape. -->
            <g transform="rotate(135 12 12)">
                <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.4 2.1L8.1 9.6a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.4c.8.3 1.7.5 2.6.6a2 2 0 0 1 1.7 2Z" />
            </g>
        </template>
        <template v-else-if="name === 'video'">
            <path d="m23 7-7 5 7 5V7Z" />
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
        </template>
        <template v-else-if="name === 'videoOff'">
            <path d="M16 16v2a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2m4 0h5a2 2 0 0 1 2 2v3l4-3v9" />
            <line x1="2" y1="2" x2="22" y2="22" />
        </template>
        <template v-else-if="name === 'mic'">
            <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
            <line x1="12" y1="19" x2="12" y2="22" />
        </template>
        <template v-else-if="name === 'screen'">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
        </template>
        <template v-else-if="name === 'screenOff'">
            <path d="M22 15V5a2 2 0 0 0-2-2H8m-4 0a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
            <line x1="2" y1="2" x2="22" y2="22" />
        </template>
        <template v-else-if="name === 'bell'">
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </template>
        <template v-else-if="name === 'bellOff'">
            <path d="M13.7 21a2 2 0 0 1-3.4 0" />
            <path d="M18.6 13A17 17 0 0 1 18 8a6 6 0 0 0-9.3-5" />
            <path d="M6.3 6.3A6 6 0 0 0 6 8c0 7-3 9-3 9h14" />
            <line x1="2" y1="2" x2="22" y2="22" />
        </template>
        <template v-else-if="name === 'expand'">
            <polyline points="15 3 21 3 21 9" />
            <polyline points="9 21 3 21 3 15" />
            <line x1="21" y1="3" x2="14" y2="10" />
            <line x1="3" y1="21" x2="10" y2="14" />
        </template>
        <template v-else-if="name === 'collapse'">
            <polyline points="4 14 10 14 10 20" />
            <polyline points="20 10 14 10 14 4" />
            <line x1="14" y1="10" x2="21" y2="3" />
            <line x1="3" y1="21" x2="10" y2="14" />
        </template>
        <template v-else-if="name === 'micOff'">
            <line x1="2" y1="2" x2="22" y2="22" />
            <path d="M9 9v2a3 3 0 0 0 5.1 2.1M15 9.3V5a3 3 0 0 0-5.9-.7" />
            <path d="M19 10v1a7 7 0 0 1-.6 2.8M5 10v1a7 7 0 0 0 10.3 6.2" />
            <line x1="12" y1="19" x2="12" y2="22" />
        </template>
    </svg>
</template>

<script setup>
import { defineProps } from 'vue';

defineProps({
    name: { type: String, required: true },
    size: { type: [Number, String], default: 18 },
});
</script>
