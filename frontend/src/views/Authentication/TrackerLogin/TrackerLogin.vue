<template>
    <AuthShell :proof="false">
        <div class="av2-auth-card">
            <div class="auth__glyph auth__glyph--brand"><ShellIcon name="time" :size="15" /></div>
            <h2 class="auth__h">{{ $t('Auth.tracker_title') }}</h2>
            <p class="auth__p">{{ $t('Auth.tracker_body') }}</p>
            <p v-if="failed" class="auth__p" role="alert" data-test="tracker-code-error">{{ $t('Auth.tracker_code_failed') }}</p>
            <button type="button" class="ah-btn ah-btn--primary ah-btn--block ah-btn--lg" :disabled="opening" @click="redirect">{{ $t('Auth.tracker_continue') }}</button>
            <p v-if="notOpened" class="auth__hint" role="status" data-test="tracker-not-opened">{{ $t('Auth.tracker_nothing_happened') }} <router-link :to="{ name: 'Time Tracking', params: { cid: companyId } }" class="auth__field-link">{{ $t('Auth.tracker_download') }}</router-link></p>
        </div>
    </AuthShell>
</template>

<script setup>
import { inject, onBeforeUnmount, ref } from "vue";
import { useRoute } from "vue-router";
import AuthShell from "@/components/templates/AuthShell/AuthShell.vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { apiRequestWithoutCompnay } from "@/services";
import * as env from "@/config/env";

defineOptions({ name: "TrackerLoginPage" });

const HANDOFF_WAIT_MS = 2500;

const userId = inject("$userId");
const companyId = inject("$companyId");
const route = useRoute();
const opening = ref(false);
const failed = ref(false);
const notOpened = ref(false);
let handoffTimer = null;

const stopWaiting = () => {
    clearTimeout(handoffTimer);
    handoffTimer = null;
    window.removeEventListener("blur", stopWaiting);
    document.removeEventListener("visibilitychange", onVisibilityChange);
};
const onVisibilityChange = () => {
    if (document.hidden) stopWaiting();
};
// A browser gives no signal when a custom-scheme link goes nowhere. When the OS does hand it to the
// tracker, the page blurs or hides; if neither happens, the tracker is most likely not installed.
const waitForHandoff = () => {
    stopWaiting();
    window.addEventListener("blur", stopWaiting);
    document.addEventListener("visibilitychange", onVisibilityChange);
    handoffTimer = setTimeout(() => {
        stopWaiting();
        notOpened.value = true;
    }, HANDOFF_WAIT_MS);
};
onBeforeUnmount(stopWaiting);

// The code is issued on a click, never on page load, so a page that sends a signed-in browser
// here cannot mint one on its own. Each code works once, so every attempt asks for a fresh one.
// The challenge comes from the tracker that opened this page; the server then only hands the
// session to whoever can present the matching verifier (PKCE).
const redirect = async () => {
    if (opening.value) return;
    opening.value = true;
    failed.value = false;
    notOpened.value = false;
    try {
        const codeChallenge = route?.query?.code_challenge;
        const response = await apiRequestWithoutCompnay("post", env.TRACKER_CODE, codeChallenge ? { codeChallenge } : {});
        const code = response?.data?.data?.code;
        if (!code) throw new Error("No tracker sign-in code");
        window.location.href = `myapp://authorize?client_id=${encodeURIComponent(userId.value)}&code=${encodeURIComponent(code)}`;
        waitForHandoff();
    } catch {
        failed.value = true;
    } finally {
        opening.value = false;
    }
};
</script>

<style>
@import "../authV2.css";
</style>
