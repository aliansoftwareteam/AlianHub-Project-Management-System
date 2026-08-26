<template>
    <div v-if="items.length" class="wac">
        <div class="wac__label">{{ $t('Header.workspace_ask_sources') }}</div>
        <ul class="wac__list">
            <li v-for="item in items" :key="item.type + ':' + item.id">
                <router-link
                    v-if="item.to"
                    class="wac__chip"
                    :to="item.to"
                    :data-citation-type="item.type"
                    :data-citation-id="item.id"
                    :data-project-id="item.projectId || undefined"
                >
                    <span class="wac__kind">{{ kindLabel(item.type) }}</span>
                    <span class="wac__title">{{ item.title }}</span>
                </router-link>
                <span
                    v-else
                    class="wac__chip is-static"
                    :data-citation-type="item.type"
                    :data-citation-id="item.id"
                    :data-project-id="item.projectId || undefined"
                >
                    <span class="wac__kind">{{ kindLabel(item.type) }}</span>
                    <span class="wac__title">{{ item.title }}</span>
                </span>
            </li>
        </ul>
    </div>
</template>

<script setup>
import { computed, inject } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps({
    citations: { type: Array, default: () => [] },
});

const { t } = useI18n();
const companyId = inject('$companyId', '');

const items = computed(() => {
    const cid = (companyId && companyId.value) || (typeof companyId === 'string' ? companyId : '') || localStorage.getItem('selectedCompany') || '';
    return (props.citations || []).filter((row) => row && row.id && (row.type === 'page' || row.type === 'task')).map((row) => {
        const citation = {
            type: row.type,
            id: String(row.id),
            title: String(row.title || '').trim() || (row.type === 'task' ? t('Projects.pages_citation_task') : t('Projects.pages_citation_page')),
            projectId: row.projectId ? String(row.projectId) : '',
            to: null,
        };
        if (citation.type === 'page' && cid) {
            citation.to = { name: 'Pages', params: { cid }, query: { page: citation.id } };
        }
        return citation;
    });
});

function kindLabel(type) {
    return type === 'task' ? t('Projects.pages_citation_task') : t('Projects.pages_citation_page');
}
</script>

<style scoped>
.wac {
    margin-top: 10px;
}
.wac__label {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--kiln-muted);
    margin-bottom: 6px;
}
.wac__list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}
.wac__chip {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    max-width: 100%;
    border: 1px solid var(--kiln-line);
    background: var(--kiln-canvas);
    color: var(--kiln-ink);
    border-radius: var(--kiln-radius-sm);
    padding: 5px 9px;
    text-decoration: none;
    line-height: 1.2;
}
.wac__chip:hover {
    border-color: var(--kiln-ember);
    color: var(--kiln-ink);
}
.wac__chip.is-static:hover {
    border-color: var(--kiln-line);
}
.wac__kind {
    flex: 0 0 auto;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--kiln-ember);
}
.wac__title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--kiln-font-display);
    font-size: 13px;
    font-weight: 600;
}
</style>
