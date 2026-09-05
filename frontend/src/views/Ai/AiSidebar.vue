<template>
    <aside class="ai-side">
        <div class="ai-side__head">
            <ShellIcon name="ai" :size="16" />
            <span class="ah-h3">{{ $t('Ai.title') }}</span>
        </div>

        <nav class="ai-side__nav">
            <router-link v-for="item in items" :key="item.name" class="ai-side__item" :to="{ name: item.name, params: { cid: companyId } }">
                <ShellIcon :name="item.icon" :size="15" />
                <span>{{ $t(item.label) }}</span>
                <span v-if="item.count" class="ai-side__count ah-mono">{{ item.count }}</span>
            </router-link>
        </nav>

        <div class="ai-side__usage">
            <div class="ah-label">{{ $t('Ai.usage_spend') }}</div>
            <div class="ai-side__running">
                <span class="ah-dot" :class="running ? 'ah-dot--ok' : ''"></span>
                <span>{{ running ? $t('Ai.agents_running', { n: running }) : $t('Ai.none_running') }}</span>
            </div>
            <div class="ai-side__spend ah-mono">{{ spendLabel }}</div>
            <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm ah-btn--block" :disabled="busy || !running" @click="onPauseAll">
                {{ $t('Ai.pause_all') }}
            </button>
        </div>
    </aside>
</template>

<script setup>
import { computed, inject, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { useAgents } from "./useAgents";

defineOptions({ name: "AiSidebar" });

const { t } = useI18n();
const $toast = useToast();
const companyId = inject("$companyId");
const { waiting, running, spend, pauseAll } = useAgents();
const busy = ref(false);

const items = computed(() => [
    { name: "AiHub", label: "Ai.agents", icon: "agent" },
    { name: "AiInbox", label: "Ai.inbox", icon: "inbox", count: waiting.value },
    { name: "AgentTeammates", label: "Parity.nav_teammates", icon: "members" },
    { name: "AgentRouting", label: "Parity.nav_routing", icon: "automations" },
    { name: "AiAsk", label: "Parity.nav_ask", icon: "ai" },
    { name: "AiSkills", label: "Ai.skills", icon: "docs" },
    { name: "AiPipeline", label: "Pipeline.nav_pipeline", icon: "layout" },
    { name: "AiRelease", label: "Pipeline.nav_release", icon: "share" },
    { name: "AiAccounts", label: "Accounts.nav", icon: "key" },
    { name: "AuditLog", label: "Ai.audit", icon: "audit" }
]);

const spendLabel = computed(() => {
    const used = Number(spend.value.totalUsd || 0).toFixed(2);
    const cap = (spend.value.agents || []).reduce((sum, a) => sum + Number(a.cap || 0), 0);
    return cap ? t("Ai.spend_of", { used, cap: cap.toFixed(0) }) : t("Ai.spend_month", { used });
});

const onPauseAll = async () => {
    busy.value = true;
    try {
        await pauseAll();
        $toast.success(t("Ai.all_paused"), { position: "top-right" });
    } catch (error) {
        $toast.error(error.message, { position: "top-right" });
    } finally {
        busy.value = false;
    }
};
</script>
