<template>
    <div class="pages-space">
        <PagesPanel workspace embedded />
    </div>
</template>

<script setup>
import PagesPanel from '@/components/molecules/Pages/PagesPanel.vue';
</script>

<style scoped>
.pages-space {
    height: 100%;
    min-height: calc(100dvh - var(--kiln-header-h, 58px));
    background: var(--kiln-paper);
}
</style>
