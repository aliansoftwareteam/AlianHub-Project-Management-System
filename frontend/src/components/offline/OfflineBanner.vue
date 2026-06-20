<template>
    <transition name="offline-fade">
        <div v-if="show" class="offline-banner" :class="!isOnline ? 'is-offline' : 'is-sync'">
            <span v-if="!isOnline">{{ $t('Offline.offline_msg') }}</span>
            <span v-else-if="syncing">{{ $t('Offline.syncing', { n: pendingCount }) }}</span>
            <span v-else-if="pendingCount > 0">{{ $t('Offline.pending', { n: pendingCount }) }}</span>
        </div>
    </transition>
</template>

<script setup>
import { computed } from 'vue';
import { isOnline, pendingCount, syncing } from '@/offline';

// SEC-06 — thin status strip. Shows when offline, while syncing queued writes,
// or while writes remain pending. Hidden entirely when online + nothing queued,
// so it never intrudes on normal use.
const show = computed(() => !isOnline.value || syncing.value || pendingCount.value > 0);
</script>

<style scoped>
.offline-banner {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 99999;
    text-align: center;
    font-size: 12.5px;
    font-weight: 600;
    padding: 5px 12px;
    color: #fff;
    box-shadow: 0 1px 4px rgba(0, 0, 0, .15);
}
.offline-banner.is-offline { background: #b45309; }
.offline-banner.is-sync { background: #2f3a8f; }
.offline-fade-enter-active, .offline-fade-leave-active { transition: opacity .25s ease, transform .25s ease; }
.offline-fade-enter-from, .offline-fade-leave-to { opacity: 0; transform: translateY(-100%); }
</style>
