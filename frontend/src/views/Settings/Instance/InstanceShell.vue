<template>
    <div class="ah-page in">
        <div class="ah-toolbar">
            <div class="ah-toolbar__title">{{ $t('InstanceV2.group') }}</div>
            <div class="ah-tabs in__tabs">
                <router-link v-for="tab in tabs" :key="tab.name" :to="{ name: tab.name, params: { cid } }" class="ah-tab" :class="{ 'is-active': route.name === tab.name }">
                    {{ $t(tab.label) }}
                </router-link>
            </div>
            <div class="ah-toolbar__spacer"></div>
            <a class="ah-btn ah-btn--ghost ah-btn--sm" :href="guide(anchor)" target="_blank" rel="noopener">
                <ShellIcon name="book" :size="14" />{{ $t('InstanceV2.guide') }}
            </a>
        </div>
        <div class="in__body ah-scroll">
            <router-view />
        </div>
    </div>
</template>

<script setup>
import { computed, inject } from "vue";
import { useRoute } from "vue-router";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { useInstanceApi } from "./useInstanceApi";

defineOptions({ name: "InstanceShell" });

const route = useRoute();
const cid = inject("$companyId");
const { guide } = useInstanceApi();

const tabs = [
    { name: "InstanceHealth", label: "InstanceV2.nav_health", anchor: "troubleshooting" },
    { name: "InstanceSettings", label: "InstanceV2.nav_settings", anchor: "configure" },
    { name: "InstanceBackups", label: "InstanceV2.nav_backups", anchor: "backup-restore" },
    { name: "InstanceUpgrade", label: "InstanceV2.nav_upgrade", anchor: "upgrade" },
    { name: "InstanceLogs", label: "InstanceV2.nav_logs", anchor: "troubleshooting" },
    { name: "InstanceStats", label: "InstanceV2.nav_stats", anchor: "reference" },
];
const anchor = computed(() => tabs.find((t) => t.name === route.name)?.anchor || "install");
</script>

<style>
.in__tabs { margin-left: 12px; }
.in__tabs .ah-tab { text-decoration: none; }
.in__body { flex: 1; min-height: 0; overflow: auto; padding: 16px 20px 32px; display: flex; flex-direction: column; gap: 16px; }
.in-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
.in-card { padding: 14px 16px; display: flex; flex-direction: column; gap: 8px; }
.in-card__head { display: flex; align-items: center; gap: 8px; }
.in-card__title { font: 600 13px/1.2 var(--font-ui); color: var(--ink); flex: 1; }
.in-kv { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; font: var(--text-small); }
.in-kv dt { color: var(--ink-2); margin: 0; }
.in-kv dd { margin: 0; color: var(--ink); overflow-wrap: anywhere; }
.in-table { width: 100%; border-collapse: collapse; font: var(--text-small); }
.in-table th { text-align: left; color: var(--ink-2); font-weight: 600; padding: 6px 8px; border-bottom: 1px solid var(--hairline); }
.in-table td { padding: 8px; border-bottom: 1px solid var(--hairline); vertical-align: top; }
.in-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.in-banner { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border-radius: 8px; font: var(--text-small); }
.in-banner--warn { background: var(--warn-bg); color: var(--warn-ink); }
.in-banner--danger { background: var(--danger-bg); color: var(--danger-ink); }
.in-banner--ok { background: var(--ok-bg); color: var(--ok-ink); }
.in-pre { margin: 0; padding: 12px; border-radius: 8px; background: var(--rail); color: #e6e8ef; font: 12px/1.5 var(--font-mono); overflow: auto; max-height: 60vh; white-space: pre-wrap; overflow-wrap: anywhere; }
.in-field { display: grid; grid-template-columns: minmax(180px, 260px) 1fr; gap: 6px 16px; align-items: start; padding: 10px 0; border-bottom: 1px solid var(--hairline); }
.in-field__label { font: 600 12.5px/1.3 var(--font-ui); color: var(--ink); display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.in-field__help { font: var(--text-small); color: var(--ink-2); }
.in-field__control { display: flex; flex-direction: column; gap: 6px; }
.in-field__control .ah-input { max-width: 520px; }
@media (max-width: 720px) { .in-field { grid-template-columns: 1fr; } }
</style>
