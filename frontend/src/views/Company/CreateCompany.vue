<template>
    <div v-if="mainSpinner" class="d-flex align-items-center justify-content-center lds-roller h-100dvh">
        <div class="spinner"></div>
    </div>
    <AuthShell v-else :proof="false">
        <template #top-right>
            <span v-if="stage !== 'creating'" class="av2-step">{{ $t('Auth.step', { a: stage === 'name' ? 2 : 3, b: 3 }) }}</span>
        </template>

        <form v-if="stage === 'name'" class="av2-auth-card" novalidate @submit.prevent="toFocus">
            <h2 class="auth__h">{{ $t('Auth.name_workspace') }}</h2>
            <p class="auth__p">{{ $t('Auth.name_workspace_lead') }}</p>
            <p v-if="room && room.limit !== null" class="ah-small" data-test="workspace-count">{{ $t('Plan.workspaces_count', { count: room.count, limit: room.limit }) }}</p>
            <div v-if="room && !room.canCreate" class="cc-limit" role="alert" data-test="workspace-limit">
                <span>{{ $t('Plan.workspace_limit_reached', { limit: room.limit }) }}</span>
                <a v-if="room.portalUrl" :href="room.portalUrl" target="_blank" rel="noopener" class="cc-limit__link">{{ $t('Plan.banner.add_workspaces') }}</a>
            </div>
            <div class="av2-ws">
                <span class="av2-ws-mark">{{ initial }}</span>
                <div class="ah-field">
                    <label class="ah-field__label ah-sr-only" for="ws-name">{{ $t('Auth.name_workspace') }}</label>
                    <input
                        id="ws-name"
                        ref="nameInput"
                        v-model.trim="form.name"
                        type="text"
                        class="ah-input"
                        :class="{ 'ah-input--error': errors.name }"
                        maxlength="60"
                        autocomplete="organization"
                        :placeholder="$t('Auth.workspace_placeholder')"
                        :aria-invalid="!!errors.name"
                        @input="errors.name = ''"
                    />
                </div>
            </div>
            <div v-if="errors.name" class="ah-field__error" style="margin:-8px 0 12px"><ShellIcon name="x" :size="12" />{{ errors.name }}</div>

            <div class="ah-field" style="margin-bottom:16px">
                <span class="ah-field__label">{{ $t('Auth.team_size') }}</span>
                <div class="av2-chips" role="radiogroup">
                    <button
                        v-for="size in TEAM_SIZES"
                        :key="size.value"
                        type="button"
                        class="av2-chip"
                        :class="{ 'is-on': form.teamSize === size.value }"
                        role="radio"
                        :aria-checked="form.teamSize === size.value"
                        @click="form.teamSize = size.value"
                    >{{ size.label }}</button>
                </div>
            </div>

            <div v-if="affiliateOn" class="ah-field" style="margin-bottom:16px">
                <label class="ah-field__label" for="ws-ref">{{ $t('Auth.referral_code') }}</label>
                <input
                    id="ws-ref"
                    v-model.trim="form.referral"
                    type="text"
                    class="ah-input"
                    :class="{ 'ah-input--error': errors.referral }"
                    maxlength="60"
                    :placeholder="$t('Affiliate.refferal_code_placeholder')"
                    @input="errors.referral = ''; checkReferral()"
                />
                <div v-if="errors.referral" class="ah-field__error"><ShellIcon name="x" :size="12" />{{ errors.referral }}</div>
            </div>

            <button type="submit" class="ah-btn ah-btn--primary ah-btn--block ah-btn--lg" :disabled="room && !room.canCreate">{{ $t('Auth.continue') }}</button>
            <div class="auth__links" style="margin-top:28px">
                <span class="ah-small">{{ $t('Auth.joining_team') }} <button type="button" class="av2-link-btn" @click="logOut()">{{ $t('Auth.use_invite_link') }}</button></span>
                <button type="button" class="av2-link-btn av2-link-btn--muted" @click="logOut()">{{ $t('Auth.backlogin') }}</button>
            </div>
        </form>

        <div v-else-if="stage === 'focus'" class="av2-auth-card">
            <h2 class="auth__h">{{ $t('Auth.focus_title') }}</h2>
            <p class="auth__p" style="margin-bottom:16px">{{ $t('Auth.focus_lead') }}</p>
            <div v-if="banner" class="auth__banner auth__banner--danger" role="alert"><ShellIcon name="alert" :size="15" /><span>{{ banner }}</span></div>
            <div class="av2-grid" role="radiogroup">
                <button
                    v-for="f in FOCUSES"
                    :key="f"
                    type="button"
                    class="av2-chip"
                    :class="{ 'is-on': form.focus === f, 'av2-chip--wide': f === 'other' }"
                    role="radio"
                    :aria-checked="form.focus === f"
                    @click="form.focus = f"
                >{{ $t(`Auth.focus_${f}`) }}</button>
            </div>
            <button type="button" class="ah-btn ah-btn--primary ah-btn--block ah-btn--lg" style="margin-top:14px" :disabled="!form.focus" @click="create(true)">{{ $t('Auth.open_workspace') }}</button>
            <div class="auth__links" style="margin-top:28px">
                <button type="button" class="av2-link-btn av2-link-btn--muted" @click="create(false)">{{ $t('Auth.skip_blank') }}</button>
                <button type="button" class="av2-link-btn av2-link-btn--muted" @click="stage = 'name'">{{ $t('Auth.back') }}</button>
            </div>
        </div>

        <div v-else class="av2-auth-card">
            <h2 class="auth__h">{{ form.name }}</h2>
            <p class="auth__p" style="margin-bottom:0" role="status">{{ statusText }}</p>
            <div class="av2-progress"><div class="av2-progress__bar" :style="{ width: progress + '%' }"></div></div>
            <p class="av2-status ah-mono">{{ progress }}%</p>
        </div>
    </AuthShell>
</template>

<script setup>
import { computed, inject, nextTick, onMounted, reactive, ref } from "vue";

defineOptions({ name: "CreateCompanyPage" });
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import Cookies from "js-cookie";
import AuthShell from "@/components/templates/AuthShell/AuthShell.vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { useCustomComposable, useGetterFunctions } from "@/composable";
import { useCreateWorkspace } from "@/composable/useCreateWorkspace";
import { apiRequestWithoutCompnay, useAuth } from "@/services";
import * as env from "@/config/env";

const { t } = useI18n();
const router = useRouter();
const { getters, commit } = useStore();
const { logOut } = useAuth();
const { debounce } = useCustomComposable();
const { getUser } = useGetterFunctions();
const userId = inject("$userId");
const companyId = inject("$companyId");
const { room, progress, statusText, banner, loadRoom, nameError, create: createWorkspace } = useCreateWorkspace(userId);

const TEAM_SIZES = [
    { value: "1", label: t("Auth.size_just_me") },
    { value: "2-15", label: "2–15" },
    { value: "16-50", label: "16–50" },
    { value: "50+", label: "50+" }
];
const FOCUSES = ["software", "design", "marketing", "agency", "operations", "support", "other"];
const affiliateOn = env.AFFILITAION_ON == "true";

const stage = ref("name");
const mainSpinner = ref(true);
const userEmail = ref("");
const nameInput = ref(null);
const form = reactive({ name: "", teamSize: "2-15", focus: "", referral: affiliateOn ? Cookies.get("refferCode") || "" : "" });
const errors = reactive({ name: "", referral: "" });

const companies = computed(() => getters["settings/companies"] || []);
const initial = computed(() => (form.name || "A").charAt(0).toUpperCase());

const openExistingCompany = (cid) => {
    const mine = getUser(userId.value)?.assigneeCompany || [];
    const company = companies.value.find((x) => x._id === cid);
    if (!cid || !mine.includes(cid) || company?.isDisable) return false;
    companyId.value = cid;
    commit("settings/mutateSelectedCompany", cid);
    localStorage.setItem("selectedCompany", cid);
    router.replace({ name: "Home", params: { cid } }).catch((error) => console.error("ERROR in change company: ", error));
    return true;
};

onMounted(async () => {
    try {
        const localUserId = localStorage.getItem("userId");
        if (companyId.value && localUserId && openExistingCompany(companyId.value)) return;
        if (!localUserId) { router.push({ name: "Log-in" }); return; }
        userId.value = localUserId;
        loadRoom();
        const result = await apiRequestWithoutCompnay("get", `${env.USER_UPATE}/${userId.value}`).catch(() => null);
        userEmail.value = result?.data?.Employee_Email || "";
    } finally {
        mainSpinner.value = false;
        nextTick(() => nameInput.value?.focus());
    }
});

const checkReferral = debounce(async () => {
    if (!affiliateOn || !form.referral) { errors.referral = ""; return; }
    try {
        await apiRequestWithoutCompnay("post", env.VALIDATECOMPANYREFFERCODE, { refferalCode: form.referral, userId: userId.value });
        errors.referral = "";
    } catch {
        errors.referral = t("Affiliate.refferal_code_error");
    }
}, 500);

const toFocus = () => {
    errors.name = nameError(form.name);
    if (errors.name || errors.referral) return;
    stage.value = "focus";
};

const create = async (withSample) => {
    stage.value = "creating";
    const opened = await createWorkspace({
        name: form.name,
        teamSize: form.teamSize,
        teamFocus: form.focus,
        withSample,
        referral: errors.referral ? "" : form.referral,
        email: userEmail.value
    });
    if (!opened) stage.value = "focus";
};
</script>

<style>
@import "../Authentication/authV2.css";
</style>

<style scoped>
.cc-limit { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 16px; padding: 10px 12px; border-radius: var(--r-input); background: var(--warn-bg); color: var(--warn-ink); font: var(--text-small); }
.cc-limit__link { color: inherit; font-weight: 600; text-decoration: underline; }
</style>
