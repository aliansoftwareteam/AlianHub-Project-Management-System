<template>
    <AuthShell :proof="false">
        <div v-if="!failed" class="av2-center">
            <div class="auth__spinner"></div>
            <p class="auth__p">{{ $t('Auth.platform_signing_in') }}</p>
        </div>
        <div v-else class="av2-auth-card">
            <div class="auth__glyph auth__glyph--warn">!</div>
            <h2 class="auth__h">{{ $t('Auth.link_expired_title') }}</h2>
            <p class="auth__p">{{ failed === 'ended' ? $t('Auth.platform_support_ended') : $t('Auth.platform_link_gone') }}</p>
            <router-link :to="{ name: 'Log-in' }" class="ah-btn ah-btn--secondary ah-btn--block ah-btn--lg">{{ $t('Auth.back_to_login') }}</router-link>
        </div>
    </AuthShell>
</template>

<script setup>
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import AuthShell from "@/components/templates/AuthShell/AuthShell.vue";
import { apiRequestWithoutSecure } from "@/services";
import * as env from "@/config/env";
import { notePlatformSignIn } from "@/composable/platformSignIn";

defineOptions({ name: "PlatformLoginPage" });

const route = useRoute();
const router = useRouter();
const failed = ref("");

/* The portal's "Open AlianHub" link: a 60-second, single-use token. An account with two-factor
 * sign-in goes to the normal login instead, with its address filled in. */
onMounted(async () => {
    try {
        const result = await apiRequestWithoutSecure("post", env.PLATFORM_LOGIN, { token: String(route.query.token || "") });
        notePlatformSignIn();
        router.replace({ name: "Log-in", query: { magic: "ok", uid: result.data.data.uid } });
    } catch (error) {
        const data = error?.response?.data || {};
        if (data.twoFactorRequired && data.email) {
            localStorage.setItem("ForgotEmail", data.email);
            router.replace({ name: "Log-in" });
            return;
        }
        failed.value = data.key === "ended" ? "ended" : "gone";
    }
});
</script>

<style>
@import "../authV2.css";
</style>
