<template>
    <div v-if="keys" class="ai-unavailable" :class="{ 'ai-unavailable--inline': inline }">
        <section class="ah-card ai-unavailable__card" role="status" data-test="ai-unavailable">
            <span class="ai-unavailable__icon" aria-hidden="true"><ShellIcon name="ai" :size="18" /></span>
            <h2 class="ah-h2 ai-unavailable__title">{{ $t(keys.title) }}</h2>
            <p class="ai-unavailable__body">{{ $t(keys.body) }}</p>
            <router-link v-if="keys.action" class="ah-btn ah-btn--secondary ah-btn--sm ai-unavailable__action" :to="target">
                {{ $t(keys.action === 'Setting' ? 'AiAvailability.open_workspace_settings' : 'AiAvailability.open_instance_settings') }}
            </router-link>
        </section>
    </div>
</template>

<script setup>
import { computed, inject, unref } from "vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { aiAvailability, messageKeysFor } from "@/composable/aiAvailability";

defineOptions({ name: "AiUnavailable" });

defineProps({ inline: { type: Boolean, default: false } });

const companyId = inject("$companyId", "");

const keys = computed(() => messageKeysFor(aiAvailability));
const target = computed(() => ({
    name: keys.value.action,
    params: { cid: unref(companyId) },
    ...(keys.value.action === "InstanceSettings" ? { query: { group: "ai" } } : {}),
}));
</script>

<style scoped>
.ai-unavailable { display: flex; justify-content: center; padding: 48px 16px; }
.ai-unavailable--inline { padding: 0; justify-content: flex-start; }
.ai-unavailable__card { max-width: 520px; width: 100%; padding: 22px 24px 24px; }
.ai-unavailable__icon { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 8px; background: var(--surface-2, var(--canvas)); color: var(--ink-2, var(--ink)); }
.ai-unavailable__title { margin: 12px 0 0; }
.ai-unavailable__body { margin: 8px 0 0; font: var(--text-body); color: var(--ink-2, var(--ink)); }
.ai-unavailable__action { margin-top: 16px; }
</style>
