<template>
    <section class="ah-card">
        <div class="ah-card__head">
            <span class="ah-h3">{{ $t('ConnectedApps.title') }}</span>
        </div>
        <div class="ah-card__body ca">
            <p class="acct-lead">{{ $t('ConnectedApps.lead') }}</p>
            <p v-if="loading" class="ah-empty">{{ $t('ConnectedApps.loading') }}</p>
            <p v-else-if="loadError" class="ca__error" role="alert">{{ loadError }}</p>
            <template v-else>
                <p v-if="actionError" class="ca__error" role="alert" data-test="grant-error">{{ actionError }}</p>
                <p v-if="!grants.length" class="ah-empty" data-test="no-grants">{{ $t('ConnectedApps.empty') }}</p>
                <article v-for="grant in grants" :key="grant.grantId" class="ca__row" data-test="grant-row">
                    <div class="ca__who">
                        <strong>{{ grant.clientName || grant.clientId }}</strong>
                        <span class="ah-small">{{ $t('ConnectedApps.workspace') }} <strong>{{ grant.workspaceName || grant.companyId }}</strong></span>
                    </div>
                    <template v-if="editing === grant.grantId">
                        <p class="ah-small">{{ $t('ConnectedApps.edit_lead') }}</p>
                        <fieldset class="ca__edit" data-test="grant-edit">
                            <label v-for="scope in offeredFor(grant)" :key="scope" class="ca__opt">
                                <input v-model="draft" type="checkbox" :value="scope" :data-test="`scope-box-${scope}`" />
                                <span>{{ $t(scopeSentenceKey(scope)) }}</span>
                            </label>
                        </fieldset>
                        <div class="ca__actions">
                            <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="busy === grant.grantId" data-test="cancel-edit" @click="cancelEdit">{{ $t('ConnectedApps.cancel') }}</button>
                            <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="busy === grant.grantId || !draft.length" data-test="save-scopes" @click="saveScopes(grant)">{{ $t('ConnectedApps.save') }}</button>
                        </div>
                    </template>
                    <template v-else>
                        <div class="ca__chips">
                            <span v-for="scope in grant.scopes" :key="scope" class="ah-chip" data-test="grant-scope">{{ $t(scopeNameKey(scope)) }}</span>
                        </div>
                        <span class="ah-small" data-test="last-used">{{ grant.lastUsedAt ? `${$t('ConnectedApps.last_used')} ${formatWhen(grant.lastUsedAt)}` : $t('ConnectedApps.never_used') }}</span>
                        <span v-if="formatWhen(grant.expiresAt)" class="ah-small" data-test="grant-ends">{{ $t('ConnectedApps.ends', { d: formatWhen(grant.expiresAt) }) }}</span>
                        <div class="ca__actions">
                            <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="busy === grant.grantId" data-test="edit-scopes" @click="startEdit(grant)">{{ $t('ConnectedApps.edit') }}</button>
                            <button type="button" class="ah-btn ah-btn--danger ah-btn--sm" :disabled="busy === grant.grantId" data-test="revoke-grant" @click="revoke(grant)">{{ $t('ConnectedApps.revoke') }}</button>
                        </div>
                    </template>
                </article>
            </template>
        </div>
    </section>
</template>

<script setup>
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { SCOPES, scopeNameKey, scopeSentenceKey, refusalOf, formatWhen } from "@/views/OAuth/oauthShared";

defineOptions({ name: "ConnectedApps" });

const { t } = useI18n();

const grants = ref([]);
const offered = ref([]);
const loading = ref(true);
const loadError = ref("");
const actionError = ref("");
const busy = ref("");
const editing = ref("");
const draft = ref([]);

const offeredFor = () => SCOPES.filter((scope) => offered.value.includes(scope));

const load = async () => {
    try {
        const res = await apiRequest("get", env.OAUTH_GRANTS);
        grants.value = res?.data?.data || [];
        offered.value = res?.data?.offered || [];
    } catch (error) {
        loadError.value = refusalOf(error, t("ConnectedApps.load_failed"));
    } finally {
        loading.value = false;
    }
};

const startEdit = (grant) => {
    editing.value = grant.grantId;
    draft.value = [...grant.scopes];
    actionError.value = "";
};

const cancelEdit = () => {
    editing.value = "";
    draft.value = [];
};

const saveScopes = async (grant) => {
    busy.value = grant.grantId;
    actionError.value = "";
    try {
        const res = await apiRequest("post", `${env.OAUTH_GRANTS}/${encodeURIComponent(grant.grantId)}/scopes`, { scopes: draft.value });
        const scopes = res?.data?.data?.scopes || draft.value;
        grants.value = grants.value.map((g) => (g.grantId === grant.grantId ? { ...g, scopes } : g));
        cancelEdit();
    } catch (error) {
        actionError.value = refusalOf(error, t("ConnectedApps.update_failed"));
    } finally {
        busy.value = "";
    }
};

const revoke = async (grant) => {
    if (!window.confirm(t("ConnectedApps.revoke_confirm", { name: grant.clientName || grant.clientId }))) return;
    busy.value = grant.grantId;
    actionError.value = "";
    try {
        await apiRequest("delete", `${env.OAUTH_GRANTS}/${encodeURIComponent(grant.grantId)}`);
        grants.value = grants.value.filter((g) => g.grantId !== grant.grantId);
    } catch (error) {
        actionError.value = refusalOf(error, t("ConnectedApps.revoke_failed"));
    } finally {
        busy.value = "";
    }
};

onMounted(load);
</script>

<style>
.ca { display: grid; gap: 10px; }
.ca__row { display: grid; gap: 6px; padding: 10px 0; border-top: 1px solid var(--line, #e5e7eb); }
.ca__who { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; }
.ca__chips { display: flex; flex-wrap: wrap; gap: 6px; }
.ca__edit { border: 0; padding: 0; margin: 0; display: grid; gap: 6px; }
.ca__opt { display: flex; gap: 8px; align-items: baseline; }
.ca__actions { display: flex; gap: 8px; justify-content: flex-end; }
.ca__error { color: var(--danger, #b42318); }
</style>
