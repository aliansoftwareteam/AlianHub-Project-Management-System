<template>
    <aside class="ah-sidebar" :class="{ 'is-open': open, 'is-collapsed': shellState.sidebarCollapsed }" :style="{ '--ah-sidebar-w': width }" :aria-label="label">
        <slot />
    </aside>
    <div v-if="open" class="ah-sidebar__scrim" @click="$emit('close')"></div>
</template>

<script setup>
import { defineEmits, defineProps } from "vue";
import { shellState } from "./shellState";

defineOptions({ name: "ContextSidebar" });
defineProps({
    width: { type: String, default: "var(--sidebar-w)" },
    open: { type: Boolean, default: false },
    label: { type: String, default: "Sidebar" }
});
defineEmits(["close"]);
</script>

<style>
.ah-sidebar {
    width: var(--ah-sidebar-w, var(--sidebar-w));
    flex: none;
    height: 100%;
    background: var(--surface);
    border-right: 1px solid var(--hairline);
    padding: 14px 10px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    font: 400 13px/1.4 var(--font-ui);
    color: var(--ink);
    overflow-y: auto;
    overflow-x: hidden;
    box-sizing: border-box;
    scrollbar-width: thin;
}
.ah-sidebar.is-collapsed { display: none; }
.ah-sidebar__scrim { display: none; }
@media (max-width: 1279px) {
    .ah-sidebar {
        position: absolute;
        left: 0; top: 0; bottom: 0;
        z-index: 30;
        transform: translateX(-100%);
        transition: transform var(--t-panel) var(--ease);
        box-shadow: none;
    }
    .ah-sidebar.is-open { display: flex; transform: none; box-shadow: var(--shadow-pop); }
    .ah-sidebar__scrim { display: block; position: absolute; inset: 0; z-index: 29; background: rgba(0, 0, 0, .28); }
}
@media (max-width: 767px) {
    .ah-sidebar { width: min(320px, 88vw); }
}
</style>
