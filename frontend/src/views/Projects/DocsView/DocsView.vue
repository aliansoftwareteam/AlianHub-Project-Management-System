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

// The docs UI itself is the panel already used from a task's Linked Docs — this
// view renders the same component embedded rather than as an overlay, so there
// is one Docs implementation, not two.
import PagesPanel from '@/components/molecules/Pages/PagesPanel.vue';

const route = useRoute();
const projectData = inject('selectedProject');

// ?doc=<id> opens straight onto a document, so a link to a specific doc in this
// view lands on it instead of the "pick something" state.
const openDocId = computed(() => String(route.query?.doc || ''));
</script>

<style scoped>
.docs-view {
    height: 100%;
    min-height: 520px;
    padding: 12px 14px 16px;
}
</style>
