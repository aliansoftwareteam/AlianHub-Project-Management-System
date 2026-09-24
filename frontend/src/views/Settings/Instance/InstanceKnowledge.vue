<template>
    <div>
        <div v-if="error" class="in-banner in-banner--danger"><ShellIcon name="alert" :size="15" /><span>{{ error }}</span></div>
        <div v-else-if="!summary" class="ah-empty">{{ $t('Instance.loading') }}</div>
        <template v-else>
            <div v-if="indexerOff" class="in-banner in-banner--warn" data-test="indexer-off"><ShellIcon name="alert" :size="15" /><span>{{ $t('Knowledge.indexer_off') }} <code class="ah-mono">{{ `${summary.indexer.envKey}=tenant` }}</code></span></div>
            <div v-else class="in-banner in-banner--ok" data-test="indexer-on"><ShellIcon name="check" :size="15" /><span>{{ $t(summary.indexer.mode === 'tenant' ? 'Knowledge.indexer_tenant' : 'Knowledge.indexer_on') }} <code class="ah-mono">{{ `${summary.indexer.envKey}=${summary.indexer.mode}` }}</code></span></div>
            <div v-if="actionError" class="in-banner in-banner--danger" data-test="action-error"><ShellIcon name="alert" :size="15" /><span>{{ actionError }}</span></div>
            <div v-if="nothingErased" class="in-banner in-banner--warn" data-test="erase-nothing"><ShellIcon name="alert" :size="15" /><span>{{ $t('Knowledge.code_nothing_erased') }}</span></div>

            <section class="ah-card in-card">
                <div class="in-card__head">
                    <span class="in-card__title">{{ $t('Knowledge.title') }}</span>
                    <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :disabled="busy" @click="refresh">
                        <ShellIcon name="refresh" :size="14" />{{ $t('Instance.refresh') }}
                    </button>
                </div>
                <p class="ah-small">{{ $t('Knowledge.lead') }}</p>
                <p class="ah-small">{{ $t('Knowledge.no_text_note') }}</p>
            </section>

            <section v-for="w in summary.workspaces" :key="w.companyId" class="ah-card in-card" :data-test="`workspace-${w.companyId}`">
                <div class="in-card__head">
                    <span class="in-card__title">{{ w.name || w.companyId }} <span class="ah-small ah-mono">{{ w.companyId }}</span></span>
                    <span class="kn-chips" :data-test="`modes-${w.companyId}`">
                        <span class="ah-chip">{{ $t('Knowledge.indexer_label') }} · {{ $t(`Knowledge.mode_${w.modes.indexer}`) }}</span>
                        <span class="ah-chip">{{ $t('Knowledge.retrieval_label') }} · {{ $t(`Knowledge.mode_${w.modes.retrieval}`) }}</span>
                    </span>
                    <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :data-test="`open-${w.companyId}`" :disabled="busy" @click="toggle(w)">
                        {{ openId === w.companyId ? $t('Knowledge.close') : $t('Knowledge.open') }}
                    </button>
                </div>
                <div class="kn-chips">
                    <span v-for="s in w.sources" :key="s.sourceType" class="ah-chip" :class="stateChip(s)" :data-test="`state-${w.companyId}-${s.sourceType}`">
                        {{ sourceLabel(s.sourceType) }} · {{ $t(`Knowledge.backfill_${s.backfill}`) }}<template v-if="s.reindex === 'running'"> · {{ $t('Knowledge.reindex_running') }}</template>
                    </span>
                </div>

                <div v-if="openId === w.companyId" class="kn-figures" :data-test="`figures-${w.companyId}`">
                    <div class="in-actions">
                        <span v-if="detail" class="ah-small" data-test="figures-cached">{{ $t('Knowledge.cached_at', { at: formatWhen(detail.cachedAt) }) }}</span>
                        <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" data-test="refresh-figures" :disabled="busy" @click="loadDetail({ refresh: true })">
                            <ShellIcon name="refresh" :size="14" />{{ $t('Knowledge.refresh_figures') }}
                        </button>
                    </div>
                    <div v-if="detailError" class="in-banner in-banner--warn" data-test="figures-error"><span>{{ detailError }}</span></div>
                    <div v-else-if="!detail" class="ah-empty">{{ $t('Instance.loading') }}</div>
                    <template v-else>
                        <div class="kn-scroll">
                            <table class="in-table">
                                <thead>
                                    <tr>
                                        <th>{{ $t('Knowledge.col_source') }}</th>
                                        <th>{{ $t('Knowledge.col_chunks') }}</th>
                                        <th>{{ $t('Knowledge.col_sources') }}</th>
                                        <th>{{ $t('Knowledge.col_size') }}</th>
                                        <th>{{ $t('Knowledge.col_last_indexed') }}</th>
                                        <th>{{ $t('Knowledge.col_backfill') }}</th>
                                        <th>{{ $t('Knowledge.col_freshness') }}</th>
                                        <th>{{ $t('Knowledge.col_reindex') }}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr v-for="s in detail.sources" :key="s.sourceType" :data-test="`source-${s.sourceType}`">
                                        <td><strong>{{ sourceLabel(s.sourceType) }}</strong></td>
                                        <td>{{ s.chunks }}<span v-if="s.tombstones" class="ah-small">{{ $t('Knowledge.tombstones', { n: s.tombstones }) }}</span></td>
                                        <td>{{ s.sources }}</td>
                                        <td>{{ formatBytes(s.textBytes) }}</td>
                                        <td>{{ formatWhen(s.lastIndexedAt) }}</td>
                                        <td :data-test="`backfill-${s.sourceType}`">
                                            {{ $t(`Knowledge.backfill_${s.backfill.status}`) }}
                                            <span v-if="s.backfill.progress" class="ah-small">{{ $t('Knowledge.progress', s.backfill.progress) }}</span>
                                        </td>
                                        <td :data-test="`freshness-${s.sourceType}`">
                                            <span v-if="s.freshness.behindMs === null">—</span>
                                            <span v-else class="ah-chip" :class="{ 'ah-chip--warn': s.freshness.stale }">{{ s.freshness.stale ? $t('Knowledge.stale') : $t('Knowledge.fresh') }} · {{ $t('Knowledge.behind_minutes', { n: minutes(s.freshness.behindMs) }) }}</span>
                                            <span v-if="s.freshness.catchUpBehindMs !== null" class="ah-small">{{ $t('Knowledge.catch_up_behind', { n: minutes(s.freshness.catchUpBehindMs) }) }}</span>
                                        </td>
                                        <td>
                                            <span v-if="s.reindex.status" class="ah-small">
                                                {{ $t(`Knowledge.reindex_${s.reindex.status}`) }}
                                                <template v-if="s.reindex.progress"> · {{ $t('Knowledge.progress', s.reindex.progress) }}</template>
                                                <template v-if="s.reindex.failing"> · {{ $t('Knowledge.reindex_failing') }}</template>
                                            </span>
                                            <button v-if="canRun && summary.reindexable.includes(s.sourceType)" type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :data-test="`reindex-${s.sourceType}`" :disabled="busy || s.reindex.status === 'running'" @click="reindex(s.sourceType)">
                                                {{ $t('Knowledge.reindex') }}
                                            </button>
                                            <button v-if="canRun && s.reindex.status === 'running'" type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :data-test="`cancel-reindex-${s.sourceType}`" :disabled="busy" @click="cancelReindex(s.sourceType)">
                                                {{ $t('Knowledge.cancel_reindex') }}
                                            </button>
                                        </td>
                                    </tr>
                                </tbody>
                                <tfoot>
                                    <tr data-test="totals">
                                        <td><strong>{{ $t('Knowledge.total') }}</strong></td>
                                        <td>{{ detail.totals.chunks }}</td>
                                        <td>{{ detail.totals.sources }}</td>
                                        <td>{{ formatBytes(detail.totals.textBytes) }}</td>
                                        <td colspan="4"></td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>

                        <div class="kn-section">
                            <div class="in-card__head"><span class="in-card__title">{{ $t('Knowledge.embeddings_title') }}</span></div>
                            <dl class="in-kv">
                                <dt>{{ $t('Knowledge.model') }}</dt><dd class="ah-mono">{{ detail.embeddings.model }}<template v-if="!detail.embeddings.configured"> · {{ $t('Knowledge.no_key') }}</template></dd>
                                <dt>{{ $t('Knowledge.by_model') }}</dt>
                                <dd>
                                    <span v-for="m in detail.embeddings.byModel" :key="String(m.model)" class="ah-chip" :class="{ 'ah-chip--warn': !m.current }" :data-test="`model-${m.model || 'none'}`">
                                        {{ m.model || $t('Knowledge.no_vector') }} · {{ m.chunks }}
                                    </span>
                                </dd>
                                <dt>{{ $t('Knowledge.pending_label') }}</dt><dd data-test="pending-chunks">{{ $t('Knowledge.pending_chunks', { n: detail.embeddings.pendingChunks }) }}</dd>
                                <dt>{{ $t('Knowledge.spend') }}</dt><dd>{{ $t('Knowledge.spend_value', { usd: detail.embeddings.spend.usd, calls: detail.embeddings.spend.calls, tokens: detail.embeddings.spend.tokens, month: detail.embeddings.spend.month }) }}</dd>
                                <dt>{{ $t('Knowledge.budget') }}</dt><dd>{{ detail.embeddings.budget.budgetUsd ? $t('Knowledge.budget_value', detail.embeddings.budget) : $t('Knowledge.budget_none', detail.embeddings.budget) }}</dd>
                                <dt>{{ $t('Knowledge.breaker') }}</dt>
                                <dd data-test="breaker">
                                    <span v-if="detail.embeddings.breaker.open" class="ah-chip ah-chip--warn">{{ $t(`Knowledge.breaker_open_${detail.embeddings.breaker.reason}`, { until: formatWhen(detail.embeddings.breaker.until) }) }}</span>
                                    <span v-else class="ah-chip">{{ $t('Knowledge.breaker_closed') }}</span>
                                </dd>
                                <template v-if="detail.vectorStore">
                                    <dt>{{ $t('Knowledge.vector_store') }}</dt>
                                    <dd data-test="vector-store">
                                        <template v-if="detail.vectorStore.backend === 'atlas'">
                                            {{ $t('Knowledge.vector_store_atlas') }}
                                            <span class="ah-chip" :class="{ 'ah-chip--warn': vectorIndexStatus !== 'ready' }" data-test="vector-index">{{ $t(`Knowledge.vector_index_${vectorIndexStatus}`) }}</span>
                                            <span v-if="detail.vectorStore.breaker && detail.vectorStore.breaker.open" class="ah-chip ah-chip--warn" data-test="vector-breaker">{{ $t('Knowledge.vector_store_paused', { until: formatWhen(detail.vectorStore.breaker.until) }) }}</span>
                                        </template>
                                        <template v-else>{{ $t('Knowledge.vector_store_local') }}</template>
                                    </dd>
                                </template>
                            </dl>
                            <div v-if="canRun && detail.modes.retrieval === 'hybrid'" class="in-actions">
                                <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" data-test="reembed" :disabled="busy" @click="reembed">{{ $t('Knowledge.reembed') }}</button>
                                <span class="ah-small">{{ $t('Knowledge.reembed_help') }}</span>
                            </div>
                        </div>

                        <div class="kn-section">
                            <div class="in-card__head"><span class="in-card__title">{{ $t('Knowledge.files_title') }}</span></div>
                            <p class="ah-small">{{ $t('Knowledge.files_pending', { n: detail.files.pending }) }}</p>
                            <table v-if="detail.files.reasons.length" class="in-table">
                                <thead><tr><th>{{ $t('Knowledge.col_reason') }}</th><th>{{ $t('Knowledge.col_files') }}</th><th>{{ $t('Knowledge.col_exhausted') }}</th></tr></thead>
                                <tbody>
                                    <tr v-for="r in detail.files.reasons" :key="r.reason" :data-test="`reason-${r.reason}`">
                                        <td>{{ reasonLabel(r.reason) }}</td>
                                        <td>{{ r.count }}</td>
                                        <td>{{ r.retryable ? r.exhausted : '—' }}</td>
                                    </tr>
                                </tbody>
                            </table>
                            <p v-else class="ah-small">{{ $t('Knowledge.no_file_reasons') }}</p>
                            <div v-if="canRun && retryable" class="in-actions">
                                <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" data-test="retry-files" :disabled="busy" @click="retryFiles">{{ $t('Knowledge.retry_files') }}</button>
                                <span class="ah-small">{{ $t('Knowledge.retry_help') }}</span>
                            </div>
                        </div>

                        <div class="kn-section">
                            <div class="in-card__head"><span class="in-card__title">{{ $t('Knowledge.erase_title') }}</span></div>
                            <p class="ah-small">{{ $t('Knowledge.erase_lead') }}</p>
                            <form class="in-actions" data-test="erase-document" @submit.prevent="askErase('document')">
                                <label class="ah-small" for="knowledge-erase-type">{{ $t('Knowledge.erase_type') }}</label>
                                <select id="knowledge-erase-type" v-model="eraseDraft.sourceType" class="ah-input kn-input" data-test="erase-type" :disabled="busy">
                                    <option v-for="type in summary.documentTypes" :key="type" :value="type">{{ sourceLabel(type) }}</option>
                                </select>
                                <label class="ah-small" for="knowledge-erase-id">{{ $t('Knowledge.erase_id') }}</label>
                                <input id="knowledge-erase-id" v-model.trim="eraseDraft.sourceId" type="text" class="ah-input kn-input ah-mono" autocomplete="off" spellcheck="false" data-test="erase-id" :disabled="busy" />
                                <button type="submit" class="ah-btn ah-btn--danger ah-btn--sm" :disabled="busy">{{ $t('Knowledge.erase_document') }}</button>
                            </form>
                            <form class="in-actions" data-test="erase-person" @submit.prevent="askErase('person')">
                                <label class="ah-small" for="knowledge-erase-user">{{ $t('Knowledge.erase_user') }}</label>
                                <input id="knowledge-erase-user" v-model.trim="eraseDraft.userId" type="text" class="ah-input kn-input ah-mono" autocomplete="off" spellcheck="false" data-test="erase-user" :disabled="busy" />
                                <button type="submit" class="ah-btn ah-btn--danger ah-btn--sm" :disabled="busy">{{ $t('Knowledge.erase_person') }}</button>
                            </form>
                            <p class="ah-small">{{ $t('Knowledge.erase_person_rule') }}</p>
                            <p v-if="eraseInputError" class="ah-small kn-error" data-test="erase-input-error">{{ eraseInputError }}</p>

                            <div v-if="pendingErase" class="in-banner in-banner--danger kn-confirm" data-test="erase-confirm">
                                <span>{{ confirmText }}</span>
                                <label class="ah-small" for="knowledge-erase-confirm">{{ $t(CONFIRM_LABEL[pendingErase.kind]) }}</label>
                                <input id="knowledge-erase-confirm" v-model="eraseTyped" type="text" class="ah-input kn-input ah-mono" autocomplete="off" spellcheck="false" data-test="erase-confirm-input" />
                                <div class="in-actions">
                                    <button type="button" class="ah-btn ah-btn--danger ah-btn--sm" data-test="erase-confirm-button" :disabled="busy || !typedMatches" @click="erase">{{ pendingErase.kind === 'exclusion' ? $t('Knowledge.exclusion_remove_now') : $t('Knowledge.erase_now') }}</button>
                                    <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" data-test="erase-cancel" @click="cancelErase">{{ $t('Knowledge.cancel') }}</button>
                                </div>
                            </div>

                            <div class="in-card__head"><span class="in-card__title">{{ $t('Knowledge.exclusions_title') }}</span></div>
                            <p class="ah-small">{{ $t('Knowledge.exclusions_lead') }}</p>
                            <p v-if="exclusionsError" class="ah-small kn-error" data-test="exclusions-error">{{ exclusionsError }}</p>
                            <p v-else-if="exclusions && !exclusions.exclusions.length" class="ah-small" data-test="no-exclusions">{{ $t('Knowledge.no_exclusions') }}</p>
                            <div v-else-if="exclusions" class="kn-scroll">
                                <p v-if="exclusions.total > exclusions.exclusions.length" class="ah-small">{{ $t('Knowledge.exclusions_shown', { n: exclusions.exclusions.length, total: exclusions.total }) }}</p>
                                <table class="in-table">
                                    <thead>
                                        <tr>
                                            <th>{{ $t('Knowledge.col_kind') }}</th>
                                            <th>{{ $t('Knowledge.col_id') }}</th>
                                            <th>{{ $t('Knowledge.col_when') }}</th>
                                            <th>{{ $t('Knowledge.col_who') }}</th>
                                            <th>{{ $t('Knowledge.col_kept_out') }}</th>
                                            <th></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr v-for="x in exclusions.exclusions" :key="x.id" :data-test="`exclusion-${x.id}`">
                                            <td>{{ $t(`Knowledge.exclusion_kind_${x.kind}`) }}<span v-if="x.sourceType" class="ah-small">{{ sourceLabel(x.sourceType) }}</span></td>
                                            <td class="ah-mono">{{ exclusionTarget(x) }}</td>
                                            <td>{{ formatWhen(x.erasedAt) }}</td>
                                            <td>{{ erasedBy(x) }}</td>
                                            <td>{{ x.erasedChunks }}</td>
                                            <td>
                                                <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :data-test="`remove-exclusion-${x.id}`" :disabled="busy" @click="askRemoveExclusion(x)">{{ $t('Knowledge.exclusion_remove') }}</button>
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </template>
                </div>
            </section>

            <div v-if="pages > 1" class="in-actions kn-pager" data-test="pager">
                <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" data-test="page-prev" :disabled="busy || page <= 1" @click="goTo(page - 1)">{{ $t('Knowledge.page_prev') }}</button>
                <span class="ah-small" data-test="page-status">{{ $t('Knowledge.page_status', { page, pages, total: summary.total }) }}</span>
                <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" data-test="page-next" :disabled="busy || page >= pages" @click="goTo(page + 1)">{{ $t('Knowledge.page_next') }}</button>
            </div>
        </template>
    </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { useInstanceApi, formatBytes, formatWhen } from "./useInstanceApi";

defineOptions({ name: "InstanceKnowledge" });

const { t, te } = useI18n();
const $toast = useToast();
const { get, post, message, env } = useInstanceApi();

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const ADMIN_KEY_ACTOR = "instance-admin-key";
const CONFIRM_LABEL = { document: "Knowledge.erase_type_id", person: "Knowledge.erase_type_user_id", exclusion: "Knowledge.exclusion_type_id" };
const FILE_ID = /^[a-f0-9]{24}:[A-Za-z0-9_-]{1,64}$/i;
const TRANSLATED_CODES = [
    "indexer_off", "workspace_indexer_off", "invalid_company_id", "unknown_workspace", "invalid_source_type", "invalid_document_id", "invalid_user_id",
    "confirmation_mismatch", "backfill_pending", "backfill_running", "reindex_running", "not_hybrid", "embedding_unconfigured", "embedding_paused", "ai_off", "reembed_running", "server_error",
    "reindex_not_running", "figures_timed_out", "not_found", "invalid_exclusion_id",
];
const STATE_CHIP = { failed: "ah-chip--danger", running: "ah-chip--warn", catching_up: "ah-chip--warn", not_started: "" };

const summary = ref(null);
const detail = ref(null);
const detailError = ref("");
const exclusions = ref(null);
const exclusionsError = ref("");
const nothingErased = ref(false);
const openId = ref("");
const error = ref("");
const actionError = ref("");
const busy = ref(false);
const page = ref(1);
const eraseDraft = reactive({ sourceType: "page", sourceId: "", userId: "" });
const eraseInputError = ref("");
const pendingErase = ref(null);
const eraseTyped = ref("");

const indexerOff = computed(() => summary.value?.indexer?.mode === "off");
const canRun = computed(() => !indexerOff.value && detail.value?.indexer?.mode !== "off" && detail.value?.modes?.indexer !== "off");
const openName = computed(() => summary.value?.workspaces.find((w) => w.companyId === openId.value)?.name || "");
const VECTOR_INDEX_STATES = ["ready", "building", "missing", "failed", "unsupported", "unreachable", "mismatch", "timeout"];
const vectorIndexStatus = computed(() => {
    const status = detail.value?.vectorStore?.index?.status;
    return VECTOR_INDEX_STATES.includes(status) ? status : "unknown";
});
const retryable = computed(() => (detail.value?.files.reasons || []).some((r) => r.retryable && r.count > 0));
const pages = computed(() => {
    const s = summary.value;
    return s && s.pageSize ? Math.max(1, Math.ceil((s.total || 0) / s.pageSize)) : 1;
});

/* Source types and reasons are data from the server; one this screen has no words for shows as it is. */
const labelOr = (key, raw) => (te(key) ? t(key) : raw);
const sourceLabel = (sourceType) => labelOr(`Knowledge.source_${sourceType}`, sourceType);
const reasonLabel = (reason) => labelOr(`Knowledge.reason_${String(reason).replace(/[^a-z0-9]/gi, "_")}`, reason);
const stateChip = (s) => (s.stale ? "ah-chip--warn" : STATE_CHIP[s.backfill] || "");
const minutes = (ms) => Math.max(0, Math.round(Number(ms) / 60000));

const showError = (e) => {
    const code = e?.response?.data?.code;
    actionError.value = TRANSLATED_CODES.includes(code) ? t(`Knowledge.code_${code}`) : message(e);
};

const load = async () => {
    try {
        summary.value = await get(`${env.INSTANCE_KNOWLEDGE}?page=${page.value}`);
        // The server answers with the last page when the list shrank below the one asked for.
        if (Number.isInteger(summary.value.page)) page.value = summary.value.page;
        error.value = "";
    } catch (e) {
        error.value = message(e);
    }
};

async function loadDetail({ refresh = false } = {}) {
    if (!openId.value) return;
    try {
        detail.value = await get(`${env.INSTANCE_KNOWLEDGE}/${openId.value}${refresh ? "?refresh=1" : ""}`);
        detailError.value = "";
    } catch (e) {
        const code = e?.response?.data?.code;
        detailError.value = TRANSLATED_CODES.includes(code) ? t(`Knowledge.code_${code}`) : message(e);
    }
    try {
        exclusions.value = await get(`${env.INSTANCE_KNOWLEDGE}/${openId.value}/exclusions`);
        exclusionsError.value = "";
    } catch (e) {
        exclusionsError.value = message(e);
    }
}

const refresh = async () => {
    await load();
    await loadDetail();
};

const toggle = async (w) => {
    actionError.value = "";
    detailError.value = "";
    nothingErased.value = false;
    cancelErase();
    detail.value = null;
    exclusions.value = null;
    if (openId.value === w.companyId) {
        openId.value = "";
        return;
    }
    openId.value = w.companyId;
    await loadDetail();
};

const goTo = (next) => {
    page.value = next;
    openId.value = "";
    detail.value = null;
    return load();
};

const run = async (url, body, success) => {
    busy.value = true;
    actionError.value = "";
    nothingErased.value = false;
    try {
        const data = await post(url, body);
        const said = success(data);
        if (said) $toast.success(said);
        return true;
    } catch (e) {
        showError(e);
        return false;
    } finally {
        busy.value = false;
        await refresh();
    }
};

const base = () => `${env.INSTANCE_KNOWLEDGE}/${openId.value}`;

const reindex = (sourceType) => {
    if (!window.confirm(t("Knowledge.reindex_confirm", { source: sourceLabel(sourceType), name: openName.value }))) return undefined;
    return run(`${base()}/reindex`, { sourceType }, () => t("Knowledge.reindex_started", { source: sourceLabel(sourceType) }));
};

const reembed = () => {
    if (!window.confirm(t("Knowledge.reembed_confirm", { n: detail.value.embeddings.pendingChunks, model: detail.value.embeddings.model }))) return undefined;
    return run(`${base()}/reembed`, {}, (data) => t("Knowledge.reembed_started", { n: data.pendingChunks }));
};

const cancelReindex = (sourceType) => {
    if (!window.confirm(t("Knowledge.cancel_reindex_confirm", { source: sourceLabel(sourceType), name: openName.value }))) return undefined;
    return run(`${base()}/reindex/cancel`, { sourceType }, () => t("Knowledge.reindex_cancel_done", { source: sourceLabel(sourceType) }));
};

const retryFiles = () => {
    if (!window.confirm(t("Knowledge.retry_confirm", { name: openName.value }))) return undefined;
    return run(`${base()}/retry-files`, {}, (data) => t("Knowledge.retry_done", { n: data.reset }));
};

const validId = (sourceType, id) => (sourceType === "file" ? FILE_ID.test(id) : OBJECT_ID.test(id));

const exclusionTarget = (x) => (x.kind === "author" ? x.userId : x.sourceId);
const erasedBy = (x) => (x.erasedBy === ADMIN_KEY_ACTOR ? t("Knowledge.by_admin_key") : x.erasedByName || x.erasedBy || "—");

/* The form the server compares, so a confirmation in the other case still matches. */
const canonical = (kind, sourceType, id) => {
    const value = String(id || "");
    if (kind === "exclusion") return value.replace(/^[a-f0-9]{24}/i, (hex) => hex.toLowerCase());
    if (kind === "document" && sourceType === "file") {
        const at = value.indexOf(":");
        return at < 0 ? value : `${value.slice(0, at).toLowerCase()}${value.slice(at)}`;
    }
    return OBJECT_ID.test(value) ? value.toLowerCase() : value;
};

const typedMatches = computed(() => {
    const pending = pendingErase.value;
    return Boolean(pending) && canonical(pending.kind, pending.sourceType, eraseTyped.value) === pending.expected;
});

const askErase = (kind) => {
    eraseInputError.value = "";
    eraseTyped.value = "";
    if (kind === "document") {
        const { sourceType, sourceId } = eraseDraft;
        if (!validId(sourceType, sourceId)) {
            eraseInputError.value = t("Knowledge.code_invalid_document_id");
            return;
        }
        pendingErase.value = { kind, sourceType, sourceId, expected: canonical(kind, sourceType, sourceId) };
        return;
    }
    if (!OBJECT_ID.test(eraseDraft.userId)) {
        eraseInputError.value = t("Knowledge.code_invalid_user_id");
        return;
    }
    const userId = canonical(kind, "", eraseDraft.userId);
    pendingErase.value = { kind, userId, expected: userId };
};

const askRemoveExclusion = (x) => {
    eraseInputError.value = "";
    eraseTyped.value = "";
    pendingErase.value = { kind: "exclusion", id: x.id, exclusionKind: x.kind, expected: canonical("exclusion", "", exclusionTarget(x)) };
};

const confirmText = computed(() => {
    const pending = pendingErase.value;
    if (!pending) return "";
    if (pending.kind === "document") return t("Knowledge.erase_document_confirm", { type: sourceLabel(pending.sourceType), id: pending.expected });
    if (pending.kind === "person") return t("Knowledge.erase_person_confirm", { id: pending.expected, name: openName.value || openId.value });
    return t("Knowledge.exclusion_remove_confirm", { id: pending.expected });
});

function cancelErase() {
    pendingErase.value = null;
    eraseTyped.value = "";
}

const erase = async () => {
    const pending = pendingErase.value;
    if (!pending || !typedMatches.value) return;
    if (pending.kind === "exclusion") {
        const removed = await run(`${base()}/exclusions/${pending.id}/remove`, { confirm: pending.expected }, () => t("Knowledge.exclusion_removed"));
        if (removed) cancelErase();
        return;
    }
    const [url, body] = pending.kind === "document"
        ? [`${base()}/erase/document`, { sourceType: pending.sourceType, sourceId: pending.expected, confirm: pending.expected }]
        : [`${base()}/erase/person`, { userId: pending.userId, confirm: pending.expected }];
    const done = await run(url, body, (data) => {
        if (data && data.total) return t("Knowledge.erased", { n: data.total });
        nothingErased.value = true;
        return "";
    });
    if (done) {
        cancelErase();
        eraseDraft.sourceId = "";
        eraseDraft.userId = "";
    }
};

onMounted(load);
</script>

<style scoped>
.in-card__head { flex-wrap: wrap; }
.in-card__title { flex: 1 1 160px; min-width: 0; overflow-wrap: anywhere; }
.kn-chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.kn-figures { display: flex; flex-direction: column; gap: 14px; border-top: 1px solid var(--hairline); padding-top: 12px; }
.kn-section { display: flex; flex-direction: column; gap: 8px; }
.kn-scroll { overflow-x: auto; }
.kn-input { max-width: 320px; }
.kn-error { color: var(--danger-ink); }
.kn-confirm { flex-direction: column; align-items: stretch; }
.kn-pager { justify-content: center; align-items: center; gap: 12px; }
.in-table .ah-small { display: block; }
.in-card__title .ah-small { font-weight: 400; color: var(--ink-2); margin-left: 6px; }
</style>
