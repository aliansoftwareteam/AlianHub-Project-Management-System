<template>
    <AuthShell :proof="false">
        <div v-if="stage === 'checking'" class="av2-center">
            <div class="auth__spinner"></div>
            <p class="auth__p">{{ $t('AuthV2.checking_link') }}</p>
        </div>

        <form v-else-if="stage === 'form'" class="av2-auth-card" novalidate @submit.prevent="submit">
            <h2 class="auth__h">{{ title }}</h2>
            <p class="auth__p">{{ $t('AuthV2.password_rules') }}</p>
            <div class="auth__fields">
                <div class="ah-field">
                    <label class="ah-field__label" for="np-password">{{ $t('AuthV2.new_password') }}</label>
                    <div class="auth__pw">
                        <input
                            id="np-password"
                            ref="passwordInput"
                            v-model="password"
                            :type="show ? 'text' : 'password'"
                            class="ah-input"
                            :class="{ 'ah-input--error': errors.password }"
                            autocomplete="new-password"
                            maxlength="150"
                            placeholder="••••••••"
                            :aria-invalid="!!errors.password"
                            @input="errors.password = ''; syncConfirm()"
                        />
                        <button type="button" class="auth__pw-eye" :aria-label="show ? 'Hide password' : 'Show password'" @click="show = !show">
                            <ShellIcon :name="show ? 'eyeOff' : 'eye'" :size="15" />
                        </button>
                    </div>
                    <div v-if="errors.password" class="ah-field__error"><ShellIcon name="x" :size="12" />{{ errors.password }}</div>
                </div>
                <div class="ah-field">
                    <label class="ah-field__label" for="np-confirm">{{ $t('AuthV2.confirm_password') }}</label>
                    <input
                        id="np-confirm"
                        v-model="confirm"
                        :type="show ? 'text' : 'password'"
                        class="ah-input"
                        :class="{ 'ah-input--error': errors.confirm }"
                        autocomplete="new-password"
                        maxlength="150"
                        placeholder="••••••••"
                        :aria-invalid="!!errors.confirm"
                        @input="syncConfirm()"
                    />
                    <div v-if="errors.confirm" class="ah-field__error"><ShellIcon name="x" :size="12" />{{ errors.confirm }}</div>
                </div>
            </div>
            <div class="av2-actions">
                <button type="submit" class="ah-btn ah-btn--primary ah-btn--block ah-btn--lg" :disabled="busy">
                    <span v-if="busy" class="ah-spin"></span>{{ busy ? $t('Auth.loading') : submitLabel }}
                </button>
            </div>
            <div class="auth__links" style="margin-top:28px"><router-link :to="{ name: 'Log-in' }">{{ $t('AuthV2.back_to_login') }}</router-link></div>
        </form>

        <div v-else class="av2-auth-card">
            <div class="auth__glyph auth__glyph--warn">!</div>
            <h2 class="auth__h">{{ $t('AuthV2.link_expired_title') }}</h2>
            <p class="auth__p">{{ expiredMessage || $t('AuthV2.link_expired_body') }}</p>
            <router-link :to="{ name: 'Forgot_Password' }" class="ah-btn ah-btn--secondary ah-btn--block ah-btn--lg">{{ $t('AuthV2.request_new_link') }}</router-link>
            <div class="auth__links" style="margin-top:28px"><router-link :to="{ name: 'Log-in' }">{{ $t('AuthV2.back_to_login') }}</router-link></div>
        </div>
    </AuthShell>
</template>

<script setup>
import { onMounted, reactive, ref } from "vue";

defineOptions({ name: "NewPasswordCard" });
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import AuthShell from "@/components/templates/AuthShell/AuthShell.vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { apiRequestWithoutSecure } from "@/services";
import * as env from "@/config/env";

const props = defineProps({
    title: { type: String, required: true },
    submitLabel: { type: String, required: true },
    successToast: { type: String, required: true }
});

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const $toast = useToast();

const PASSWORD_RE = /^(?=.*?[A-Z])(?=.*?[a-z])(?=.*?[0-9])(?=.*?[#?!@$%^&*-]).*$/;

const stage = ref("checking");
const userId = ref("");
const password = ref("");
const confirm = ref("");
const show = ref(false);
const busy = ref(false);
const expiredMessage = ref("");
const errors = reactive({ password: "", confirm: "" });
const passwordInput = ref(null);

onMounted(async () => {
    try {
        const result = await apiRequestWithoutSecure("post", env.TOKEN_VERIFY_FORGOTPASSWORD, { token: route.params.token });
        userId.value = result.data.data._id;
        stage.value = "form";
        setTimeout(() => passwordInput.value?.focus(), 50);
    } catch {
        stage.value = "expired";
    }
});

const syncConfirm = () => {
    if (!confirm.value) { errors.confirm = ""; return; }
    errors.confirm = confirm.value !== password.value ? t("AuthV2.confirm_mismatch") : "";
};

const validate = () => {
    errors.password = !password.value || password.value.length < 8
        ? t("AuthV2.password_short")
        : !PASSWORD_RE.test(password.value) ? t("AuthV2.password_weak") : "";
    errors.confirm = !confirm.value ? t("AuthV2.confirm_required") : confirm.value !== password.value ? t("AuthV2.confirm_mismatch") : "";
    return !errors.password && !errors.confirm;
};

const submit = async () => {
    if (!validate() || busy.value) return;
    busy.value = true;
    try {
        await apiRequestWithoutSecure("post", env.RESETPASSWORD, { id: userId.value, password: password.value, token: route.params.token });
        $toast.success(t(props.successToast), { position: "top-right" });
        router.replace({ name: "Log-in" });
    } catch (err) {
        password.value = "";
        confirm.value = "";
        const data = err?.response?.data || {};
        if (data.key) {
            stage.value = "expired";
        } else if (data.message === "Auth.previous_wasnot_valid" || data.message === "Auth.password_wasnot_valid") {
            errors.password = t(data.message);
        } else {
            expiredMessage.value = data.message ? t(data.message) : t("Auth.server_error");
            stage.value = "expired";
        }
    } finally {
        busy.value = false;
    }
};
</script>

<style>
@import "../authV2.css";
</style>
