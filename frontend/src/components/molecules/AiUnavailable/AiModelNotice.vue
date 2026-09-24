<template>
    <p v-if="shown" class="ai-model-notice" role="status" data-test="ai-model-notice">
        <ShellIcon name="ai" :size="14" aria-hidden="true" />
        <span>{{ aiAvailability.canConfigureInstance ? $t('AiAvailability.notice_owner') : $t('AiAvailability.notice_member') }}</span>
        <router-link v-if="aiAvailability.canConfigureInstance" class="ai-model-notice__link" :to="setup">{{ $t('AiAvailability.notice_setup') }}</router-link>
    </p>
</template>

<script setup>
import { computed, inject, unref } from "vue";
import { useRoute } from "vue-router";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { aiAvailability } from "@/composable/aiAvailability";
import { AI_GATE, aiGateFor } from "@/router/ai/gate";

defineOptions({ name: "AiModelNotice" });

const route = useRoute();
const companyId = inject("$companyId", "");

const shown = computed(() => aiGateFor(route && route.name, aiAvailability.state) === AI_GATE.NOTICE);
const setup = computed(() => ({ name: "InstanceSettings", params: { cid: unref(companyId) }, query: { group: "ai" } }));
</script>

<style scoped>
.ai-model-notice { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; margin: 0; padding: 8px 24px; font: var(--text-small); color: var(--ink-2); background: var(--surface-2); border-bottom: 1px solid var(--surface-hover); }
.ai-model-notice__link { color: var(--ink); text-decoration: underline; }
</style>
