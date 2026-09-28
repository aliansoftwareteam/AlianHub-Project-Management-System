<template>
    <div class="ah-page ai-page">
        <AiSidebar />
        <div class="ai-page__main">
            <div class="ah-toolbar">
                <div class="ah-toolbar__title">{{ $t('AiQuality.title') }}</div>
                <div class="ah-toolbar__spacer"></div>
                <div v-if="canSee" class="ah-tabs" role="tablist" :aria-label="$t('AiQuality.window_label')">
                    <button
                        v-for="d in QUALITY_WINDOWS"
                        :key="d"
                        type="button"
                        role="tab"
                        class="ah-tab"
                        :class="{ 'is-active': d === days }"
                        :aria-selected="d === days ? 'true' : 'false'"
                        :tabindex="d === days ? 0 : -1"
                        :data-days="d"
                        @click="pick(d)"
                        @keydown.right.prevent="step(1)"
                        @keydown.left.prevent="step(-1)"
                    >{{ $t('AiQuality.window_days', { n: d }) }}</button>
                </div>
            </div>

            <div class="ai-page__body ah-scroll">
                <p class="ai-lead">{{ $t('AiQuality.lead') }}</p>

                <div v-if="!canSee" data-test="owner-only">
                    <EmptyState :title="$t('AiQuality.owner_only_title')" :message="$t('AiQuality.owner_only_body')" />
                </div>
                <div v-else-if="loading && !data" class="ah-empty">{{ $t('Ai.loading') }}</div>
                <div v-else-if="loadError" data-test="load-error">
                    <EmptyState :title="$t('AiQuality.load_failed')" :message="loadError" :action-label="$t('AiQuality.retry')" @action="load" />
                </div>

                <template v-else-if="data">
                    <section class="ah-card ai-quality__card" :aria-labelledby="`${uid}-ratings`">
                        <h2 :id="`${uid}-ratings`" class="ah-label">{{ $t('AiQuality.ratings_title') }}</h2>
                        <p v-if="!total" class="ah-small" data-test="no-ratings">{{ $t('AiQuality.no_ratings') }}</p>
                        <template v-else>
                            <p class="ai-quality__summary">
                                <span class="ah-mono">{{ $t('AiQuality.summary', { up: ratings.up, down: ratings.down, liked: likedText(ratings) }) }}</span>
                            </p>
                            <svg
                                class="ai-quality__trend"
                                data-test="trend"
                                :viewBox="`0 0 ${TREND_W} ${TREND_H}`"
                                preserveAspectRatio="none"
                                role="img"
                                :aria-label="$t('AiQuality.trend_label', { days, up: ratings.up, down: ratings.down })"
                            >
                                <g v-for="bar in bars" :key="bar.day">
                                    <rect class="ai-quality__bar-down" :x="bar.x" :y="bar.down.y" :width="bar.width" :height="bar.down.height" />
                                    <rect class="ai-quality__bar-up" :x="bar.x" :y="bar.up.y" :width="bar.width" :height="bar.up.height" />
                                </g>
                            </svg>
                            <div class="ai-quality__legend ah-small" aria-hidden="true">
                                <span><i class="ai-quality__key ai-quality__key--up"></i>{{ $t('AiQuality.legend_up') }}</span>
                                <span><i class="ai-quality__key ai-quality__key--down"></i>{{ $t('AiQuality.legend_down') }}</span>
                            </div>

                            <div class="ai-quality__grid">
                                <div class="ai-quality__scroll">
                                    <table class="ai-quality__table" data-test="by-feature">
                                        <caption class="ai-quality__caption">{{ $t('AiQuality.by_feature') }}</caption>
                                        <thead>
                                            <tr>
                                                <th scope="col">{{ $t('AiQuality.col_feature') }}</th>
                                                <th scope="col">{{ $t('AiQuality.col_up') }}</th>
                                                <th scope="col">{{ $t('AiQuality.col_down') }}</th>
                                                <th scope="col">{{ $t('AiQuality.col_liked') }}</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            <tr v-for="row in ratings.byFeature" :key="row.feature" :data-feature="row.feature">
                                                <td>{{ featureLabel(row.feature) }}</td>
                                                <td class="ah-mono">{{ row.up }}</td>
                                                <td class="ah-mono">{{ row.down }}</td>
                                                <td class="ah-mono">{{ likedText(row) }}</td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                                <div class="ai-quality__scroll">
                                    <table class="ai-quality__table" data-test="by-model">
                                        <caption class="ai-quality__caption">{{ $t('AiQuality.by_model') }}</caption>
                                        <thead>
                                            <tr>
                                                <th scope="col">{{ $t('AiQuality.col_model') }}</th>
                                                <th scope="col">{{ $t('AiQuality.col_up') }}</th>
                                                <th scope="col">{{ $t('AiQuality.col_down') }}</th>
                                                <th scope="col">{{ $t('AiQuality.col_liked') }}</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            <tr v-for="row in ratings.byModel" :key="row.model" :data-model="row.model">
                                                <td class="ah-mono">{{ row.model || $t('AiQuality.model_unknown') }}</td>
                                                <td class="ah-mono">{{ row.up }}</td>
                                                <td class="ah-mono">{{ row.down }}</td>
                                                <td class="ah-mono">{{ likedText(row) }}</td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </template>
                    </section>

                    <section class="ah-card ai-quality__card" :aria-labelledby="`${uid}-disliked`">
                        <h2 :id="`${uid}-disliked`" class="ah-label">{{ $t('AiQuality.disliked_title') }}</h2>
                        <p class="ah-small ai-quality__hint">{{ $t('AiQuality.disliked_privacy') }}</p>
                        <p v-if="!disliked.length" class="ah-small">{{ $t('AiQuality.no_disliked') }}</p>
                        <ol v-else class="ai-quality__disliked" data-test="disliked">
                            <li v-for="item in disliked" :key="`${item.feature}:${item.itemId}`" class="ai-quality__item" :data-item="item.itemId">
                                <div class="ai-quality__item-head">
                                    <span class="ai-quality__item-feature">{{ featureLabel(item.feature) }}</span>
                                    <span class="ah-chip ah-chip--mono">{{ kindLabel(item.kind) }}</span>
                                    <span v-if="item.model" class="ah-chip ah-chip--mono">{{ item.model }}</span>
                                    <span class="ah-chip ah-chip--warn">{{ $t('AiQuality.down_count', { n: item.down }) }}</span>
                                </div>
                                <div v-if="reasonList(item).length" class="ai-quality__reasons">
                                    <span v-for="r in reasonList(item)" :key="r.key" class="ah-chip">{{ $t(`AiFeedback.reason_${r.key}`) }} · {{ r.n }}</span>
                                </div>
                                <ul v-if="item.notes && item.notes.length" class="ai-quality__notes">
                                    <li v-for="(note, i) in item.notes" :key="i">{{ declineReasonText(note, t) }}</li>
                                </ul>
                                <div v-for="(answer, i) in item.shared" :key="i" class="ai-quality__shared" data-test="shared-answer">
                                    <div class="ah-label">{{ $t('AiQuality.shared_answer') }}</div>
                                    <p class="ai-quality__answer">{{ answer.answer }}</p>
                                    <div v-if="answer.sources && answer.sources.length" class="ai-quality__sources ah-small">
                                        <span>{{ $t('AiQuality.sources') }}</span>
                                        <span v-for="source in answer.sources" :key="`${source.kind}:${source.id}`" class="ah-chip ah-chip--mono">{{ source.ref || source.id }}</span>
                                    </div>
                                </div>
                            </li>
                        </ol>
                    </section>

                    <section class="ah-card ai-quality__card" data-test="held-out" :aria-labelledby="`${uid}-held-out`">
                        <div class="ai-quality__row">
                            <h2 :id="`${uid}-held-out`" class="ah-label">{{ $t('AiQuality.held_out_title') }}</h2>
                            <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" data-test="held-out-run" :disabled="running" @click="runHeldOut">
                                {{ running ? $t('AiQuality.held_out_running') : $t('AiQuality.held_out_run') }}
                            </button>
                        </div>
                        <p class="ah-small ai-quality__hint">{{ $t('AiQuality.held_out_lead') }}</p>
                        <p v-if="runError" class="ah-field__error" role="alert">{{ runError }}</p>
                        <p v-if="!heldOut" class="ah-small">{{ $t('AiQuality.held_out_never') }}</p>
                        <template v-else>
                            <p class="ai-quality__pass" role="status">
                                <span class="ai-quality__figure ah-mono">{{ heldOut.passed }} / {{ heldOut.total }}</span>
                                <span>{{ $t('AiQuality.held_out_result', { pct: passPercent }) }}</span>
                                <span class="ah-small ah-muted"> · {{ $t('AiQuality.held_out_ran', { when: whenText(heldOut.ranAt) }) }}</span>
                            </p>
                            <ul v-if="heldOut.failures.length" class="ai-quality__failures">
                                <li v-for="(f, i) in heldOut.failures" :key="i" data-test="held-out-failure">
                                    <div>{{ f.question }}</div>
                                    <div class="ah-small ah-mono">{{ $t('AiQuality.held_out_expected', { list: listText(f.expected) }) }}</div>
                                    <div class="ah-small ah-mono">{{ $t('AiQuality.held_out_got', { list: listText(f.got) }) }}</div>
                                </li>
                            </ul>
                        </template>
                    </section>

                    <section class="ah-card ai-quality__card" :aria-labelledby="`${uid}-cost`">
                        <h2 :id="`${uid}-cost`" class="ah-label">{{ $t('AiQuality.cost_title', { month: cost.month }) }}</h2>
                        <p v-if="!cost.features.length" class="ah-small">{{ $t('AiQuality.no_cost') }}</p>
                        <div v-else class="ai-quality__scroll">
                            <table class="ai-quality__table" data-test="cost">
                                <thead>
                                    <tr>
                                        <th scope="col">{{ $t('AiQuality.col_feature') }}</th>
                                        <th scope="col">{{ $t('AiQuality.col_calls') }}</th>
                                        <th scope="col">{{ $t('AiQuality.col_cost') }}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr v-for="row in cost.features" :key="row.feature" :data-feature="row.feature">
                                        <td>{{ featureLabel(row.feature) }}</td>
                                        <td class="ah-mono">{{ row.calls }}</td>
                                        <td class="ah-mono">{{ usdText(row.usd) }}</td>
                                    </tr>
                                </tbody>
                                <tfoot>
                                    <tr>
                                        <th scope="row">{{ $t('AiQuality.cost_total') }}</th>
                                        <td></td>
                                        <td class="ah-mono">{{ usdText(cost.usedUsd) }}</td>
                                    </tr>
                                </tfoot>
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
import { isOwnerOrAdmin } from "@/utils/roles";
import AiSidebar from "./AiSidebar.vue";
import { reasonOf } from "./useAgents";
import { declineReasonText } from "./episodeText";
import { DEFAULT_QUALITY_WINDOW, FEATURE_LABELS, KIND_LABELS, QUALITY_WINDOWS, likedPercent, trendBars } from "./qualityView";

defineOptions({ name: "AiQuality" });

const TREND_W = 300;
const TREND_H = 48;

const { t, locale } = useI18n();
const { getters } = useStore();
const uid = `aiq-${Math.random().toString(36).slice(2, 9)}`;

const days = ref(DEFAULT_QUALITY_WINDOW);
const data = ref(null);
const loading = ref(false);
const loadError = ref("");
const forbidden = ref(false);
const running = ref(false);
const runError = ref("");

const privileged = computed(() => isOwnerOrAdmin(Number(getters["settings/companyUserDetail"]?.roleType)));
const canSee = computed(() => privileged.value && !forbidden.value);
const ratings = computed(() => data.value?.ratings || { up: 0, down: 0, byFeature: [], byModel: [], series: [] });
const total = computed(() => (ratings.value.up || 0) + (ratings.value.down || 0));
const bars = computed(() => trendBars(ratings.value.series, TREND_W, TREND_H));
const disliked = computed(() => data.value?.disliked || []);
const heldOut = computed(() => data.value?.heldOut || null);
const cost = computed(() => ({ month: "", usedUsd: 0, features: [], ...(data.value?.cost || {}) }));
const passPercent = computed(() => (heldOut.value?.total ? Math.round((heldOut.value.passed / heldOut.value.total) * 100) : 0));

const featureLabel = (feature) => (FEATURE_LABELS.includes(feature) ? t(`AiQuality.feature_${feature}`) : feature);
const kindLabel = (kind) => (KIND_LABELS.includes(kind) ? t(`AiQuality.kind_${kind}`) : kind);
const likedText = (row) => {
    const pct = likedPercent(row);
    return pct === null ? t("AiQuality.none") : t("AiQuality.percent", { n: pct });
};
const reasonList = (item) => Object.entries(item.reasons || {}).map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n);
const usdText = (usd) => t("AiQuality.usd", { n: Number(usd || 0).toFixed(2) });
const listText = (list) => (list && list.length ? list.join(", ") : t("AiQuality.held_out_nothing"));
const whenText = (at) => {
    const date = at ? new Date(at) : null;
    return date && !Number.isNaN(date.getTime()) ? date.toLocaleString(locale?.value || undefined, { dateStyle: "medium", timeStyle: "short" }) : "";
};

const load = async () => {
    if (!canSee.value) return;
    loading.value = true;
    loadError.value = "";
    try {
        const res = await apiRequest("get", `${env.AI_QUALITY}?days=${days.value}`);
        if (res?.data?.status !== true) throw new Error(res?.data?.statusText || t("AiQuality.load_failed"));
        data.value = res.data.data;
    } catch (error) {
        if (error?.response?.status === 403) forbidden.value = true;
        else loadError.value = reasonOf(error, "AiQuality.load_failed");
    } finally {
        loading.value = false;
    }
};

const pick = (d) => {
    if (d === days.value) return;
    days.value = d;
    load();
};

const step = (dir) => {
    const at = QUALITY_WINDOWS.indexOf(days.value);
    pick(QUALITY_WINDOWS[(at + dir + QUALITY_WINDOWS.length) % QUALITY_WINDOWS.length]);
};

const runHeldOut = async () => {
    running.value = true;
    runError.value = "";
    try {
        const res = await apiRequest("post", `${env.AI_QUALITY}/held-out`, {});
        if (res?.data?.status !== true) throw new Error(res?.data?.statusText || t("AiQuality.held_out_failed"));
        data.value = { ...(data.value || {}), heldOut: res.data.data };
    } catch (error) {
        runError.value = reasonOf(error, "AiQuality.held_out_failed");
    } finally {
        running.value = false;
    }
};

onMounted(load);
</script>

<style>
@import "./style.css";
</style>

<style scoped>
.ai-quality__card { padding: 14px 16px; margin-bottom: 14px; min-width: 0; }
.ai-quality__card h2 { margin: 0; }
.ai-quality__row { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.ai-quality__hint { margin: 6px 0 10px; color: var(--ink-2); }
.ai-quality__summary { margin: 8px 0; }
.ai-quality__trend { width: 100%; height: 48px; display: block; }
.ai-quality__bar-up { fill: var(--brand); }
.ai-quality__bar-down { fill: var(--warn-ink, var(--ink-2)); }
.ai-quality__legend { display: flex; gap: 14px; margin: 6px 0 4px; color: var(--ink-2); }
.ai-quality__key { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; vertical-align: -1px; }
.ai-quality__key--up { background: var(--brand); }
.ai-quality__key--down { background: var(--warn-ink, var(--ink-2)); }
.ai-quality__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; margin-top: 8px; }
.ai-quality__scroll { overflow-x: auto; min-width: 0; }
.ai-quality__table { width: 100%; border-collapse: collapse; margin-top: 6px; font: var(--text-small); }
.ai-quality__caption { text-align: left; font: var(--text-label); letter-spacing: .06em; text-transform: uppercase; color: var(--ink-2); padding: 4px 0; }
.ai-quality__table th { text-align: left; font: var(--text-label); letter-spacing: .06em; text-transform: uppercase; color: var(--ink-2); padding: 6px 10px; border-bottom: 1px solid var(--hairline); white-space: nowrap; }
.ai-quality__table td { padding: 8px 10px; border-bottom: 1px solid var(--hairline); color: var(--ink); white-space: nowrap; }
.ai-quality__table tfoot th, .ai-quality__table tfoot td { border-bottom: 0; }
.ai-quality__disliked { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.ai-quality__item { border: 1px solid var(--hairline); border-radius: 9px; padding: 10px 12px; background: var(--surface); min-width: 0; }
.ai-quality__item-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.ai-quality__item-feature { font-weight: 600; color: var(--ink); margin-right: 4px; }
.ai-quality__reasons { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.ai-quality__notes { margin: 8px 0 0; padding-left: 18px; font: var(--text-small); color: var(--ink-2); overflow-wrap: anywhere; }
.ai-quality__shared { margin-top: 10px; padding: 8px 10px; border-radius: 7px; background: var(--fill); }
.ai-quality__answer { margin: 4px 0 0; font: var(--text-small); white-space: pre-wrap; overflow-wrap: anywhere; color: var(--ink); max-height: 180px; overflow: auto; }
.ai-quality__sources { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 6px; color: var(--ink-2); }
.ai-quality__pass { margin: 4px 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; }
.ai-quality__figure { font-size: 18px; font-weight: 600; color: var(--ink); }
.ai-quality__failures { margin: 8px 0 0; padding-left: 18px; display: flex; flex-direction: column; gap: 8px; overflow-wrap: anywhere; }
</style>
