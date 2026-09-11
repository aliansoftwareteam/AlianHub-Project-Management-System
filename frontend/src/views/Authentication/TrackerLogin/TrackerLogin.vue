<template>
    <AuthShell :proof="false">
        <div class="av2-auth-card">
            <div class="auth__glyph auth__glyph--brand"><ShellIcon name="time" :size="15" /></div>
            <h2 class="auth__h">{{ $t('Auth.tracker_title') }}</h2>
            <p class="auth__p">{{ $t('Auth.tracker_body') }}</p>
            <p v-if="failed" class="auth__p" role="alert" data-test="tracker-code-error">{{ $t('Auth.tracker_code_failed') }}</p>
            <button type="button" class="ah-btn ah-btn--primary ah-btn--block ah-btn--lg" :disabled="opening" @click="redirect">{{ $t('Auth.tracker_continue') }}</button>
        </div>
    </AuthShell>
</template>

<script setup>
import { inject, onMounted, ref } from "vue";
import AuthShell from "@/components/templates/AuthShell/AuthShell.vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { apiRequestWithoutCompnay } from "@/services";
import * as env from "@/config/env";

defineOptions({ name: "TrackerLoginPage" });

const userId = inject("$userId");
const opening = ref(false);
const failed = ref(false);

// Each code works once, so every attempt to open the tracker asks for a fresh one.
const redirect = async () => {
    if (opening.value) return;
    opening.value = true;
    failed.value = false;
    try {
        const response = await apiRequestWithoutCompnay("post", env.TRACKER_CODE, {});
        const code = response?.data?.data?.code;
        if (!code) throw new Error("No tracker sign-in code");
        window.location.href = `myapp://authorize?client_id=${encodeURIComponent(userId.value)}&code=${encodeURIComponent(code)}`;
    } catch {
        failed.value = true;
    } finally {
        opening.value = false;
    }
};
onMounted(redirect);
</script>

<style>
@import "../authV2.css";
</style>
