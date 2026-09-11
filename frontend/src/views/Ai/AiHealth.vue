<template>
    <div class="ah-page ai-page">
        <AiSidebar />
        <div class="ai-page__main">
            <div class="ah-toolbar">
                <div class="ah-toolbar__title">{{ $t('AiHealth.title') }}</div>
                <div class="ah-toolbar__spacer"></div>
                <button
                    v-if="canSee"
                    type="button"
                    class="ah-btn ah-btn--sm ai-health__thresholds-btn"
                    :class="showThresholds ? 'ah-btn--secondary' : 'ah-btn--ghost'"
                    :aria-expanded="showThresholds ? 'true' : 'false'"
                    aria-controls="alert-thresholds"
                    data-test="thresholds-toggle"
                    @click="showThresholds = !showThresholds"
                >{{ $t('AiHealth.thresholds_button') }}</button>
                <div v-if="canSee" class="ah-tabs" role="tablist" :aria-label="$t('AiHealth.window_label')">
                    <button
                        v-for="w in HEALTH_WINDOWS"
                        :key="w"
                        type="button"
                        role="tab"
                        class="ah-tab"
                        :class="{ 'is-active': w === windowName }"
                        :aria-selected="w === windowName"
                        :data-window="w"
                        @click="pick(w)"
                    >{{ $t(`AiHealth.window_${w}`) }}</button>
                </div>
            </div>

            <div class="ai-page__body ah-scroll">
                <p class="ai-lead">{{ $t('AiHealth.lead') }}</p>

                <AiAlertThresholds v-if="canSee && showThresholds" @close="showThresholds = false" @saved="refreshAlerts" />
                <AiOpenAlerts v-if="canSee" ref="openAlerts" />

                <div v-if="!canSee" data-test="owner-only">
                    <EmptyState :title="$t('AiHealth.owner_only_title')" :message="$t('AiHealth.owner_only_body')" />
                </div>
                <div v-else-if="loading" class="ah-empty">{{ $t('Ai.loading') }}</div>
                <div v-else-if="loadError" data-test="load-error">
                    <EmptyState :title="$t('AiHealth.load_failed')" :message="loadError" :action-label="$t('AiHealth.retry')" @action="load" />
                </div>
                <div v-else-if="empty" data-test="empty">
                    <EmptyState :title="$t('AiHealth.empty_title')" :message="$t('AiHealth.empty_body')" />
                </div>

                <template v-else>
                    <section class="ah-card ai-health__card">
                        <div class="ah-label">{{ $t('AiHealth.agents_title') }}</div>
                        <p v-if="!sortedAgents.length" class="ah-small">{{ $t('AiHealth.no_agents') }}</p>
                        <div v-else class="ai-health__scroll">
                            <table class="ai-health__table" data-test="agents">
                                <thead>
                                    <tr>
                                        <th v-for="col in AGENT_COLUMNS" :key="col.key" :aria-sort="ariaSortOf(col.key)">
                                            <button type="button" class="ai-health__sort" :class="{ 'is-on': sort.key === col.key }" :data-sort="col.key" @click="sortBy(col.key)">
                                                {{ $t(col.label) }}
                                            </button>
                                        </th>
                                        <th>{{ $t('AiHealth.col_trend') }}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr v-for="agent in sortedAgents" :key="agent.agentId" :data-agent="agent.agentId">
                                        <td>{{ agent.agentName || $t('AiHealth.unnamed_agent') }}</td>
                                        <td class="ah-mono">{{ agent.runs }}</td>
                                        <td>
                                            <span class="ah-mono">{{ percentText(agent.errorRate) }}</span>
                                            <span v-if="warningsOf(agent).includes('error')" class="ah-chip ah-chip--warn ai-health__chip" data-chip="error">{{ $t('AiHealth.chip_error_high') }}</span>
                                        </td>
                                        <td>
                                            <span class="ah-mono">{{ percentText(agent.approvalRate) }}</span>
                                            <span v-if="warningsOf(agent).includes('approval')" class="ah-chip ah-chip--warn ai-health__chip" data-chip="approval">{{ $t('AiHealth.chip_approval_low') }}</span>
                                        </td>
                                        <td class="ah-mono">{{ durationText(agent.p95DurationMs) }}</td>
                                        <td class="ah-mono">{{ usdText(agent.costUsd) }}</td>
                                        <td>
                                            <svg class="ai-health__spark" viewBox="0 0 64 18" preserveAspectRatio="none" role="img" :aria-label="$t('AiHealth.spark_label', { n: agent.runs })">
                                                <polyline :points="sparkPoints(agent.series, 64, 18)" />
                                            </svg>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </section>

                    <section v-if="models.length" class="ah-card ai-health__card">
                        <div class="ah-label">{{ $t('AiHealth.models_title') }}</div>
                        <div class="ai-health__scroll">
                            <table class="ai-health__table" data-test="models">
                                <thead>
                                    <tr>
                                        <th>{{ $t('AiHealth.col_model') }}</th>
                                        <th>{{ $t('AiHealth.col_calls') }}</th>
                                        <th>{{ $t('AiHealth.col_tokens') }}</th>
                                        <th>{{ $t('AiHealth.col_cost') }}</th>
                                        <th>{{ $t('AiHealth.col_error_rate') }}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr v-for="model in models" :key="model.model">
                                        <td class="ah-mono">{{ model.model }}</td>
                                        <td class="ah-mono">{{ model.calls }}</td>
                                        <td class="ah-mono">{{ model.tokens }}</td>
                                        <td class="ah-mono">{{ usdText(model.costUsd) }}</td>
                                        <td>
                                            <span class="ah-mono">{{ percentText(model.errorRate) }}</span>
                                            <span v-if="warningsOf({ errorRate: model.errorRate }).includes('error')" class="ah-chip ah-chip--warn ai-health__chip" data-chip="error">{{ $t('AiHealth.chip_error_high') }}</span>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </section>

                    <section v-if="features.length" class="ah-card ai-health__card">
                        <div class="ah-label">{{ $t('AiHealth.features_title') }}</div>
                        <div class="ai-health__scroll">
                            <table class="ai-health__table" data-test="features">
                                <thead>
                                    <tr>
                                        <th>{{ $t('AiHealth.col_feature') }}</th>
                                        <th>{{ $t('AiHealth.col_calls') }}</th>
                                        <th>{{ $t('AiHealth.col_cost') }}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr v-for="feature in features" :key="feature.feature">
                                        <td class="ah-mono">{{ feature.feature }}</td>
                                        <td class="ah-mono">{{ feature.calls }}</td>
                                        <td class="ah-mono">{{ usdText(feature.costUsd) }}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </section>
                </template>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import EmptyState from "@/components/atom/EmptyState/EmptyState.vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import AiSidebar from "./AiSidebar.vue";
import AiAlertThresholds from "./AiAlertThresholds.vue";
import AiOpenAlerts from "./AiOpenAlerts.vue";
import { reasonOf } from "./useAgents";
import { isOwnerOrAdmin } from "@/utils/roles";
import {
    AGENT_COLUMNS, DEFAULT_HEALTH_WINDOW, HEALTH_WINDOWS,
    costOf, durationParts, isEmptyMetrics, nextSort, percentOf, sortAgents, sparkPoints, warningsOf
} from "./healthTable";

defineOptions({ name: "AiHealth" });

const { t } = useI18n();
const { getters } = useStore();

const windowName = ref(DEFAULT_HEALTH_WINDOW);
const metrics = ref(null);
const loading = ref(false);
const loadError = ref("");
const forbidden = ref(false);
const sort = ref({ key: "runs", dir: "desc" });
const showThresholds = ref(false);
const openAlerts = ref(null);

const refreshAlerts = () => openAlerts.value?.load();

const privileged = computed(() => isOwnerOrAdmin(Number(getters["settings/companyUserDetail"]?.roleType)));
const canSee = computed(() => privileged.value && !forbidden.value);
const empty = computed(() => isEmptyMetrics(metrics.value));
const sortedAgents = computed(() => sortAgents(metrics.value?.agents, sort.value.key, sort.value.dir));
const models = computed(() => metrics.value?.models || []);
const features = computed(() => metrics.value?.features || []);

const isBlank = (value) => value === null || value === undefined;
const percentText = (rate) => (isBlank(rate) ? t("AiHealth.none") : t("AiHealth.percent", { n: percentOf(rate) }));
const durationText = (ms) => {
    if (isBlank(ms)) return t("AiHealth.none");
    const { key, n } = durationParts(ms);
    return t(key, { n });
};
const usdText = (usd) => t("AiHealth.usd", { n: costOf(usd) });
const ariaSortOf = (key) => (sort.value.key === key ? (sort.value.dir === "asc" ? "ascending" : "descending") : "none");
const sortBy = (key) => { sort.value = nextSort(sort.value, key); };

const load = async () => {
    if (!canSee.value) return;
    loading.value = true;
    loadError.value = "";
    try {
        const res = await apiRequest("get", `${env.AGENT_METRICS}?window=${windowName.value}`);
        if (res?.data?.status !== true) throw new Error(res?.data?.statusText || t("AiHealth.load_failed"));
        metrics.value = res.data.data;
    } catch (error) {
        if (error?.response?.status === 403) forbidden.value = true;
        else loadError.value = reasonOf(error, "AiHealth.load_failed");
    } finally {
        loading.value = false;
    }
};

const pick = (name) => {
    if (name === windowName.value) return;
    windowName.value = name;
    load();
};

onMounted(load);
</script>

<style>
@import "./style.css";
</style>

<style scoped>
.ai-health__card { padding: 14px 16px; margin-bottom: 14px; }
.ai-health__thresholds-btn { margin-right: 8px; }
.ai-health__scroll { overflow-x: auto; }
.ai-health__table { width: 100%; border-collapse: collapse; margin-top: 10px; font: var(--text-small); }
.ai-health__table th { text-align: left; font: var(--text-label); letter-spacing: .06em; text-transform: uppercase; color: var(--ink-2); padding: 6px 10px; border-bottom: 1px solid var(--hairline); white-space: nowrap; }
.ai-health__table td { padding: 9px 10px; border-bottom: 1px solid var(--hairline); color: var(--ink); vertical-align: middle; white-space: nowrap; }
.ai-health__table tr:last-child td { border-bottom: 0; }
.ai-health__sort { border: 0; background: transparent; padding: 0; font: inherit; letter-spacing: inherit; text-transform: inherit; color: inherit; cursor: pointer; }
.ai-health__sort.is-on { color: var(--ink); }
.ai-health__sort:focus-visible { outline: none; box-shadow: var(--focus); border-radius: 4px; }
.ai-health__chip { margin-left: 6px; }
.ai-health__spark { width: 64px; height: 18px; display: block; }
.ai-health__spark polyline { fill: none; stroke: var(--brand); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
</style>
