<template>
    <AuthShell :proof="false">
        <div class="av2-auth-card" data-test="suspended-notice">
            <div class="auth__glyph auth__glyph--warn" aria-hidden="true">!</div>
            <h2 class="auth__h">{{ $t('Plan.locked.suspended_title') }}</h2>
            <p class="auth__p">{{ keptUntil ? $t('Plan.locked.suspended_body', { date: keptUntil }) : $t('Plan.locked.suspended_body_nodate') }}</p>
            <p class="auth__p">{{ $t('Plan.locked.suspended_owner') }}</p>
            <a v-if="portalUrl" :href="portalUrl" target="_blank" rel="noopener" class="ah-btn ah-btn--primary ah-btn--block ah-btn--lg">{{ $t('Plan.locked.go_to_account') }}</a>
            <button v-if="!suspended" type="button" class="ah-btn ah-btn--secondary ah-btn--block ah-btn--lg" @click="router.replace({ name: 'Log-in' })">{{ $t('Plan.locked.back_to_login') }}</button>
        </div>
    </AuthShell>
</template>

<script setup>
import { computed } from "vue";
import { useRouter } from "vue-router";
import AuthShell from "@/components/templates/AuthShell/AuthShell.vue";
import { publicConfig } from "@/config/publicConfig";

defineOptions({ name: "SuspendedPage" });

const router = useRouter();

const suspended = computed(() => !publicConfig.loaded || publicConfig.hosting?.lifecycle === "suspended");
const portalUrl = computed(() => publicConfig.hosting?.portalUrl || "");
const keptUntil = computed(() => {
    const at = publicConfig.hosting?.graceUntil ? new Date(publicConfig.hosting.graceUntil) : null;
    return at && Number.isFinite(at.getTime()) ? at.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }) : "";
});
</script>

<style>
@import "../authV2.css";
</style>
