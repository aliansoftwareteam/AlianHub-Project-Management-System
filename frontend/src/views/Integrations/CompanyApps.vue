<template>
    <section v-if="privileged" class="ah-card ca" data-test="company-apps" aria-labelledby="company-apps-title">
        <div id="company-apps-title" class="ca__title">{{ $t('Connectors.conn.apps_title') }}</div>
        <p class="ah-small ca__lead">{{ $t('Connectors.conn.apps_lead') }}</p>

        <p v-if="loadError" class="ah-field__error" data-test="ca-load-error">{{ loadError }}</p>
        <p v-else-if="!catalog.length && !loading" class="ah-small" data-test="ca-empty">{{ $t('Connectors.conn.apps_empty') }}</p>

        <article v-for="item in catalog" :key="item.provider" class="ca__row" :data-test="`ca-row-${item.provider}`">
            <div class="ca__head">
                <strong class="ca__name">{{ item.name }}</strong>
                <span class="ah-small ca__source" :data-test="`ca-source-${item.provider}`">{{ source(item) }}</span>
            </div>

            <div class="ca__uri">
                <span class="ah-field__label">{{ $t('Connectors.conn.redirect_uri') }}</span>
                <div class="ca__uri-row">
                    <code class="ca__code ah-mono">{{ item.redirectUri }}</code>
                    <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :data-test="`ca-copy-${item.provider}`" @click="copy(item)">
                        {{ copied === item.provider ? $t('Connectors.conn.copied') : $t('Connectors.conn.copy') }}
                    </button>
                </div>
                <span class="ah-small ca__hint">{{ $t('Connectors.conn.redirect_hint') }}</span>
            </div>

            <form v-if="editing === item.provider" class="ca__form" novalidate @submit.prevent="save(item)">
                <label class="ca__field">
                    <span class="ah-field__label">{{ $t('Connectors.conn.client_id') }}</span>
                    <input v-model="draft.clientId" class="ah-input" type="text" :data-test="`ca-client-id-${item.provider}`" @input="problem = ''" />
                </label>
                <label class="ca__field">
                    <span class="ah-field__label">{{ $t('Connectors.conn.client_secret') }}</span>
                    <input v-model="draft.clientSecret" class="ah-input" type="password" autocomplete="off" :data-test="`ca-client-secret-${item.provider}`" @input="problem = ''" />
                </label>
                <p v-if="problem" class="ah-field__error" role="alert" :data-test="`ca-error-${item.provider}`">{{ problem }}</p>
                <div class="ca__actions">
                    <button type="submit" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="busy" :data-test="`ca-save-${item.provider}`">
                        {{ busy ? $t('Connectors.conn.saving') : (item.companyAppSet ? $t('Connectors.conn.replace_app') : $t('Connectors.conn.set_app')) }}
                    </button>
                    <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :disabled="busy" @click="close">{{ $t('Connectors.conn.cancel') }}</button>
                </div>
            </form>

            <div v-else class="ca__actions">
                <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :data-test="`ca-edit-${item.provider}`" @click="open(item)">
                    {{ item.companyAppSet ? $t('Connectors.conn.edit') : $t('Connectors.conn.set_app') }}
                </button>
                <button
                    v-if="item.companyAppSet"
                    type="button"
                    class="ah-btn ah-btn--ghost ah-btn--sm ca__danger"
                    :disabled="busy"
                    :data-test="`ca-remove-${item.provider}`"
                    @click="remove(item)"
                >{{ busy && removingProvider === item.provider ? $t('Connectors.conn.removing') : $t('Connectors.conn.remove_app') }}</button>
                <span v-if="rowNotice === item.provider" class="ah-small ca__ok" role="status">{{ rowNoticeText }}</span>
            </div>

            <p v-if="rowError === item.provider" class="ah-field__error" :data-test="`ca-row-error-${item.provider}`">{{ rowErrorText }}</p>
        </article>
    </section>
</template>

<script setup>
import { computed, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { isOwnerOrAdmin } from "@/utils/roles";

defineOptions({ name: "CompanyApps" });

const { t } = useI18n();
const { getters } = useStore();

const catalog = ref([]);
const apps = ref([]);
const loading = ref(false);
const loadError = ref("");
const editing = ref("");
const draft = reactive({ clientId: "", clientSecret: "" });
const problem = ref("");
const busy = ref(false);
const removingProvider = ref("");
const copied = ref("");
const rowNotice = ref("");
const rowNoticeText = ref("");
const rowError = ref("");
const rowErrorText = ref("");

const privileged = computed(() => isOwnerOrAdmin(Number(getters["settings/companyUserDetail"]?.roleType)));

const source = (item) => {
    if (item.companyAppSet) return t("Connectors.conn.source_company");
    if (item.hasInstanceApp) return t("Connectors.conn.source_instance");
    return t("Connectors.conn.source_none");
};
const configuredApp = (provider) => apps.value.find((app) => app.provider === provider) || null;

const load = async () => {
    loading.value = true;
    loadError.value = "";
    try {
        const res = await apiRequest("get", `${env.CONNECTORS}/apps`);
        if (!res?.data?.status) { loadError.value = res?.data?.statusText || t("Connectors.conn.apps_load_failed"); return; }
        apps.value = res.data.data?.apps || [];
        catalog.value = res.data.data?.catalog || [];
    } catch (e) {
        loadError.value = e?.response?.data?.statusText || t("Connectors.conn.apps_load_failed");
    } finally {
        loading.value = false;
    }
};

const open = (item) => {
    editing.value = item.provider;
    problem.value = "";
    rowError.value = "";
    rowNotice.value = "";
    const existing = configuredApp(item.provider);
    draft.clientId = existing?.clientId || "";
    draft.clientSecret = "";
};
const close = () => { editing.value = ""; problem.value = ""; };

const copy = async (item) => {
    try {
        await navigator.clipboard.writeText(item.redirectUri);
        copied.value = item.provider;
        setTimeout(() => { if (copied.value === item.provider) copied.value = ""; }, 1500);
    } catch (e) {
        copied.value = "";
    }
};

const save = async (item) => {
    const clientId = draft.clientId.trim();
    const clientSecret = draft.clientSecret.trim();
    if (!clientId) { problem.value = t("Connectors.conn.client_id_required"); return; }
    if (!clientSecret) { problem.value = t("Connectors.conn.client_secret_required"); return; }
    busy.value = true;
    problem.value = "";
    try {
        const res = await apiRequest("put", `${env.CONNECTORS}/apps/${item.provider}`, { clientId, clientSecret });
        if (!res?.data?.status) { problem.value = res?.data?.statusText || t("Connectors.conn.app_save_failed"); return; }
        close();
        rowNotice.value = item.provider;
        rowNoticeText.value = t("Connectors.conn.app_saved");
        await load();
    } catch (e) {
        problem.value = e?.response?.data?.statusText || t("Connectors.conn.app_save_failed");
    } finally {
        busy.value = false;
    }
};

const remove = async (item) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(t("Connectors.conn.confirm_remove", { provider: item.name }))) return;
    busy.value = true;
    removingProvider.value = item.provider;
    rowError.value = "";
    try {
        const res = await apiRequest("delete", `${env.CONNECTORS}/apps/${item.provider}`);
        if (!res?.data?.status) { rowError.value = item.provider; rowErrorText.value = res?.data?.statusText || t("Connectors.conn.app_remove_failed"); return; }
        rowNotice.value = item.provider;
        rowNoticeText.value = t("Connectors.conn.app_removed");
        await load();
    } catch (e) {
        rowError.value = item.provider;
        rowErrorText.value = e?.response?.data?.statusText || t("Connectors.conn.app_remove_failed");
    } finally {
        busy.value = false;
        removingProvider.value = "";
    }
};

watch(privileged, (isPrivileged) => { if (isPrivileged && !catalog.value.length) load(); }, { immediate: true });
</script>

<style scoped>
.ca { padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; max-width: 900px; margin-bottom: 14px; background: var(--surface); }
.ca__title { font: 600 13px/1.2 var(--font-ui); color: var(--ink); }
.ca__lead { margin: 0; color: var(--ink-2); }
.ca__row { display: flex; flex-direction: column; gap: 8px; padding: 10px 0; border-top: 1px solid var(--hairline); }
.ca__row:first-of-type { border-top: 0; }
.ca__head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.ca__name { font: 600 13px/1.2 var(--font-ui); color: var(--ink); }
.ca__source { color: var(--ink-2); }
.ca__uri { display: flex; flex-direction: column; gap: 4px; }
.ca__uri-row { display: flex; align-items: center; gap: 8px; }
.ca__code { display: block; flex: 1; min-width: 0; padding: 7px 10px; background: var(--surface-2); border: 1px solid var(--hairline); border-radius: 8px; font: 500 11px/1.5 var(--font-mono); color: var(--ink); overflow-x: auto; white-space: nowrap; }
.ca__hint { color: var(--ink-2); }
.ca__form { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px 14px; align-items: start; }
.ca__form > .ah-field__error, .ca__form > .ca__actions { grid-column: 1 / -1; }
.ca__field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.ca__actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.ca__danger { color: var(--danger-ink, var(--ink)); }
.ca__ok { color: var(--ink); }
</style>
