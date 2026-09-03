<template>
    <AuthShell :proof="false">
        <div v-if="stage === 'checking'" class="av2-center">
            <div class="auth__spinner"></div>
            <p class="auth__p">{{ $t('AuthV2.checking_link') }}</p>
        </div>

        <div v-else-if="stage === 'ok'" class="av2-auth-card">
            <div class="auth__glyph av2-glyph-ok"><ShellIcon name="check" :size="15" /></div>
            <h2 class="auth__h">{{ $t('AuthV2.verify_ok_title') }}</h2>
            <p class="auth__p">{{ $t('AuthV2.verify_ok_body') }}</p>
            <router-link :to="{ name: 'Log-in' }" class="ah-btn ah-btn--primary ah-btn--block ah-btn--lg">{{ $t('Auth.log_in') }}</router-link>
        </div>

        <div v-else-if="stage === 'already'" class="av2-auth-card">
            <div class="auth__glyph av2-glyph-ok"><ShellIcon name="check" :size="15" /></div>
            <h2 class="auth__h">{{ $t('AuthV2.verify_already_title') }}</h2>
            <p class="auth__p">{{ $t('AuthV2.verify_already_body') }}</p>
            <router-link :to="{ name: 'Log-in' }" class="ah-btn ah-btn--primary ah-btn--block ah-btn--lg">{{ $t('Auth.log_in') }}</router-link>
        </div>

        <div v-else-if="stage === 'resent'" class="av2-auth-card">
            <div class="auth__glyph auth__glyph--brand">✉</div>
            <h2 class="auth__h">{{ $t('Auth.magic_sent_title') }}</h2>
            <i18n-t keypath="Auth.verify_first_body" tag="p" class="auth__p"><template #email><strong>{{ email }}</strong></template></i18n-t>
            <div class="auth__links" style="margin-top:28px"><router-link :to="{ name: 'Log-in' }">{{ $t('AuthV2.back_to_login') }}</router-link></div>
        </div>

        <div v-else class="av2-auth-card">
            <div class="auth__glyph auth__glyph--warn">!</div>
            <h2 class="auth__h">{{ $t('AuthV2.verify_expired_title') }}</h2>
            <p class="auth__p">{{ message || $t('AuthV2.verify_expired_body') }}</p>
            <template v-if="canResend">
                <button type="button" class="ah-btn ah-btn--secondary ah-btn--block ah-btn--lg" :disabled="busy" @click="resend">
                    <span v-if="busy" class="ah-spin"></span>{{ busy ? $t('Auth.loading') : $t('Auth.resend_email') }}
                </button>
                <div v-if="resendError" class="ah-field__error" style="margin-top:8px"><ShellIcon name="x" :size="12" />{{ resendError }}</div>
            </template>
            <div class="auth__links" style="margin-top:28px">
                <span class="ah-small">{{ $t('Auth.wrong_address') }} <router-link :to="{ name: 'Log-in' }">{{ $t('AuthV2.back_to_login') }}</router-link></span>
            </div>
        </div>
    </AuthShell>
</template>

<script setup>
import { inject, onMounted, ref } from "vue";

defineOptions({ name: "VerifyEmailPage" });
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import AuthShell from "@/components/templates/AuthShell/AuthShell.vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import * as env from "@/config/env";

const { t } = useI18n();
const axios = inject("$axios");
const route = useRoute();
const router = useRouter();
const $toast = useToast();

const stage = ref("checking");
const email = ref("");
const message = ref("");
const canResend = ref(false);
const busy = ref(false);
const resendError = ref("");

onMounted(async () => {
    try {
        const result = await axios.post(env.API_URI + env.VERIFY_EMAIL, { uid: route.params.id, token: route.params.token });
        const data = result.data || {};
        if (data.showResendVerification) {
            email.value = data.email || "";
            canResend.value = true;
            stage.value = "expired";
        } else if (!data.status && data.alreadyVarified) {
            stage.value = "already";
        } else if (!data.status) {
            message.value = data.statusText || "";
            stage.value = "expired";
        } else {
            $toast.success(t("Toast.Your_email_has_been_verify_successfully"), { position: "top-right" });
            stage.value = "ok";
            setTimeout(() => router.push({ name: "Log-in" }), 2000);
        }
    } catch {
        message.value = t("Auth.server_error");
        stage.value = "expired";
    }
});

const resend = async () => {
    if (busy.value) return;
    busy.value = true;
    resendError.value = "";
    try {
        const result = await axios.post(env.API_URI + env.SEND_VARIFICATION_EMAIL, { uid: route.params.id, email: email.value });
        if (result.data.status === true) stage.value = "resent";
        else resendError.value = result.data.statusText || t("Auth.server_error");
    } catch {
        resendError.value = t("Auth.server_error");
    } finally {
        busy.value = false;
    }
};
</script>

<style>
@import "../authV2.css";
</style>
