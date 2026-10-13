<template>
    <section class="ah-card ai-open-alerts" :class="{ 'has-open': open.length }" data-test="open-alerts" :aria-busy="loading ? 'true' : 'false'">
        <div class="ai-open-alerts__head">
            <span class="ah-label">{{ $t('AiAlerts.open_title') }}</span>
            <span v-if="open.length" class="ah-chip ah-chip--danger" data-test="open-count">{{ $t('AiAlerts.open_count', { n: open.length }) }}</span>
        </div>
        <p v-if="error" class="ah-field__error" data-test="alerts-error">{{ error }}</p>
        <p v-else-if="!loading && !open.length" class="ah-small ai-open-alerts__none" data-test="alerts-none">
            <span class="ai-alerts__mark ai-alerts__mark--clear" aria-hidden="true"></span>{{ $t('AiAlerts.open_none') }}
        </p>
        <ul v-else-if="open.length" class="ai-open-alerts__list">
            <li v-for="incident in open" :key="incident._id" class="ai-open-alerts__row" :data-type="incident.type" data-state="open">
                <span class="ah-chip ah-chip--warn ai-open-alerts__chip" :data-chip="incident.type">
                    <span class="ai-alerts__mark" :class="`ai-alerts__mark--${formOf(incident.type)}`" aria-hidden="true"></span>{{ $t(`AiAlerts.type_${incident.type}`) }}
                </span>
                <span class="ai-open-alerts__text">{{ textOf(incident) }}</span>
                <span class="ah-small ai-open-alerts__since">{{ $t('AiAlerts.opened_at', { at: when(incident.openedAt) }) }}</span>
            </li>
        </ul>
    </section>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { reasonOf } from "./useAgents";
import { ALERT_FORMS, ALERT_TYPES, incidentTextOf } from "./rateAlerts";

defineOptions({ name: "AiOpenAlerts" });

const { t } = useI18n();

const incidents = ref([]);
const loading = ref(false);
const error = ref("");

const open = computed(() => incidents.value.filter((incident) => ALERT_TYPES.includes(incident?.type)));
const formOf = (type) => ALERT_FORMS[type];
const when = (iso) => (iso ? new Date(iso).toLocaleString() : "");
const textOf = (incident) => {
    const { key, params } = incidentTextOf(incident);
    return t(key, { ...params, agent: params.agent || t("AiAlerts.unnamed_agent") });
};

const load = async () => {
    loading.value = true;
    error.value = "";
    try {
        const res = await apiRequest("get", env.AGENT_ALERTS);
        if (res?.data?.status !== true) throw new Error(res?.data?.statusText || t("AiAlerts.load_failed"));
        incidents.value = Array.isArray(res.data.data?.open) ? res.data.data.open : [];
    } catch (e) {
        error.value = reasonOf(e, "AiAlerts.load_failed");
    } finally {
        loading.value = false;
    }
};

defineExpose({ load });
onMounted(load);
</script>

<style>
@import "./rateAlerts.css";
</style>

<style scoped>
.ai-open-alerts { padding: 12px 16px; margin-bottom: 14px; }
.ai-open-alerts.has-open { border-left: 3px solid var(--warn); }
.ai-open-alerts__head { display: flex; align-items: center; gap: 8px; }
.ai-open-alerts__none { display: flex; align-items: center; margin: 8px 0 0; color: var(--ok-ink); }
.ai-open-alerts__list { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.ai-open-alerts__row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font: var(--text-small); color: var(--ink); }
.ai-open-alerts__chip { display: inline-flex; align-items: center; }
.ai-open-alerts__text { flex: 1; min-width: 180px; }
.ai-open-alerts__since { color: var(--ink-2); }
</style>
