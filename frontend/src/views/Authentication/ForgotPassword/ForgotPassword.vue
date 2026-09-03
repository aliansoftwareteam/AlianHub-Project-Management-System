<template>
    <AuthShell :proof="false">
        <form v-if="stage === 'form'" class="av2-auth-card" novalidate @submit.prevent="submit">
            <h2 class="auth__h">{{ $t('AuthV2.forgot_title') }}</h2>
            <p class="auth__p">{{ $t('AuthV2.forgot_lead') }}</p>
            <div class="ah-field" style="margin-bottom:16px">
                <label class="ah-field__label" for="fp-email">{{ $t('Auth.email') }}</label>
                <input
                    id="fp-email"
                    ref="emailInput"
                    v-model.trim="email"
                    type="email"
                    class="ah-input"
                    :class="{ 'ah-input--error': error }"
                    autocomplete="username"
                    maxlength="254"
                    :placeholder="$t('Auth.email_placeholder')"
                    :aria-invalid="!!error"
                    @input="email = email.toLowerCase(); error = ''"
                />
                <div v-if="error" class="ah-field__error"><ShellIcon name="x" :size="12" />{{ error }}</div>
            </div>
            <button type="submit" class="ah-btn ah-btn--primary ah-btn--block ah-btn--lg" :disabled="busy">
                <span v-if="busy" class="ah-spin"></span>{{ busy ? $t('Auth.loading') : $t('AuthV2.send_reset_link') }}
            </button>
            <div class="auth__links" style="margin-top:28px">
                <span class="ah-small">{{ $t('AuthV2.remembered') }} <router-link :to="{ name: 'Log-in' }" @click="rememberEmail">{{ $t('Auth.log_in') }}</router-link></span>
            </div>
        </form>

        <div v-else class="av2-auth-card">
            <div class="auth__glyph auth__glyph--brand">✉</div>
            <h2 class="auth__h">{{ $t('AuthV2.reset_sent_title') }}</h2>
            <i18n-t keypath="AuthV2.reset_sent_body" tag="p" class="auth__p"><template #email><strong>{{ email }}</strong></template></i18n-t>
            <div class="auth__note">
                {{ $t('Auth.magic_nothing_yet') }}
                <button type="button" class="av2-link-btn" :disabled="busy || resendWait > 0" @click="submit">{{ $t('Auth.send_again') }}</button>
                <span v-if="resendWait > 0" class="ah-mono"> {{ fmtSeconds(resendWait) }}</span>
            </div>
            <div class="auth__links" style="margin-top:28px">
                <router-link :to="{ name: 'Log-in' }">{{ $t('AuthV2.back_to_login') }}</router-link>
            </div>
        </div>
    </AuthShell>
</template>

<script setup>
import { onMounted, onUnmounted, ref } from "vue";

defineOptions({ name: "ForgotPasswordPage" });
import { useI18n } from "vue-i18n";
import AuthShell from "@/components/templates/AuthShell/AuthShell.vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { apiRequestWithoutSecure } from "@/services";
import * as env from "@/config/env";

const { t } = useI18n();
const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+[.][a-zA-Z]{2,}$/;

const stage = ref("form");
const email = ref(localStorage.getItem("ForgotEmail") || "");
const error = ref("");
const busy = ref(false);
const emailInput = ref(null);
const resendWait = ref(0);
let tick = null;

onMounted(() => {
    emailInput.value?.focus();
    tick = setInterval(() => { if (resendWait.value > 0) resendWait.value -= 1; }, 1000);
});
onUnmounted(() => clearInterval(tick));

const fmtSeconds = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const rememberEmail = () => localStorage.setItem("ForgotEmail", email.value);

const submit = async () => {
    if (!email.value) { error.value = t("Auth.email_required"); return; }
    if (!EMAIL_RE.test(email.value)) { error.value = t("Auth.email_invalid"); return; }
    if (busy.value || resendWait.value > 0) return;
    busy.value = true;
    try {
        await apiRequestWithoutSecure("post", env.FORGOTPASSWORD, { email: email.value });
        localStorage.removeItem("ForgotEmail");
        stage.value = "sent";
        resendWait.value = 60;
    } catch (err) {
        const msg = err?.response?.data?.message || "";
        const status = err?.response?.status;
        if (/user not found/i.test(msg)) error.value = t("Auth.no_account_found_for_email");
        else if (status === 429 || msg === "Auth.too_many_request") error.value = t("Auth.too_many_attempts");
        else error.value = t("Auth.server_error");
        stage.value = "form";
    } finally {
        busy.value = false;
    }
};
</script>

<style>
@import "../authV2.css";
</style>
