<template>
    <div class="pages-space">
        <div v-if="kind === 'forbidden' || kind === 'missing'" class="pages-space__missing">
            <div class="pages-space__card">
                <p class="pages-space__line pages-space__line--pine">{{ errorLine }}</p>
                <button type="button" class="pages-space__back" @click="backToPages">{{ $t('Projects.page_back_to_pages') }}</button>
            </div>
        </div>
        <template v-else>
            <p v-if="kind === 'opening'" class="pages-space__opening pages-space__line pages-space__line--pine">{{ openingLine }}</p>
            <PagesPanel
                workspace
                embedded
                :project-data="boundProject"
            />
        </template>
    </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useStore } from 'vuex';
import { useI18n } from 'vue-i18n';
import PagesPanel from '@/components/molecules/Pages/PagesPanel.vue';
import { apiRequest } from '@/services';
import { firstId, pageFromGetResponse, pageOpeningLine, pageOpenRoute, pageProjectId } from '@/utils/taskOpenProjectId';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const { getters } = useStore();

const kind = ref('ready');
const missingProjectName = ref('');
const openingTitle = ref('');
let hydrateGen = 0;

const pageId = computed(() => firstId(route.query && route.query.page));
const projectId = computed(() => firstId(route.params && route.params.projectId));
const companyId = computed(() => firstId(route.params && route.params.cid));

const boundProject = computed(() => {
    const pid = projectId.value;
    if (!pid) return {};
    const hit = projectRow(pid);
    return hit || { _id: pid };
});

const openingLine = computed(() => pageOpeningLine(openingTitle.value));

const errorLine = computed(() => {
    if (kind.value === 'forbidden') return t('Projects.page_no_access');
    return t('Projects.page_not_in_named_project', {
        project: missingProjectName.value || t('Projects.pages_project_none'),
    });
});

function projectRow(id) {
    const pid = firstId(id);
    const raw = getters['projectData/projects'];
    const list = raw && Array.isArray(raw.data) ? raw.data : [];
    return list.find((row) => firstId(row && row._id) === pid) || null;
}

function projectNameOf(id) {
    const hit = projectRow(id);
    return (hit && (hit.ProjectName || hit.ProjectCode)) || '';
}

function backToPages() {
    const cid = companyId.value;
    if (!cid) return;
    router.replace({ name: 'Pages', params: { cid } });
}

async function fetchPageRow(id, cid) {
    const headers = { headers: { companyId: cid } };
    try {
        const response = await apiRequest('get', `/api/v2/pages/${id}`, null, null, headers);
        const page = pageFromGetResponse(response);
        if (page) return { page, forbidden: false };
        const listed = await fetchPageFromList(id, cid);
        if (listed) return { page: listed, forbidden: false };
        if (response && response.data && response.data.status === false) {
            return { page: null, forbidden: true };
        }
    } catch (_error) {
        const listed = await fetchPageFromList(id, cid);
        if (listed) return { page: listed, forbidden: false };
        return { page: null, forbidden: false, network: true };
    }
    return { page: null, forbidden: false, network: true };
}

async function fetchPageFromList(id, cid) {
    try {
        const response = await apiRequest('get', '/api/v2/pages?scope=all', null, null, { headers: { companyId: cid } });
        const rows = response && response.data && response.data.status ? (response.data.data || []) : [];
        return rows.find((row) => firstId(row && (row._id || row.id)) === id) || null;
    } catch (_error) {
        return null;
    }
}

async function hydrate() {
    const gen = ++hydrateGen;
    const id = pageId.value;
    const pid = projectId.value;
    const cid = companyId.value;
    if (!id) {
        kind.value = 'ready';
        openingTitle.value = '';
        return;
    }
    kind.value = 'opening';
    const found = await fetchPageRow(id, cid);
    if (gen !== hydrateGen) return;
    if (found.forbidden) {
        kind.value = 'forbidden';
        return;
    }
    if (!found.page) {
        if (found.network) {
            kind.value = 'ready';
            return;
        }
        if (pid) {
            missingProjectName.value = projectNameOf(pid) || t('Projects.pages_project_none');
            kind.value = 'missing';
            return;
        }
        kind.value = 'forbidden';
        return;
    }
    openingTitle.value = (found.page && found.page.title) || '';
    const bound = pageProjectId(found.page);
    if (pid) {
        if (bound && bound !== pid) {
            missingProjectName.value = projectNameOf(pid) || projectNameOf(bound);
            kind.value = 'missing';
            return;
        }
        kind.value = 'ready';
        return;
    }
    if (bound) {
        const dest = pageOpenRoute({ companyId: cid, projectId: bound, pageId: id });
        if (dest) {
            router.replace(dest);
            return;
        }
    }
    kind.value = 'ready';
}

onMounted(hydrate);
watch([pageId, projectId, companyId], hydrate);
</script>

<style scoped>
.pages-space {
    height: 100%;
    min-height: calc(100dvh - var(--kiln-header-h, 58px));
    background: var(--kiln-paper, #f4ead8);
}
.pages-space__opening {
    margin: 0;
    padding: 10px 16px 0;
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
    border-left: 3px solid var(--kiln-ink, #1b2f28);
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
.pages-space__line--pine {
    color: var(--kiln-ink, #1b2f28);
}
.pages-space__back {
    margin-top: 14px;
    min-height: 32px;
    padding: 6px 14px;
    border: 1px solid var(--kiln-line, #d8cbb3);
    border-radius: var(--kiln-radius-sm, 9px);
    background: var(--kiln-ink, #1b2f28);
    color: var(--kiln-paper, #f4ead8);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    cursor: pointer;
}
.pages-space__back:active {
    background: var(--kiln-ink, #1b2f28);
    color: var(--kiln-paper, #f4ead8);
}
</style>
