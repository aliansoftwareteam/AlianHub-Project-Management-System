<template>
    <AuthShell :proof="false">
        <div v-if="stage === 'checking'" class="av2-center">
            <div class="auth__spinner"></div>
            <p class="auth__p">{{ $t('AuthV2.invite_checking') }}</p>
        </div>

        <form v-else-if="stage === 'form'" class="av2-auth-card" novalidate @submit.prevent="submit">
            <h2 class="auth__h">{{ $t('AuthV2.create_account') }}</h2>
            <p class="auth__p">{{ workspaceName ? $t('AuthV2.join_lead', { workspace: workspaceName }) : $t('AuthV2.create_account_lead') }}</p>

            <div v-if="banner" class="auth__banner auth__banner--danger"><ShellIcon name="alert" :size="15" /><span>{{ banner }}</span></div>

            <div v-if="providers.length" class="auth__providers">
                <ProviderButton v-for="p in providers" :key="p" :provider="p" mode="register" :companyID="companyIdRoute" :companyUserDocID="requestId" />
            </div>
            <div v-if="providers.length" class="auth__or">{{ $t('AuthV2.or') }}</div>

            <div class="auth__fields" style="gap:9px">
                <div class="ah-field">
                    <label class="ah-field__label ah-sr-only" for="inv-name">{{ $t('AuthV2.full_name') }}</label>
                    <input
                        id="inv-name"
                        ref="nameInput"
                        v-model.trim="form.name"
                        type="text"
                        class="ah-input"
                        :class="{ 'ah-input--error': errors.name }"
                        autocomplete="name"
                        maxlength="50"
                        :placeholder="$t('AuthV2.name_placeholder')"
                        :aria-invalid="!!errors.name"
                        @input="errors.name = ''"
                    />
                    <div v-if="errors.name" class="ah-field__error"><ShellIcon name="x" :size="12" />{{ errors.name }}</div>
                </div>
                <div class="ah-field">
                    <label class="ah-field__label ah-sr-only" for="inv-email">{{ $t('Auth.email') }}</label>
                    <div id="inv-email" class="av2-email">{{ email }}</div>
                </div>
                <div class="ah-field">
                    <label class="ah-field__label ah-sr-only" for="inv-password">{{ $t('Auth.password') }}</label>
                    <div class="auth__pw">
                        <input
                            id="inv-password"
                            v-model="form.password"
                            :type="showPassword ? 'text' : 'password'"
                            class="ah-input"
                            :class="{ 'ah-input--error': errors.password }"
                            autocomplete="new-password"
                            maxlength="150"
                            :placeholder="$t('AuthV2.password_placeholder')"
                            :aria-invalid="!!errors.password"
                            @input="errors.password = ''"
                        />
                        <button type="button" class="auth__pw-eye" :aria-label="showPassword ? 'Hide password' : 'Show password'" @click="showPassword = !showPassword">
                            <ShellIcon :name="showPassword ? 'eyeOff' : 'eye'" :size="15" />
                        </button>
                    </div>
                    <div v-if="errors.password" class="ah-field__error"><ShellIcon name="x" :size="12" />{{ errors.password }}</div>
                    <div v-else class="ah-field__hint">{{ $t('AuthV2.password_rules') }}</div>
                </div>
                <button type="submit" class="ah-btn ah-btn--primary ah-btn--block ah-btn--lg" :disabled="busy">
                    <span v-if="busy" class="ah-spin"></span>{{ busy ? $t('Auth.loading') : $t('Auth.continue') }}
                </button>
            </div>

            <i18n-t keypath="AuthV2.terms_line" tag="p" class="av2-terms">
                <template #terms><a v-if="termsLink" :href="termsLink" target="_blank" rel="noopener">{{ $t('Auth.tearm') }}</a><span v-else>{{ $t('Auth.tearm') }}</span></template>
                <template #privacy><a v-if="privacyLink" :href="privacyLink" target="_blank" rel="noopener">{{ $t('Auth.Privacy_Policy') }}</a><span v-else>{{ $t('Auth.Privacy_Policy') }}</span></template>
            </i18n-t>
            <p class="av2-terms" style="margin-top:4px">{{ $t('AuthV2.have_account') }} <strong><router-link :to="{ name: 'Log-in' }">{{ $t('Auth.log_in') }}</router-link></strong></p>
        </form>

        <div v-else class="av2-auth-card">
            <div class="auth__glyph auth__glyph--warn">!</div>
            <h2 class="auth__h">{{ $t('AuthV2.invite_invalid_title') }}</h2>
            <p class="auth__p">{{ invalidMessage || $t('AuthV2.invite_invalid_body') }}</p>
            <router-link :to="{ name: 'Log-in' }" class="ah-btn ah-btn--secondary ah-btn--block ah-btn--lg">{{ $t('AuthV2.back_to_login') }}</router-link>
        </div>
    </AuthShell>
</template>

<script setup>
import { computed, inject, onMounted, reactive, ref } from "vue";

defineOptions({ name: "InvitationPage" });
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import AuthShell from "@/components/templates/AuthShell/AuthShell.vue";
import ProviderButton from "@/plugins/oauth/ProviderButton.vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { useCustomComposable } from "@/composable";
import { apiRequest, apiRequestWithoutCompnay, apiRequestWithoutSecure, getAuth, useAuth } from "@/services";
import * as env from "@/config/env";

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
const providers = [
    process.env.VUE_APP_IS_GOOGLE_LOGIN === "true" && "google",
    process.env.VUE_APP_IS_GITHUB_LOGIN === "true" && "github",
    process.env.VUE_APP_IS_GITLAB_LOGIN === "true" && "gitlab"
].filter(Boolean);

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
const nameInput = ref(null);
const form = reactive({ name: "", password: "" });
const errors = reactive({ name: "", password: "" });

const mongoFind = (dbName, collection, _id) =>
    axios.post(env.API_URI + env.MONGO_OPRATION, { dataObj: [{ _id }], dbName, collection, methodName: "findOne" });

onMounted(async () => {
    const parts = String(route.query.companyId || "").split("-");
    if (parts.length < 2 || !parts[0] || !parts[1]) { stage.value = "invalid"; return; }
    [companyIdRoute.value, requestId.value] = parts;
    localStorage.setItem("companyId", companyIdRoute.value);
    localStorage.setItem("companyUserDocID", requestId.value);
    try {
        const company = await mongoFind("global", "companies", companyIdRoute.value);
        if (!company.data.status || company.data.statusText === null) { stage.value = "invalid"; return; }
        workspaceName.value = company.data.statusText?.Cst_CompanyName || "";
        const member = await mongoFind(companyIdRoute.value, "company_users", requestId.value);
        if (!member.data.status) { stage.value = "invalid"; return; }
        const user = member.data.statusText || {};
        if (user.status === 1) {
            email.value = user.userEmail;
            stage.value = "form";
            setTimeout(() => nameInput.value?.focus(), 50);
        } else {
            invalidMessage.value = user.status === 3 ? t("AuthV2.invite_cancelled") : t("AuthV2.invite_used");
            stage.value = "invalid";
        }
    } catch (error) {
        console.error(error);
        invalidMessage.value = t("Auth.server_error");
        stage.value = "invalid";
    }
});

const validate = () => {
    errors.name = !form.name ? t("AuthV2.name_required") : "";
    errors.password = !form.password || form.password.length < 8
        ? t("AuthV2.password_short")
        : !PASSWORD_RE.test(form.password) ? t("AuthV2.password_weak") : "";
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
            isInvitation: true
        });
        if (!response.data.status) {
            banner.value = response.data.statusText?.status == 409 ? t("AuthV2.email_in_use") : t("Auth.server_error");
            return;
        }
        const user = await apiRequestWithoutSecure("post", env.LOGIN, { email: email.value, password: form.password });
        if (user.status !== 200) { logOut({ islogOut: true }); banner.value = t("Auth.server_error"); return; }
        await getAuth(user.data.uid, true);
        localStorage.setItem("selectedCompany", companyIdRoute.value);
        const newUserId = response.data.statusText._id;
        const result = await apiRequestWithoutCompnay("put", env.API_ROOT_MEMBERS, {
            id: requestId.value,
            data: { userId: newUserId, status: 2 },
            companyId: companyIdRoute.value
        });
        if (!result.data.status) { logOut({ islogOut: true }); banner.value = t("Auth.server_error"); return; }
        if (result.data.data?.roleType === 1) {
            await apiRequestWithoutCompnay("put", env.COMPANYINVITATION, {
                updateObject: { objId: { userId: response.data.data._id }, companyData: [{ users: 1 }] },
                companyId: companyIdRoute.value
            }).catch((error) => console.error(error));
            try { addSubscription(companyIdRoute.value, response); } catch { /* optional plugin */ }
        }
        apiRequest("post", env.IMPORT_NOTIFICATION_SETTING, { companyId: companyIdRoute.value, userId: newUserId })
            .catch((error) => console.error("ERROR in user notification settings: ", error.message));
        apiRequest("post", env.REMOVE_USER_NOTIFICATION, { companyId: companyIdRoute.value, userId: newUserId, type: "Add" })
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
</script>

<style>
@import "../authV2.css";
</style>
