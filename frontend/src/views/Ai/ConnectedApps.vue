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
                    <div class="ca__chips">
                        <span v-for="scope in grant.scopes" :key="scope" class="ah-chip" data-test="grant-scope">{{ $t(scopeNameKey(scope)) }}</span>
                    </div>
                    <span class="ah-small" data-test="last-used">{{ grant.lastUsedAt ? `${$t('ConnectedApps.last_used')} ${formatWhen(grant.lastUsedAt)}` : $t('ConnectedApps.never_used') }}</span>
                    <div class="ca__actions">
                        <button type="button" class="ah-btn ah-btn--danger ah-btn--sm" :disabled="busy === grant.grantId" data-test="revoke-grant" @click="revoke(grant)">{{ $t('ConnectedApps.revoke') }}</button>
                    </div>
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
import { scopeNameKey, refusalOf, formatWhen } from "@/views/OAuth/oauthShared";

defineOptions({ name: "ConnectedApps" });

const { t } = useI18n();

const grants = ref([]);
const loading = ref(true);
const loadError = ref("");
const actionError = ref("");
const busy = ref("");

const load = async () => {
    try {
        const res = await apiRequest("get", env.OAUTH_GRANTS);
        grants.value = res?.data?.data || [];
    } catch (error) {
        loadError.value = refusalOf(error, t("ConnectedApps.load_failed"));
    } finally {
        loading.value = false;
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
.ca__actions { display: flex; justify-content: flex-end; }
.ca__error { color: var(--danger, #b42318); }
</style>
