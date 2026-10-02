<template>
    <div class="ah-page al">
        <div class="ah-toolbar">
            <div class="ah-toolbar__title">{{ $t('Audit.title') }}</div>
            <span class="ah-chip ah-chip--mono">{{ todayLabel }}</span>
            <div class="ah-toolbar__spacer"></div>
            <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="busy" @click="exportCsv">
                <ShellIcon name="docs" :size="14" />{{ $t('Audit.export_csv') }}
            </button>
        </div>

        <div class="al__bar">
            <div class="ah-tabs">
                <button v-for="tab in tabs" :key="tab.key" type="button" class="ah-tab" :class="{ 'is-active': scope === tab.key }" @click="setScope(tab.key)">
                    {{ $t(tab.label) }}
                </button>
            </div>
            <div class="al__search">
                <ShellIcon name="search" :size="14" />
                <input v-model.trim="search" type="search" class="al__search-input" :placeholder="$t('Audit.search')" @keyup.enter="reload" />
            </div>
            <span v-if="projectFilter" class="ah-chip ah-chip--brand">
                {{ projectFilter.name }}
                <button type="button" class="al__chip-x" :aria-label="$t('Audit.clear_filter')" @click="clearProject">×</button>
            </span>
        </div>

        <div class="al__body ah-scroll">
            <div v-if="error" class="ah-empty">{{ error }}</div>
            <div v-else-if="busy && !rows.length" class="ah-empty">{{ $t('Audit.loading') }}</div>
            <EmptyState
                v-else-if="!rows.length"
                :illustration="narrowed ? 'search' : 'generic'"
                data-test="audit-empty"
                :heading-level="2"
                :title="$t(filtered ? 'Audit.none_filtered' : search ? 'Audit.none_match' : 'Audit.none')"
                :message="narrowed ? '' : $t('Audit.none_msg')"
                :action-label="$t(filtered ? 'Audit.clear_filters' : 'Audit.clear_search')"
                :action-allowed="narrowed"
                @action="clearFilters"
            />

            <table v-else class="al__table">
                <thead>
                    <tr>
                        <th>{{ $t('Audit.col_time') }}</th>
                        <th>{{ $t('Audit.col_actor') }}</th>
                        <th>{{ $t('Audit.col_event') }}</th>
                        <th>{{ $t('Audit.col_reason') }}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="row in rows" :key="row._id" class="al__row" :class="{ 'al__row--undone': row.meta && row.meta.undoneAt, 'al__row--refused': isRefusal(row) }">
                        <td class="al__time">
                            <span class="ah-mono">{{ time(row.createdAt) }}</span>
                            <span
                                v-if="showsIntegrity(row)"
                                class="ah-chip ah-chip--sm al__integrity"
                                :class="INTEGRITY_CHIPS[row.integrity.state]"
                                :data-test="'integrity-' + row.integrity.state"
                                :title="integrityHint(row)"
                            >{{ integrityLabel(row) }}</span>
                        </td>
                        <td>
                            <span class="al__actor">
                                <span class="ah-avatar ah-avatar--sm" :class="{ 'ah-avatar--agent': isAgent(row) }">{{ initial(row) }}</span>
                                <span class="al__actor-name">{{ actorName(row) }}</span>
                                <span v-if="isAgent(row)" class="ah-chip ah-chip--agent ah-chip--mono">{{ $t('Audit.agent') }}</span>
                            </span>
                            <div v-if="showsHashedIds(row)" class="ah-mono ah-small al__id" data-test="actor-id" :title="$t('Audit.names_not_checked')">{{ row.actorId }}</div>
                        </td>
                        <td>
                            <div class="al__event">
                                <span v-if="isRefusal(row)" class="al__blocked">{{ $t('Audit.blocked_by_policy') }}</span>
                                <span class="al__action" :title="eventKey(row)">{{ eventWords(t, row) }}</span>
                                <span v-if="entityOf(row)" class="al__entity" :title="entityOf(row) === entityKey(row) ? null : entityKey(row)">{{ entityOf(row) }}</span>
                            </div>
                            <div v-if="showsHashedIds(row) && row.entityId && entityOf(row) && ![entityOf(row), row.entityName].includes(row.entityId)" class="ah-mono ah-small al__id" data-test="entity-id" :title="$t('Audit.names_not_checked')">{{ row.entityId }}</div>
                            <div v-if="row.meta && row.meta.cost && (row.meta.cost.tokens || row.meta.cost.usd)" class="al__cost ah-mono">
                                {{ $t('Audit.cost', { tokens: row.meta.cost.tokens || 0, usd: Number(row.meta.cost.usd || 0).toFixed(2) }) }}
                            </div>
                            <details class="al__details ah-small" data-test="row-details">
                                <summary class="al__details-open">{{ $t('Audit.details') }}</summary>
                                <div v-for="line in detailLines(t, row, reasonOf(row))" :key="line.label" class="al__detail">
                                    <span class="al__detail-label">{{ line.label }}</span>
                                    <span class="ah-mono al__detail-value">{{ line.value }}</span>
                                </div>
                            </details>
                        </td>
                        <td>
                            <div class="al__reason">{{ reasonOf(row) || '—' }}</div>
                            <div class="al__meta">
                                <span v-if="row.meta && row.meta.runId" class="ah-mono al__run">{{ $t('Audit.run_n', { n: String(row.meta.runId).slice(-4) }) }}</span>
                                <span v-if="row.meta && row.meta.tainted" class="ah-chip ah-chip--warn" :title="taintTitle(row)" data-test="tainted">{{ $t('Audit.tainted') }}</span>
                                <span v-if="row.meta && row.meta.undoneAt" class="ah-chip ah-chip--warn">{{ $t('Audit.undone_at', { t: time(row.meta.undoneAt) }) }}</span>
                                <template v-else-if="row.meta && row.meta.undoable && !['project_not_visible', 'target_not_visible'].includes(row.undoReason)">
                                    <button
                                        type="button"
                                        class="ah-btn ah-btn--ghost ah-btn--sm"
                                        :disabled="undoingId === row._id || row.undoable === false"
                                        :title="row.undoable === false ? $t('Audit.undo_window_passed') : ''"
                                        @click="undo(row)"
                                    >{{ undoingId === row._id ? $t('Audit.undoing') : $t('Audit.undo') }}</button>
                                    <span v-if="row.undoable === false" class="ah-small">{{ $t('Audit.undo_window_passed') }}</span>
                                    <span v-else-if="row.undoUntil" class="ah-small">{{ $t('Audit.undo_until', { t: deadline(row.undoUntil) }) }}</span>
                                </template>
                                <span v-else-if="isRefusal(row)" class="ah-small">{{ $t('Audit.nothing_ran') }}</span>
                            </div>
                        </td>
                    </tr>
                </tbody>
            </table>

            <div v-if="rows.length && page < totalPages" class="al__more">
                <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="busy" @click="loadMore">{{ $t('Audit.load_more') }}</button>
            </div>
            <p v-if="rows.length" class="al__note ah-small">{{ $t('Audit.retention') }}</p>
            <p v-if="rows.length && chainOn" class="al__note ah-small">{{ $t('Audit.names_not_checked') }}</p>
            <p v-if="rows.length && approximate" class="al__note ah-small" data-test="total-approximate">{{ $t('Audit.total_approximate') }}</p>
        </div>
    </div>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import moment from "moment";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import EmptyState from "@/components/atom/EmptyState/EmptyState.vue";
import { apiRequest } from "@/services";
import { useGetterFunctions } from "@/composable";
import * as env from "@/config/env";
import { taintSourcesLine, taintSourcesOf } from "@/views/Ai/taintText";
import { detailLines, entityWords, eventKey, eventWords, reasonWords, searchKeys } from "@/views/Ai/auditWords";

defineOptions({ name: "AuditLogPage" });

const { t, te, tm, rt } = useI18n();
const $toast = useToast();
const route = useRoute();
const { getUser } = useGetterFunctions();

const rows = ref([]);
const page = ref(1);
const totalPages = ref(1);
const total = ref(0);
const busy = ref(false);
const error = ref("");
const search = ref("");
const undoingId = ref("");
const chainOn = ref(false);
const approximate = ref(false);
const projectFilter = ref(route.query.projectId ? { id: route.query.projectId, name: route.query.projectName || t("Audit.this_project") } : null);

const tabs = [
    { key: "all", label: "Audit.tab_all" },
    { key: "agent", label: "Audit.tab_agents" },
    { key: "outside", label: "Audit.tab_outside_agents" },
    { key: "gated", label: "Audit.tab_gated" },
    { key: "undone", label: "Audit.tab_undone" },
    { key: "refused", label: "Audit.tab_refusals" }
];
const scope = ref(tabs.some((tab) => tab.key === route.query.scope) ? route.query.scope : "all");

const filtered = computed(() => scope.value !== "all" || Boolean(projectFilter.value));
const narrowed = computed(() => filtered.value || Boolean(search.value));

const REFUSALS = ["agent.action_refused", "permission.refused"];
const INTEGRITY_CHIPS = { verified: "ah-chip--ok", broken: "ah-chip--danger", unverified: "ah-chip--warn", unchained: "" };

const todayCount = computed(() => rows.value.filter((r) => moment(r.createdAt).isSame(moment(), "day")).length || total.value);
const todayLabel = computed(() => t("Audit.today_events", {
    n: todayCount.value,
    unit: t(todayCount.value === 1 ? "Audit.event_one" : "Audit.event_other")
}));

const isAgent = (row) => row.meta && row.meta.actorType === "agent";
const outsideAgentName = ({ clientName, delegatedByName }) => t("Audit.outside_agent_for", {
    client: clientName || t("Audit.an_outside_agent"),
    person: delegatedByName || t("Audit.a_member")
});
const actorName = (row) => {
    if (row.outsideAgent) return outsideAgentName(row.outsideAgent);
    if (isAgent(row)) return row.meta.agentName || t("Audit.an_agent");
    return row.actorName || getUser(row.actorId)?.Employee_Name || t("Audit.someone");
};
const initial = (row) => actorName(row).charAt(0).toUpperCase();
const personName = (id) => getUser(id)?.Employee_Name || "";
const entityOf = (row) => entityWords(t, te, row, personName);
const entityKey = (row) => (row.entityType === "permission" ? row.entityName || row.entityId : null);
const reasonOf = (row) => reasonWords(t, te, row, personName);
const isRefusal = (row) => REFUSALS.includes(row.action);
const taintTitle = (row) => taintSourcesLine(t, taintSourcesOf(row.meta));
const showsIntegrity = (row) => Boolean(chainOn.value && row.integrity && row.integrity.state in INTEGRITY_CHIPS);
const showsHashedIds = (row) => Boolean(chainOn.value && row.chain && typeof row.chain.seq === "number");
const integrityKey = (row) => (row.integrity.state === "broken" && row.integrity.brokenAt == null ? "Audit.integrity_broken_row" : "Audit.integrity_" + row.integrity.state);
const integrityLabel = (row) => t(integrityKey(row), { seq: row.integrity.brokenAt });
const integrityHint = (row) => t(integrityKey(row) + "_hint", { seq: row.integrity.brokenAt });
const time = (at) => (at ? moment(at).format(moment(at).isSame(moment(), "day") ? "HH:mm" : "D MMM HH:mm") : "");
const deadline = (at) => (at ? moment(at).format("D MMM HH:mm") : "");

const wordsOf = (namespace) => Object.fromEntries(Object.entries(tm(namespace) || {}).map(([key, message]) => [key, rt(message)]));

const query = (extra = {}) => {
    const q = { page: page.value, limit: 25, ...extra };
    if (scope.value === "agent") q.actorType = "agent";
    if (scope.value === "outside") q.actorType = "outside_agent";
    if (scope.value === "gated") q.gated = "true";
    if (scope.value === "undone") q.undone = "true";
    if (scope.value === "refused") q.refused = "true";
    if (search.value) Object.assign(q, { q: search.value }, searchKeys(wordsOf, search.value));
    if (projectFilter.value) q.projectId = projectFilter.value.id;
    return Object.entries(q).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
};

const load = async ({ append = false } = {}) => {
    busy.value = true;
    error.value = "";
    try {
        const res = await apiRequest("get", `${env.AUDIT_LOGS}?${query()}`);
        if (!res?.data?.status) {
            error.value = res?.data?.statusText || t("Audit.failed");
            return;
        }
        rows.value = append ? [...rows.value, ...(res.data.data || [])] : res.data.data || [];
        const meta = res.data.metadata || {};
        chainOn.value = Boolean(meta.chain && meta.chain.on);
        approximate.value = (append && approximate.value) || Boolean(meta.approximate);
        totalPages.value = meta.totalPages || 1;
        total.value = meta.total || rows.value.length;
    } catch (e) {
        error.value = e?.response?.data?.statusText || e.message;
    } finally {
        busy.value = false;
    }
};

const reload = () => { page.value = 1; load(); };
const setScope = (key) => { scope.value = key; reload(); };
const clearProject = () => { projectFilter.value = null; reload(); };
const clearFilters = () => {
    search.value = "";
    scope.value = "all";
    projectFilter.value = null;
    reload();
};
const loadMore = () => { page.value += 1; load({ append: true }); };

const undo = async (row) => {
    undoingId.value = row._id;
    try {
        const res = await apiRequest("post", `${env.AUDIT_LOGS}/${row._id}/undo`, {});
        if (!res?.data?.status) throw new Error(res?.data?.statusText || t("Audit.undo_failed"));
        $toast.success(t("Audit.undone_toast"), { position: "top-right" });
        reload();
    } catch (e) {
        $toast.error(e.message, { position: "top-right" });
    } finally {
        undoingId.value = "";
    }
};

const exportCsv = async () => {
    busy.value = true;
    try {
        const res = await apiRequest("get", `${env.AUDIT_LOGS}/export?${query()}`, null, null, { responseType: "blob" });
        const blob = new Blob([res.data], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `audit-${moment().format("YYYY-MM-DD")}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    } catch (e) {
        $toast.error(t("Audit.export_failed"), { position: "top-right" });
    } finally {
        busy.value = false;
    }
};

onMounted(load);
</script>

<style scoped>
.al { background: var(--canvas); }
.al__bar { display: flex; align-items: center; gap: 12px; padding: 12px 24px; border-bottom: 1px solid var(--hairline); background: var(--surface); flex-wrap: wrap; }
.al__bar .ah-tabs { max-width: 100%; overflow-x: auto; scrollbar-width: none; }
.al__bar .ah-tabs::-webkit-scrollbar { display: none; }
.al__bar .ah-tab { flex: none; white-space: nowrap; }
.al__search { display: flex; align-items: center; gap: 7px; padding: 0 10px; height: 30px; border: 1px solid var(--border); border-radius: var(--r-input); background: var(--surface); color: var(--ink-2); flex: 1; max-width: 320px; }
.al__search-input { border: 0; background: transparent; outline: none; flex: 1; font: var(--text-small); color: var(--ink); }
.al__chip-x { border: 0; background: transparent; cursor: pointer; color: inherit; font-size: 14px; line-height: 1; padding: 0 0 0 4px; }
.al__body { flex: 1; min-height: 0; overflow: auto; padding: 16px 24px 24px; }
.al__table { width: 100%; border-collapse: collapse; background: var(--surface); border: 1px solid var(--hairline); border-radius: var(--r-card); overflow: hidden; }
.al__table th { text-align: left; font: var(--text-label); letter-spacing: .06em; text-transform: uppercase; color: var(--ink-2); padding: 9px var(--cell-pad-x, 12px); border-bottom: 1px solid var(--hairline); background: var(--surface-2); }
.al__table td { padding: var(--table-pad-y, 11px) var(--cell-pad-x, 12px); border-bottom: 1px solid var(--hairline); vertical-align: top; font: 400 var(--row-font, 12.5px)/var(--lh-body, 1.5) var(--font-ui); color: var(--ink); }
.al__row:last-child td { border-bottom: 0; }
.al__row--undone { opacity: .66; }
.al__row--refused { background: var(--danger-bg); }
.al__time { color: var(--ink-2); white-space: nowrap; }
.al__integrity { display: table; margin-top: 4px; }
.al__actor { display: flex; align-items: center; gap: 7px; white-space: nowrap; }
.al__actor-name { font-weight: 500; }
.al__event { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.al__action { color: var(--ink); }
.al__entity { color: var(--ink-2); }
.al__id { color: var(--ink-2); margin-top: 3px; }
.al__details { color: var(--ink-2); margin-top: 3px; }
.al__details-open { cursor: pointer; width: fit-content; border-radius: var(--r-input); }
.al__details-open:focus-visible { outline: none; box-shadow: var(--focus); }
.al__detail { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 2px; }
.al__detail-value { overflow-wrap: anywhere; }
.al__blocked { color: var(--danger-ink); font-weight: 600; }
.al__cost { color: var(--ink-2); margin-top: 3px; }
.al__reason { color: var(--ink-2); }
.al__meta { display: flex; align-items: center; gap: 8px; margin-top: 4px; flex-wrap: wrap; font-size: var(--fs-sm, 12.5px); }
.al__run { color: var(--ink-2); }
.al__more { display: flex; justify-content: center; padding: 14px 0 4px; }
.al__note { margin: 10px 0 0; color: var(--ink-2); }
@media (max-width: 900px) {
    .al__table thead { display: none; }
    .al__table, .al__table tbody, .al__row, .al__table td { display: block; width: 100%; box-sizing: border-box; }
    .al__row { border-bottom: 1px solid var(--hairline); padding: 6px 0; }
    .al__table td { border-bottom: 0; padding: 4px 12px; }
    .al__actor { white-space: normal; flex-wrap: wrap; }
    .al__event, .al__reason, .al__id { overflow-wrap: anywhere; }
}
@media (max-width: 767px) {
    .al.ah-page .ah-toolbar { padding: 0 16px; gap: 8px; }
    .al .ah-toolbar__title { white-space: nowrap; }
    .al__bar { padding: 10px 16px; }
    .al__body { padding: 12px 16px 20px; }
    .al__search { flex-basis: 100%; max-width: none; }
}
</style>
