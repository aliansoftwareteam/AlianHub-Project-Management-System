<template>
    <div class="ah-page ai-page">
        <AiSidebar />
        <div class="ai-page__main">
            <div class="ah-toolbar">
                <div class="ah-toolbar__title">{{ $t(title) }}</div>
            </div>

            <div class="ai-page__body ah-scroll">
                <section class="ah-card ai-soon" data-test="ai-soon">
                    <span class="ah-chip ah-chip--sm ai-soon__flag">{{ $t('Ai.soon_flag') }}</span>
                    <h2 class="ah-h2">{{ $t(title) }}</h2>
                    <p class="ai-lead ai-soon__lead">{{ $t(lead) }}</p>

                    <div class="ah-label ai-soon__label">{{ $t('Ai.soon_meanwhile') }}</div>
                    <div class="ai-soon__links">
                        <router-link v-for="link in links" :key="link.name" class="ah-btn ah-btn--secondary ah-btn--sm" :to="{ name: link.name, params: { cid: companyId } }">
                            {{ $t(link.label) }}
                        </router-link>
                    </div>
                </section>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, inject } from "vue";
import { useRoute } from "vue-router";
import AiSidebar from "./AiSidebar.vue";

defineOptions({ name: "AiSoon" });

const route = useRoute();
const companyId = inject("$companyId");

const title = computed(() => route.meta?.soonTitle || "Ai.title");
const lead = computed(() => route.meta?.soonLead || "Ai.soon_home");

const links = [
    { name: "AiAsk", label: "Parity.nav_ask" },
    { name: "AiHub", label: "Ai.agents" },
    { name: "AiSkills", label: "Ai.skills" },
    { name: "AiHealth", label: "AiHealth.nav" }
];
</script>
