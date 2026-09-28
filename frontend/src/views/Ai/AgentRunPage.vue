<template>
    <div class="ah-page ai-page">
        <AiSidebar />
        <div class="ai-page__main">
            <div class="ah-toolbar">
                <div class="ah-toolbar__title">{{ $t('Ai.run_page_title') }}</div>
                <div class="ah-toolbar__spacer"></div>
                <router-link class="ah-btn ah-btn--ghost ah-btn--sm" :to="{ name: 'AiInbox', params: { cid: route.params.cid } }">{{ $t('Ai.inbox') }}</router-link>
            </div>
            <div class="ai-page__body ah-scroll">
                <AgentRunDetail :key="runId" :run-id="runId" />
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";
import AiSidebar from "./AiSidebar.vue";
import AgentRunDetail from "./AgentRunDetail.vue";

defineOptions({ name: "AgentRunPage" });

const route = useRoute();
const runId = computed(() => String(route.params.runId || ""));
</script>

<style>
@import "./style.css";
</style>
