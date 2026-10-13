<template>
    <div class="ah-page ai-page">
        <AiSidebar />
        <div class="ai-page__main">
            <AiUnavailable />
        </div>
    </div>
</template>

<script setup>
import AiUnavailable from "@/components/molecules/AiUnavailable/AiUnavailable.vue";
import AiSidebar from "./AiSidebar.vue";

// The AI rail tile lands on Ask; keeping the sidebar beside the AI-off notice keeps the
// configuration screens one click away while the switch is off.
defineOptions({ name: "AiOffPage" });
</script>

<style>
@import "./style.css";
</style>
