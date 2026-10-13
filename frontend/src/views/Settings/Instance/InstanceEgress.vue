<template>
    <div>
        <div v-if="error" class="in-banner in-banner--danger"><ShellIcon name="alert" :size="15" /><span>{{ error }}</span></div>
        <div v-else-if="flagOff" class="in-banner in-banner--warn" data-test="flag-off"><ShellIcon name="alert" :size="15" /><span>{{ $t('Egress.flag_off') }} <code class="ah-mono">{{ `${flagOff.envKey}=true` }}</code></span></div>
        <div v-else-if="!summary" class="ah-empty">{{ $t('Instance.loading') }}</div>
        <template v-else>
            <div v-if="actionError" class="in-banner in-banner--danger" data-test="action-error"><ShellIcon name="alert" :size="15" /><span><code v-if="actionEntry" class="ah-mono">{{ actionEntry }}</code> {{ actionError }}</span></div>
            <div class="in-banner in-banner--ok" data-test="flag-on"><ShellIcon name="check" :size="15" /><span>{{ $t('Egress.flag_on') }} <code class="ah-mono">{{ `${summary.flag.envKey}=true` }}</code></span></div>

            <section class="ah-card in-card">
                <div class="in-card__head">
                    <span class="in-card__title">{{ $t('Egress.title') }}</span>
                    <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :disabled="busy" @click="load">
                        <ShellIcon name="refresh" :size="14" />{{ $t('Instance.refresh') }}
                    </button>
                </div>
                <p class="ah-small">{{ $t('Egress.lead') }}</p>
                <p class="ah-small">{{ $t('Egress.format_help') }}</p>
                <p class="ah-small" data-test="port-help">{{ $t('Egress.port_help') }}</p>
                <p class="ah-small" data-test="cache-note">{{ $t('Egress.cache_note', { seconds: summary.cacheTtlSeconds }) }}</p>
            </section>

            <section v-for="w in summary.workspaces" :key="`${w.companyId}-${version}`" class="ah-card in-card" :data-test="`workspace-${w.companyId}`">
                <div class="in-card__head">
                    <span class="in-card__title">{{ w.name || w.companyId }} <span class="ah-small ah-mono">{{ w.companyId }}</span></span>
                    <span class="ah-chip" :class="{ 'ah-chip--warn': w.refused7d > 0 }" :data-test="`refused-${w.companyId}`">{{ $t('Egress.refused_count', { n: w.refused7d, days: summary.windowDays }) }}</span>
                </div>
                <div class="eg-hosts">
                    <span v-for="host in w.hosts" :key="host" class="ah-chip ah-chip--mono eg-host" :data-test="`host-${w.companyId}`">
                        {{ host }}
                        <button type="button" class="eg-host__remove" :aria-label="$t('Egress.remove_host')" :disabled="busy" :data-test="`remove-${w.companyId}-${host}`" @click="remove(w, host)">
                            <ShellIcon name="x" :size="12" />
                        </button>
                    </span>
                    <span v-if="!w.hosts.length" class="ah-small" :data-test="`no-hosts-${w.companyId}`">{{ $t('Egress.no_hosts') }}</span>
                </div>
                <form class="in-actions" :data-test="`add-${w.companyId}`" @submit.prevent="add(w)">
                    <label class="ah-small" :for="`egress-host-${w.companyId}`">{{ $t('Egress.add_label') }}</label>
                    <input :id="`egress-host-${w.companyId}`" v-model="drafts[w.companyId]" type="text" class="ah-input eg-input" autocomplete="off" spellcheck="false" :placeholder="$t('Egress.add_placeholder')" :disabled="busy" :data-test="`host-input-${w.companyId}`" @input="draftErrors[w.companyId] = ''" />
                    <button type="submit" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="busy">{{ $t('Egress.add') }}</button>
                </form>
                <p v-if="draftErrors[w.companyId]" class="ah-small eg-error" :data-test="`host-error-${w.companyId}`">{{ draftErrors[w.companyId] }}</p>
                <p v-if="w.updatedAt" class="ah-small" :data-test="`updated-${w.companyId}`">{{ $t('Egress.updated') }} <strong>{{ setBy(w) }}</strong> · {{ formatWhen(w.updatedAt) }}</p>
            </section>

            <div v-if="pages > 1" class="in-actions eg-pager" data-test="pager">
                <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" data-test="page-prev" :disabled="busy || page <= 1" @click="goTo(page - 1)">{{ $t('Egress.page_prev') }}</button>
                <span class="ah-small" data-test="page-status">{{ $t('Egress.page_status', { page, pages, total: summary.total }) }}</span>
                <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" data-test="page-next" :disabled="busy || page >= pages" @click="goTo(page + 1)">{{ $t('Egress.page_next') }}</button>
            </div>
        </template>
    </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import { validateHosts } from "@egressRules";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { useInstanceApi, formatWhen } from "./useInstanceApi";

defineOptions({ name: "InstanceEgress" });

const { t } = useI18n();
const $toast = useToast();
const { get, put, message, env } = useInstanceApi();

const summary = ref(null);
const flagOff = ref(null);
const error = ref("");
const actionError = ref("");
const actionEntry = ref("");
const busy = ref(false);
const version = ref(0);
const page = ref(1);
const drafts = reactive({});
const draftErrors = reactive({});

const ADMIN_KEY_ACTOR = "instance-admin-key";
const TRANSLATED_CODES = ["flag_off", "invalid_company_id", "hosts_not_list", "version_required", "stale_version", "unknown_workspace", "server_error"];

const pages = computed(() => {
    const s = summary.value;
    return s && s.pageSize ? Math.max(1, Math.ceil((s.total || 0) / s.pageSize)) : 1;
});

const setBy = (w) => (w.updatedBy === ADMIN_KEY_ACTOR ? t("Egress.updated_by_admin_key") : w.updatedByName || w.updatedBy);

const load = async () => {
    try {
        summary.value = await get(`${env.INSTANCE_EGRESS}?page=${page.value}`);
        // The server answers with the last page when the list shrank below the one asked for.
        if (Number.isInteger(summary.value.page)) page.value = summary.value.page;
        flagOff.value = null;
        error.value = "";
        version.value += 1;
    } catch (e) {
        const flag = e?.response?.data?.data?.flag;
        if (flag && flag.on === false) {
            flagOff.value = flag;
            summary.value = null;
            error.value = "";
            return;
        }
        error.value = message(e);
    }
};

const goTo = (next) => {
    page.value = next;
    return load();
};

const showActionError = (e) => {
    const body = e?.response?.data || {};
    const refusal = Array.isArray(body.data?.errors) ? body.data.errors[0] : null;
    actionEntry.value = refusal?.entry || "";
    if (refusal?.reason) actionError.value = t(`Egress.error_${refusal.reason}`, { max: summary.value?.maxHosts });
    else if (TRANSLATED_CODES.includes(body.code)) actionError.value = t(`Egress.code_${body.code}`);
    else actionError.value = message(e);
};

const STALE = "stale_version";

const save = async (w, hosts) => {
    busy.value = true;
    actionError.value = "";
    actionEntry.value = "";
    let outcome = "saved";
    try {
        await put(`${env.INSTANCE_EGRESS}/${w.companyId}`, { hosts, version: w.version || 0 });
        $toast.success(t("Egress.saved", { name: w.name || w.companyId }));
        drafts[w.companyId] = "";
        draftErrors[w.companyId] = "";
    } catch (e) {
        showActionError(e);
        outcome = e?.response?.data?.code === STALE ? STALE : "refused";
    } finally {
        busy.value = false;
        await load();
    }
    return outcome;
};

const add = (w) => {
    const raw = String(drafts[w.companyId] || "").trim();
    if (!raw) return;
    const { hosts, errors } = validateHosts([raw]);
    if (errors.length) {
        draftErrors[w.companyId] = t(`Egress.error_${errors[0].reason}`, { max: summary.value.maxHosts });
        return;
    }
    if (w.hosts.includes(hosts[0])) {
        draftErrors[w.companyId] = t("Egress.error_duplicate");
        return;
    }
    if (w.hosts.length >= summary.value.maxHosts) {
        draftErrors[w.companyId] = t("Egress.error_too_many", { max: summary.value.maxHosts });
        return;
    }
    return save(w, [...w.hosts, hosts[0]]);
};

/* A stale add keeps its text in the box; a stale removal is made again once on the fresh list, since taking a host
 * off only narrows it. Not when that would now empty the list, which reopens the workspace and needs its own confirm. */
const remove = async (w, host) => {
    const hosts = w.hosts.filter((h) => h !== host);
    if (!hosts.length && !window.confirm(t("Egress.clear_confirm", { name: w.name || w.companyId }))) return;
    if ((await save(w, hosts)) !== STALE) return;
    const fresh = summary.value?.workspaces?.find((x) => x.companyId === w.companyId);
    if (!fresh || !fresh.hosts.includes(host)) return;
    const rest = fresh.hosts.filter((h) => h !== host);
    if (rest.length) await save(fresh, rest);
};

onMounted(load);
</script>

<style scoped>
.eg-hosts { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; min-height: 24px; }
.eg-host { display: inline-flex; align-items: center; gap: 4px; }
.eg-host__remove { display: inline-flex; align-items: center; padding: 0; margin: 0; border: 0; background: none; color: inherit; cursor: pointer; }
.eg-host__remove:disabled { cursor: default; opacity: 0.5; }
.eg-input { max-width: 320px; }
.eg-error { color: var(--danger-ink); }
.eg-pager { justify-content: center; align-items: center; gap: 12px; }
.in-card__title .ah-small { font-weight: 400; color: var(--ink-2); margin-left: 6px; }
</style>
