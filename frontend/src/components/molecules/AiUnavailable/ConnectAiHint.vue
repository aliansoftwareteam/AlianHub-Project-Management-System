<template>
    <router-link v-if="shown" class="connect-ai-hint" :to="target" data-test="connect-ai-hint">{{ $t('ConnectAi.hint') }}</router-link>
</template>

<script setup>
import { computed, inject, unref } from "vue";
import { useRouter } from "vue-router";
import { AI_STATE, aiAvailability } from "@/composable/aiAvailability";
import { CONNECT_AI_ROUTE } from "@/router/ai/connect";

/* Beside any words that say the server has no model: the person's own AI app can do the job instead. */
defineOptions({ name: "ConnectAiHint" });

const router = useRouter();
const companyId = inject("$companyId", "");

const shown = computed(() => aiAvailability.state === AI_STATE.UNCONFIGURED && Boolean(router?.hasRoute?.(CONNECT_AI_ROUTE)));
const target = computed(() => ({ name: CONNECT_AI_ROUTE, params: { cid: unref(companyId) } }));
</script>

<style scoped>
.connect-ai-hint { color: var(--ink); font-weight: 500; text-decoration: underline; }
.connect-ai-hint:hover { color: var(--brand); }
</style>
