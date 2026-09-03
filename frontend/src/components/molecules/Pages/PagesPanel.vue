<template>
    <div v-if="isOpen" class="pg" :class="{ 'pg--embedded': embedded || workspace }" @click.self="embedded || workspace ? null : requestClose()">
        <div class="pg__shell">
            <aside class="pg__side">
                <div class="pg__side-head">
                    <span class="pg__side-title">{{ $t('DocsV2.pages') }}</span>
                    <button type="button" class="pg__icon" :title="$t('Projects.add_page')" @click="createPage(null)">
                        <ShellIcon name="plus" :size="15" />
                    </button>
                </div>
                <div class="pg__search">
                    <ShellIcon name="search" :size="14" class="pg__search-icon" />
                    <input v-model="query" type="search" class="ah-input pg__search-input" :placeholder="$t('DocsV2.find_a_page')" />
                </div>
                <div class="pg__tree ah-scroll">
                    <div v-if="!rows.length" class="pg__empty">
                        {{ query ? $t('Projects.no_pages_match') : $t('Projects.no_pages') }}
                    </div>
                    <div
                        v-for="row in rows"
                        :key="'pg-' + row._id"
                        class="pg__row"
                        :class="{ 'is-active': currentId === String(row._id) }"
                        :style="{ paddingLeft: (8 + row.depth * 14) + 'px' }"
                        @click="openPage(row._id)"
                    >
                        <span
                            class="pg__twisty"
                            :class="{ 'is-open': expanded.has(String(row._id)), 'is-leaf': !row.hasChildren }"
                            @click.stop="row.hasChildren && toggle(row._id)"
                        ><ShellIcon v-if="row.hasChildren" name="chevron" :size="11" /></span>
                        <ShellIcon :name="row.isWiki ? 'book' : 'file'" :size="13" class="pg__row-icon" />
                        <span class="pg__row-title" :title="row.title">{{ row.title || $t('DocsV2.untitled') }}</span>
                        <span v-if="row.isWiki && (row.reviewState === 'due' || row.reviewState === 'stale')" class="ah-dot" :class="row.reviewState === 'stale' ? 'ah-dot--danger' : 'ah-dot--warn'"></span>
                        <button type="button" class="pg__row-add" :title="$t('DocsV2.add_nested_page')" @click.stop="createPage(row._id)">
                            <ShellIcon name="plus" :size="12" />
                        </button>
                    </div>
                </div>
            </aside>

            <section class="pg__main">
                <PageDocument
                    v-if="currentId"
                    ref="doc"
                    :page-id="currentId"
                    :project-data="projectData"
                    layout="panel"
                    :closable="!embedded && !workspace"
                    @saved="fetchPages"
                    @deleted="onDeleted"
                    @dirty="isDirty = $event"
                    @close="requestClose"
                />
                <div v-else class="pg__blank">
                    <button v-if="!embedded && !workspace" type="button" class="pg__icon pg__blank-close" :title="$t('DocsV2.close')" @click="requestClose">
                        <ShellIcon name="x" :size="15" />
                    </button>
                    <ShellIcon name="docs" :size="40" class="pg__blank-icon" />
                    <p class="ah-h2 pg__blank-text">{{ $t('Projects.select_page') }}</p>
                    <p class="ah-small pg__blank-hint">{{ $t('Projects.pages_blank_hint') }}</p>
                    <button type="button" class="ah-btn ah-btn--primary" @click="createPage(null)">{{ $t('Projects.add_page') }}</button>
                </div>
            </section>
        </div>
    </div>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import { useToast } from "vue-toast-notification";
import { useI18n } from "vue-i18n";
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';
import PageDocument from "@/components/molecules/Pages/PageDocument.vue";
import { apiRequest } from '@/services';
import * as env from '@/config/env';

defineOptions({ name: 'PagesPanel' });

const { t } = useI18n();
const $toast = useToast();

const props = defineProps({
    projectData: { type: Object, default: () => ({}) },
    modelValue: { type: Boolean, default: false },
    openDocId: { type: String, default: '' },
    embedded: { type: Boolean, default: false },
    workspace: { type: Boolean, default: false },
});

const emit = defineEmits(['update:modelValue']);

const pages = ref([]);
const currentId = ref('');
const isDirty = ref(false);
const doc = ref(null);
const query = ref('');
const expanded = ref(new Set());

const projectId = computed(() => String((props.projectData && props.projectData._id) || ''));
const isOpen = computed(() => props.embedded || props.workspace || props.modelValue);

/* The tree flattened to rows with a depth. A page whose parent is missing is treated
 * as a root so it never becomes unreachable. */
const rows = computed(() => {
    const list = pages.value || [];
    const term = query.value.trim().toLowerCase();
    if (term) {
        return list
            .filter((p) => String(p.title || '').toLowerCase().includes(term))
            .map((p) => ({ ...p, depth: 0, hasChildren: false }));
    }
    const ids = new Set(list.map((p) => String(p._id)));
    const parentOf = (p) => {
        const parent = p.parentPageId ? String(p.parentPageId) : '';
        return parent && ids.has(parent) ? parent : '';
    };
    const byParent = new Map();
    list.forEach((p) => {
        const key = parentOf(p);
        if (!byParent.has(key)) byParent.set(key, []);
        byParent.get(key).push(p);
    });
    const out = [];
    const walk = (parentKey, depth) => {
        (byParent.get(parentKey) || []).forEach((p) => {
            const id = String(p._id);
            out.push({ ...p, depth, hasChildren: byParent.has(id) });
            if (expanded.value.has(id)) walk(id, depth + 1);
        });
    };
    walk('', 0);
    return out;
});

const toggle = (id) => {
    const key = String(id);
    const next = new Set(expanded.value);
    if (next.has(key)) next.delete(key); else next.add(key);
    expanded.value = next;
};

watch(isOpen, (open) => {
    if (open) {
        fetchPages();
        // A doc opened from a task may live in another project; open it by id regardless.
        if (props.openDocId) openPage(props.openDocId);
    }
}, { immediate: true });

watch(() => props.openDocId, (id) => {
    if (id && isOpen.value) openPage(id);
});

watch(projectId, (id, previous) => {
    if (props.workspace || !id || !previous || id === previous) return;
    if (isDirty.value) $toast.warning(t('Projects.page_unsaved_lost_on_switch'), { position: 'top-right' });
    currentId.value = '';
    pages.value = [];
    expanded.value = new Set();
    query.value = '';
    if (isOpen.value) fetchPages();
});

function fetchPages() {
    const queryString = projectId.value ? `?projectId=${projectId.value}` : '?scope=all';
    apiRequest('get', `${env.PAGES}${queryString}`)
        .then((response) => {
            pages.value = response.data?.status ? (response.data.data || []) : [];
            if (!expanded.value.size) {
                expanded.value = new Set(pages.value.filter((p) => p.parentPageId).map((p) => String(p.parentPageId)));
            }
            // As a view, landing on "pick a doc" reads as an empty project, so start on the first one.
            if (props.embedded && !currentId.value && !props.openDocId && rows.value.length) {
                currentId.value = String(rows.value[0]._id);
            }
        })
        .catch((error) => console.error('ERROR in fetch pages: ', error));
}

function confirmDiscard() {
    return !doc.value || doc.value.confirmDiscard();
}

function openPage(id) {
    if (currentId.value === String(id)) return;
    if (!confirmDiscard()) return;
    currentId.value = String(id);
}

function createPage(parentPageId) {
    if (!confirmDiscard()) return;
    apiRequest('post', env.PAGES, {
        title: t('DocsV2.untitled'),
        ...(projectId.value ? { projectId: projectId.value } : {}),
        ...(parentPageId ? { parentPageId: String(parentPageId) } : {}),
    }).then((response) => {
        if (response.data?.status) {
            if (parentPageId) {
                const next = new Set(expanded.value);
                next.add(String(parentPageId));
                expanded.value = next;
            }
            fetchPages();
            currentId.value = String(response.data.data._id);
        } else {
            $toast.error(response.data?.statusText || t('Toast.something_went_wrong'), { position: 'top-right' });
        }
    }).catch((error) => console.error('ERROR in create page: ', error));
}

function onDeleted() {
    currentId.value = '';
    isDirty.value = false;
    fetchPages();
}

function requestClose() {
    if (!confirmDiscard()) return;
    emit('update:modelValue', false);
}
</script>

<style scoped>
.pg {
    position: fixed; inset: 0; z-index: 1000;
    background: rgba(0, 0, 0, .35);
    display: flex; align-items: center; justify-content: center;
    font-family: var(--font-ui);
}
.pg__shell {
    background: var(--surface);
    border-radius: var(--r-modal);
    width: min(1240px, 96vw);
    height: min(860px, 92vh);
    display: flex; overflow: hidden;
    box-shadow: var(--shadow-modal);
}
.pg--embedded {
    position: static; inset: auto; background: transparent; z-index: auto; display: block; height: 100%;
}
.pg--embedded .pg__shell {
    width: 100%; height: 100%; min-height: 520px;
    border-radius: var(--r-card); box-shadow: var(--shadow-card);
    border: 1px solid var(--hairline);
}

.pg__side {
    width: var(--sidebar-w); flex: 0 0 var(--sidebar-w);
    border-right: 1px solid var(--hairline);
    background: var(--surface);
    display: flex; flex-direction: column; min-height: 0;
    padding: 14px 10px;
    gap: 10px;
}
.pg__side-head { display: flex; align-items: center; justify-content: space-between; padding: 0 6px; }
.pg__side-title { font: 600 13.5px var(--font-ui); color: var(--ink); }
.pg__icon {
    width: 28px; height: 28px; border-radius: 7px; border: 0; background: transparent; padding: 0;
    color: var(--ink-2); display: inline-flex; align-items: center; justify-content: center; cursor: pointer;
}
.pg__icon:hover { background: var(--surface-hover); color: var(--ink); }
.pg__search { position: relative; }
.pg__search-icon { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: var(--ink-3); pointer-events: none; }
.pg__search-input { height: 32px; padding-left: 30px; font-size: 12.5px; }
.pg__tree { flex: 1 1 auto; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 1px; }
.pg__empty { color: var(--ink-2); font-size: 12.5px; padding: 12px 8px; }
.pg__row {
    display: flex; align-items: center; gap: 6px;
    min-height: 32px; padding-right: 6px; border-radius: 7px; cursor: pointer;
    color: var(--ink); font-size: 13px;
    transition: background var(--t-state) var(--ease);
}
.pg__row:hover { background: var(--surface-hover); }
.pg__row.is-active { background: var(--brand-tint); color: var(--brand); font-weight: 600; }
.pg__twisty { flex: 0 0 14px; width: 14px; height: 14px; display: inline-flex; align-items: center; justify-content: center; color: var(--ink-3); transition: transform var(--t-state) var(--ease); }
.pg__twisty.is-open { transform: rotate(90deg); }
.pg__twisty.is-leaf { cursor: default; }
.pg__row-icon { flex: none; color: var(--ink-3); }
.pg__row.is-active .pg__row-icon { color: var(--brand); }
.pg__row-title { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pg__row-add { flex: 0 0 auto; width: 20px; height: 20px; border: 0; background: none; padding: 0; color: var(--ink-2); border-radius: 4px; cursor: pointer; opacity: 0; display: inline-flex; align-items: center; justify-content: center; }
.pg__row:hover .pg__row-add { opacity: 1; }
.pg__row-add:hover { background: var(--surface-hover); color: var(--brand); }

.pg__main { flex: 1 1 auto; min-width: 0; min-height: 0; display: flex; flex-direction: column; position: relative; }
.pg__blank { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; position: relative; padding: 24px; text-align: center; }
.pg__blank-close { position: absolute; top: 14px; right: 16px; }
.pg__blank-icon { color: var(--ink-3); }
.pg__blank-text { margin: 0; }
.pg__blank-hint { margin: 0 0 6px; max-width: 360px; }

@media (max-width: 1279px) {
    .pg__side { width: var(--sidebar-w-narrow); flex-basis: var(--sidebar-w-narrow); }
}
@media (max-width: 767px) {
    .pg__side { display: none; }
    .pg__shell { width: 100vw; height: 100vh; border-radius: 0; }
}
</style>
