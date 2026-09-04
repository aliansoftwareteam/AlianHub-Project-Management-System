<template>
    <AuthShell :proof="step === 'login'">
        <template #top-right>
            <span v-if="step === 'login' && showRegister">{{ $t('Auth.new_here') }} <router-link to="/signup">{{ $t('Auth.create_account') }}</router-link></span>
        </template>

        <!-- 5a: login -->
        <form v-if="step === 'login'" novalidate @submit.prevent="handleSubmit">
            <h1 class="auth__title">{{ $t('Auth.welcome_back') }}</h1>
            <p class="auth__lead">{{ $t('Auth.login_to_workspace') }}</p>

            <div v-if="banner" class="auth__banner" :class="`auth__banner--${banner.kind}`">
                <ShellIcon :name="banner.kind === 'ok' ? 'check' : 'alert'" :size="15" />
                <span>{{ banner.text }}</span>
            </div>

            <div v-if="providers.length" class="auth__providers">
                <ProviderButton v-for="p in providers" :key="p" :provider="p" mode="login" />
            </div>
            <button v-if="ssoAvailable" type="button" class="ah-btn ah-btn--outline ah-btn--block" @click="$router.push({ name: 'Sso_Login' })">
                {{ $t('Auth.continue_with_sso') }}
            </button>
            <div v-if="providers.length || ssoAvailable" class="auth__or">{{ $t('Auth.or_with_email') }}</div>

            <div class="auth__fields">
                <div class="ah-field">
                    <label class="ah-field__label" for="email">{{ $t('Auth.email') }}</label>
                    <input
                        id="email"
                        ref="emailInput"
                        v-model.trim="form.email"
                        type="email"
                        autocomplete="username"
                        maxlength="254"
                        class="ah-input"
                        :class="{ 'ah-input--error': errors.email }"
                        :placeholder="$t('Auth.email_placeholder')"
                        :aria-invalid="!!errors.email"
                        aria-describedby="email-error"
                        @input="form.email = form.email.toLowerCase(); errors.email = ''"
                    />
                    <div v-if="errors.email" id="email-error" class="ah-field__error"><ShellIcon name="x" :size="12" />{{ errors.email }}</div>
                </div>
                <div class="ah-field">
                    <label class="ah-field__label" for="password">
                        <span>{{ $t('Auth.password') }}</span>
                        <router-link class="auth__field-link" to="/forgot-password" @click="rememberEmail">{{ $t('Auth.Forgot_Password') }}?</router-link>
                    </label>
                    <div class="auth__pw">
                        <input
                            id="password"
                            v-model="form.password"
                            :type="showPassword ? 'text' : 'password'"
                            autocomplete="current-password"
                            maxlength="150"
                            class="ah-input"
                            :class="{ 'ah-input--error': errors.password }"
                            placeholder="••••••••"
                            :aria-invalid="!!errors.password"
                            aria-describedby="password-error"
                            @input="errors.password = ''"
                        />
                        <button type="button" class="auth__pw-eye" :aria-label="showPassword ? 'Hide password' : 'Show password'" @click="showPassword = !showPassword">
                            <ShellIcon :name="showPassword ? 'eyeOff' : 'eye'" :size="15" />
                        </button>
                    </div>
                    <div v-if="errors.password" id="password-error" class="ah-field__error"><ShellIcon name="x" :size="12" />{{ errors.password }}</div>
                </div>
            </div>

            <div class="auth__actions">
                <button type="submit" class="ah-btn ah-btn--primary" :disabled="busy">
                    <span v-if="busy" class="ah-spin"></span>{{ busy ? $t('Auth.loading') : $t('Auth.log_in') }}
                </button>
                <button type="button" class="ah-btn ah-btn--secondary" :disabled="busy" @click="sendMagicLink">{{ $t('Auth.email_me_link') }}</button>
            </div>

            <div class="auth__remember">
                <label><input v-model="rememberMe" type="checkbox" class="ah-check" :disabled="busy" />{{ $t('Auth.keep_signed_in') }}</label>
                <span class="ah-small">{{ $t('Auth.keep_signed_in_hint') }}</span>
            </div>
        </form>

        <!-- 5b: two-factor -->
        <form v-else-if="step === 'twofa'" novalidate @submit.prevent="submit2fa">
            <span class="ah-chip ah-chip--mono auth__step">{{ $t('Auth.step_of', { a: 2, b: 2 }) }}</span>
            <h2 class="auth__h">{{ $t('Auth.two_factor_code_title') }}</h2>
            <p class="auth__p">{{ twoFactor.isRecovery ? $t('Auth.two_factor_recovery_enter', { email: form.email }) : $t('Auth.two_factor_open_app', { email: form.email }) }}</p>

            <div v-if="!twoFactor.isRecovery" class="auth__code" :class="{ 'is-error': twoFactor.error }">
                <input
                    v-for="i in 6"
                    :key="i"
                    :ref="(el) => (codeInputs[i - 1] = el)"
                    v-model="twoFactor.digits[i - 1]"
                    type="text"
                    inputmode="numeric"
                    maxlength="1"
                    autocomplete="one-time-code"
                    @input="onDigit(i - 1, $event)"
                    @keydown.backspace="onDigitBack(i - 1, $event)"
                    @paste.prevent="onDigitPaste"
                />
            </div>
            <div v-else class="ah-field" style="margin-bottom:16px">
                <input v-model.trim="twoFactor.code" type="text" class="ah-input" :class="{ 'ah-input--error': twoFactor.error }" placeholder="xxxxx-xxxxx" maxlength="20" />
            </div>
            <div v-if="twoFactor.error" class="ah-field__error" style="margin:-8px 0 14px"><ShellIcon name="x" :size="12" />{{ twoFactor.error }}</div>

            <button type="submit" class="ah-btn ah-btn--primary ah-btn--block ah-btn--lg" :disabled="busy">{{ busy ? $t('Auth.loading') : $t('Auth.two_factor_verify') }}</button>
            <div class="auth__links">
                <button type="button" @click="toggleRecoveryMode">{{ twoFactor.isRecovery ? $t('Auth.two_factor_use_app') : $t('Auth.two_factor_use_recovery') }}</button>
                <button type="button" class="auth__link-muted" @click="backToLogin">{{ $t('Auth.back') }}</button>
            </div>
            <p class="auth__hint ah-mono">{{ $t('Auth.code_expires_in', { t: countdown(twoFactor.expiresAt) }) }}</p>
        </form>

        <!-- 5b: verify email -->
        <div v-else-if="step === 'verify'">
            <div class="auth__glyph auth__glyph--warn">!</div>
            <h2 class="auth__h">{{ $t('Auth.verify_first_title') }}</h2>
            <i18n-t keypath="Auth.verify_first_body" tag="p" class="auth__p"><template #email><strong>{{ form.email }}</strong></template></i18n-t>
            <button type="button" class="ah-btn ah-btn--secondary ah-btn--block ah-btn--lg" :disabled="busy || resendWait > 0" @click="handleSubmitResend">{{ $t('Auth.resend_email') }}</button>
            <p class="auth__hint ah-mono" v-if="resendWait > 0">{{ $t('Auth.resend_in', { t: fmtSeconds(resendWait) }) }}</p>
            <div class="auth__links" style="margin-top:28px">
                <span class="ah-small">{{ $t('Auth.wrong_address') }} <button type="button" @click="backToLogin">{{ $t('Auth.backlogin') }}</button></span>
            </div>
        </div>

        <!-- 5b: magic link sent -->
        <div v-else-if="step === 'magic'">
            <div class="auth__glyph auth__glyph--brand">✉</div>
            <h2 class="auth__h">{{ $t('Auth.magic_sent_title') }}</h2>
            <i18n-t keypath="Auth.magic_sent_body" tag="p" class="auth__p"><template #email><strong>{{ form.email }}</strong></template></i18n-t>
            <div class="auth__note">
                {{ $t('Auth.magic_nothing_yet') }}
                <button type="button" class="auth__field-link" style="background:none;border:0;padding:0;cursor:pointer" :disabled="resendWait > 0" @click="sendMagicLink">{{ $t('Auth.send_again') }}</button>
                <span v-if="resendWait > 0" class="ah-mono"> {{ fmtSeconds(resendWait) }}</span>
            </div>
            <div class="auth__links" style="margin-top:28px">
                <button type="button" @click="backToLogin">{{ $t('Auth.use_password_instead') }}</button>
            </div>
        </div>

        <!-- 5b: workspace switcher -->
        <div v-else-if="step === 'workspace'">
            <h2 class="auth__h">{{ $t('Auth.choose_workspace') }}</h2>
            <p class="auth__p">{{ $t('Auth.belong_to', { n: workspaces.length }) }}</p>
            <div class="auth__ws">
                <button v-for="w in workspaces" :key="w._id" type="button" class="auth__ws-item" :disabled="w.isDisable || busy" @click="chooseWorkspace(w)">
                    <span class="ah-avatar">{{ (w.Cst_CompanyName || '?').charAt(0).toUpperCase() }}</span>
                    <span>
                        <strong>{{ w.Cst_CompanyName }}</strong>
                        <span>{{ w.isDisable ? $t('Auth.workspace_disabled') : (w.roleName || '') }}</span>
                    </span>
                    <ShellIcon name="chevron" :size="15" class="auth__ws-go" />
                </button>
            </div>
            <router-link to="/business" class="auth__field-link">+ {{ $t('Auth.create_workspace') }}</router-link>
        </div>

        <template #foot-right>
            <a v-if="step === 'login' && brand.helpLink" :href="brand.helpLink" target="_blank" rel="noopener">{{ $t('Auth.locked_out') }}</a>
        </template>
    </AuthShell>
</template>

<script setup>
import Cookies from "js-cookie";

defineOptions({ name: "LoginPage" });
import { computed, inject, onMounted, onUnmounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import AuthShell from "@/components/templates/AuthShell/AuthShell.vue";
import ProviderButton from "@/plugins/oauth/ProviderButton.vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { apiRequestWithoutCompnay, apiRequestWithoutSecure, getAuth } from "@/services";
import * as env from "@/config/env";
import { publicConfig, enabledProviders } from "@/config/publicConfig";

const { t } = useI18n();
const $toast = useToast();
const router = useRouter();
const route = useRoute();
const { getters } = useStore();
const axios = inject("$axios");

const brand = computed(() => getters["brandSettingTab/brandSettings"] || {});
const showRegister = computed(() => router.hasRoute("Sign-up") || router.hasRoute("Signup") || router.hasRoute("Register"));
const providers = computed(() => enabledProviders());
const ssoAvailable = computed(() => publicConfig.auth.sso !== false);

const step = ref("login");
const busy = ref(false);
const showPassword = ref(false);
const rememberMe = ref(false);
const banner = ref(null);
const emailInput = ref(null);
const form = reactive({ email: localStorage.getItem("ForgotEmail") || "", password: "" });
const errors = reactive({ email: "", password: "" });
const userData = ref(null);
const workspaces = ref([]);
const pendingUserId = ref("");

const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+[.][a-zA-Z]{2,}$/;
const validate = ({ password = true } = {}) => {
    errors.email = !form.email ? t("Auth.email_required") : !EMAIL_RE.test(form.email) ? t("Auth.email_invalid") : "";
    errors.password = password && !form.password ? t("Auth.password_required") : "";
    return !errors.email && !errors.password;
};

const clearSession = () => {
    localStorage.removeItem("updateToken");
    Cookies.remove("refreshToken");
    Cookies.remove("accessToken");
};
const rememberEmail = () => localStorage.setItem("ForgotEmail", form.email);
const encode = (str) => Array.from(str).map((c) => c.charCodeAt(0)).join(", ");
const decode = (src) => String.fromCharCode.apply(null, src.split(","));

onMounted(() => {
    try {
        const rem = JSON.parse(localStorage.getItem("remember") || "null");
        if (rem) { form.email = rem.email; form.password = decode(rem.password); rememberMe.value = true; }
    } catch { /* ignore */ }
    if (route.query.reason === "expired") banner.value = { kind: "warn", text: t("Auth.two_factor_session_expired") };
    if (route.query.magic === "invalid") banner.value = { kind: "danger", text: t("Auth.magic_invalid") };
    if (route.query.magic === "disabled") banner.value = { kind: "warn", text: t("Auth.magic_unavailable") };
    if (route.query.ssoError) banner.value = { kind: "danger", text: t("Auth.sso_failed") };
    if (route.query.magic === "ok" && route.query.uid) {
        busy.value = true;
        proceedAfterAuth(String(route.query.uid)).catch(() => {
            busy.value = false;
            banner.value = { kind: "danger", text: t("Auth.magic_invalid") };
        });
        return;
    }
    emailInput.value?.focus();
});

let tick = null;
const now = ref(Date.now());
onMounted(() => { tick = setInterval(() => { now.value = Date.now(); if (resendWait.value > 0) resendWait.value -= 1; }, 1000); });
onUnmounted(() => clearInterval(tick));
const countdown = (at) => fmtSeconds(Math.max(0, Math.round((at - now.value) / 1000)));
const fmtSeconds = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const resendWait = ref(0);

const updateUserStatus = (uid) => apiRequestWithoutCompnay("put", env.USER_UPATE, { userId: uid, updateObject: { isOnline: true, lastActive: new Date() } }).catch(() => {});
const userCompanyStatusCheck = (uid) => apiRequestWithoutCompnay("post", env.USER_AND_COMAPNY_CHECK, { userId: uid });

const handleSubmit = async () => {
    if (!validate()) return;
    banner.value = null;
    busy.value = true;
    if (rememberMe.value) localStorage.setItem("remember", JSON.stringify({ email: form.email, password: encode(form.password) }));
    else localStorage.removeItem("remember");
    try {
        const user = await apiRequestWithoutSecure("post", env.LOGIN, { email: form.email, password: form.password, isLoginType: "frontend" });
        if (user.status !== 200) throw new Error("server");
        if (user?.data?.isResetPassword === true) {
            clearSession();
            banner.value = { kind: "warn", text: t("Auth.reset_required") };
            return;
        }
        if (user?.data?.twoFactorRequired === true && user?.data?.tempToken) {
            twoFactor.tempToken = user.data.tempToken;
            twoFactor.expiresAt = Date.now() + 5 * 60 * 1000;
            step.value = "twofa";
            setTimeout(() => codeInputs.value[0]?.focus(), 50);
            return;
        }
        await proceedAfterAuth(user.data.uid);
    } catch (error) {
        clearSession();
        localStorage.removeItem("userId");
        localStorage.removeItem("isLogging");
        localStorage.removeItem("remember");
        const data = error?.response?.data || {};
        const msg = data.message || error.message;
        if (data.isEmailVerified === false) {
            userData.value = data.userData || null;
            step.value = "verify";
        } else if (msg === "Your email is invalid. Please check and try again" || msg === "User not found") {
            errors.email = t("Auth.account_unknown");
        } else if (msg === "Your password is invalid. Please check and try again" || error.error_code === "InvalidPassword" || error.error === "invalid username/password") {
            errors.password = t("Auth.password_mismatch") + (Number.isFinite(data.attemptsLeft) ? " " + t("Auth.attempts_left", { n: data.attemptsLeft }) : "");
        } else if (msg === "Auth.too_many_request" || error?.response?.status === 429) {
            errors.password = t("Auth.too_many_attempts");
        } else if (msg === "Email Not Verified") {
            step.value = "verify";
        } else {
            banner.value = { kind: "danger", text: t("Auth.server_error") };
        }
    } finally {
        busy.value = false;
    }
};

const proceedAfterAuth = async (userId) => {
    localStorage.setItem("userId", userId);
    const [userResponse] = await Promise.all([userCompanyStatusCheck(userId), getAuth(userId, true)]);
    if (userResponse?.data?.status === false) { clearSession(); throw new Error("server"); }
    const { userData: uData, companyId: companyID, isCompanyFind, companies } = userResponse.data.data;
    userData.value = uData;
    if (!uData.isEmailVerified) { clearSession(); step.value = "verify"; return; }
    localStorage.setItem("SubmenuScreen", "project");
    updateUserStatus(userId);

    if (!uData.AssignCompany?.length) { router.push({ name: "Create_Company" }); return; }
    const cid = localStorage.getItem("selectedCompany") ?? companyID;
    if (cid && isCompanyFind === false) { router.push({ name: "Create_Company" }); return; }

    if (!localStorage.getItem("selectedCompany") && Array.isArray(companies) && companies.length > 1) {
        workspaces.value = companies;
        pendingUserId.value = userId;
        step.value = "workspace";
        return;
    }
    finishLogin(cid);
};

const finishLogin = async (cid) => {
    localStorage.setItem("selectedCompany", cid);
    localStorage.setItem("isLogging", "true");
    localStorage.removeItem("ForgotEmail");
    const redirect = route.query.redirect_url;
    if (redirect && redirect !== "/login") {
        if (redirect === "/") await router.replace(`/${cid}`);
        else {
            const tmpcid = redirect.split("/")[1];
            const ok = (tmpcid && userData.value?.AssignCompany?.includes(tmpcid)) || tmpcid === "oauth2";
            await router.replace(ok ? redirect : `/${cid}`);
        }
    }
    window.location.reload();
};
const chooseWorkspace = (w) => { busy.value = true; finishLogin(w._id); };

/* 2FA */
const twoFactor = reactive({ tempToken: "", code: "", digits: ["", "", "", "", "", ""], error: "", isRecovery: false, expiresAt: 0 });
const codeInputs = ref([]);
const onDigit = (i, e) => {
    const v = (e.target.value || "").replace(/\D/g, "").slice(-1);
    twoFactor.digits[i] = v;
    twoFactor.error = "";
    if (v && i < 5) codeInputs.value[i + 1]?.focus();
    if (twoFactor.digits.every((d) => d)) submit2fa();
};
const onDigitBack = (i, e) => { if (!e.target.value && i > 0) codeInputs.value[i - 1]?.focus(); };
const onDigitPaste = (e) => {
    const txt = (e.clipboardData.getData("text") || "").replace(/\D/g, "").slice(0, 6);
    txt.split("").forEach((c, i) => (twoFactor.digits[i] = c));
    codeInputs.value[Math.min(txt.length, 5)]?.focus();
    if (txt.length === 6) submit2fa();
};
const submit2fa = async () => {
    const code = twoFactor.isRecovery ? twoFactor.code.trim() : twoFactor.digits.join("");
    if (!code || (!twoFactor.isRecovery && code.length < 6)) { twoFactor.error = t("Auth.two_factor_enter_code"); return; }
    if (busy.value) return;
    twoFactor.error = "";
    busy.value = true;
    try {
        const res = await apiRequestWithoutSecure("post", env.TWO_FA_VALIDATE, { tempToken: twoFactor.tempToken, code });
        if (res.status !== 200 || !res?.data?.uid) { twoFactor.error = t("Auth.two_factor_invalid_code"); return; }
        await proceedAfterAuth(res.data.uid);
    } catch (error) {
        const msg = error?.response?.data?.message;
        if (msg === "Auth.too_many_request") twoFactor.error = t("Toast.Too_many_request");
        else if (typeof msg === "string" && /expired/i.test(msg)) { backToLogin(); banner.value = { kind: "warn", text: t("Auth.two_factor_session_expired") }; }
        else twoFactor.error = t("Auth.two_factor_invalid_code");
    } finally {
        busy.value = false;
    }
};
const toggleRecoveryMode = () => { twoFactor.isRecovery = !twoFactor.isRecovery; twoFactor.code = ""; twoFactor.digits = ["", "", "", "", "", ""]; twoFactor.error = ""; };
const backToLogin = () => {
    Object.assign(twoFactor, { tempToken: "", code: "", digits: ["", "", "", "", "", ""], error: "", isRecovery: false });
    localStorage.removeItem("lastResendTime");
    step.value = "login";
    form.password = "";
};

/* verify email */
const handleSubmitResend = () => {
    if (!userData.value?._id) { $toast.error(t("Toast.something_went_wrong"), { position: "top-right" }); return; }
    busy.value = true;
    axios.post(env.API_URI + env.SEND_VARIFICATION_EMAIL, { uid: userData.value._id, email: userData.value.Employee_Email || form.email }).then((result) => {
        if (result.data.status === true) { resendWait.value = 60; $toast.success(t("Toast.Verification_mail_has_been_send_successfully"), { position: "top-right" }); }
        else $toast.error(result.data.statusText, { position: "top-right" });
    }).catch(() => $toast.error(t("Toast.something_went_wrong"), { position: "top-right" })).finally(() => { busy.value = false; });
};

/* magic link */
const sendMagicLink = async () => {
    if (!validate({ password: false })) return;
    if (resendWait.value > 0) return;
    busy.value = true;
    try {
        const res = await apiRequestWithoutSecure("post", env.MAGIC_LINK, { email: form.email, redirect_url: route.query.redirect_url || "" });
        if (res?.data?.status === false && res?.data?.statusText === "disabled") { banner.value = { kind: "warn", text: t("Auth.magic_unavailable") }; return; }
        step.value = "magic";
        resendWait.value = 60;
    } catch (error) {
        const status = error?.response?.status;
        if (status === 404 || status === 501) banner.value = { kind: "warn", text: t("Auth.magic_unavailable") };
        else if (status === 429) errors.email = t("Auth.too_many_attempts");
        else banner.value = { kind: "danger", text: t("Auth.server_error") };
    } finally {
        busy.value = false;
    }
};
</script>

<style>
.ah-spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid rgba(255,255,255,.35); border-top-color: #fff; animation: auth-spin .8s linear infinite; }
</style>
