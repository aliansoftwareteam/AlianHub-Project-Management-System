<template>
    <AuthShell :proof="false">
        <div v-if="stage === 'checking'" class="av2-center">
            <div class="auth__spinner"></div>
            <p class="auth__p">{{ $t('Auth.invite_checking') }}</p>
        </div>

        <form v-else-if="stage === 'form'" class="av2-auth-card" novalidate @submit.prevent="submit">
            <h2 class="auth__h">{{ $t('Auth.create_account') }}</h2>
            <p class="auth__p">{{ workspaceName ? $t('Auth.join_lead', { workspace: workspaceName }) : $t('Auth.create_account_lead') }}</p>

            <div v-if="banner" class="auth__banner auth__banner--danger"><ShellIcon name="alert" :size="15" /><span>{{ banner }}</span></div>

            <div v-if="providers.length" class="auth__providers">
                <ProviderButton v-for="p in providers" :key="p" :provider="p" mode="register" :companyID="companyIdRoute" :companyUserDocID="requestId" />
            </div>
            <div v-if="providers.length" class="auth__or">{{ $t('Auth.or') }}</div>

            <div class="auth__fields" style="gap:9px">
                <div class="ah-field">
                    <label class="ah-field__label" for="inv-name">{{ $t('Auth.full_name') }}</label>
                    <input
                        id="inv-name"
                        ref="nameInput"
                        v-model.trim="form.name"
                        type="text"
                        class="ah-input"
                        :class="{ 'ah-input--error': errors.name }"
                        autocomplete="name"
                        maxlength="50"
                        :placeholder="$t('Auth.name_placeholder')"
                        :aria-invalid="!!errors.name"
                        @input="errors.name = ''"
                    />
                    <div v-if="errors.name" class="ah-field__error"><ShellIcon name="x" :size="12" />{{ errors.name }}</div>
                </div>
                <div class="ah-field">
                    <label class="ah-field__label" for="inv-email">{{ $t('Auth.email') }}</label>
                    <div id="inv-email" class="av2-email">{{ email }}</div>
                </div>
                <div class="ah-field">
                    <label class="ah-field__label" for="inv-password">{{ $t('Auth.password') }}</label>
                    <div class="auth__pw">
                        <input
                            id="inv-password"
                            v-model="form.password"
                            :type="showPassword ? 'text' : 'password'"
                            class="ah-input"
                            :class="{ 'ah-input--error': errors.password }"
                            autocomplete="new-password"
                            maxlength="150"
                            :placeholder="$t('Auth.password_placeholder')"
                            :aria-invalid="!!errors.password"
                            @input="errors.password = ''"
                        />
                        <button type="button" class="auth__pw-eye" :aria-label="showPassword ? $t('Auth.hide_password') : $t('Auth.show_password')" @click="showPassword = !showPassword">
                            <ShellIcon :name="showPassword ? 'eyeOff' : 'eye'" :size="15" />
                        </button>
                    </div>
                    <div v-if="errors.password" class="ah-field__error"><ShellIcon name="x" :size="12" />{{ errors.password }}</div>
                    <div v-else class="ah-field__hint">{{ $t('Auth.password_rules') }}</div>
                </div>
                <button type="submit" class="ah-btn ah-btn--primary ah-btn--block ah-btn--lg" :disabled="busy">
                    <span v-if="busy" class="ah-spin"></span>{{ busy ? $t('Auth.loading') : $t('Auth.continue') }}
                </button>
            </div>

            <i18n-t keypath="Auth.terms_line" tag="p" class="av2-terms">
                <template #terms><a v-if="termsLink" :href="termsLink" target="_blank" rel="noopener">{{ $t('Auth.tearm') }}</a><span v-else>{{ $t('Auth.tearm') }}</span></template>
                <template #privacy><a v-if="privacyLink" :href="privacyLink" target="_blank" rel="noopener">{{ $t('Auth.Privacy_Policy') }}</a><span v-else>{{ $t('Auth.Privacy_Policy') }}</span></template>
            </i18n-t>
            <p class="av2-terms" style="margin-top:4px">{{ $t('Auth.have_account') }} <strong><router-link :to="signInToAccept">{{ $t('Auth.invite_sign_in_to_accept') }}</router-link></strong></p>
        </form>

        <div v-else-if="stage === 'accept'" class="av2-auth-card">
            <h2 class="auth__h">{{ $t('Auth.invite_accept_title') }}</h2>
            <p class="auth__p">{{ workspaceName ? $t('Auth.invite_accept_body', { workspace: workspaceName }) : $t('Auth.invite_accept_body_plain') }}</p>
            <div v-if="banner" class="auth__banner auth__banner--danger"><ShellIcon name="alert" :size="15" /><span>{{ banner }}</span></div>
            <div class="auth__fields" style="gap:9px">
                <div class="av2-email">{{ email }}</div>
                <button type="button" class="ah-btn ah-btn--primary ah-btn--block ah-btn--lg" :disabled="busy" @click="acceptInvitation">
                    <span v-if="busy" class="ah-spin"></span>{{ busy ? $t('Auth.loading') : $t('Auth.invite_accept') }}
                </button>
            </div>
        </div>

        <div v-else-if="stage === 'wrong'" class="av2-auth-card">
            <div class="auth__glyph auth__glyph--warn">!</div>
            <h2 class="auth__h">{{ $t('Auth.invite_wrong_account_title') }}</h2>
            <p class="auth__p">{{ $t('Auth.invite_wrong_account_body', { invited: email, current: signedInEmail }) }}</p>
            <button type="button" class="ah-btn ah-btn--primary ah-btn--block ah-btn--lg" @click="switchAccount">{{ $t('Auth.invite_switch_account') }}</button>
        </div>

        <div v-else class="av2-auth-card">
            <div class="auth__glyph auth__glyph--warn">!</div>
            <h2 class="auth__h">{{ $t('Auth.invite_invalid_title') }}</h2>
            <p class="auth__p">{{ invalidMessage || $t('Auth.invite_invalid_body') }}</p>
            <router-link :to="{ name: 'Log-in' }" class="ah-btn ah-btn--secondary ah-btn--block ah-btn--lg">{{ $t('Auth.back_to_login') }}</router-link>
        </div>
    </AuthShell>
</template>

<script setup>
import { computed, inject, onMounted, reactive, ref } from "vue";

defineOptions({ name: "InvitationPage" });
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import { enabledProviders } from "@/config/publicConfig";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import AuthShell from "@/components/templates/AuthShell/AuthShell.vue";
import ProviderButton from "@/plugins/oauth/ProviderButton.vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { useCustomComposable } from "@/composable";
import { apiRequest, apiRequestWithoutCompnay, apiRequestWithoutSecure, getAuth, useAuth } from "@/services";
import * as env from "@/config/env";
import { ROLE_OWNER } from "@/utils/roles";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const $toast = useToast();
const axios = inject("$axios");
const addSubscription = inject("addSubscription");
const { getters } = useStore();
const { debouncerWithPromise } = useCustomComposable();
const { logOut } = useAuth();

const brand = computed(() => getters["brandSettingTab/brandSettings"] || {});
const termsLink = computed(() => brand.value.termsLink || brand.value.termsOfService || "");
const privacyLink = computed(() => brand.value.privacyLink || brand.value.privacyPolicy || "");
const providers = computed(() => enabledProviders());

const PASSWORD_RE = /^(?=.*?[A-Z])(?=.*?[a-z])(?=.*?[0-9])(?=.*?[#?!@$%^&*-]).*$/;

const stage = ref("checking");
const busy = ref(false);
const showPassword = ref(false);
const banner = ref("");
const invalidMessage = ref("");
const email = ref("");
const workspaceName = ref("");
const requestId = ref("");
const companyIdRoute = ref("");
const signedInEmail = ref("");
const nameInput = ref(null);
const form = reactive({ name: "", password: "" });
const errors = reactive({ name: "", password: "" });
const linkId = String(route.query.token || "");
const signInToAccept = { name: "Log-in", query: { redirect_url: route.fullPath } };

const sameAddress = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

const readSignedInEmail = async () => {
    const uid = localStorage.getItem("userId");
    if (!uid) return "";
    try {
        const user = await apiRequestWithoutCompnay("get", `${env.USER_UPATE}/${uid}`);
        return user?.status === 200 ? String(user.data?.Employee_Email || "") : "";
    } catch {
        return "";
    }
};

onMounted(async () => {
    const parts = String(route.query.companyId || "").split("-");
    if (parts.length < 2 || !parts[0] || !parts[1]) { stage.value = "invalid"; return; }
    [companyIdRoute.value, requestId.value] = parts;
    localStorage.setItem("companyId", companyIdRoute.value);
    localStorage.setItem("companyUserDocID", requestId.value);
    try {
        const preview = await axios.post(env.API_URI + env.INVITATION_PREVIEW, { companyId: companyIdRoute.value, memberId: requestId.value, linkId });
        if (!preview.data.status) { stage.value = "invalid"; return; }
        const invite = preview.data.data || {};
        workspaceName.value = invite.workspaceName || "";
        if (invite.status !== 1) {
            invalidMessage.value = invite.status === 3 ? t("Auth.invite_cancelled") : t("Auth.invite_used");
            stage.value = "invalid";
            return;
        }
        email.value = invite.email;
        signedInEmail.value = await readSignedInEmail();
        if (signedInEmail.value) {
            stage.value = sameAddress(signedInEmail.value, invite.email) ? "accept" : "wrong";
        } else {
            stage.value = "form";
            setTimeout(() => nameInput.value?.focus(), 50);
        }
    } catch (error) {
        console.error(error);
        invalidMessage.value = t("Auth.server_error");
        stage.value = "invalid";
    }
});

const validate = () => {
    errors.name = !form.name ? t("Auth.name_required") : "";
    errors.password = !form.password || form.password.length < 8
        ? t("Auth.password_short")
        : !PASSWORD_RE.test(form.password) ? t("Auth.password_weak") : "";
    return !errors.name && !errors.password;
};

const splitName = (full) => {
    const [first, ...rest] = full.split(/\s+/);
    return { firstName: first, lastName: rest.join(" ") || first };
};

const submit = async () => {
    if (!validate() || busy.value) return;
    busy.value = true;
    banner.value = "";
    try {
        const response = await apiRequestWithoutCompnay("post", env.CREATE_USER_V2, {
            ...splitName(form.name),
            assignCompany: companyIdRoute.value,
            email: email.value,
            password: form.password,
            isInvitation: true,
            memberId: requestId.value,
            linkId
        });
        if (!response.data.status) {
            banner.value = response.data.statusText?.status == 409 ? t("Auth.email_in_use") : t("Auth.server_error");
            return;
        }
        const user = await apiRequestWithoutSecure("post", env.LOGIN, { email: email.value, password: form.password });
        if (user.status !== 200) { logOut({ islogOut: true }); banner.value = t("Auth.server_error"); return; }
        await getAuth(user.data.uid, true);
        localStorage.setItem("selectedCompany", companyIdRoute.value);
        const signedInUserId = String(user.data.uid);
        const result = await apiRequestWithoutCompnay("put", env.API_ROOT_MEMBERS, {
            id: requestId.value,
            data: { userId: signedInUserId, status: 2 },
            companyId: companyIdRoute.value,
            linkId: String(route.query.token || "")
        });
        if (!result.data.status) { logOut({ islogOut: true }); banner.value = t("Auth.server_error"); return; }
        if (result.data.data?.roleType === ROLE_OWNER) {
            await apiRequestWithoutCompnay("put", env.COMPANYINVITATION, {
                updateObject: { objId: { userId: signedInUserId } },
                companyId: companyIdRoute.value
            }).catch((error) => console.error(error));
            try { addSubscription(companyIdRoute.value, response); } catch { /* optional plugin */ }
        }
        apiRequest("post", env.IMPORT_NOTIFICATION_SETTING, { companyId: companyIdRoute.value, userId: signedInUserId })
            .catch((error) => console.error("ERROR in user notification settings: ", error.message));
        apiRequest("post", env.REMOVE_USER_NOTIFICATION, { companyId: companyIdRoute.value, userId: signedInUserId, type: "Add" })
            .catch((error) => console.error(error, "ERROR"));
        localStorage.setItem("isLogging", "false");
        $toast.success(t("Toast.User_has_been_registered_successfully"), { position: "top-right" });
        router.push({ name: "Log-in" });
        debouncerWithPromise(1000).then(() => logOut({ islogOut: true, withOutRefresh: true }));
    } catch (error) {
        console.error(error);
        banner.value = t("Auth.server_error");
    } finally {
        busy.value = false;
    }
};

const switchAccount = () => logOut({ islogOut: true });

const acceptInvitation = async () => {
    if (busy.value) return;
    busy.value = true;
    banner.value = "";
    try {
        const result = await apiRequestWithoutCompnay("post", env.INVITATION_ACCEPT, { companyId: companyIdRoute.value, memberId: requestId.value, linkId });
        if (!result?.data?.status) throw new Error("refused");
        // The session's workspaces are fixed when its token is issued; a fresh one includes the one just joined.
        await getAuth(localStorage.getItem("userId"));
        localStorage.setItem("selectedCompany", companyIdRoute.value);
        await router.replace(`/${companyIdRoute.value}`);
        window.location.reload();
    } catch (error) {
        console.error(error);
        banner.value = t("Auth.invite_accept_failed");
        busy.value = false;
    }
};
</script>

<style>
@import "../authV2.css";
</style>
