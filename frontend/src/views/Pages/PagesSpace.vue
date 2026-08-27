<template>
    <div class="pages-space">
        <div v-if="blocked" class="pages-space__missing">
            <div class="pages-space__card">
                <p class="pages-space__line">{{ $t('Projects.page_not_in_project') }}</p>
            </div>
        </div>
        <PagesPanel v-else-if="ready" workspace embedded />
    </div>
</template>

<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import PagesPanel from '@/components/molecules/Pages/PagesPanel.vue';
import { firstId } from '@/utils/taskOpenProjectId';

const route = useRoute();
const blocked = computed(() => String((route.query && route.query.unresolved) || '') === '1');
const ready = computed(() => {
    if (blocked.value) return false;
    const pageId = firstId(route.query && route.query.page);
    const projectId = firstId(route.params && route.params.projectId);
    if (pageId && !projectId) return false;
    return true;
});
</script>

<style scoped>
.pages-space {
    height: 100%;
    min-height: calc(100dvh - var(--kiln-header-h, 58px));
    background: var(--kiln-paper);
}
.pages-space__missing {
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 18vh;
}
.pages-space__card {
    background: var(--kiln-canvas, #fbf6ec);
    border: 1px solid var(--kiln-line, #d8cbb3);
    border-left: 3px solid var(--kiln-ember, #c45c26);
    border-radius: var(--kiln-radius-sm, 9px);
    padding: 16px 18px;
    min-width: 280px;
    max-width: min(420px, 90vw);
    color: var(--kiln-ink, #1b2f28);
    box-shadow: var(--kiln-shadow, 0 18px 40px rgba(27, 47, 40, 0.12));
}
.pages-space__line {
    margin: 0;
    font-family: var(--kiln-font-display), Georgia, serif;
    font-size: 15px;
    font-weight: 600;
    color: var(--kiln-ink, #1b2f28);
}
</style>
