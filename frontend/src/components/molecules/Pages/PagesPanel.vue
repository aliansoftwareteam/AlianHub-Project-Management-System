<template>
    <div v-if="isOpen" class="pg" :class="{ 'pg--embedded': embedded, 'pg--workspace': workspace }" @click.self="embedded || workspace ? null : requestClose()">
        <div class="pg__shell">
            <!-- ─── Sidebar: the page tree ─────────────────────────────── -->
            <aside class="pg__side">
                <div class="pg__side-head">
                    <span v-if="workspace" class="pg__side-kicker">{{ $t('Projects.pages_space_kicker') }}</span>
                    <span class="pg__side-title">{{ $t('Projects.pages') }}</span>
                    <button type="button" class="pg__icon-btn" :title="$t('Projects.add_page')" @click="createPage(null)">
                        <span v-html="ICONS.plus"></span>
                    </button>
                </div>
                <div v-if="workspace" class="pg__picker-wrap">
                    <label class="pg__picker-label">{{ $t('Projects.pages_project_picker') }}</label>
                    <select v-model="workspaceProjectId" class="pg__picker">
                        <option value="">{{ $t('Projects.pages_project_none') }}</option>
                        <option v-for="project in pickerProjects" :key="project._id" :value="String(project._id)">
                            {{ project.ProjectName || project.ProjectCode || project._id }}
                        </option>
                    </select>
                </div>

                <div class="pg__search-wrap">
                    <span class="pg__search-icon" v-html="ICONS.search"></span>
                    <input v-model="query" type="search" class="pg__search" :placeholder="$t('Projects.search_pages')" />
                </div>

                <div class="pg__tree">
                    <div v-if="!rows.length" class="pg__empty">
                        {{ query ? $t('Projects.no_pages_match') : $t('Projects.no_pages') }}
                    </div>
                    <!-- Flattened rather than a recursive component: depth is just an
                         indent, and one list keeps keyboard order and scrolling simple. -->
                    <div
                        v-for="row in rows"
                        :key="'pg-' + row._id"
                        class="pg__row"
                        :class="{ 'is-active': current && String(current._id) === String(row._id) }"
                        :style="{ paddingLeft: (10 + row.depth * 14) + 'px' }"
                        @click="openPage(row._id)"
                    >
                        <!-- The twisty occupies its slot even with no children, so titles
                             line up instead of stepping in and out by a few pixels. -->
                        <span
                            class="pg__twisty"
                            :class="{ 'is-open': expanded.has(String(row._id)), 'is-leaf': !row.hasChildren }"
                            @click.stop="row.hasChildren && toggle(row._id)"
                            v-html="row.hasChildren ? ICONS.caret : ''"
                        ></span>
                        <span class="pg__row-title" :title="row.title">{{ row.title || $t('Projects.untitled_page') }}</span>
                        <button
                            type="button"
                            class="pg__row-add"
                            :title="$t('Projects.add_sub_page')"
                            @click.stop="createPage(row._id)"
                        ><span v-html="ICONS.plus"></span></button>
                    </div>
                </div>
            </aside>

            <!-- ─── Main: the document ─────────────────────────────────── -->
            <section class="pg__main">
                <template v-if="current">
                    <div class="pg__head">
                        <input
                            v-model="draftTitle"
                            type="text"
                            class="pg__title"
                            :placeholder="$t('Projects.untitled_page')"
                        />
                        <div class="pg__actions">
                            <div class="pg__seg">
                                <button type="button" class="pg__seg-btn" :class="{ 'is-on': mode === 'edit' }" @click="openEditor">{{ $t('Projects.edit') }}</button>
                                <button type="button" class="pg__seg-btn" :class="{ 'is-on': mode === 'preview' }" @click="openPreview">{{ $t('Projects.preview') }}</button>
                            </div>

                            <!-- Linking is what stops a doc being a note nobody finds: a
                                 linked doc surfaces on the task itself. -->
                            <button v-if="taskProjectId" type="button" class="pg__btn" @click="openTurnIntoTasks">
                                {{ $t('Projects.pages_turn_into_tasks') }}
                            </button>

                            <button v-if="projectId" type="button" class="pg__btn" @click="showLinker = !showLinker">
                                {{ $t('Projects.doc_link_tasks') }}<span v-if="linkedTasks.length" class="pg__count">{{ linkedTasks.length }}</span>
                            </button>

                            <button
                                type="button"
                                class="pg__btn"
                                :class="{ 'is-private': isPrivate }"
                                :title="isPrivate ? $t('Projects.doc_private_hint') : $t('Projects.doc_shared_hint')"
                                @click="openShare"
                            >
                                <span v-html="isPrivate ? ICONS.lock : ICONS.people"></span>
                                {{ isPrivate ? $t('Projects.doc_private') : $t('Projects.doc_shared') }}
                            </button>

                            <button type="button" class="pg__btn pg__btn--primary" :disabled="!isDirty || isSaving" @click="savePage">
                                {{ isSaving ? $t('Projects.page_saving') : $t('Projects.save_page') }}
                            </button>
                            <button type="button" class="pg__icon-btn pg__icon-btn--danger" :title="$t('Projects.delete')" @click="deletePage">
                                <span v-html="ICONS.trash"></span>
                            </button>
                            <button v-if="!embedded && !workspace" type="button" class="pg__icon-btn" :title="$t('Projects.close')" @click="requestClose">
                                <span v-html="ICONS.close"></span>
                            </button>
                        </div>
                    </div>

                    <!-- One quiet line carrying the two things a writer wants to know:
                         is my work safe, and who touched this last. -->
                    <div class="pg__meta">
                        <span v-if="isDirty" class="pg__dot pg__dot--dirty"></span>
                        <span v-else class="pg__dot"></span>
                        <span>{{ isDirty ? $t('Projects.page_unsaved') : $t('Projects.page_saved') }}</span>
                        <span v-if="current.updatedAt" class="pg__meta-sep">·</span>
                        <span v-if="current.updatedAt">
                            {{ $t('Projects.page_edited_by', { who: nameOf(current.updatedBy), when: formatStamp(current.updatedAt) }) }}
                        </span>
                    </div>

                    <!-- The same picker, used to attach rather than to insert text. -->
                    <TaskChipPicker
                        v-if="showLinker && projectId"
                        :project-id="projectId"
                        @pick="linkTask"
                        @close="showLinker = false"
                    />

                    <div v-if="linkedTasks.length" class="pg__links">
                        <span class="pg__links-label">{{ $t('Projects.doc_linked_tasks') }}</span>
                        <span v-for="task in linkedTasks" :key="'lt-' + task.id" class="pg__link">
                            {{ task.key || task.id.slice(-6) }}
                            <button type="button" class="pg__link-x" :title="$t('Projects.doc_unlink')" @click="unlinkTask(task.id)">✕</button>
                        </span>
                    </div>

                    <!-- The editor is seeded, not two-way bound. vue3-editor watches its
                         modelValue and writes it straight into Quill's DOM whenever it
                         differs from what Quill currently holds — and it always differs,
                         because Quill reports an empty body as '' but renders it as
                         <p><br></p>. Feeding our value back in therefore rewrote the
                         document under the cursor, which is the flicker. Seed it once per
                         doc and only listen after that. -->
                    <div class="pg__doc">
                        <PageBlockEditor
                            v-if="mode === 'edit'"
                            :key="editorKey"
                            ref="blockEditor"
                            :seed="editorSeed"
                            :editor-key="editorKey"
                            @change="onBlockChange"
                            @ready="onEditorReady"
                        />
                        <div v-else class="pg__preview ql-editor" v-html="previewHtml"></div>
                    </div>
                    <PageComposeRail
                        v-if="mode === 'edit'"
                        :page-id="current._id ? String(current._id) : ''"
                        :title="draftTitle"
                        :current-text="rawDraft"
                        :project-id="taskProjectId"
                        @apply="onComposeApply"
                        @turn-into-tasks="openTurnIntoTasks"
                    />
                    <!-- Share. Two separate questions, so they are asked separately: who
                         inside the company can open the doc, and whether it also has a link
                         that needs no login at all. -->
                    <div v-if="showShare" class="pg__share-back" @click.self="showShare = false">
                    <div class="pg__share">
                        <div class="pg__share-head">
                            <h3 class="pg__share-title">{{ $t('Projects.doc_share_title') }}</h3>
                            <button type="button" class="pg__icon-btn" :title="$t('Projects.close')" @click="showShare = false">
                                <span v-html="ICONS.close"></span>
                            </button>
                        </div>
                        <p class="pg__share-sub">
                            <span v-html="ICONS.doc"></span>
                            <b>{{ draftTitle || $t('Projects.untitled_page') }}</b>
                        </p>

                        <div class="pg__share-row">
                            <span class="pg__share-ico" v-html="isPrivate ? ICONS.lock : ICONS.people"></span>
                            <div class="pg__share-copy">
                                <div class="pg__share-label">{{ isPrivate ? $t('Projects.doc_private') : $t('Projects.doc_shared') }}</div>
                                <div class="pg__share-hint">{{ isPrivate ? $t('Projects.doc_private_hint') : $t('Projects.doc_shared_hint') }}</div>
                            </div>
                            <button type="button" class="pg__switch" :class="{ 'is-on': !isPrivate }" @click="togglePrivate"><i></i></button>
                        </div>

                        <div class="pg__share-row">
                            <span class="pg__share-ico" v-html="ICONS.globe"></span>
                            <div class="pg__share-copy">
                                <div class="pg__share-label">{{ $t('Projects.doc_public_link') }}</div>
                                <div class="pg__share-hint">
                                    {{ isPrivate ? $t('Projects.doc_public_needs_shared') : $t('Projects.doc_public_link_hint') }}
                                </div>
                            </div>
                            <button
                                type="button"
                                class="pg__switch"
                                :class="{ 'is-on': isPublic }"
                                :disabled="isPrivate || isSharing"
                                @click="togglePublicLink"
                            ><i></i></button>
                        </div>

                        <template v-if="isPublic">
                            <input class="pg__share-url" type="text" readonly :value="shareUrl" @focus="$event.target.select()" />
                            <button type="button" class="pg__btn pg__btn--primary pg__share-copy-btn" @click="copyShareLink">
                                {{ $t('Projects.doc_copy_public_link') }}
                            </button>
                        </template>
                        </div>
                    </div>
                </template>


                <!-- Nothing open yet. -->
                <div v-else class="pg__blank">
                    <button v-if="!embedded" type="button" class="pg__icon-btn pg__blank-close" :title="$t('Projects.close')" @click="requestClose">
                        <span v-html="ICONS.close"></span>
                    </button>
                    <span class="pg__blank-icon" v-html="ICONS.doc"></span>
                    <p class="pg__blank-text">{{ $t('Projects.select_page') }}</p>
                    <p class="pg__blank-hint">{{ $t('Projects.pages_blank_hint') }}</p>
                    <button type="button" class="pg__btn pg__btn--primary" @click="createPage(null)">{{ $t('Projects.add_page') }}</button>
                </div>
            </section>
        </div>
        <AiTaskCreator
            v-if="taskProjectId"
            v-model="showAiTaskCreator"
            :projectId="taskProjectId"
            :sprints="aiSprints"
            :initialRequirements="aiInitialRequirements"
        />
    </div>
</template>

<script setup>
// PACKAGES
import { computed, defineProps, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useToast } from "vue-toast-notification";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRoute, useRouter } from "vue-router";

import TaskChipPicker from "@/components/molecules/Pages/TaskChipPicker.vue";
import PageBlockEditor from "@/components/molecules/Pages/PageBlockEditor.vue";
import PageComposeRail from "@/components/molecules/Pages/PageComposeRail.vue";
import AiTaskCreator from "@/components/organisms/AiTaskCreator/AiTaskCreator.vue";

import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { useGetterFunctions } from "@/composable";
import pageContent from '@pageContent';
const { contentToEditorData, blocksToRawText } = pageContent.default || pageContent;

const { t } = useI18n();
const $toast = useToast();
const { getters, dispatch } = useStore();
const route = useRoute();
const router = useRouter();
// getUser only resolves a name for display now — the author is taken from the JWT on the
// server, so nothing here needs the current user's id.
const { getUser, getTaskStatus } = useGetterFunctions();

// A task reference is stored in the page HTML as a plain-text token
// `{{task:<taskId>|<TASKKEY>}}`; plain text survives Quill's sanitiser so it
// round-trips through edit/save unchanged. Preview mode hydrates each token
// into a live status chip.
const TASK_TOKEN_REGEX = /\{\{task:([a-f\d]{24})\|([^}|]*)\}\}/gi;

const ICONS = {
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    caret: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 5l7 7-7 7z"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="20" y1="20" x2="16.7" y2="16.7" stroke-linecap="round"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
    doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
    people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16.5 5.5a3 3 0 0 1 0 5.6M18 20a6 6 0 0 0-2-4.5"/></svg>',
    globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z"/></svg>',
};

const props = defineProps({
    projectData: { type: Object, default: () => ({}) },
    modelValue: { type: Boolean, default: false },
    openDocId: { type: String, default: '' },
    embedded: { type: Boolean, default: false },
    workspace: { type: Boolean, default: false },
});

const emit = defineEmits(['update:modelValue']);

const pages = ref([]);
const current = ref(null);
const draftTitle = ref('');
const contentHtml = ref('');
const contentBlocks = ref(null);
const savedSnapshot = ref({ title: '', html: '' });
const isSaving = ref(false);
const blockEditor = ref(null);

const editorSeed = ref(null);
const editorKey = ref('');
const baselinePending = ref(false);

const workspaceProjectId = ref('');
const showAiTaskCreator = ref(false);
const aiSprints = ref([]);
const aiInitialRequirements = ref('');

const pickerProjects = computed(() => {
    const raw = getters['projectData/projects'];
    const list = raw && Array.isArray(raw.data) ? raw.data : [];
    return list.filter((project) => project && project._id);
});

const projectId = computed(() => String(
    (props.projectData && props.projectData._id)
    || workspaceProjectId.value
    || ''
));

const taskProjectId = computed(() => String(
    projectId.value
    || (current.value && current.value.ProjectID)
    || ''
));
const rawDraft = computed(() => blocksToRawText(contentBlocks.value) || contentHtml.value || '');

const query = ref('');
const routePageId = computed(() => String((route.query && route.query.page) || ''));
const expanded = ref(new Set());
const showLinker = ref(false);
// [{ id, key }] — the key is only what the picker handed over, for a readable chip. The
// link itself is the id, and that is what the server stores.
const linkedTasks = ref([]);
const isPrivate = ref(false);
const mode = ref('edit');          // 'edit' | 'preview'
const previewHtml = ref('');

// Share. `share` is the row from /api/v2/public-shares — null when this doc has no
// public link. The link exists as soon as a row does, so the switch is that row's
// `enabled` flag rather than a separate piece of state.
const showShare = ref(false);
const share = ref(null);
const isSharing = ref(false);
const isPublic = computed(() => !!share.value && share.value.enabled !== false);
const shareUrl = computed(() => (share.value ? `${window.location.origin}/share/${share.value.token}` : ''));

// Saving is deliberate, not automatic. The API snapshots a version on every content
// write, so an autosave would bury the real edits under a version every keystroke-pause
// and make the history useless. Instead the state is visible and Ctrl/Cmd+S works.
const isDirty = computed(() => !!current.value
    && (draftTitle.value !== savedSnapshot.value.title || contentHtml.value !== savedSnapshot.value.html));

/**
 * The tree, flattened to rows with a depth.
 *
 * A page whose parent is missing from the list is treated as a root. Without that a
 * page could become unreachable — orphaned by a parent that was removed or filtered
 * away — and simply never render, with nothing to say it exists.
 */
const rows = computed(() => {
    const list = pages.value || [];
    const term = query.value.trim().toLowerCase();

    // Searching is a flat answer: a hit buried three levels down should not require
    // expanding its ancestors to be seen.
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

const nameOf = (id) => (id ? (getUser(String(id))?.Employee_Name || '—') : '—');

// Embedded as a view there is no open/close cycle, so it is open from the start
// and the watch below must fire immediately or the tree would never load.
const isOpen = computed(() => props.embedded || props.workspace || props.modelValue);

watch(isOpen, (open) => {
    if (open) {
        fetchPages();
        // The tree lists this project's docs; a doc opened from a task may be linked from
        // another project and so not be in it. Open it by id regardless — the click named
        // the doc, and refusing it because the sidebar has no row for it would read as the
        // link being broken.
        if (props.openDocId) openPage(props.openDocId);
    } else {
        // Closed with either popover open would reopen it on top of the next doc.
        showLinker.value = false;
        showShare.value = false;
    }
}, { immediate: true });

// Opening the panel twice from two different docs without closing it in between: the
// watch above only fires on open, so the id changing while open has to be honoured too.
watch(() => props.openDocId, (id) => {
    if (id && isOpen.value) openPage(id);
});

watch(routePageId, (id, previous) => {
    if (!props.workspace || !id || id === previous) return;
    if (isOpen.value) openPage(id);
});

// Switching projects does not remount this component — only the injected project
// changes — so nothing above re-ran and the previous project's tree and open doc
// stayed on screen until a tab change or reload forced a rebuild.
watch(() => (props.projectData && props.projectData._id) || '', (id, previous) => {
    if (props.workspace) return;
    if (!id || !previous || id === previous) return;
    // Nothing here autosaves (see isDirty), and the switch has already happened,
    // so a confirm could not undo it. Say plainly that the edits are going rather
    // than dropping them in silence.
    if (isDirty.value) {
        $toast.warning(t('Projects.page_unsaved_lost_on_switch'), { position: 'top-right' });
    }
    current.value = null;
    draftTitle.value = '';
    contentHtml.value = '';
    savedSnapshot.value = { title: '', html: '' };
    baselinePending.value = false;
    pages.value = [];
    expanded.value = new Set();
    query.value = '';
    showLinker.value = false;
    showShare.value = false;
    if (isOpen.value) fetchPages();
});

watch(workspaceProjectId, (id, previous) => {
    if (!props.workspace || previous === undefined || id === previous) return;
    if (isDirty.value && !window.confirm(t('Projects.page_discard_confirm'))) {
        workspaceProjectId.value = previous || '';
        return;
    }
    current.value = null;
    draftTitle.value = '';
    contentHtml.value = '';
    savedSnapshot.value = { title: '', html: '' };
    baselinePending.value = false;
    pages.value = [];
    expanded.value = new Set();
    if (isOpen.value) fetchPages();
});

function fetchPages() {
    const queryString = projectId.value ? `?projectId=${projectId.value}` : '';
    apiRequest('get', `/api/v2/pages${queryString}`)
    .then((response) => {
        pages.value = response.data?.status ? (response.data.data || []) : [];
        // Open every branch that has children the first time the panel loads, so the
        // tree shows what exists rather than hiding it behind twisties.
        if (!expanded.value.size) {
            expanded.value = new Set(pages.value.filter((p) => p.parentPageId).map((p) => String(p.parentPageId)));
        }
        // As a view, landing on "pick a doc" reads as an empty project even when
        // it has docs, so start on the first one. Only when nothing is open and
        // no doc was asked for — and with no docs at all the empty state is still
        // the right answer. The panel keeps its picker: it is opened FROM a doc.
        if (props.workspace && routePageId.value) {
            openPage(routePageId.value);
        } else if (props.embedded && !current.value && !props.openDocId && rows.value.length) {
            openPage(rows.value[0]._id);
        }
    })
    .catch((error) => console.error('ERROR in fetch pages: ', error));
}

// Leaving a page with unsaved edits is the one way to lose work here, so it is the one
// thing that asks.
function confirmDiscard() {
    return !isDirty.value || window.confirm(t('Projects.page_discard_confirm'));
}

function openPage(id) {
    if (current.value && String(current.value._id) === String(id)) return;
    if (!confirmDiscard()) return;
    apiRequest('get', `/api/v2/pages/${id}`)
    .then((response) => {
        if (response.data?.status) {
            current.value = response.data.data;
            draftTitle.value = current.value.title || '';
            contentHtml.value = (current.value.content && current.value.content.html) || '';
            contentBlocks.value = contentToEditorData(current.value.content);
            savedSnapshot.value = { title: draftTitle.value, html: contentHtml.value };
            editorSeed.value = current.value.content || { html: contentHtml.value };
            editorKey.value = String(id);
            baselinePending.value = true;
            isPrivate.value = String(current.value.visibility || '') === 'private';
            linkedTasks.value = (current.value.linkedTasks || []).map((x) => ({ id: String(x), key: '' }));
            mode.value = 'edit';
            showLinker.value = false;
            showShare.value = false;
            share.value = null;
            previewHtml.value = '';
            if (props.workspace && String(routePageId.value || '') !== String(id)) {
                router.replace({ query: { ...route.query, page: String(id) } });
            }
        }
    })
    .catch((error) => console.error('ERROR in open page: ', error));
}

function createPage(parentPageId) {
    if (!confirmDiscard()) return;
    apiRequest('post', '/api/v2/pages', {
        title: t('Projects.untitled_page'),
        ...(projectId.value ? { projectId: projectId.value } : {}),
        ...(parentPageId ? { parentPageId: String(parentPageId) } : {}),
    }).then((response) => {
        if (response.data?.status) {
            // Reveal the new child rather than creating it inside a collapsed branch.
            if (parentPageId) toggleOpen(parentPageId);
            fetchPages();
            current.value = null;   // openPage guards on identity; clear it first
            openPage(response.data.data._id);
        } else {
            $toast.error(response.data?.statusText || t('Toast.something_went_wrong'), { position: 'top-right' });
        }
    }).catch((error) => console.error('ERROR in create page: ', error));
}

function toggleOpen(id) {
    const next = new Set(expanded.value);
    next.add(String(id));
    expanded.value = next;
}

function savePage() {
    if (!current.value || isSaving.value || !isDirty.value) return;
    isSaving.value = true;
    const sent = { title: draftTitle.value, html: contentHtml.value };
    apiRequest('put', `/api/v2/pages/${current.value._id}`, {
        title: sent.title,
        contentHtml: sent.html,
        contentBlocks: contentBlocks.value,
    }).then((response) => {
        if (response.data?.status) {
            // Compare against what was SENT, not against the fields now: anything typed
            // during the request stays dirty instead of being silently marked saved.
            savedSnapshot.value = sent;
            if (response.data.data) current.value = response.data.data;
            $toast.success(response.data.statusText, { position: 'top-right' });
            fetchPages();
        } else {
            $toast.error(response.data?.statusText || t('Toast.something_went_wrong'), { position: 'top-right' });
        }
    }).catch((error) => console.error('ERROR in save page: ', error))
    .finally(() => { isSaving.value = false; });
}

function deletePage() {
    if (!current.value) return;
    const hasChildren = rows.value.some((r) => String(r.parentPageId || '') === String(current.value._id));
    // Sub-pages go with the parent, so say so before it happens rather than after.
    const message = hasChildren ? t('Projects.page_delete_with_children') : t('Projects.page_delete_confirm');
    if (!window.confirm(message)) return;
    apiRequest('delete', `/api/v2/pages/${current.value._id}`)
    .then((response) => {
        if (response.data?.status) {
            current.value = null;
            draftTitle.value = '';
            contentHtml.value = '';
            savedSnapshot.value = { title: '', html: '' };
            editorSeed.value = '';
            editorKey.value = '';
            baselinePending.value = false;
            linkedTasks.value = [];
            isPrivate.value = false;
            fetchPages();
        }
    }).catch((error) => console.error('ERROR in delete page: ', error));
}

function sprintsFromProject(project) {
    if (!project) return [];
    const isLive = (x) => x && (x.deletedStatusKey === 0 || x.deletedStatusKey === undefined);
    const out = [];
    const seen = new Set();
    const push = (sprint, prefix) => {
        if (!isLive(sprint) || !sprint.id) return;
        const id = String(sprint.id);
        if (seen.has(id)) return;
        seen.add(id);
        const name = sprint.name || 'Sprint';
        out.push({ id, name: prefix ? `${prefix} / ${name}` : name });
    };
    Object.values(project.sprintsObj || {}).forEach((sprint) => push(sprint, ''));
    Object.values(project.sprintsfolders || {}).forEach((folder) => {
        if (!isLive(folder)) return;
        Object.values(folder.sprintsObj || {}).forEach((sprint) => push(sprint, folder.name || 'Folder'));
    });
    return out;
}

function openTurnIntoTasks(requirements) {
    if (!taskProjectId.value) return;
    const project = pickerProjects.value.find((row) => String(row._id) === taskProjectId.value)
        || (props.projectData && String(props.projectData._id) === taskProjectId.value ? props.projectData : null);
    aiSprints.value = sprintsFromProject(project);
    const seed = typeof requirements === 'string' ? requirements.trim() : '';
    if (seed) {
        aiInitialRequirements.value = seed;
    } else {
        const title = (draftTitle.value || '').trim();
        const body = (rawDraft.value || '').trim();
        aiInitialRequirements.value = [title, body].filter(Boolean).join('\n\n');
    }
    showAiTaskCreator.value = true;
}

function requestClose() {
    if (!confirmDiscard()) return;
    emit('update:modelValue', false);
}

/**
 * Links and visibility are saved on their own, immediately — not folded into the Save
 * button. They are not edits to the document, and holding them hostage to a body save
 * would make "link a task" feel like it silently did nothing.
 */
function persistMeta(patch) {
    if (!current.value) return;
    apiRequest('put', `/api/v2/pages/${current.value._id}`, patch)
    .then((response) => {
        if (response.data?.status) {
            if (response.data.data) {
                // Keep the open editor's text: the response carries the SAVED body, and
                // adopting it wholesale would throw away anything typed since. Copied and
                // stripped rather than destructured — a discarded `content` binding reads
                // as an unused variable to eslint, and it is a build error here.
                const saved = { ...response.data.data };
                delete saved.content;
                current.value = { ...current.value, ...saved };
            }
            fetchPages();
        } else {
            $toast.error(response.data?.statusText || t('Toast.something_went_wrong'), { position: 'top-right' });
        }
    })
    .catch((error) => console.error('ERROR in save doc meta: ', error));
}

function linkTask(taskItem) {
    if (!taskItem || !taskItem._id) return;
    const id = String(taskItem._id);
    showLinker.value = false;
    if (linkedTasks.value.some((x) => x.id === id)) return;   // already linked
    linkedTasks.value = [...linkedTasks.value, { id, key: taskItem.TaskKey || '' }];
    persistMeta({ linkedTasks: linkedTasks.value.map((x) => x.id) });
}

function unlinkTask(id) {
    linkedTasks.value = linkedTasks.value.filter((x) => x.id !== String(id));
    persistMeta({ linkedTasks: linkedTasks.value.map((x) => x.id) });
}

function togglePrivate() {
    isPrivate.value = !isPrivate.value;
    persistMeta({ visibility: isPrivate.value ? 'private' : 'project' });
    // Going private takes the doc off the web too. Leaving the link live would mean
    // "Private" was true of the company and false of the entire internet.
    if (isPrivate.value && isPublic.value) setPublicLink(false);
}

/* ── Public link ──────────────────────────────────────────────────────────
 *
 * A read-only, login-free page at /share/<token>, served by the same public-share
 * machinery sprints and reports already use. */
function openShare() {
    if (!current.value) return;
    showShare.value = true;
    fetchShare();
}

function fetchShare() {
    share.value = null;
    if (!current.value) return;
    apiRequest('get', `/api/v2/public-shares?entityId=${current.value._id}`)
    .then((response) => { if (response.data?.status) share.value = response.data.data || null; })
    .catch((error) => console.error('ERROR in fetch doc share: ', error));
}

/**
 * Turn the public link on or off.
 *
 * The first "on" mints the link; later ones flip `enabled` on the row that already
 * exists, so the URL someone was given keeps working rather than being replaced by
 * a new one every time the switch is toggled.
 */
function setPublicLink(on) {
    if (!current.value || isSharing.value) return;
    isSharing.value = true;
    const request = share.value
        ? apiRequest('put', `/api/v2/public-shares/${share.value._id}`, { enabled: on })
        : apiRequest('post', '/api/v2/public-shares', { entityType: 'page', entityId: current.value._id });
    request.then((response) => {
        if (response.data?.status) {
            share.value = response.data.data || null;
        } else {
            // The server refuses a link on a private doc, among other things — say which.
            $toast.error(response.data?.statusText || t('Toast.something_went_wrong'), { position: 'top-right' });
        }
    })
    .catch((error) => {
        $toast.error(error?.response?.data?.statusText || error?.message || t('Toast.something_went_wrong'), { position: 'top-right' });
    })
    .finally(() => { isSharing.value = false; });
}

function togglePublicLink() {
    setPublicLink(!isPublic.value);
}

function copyShareLink() {
    if (!shareUrl.value) return;
    navigator.clipboard.writeText(shareUrl.value)
    .then(() => $toast.success(t('Toast.Link_is_Copied_to_clipboard'), { position: 'top-right' }))
    .catch(() => $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' }));
}

function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function chipSpan({ taskKey, statusName, bgColor, textColor, taskName }) {
    const bg = bgColor || '#c1c1c1';
    const fg = textColor || '#ffffff';
    const title = `${escapeHtml(taskKey)} — ${escapeHtml(taskName)}`;
    return `<span class="ah-task-chip" style="background:${escapeHtml(bg)};color:${escapeHtml(fg)};padding:2px 8px;border-radius:10px;font-size:12px;font-weight:600;" title="${title}">${escapeHtml(taskKey)}: ${escapeHtml(statusName)}</span>`;
}

// "Live": fetch each referenced task's current status every time Preview opens,
// then replace every token in the saved HTML with a static chip span. A
// deleted/unknown task renders a neutral "—" chip instead of crashing.
async function buildPreviewHtml() {
    const html = contentHtml.value || '';
    const tokens = [...html.matchAll(TASK_TOKEN_REGEX)];
    if (!tokens.length) {
        previewHtml.value = html;
        return;
    }

    const uniqueIds = [...new Set(tokens.map((m) => m[1]))];
    const chipById = {};

    await Promise.all(uniqueIds.map(async (taskId) => {
        try {
            const response = await apiRequest('get', `${env.TASK}/${taskId}`);
            const taskDoc = response?.status === 200 ? response.data : null;
            if (taskDoc && taskDoc.statusKey !== undefined && taskDoc.statusKey !== null) {
                const status = getTaskStatus(taskDoc.statusKey) || {};
                chipById[taskId] = {
                    taskName: taskDoc.TaskName || '',
                    statusName: status.name || t('Projects.unknown_status'),
                    bgColor: status.bgColor,
                    textColor: status.textColor,
                };
            }
        } catch (error) {
            console.error('ERROR in fetch task for chip: ', error);
        }
    }));

    previewHtml.value = html.replace(TASK_TOKEN_REGEX, (match, taskId, taskKey) => {
        const data = chipById[taskId];
        if (!data) {
            return chipSpan({ taskKey, statusName: '—', taskName: t('Projects.unknown_status') });
        }
        return chipSpan({
            taskKey,
            statusName: data.statusName,
            bgColor: data.bgColor,
            textColor: data.textColor,
            taskName: data.taskName,
        });
    });
}

function openPreview() {
    if (!current.value) return;
    mode.value = 'preview';
    buildPreviewHtml();
}

/**
 * Back to editing after a preview.
 *
 * The editor is unmounted while previewing, so it has to be re-seeded with the text as it
 * stands — seeding it with the text as LOADED would silently undo everything typed since.
 */
function openEditor() {
    editorSeed.value = current.value ? current.value.content : { html: contentHtml.value };
    mode.value = 'edit';
}

function onEditorReady() {
    if (baselinePending.value) {
        baselinePending.value = false;
        savedSnapshot.value = { ...savedSnapshot.value, html: contentHtml.value };
    }
}

function onBlockChange({ blocks, html }) {
    contentBlocks.value = blocks;
    contentHtml.value = html;
}

function onComposeApply(payload) {
    if (blockEditor.value && blockEditor.value.applyBlocks) {
        blockEditor.value.applyBlocks(payload);
    }
}

function formatStamp(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    const sameYear = date.getFullYear() === new Date().getFullYear();
    const day = date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
    return `${day}, ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function onKeydown(e) {
    if (!isOpen.value) return;
    if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 's') {
        e.preventDefault();
        savePage();
    } else if (e.key === 'Escape') {
        if (showShare.value) { showShare.value = false; return; }
        if (showLinker.value) { showLinker.value = false; return; }
        if (!props.embedded && !props.workspace) requestClose();
    }
}
onMounted(() => {
    document.addEventListener('keydown', onKeydown);
    if (props.workspace && !pickerProjects.value.length) {
        dispatch('projectData/setProjects', { roleType: 'currentUser' }).catch(() => {});
    }
});
onBeforeUnmount(() => {
    document.removeEventListener('keydown', onKeydown);
});
</script>

<style scoped>
.pg {
    position: fixed;
    inset: 0;
    background: rgba(27, 47, 40, 0.42);
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--kiln-font-body);
}
/* A document needs room. The old 960×640 card left about a third of the screen for
   the body; this is the writing surface, so it takes the screen. */
.pg__shell {
    background: var(--kiln-canvas);
    border-radius: var(--kiln-radius);
    width: min(1240px, 96vw);
    height: min(860px, 92vh);
    display: flex;
    overflow: hidden;
    box-shadow: var(--kiln-shadow);
}
/* As a project view it sits in the page flow, so it drops the backdrop, the
   centring and the floating-card treatment and simply fills its container. */
.pg--embedded {
    position: static;
    inset: auto;
    background: transparent;
    z-index: auto;
    display: block;
    height: 100%;
}
.pg--embedded .pg__shell {
    width: 100%;
    height: 100%;
    min-height: 520px;
    border-radius: var(--kiln-radius);
    box-shadow: none;
    border: 1px solid var(--kiln-line);
}
.pg--workspace {
    position: static;
    inset: auto;
    background: var(--kiln-paper);
    z-index: auto;
    display: block;
    height: 100%;
}
.pg--workspace .pg__shell {
    width: 100%;
    height: 100%;
    min-height: calc(100dvh - var(--kiln-header-h, 58px));
    border-radius: 0;
    box-shadow: none;
    flex-direction: row-reverse;
    background: var(--kiln-canvas);
}

/* ── sidebar ─────────────────────────────────────────── */
.pg__side {
    width: 280px;
    flex: 0 0 280px;
    border-right: 1px solid var(--kiln-line);
    background: var(--kiln-paper);
    display: flex;
    flex-direction: column;
    min-height: 0;
}
.pg--workspace .pg__side {
    border-right: 0;
    border-left: 1px solid var(--kiln-line);
}
.pg__side-head {
    display: flex; align-items: flex-end; justify-content: space-between;
    padding: 18px 14px 10px 18px;
    flex-wrap: wrap;
}
.pg__side-kicker {
    display: block; width: 100%;
    font-size: 10px; font-weight: 700; letter-spacing: 0.16em;
    text-transform: uppercase; color: var(--kiln-ember);
    margin-bottom: 2px;
}
.pg__side-title {
    font-family: var(--kiln-font-display);
    font-size: 22px; font-weight: 650; color: var(--kiln-ink);
    letter-spacing: -0.03em;
}
.pg__picker-wrap {
    padding: 0 12px 10px;
}
.pg__picker-label {
    display: block;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--kiln-muted);
    margin-bottom: 4px;
}
.pg__picker {
    width: 100%;
    height: 32px;
    border: 1px solid var(--kiln-line);
    border-radius: var(--kiln-radius-sm);
    background: var(--kiln-canvas);
    color: var(--kiln-ink);
    font-size: 12.5px;
    padding: 0 8px;
    outline: none;
}
.pg__picker:focus { border-color: var(--kiln-ember); }

.pg__search-wrap { position: relative; padding: 0 12px 10px; }
.pg__search-icon {
    position: absolute; left: 21px; top: 6px;
    width: 14px; height: 14px; color: #a8aebd; pointer-events: none;
}
.pg__search-icon :deep(svg) { width: 100%; height: 100%; }
.pg__search {
    width: 100%; height: 28px;
    padding: 0 9px 0 27px;
    border: 1px solid #e3e6ef; border-radius: 7px;
    background: #fff; font-size: 12.5px; color: #1f212a; outline: none;
}
.pg__search:focus { border-color: var(--kiln-ember); }
.pg__search::placeholder { color: #b0b6c6; }

.pg__tree { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 0 8px 12px; }
.pg__empty { color: #9aa0b4; font-size: 12px; padding: 14px 8px; }
.pg__row {
    display: flex; align-items: center; gap: 4px;
    min-height: 34px; padding-right: 6px;
    border-radius: 0; cursor: pointer; color: var(--kiln-ink-soft);
    border-left: 3px solid transparent;
}
.pg__row:hover { background: var(--kiln-paper-2); }
.pg__row.is-active {
    background: transparent;
    color: var(--kiln-ink);
    font-weight: 600;
    border-left-color: var(--kiln-ember);
}
.pg__twisty {
    flex: 0 0 14px; width: 14px; height: 14px;
    display: inline-flex; align-items: center; justify-content: center;
    color: #a8aebd; transition: transform .12s ease;
}
.pg__twisty :deep(svg) { width: 10px; height: 10px; }
.pg__twisty.is-open { transform: rotate(90deg); }
.pg__twisty.is-leaf { cursor: default; }
.pg__row-title {
    flex: 1 1 auto; min-width: 0;
    font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* Only on hover, so the tree reads as a list of titles and not a wall of buttons. */
.pg__row-add {
    flex: 0 0 auto; width: 18px; height: 18px;
    border: 0; background: none; padding: 0; color: #8a909c;
    border-radius: 4px; cursor: pointer; opacity: 0;
}
.pg__row:hover .pg__row-add { opacity: 1; }
.pg__row-add:hover { background: var(--kiln-paper-2); color: var(--kiln-ember); }
.pg__row-add :deep(svg) { width: 12px; height: 12px; }

/* ── main ────────────────────────────────────────────── */
/* position: relative anchors the share overlay to the document pane. Without it the
   overlay would resolve against .pg and dim the sidebar too, which reads as the whole
   panel being blocked rather than one doc being shared. */
.pg__main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; position: relative; }
.pg__head {
    display: flex; align-items: center; gap: 10px;
    padding: 14px 16px 8px 20px;
}
.pg__title {
    flex: 1 1 auto; min-width: 0;
    border: none; outline: none; background: transparent;
    font-family: var(--kiln-font-display);
    font-size: 28px; font-weight: 650; color: var(--kiln-ink);
    letter-spacing: -0.03em;
    padding: 2px 0;
    border-bottom: 1px solid transparent;
}
.pg__title:focus { border-bottom-color: var(--kiln-ember); }
.pg__title::placeholder { color: #c3c7d4; }
.pg__actions { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }

.pg__seg { display: inline-flex; border: 1px solid #e3e6ef; border-radius: 7px; overflow: hidden; }
.pg__seg-btn {
    border: 0; background: #fff; padding: 4px 11px;
    font-size: 12px; color: #6b7280; cursor: pointer;
}
.pg__seg-btn.is-on { background: var(--kiln-paper); color: var(--kiln-ink); font-weight: 600; }

.pg__btn {
    border: 1px solid #e3e6ef; background: #fff; border-radius: 7px;
    padding: 4px 11px; font-size: 12px; color: #3a3f52; cursor: pointer;
    display: inline-flex; align-items: center; gap: 6px;
}
.pg__btn:hover:not(:disabled) { background: #f5f6fa; }
.pg__btn:disabled { opacity: .5; cursor: default; }
.pg__btn--primary { background: var(--kiln-ember); border-color: var(--kiln-ember); color: #fffaf3; }
.pg__btn--primary:hover:not(:disabled) { background: var(--kiln-ember-deep); }

.pg__icon-btn {
    border: 0; background: none; padding: 0; cursor: pointer;
    width: 26px; height: 26px; border-radius: 6px; color: #6b7280;
    display: inline-flex; align-items: center; justify-content: center;
}
.pg__icon-btn:hover { background: #f0f2f8; color: #1f212a; }
.pg__icon-btn :deep(svg) { width: 15px; height: 15px; }
.pg__icon-btn--danger:hover { background: #fdeceb; color: #b91c1c; }


.pg__btn.is-private { border-color: #e0c99a; background: #fdf6e8; color: #926a15; }
.pg__btn :deep(svg) { width: 12px; height: 12px; }
.pg__count {
    font-size: 10px; font-weight: 600; line-height: 1.6;
    padding: 0 5px; border-radius: 8px; background: #eef0f6; color: #6b7280;
}
/* Linked tasks sit under the meta line: they belong to the doc, not to the body. */
.pg__links { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; padding: 0 20px 10px; }
.pg__links-label { font-size: 11px; color: #9aa0b4; }
.pg__link {
    display: inline-flex; align-items: center; gap: 5px;
    font-size: 11px; font-weight: 600; color: var(--kiln-ink);
    background: var(--kiln-paper-2); border-radius: 9px; padding: 1px 4px 1px 8px;
}
.pg__link-x { border: 0; background: none; padding: 0 3px; color: #7a80ad; cursor: pointer; font-size: 10px; }
.pg__link-x:hover { color: #b91c1c; }

.pg__meta {
    display: flex; align-items: center; gap: 6px;
    padding: 0 20px 10px; font-size: 11.5px; color: #9aa0b4;
}
.pg__meta-sep { color: #d3d7e2; }
.pg__dot { width: 6px; height: 6px; border-radius: 50%; background: #b7d9c5; flex: 0 0 auto; }
.pg__dot--dirty { background: #e0a13a; }

.pg__doc { flex: 1 1 auto; min-height: 0; padding: 0 20px 18px; display: flex; }
.pg__editor { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.pg__editor :deep(.ql-toolbar) { border-radius: 8px 8px 0 0; border-color: #e3e6ef; }
/* One scroller, and it is .ql-editor.
 *
 * .ql-container used to scroll as well. `overflow-y: auto` makes the browser compute
 * `overflow-x` as auto too, and .ql-editor is `height: 100%` of the container — so the
 * moment a horizontal bar appeared it stole height, which pushed the full-height child
 * into vertical overflow, which stole width, which brought the horizontal bar back. The
 * two bars flickered against each other forever. The container is now a fixed frame that
 * never scrolls, and long words wrap instead of widening it. */
.pg__editor :deep(.ql-container) {
    flex: 1 1 auto; min-height: 0; overflow: hidden;
    border-radius: 0 0 8px 8px; border-color: #e3e6ef; font-size: 14px;
}
.pg__editor :deep(.ql-editor) {
    height: 100%; overflow-y: auto; overflow-x: hidden;
    overflow-wrap: break-word; word-break: break-word;
}
.pg__preview {
    flex: 1 1 auto; min-height: 0; overflow-y: auto;
    border: 1px solid #e3e6ef; border-radius: 8px; padding: 14px 16px; font-size: 14px;
}
.pg__preview :deep(.ah-task-chip) { display: inline-block; vertical-align: middle; }

/* ── Share ─────────────────────────────────────────────────────────────── */
.pg__share-back {
    position: absolute; inset: 0; z-index: 30;
    background: rgba(31, 33, 42, 0.32);
    display: flex; align-items: flex-start; justify-content: center;
    padding-top: 90px;
}
.pg__share {
    width: 420px; max-width: calc(100% - 40px);
    background: #fff; border-radius: 12px; padding: 18px 20px 20px;
    box-shadow: 0 18px 48px rgba(31, 33, 42, 0.24);
}
.pg__share-head { display: flex; align-items: center; justify-content: space-between; }
.pg__share-title { margin: 0; font-size: 17px; font-weight: 600; color: #1f212a; }
.pg__share-sub {
    display: flex; align-items: center; gap: 6px;
    margin: 4px 0 16px; font-size: 13px; color: #7c8194; min-width: 0;
}
.pg__share-sub b { color: #3a3f52; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pg__share-sub :deep(svg) { width: 15px; height: 15px; flex: 0 0 auto; }

.pg__share-row {
    display: flex; align-items: center; gap: 11px;
    padding: 12px 0; border-top: 1px solid #eef0f6;
}
.pg__share-ico { flex: 0 0 auto; width: 18px; height: 18px; color: #6a7086; display: inline-flex; }
.pg__share-ico :deep(svg) { width: 100%; height: 100%; }
.pg__share-copy { flex: 1 1 auto; min-width: 0; }
.pg__share-label { font-size: 14px; font-weight: 500; color: #1f212a; }
.pg__share-hint { font-size: 12px; color: #8b90a3; margin-top: 1px; }

/* A switch, because both settings are on/off and the state should read at a glance. */
.pg__switch {
    flex: 0 0 auto; width: 38px; height: 21px; padding: 0;
    border: 0; border-radius: 999px; background: #d5d8e3; cursor: pointer;
    transition: background .15s ease;
}
.pg__switch i {
    display: block; width: 17px; height: 17px; margin: 2px;
    border-radius: 50%; background: #fff; transition: transform .15s ease;
}
.pg__switch.is-on { background: var(--kiln-ember); }
.pg__switch.is-on i { transform: translateX(17px); }
.pg__switch:disabled { opacity: .45; cursor: not-allowed; }

.pg__share-url {
    width: 100%; box-sizing: border-box; margin-top: 14px;
    height: 34px; padding: 0 10px;
    border: 1px solid #e3e6ef; border-radius: 7px;
    font-size: 12.5px; color: #5a6076; background: #f8f9fc; outline: none;
}
.pg__share-copy-btn { width: 100%; margin-top: 9px; justify-content: center; }

.pg__blank {
    flex: 1; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 12px; position: relative;
}
.pg__blank-close { position: absolute; top: 14px; right: 16px; }
.pg__blank-icon { width: 46px; height: 46px; color: #ccd1de; }
.pg__blank-icon :deep(svg) { width: 100%; height: 100%; }
.pg__blank-hint { color: var(--kiln-muted); font-size: 13px; margin: 0; max-width: 360px; text-align: center; line-height: 1.5; }
.pg__blank-text { color: var(--kiln-ink); font-family: var(--kiln-font-display); font-size: 22px; margin: 0; }

@media (max-width: 767px) {
    .pg__side { display: none; }
    .pg__shell { width: 100vw; height: 100vh; border-radius: 0; }
}
</style>
