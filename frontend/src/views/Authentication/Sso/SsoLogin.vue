<template>
    <AuthShell :proof="false">
        <form v-if="stage === 'email'" novalidate @submit.prevent="discover">
            <h2 class="auth__h">{{ $t('Auth.sso_title') }}</h2>
            <p class="auth__p">{{ $t('Auth.sso_lead') }}</p>
            <div class="ah-field" style="margin-bottom:16px">
                <label class="ah-field__label" for="sso-email">{{ $t('Auth.work_email') }}</label>
                <input id="sso-email" ref="emailInput" v-model.trim="email" type="email" class="ah-input" :class="{ 'ah-input--error': error }" autocomplete="username" @input="error = ''" />
                <div v-if="error" class="ah-field__error"><ShellIcon name="x" :size="12" />{{ error }}</div>
            </div>
            <button type="submit" class="ah-btn ah-btn--primary ah-btn--block ah-btn--lg" :disabled="busy">{{ busy ? $t('Auth.loading') : $t('Auth.continue') }}</button>
            <div class="auth__links" style="margin-top:28px"><router-link to="/login">{{ $t('Auth.back_to_options') }}</router-link></div>
        </form>

        <div v-else-if="stage === 'org'">
            <div class="auth__sso-org">
                <span class="ah-avatar">{{ (org.companyName || '?').charAt(0).toUpperCase() }}</span>
                <ShellIcon name="chevron" :size="14" class="ah-muted" />
                <span class="auth__sso-idp">{{ org.providerLabel }}</span>
            </div>
            <h2 class="auth__h">{{ $t('Auth.sso_uses', { org: org.companyName, idp: org.providerLabel }) }}</h2>
            <p class="auth__p">
                {{ $t('Auth.sso_redirect', { host: org.host }) }}
                <strong>{{ org.enforcement === 'required' ? $t('Auth.sso_required') : $t('Auth.sso_optional') }}</strong>
            </p>
            <a class="ah-btn ah-btn--primary ah-btn--block ah-btn--lg" :href="org.initiateUrl" @click="stage = 'wait'">{{ $t('Auth.continue_to_idp', { idp: org.providerLabel }) }}</a>
            <p v-if="org.enforcement === 'required_except_guests'" class="auth__hint">{{ $t('Auth.sso_guests') }}</p>
            <div class="auth__links" style="margin-top:28px">
                <span class="ah-small">{{ $t('Auth.not_you', { email }) }} <button type="button" @click="stage = 'email'">{{ $t('Auth.change') }}</button></span>
            </div>
        </div>

        <div v-else class="text-center">
            <div class="auth__spinner"></div>
            <h2 class="auth__h">{{ $t('Auth.signing_in') }}</h2>
            <p class="auth__p">{{ $t('Auth.signing_in_body', { idp: org.providerLabel, product: productName }) }}</p>
            <p class="auth__hint">{{ $t('Auth.taking_long') }} <a :href="org.initiateUrl" class="auth__field-link">{{ $t('Auth.try_again') }}</a></p>
        </div>
    </AuthShell>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";

defineOptions({ name: "SsoLoginPage" });
import { useRoute } from "vue-router";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import AuthShell from "@/components/templates/AuthShell/AuthShell.vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { apiRequestWithoutSecure } from "@/services";
import * as env from "@/config/env";

const { t } = useI18n();
const route = useRoute();
const { getters } = useStore();
const productName = computed(() => getters["brandSettingTab/brandSettings"]?.productName || "AlianHub");

const stage = ref("email");
const email = ref(route.query.email || "");
const error = ref("");
const busy = ref(false);
const emailInput = ref(null);
const org = ref({});
onMounted(() => emailInput.value?.focus());

const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+[.][a-zA-Z]{2,}$/;
const discover = async () => {
    if (!email.value) { error.value = t("Auth.email_required"); return; }
    if (!EMAIL_RE.test(email.value)) { error.value = t("Auth.email_invalid"); return; }
    busy.value = true;
    try {
        const res = await apiRequestWithoutSecure("get", `${env.SSO_DISCOVER}?email=${encodeURIComponent(email.value)}`);
        const data = res?.data?.data;
        if (!res?.data?.status || !data?.companyId) { error.value = t("Auth.sso_none"); return; }
        const kind = data.provider === "saml" ? "saml" : "oidc";
        const redirect = route.query.redirect_url ? `&redirect_url=${encodeURIComponent(route.query.redirect_url)}` : "";
        org.value = {
            ...data,
            providerLabel: data.providerName || (kind === "saml" ? "SAML" : "OIDC"),
            host: data.issuerHost || data.providerName || "your identity provider",
            initiateUrl: `${env.API_URI}/api/v2/sso/${kind}/initiate?companyId=${encodeURIComponent(data.companyId)}&login_hint=${encodeURIComponent(email.value)}${redirect}`
        };
        stage.value = "org";
    } catch (e) {
        error.value = e?.response?.status === 404 ? t("Auth.sso_none") : t("Auth.server_error");
    } finally {
        busy.value = false;
    }
};
</script>
