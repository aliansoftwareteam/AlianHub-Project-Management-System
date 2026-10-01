<template>
    <transition name="ah-fade">
        <div v-if="updateReady && !later" class="ah-update" role="status" data-test="update-ready">
            <span class="ah-update__text">{{ $t('Shell.update_ready') }}</span>
            <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" data-test="update-reload" @click="applyUpdate()">{{ $t('Shell.update_reload') }}</button>
            <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" data-test="update-later" @click="later = true">{{ $t('Shell.update_later') }}</button>
        </div>
    </transition>
</template>

<script setup>
import { ref } from 'vue';
import { updateReady, applyUpdate } from '@/serviceWorker/registration';

defineOptions({ name: 'UpdateReadyNotice' });

const later = ref(false);
</script>

<style scoped>
.ah-update {
    position: fixed;
    right: 16px;
    bottom: calc(16px + env(safe-area-inset-bottom, 0px));
    z-index: 9999;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    max-width: calc(100vw - 32px);
    padding: 10px 12px;
    background: var(--surface);
    color: var(--ink);
    border: 1px solid var(--border);
    border-radius: var(--r-card);
    box-shadow: var(--shadow-card);
    font-family: var(--font-ui);
    font-size: 13px;
    box-sizing: border-box;
}
.ah-update__text { margin-right: 4px; }
/* Clears the phone's tab bar, which shows below the same width in Shell/style.css. */
@media (max-width: 767px) {
    .ah-update { bottom: calc(var(--tabbar-h, 56px) + 12px + env(safe-area-inset-bottom, 0px)); }
}
</style>
