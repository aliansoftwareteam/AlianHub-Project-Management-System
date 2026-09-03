<template>
    <div class="ah-page al">
        <div class="ah-toolbar">
            <div class="ah-toolbar__title">{{ $t('AuditV2.title') }}</div>
            <span class="ah-chip ah-chip--mono">{{ todayLabel }}</span>
            <div class="ah-toolbar__spacer"></div>
            <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="busy" @click="exportCsv">
                <ShellIcon name="docs" :size="14" />{{ $t('AuditV2.export_csv') }}
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
                <input v-model.trim="search" type="search" class="al__search-input" :placeholder="$t('AuditV2.search')" @keyup.enter="reload" />
            </div>
            <span v-if="projectFilter" class="ah-chip ah-chip--brand">
                {{ projectFilter.name }}
                <button type="button" class="al__chip-x" :aria-label="$t('AuditV2.clear_filter')" @click="clearProject">×</button>
            </span>
        </div>

        <div class="al__body ah-scroll">
            <div v-if="error" class="ah-empty">{{ error }}</div>
            <div v-else-if="busy && !rows.length" class="ah-empty">{{ $t('AuditV2.loading') }}</div>
            <div v-else-if="!rows.length" class="ah-empty">{{ $t('AuditV2.none') }}</div>

            <table v-else class="al__table">
                <thead>
                    <tr>
                        <th>{{ $t('AuditV2.col_time') }}</th>
                        <th>{{ $t('AuditV2.col_actor') }}</th>
                        <th>{{ $t('AuditV2.col_event') }}</th>
                        <th>{{ $t('AuditV2.col_reason') }}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="row in rows" :key="row._id" class="al__row" :class="{ 'al__row--undone': row.meta && row.meta.undoneAt, 'al__row--refused': row.action === 'agent.action_refused' }">
                        <td class="ah-mono al__time">{{ time(row.createdAt) }}</td>
                        <td>
                            <span class="al__actor">
                                <span class="ah-avatar ah-avatar--sm" :class="{ 'ah-avatar--agent': isAgent(row) }">{{ initial(row) }}</span>
                                <span class="al__actor-name">{{ actorName(row) }}</span>
                                <span v-if="isAgent(row)" class="ah-chip ah-chip--agent ah-chip--mono">{{ $t('AuditV2.agent') }}</span>
                            </span>
                        </td>
                        <td>
                            <div class="al__event">
                                <span v-if="row.action === 'agent.action_refused'" class="al__blocked">{{ $t('AuditV2.blocked_by_policy') }}</span>
                                <span class="ah-mono al__action">{{ eventAction(row) }}</span>
                                <span v-if="row.entityName || row.entityId" class="al__entity">{{ row.entityName || row.entityId }}</span>
                            </div>
                            <div v-if="row.meta && row.meta.cost && (row.meta.cost.tokens || row.meta.cost.usd)" class="al__cost ah-mono">
                                {{ $t('AuditV2.cost', { tokens: row.meta.cost.tokens || 0, usd: Number(row.meta.cost.usd || 0).toFixed(2) }) }}
                            </div>
                        </td>
                        <td>
                            <div class="al__reason">{{ (row.meta && row.meta.reason) || '—' }}</div>
                            <div class="al__meta">
                                <span v-if="row.meta && row.meta.runId" class="ah-mono al__run">{{ $t('AuditV2.run_n', { n: String(row.meta.runId).slice(-4) }) }}</span>
                                <span v-if="row.meta && row.meta.undoneAt" class="ah-chip ah-chip--warn">{{ $t('AuditV2.undone_at', { t: time(row.meta.undoneAt) }) }}</span>
                                <button
                                    v-else-if="row.meta && row.meta.undoable"
                                    type="button"
                                    class="ah-btn ah-btn--ghost ah-btn--sm"
                                    :disabled="undoingId === row._id"
                                    @click="undo(row)"
                                >{{ undoingId === row._id ? $t('AuditV2.undoing') : $t('AuditV2.undo') }}</button>
                                <span v-else-if="row.action === 'agent.action_refused'" class="ah-small">{{ $t('AuditV2.nothing_ran') }}</span>
                            </div>
                        </td>
                    </tr>
                </tbody>
            </table>

            <div v-if="rows.length && page < totalPages" class="al__more">
                <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="busy" @click="loadMore">{{ $t('AuditV2.load_more') }}</button>
            </div>
            <p v-if="rows.length" class="al__note ah-small">{{ $t('AuditV2.retention') }}</p>
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
import { apiRequest } from "@/services";
import { useGetterFunctions } from "@/composable";
import * as env from "@/config/env";

defineOptions({ name: "AuditLogPage" });

const { t } = useI18n();
const $toast = useToast();
const route = useRoute();
const { getUser } = useGetterFunctions();

const rows = ref([]);
const page = ref(1);
const totalPages = ref(1);
const total = ref(0);
const busy = ref(false);
const error = ref("");
const scope = ref("all");
const search = ref("");
const undoingId = ref("");
const projectFilter = ref(route.query.projectId ? { id: route.query.projectId, name: route.query.projectName || t("AuditV2.this_project") } : null);

const tabs = [
    { key: "all", label: "AuditV2.tab_all" },
    { key: "agent", label: "AuditV2.tab_agents" },
    { key: "gated", label: "AuditV2.tab_gated" },
    { key: "undone", label: "AuditV2.tab_undone" }
];

const todayCount = computed(() => rows.value.filter((r) => moment(r.createdAt).isSame(moment(), "day")).length || total.value);
const todayLabel = computed(() => t("AuditV2.today_events", {
    n: todayCount.value,
    unit: t(todayCount.value === 1 ? "AuditV2.event_one" : "AuditV2.event_other")
}));

const isAgent = (row) => row.meta && row.meta.actorType === "agent";
const actorName = (row) => (isAgent(row) ? row.meta.agentName || t("AuditV2.an_agent") : row.actorName || getUser(row.actorId)?.Employee_Name || t("AuditV2.someone"));
const initial = (row) => actorName(row).charAt(0).toUpperCase();
const eventAction = (row) => (row.meta && row.meta.action) || row.action;
const time = (at) => (at ? moment(at).format("HH:mm") : "");

const query = (extra = {}) => {
    const q = { page: page.value, limit: 25, ...extra };
    if (scope.value === "agent") q.actorType = "agent";
    if (scope.value === "gated") q.gated = "true";
    if (scope.value === "undone") q.undone = "true";
    if (search.value) q.q = search.value;
    if (projectFilter.value) q.projectId = projectFilter.value.id;
    return Object.entries(q).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
};

const load = async ({ append = false } = {}) => {
    busy.value = true;
    error.value = "";
    try {
        const res = await apiRequest("get", `${env.AUDIT_LOGS}?${query()}`);
        if (!res?.data?.status) {
            error.value = res?.data?.statusText || t("AuditV2.failed");
            return;
        }
        rows.value = append ? [...rows.value, ...(res.data.data || [])] : res.data.data || [];
        const meta = res.data.metadata || {};
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
const loadMore = () => { page.value += 1; load({ append: true }); };

const undo = async (row) => {
    undoingId.value = row._id;
    try {
        const res = await apiRequest("post", `${env.AUDIT_LOGS}/${row._id}/undo`, {});
        if (!res?.data?.status) throw new Error(res?.data?.statusText || t("AuditV2.undo_failed"));
        $toast.success(t("AuditV2.undone_toast"), { position: "top-right" });
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
        $toast.error(t("AuditV2.export_failed"), { position: "top-right" });
    } finally {
        busy.value = false;
    }
};

onMounted(load);
</script>

<style scoped>
.al { background: var(--canvas); }
.al__bar { display: flex; align-items: center; gap: 12px; padding: 12px 24px; border-bottom: 1px solid var(--hairline); background: var(--surface); flex-wrap: wrap; }
.al__search { display: flex; align-items: center; gap: 7px; padding: 0 10px; height: 30px; border: 1px solid var(--border); border-radius: var(--r-input); background: var(--surface); color: var(--ink-3); flex: 1; max-width: 320px; }
.al__search-input { border: 0; background: transparent; outline: none; flex: 1; font: var(--text-small); color: var(--ink); }
.al__chip-x { border: 0; background: transparent; cursor: pointer; color: inherit; font-size: 14px; line-height: 1; padding: 0 0 0 4px; }
.al__body { flex: 1; min-height: 0; overflow: auto; padding: 16px 24px 24px; }
.al__table { width: 100%; border-collapse: collapse; background: var(--surface); border: 1px solid var(--hairline); border-radius: var(--r-card); overflow: hidden; }
.al__table th { text-align: left; font: var(--text-label); letter-spacing: .06em; text-transform: uppercase; color: var(--ink-2); padding: 9px 12px; border-bottom: 1px solid var(--hairline); background: var(--surface-2); }
.al__table td { padding: 11px 12px; border-bottom: 1px solid var(--hairline); vertical-align: top; font: var(--text-small); color: var(--ink); }
.al__row:last-child td { border-bottom: 0; }
.al__row--undone { opacity: .66; }
.al__row--refused { background: var(--danger-bg); }
.al__time { color: var(--ink-2); white-space: nowrap; }
.al__actor { display: flex; align-items: center; gap: 7px; white-space: nowrap; }
.al__actor-name { font-weight: 500; }
.al__event { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.al__action { color: var(--ink); }
.al__entity { color: var(--ink-2); }
.al__blocked { color: var(--danger-ink); font-weight: 600; }
.al__cost { color: var(--ink-3); margin-top: 3px; }
.al__reason { color: var(--ink-2); }
.al__meta { display: flex; align-items: center; gap: 8px; margin-top: 4px; flex-wrap: wrap; }
.al__run { color: var(--ink-3); }
.al__more { display: flex; justify-content: center; padding: 14px 0 4px; }
.al__note { margin: 10px 0 0; color: var(--ink-3); }
@media (max-width: 900px) {
    .al__table thead { display: none; }
    .al__table, .al__table tbody, .al__row, .al__table td { display: block; width: 100%; }
    .al__row { border-bottom: 1px solid var(--hairline); padding: 6px 0; }
    .al__table td { border-bottom: 0; padding: 4px 12px; }
}
</style>
