<template>
    <AuthShell :proof="false">
        <div class="av2-auth-card oc">
            <div class="auth__glyph auth__glyph--brand"><ShellIcon name="key" :size="15" /></div>

            <p v-if="loading" class="auth__p">{{ $t('OAuthConsent.loading') }}</p>
            <p v-else-if="error" class="auth__p oc__error" role="alert" data-test="consent-error">{{ error }}</p>

            <template v-else-if="info">
                <h2 class="auth__h">
                    {{ $t('OAuthConsent.title_before') }} <strong data-test="client-name">{{ info.client.name }}</strong> {{ $t('OAuthConsent.title_after') }}
                </h2>

                <p v-if="info.person" class="oc__person" data-test="signed-in-as">
                    {{ $t('OAuthConsent.signed_in_as') }} <strong>{{ personLabel }}</strong>
                    <button type="button" class="ah-btn ah-btn--link ah-btn--sm" data-test="switch-account" @click="switchAccount">{{ $t('OAuthConsent.switch_account') }}</button>
                </p>

                <dl class="oc__facts">
                    <div v-if="info.client.clientHost" class="oc__fact" data-test="client-host">
                        <dt>{{ $t('OAuthConsent.published_by') }}</dt>
                        <dd class="ah-mono">{{ info.client.clientHost }}</dd>
                    </div>
                    <div class="oc__fact" data-test="redirect-host">
                        <dt>{{ $t('OAuthConsent.returns_to') }}</dt>
                        <dd class="ah-mono">{{ info.client.redirectHost }}</dd>
                    </div>
                </dl>
                <p v-if="info.client.loopback" class="oc__warn" role="note" data-test="loopback-warning">{{ $t('OAuthConsent.loopback_warning') }}</p>

                <p class="auth__p">{{ $t('OAuthConsent.scopes_lead') }}</p>
                <ul class="oc__scopes">
                    <li v-for="scope in info.scopes" :key="scope" :data-test="`scope-${scope}`">{{ $t(scopeSentenceKey(scope)) }}</li>
                </ul>

                <form class="oc__form" method="post" :action="consentAction" data-test="consent-form">
                    <input type="hidden" name="request" :value="request" />
                    <input type="hidden" name="csrf" :value="info.csrf" />

                    <fieldset class="oc__workspaces">
                        <legend class="auth__p">{{ $t('OAuthConsent.workspace_lead') }}</legend>
                        <label v-for="w in eligible" :key="w.id" class="oc__workspace">
                            <input v-model="chosen" type="radio" name="workspace" :value="w.id" :data-test="`workspace-${w.id}`" />
                            <span>{{ w.name || w.id }}</span>
                        </label>
                        <p v-if="!eligible.length" class="oc__warn" data-test="no-workspace">{{ $t('OAuthConsent.no_workspace') }}</p>

                        <div v-for="w in blocked" :key="w.id" class="oc__workspace oc__workspace--blocked">
                            <span>{{ w.name || w.id }}</span>
                            <span v-if="w.reason === 'scope_ceiling'" class="ah-small" :data-test="`ceiling-${w.id}`">{{ $t('OAuthConsent.scope_ceiling') }}</span>
                            <span v-else-if="w.reason === 'other_workspace'" class="ah-small">{{ $t('OAuthConsent.other_workspace') }}</span>
                            <span v-else-if="waiting(w)" class="ah-small" :data-test="`waiting-${w.id}`">{{ $t('OAuthConsent.waiting_for_admin') }}</span>
                            <button v-else type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :disabled="asking === w.id" :data-test="`ask-${w.id}`" @click="ask(w)">{{ $t('OAuthConsent.ask_admin') }}</button>
                        </div>
                    </fieldset>

                    <p v-if="askError" class="oc__error" role="alert">{{ askError }}</p>

                    <div class="oc__actions">
                        <button type="submit" name="decision" value="deny" class="ah-btn ah-btn--secondary ah-btn--lg" data-test="deny">{{ $t('OAuthConsent.deny') }}</button>
                        <button type="submit" name="decision" value="approve" class="ah-btn ah-btn--primary ah-btn--lg" :disabled="!chosen" data-test="approve">{{ $t('OAuthConsent.approve') }}</button>
                    </div>
                    <p class="ah-small">{{ $t('OAuthConsent.revoke_hint') }}</p>
                </form>
            </template>
        </div>
    </AuthShell>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import AuthShell from "@/components/templates/AuthShell/AuthShell.vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { apiRequestWithoutCompnay, useAuth } from "@/services";
import * as env from "@/config/env";
import { scopeSentenceKey, refusalOf } from "./oauthShared";

defineOptions({ name: "OAuthConsentPage" });

const { t } = useI18n();

// The server put the signed request in the page's own query; the router only sees the hash.
const request = new URLSearchParams(window.location.search).get("request") || "";
const consentAction = env.OAUTH_CONSENT;

const loading = ref(true);
const error = ref("");
const info = ref(null);
const chosen = ref("");
const asking = ref("");
const askError = ref("");
const requested = reactive({});

const personLabel = computed(() => {
    const person = info.value?.person || {};
    if (person.name && person.email) return `${person.name} (${person.email})`;
    return person.name || person.email || "";
});

/* Signing out reloads this same address, which still carries the request: the router sends the signed-out
 * browser to sign in and back here afterwards. */
const switchAccount = () => useAuth().logOut({ islogOut: true });

const eligible = computed(() => (info.value?.workspaces || []).filter((w) => w.eligible));
const blocked = computed(() => (info.value?.workspaces || []).filter((w) => !w.eligible));
const waiting = (w) => w.approval === "pending" || requested[w.id];

const load = async () => {
    if (!request) {
        error.value = t("OAuthConsent.expired");
        loading.value = false;
        return;
    }
    try {
        const res = await apiRequestWithoutCompnay("get", `${env.OAUTH_CONSENT_DETAILS}?request=${encodeURIComponent(request)}`);
        info.value = res?.data?.data || null;
        if (!info.value) throw new Error("no consent details");
        if (eligible.value.length === 1) chosen.value = eligible.value[0].id;
    } catch (e) {
        error.value = e?.response?.status === 403 ? t("OAuthConsent.other_browser") : t("OAuthConsent.expired");
    } finally {
        loading.value = false;
    }
};

const ask = async (w) => {
    asking.value = w.id;
    askError.value = "";
    try {
        await apiRequestWithoutCompnay("post", env.OAUTH_CONSENT_APPROVAL_REQUEST, { request, csrf: info.value.csrf, workspace: w.id });
        requested[w.id] = true;
    } catch (e) {
        askError.value = refusalOf(e, t("OAuthConsent.ask_failed"));
    } finally {
        asking.value = "";
    }
};

onMounted(load);
</script>

<style>
@import "../Authentication/authV2.css";

.oc__person { display: flex; flex-wrap: wrap; gap: 6px; align-items: baseline; margin: 4px 0 8px; }
.oc__facts { display: grid; gap: 6px; margin: 12px 0; }
.oc__fact { display: flex; gap: 8px; align-items: baseline; }
.oc__fact dt { color: var(--text-2, #666); min-width: 120px; }
.oc__fact dd { margin: 0; overflow-wrap: anywhere; }
.oc__warn { padding: 8px 10px; border-radius: 6px; background: var(--warn-bg, #fff4e5); color: var(--warn-fg, #8a4b00); }
.oc__error { color: var(--danger, #b42318); }
.oc__scopes { margin: 0 0 12px; padding-left: 18px; }
.oc__workspaces { border: 0; padding: 0; margin: 0 0 12px; display: grid; gap: 6px; }
.oc__workspace { display: flex; gap: 8px; align-items: center; }
.oc__workspace--blocked { justify-content: space-between; opacity: .85; }
.oc__actions { display: flex; gap: 8px; justify-content: flex-end; margin: 12px 0 6px; }
</style>
