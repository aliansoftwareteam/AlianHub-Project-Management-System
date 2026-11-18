<template>
    <AppState kind="offline" class="ah-offline-start" :body="$t('Shell.offline_start_body')" @primary="reloadPage" />
</template>

<script setup>
import { onMounted, onUnmounted } from 'vue';
import AppState from '@/components/molecules/AppState/AppState.vue';
import { apiRequestWithoutSecure } from '@/services';
import * as env from '@/config/env';
import { RETRY_EVERY_MS } from '@/offline/offlineRules';
import { reloadPage } from '@/utils/reloadPage';

defineOptions({ name: 'OfflineStart' });

/* The page reloads itself only after the server has answered. Reloading on the browser's "online"
 * alone, or whenever the offline state clears, would reload over and over while the server is down. */
const reloadOnceServerAnswers = () => {
    if (navigator.onLine === false) return;
    apiRequestWithoutSecure('get', env.APP_VERSION).then(reloadPage).catch(() => {});
};

let timer = null;
onMounted(() => {
    window.addEventListener('online', reloadOnceServerAnswers);
    timer = window.setInterval(reloadOnceServerAnswers, RETRY_EVERY_MS);
});
onUnmounted(() => {
    window.removeEventListener('online', reloadOnceServerAnswers);
    window.clearInterval(timer);
});
</script>

<style scoped>
.ah-offline-start { min-height: 100dvh; }
</style>
