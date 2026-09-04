<template>
    <AuthShell :proof="false">
        <div class="av2-auth-card">
            <div class="auth__glyph auth__glyph--brand"><ShellIcon name="time" :size="15" /></div>
            <h2 class="auth__h">{{ $t('Auth.tracker_title') }}</h2>
            <p class="auth__p">{{ $t('Auth.tracker_body') }}</p>
            <button type="button" class="ah-btn ah-btn--primary ah-btn--block ah-btn--lg" @click="redirect">{{ $t('Auth.tracker_continue') }}</button>
        </div>
    </AuthShell>
</template>

<script setup>
import { inject, onMounted } from "vue";

defineOptions({ name: "TrackerLoginPage" });
import Cookies from "js-cookie";
import AuthShell from "@/components/templates/AuthShell/AuthShell.vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";

const userId = inject("$userId");
const refreshToken = Cookies.get("refreshToken") || "";

const redirect = () => {
    window.location.href = `myapp://authorize?client_id=${userId.value}&client_secret=${refreshToken}`;
};
onMounted(redirect);
</script>

<style>
@import "../authV2.css";
</style>
