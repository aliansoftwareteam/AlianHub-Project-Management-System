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
import { ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import PagesPanel from '@/components/molecules/Pages/PagesPanel.vue';
import { apiRequest } from '@/services';
import { firstId, pageOpenRoute } from '@/utils/taskOpenProjectId';

const route = useRoute();
const router = useRouter();
const ready = ref(false);
const blocked = ref(false);
let bindGen = 0;

async function bindRoute() {
    const gen = ++bindGen;
    const cid = firstId(route.params && route.params.cid);
    const paramPid = firstId(route.params && route.params.projectId);
    const pageId = firstId(route.query && route.query.page);
    const queryPid = firstId(route.query && (route.query.project || route.query.projectId));
    const knownPid = firstId(paramPid, queryPid);

    blocked.value = false;

    if (pageId && !paramPid) {
        ready.value = false;
        let resolved = knownPid;
        if (!resolved) {
            try {
                const response = await apiRequest('get', `/api/v2/pages/${pageId}`);
                if (gen !== bindGen) return;
                const page = response && response.data && response.data.status ? response.data.data : null;
                resolved = firstId(page && (page.ProjectID || page.projectId));
            } catch (error) {
                console.error('ERROR resolving page project: ', error);
                if (gen !== bindGen) return;
                blocked.value = true;
                return;
            }
        }
        const dest = pageOpenRoute({ companyId: cid, projectId: resolved, pageId });
        if (!dest) {
            blocked.value = true;
            return;
        }
        await router.replace(dest).catch(() => {});
        if (gen !== bindGen) return;
        ready.value = true;
        return;
    }

    ready.value = true;
}

watch(() => [route.name, route.params.projectId, route.query.page, route.query.project, route.query.projectId], bindRoute, { immediate: true });
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
