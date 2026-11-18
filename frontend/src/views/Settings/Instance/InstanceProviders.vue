<template>
    <div>
        <div v-if="error" class="in-banner in-banner--danger"><ShellIcon name="alert" :size="15" /><span>{{ error }}</span></div>
        <div v-else-if="!status" class="ah-empty">{{ $t('Instance.loading') }}</div>
        <template v-else>
            <div v-if="unpriced.length" class="in-banner in-banner--danger" data-test="unpriced-warning">
                <ShellIcon name="alert" :size="15" />
                <span>{{ $t('Providers.unpriced_warning', { models: unpriced.join(', ') }) }}</span>
            </div>

            <div class="in-banner" :class="status.routerEnabled ? 'in-banner--ok' : 'in-banner--warn'" data-test="router-flag">
                <ShellIcon :name="status.routerEnabled ? 'check' : 'info'" :size="15" />
                <span>{{ status.routerEnabled ? $t('Providers.router_on') : $t('Providers.router_off') }}</span>
            </div>

            <section class="ah-card in-card">
                <div class="in-card__head">
                    <span class="in-card__title">{{ $t('Providers.title') }}</span>
                    <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :disabled="loading" @click="load">
                        <ShellIcon name="refresh" :size="14" />{{ $t('Providers.refresh') }}
                    </button>
                </div>
                <p class="ah-small">{{ $t('Providers.scope_note', { node: status.node, minutes: windowMinutes }) }}</p>
                <div class="pv-scroll">
                    <table class="in-table">
                        <thead>
                            <tr>
                                <th>{{ $t('Providers.col_provider') }}</th>
                                <th>{{ $t('Providers.col_model') }}</th>
                                <th>{{ $t('Providers.col_state') }}</th>
                                <th>{{ $t('Providers.col_breaker') }}</th>
                                <th>{{ $t('Providers.col_calls') }}</th>
                                <th>{{ $t('Providers.col_latency') }}</th>
                                <th>{{ $t('Providers.col_last_error') }}</th>
                                <th>{{ $t('Providers.col_rate_limit') }}</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="row in rows" :key="row.provider" :data-test="`provider-${row.provider}`">
                                <td>
                                    <strong>{{ row.provider }}</strong>
                                    <span v-if="!row.configured" class="ah-chip">{{ $t('Providers.chip_unconfigured') }}</span>
                                </td>
                                <td>
                                    <span class="ah-mono">{{ row.model || '—' }}</span>
                                    <span v-if="row.model && !row.priced" class="ah-chip ah-chip--danger" data-test="unpriced-chip">{{ $t('Providers.chip_unpriced') }}</span>
                                </td>
                                <td><span class="ah-chip" :class="healthChip(row)">{{ $t(healthLabel(row)) }}</span></td>
                                <td>
                                    <span class="ah-chip" :class="breakerChip(row)" :data-test="`breaker-${row.provider}`">{{ $t(BREAKER_LABEL[row.health.breaker.state]) }}</span>
                                    <span v-if="row.health.breaker.retryAt && row.health.breaker.state !== 'closed'" class="ah-small">{{ $t('Providers.breaker_retry', { when: formatWhen(row.health.breaker.retryAt) }) }}</span>
                                </td>
                                <td>
                                    <span v-if="row.health.calls">{{ $t('Providers.calls', { ok: row.health.successes, total: row.health.calls }) }}</span>
                                    <span v-else class="ah-small">{{ $t('Providers.no_calls') }}</span>
                                </td>
                                <td class="ah-mono">{{ latency(row) }}</td>
                                <td>
                                    <span v-if="row.health.lastErrorType" class="ah-mono">{{ row.health.lastErrorType }}</span>
                                    <span v-else class="ah-small">—</span>
                                    <span v-if="row.health.lastErrorAt" class="ah-small">{{ formatWhen(row.health.lastErrorAt) }}</span>
                                </td>
                                <td>{{ rateLimitLabel(row) }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </section>

            <section class="ah-card in-card">
                <div class="in-card__head"><span class="in-card__title">{{ $t('Providers.policy_title') }}</span></div>
                <p class="ah-small">{{ $t('Providers.policy_body', policyValues) }}</p>
            </section>
        </template>
    </div>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { useInstanceApi, formatWhen } from "./useInstanceApi";

defineOptions({ name: "InstanceProviders" });

const BREAKER_LABEL = {
    closed: "Providers.breaker_closed",
    open: "Providers.breaker_open",
    half_open: "Providers.breaker_half_open",
};
const BREAKER_CHIP = { closed: "ah-chip--ok", open: "ah-chip--danger", half_open: "ah-chip--warn" };

const { t } = useI18n();
const { get, message, env } = useInstanceApi();
const status = ref(null);
const error = ref("");
const loading = ref(false);

const rows = computed(() => status.value?.providers || []);
const windowMinutes = computed(() => Math.round((status.value?.breakerPolicy?.windowMs || 0) / 60000));

/* A model with no price books zero cost, so every spend control silently stops
 * working. It is the one thing on this page that has to shout. */
const unpriced = computed(() => rows.value.filter((r) => r.configured && r.model && !r.priced).map((r) => `${r.provider} · ${r.model}`));

const policyValues = computed(() => {
    const p = status.value?.breakerPolicy || {};
    return {
        volume: p.volume ?? 0,
        percent: Math.round((p.threshold || 0) * 100),
        cooldown: Math.round((p.cooldownMs || 0) / 1000),
        ceiling: Math.round((p.maxCooldownMs || 0) / 1000),
        minutes: windowMinutes.value,
    };
});

const healthLabel = (row) => {
    if (!row.configured) return "Providers.health_unconfigured";
    if (!row.health.calls) return "Providers.health_untested";
    return row.health.successRate >= 0.9 ? "Providers.health_ok" : "Providers.health_degraded";
};

const healthChip = (row) => {
    if (!row.configured) return "";
    if (!row.health.calls) return "";
    return row.health.successRate >= 0.9 ? "ah-chip--ok" : "ah-chip--danger";
};

const breakerChip = (row) => BREAKER_CHIP[row.health.breaker.state] || "";

const latency = (row) => {
    const { p50, p95 } = row.health.latencyMs || {};
    return p50 === null || p50 === undefined ? "—" : `${Math.round(p50)} / ${Math.round(p95)} ms`;
};

const rateLimitLabel = (row) => {
    const budget = row.rateLimit || {};
    if (!budget.limitPerMinute) return t("Providers.rate_none");
    if (budget.blockedUntil) return t("Providers.rate_blocked", { when: formatWhen(budget.blockedUntil) });
    return t("Providers.rate_budget", { available: budget.available, limit: budget.limitPerMinute });
};

const load = async () => {
    loading.value = true;
    try {
        status.value = await get(env.INSTANCE_AI_PROVIDERS);
        error.value = "";
    } catch (e) {
        error.value = message(e);
    } finally {
        loading.value = false;
    }
};

onMounted(load);
</script>

<style scoped>
.pv-scroll { overflow-x: auto; }
.in-table .ah-chip { margin-left: 6px; }
.in-table .ah-small { display: block; color: var(--ink-2); }
</style>
