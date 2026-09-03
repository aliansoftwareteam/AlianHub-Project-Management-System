<template>
    <div class="docs-view">
        <PagesPanel
            v-if="projectData && Object.keys(projectData || {}).length"
            :projectData="projectData"
            :openDocId="openDocId"
            embedded
        />
    </div>
</template>

<script setup>
import { computed, inject } from 'vue';
import { useRoute } from 'vue-router';
import PagesPanel from '@/components/molecules/Pages/PagesPanel.vue';

defineOptions({ name: 'DocsView' });

const route = useRoute();
const projectData = inject('selectedProject');

// ?doc=<id> lands on that doc instead of the "pick something" state.
const openDocId = computed(() => String(route.query?.doc || ''));
</script>

<style scoped>
.docs-view {
    height: 100%;
    min-height: 520px;
    padding: 0;
    background: var(--canvas);
    font-family: var(--font-ui);
}
</style>
