<template>
    <div v-if="support.active" class="hb-banner hb-banner--warn" role="status" data-test="support-banner">
        <span>{{ $t('Platform.support_until', { time: untilText }) }}</span>
        <a v-if="support.portalUrl" :href="support.portalUrl" target="_blank" rel="noopener" class="hb-banner__action">{{ $t('Platform.support_end_now') }}</a>
    </div>
    <div v-if="signedInFromAccount" class="hb-banner" role="status" data-test="platform-signin-banner">
        <span>{{ $t('Platform.signed_in_from_account') }}</span>
        <button type="button" class="hb-banner__close" :aria-label="$t('Platform.dismiss')" @click="signedInFromAccount = false">
            <ShellIcon name="x" :size="14" />
        </button>
    </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { useStore } from "vuex";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { apiRequestWithoutCompnay } from "@/services";
import * as env from "@/config/env";
import { isManagedHosting, publicConfig } from "@/config/publicConfig";
import { takePlatformSignIn } from "@/composable/platformSignIn";

defineOptions({ name: "HostedBanners" });

const SUPPORT_EVENT = "INSTANCE_SUPPORT_ACCESS_CHANGED";

const store = useStore();
const signedInFromAccount = ref(takePlatformSignIn());
const support = reactive({ active: false, expiresAt: null, portalUrl: "" });
const untilText = computed(() => (support.expiresAt ? new Date(support.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""));

let endTimer = null;
const scheduleEnd = () => {
    clearTimeout(endTimer);
    if (!support.active || !support.expiresAt) return;
    const wait = new Date(support.expiresAt).getTime() - Date.now();
    endTimer = setTimeout(() => { support.active = false; }, Math.max(0, Math.min(wait, 2 ** 31 - 1)));
};

/* Only the instance owner may read it; anyone else is refused and sees nothing. */
async function readSupportAccess() {
    if (!isManagedHosting()) return;
    try {
        const res = await apiRequestWithoutCompnay("get", env.INSTANCE_SUPPORT_ACCESS);
        const data = res?.data?.data || {};
        Object.assign(support, { active: data.active === true, expiresAt: data.expiresAt || null, portalUrl: data.portalUrl || "" });
    } catch {
        support.active = false;
    }
    scheduleEnd();
}

let listening = null;
function listenOn(socket) {
    if (listening) listening.off(SUPPORT_EVENT, readSupportAccess);
    listening = socket && typeof socket.on === "function" ? socket : null;
    if (listening) listening.on(SUPPORT_EVENT, readSupportAccess);
}
watch(() => store.getters["settings/getSocketInstance"], listenOn, { immediate: true });

onMounted(readSupportAccess);
watch(() => publicConfig.hosting?.mode, readSupportAccess);
onUnmounted(() => {
    clearTimeout(endTimer);
    listenOn(null);
});
</script>

<style scoped>
.hb-banner { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 6px 12px; background: var(--brand-tint); color: var(--ink); font: 500 13px/1.3 var(--font-ui); }
.hb-banner--warn { background: var(--warn-bg); color: var(--warn-ink); }
.hb-banner__action { color: inherit; font-weight: 600; text-decoration: underline; }
.hb-banner__close { display: inline-flex; align-items: center; justify-content: center; min-width: 24px; min-height: 24px; padding: 0; border: 0; background: transparent; color: inherit; cursor: pointer; border-radius: var(--r-sm); }
.hb-banner__close:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
</style>
