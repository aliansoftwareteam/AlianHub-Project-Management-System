<template>
    <svg
        class="mc-ico"
        :width="size"
        :height="size"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        :stroke-width="strokeWidth"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
        focusable="false"
    >
        <!-- one uniform family: 24 viewBox, stroke-based, inherits currentColor so
             hover / active / on-navy states need no extra assets -->
        <template v-if="name === 'search'">
            <circle cx="11" cy="11" r="7" />
            <line x1="16.5" y1="16.5" x2="21" y2="21" />
        </template>

        <template v-else-if="name === 'info'">
            <circle cx="12" cy="12" r="9" />
            <line x1="12" y1="11" x2="12" y2="16.5" />
            <line x1="12" y1="7.75" x2="12.01" y2="7.75" />
        </template>

        <template v-else-if="name === 'attach'">
            <path d="M21 12.6 12.3 21.3a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8" />
        </template>

        <template v-else-if="name === 'send'">
            <path d="M4 12 20.5 4 13 20l-2.1-6.4L4 12Z" />
        </template>

        <template v-else-if="name === 'reply'">
            <polyline points="9,7 4,12 9,17" />
            <path d="M4 12h9a6 6 0 0 1 6 6v1" />
        </template>

        <template v-else-if="name === 'copy'">
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M15 6.5V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h1.5" />
        </template>

        <template v-else-if="name === 'more'">
            <circle cx="12" cy="5.5" r="1.4" fill="currentColor" stroke="none" />
            <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
            <circle cx="12" cy="18.5" r="1.4" fill="currentColor" stroke="none" />
        </template>

        <template v-else-if="name === 'emoji'">
            <circle cx="12" cy="12" r="9" />
            <path d="M8.5 14a4.4 4.4 0 0 0 7 0" />
            <line x1="9.2" y1="9.5" x2="9.21" y2="9.5" />
            <line x1="14.8" y1="9.5" x2="14.81" y2="9.5" />
        </template>

        <template v-else-if="name === 'close'">
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
        </template>

        <template v-else-if="name === 'pin'">
            <line x1="12" y1="17" x2="12" y2="22" />
            <path d="M9 4h6l-1 6 3 3H7l3-3-1-6Z" />
        </template>

        <template v-else-if="name === 'chevron-down'">
            <path d="m6 10 6 6 6-6" />
        </template>

        <!-- private channel. An inline glyph rather than the assets/private.png used
             elsewhere: that file is a fixed pale grey, so its weight could only ever be
             faded, never strengthened. -->
        <template v-else-if="name === 'lock'">
            <rect x="5" y="10.5" width="14" height="10.5" rx="2" />
            <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
        </template>

        <template v-else-if="name === 'mic'">
            <rect x="9" y="2.5" width="6" height="11" rx="3" />
            <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
            <line x1="12" y1="17.5" x2="12" y2="21" />
        </template>

        <!-- reserved for the planned call controls -->
        <template v-else-if="name === 'phone'">
            <path d="M6.5 3h3l1.5 4-2 1.5a11 11 0 0 0 5.5 5.5L16 12l4 1.5v3a2 2 0 0 1-2.2 2A15.5 15.5 0 0 1 4 5.2 2 2 0 0 1 6.5 3Z" />
        </template>

        <template v-else-if="name === 'video'">
            <path d="m22 8-6 4 6 4V8Z" />
            <rect x="2" y="6" width="14" height="12" rx="2" />
        </template>
    </svg>
</template>

<script setup>
/**
 * Icon set for the Main Chat module.
 *
 * Replaces the text glyphs the module started with (📎 ➤ ⌕ ⓘ ⋮), which rendered
 * at inconsistent sizes and weights depending on the platform's emoji font and
 * were hard to see. These are stroke icons on a single 24 viewBox that inherit
 * `currentColor`, so one asset works on white and on the navy send button.
 */
import { defineProps } from 'vue';

defineProps({
    name: { type: String, required: true },
    size: { type: [Number, String], default: 18 },
    strokeWidth: { type: [Number, String], default: 1.9 },
});
</script>
