<template>
    <AuthShell :proof="false">
        <div v-if="stage === 'checking'" class="av2-center">
            <div class="auth__spinner"></div>
            <p class="auth__p">{{ $t('Auth.invite_checking') }}</p>
        </div>

        <div v-else-if="stage === 'accepted'" class="av2-auth-card">
            <div class="auth__glyph av2-glyph-ok"><ShellIcon name="check" :size="15" /></div>
            <h2 class="auth__h">{{ $t('Auth.invite_accepted_title') }}</h2>
            <p class="auth__p">{{ $t('Auth.invite_accepted_body') }}</p>
            <router-link :to="{ name: 'Log-in' }" class="ah-btn ah-btn--primary ah-btn--block ah-btn--lg">{{ $t('Auth.log_in') }}</router-link>
        </div>

        <div v-else class="av2-auth-card">
            <div class="auth__glyph auth__glyph--warn">!</div>
            <h2 class="auth__h">{{ $t('Auth.invite_invalid_title') }}</h2>
            <p class="auth__p">{{ message || $t('Auth.invite_invalid_body') }}</p>
            <router-link :to="{ name: 'Log-in' }" class="ah-btn ah-btn--secondary ah-btn--block ah-btn--lg">{{ $t('Auth.back_to_login') }}</router-link>
        </div>
    </AuthShell>
</template>

<script setup>
import { inject, onMounted, ref } from "vue";

defineOptions({ name: "VerifyInvitationPage" });
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import AuthShell from "@/components/templates/AuthShell/AuthShell.vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";

const { t } = useI18n();
const axios = inject("$axios");
const userId = inject("$userId");
const route = useRoute();
const router = useRouter();

const stage = ref("checking");
const message = ref("");

onMounted(async () => {
    if (!route.query.id) { stage.value = "invalid"; return; }
    try {
        const result = await axios.post(env.API_URI + env.INVITATION_CONFIRMATION, { id: route.query.id });
        if (result.data.key !== 5) {
            message.value = result.data.statusText || "";
            stage.value = "invalid";
            return;
        }
        localStorage.setItem("selectedCompany", result.data.companyId);
        apiRequest("post", env.IMPORT_NOTIFICATION_SETTING, { companyId: result.data.companyId, userId: result.data.userId })
            .catch((error) => console.error("ERROR in import settings: ", error.message));
        stage.value = "accepted";
        setTimeout(() => {
            router.replace({ name: "Log-in" }).then(() => { if (userId.value !== "") window.location.reload(); });
        }, 1200);
    } catch (error) {
        console.error("ERROR in validate invitation: ", error);
        message.value = t("Auth.server_error");
        stage.value = "invalid";
    }
});
</script>

<style>
@import "../authV2.css";
</style>
