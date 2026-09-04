<template>
    <div v-if="maintenance" class="mt-banner" role="status">
        <span class="mt-banner__dot"></span>
        <span>{{ $t('InstanceV2.maintenance_public') }}</span>
    </div>
</template>

<script setup>
import { onMounted, onUnmounted, ref } from "vue";
import { apiRequestWithoutSecure } from "@/services";

defineOptions({ name: "MaintenanceBanner" });

/* /health keeps answering during a restore; polling it is how every open tab
 * learns the API is back without a reload. Slow while all is well, quick while
 * maintenance is on. */
const maintenance = ref(false);
let timer = null;

async function check() {
    try {
        const res = await apiRequestWithoutSecure("get", "/health");
        maintenance.value = res?.data?.maintenance === true;
    } catch (error) {
        maintenance.value = error?.response?.data?.maintenance === true || maintenance.value;
    } finally {
        timer = setTimeout(check, maintenance.value ? 5000 : 60000);
    }
}

onMounted(check);
onUnmounted(() => clearTimeout(timer));
</script>

<style scoped>
.mt-banner { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 6px 12px; background: var(--warn-bg, #fff4d6); color: var(--warn-ink, #7a5200); font: 500 13px/1.3 var(--font-ui, sans-serif); }
.mt-banner__dot { width: 8px; height: 8px; border-radius: 50%; background: var(--warn, #d98c00); animation: mt-pulse 1.2s ease-in-out infinite; }
@keyframes mt-pulse { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }
</style>
