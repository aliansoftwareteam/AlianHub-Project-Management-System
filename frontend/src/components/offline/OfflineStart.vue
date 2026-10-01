<template>
    <AppState kind="offline" class="ah-offline-start" :body="$t('Shell.offline_start_body')" @primary="reloadPage" />
</template>

<script setup>
import { watch } from 'vue';
import AppState from '@/components/molecules/AppState/AppState.vue';
import { away } from '@/offline';
import { reloadPage } from '@/utils/reloadPage';

defineOptions({ name: 'OfflineStart' });

// Sync, because App.vue unmounts this in the same tick that `away` clears.
watch(away, (isAway) => { if (!isAway) reloadPage(); }, { flush: 'sync' });
</script>

<style scoped>
.ah-offline-start { min-height: 100dvh; }
</style>
