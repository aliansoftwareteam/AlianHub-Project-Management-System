<template>
    <div>
        <div v-if="error" class="in-banner in-banner--danger"><ShellIcon name="alert" :size="15" /><span>{{ error }}</span></div>
        <div v-else-if="!summary" class="ah-empty">{{ $t('Instance.loading') }}</div>
        <template v-else>
            <div v-if="actionError" class="in-banner in-banner--danger" data-test="action-error"><ShellIcon name="alert" :size="15" /><span>{{ actionError }}</span></div>
            <div v-if="summary.instance.killSwitch" class="in-banner in-banner--warn" data-test="kill-switch"><ShellIcon name="alert" :size="15" /><span>{{ $t('Enforcement.kill_switch') }}</span></div>

            <section class="ah-card in-card">
                <div class="in-card__head">
                    <span class="in-card__title">{{ $t('Enforcement.default_title') }}</span>
                    <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :disabled="busy" @click="load">
                        <ShellIcon name="refresh" :size="14" />{{ $t('Instance.refresh') }}
                    </button>
                </div>
                <p class="ah-small">{{ $t('Enforcement.default_lead') }}</p>
                <div class="in-field">
                    <div>
                        <label class="in-field__label" for="enforcement-default">
                            {{ $t('Enforcement.default_label') }}
                            <span class="ah-chip" :class="{ 'ah-chip--mono': summary.instance.locked }" data-test="instance-source">{{ $t(`Enforcement.source_${summary.instance.source}`) }}</span>
                        </label>
                        <div class="in-field__help">{{ $t('Enforcement.default_help') }} <code class="ah-mono">{{ ENV_KEY }}</code></div>
                    </div>
                    <div class="in-field__control">
                        <select id="enforcement-default" :key="`default-${version}`" class="ah-input" :value="summary.instance.mode" :disabled="summary.instance.locked || busy" data-test="instance-default" @change="setDefault($event.target.value)">
                            <option v-for="m in MODES" :key="m" :value="m">{{ $t(`Enforcement.mode_${m}`) }}</option>
                        </select>
                        <span v-if="summary.instance.locked" class="ah-small">{{ $t('Enforcement.locked_help') }}</span>
                    </div>
                </div>
                <p class="ah-small" data-test="cache-note">{{ summary.cacheTtlSeconds > 0 ? $t('Enforcement.cache_note', { seconds: summary.cacheTtlSeconds }) : $t('Enforcement.cache_note_now') }}</p>
            </section>

            <section class="ah-card in-card">
                <div class="in-card__head"><span class="in-card__title">{{ $t('Enforcement.workspaces_title') }}</span></div>
                <p class="ah-small">{{ $t('Enforcement.readiness_rule', { days: summary.readyAfterDays }) }}</p>
                <div class="en-scroll">
                    <table class="in-table">
                        <thead>
                            <tr>
                                <th>{{ $t('Enforcement.col_workspace') }}</th>
                                <th>{{ $t('Enforcement.col_mode') }}</th>
                                <th>{{ $t('Enforcement.col_effective') }}</th>
                                <th>{{ $t('Enforcement.col_rows') }}</th>
                                <th>{{ $t('Enforcement.col_last_row') }}</th>
                                <th>{{ $t('Enforcement.col_in_report') }}</th>
                                <th>{{ $t('Enforcement.col_readiness') }}</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="w in summary.workspaces" :key="`${w.companyId}-${version}`" :data-test="`workspace-${w.companyId}`">
                                <td><strong>{{ w.name || w.companyId }}</strong><span class="ah-small ah-mono">{{ w.companyId }}</span></td>
                                <td>
                                    <select class="ah-input en-select" :value="w.mode" :disabled="busy" :aria-label="$t('Enforcement.mode_for', { name: w.name || w.companyId })" :data-test="`mode-${w.companyId}`" @change="setMode(w, $event.target.value)">
                                        <option v-for="m in WORKSPACE_MODES" :key="m" :value="m">{{ $t(`Enforcement.mode_${m}`) }}</option>
                                    </select>
                                </td>
                                <td><span class="ah-chip" :class="MODE_CHIP[w.effectiveMode]" :data-test="`effective-${w.companyId}`">{{ $t(`Enforcement.mode_${w.effectiveMode}`) }}</span></td>
                                <td>{{ w.rows30d }}</td>
                                <td>{{ formatWhen(w.lastRowAt) }}</td>
                                <td>{{ w.daysSinceFirstReportRow === null ? '—' : $t('Enforcement.days', { n: w.daysSinceFirstReportRow }) }}</td>
                                <td><span class="ah-chip" :class="readinessChip(w)" :data-test="`readiness-${w.companyId}`">{{ readinessText(w) }}</span></td>
                                <td>
                                    <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :data-test="`rows-${w.companyId}`" @click="open(w.companyId, w.name || w.companyId)">{{ $t('Enforcement.show_rows') }}</button>
                                </td>
                            </tr>
                            <tr data-test="workspace-instance">
                                <td><strong>{{ $t('Enforcement.instance_bucket') }}</strong><span class="ah-small">{{ $t('Enforcement.instance_bucket_help') }}</span></td>
                                <td>—</td>
                                <td>—</td>
                                <td>{{ summary.instanceBucket.rows30d }}</td>
                                <td>{{ formatWhen(summary.instanceBucket.lastRowAt) }}</td>
                                <td>—</td>
                                <td>—</td>
                                <td>
                                    <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" data-test="rows-instance" @click="open(INSTANCE_BUCKET, $t('Enforcement.instance_bucket'))">{{ $t('Enforcement.show_rows') }}</button>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </section>

            <section v-if="selected" class="ah-card in-card" data-test="decisions">
                <div class="in-card__head">
                    <span class="in-card__title">{{ $t('Enforcement.rows_title', { name: selected.name }) }}</span>
                    <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" @click="selected = null">{{ $t('Enforcement.close') }}</button>
                </div>
                <form class="in-actions" data-test="decision-filters" @submit.prevent="loadRows">
                    <label class="ah-small" for="enforcement-reason">{{ $t('Enforcement.filter_reason') }}</label>
                    <select id="enforcement-reason" class="ah-input en-select" :value="filters.reason" data-test="reason-filter" @change="applyFilter('reason', $event.target.value)">
                        <option value="">{{ $t('Enforcement.all_reasons') }}</option>
                        <option v-for="r in reasons" :key="r" :value="r">{{ $t(`Enforcement.reason_${r}`) }}</option>
                    </select>
                    <label class="ah-small" for="enforcement-days">{{ $t('Enforcement.filter_days') }}</label>
                    <select id="enforcement-days" class="ah-input en-select" :value="String(filters.days)" @change="applyFilter('days', Number($event.target.value))">
                        <option v-for="d in DAY_OPTIONS" :key="d" :value="String(d)">{{ $t('Enforcement.days', { n: d }) }}</option>
                    </select>
                    <label class="ah-small" for="enforcement-key">{{ $t('Enforcement.filter_key') }}</label>
                    <input id="enforcement-key" v-model.trim="filters.key" type="text" class="ah-input en-select" data-test="key-filter" :placeholder="$t('Enforcement.key_placeholder')" />
                    <button type="submit" class="ah-btn ah-btn--secondary ah-btn--sm">{{ $t('Enforcement.apply') }}</button>
                </form>
                <p class="ah-small">{{ $t('Enforcement.known_difference_lead') }}</p>
                <div v-if="rowsLoading" class="ah-empty">{{ $t('Instance.loading') }}</div>
                <div v-else-if="!rows.length" class="ah-empty" data-test="no-decisions">{{ $t('Enforcement.no_rows') }}</div>
                <div v-else class="en-scroll">
                    <table class="in-table">
                        <thead>
                            <tr>
                                <th>{{ $t('Enforcement.col_day') }}</th>
                                <th>{{ $t('Enforcement.col_route') }}</th>
                                <th>{{ $t('Enforcement.col_key') }}</th>
                                <th>{{ $t('Enforcement.col_role') }}</th>
                                <th>{{ $t('Enforcement.col_scope') }}</th>
                                <th>{{ $t('Enforcement.col_reason') }}</th>
                                <th>{{ $t('Enforcement.col_count') }}</th>
                                <th>{{ $t('Enforcement.col_seen') }}</th>
                                <th>{{ $t('Enforcement.col_users') }}</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="r in rows" :key="r.id" data-test="decision-row">
                                <td>{{ formatDay(r.day) }}<span class="ah-small">{{ $t(`Enforcement.mode_${r.mode}`) }}</span></td>
                                <td class="ah-mono">{{ r.method }} {{ r.route }}</td>
                                <td class="ah-mono">{{ r.permission }}</td>
                                <td>{{ roleName(r.role) }}</td>
                                <td class="ah-mono">{{ r.scope === 'global' ? $t('Enforcement.scope_global') : r.scope }}</td>
                                <td>
                                    <span class="ah-chip" :class="r.knownDifference ? '' : 'ah-chip--warn'">{{ $t(`Enforcement.reason_${r.reason}`) }}</span>
                                    <span v-if="r.knownDifference" class="ah-chip" data-test="known-difference" :title="$t('Enforcement.known_difference_help')">{{ $t('Enforcement.known_difference') }}</span>
                                </td>
                                <td>{{ r.count }}</td>
                                <td>{{ formatWhen(r.firstSeen) }}<span class="ah-small">{{ formatWhen(r.lastSeen) }}</span></td>
                                <td>{{ userNames(r) }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </section>
        </template>
        <InstanceCspCard />
    </div>
</template>

<script setup>
import { onMounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { useInstanceApi, formatWhen } from "./useInstanceApi";
import InstanceCspCard from "./InstanceCspCard.vue";

defineOptions({ name: "InstanceEnforcement" });

const ENV_KEY = "PERMISSION_ENFORCEMENT_MODE";
const INSTANCE_BUCKET = "instance";
const MODES = ["off", "report", "enforce"];
const WORKSPACE_MODES = ["inherit", ...MODES];
const MODE_CHIP = { off: "", report: "ah-chip--warn", enforce: "ah-chip--ok" };
const DAY_OPTIONS = [7, 14, 30];
const ROLE_NAMES = { 0: "guest", 1: "owner", 2: "admin", 3: "member" };
const REASON_FALLBACK = ["denied", "no_seat", "role_not_allowed", "tasks_not_found", "null_global_flag", "check_failed", "unresolvable_id", "company_mismatch"];

const { t } = useI18n();
const $toast = useToast();
const { get, put, message, env } = useInstanceApi();

const summary = ref(null);
const error = ref("");
const actionError = ref("");
const busy = ref(false);
const version = ref(0);
const selected = ref(null);
const rows = ref([]);
const reasons = ref(REASON_FALLBACK);
const rowsLoading = ref(false);
const filters = reactive({ reason: "", key: "", days: 30 });

const load = async () => {
    try {
        summary.value = await get(env.INSTANCE_ENFORCEMENT);
        error.value = "";
        version.value += 1;
    } catch (e) {
        error.value = message(e);
    }
};

const readinessText = (w) => {
    if (w.effectiveMode !== "report") return t("Enforcement.not_in_report");
    if (w.readyToEnforce) return t("Enforcement.ready");
    if (w.streakDays === null || w.streakDays === undefined) return t("Enforcement.no_streak_yet");
    return t("Enforcement.quiet_days", { n: w.streakDays, of: summary.value.readyAfterDays });
};

const readinessChip = (w) => {
    if (w.readyToEnforce) return "ah-chip--ok";
    return w.effectiveMode === "report" ? "ah-chip--warn" : "";
};

const change = async (request, done) => {
    busy.value = true;
    actionError.value = "";
    try {
        await request();
        done();
    } catch (e) {
        actionError.value = message(e);
    } finally {
        busy.value = false;
        await load();
    }
};

const setMode = (w, mode) => {
    if (mode === w.mode) return;
    return change(
        () => put(`${env.INSTANCE_ENFORCEMENT}/${w.companyId}/mode`, { mode }),
        () => {
            const seconds = summary.value.cacheTtlSeconds;
            $toast.success(t(seconds > 0 ? "Enforcement.mode_saved" : "Enforcement.mode_saved_now", { name: w.name || w.companyId, seconds }));
        },
    );
};

const setDefault = (mode) => {
    if (mode === summary.value.instance.mode) return;
    return change(
        () => put(`${env.INSTANCE_ENFORCEMENT}/default`, { mode }),
        () => $toast.success(t("Enforcement.default_saved", { seconds: summary.value.cacheTtlSeconds })),
    );
};

const loadRows = async () => {
    if (!selected.value) return;
    rowsLoading.value = true;
    try {
        const params = new URLSearchParams({ days: String(filters.days) });
        if (filters.reason) params.set("reason", filters.reason);
        if (filters.key) params.set("key", filters.key);
        const data = await get(`${env.INSTANCE_ENFORCEMENT}/${selected.value.companyId}/decisions?${params}`);
        rows.value = data.rows || [];
        reasons.value = data.reasons && data.reasons.length ? data.reasons : REASON_FALLBACK;
        actionError.value = "";
    } catch (e) {
        actionError.value = message(e);
    } finally {
        rowsLoading.value = false;
    }
};

const applyFilter = (name, value) => {
    filters[name] = value;
    return loadRows();
};

const open = (companyId, name) => {
    selected.value = { companyId, name };
    filters.reason = "";
    filters.key = "";
    filters.days = 30;
    return loadRows();
};

const roleName = (role) => t(`Enforcement.role_${ROLE_NAMES[role] || "none"}`);
const userNames = (row) => (row.users || []).map((u) => u.name || u.id).join(", ");
const formatDay = (value) => (value ? new Date(value).toISOString().slice(0, 10) : "—");

onMounted(load);
</script>

<style scoped>
.en-scroll { overflow-x: auto; }
.en-select { max-width: 200px; }
.in-table .en-select { min-width: 120px; }
.in-table .ah-small { display: block; color: var(--ink-2); }
.in-table .ah-chip + .ah-chip { margin-left: 6px; }
</style>
