<template>
    <section class="ah-card wa" data-test="workspace-apps" aria-labelledby="workspace-apps-title">
        <div id="workspace-apps-title" class="wa__title">{{ $t('Connectors.workspace_apps.title') }}</div>
        <p class="ah-small wa__lead">{{ $t('Connectors.workspace_apps.lead') }}</p>

        <p v-if="loadError" class="ah-field__error" role="alert" data-test="wa-load-error">{{ loadError }}</p>
        <p v-else-if="loading" class="ah-small">{{ $t('Connectors.screen.loading') }}</p>
        <p v-else-if="!apps.length" class="ah-small" data-test="wa-empty">{{ $t('Connectors.workspace_apps.empty') }}</p>
        <ul v-else class="wa__list" role="list">
            <li v-for="provider in apps" :key="provider" class="wa__row" :data-test="`wa-row-${provider}`">
                <ConnectorTile :provider="provider" :name="name(provider)" />
                <span class="wa__text">
                    <span class="wa__name">{{ name(provider) }}</span>
                    <span class="ah-small">{{ isOn(provider) ? $t('Connectors.workspace_apps.on') : $t('Connectors.workspace_apps.off') }}</span>
                </span>
                <AhSwitch
                    :model-value="isOn(provider)"
                    :disabled="busy === provider"
                    :label="$t('Connectors.workspace_apps.switch', { provider: name(provider) })"
                    :data-test="`wa-switch-${provider}`"
                    @update:model-value="(on) => setOn(provider, on)"
                />
            </li>
        </ul>
        <p v-if="error" class="ah-field__error" role="alert" data-test="wa-error">{{ error }}</p>
        <p class="ah-small wa__status" role="status">{{ status }}</p>
    </section>
</template>

<script setup>
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import AhSwitch from "@/components/molecules/Setting/AhSwitch.vue";
import ConnectorTile from "./ConnectorTile.vue";
import { connectorApi } from "./connectorApi";
import { providerLabel } from "./connectorLabels";

defineOptions({ name: "WorkspaceApps" });

const { t, te } = useI18n();

const apps = ref([]);
const off = ref([]);
const loading = ref(true);
const loadError = ref("");
const busy = ref("");
const error = ref("");
const status = ref("");

const name = (provider) => providerLabel(t, te, provider);
const isOn = (provider) => !off.value.includes(provider);

const load = async () => {
    loading.value = true;
    loadError.value = "";
    try {
        const data = await connectorApi.list();
        const offered = (data?.providers || []).filter((entry) => !entry.custom).map((entry) => entry.provider);
        const waiting = (data?.unavailable || []).map((entry) => entry.provider);
        apps.value = [...new Set([...offered, ...waiting])].sort((a, b) => name(a).localeCompare(name(b)));
        off.value = data?.workspaceOff || [];
    } catch (e) {
        loadError.value = e.message || t("Connectors.workspace_apps.load_failed");
    } finally {
        loading.value = false;
    }
};

const setOn = async (provider, on) => {
    busy.value = provider;
    error.value = "";
    status.value = "";
    try {
        const out = await connectorApi.setSwitch(provider, on);
        off.value = out?.off || [];
        status.value = t(on ? "Connectors.workspace_apps.turned_on" : "Connectors.workspace_apps.turned_off", { provider: name(provider) });
    } catch (e) {
        error.value = e.message || t("Connectors.workspace_apps.failed");
    } finally {
        busy.value = "";
    }
};

onMounted(load);
</script>

<style scoped>
.wa { padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; max-width: 900px; background: var(--surface); }
.wa__title { font: 600 13px/1.2 var(--font-ui); color: var(--ink); }
.wa__lead { margin: 0; color: var(--ink-2); }
.wa__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.wa__row { display: flex; align-items: center; gap: 12px; padding: 9px 0; border-top: 1px solid var(--hairline); }
.wa__row:first-child { border-top: 0; }
.wa__text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.wa__name { font: var(--text-body); color: var(--ink); overflow-wrap: anywhere; }
.wa__status { margin: 0; min-height: 1em; }
</style>
