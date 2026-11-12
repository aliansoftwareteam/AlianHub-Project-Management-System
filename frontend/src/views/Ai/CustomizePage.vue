<template>
    <div class="ah-page ai-page cz" data-test="customize">
        <AiSidebar />
        <div class="ai-page__main">
            <div class="ah-toolbar">
                <h1 class="ah-toolbar__title">{{ $t('Connectors.screen.title') }}</h1>
            </div>

            <div class="cz__body ah-scroll">
                <div class="ah-tabs cz__tabs" role="tablist" :aria-label="$t('Connectors.screen.tabs_label')">
                    <button
                        v-for="key in tabs"
                        :id="`cz-tab-${key}`"
                        :key="key"
                        ref="tabButtons"
                        type="button"
                        role="tab"
                        class="ah-tab"
                        :class="{ 'is-active': tab === key }"
                        :aria-selected="tab === key ? 'true' : 'false'"
                        :aria-controls="`cz-panel-${key}`"
                        :tabindex="tab === key ? 0 : -1"
                        :data-test="`cz-tab-${key}`"
                        @click="choose(key)"
                        @keydown="onTabKey"
                    >{{ $t(TAB_LABEL[key]) }}</button>
                </div>

                <div :id="`cz-panel-${tab}`" role="tabpanel" class="cz__panel" :aria-labelledby="`cz-tab-${tab}`">
                    <p v-if="!flagsKnown" class="ah-small" data-test="cz-loading">{{ $t('Connectors.screen.loading') }}</p>
                    <template v-else>
                        <ConnectorsTab
                            v-if="tab === CUSTOMIZE_TAB.CONNECTORS"
                            :available="flags.registry"
                            :guest="isGuest"
                            :privileged="privileged"
                            @open-workspace="choose(CUSTOMIZE_TAB.WORKSPACE)"
                        />
                        <ConnectYourAi v-else-if="tab === CUSTOMIZE_TAB.CONNECT_AI" embedded />
                        <ConnectorsWorkspace
                            v-else-if="tab === CUSTOMIZE_TAB.WORKSPACE"
                            :registry="flags.registry"
                            :apps="flags.requested.length > 0"
                            :limits="flags.limits"
                        />
                    </template>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, nextTick, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { isOwnerOrAdmin, ROLE_GUEST } from "@/utils/roles";
import { CUSTOMIZE_TAB } from "@/router/ai/customize";
import AiSidebar from "./AiSidebar.vue";
import ConnectYourAi from "./ConnectYourAi.vue";
import { useAgentAccess } from "./agentAccess";
import ConnectorsTab from "@/views/Integrations/ConnectorsTab.vue";
import ConnectorsWorkspace from "@/views/Integrations/ConnectorsWorkspace.vue";

defineOptions({ name: "CustomizePage" });

const TAB_LABEL = Object.freeze({
    [CUSTOMIZE_TAB.CONNECTORS]: "Connectors.screen.tab_connectors",
    [CUSTOMIZE_TAB.CONNECT_AI]: "Connectors.screen.tab_connect_ai",
    [CUSTOMIZE_TAB.WORKSPACE]: "Connectors.screen.tab_workspace"
});

const route = useRoute();
const router = useRouter();
const { getters } = useStore();
const { canConnectOwnAi } = useAgentAccess();

const roleType = computed(() => Number(getters["settings/companyUserDetail"]?.roleType));
const privileged = computed(() => isOwnerOrAdmin(roleType.value));
const isGuest = computed(() => roleType.value === ROLE_GUEST);

// A link that asks for Connect your AI (the AI-unavailable hint, the setup checklist) still opens it, as its old page did.
const tabs = computed(() => [
    CUSTOMIZE_TAB.CONNECTORS,
    ...(canConnectOwnAi.value || route.query.tab === CUSTOMIZE_TAB.CONNECT_AI ? [CUSTOMIZE_TAB.CONNECT_AI] : []),
    ...(privileged.value ? [CUSTOMIZE_TAB.WORKSPACE] : [])
]);
const tab = computed(() => (tabs.value.includes(route.query.tab) ? route.query.tab : CUSTOMIZE_TAB.CONNECTORS));

/* What the server registered, so no tab calls a route this install does not have. */
const flags = reactive({ registry: false, limits: false, requested: [] });
const flagsKnown = ref(false);

const tabButtons = ref([]);

const choose = (key) => {
    if (key === tab.value) return;
    const query = { ...route.query, tab: key };
    if (key === CUSTOMIZE_TAB.CONNECTORS) delete query.tab;
    router.replace({ query });
};

const onTabKey = async (event) => {
    const moves = { ArrowRight: 1, ArrowLeft: -1, Home: -Infinity, End: Infinity };
    if (!(event.key in moves)) return;
    event.preventDefault();
    const list = tabs.value;
    const at = list.indexOf(tab.value);
    const step = moves[event.key];
    const next = Number.isFinite(step) ? list[(at + step + list.length) % list.length] : list[step > 0 ? list.length - 1 : 0];
    choose(next);
    await nextTick();
    tabButtons.value.find((button) => button.id === `cz-tab-${next}`)?.focus();
};

onMounted(async () => {
    try {
        const res = await apiRequest("get", `${env.INTEGRATIONS}/catalog`);
        const body = res?.data || {};
        flags.registry = body.status === true && body.registryConnectors === true;
        flags.limits = body.status === true && body.connectorLimits === true;
        flags.requested = body.status === true && Array.isArray(body.connectors) ? body.connectors : [];
    } catch (e) {
        flags.registry = false;
    } finally {
        flagsKnown.value = true;
    }
});
</script>

<style>
@import "./style.css";
</style>

<style scoped>
.cz__body { flex: 1; min-height: 0; overflow: auto; padding: 16px 24px 32px; display: flex; flex-direction: column; gap: 18px; box-sizing: border-box; }
.cz__tabs { align-self: flex-start; max-width: 100%; overflow-x: auto; }
.cz__tabs .ah-tab { white-space: nowrap; }
.cz__panel { min-width: 0; }
@media (max-width: 640px) {
    .cz__body { padding: 12px 16px 24px; }
}
</style>
