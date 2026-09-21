<template>
    <div class="ac">
        <p v-if="off" class="ah-empty" data-test="oauth-off">{{ $t('AgentClients.off') }}</p>
        <p v-else-if="loadError" class="ac__error" role="alert">{{ loadError }}</p>
        <p v-else-if="loading" class="ah-empty">{{ $t('AgentClients.loading') }}</p>
        <template v-else>
            <p class="ah-small">{{ $t('AgentClients.lead') }}</p>
            <p v-if="actionError" class="ac__error" role="alert" data-test="action-error">{{ actionError }}</p>
            <p v-if="!rows.length" class="ah-empty" data-test="empty">{{ $t('AgentClients.empty') }}</p>

            <section v-if="pending.length" class="ah-card ac__card">
                <h3 class="ah-h3">{{ $t('AgentClients.pending_title') }}</h3>
                <article v-for="row in pending" :key="row.clientId" class="ac__row" data-test="pending-row">
                    <div class="ac__who">
                        <strong>{{ row.clientName || row.clientId }}</strong>
                        <span class="ah-small ah-mono">{{ hostsOf(row) }}</span>
                        <span class="ah-small">{{ $t('AgentClients.requested_by') }} <strong>{{ row.requestedByName || row.requestedBy }}</strong> · {{ formatWhen(row.requestedAt) }}</span>
                    </div>
                    <fieldset class="ac__scopes">
                        <legend class="ah-small">{{ $t('AgentClients.scopes_legend') }}</legend>
                        <label v-for="scope in SCOPES" :key="scope" class="ac__scope">
                            <input v-model="drafts[row.clientId].scopes" type="checkbox" :value="scope" :data-test="`scope-${scope}`" />
                            <span>{{ $t(scopeNameKey(scope)) }}</span>
                        </label>
                    </fieldset>
                    <label class="ac__scope">
                        <input v-model="drafts[row.clientId].privateSprints" type="checkbox" data-test="private-sprints" />
                        <span>{{ $t('AgentClients.private_label') }}</span>
                    </label>
                    <div class="ac__actions">
                        <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="busy" data-test="deny" @click="deny(row)">{{ $t('AgentClients.deny') }}</button>
                        <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="busy || !drafts[row.clientId].scopes.length" data-test="approve" @click="approve(row)">{{ $t('AgentClients.approve') }}</button>
                    </div>
                </article>
            </section>

            <section v-if="approved.length" class="ah-card ac__card">
                <h3 class="ah-h3">{{ $t('AgentClients.approved_title') }}</h3>
                <article v-for="row in approved" :key="row.clientId" class="ac__row" data-test="approved-row">
                    <div class="ac__who">
                        <strong>{{ row.clientName || row.clientId }}</strong>
                        <span class="ah-small ah-mono">{{ hostsOf(row) }}</span>
                        <span v-if="row.decidedAt" class="ah-small">{{ $t('AgentClients.approved_by') }} <strong>{{ row.decidedByName || row.decidedBy }}</strong> · {{ formatWhen(row.decidedAt) }}</span>
                    </div>
                    <div class="ac__chips">
                        <span v-for="scope in row.scopes" :key="scope" class="ah-chip" data-test="ceiling">{{ $t(scopeNameKey(scope)) }}</span>
                    </div>
                    <span class="ah-small" data-test="private-flag">{{ row.privateSprints ? $t('AgentClients.private_on') : $t('AgentClients.private_off') }}</span>
                    <div class="ac__actions">
                        <button type="button" class="ah-btn ah-btn--danger ah-btn--sm" :disabled="busy" data-test="revoke" @click="revoke(row)">{{ $t('AgentClients.revoke') }}</button>
                    </div>
                </article>
            </section>

            <section v-if="past.length" class="ah-card ac__card">
                <h3 class="ah-h3">{{ $t('AgentClients.past_title') }}</h3>
                <article v-for="row in past" :key="row.clientId" class="ac__row" data-test="past-row">
                    <div class="ac__who">
                        <strong>{{ row.clientName || row.clientId }}</strong>
                        <span class="ah-small ah-mono">{{ hostsOf(row) }}</span>
                        <span class="ah-small">{{ $t(`AgentClients.status_${row.status}`) }}</span>
                    </div>
                </article>
            </section>
        </template>
    </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { SCOPES, scopeNameKey, refusalOf, formatWhen } from "@/views/OAuth/oauthShared";

defineOptions({ name: "AgentClientsSettings" });

const { t } = useI18n();

const READ_SCOPES = SCOPES.filter((scope) => scope.endsWith(":read"));

const rows = ref([]);
const loading = ref(true);
const loadError = ref("");
const off = ref(false);
const busy = ref(false);
const actionError = ref("");
const drafts = reactive({});

const pending = computed(() => rows.value.filter((row) => row.status === "pending"));
const approved = computed(() => rows.value.filter((row) => row.status === "approved"));
const past = computed(() => rows.value.filter((row) => row.status === "denied" || row.status === "revoked"));

const hostsOf = (row) => [row.clientHost, ...(row.redirectHosts || [])].filter(Boolean).filter((host, i, all) => all.indexOf(host) === i).join(", ");

// What was asked for starts checked; reading is offered too, since an agent that may write must first read.
const draftFor = (row) => ({
    scopes: SCOPES.filter((scope) => (row.requestedScopes || []).includes(scope) || (!(row.requestedScopes || []).length && READ_SCOPES.includes(scope))),
    privateSprints: false,
});

const load = async () => {
    loadError.value = "";
    try {
        const res = await apiRequest("get", env.OAUTH_CLIENT_APPROVALS);
        rows.value = res?.data?.data || [];
        for (const row of rows.value) if (row.status === "pending" && !drafts[row.clientId]) drafts[row.clientId] = draftFor(row);
    } catch (error) {
        if (error?.response?.status === 404) off.value = true;
        else loadError.value = refusalOf(error, t("AgentClients.load_failed"));
    } finally {
        loading.value = false;
    }
};

const act = async (path, body) => {
    busy.value = true;
    actionError.value = "";
    try {
        await apiRequest("post", `${env.OAUTH_CLIENT_APPROVALS}/${path}`, body);
        await load();
    } catch (error) {
        actionError.value = refusalOf(error, t("AgentClients.action_failed"));
    } finally {
        busy.value = false;
    }
};

const approve = (row) => {
    const draft = drafts[row.clientId];
    return act("approve", { clientId: row.clientId, scopes: SCOPES.filter((scope) => draft.scopes.includes(scope)), privateSprints: Boolean(draft.privateSprints) });
};

const deny = (row) => act("deny", { clientId: row.clientId });

const revoke = (row) => {
    if (!window.confirm(t("AgentClients.revoke_confirm", { name: row.clientName || row.clientId }))) return undefined;
    return act("revoke", { clientId: row.clientId });
};

onMounted(load);
</script>

<style>
.ac { display: grid; gap: 12px; }
.ac__card { padding: 12px 16px; display: grid; gap: 10px; }
.ac__row { display: grid; gap: 8px; padding: 10px 0; border-top: 1px solid var(--line, #e5e7eb); }
.ac__row:first-of-type { border-top: 0; }
.ac__who { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; }
.ac__scopes { border: 0; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 6px 14px; }
.ac__scope { display: inline-flex; gap: 6px; align-items: center; }
.ac__chips { display: flex; flex-wrap: wrap; gap: 6px; }
.ac__actions { display: flex; gap: 8px; justify-content: flex-end; }
.ac__error { color: var(--danger, #b42318); }
</style>
