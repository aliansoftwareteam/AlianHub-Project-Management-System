<template>
    <span class="cx-tile" :class="[`cx-tile--${size}`, { 'cx-tile--logo': icon }]" aria-hidden="true">
        <ShellIcon v-if="icon" :name="icon" :size="size === 'lg' ? 22 : 18" />
        <span v-else class="cx-tile__initials">{{ initials }}</span>
    </span>
</template>

<script setup>
import { computed } from "vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { initialsOf } from "./connectorCatalog";

defineOptions({ name: "ConnectorTile" });

const LOGO_ICONS = Object.freeze({ google: "google", github: "github" });

const props = defineProps({
    provider: { type: String, required: true },
    name: { type: String, default: "" },
    size: { type: String, default: "md" }
});

const icon = computed(() => LOGO_ICONS[props.provider] || "");
const initials = computed(() => initialsOf(props.name || props.provider));
</script>

<style scoped>
.cx-tile { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: var(--r-card); background: var(--brand-tint); color: var(--brand); }
.cx-tile--lg { width: 44px; height: 44px; }
.cx-tile--logo { background: var(--surface-2); border: 1px solid var(--hairline); color: var(--ink); }
.cx-tile__initials { font: 600 13px/1 var(--font-ui); letter-spacing: .02em; }
.cx-tile--lg .cx-tile__initials { font-size: 15px; }
</style>
