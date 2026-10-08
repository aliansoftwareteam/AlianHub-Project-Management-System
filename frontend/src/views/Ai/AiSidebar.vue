<template>
    <AiMobileNav :primary="everyday" :extra="setup" />
    <aside class="ai-side">
        <div class="ai-side__head">
            <ShellIcon name="ai" :size="16" />
            <span class="ah-h3">{{ $t('Ai.title') }}</span>
        </div>

        <nav class="ai-side__nav" :aria-label="$t('Ai.title')">
            <router-link v-for="item in everyday" :key="item.name" class="ai-side__item" :to="{ name: item.name, params: { cid: companyId } }" :aria-label="$t(item.label)" :title="$t(item.label)">
                <ShellIcon :name="item.icon" :size="15" />
                <span>{{ $t(item.label) }}</span>
                <span v-if="item.count" class="ai-side__count ah-mono">{{ item.count }}</span>
            </router-link>

            <div class="ai-side__group">
                <button
                    type="button"
                    class="ai-side__group-head"
                    data-test="ai-setup-toggle"
                    :title="$t('Ai.group_setup')"
                    :aria-expanded="setupOpen"
                    aria-controls="ai-side-setup"
                    @click="toggleSetup"
                >
                    <ShellIcon name="settings" :size="15" />
                    <span class="ai-side__group-label">{{ $t('Ai.group_setup') }}</span>
                    <ShellIcon class="ai-side__caret" :class="{ 'is-open': setupOpen }" name="chevronDown" :size="13" />
                </button>
                <div id="ai-side-setup" v-show="setupOpen" class="ai-side__group-body">
                    <router-link v-for="item in setup" :key="item.name" class="ai-side__item" :to="{ name: item.name, params: { cid: companyId } }" :aria-label="$t(item.label)" :title="$t(item.label)">
                        <ShellIcon :name="item.icon" :size="15" />
                        <span>{{ $t(item.label) }}</span>
                    </router-link>
                </div>
            </div>
        </nav>

        <div class="ai-side__usage">
            <div class="ah-label">{{ $t('Ai.usage_spend') }}</div>
            <div class="ai-side__running">
                <span class="ah-dot" :class="running ? 'ah-dot--ok' : ''"></span>
                <span>{{ running ? $t('Ai.agents_running', { n: running }) : $t(paused ? 'Ai.connected_paused' : 'Ai.none_running') }}</span>
            </div>
            <div class="ai-side__spend ah-mono">{{ spendLabel }}</div>
            <template v-if="canManage">
                <button v-if="paused" type="button" class="ah-btn ah-btn--secondary ah-btn--sm ah-btn--block" data-test="resume-all" :disabled="busy" @click="onResume">
                    {{ $t('Ai.resume_connected') }}
                </button>
                <button v-else type="button" class="ah-btn ah-btn--secondary ah-btn--sm ah-btn--block" data-test="pause-all" :disabled="busy || !canBeAtWork" @click="onPauseAll">
                    {{ $t('Ai.pause_all') }}
                </button>
            </template>
        </div>
    </aside>
</template>

<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute } from "vue-router";
import { useToast } from "vue-toast-notification";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import AiMobileNav from "./AiMobileNav.vue";
import { useAgents } from "./useAgents";
import { useAgentAccess } from "./agentAccess";
import { useLiveAgents } from "./useLiveAgents";
import { useAccounts } from "./useAccounts";
import { useCompanyView } from "./useCompanyView";
import { fetchConnectedAgents } from "./useRunnableAgents";
import { AGENTS_CHANGED_EVENT, POLICY_CHANGE } from "./agentFeed";
import { CONNECT_AI_ROUTE } from "@/router/ai/connect";

defineOptions({ name: "AiSidebar" });

const SETUP_KEY = "ah.ai.setup";

const { t } = useI18n();
const $toast = useToast();
const route = useRoute();
const companyId = inject("$companyId");
const { waiting, spend, pauseAll } = useAgents();
const { running, refresh: refreshLive } = useLiveAgents();
const { canManage } = useAgentAccess();
// The same policy the card in AI > Accounts sets (WorkspaceConnectedPause), so the two never disagree.
const { policy, loadPolicy, saveConnectedPaused } = useAccounts();
const socket = inject("$socket", null);
const { on: companyViewOn, loadOrgChart } = useCompanyView();
const busy = ref(false);
const connectedApps = ref(0);
const paused = computed(() => Boolean(policy.value.connectedPaused));
const canBeAtWork = computed(() => running.value > 0 || connectedApps.value > 0);

const everyday = computed(() => [
    { name: "AiAsk", label: "Parity.nav_ask", icon: "ai" },
    { name: "AiInbox", label: "Ai.inbox", icon: "inbox", count: waiting.value },
    { name: "AiHub", label: "Ai.agents", icon: "agent" },
    { name: "AiSkills", label: "Ai.skills", icon: "docs" },
    { name: "Connections", label: "Parity.nav_connections", icon: "integrations" },
    { name: CONNECT_AI_ROUTE, label: "ConnectAi.title", icon: "key" }
]);

const setup = computed(() => [
    { name: "AgentTeammates", label: "Parity.nav_teammates", icon: "members" },
    { name: "AgentRouting", label: "Parity.nav_routing", icon: "automations" },
    // The workflow API refuses everybody but an Owner and an Admin, so the way in
    // is theirs too rather than a link that can only end in a refusal.
    ...(canManage.value ? [{ name: "WorkflowBuilder", label: "WorkflowBuilder.nav", icon: "layout" }] : []),
    { name: "AiAccounts", label: "Accounts.nav", icon: "key" },
    ...(companyViewOn.value ? [{ name: "AiCompany", label: "CompanyView.nav", icon: "members" }] : []),
    { name: "AiPipeline", label: "Pipeline.nav_pipeline", icon: "layout" },
    { name: "AiRelease", label: "Pipeline.nav_release", icon: "share" },
    { name: "AiHealth", label: "AiHealth.nav", icon: "reports" },
    ...(canManage.value ? [{ name: "AiQuality", label: "AiQuality.nav", icon: "reports" }] : []),
    { name: "AuditLog", label: "Ai.audit", icon: "audit" }
]);

const storedSetupOpen = () => {
    try {
        return localStorage.getItem(SETUP_KEY) === "1";
    } catch {
        return false;
    }
};

const setupOpen = ref(storedSetupOpen());

watch(() => route?.name, (name) => {
    if (name && setup.value.some((item) => item.name === name)) setupOpen.value = true;
}, { immediate: true });

const toggleSetup = () => {
    setupOpen.value = !setupOpen.value;
    try {
        localStorage.setItem(SETUP_KEY, setupOpen.value ? "1" : "0");
    } catch {
        /* a browser with storage blocked still gets the toggle, just not the memory of it */
    }
};

const spendLabel = computed(() => {
    const used = Number(spend.value.totalUsd || 0).toFixed(2);
    const cap = (spend.value.agents || []).reduce((sum, a) => sum + Number(a.cap || 0), 0);
    return cap ? t("Ai.spend_of", { used, cap: cap.toFixed(0) }) : t("Ai.spend_month", { used });
});

const readPaused = () => loadPolicy().catch(() => {});

const whileBusy = async (change, done) => {
    busy.value = true;
    try {
        await change();
        $toast.success(t(done), { position: "top-right" });
    } catch (error) {
        $toast.error(error.message, { position: "top-right" });
    } finally {
        busy.value = false;
    }
};

const onPauseAll = () => whileBusy(async () => {
    await pauseAll();
    await Promise.all([refreshLive(), readPaused()]);
}, "Ai.all_paused");

const onResume = () => whileBusy(() => saveConnectedPaused(false), "Ai.connected_resumed");

const onAgentsChanged = (change) => { if (change?.kind === POLICY_CHANGE && !busy.value) readPaused(); };
watch(() => socket?.value, (next, previous) => {
    previous?.off?.(AGENTS_CHANGED_EVENT, onAgentsChanged);
    next?.on?.(AGENTS_CHANGED_EVENT, onAgentsChanged);
}, { immediate: true });

onMounted(() => {
    readPaused();
    loadOrgChart().catch(() => {});
    if (canManage.value) fetchConnectedAgents().then((apps) => { connectedApps.value = apps.length; });
});
onBeforeUnmount(() => socket?.value?.off?.(AGENTS_CHANGED_EVENT, onAgentsChanged));
</script>

<style>
@import "./sidebar.css";
</style>
