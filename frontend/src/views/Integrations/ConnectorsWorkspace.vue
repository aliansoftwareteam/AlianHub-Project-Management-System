<template>
    <div class="cx-ws" data-test="cx-workspace">
        <header class="cx-ws__head">
            <div class="cx-ws__intro">
                <h2 class="ah-h2">{{ $t('Connectors.workspace.title') }}</h2>
                <p class="cx-ws__lead">{{ $t('Connectors.workspace.lead') }}</p>
            </div>
            <button v-if="limits" type="button" class="ah-btn ah-btn--secondary ah-btn--sm" data-test="cx-ws-limits-link" @click="toLimits">
                {{ $t('Connectors.workspace.limits_link') }}
            </button>
        </header>

        <p v-if="!registry && !apps && !limits" class="ah-empty" data-test="cx-ws-off">{{ $t('Connectors.conn.my_empty') }}</p>

        <AdminConnections v-if="registry" />

        <section v-if="registry" class="ah-card cx-ws__card" data-test="cx-ws-reviews">
            <div class="ah-card__body">
                <p v-if="loadError" class="ah-field__error" role="alert">{{ loadError }}</p>
                <ConnectorToolReviews v-else-if="providers.length" :providers="providers" />
                <p v-else-if="loaded" class="ah-small">{{ $t('Connectors.review.none') }}</p>
            </div>
        </section>

        <CompanyApps v-if="apps" />

        <div v-if="limits" ref="limitsAt" class="cx-ws__limits" tabindex="-1">
            <ConnectorQuotas />
        </div>
    </div>
</template>

<script setup>
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import AdminConnections from "./AdminConnections.vue";
import CompanyApps from "./CompanyApps.vue";
import ConnectorQuotas from "./ConnectorQuotas.vue";
import ConnectorToolReviews from "./ConnectorToolReviews.vue";
import { connectorApi } from "./connectorApi";

defineOptions({ name: "ConnectorsWorkspace" });

const props = defineProps({
    registry: { type: Boolean, default: false },
    apps: { type: Boolean, default: false },
    limits: { type: Boolean, default: false }
});

const { t } = useI18n();
const providers = ref([]);
const loaded = ref(false);
const loadError = ref("");
const limitsAt = ref(null);

const loadProviders = async () => {
    loadError.value = "";
    try {
        const data = await connectorApi.list();
        providers.value = (data?.providers || []).map((entry) => entry.provider);
    } catch (e) {
        loadError.value = e.message || t("Connectors.review.load_failed");
    } finally {
        loaded.value = true;
    }
};

const toLimits = () => {
    limitsAt.value?.scrollIntoView({ behavior: "smooth", block: "start" });
    limitsAt.value?.focus({ preventScroll: true });
};

watch(() => props.registry, (on) => { if (on && !loaded.value) loadProviders(); }, { immediate: true });
</script>

<style scoped>
.cx-ws { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.cx-ws__head { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 10px 16px; }
.cx-ws__intro { display: flex; flex-direction: column; gap: 4px; min-width: 0; max-width: 680px; }
.cx-ws__lead { margin: 0; font: var(--text-body); color: var(--ink-2); }
.cx-ws__card { max-width: 900px; }
.cx-ws__limits { outline: none; scroll-margin-top: 12px; }
.cx-ws :deep(.ac), .cx-ws :deep(.ca), .cx-ws :deep(.cq) { margin-bottom: 0; }
</style>
