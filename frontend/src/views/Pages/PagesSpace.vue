<template>
    <div class="ah-page hub">
        <aside class="hub__side">
            <div class="hub__search">
                <ShellIcon name="search" :size="14" class="hub__search-icon" />
                <input v-model="query" type="search" class="ah-input hub__search-input" :placeholder="$t('DocsV2.search_docs')" />
            </div>

            <nav class="hub__nav">
                <button type="button" class="hub__item" :class="{ 'is-active': view === 'recent' }" @click="view = 'recent'">
                    {{ $t('DocsV2.recent') }}
                </button>
                <button type="button" class="hub__item" :class="{ 'is-active': view === 'mine' }" @click="view = 'mine'">
                    {{ $t('DocsV2.mine') }}<span class="hub__item-count">{{ mine.length }}</span>
                </button>
                <button type="button" class="hub__item" :class="{ 'is-active': view === 'wiki' }" @click="view = 'wiki'">
                    {{ $t('DocsV2.wiki') }}
                    <span v-if="needsReview.length" class="hub__item-badge hub__item-badge--warn">{{ needsReview.length }}</span>
                    <span v-else class="hub__item-count">{{ wikiPages.length }}</span>
                </button>
            </nav>

            <nav class="hub__nav">
                <div class="ah-label hub__label">{{ $t('DocsV2.by_project') }}</div>
                <button type="button" class="hub__item" :class="{ 'is-active': view === 'project:' }" @click="view = 'project:'">
                    <span class="hub__swatch hub__swatch--none"></span>{{ $t('DocsV2.workspace') }}
                    <span class="hub__item-count">{{ countFor('') }}</span>
                </button>
                <button
                    v-for="project in projects"
                    :key="'sp-' + project._id"
                    type="button"
                    class="hub__item"
                    :class="{ 'is-active': view === 'project:' + project._id }"
                    @click="view = 'project:' + project._id"
                >
                    <span class="hub__swatch" :style="{ background: swatch(project._id) }"></span>
                    <span class="hub__item-text">{{ project.ProjectName }}</span>
                    <span class="hub__item-count">{{ countFor(String(project._id)) }}</span>
                </button>
            </nav>

            <nav class="hub__nav">
                <button type="button" class="hub__item" :class="{ 'is-active': view === 'agents' }" @click="view = 'agents'">
                    <ShellIcon name="agent" :size="13" class="hub__item-icon" />{{ $t('DocsV2.agent_drafted') }}
                    <span v-if="agentDrafts.length" class="hub__item-badge">{{ agentDrafts.length }}</span>
                </button>
                <button type="button" class="hub__item" :class="{ 'is-active': view === 'templates' }" @click="view = 'templates'">
                    <ShellIcon name="layout" :size="13" class="hub__item-icon" />{{ $t('DocsV2.templates') }}
                </button>
                <button type="button" class="hub__item" :class="{ 'is-active': view === 'trash' }" @click="view = 'trash'">
                    <ShellIcon name="trash" :size="13" class="hub__item-icon" />{{ $t('DocsV2.trash') }}
                </button>
            </nav>

            <button type="button" class="ah-btn ah-btn--primary ah-btn--block hub__new" @click="createDoc({})">
                <ShellIcon name="plus" :size="14" />{{ $t('DocsV2.new_doc') }}
            </button>
        </aside>

        <div class="hub__main">
            <div class="ah-toolbar">
                <span class="ah-toolbar__title">
                    {{ $t('DocsV2.docs') }}
                    <span class="ah-label hub__stats">{{ $t('DocsV2.pages_count', { n: pages.length }) }}<template v-if="staleCount"> · {{ $t('DocsV2.stale_count', { n: staleCount }) }}</template></span>
                </span>
                <select v-model="view" class="hub__view-select">
                    <option value="recent">{{ $t('DocsV2.recent') }}</option>
                    <option value="mine">{{ $t('DocsV2.mine') }}</option>
                    <option value="wiki">{{ $t('DocsV2.wiki') }}</option>
                    <option value="project:">{{ $t('DocsV2.workspace') }}</option>
                    <option v-for="project in projects" :key="'vs-' + project._id" :value="'project:' + project._id">{{ project.ProjectName }}</option>
                    <option value="agents">{{ $t('DocsV2.agent_drafted') }}</option>
                    <option value="templates">{{ $t('DocsV2.templates') }}</option>
                    <option value="trash">{{ $t('DocsV2.trash') }}</option>
                </select>
                <span class="ah-toolbar__spacer"></span>
                <button type="button" class="ah-btn ah-btn--sm ah-btn--secondary" @click="createDoc({ isWiki: true })">
                    <ShellIcon name="book" :size="13" />{{ $t('DocsV2.new_wiki_page') }}
                </button>
                <button type="button" class="ah-btn ah-btn--sm ah-btn--primary" @click="createDoc({})">
                    <ShellIcon name="plus" :size="13" />{{ $t('DocsV2.new_doc') }}
                </button>
            </div>

            <div class="hub__content ah-scroll">
                <template v-if="view === 'recent'">
                    <section v-if="needsReview.length" class="hub__section">
                        <div class="hub__section-head">
                            <span class="ah-label">{{ $t('DocsV2.needs_review') }}</span>
                            <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" @click="view = 'wiki'">{{ $t('DocsV2.wiki') }}</button>
                        </div>
                        <WikiTable :rows="needsReview.slice(0, 5)" @open="open" @review="markReviewed" />
                    </section>

                    <section class="hub__section">
                        <div class="hub__section-head"><span class="ah-label">{{ $t('DocsV2.recent') }}</span></div>
                        <div v-if="!recent.length" class="hub__empty">
                            <p class="ah-h3">{{ $t('DocsV2.no_recent_title') }}</p>
                            <p class="ah-small">{{ $t('DocsV2.no_recent_hint') }}</p>
                            <div class="hub__empty-actions">
                                <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" @click="createDoc({})">{{ $t('DocsV2.new_doc') }}</button>
                                <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="view = 'templates'">{{ $t('DocsV2.templates') }}</button>
                            </div>
                        </div>
                        <div v-else class="hub__grid">
                            <DocCard v-for="page in recent.slice(0, 6)" :key="'rc-' + page._id" :page="page" @open="open" />
                        </div>
                    </section>

                    <section v-if="agentDrafts.length" class="hub__section">
                        <div class="hub__section-head">
                            <span class="ah-label">{{ $t('DocsV2.agent_drafted') }}</span>
                            <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" @click="view = 'agents'">{{ $t('DocsV2.review') }}</button>
                        </div>
                        <AgentList :rows="agentDrafts.slice(0, 4)" @open="open" @approve="approve" />
                    </section>

                    <section v-for="group in byProject" :key="'grp-' + group.id" class="hub__section">
                        <div class="hub__section-head">
                            <span class="ah-label">{{ group.name }}</span>
                            <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" @click="view = 'project:' + group.id">{{ $t('DocsV2.by_project') }}</button>
                        </div>
                        <DocList :rows="group.pages.slice(0, 6)" @open="open" />
                    </section>
                </template>

                <template v-else-if="view === 'mine'">
                    <div v-if="!mine.length" class="hub__empty"><p class="ah-small">{{ $t('DocsV2.no_mine') }}</p></div>
                    <div v-else class="hub__grid">
                        <DocCard v-for="page in mine" :key="'mc-' + page._id" :page="page" @open="open" />
                    </div>
                </template>

                <template v-else-if="view === 'wiki'">
                    <div class="hub__section-head">
                        <span class="ah-label">{{ $t('DocsV2.pages_count', { n: wikiPages.length }) }}<template v-if="staleCount"> · {{ $t('DocsV2.stale_count', { n: staleCount }) }}</template></span>
                        <button type="button" class="ah-btn ah-btn--sm" :class="onlyDue ? 'ah-btn--outline' : 'ah-btn--secondary'" @click="onlyDue = !onlyDue">{{ $t('DocsV2.needs_review') }}</button>
                    </div>
                    <div v-if="!wikiRows.length" class="hub__empty"><p class="ah-small">{{ onlyDue ? $t('DocsV2.no_review_due') : $t('DocsV2.no_project_docs') }}</p></div>
                    <WikiTable v-else :rows="wikiRows" @open="open" @review="markReviewed" />
                </template>

                <template v-else-if="view === 'agents'">
                    <div v-if="!agentDrafts.length" class="hub__empty">
                        <p class="ah-h3">{{ $t('DocsV2.no_agent_drafts_title') }}</p>
                        <p class="ah-small">{{ $t('DocsV2.no_agent_drafts_hint') }}</p>
                    </div>
                    <AgentList v-else :rows="agentDrafts" @open="open" @approve="approve" />
                </template>

                <template v-else-if="view === 'templates'">
                    <p class="ah-small hub__hint">{{ $t('DocsV2.templates_hint') }}</p>
                    <div class="hub__grid">
                        <button v-for="tpl in templates" :key="'tpl-' + tpl.key" type="button" class="ah-card hub__tpl" @click="createDoc({ template: tpl })">
                            <span class="hub__tpl-icon"><ShellIcon :name="tpl.icon" :size="16" /></span>
                            <span class="hub__card-title">{{ $t(tpl.label) }}</span>
                            <span class="hub__card-excerpt">{{ $t(tpl.hint) }}</span>
                            <span class="hub__tpl-cta">{{ $t('DocsV2.use_template') }}</span>
                        </button>
                        <button type="button" class="hub__blank" @click="createDoc({})">+ {{ $t('DocsV2.blank_doc') }}</button>
                    </div>
                </template>

                <template v-else-if="view === 'trash'">
                    <div v-if="!trash.length" class="hub__empty">
                        <p class="ah-small">{{ $t('DocsV2.no_trash') }}</p>
                        <p class="ah-small">{{ $t('DocsV2.trash_hint') }}</p>
                    </div>
                    <div v-else class="ah-card hub__list">
                        <div v-for="page in trash" :key="'tr-' + page._id" class="hub__row">
                            <ShellIcon name="file" :size="14" class="hub__row-icon" />
                            <span class="hub__row-title">{{ page.title || $t('DocsV2.untitled') }}</span>
                            <span class="hub__row-project">{{ projectNameOf(page.ProjectID) }}</span>
                            <span class="hub__row-time">{{ shortDate(page.updatedAt) }}</span>
                            <button type="button" class="ah-btn ah-btn--sm ah-btn--secondary" @click="restore(page)">
                                <ShellIcon name="restore" :size="13" />{{ $t('DocsV2.restore') }}
                            </button>
                        </div>
                    </div>
                </template>

                <template v-else>
                    <div class="hub__section-head">
                        <span class="ah-label">{{ projectNameOf(viewProjectId) }}</span>
                        <button type="button" class="ah-btn ah-btn--sm ah-btn--secondary" @click="createDoc({ projectId: viewProjectId })">
                            <ShellIcon name="plus" :size="13" />{{ $t('DocsV2.new_doc') }}
                        </button>
                    </div>
                    <div v-if="!projectRows.length" class="hub__empty"><p class="ah-small">{{ $t('DocsV2.no_project_docs') }}</p></div>
                    <DocList v-else :rows="projectRows" tree @open="open" />
                </template>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, defineComponent, h, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { useStore } from 'vuex';
import { useToast } from 'vue-toast-notification';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { useGetterFunctions } from '@/composable';
import templates from '@/components/molecules/Pages/pageTemplates';
import { relativeTime, shortDate, initials, reviewChipClass, reviewLabelKey } from '@/components/molecules/Pages/docsFormat';

defineOptions({ name: 'PagesSpace' });

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const store = useStore();
const $toast = useToast();
const { getUser } = useGetterFunctions();

const SWATCHES = ['var(--brand)', 'var(--ok)', 'var(--warn)', 'var(--agent)', 'var(--danger)'];

const pages = ref([]);
const trash = ref([]);
const query = ref('');
const view = ref('recent');
const onlyDue = ref(false);
const me = localStorage.getItem('userId') || '';

const projects = computed(() => {
    const all = store.getters['projectData/allProjects'];
    return ((all && all.data) || []).filter((p) => p && p.ProjectName);
});

function projectNameOf(id) {
    if (!id) return t('DocsV2.workspace');
    const found = projects.value.find((p) => String(p._id) === String(id));
    return found ? found.ProjectName : t('DocsV2.workspace');
}

function swatch(id) {
    const index = projects.value.findIndex((p) => String(p._id) === String(id));
    return SWATCHES[(index < 0 ? 0 : index) % SWATCHES.length];
}

function userOf(id) {
    const user = id ? getUser(String(id)) : null;
    if (!user || user.ghostUser) return null;
    return { name: user.Employee_Name, image: user.Employee_profileImageURL, initials: initials(user.Employee_Name) };
}

const filtered = computed(() => {
    const term = query.value.trim().toLowerCase();
    if (!term) return pages.value;
    return pages.value.filter((p) => String(p.title || '').toLowerCase().includes(term) || String(p.excerpt || '').toLowerCase().includes(term));
});
const byTime = (a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
const recent = computed(() => [...filtered.value].sort(byTime));
const mine = computed(() => recent.value.filter((p) => String(p.createdBy || '') === me));
const wikiPages = computed(() => recent.value.filter((p) => p.isWiki));
const needsReview = computed(() => wikiPages.value.filter((p) => p.reviewState === 'due' || p.reviewState === 'stale'));
const staleCount = computed(() => pages.value.filter((p) => p.isWiki && p.reviewState === 'stale').length);
const wikiRows = computed(() => (onlyDue.value ? needsReview.value : wikiPages.value));
const agentDrafts = computed(() => recent.value.filter((p) => p.createdByAgent && p.agentStatus !== 'approved'));
const viewProjectId = computed(() => (view.value.startsWith('project:') ? view.value.slice('project:'.length) : ''));

const byProject = computed(() => {
    const groups = new Map();
    recent.value.forEach((p) => {
        const id = p.ProjectID ? String(p.ProjectID) : '';
        if (!groups.has(id)) groups.set(id, { id, name: projectNameOf(id), pages: [] });
        groups.get(id).pages.push(p);
    });
    return [...groups.values()].sort((a, b) => (a.id === '' ? 1 : b.id === '' ? -1 : a.name.localeCompare(b.name)));
});

function countFor(projectId) {
    return pages.value.filter((p) => String(p.ProjectID || '') === projectId).length;
}

/* That project's pages as a tree, flattened with a depth. */
const projectRows = computed(() => {
    const list = filtered.value.filter((p) => String(p.ProjectID || '') === viewProjectId.value);
    const ids = new Set(list.map((p) => String(p._id)));
    const byParent = new Map();
    list.forEach((p) => {
        const parent = p.parentPageId && ids.has(String(p.parentPageId)) ? String(p.parentPageId) : '';
        if (!byParent.has(parent)) byParent.set(parent, []);
        byParent.get(parent).push(p);
    });
    const out = [];
    const walk = (parent, depth) => {
        (byParent.get(parent) || []).sort((a, b) => (a.order || 0) - (b.order || 0)).forEach((p) => {
            out.push({ ...p, depth });
            walk(String(p._id), depth + 1);
        });
    };
    walk('', 0);
    return out;
});

function fetchPages() {
    apiRequest('get', `${env.PAGES}?scope=all`)
        .then((response) => { pages.value = response.data?.status ? (response.data.data || []) : []; })
        .catch((error) => console.error('ERROR in fetch docs: ', error));
}

function fetchTrash() {
    apiRequest('get', `${env.PAGES}?scope=trash`)
        .then((response) => { trash.value = response.data?.status ? [...(response.data.data || [])].sort(byTime) : []; })
        .catch((error) => console.error('ERROR in fetch trash: ', error));
}

watch(view, (value) => { if (value === 'trash') fetchTrash(); });

onMounted(() => {
    fetchPages();
    if (!projects.value.length) {
        store.dispatch('projectData/setProjects', { roleType: store.getters['settings/companyUserDetail']?.roleType })
            .catch((error) => console.error('ERROR in load projects for docs: ', error));
    }
});

function open(page) {
    router.push({ name: 'PageEditor', params: { cid: route.params.cid, pageId: String(page._id) } });
}

function createDoc({ projectId = '', isWiki = false, template = null }) {
    const body = {
        title: template ? t(template.label) : t('DocsV2.untitled'),
        ...(projectId ? { projectId } : {}),
        ...(isWiki || (template && template.wiki) ? { isWiki: true } : {}),
        ...(template ? { contentBlocks: template.blocks } : {}),
    };
    apiRequest('post', env.PAGES, body)
        .then((response) => {
            if (response.data?.status) open(response.data.data);
            else $toast.error(response.data?.statusText || t('Toast.something_went_wrong'), { position: 'top-right' });
        })
        .catch((error) => console.error('ERROR in create doc: ', error));
}

function approve(page) {
    apiRequest('put', `${env.PAGES}/${page._id}/approve`, {})
        .then((response) => {
            if (response.data?.status) {
                $toast.success(response.data.statusText, { position: 'top-right' });
                fetchPages();
            } else {
                $toast.error(response.data?.statusText || t('Toast.something_went_wrong'), { position: 'top-right' });
            }
        })
        .catch((error) => console.error('ERROR in approve doc: ', error));
}

function markReviewed(page) {
    apiRequest('put', `${env.PAGES}/${page._id}/review`, {})
        .then((response) => {
            if (response.data?.status) {
                $toast.success(t('DocsV2.marked_reviewed'), { position: 'top-right' });
                fetchPages();
            } else {
                $toast.error(response.data?.statusText || t('Toast.something_went_wrong'), { position: 'top-right' });
            }
        })
        .catch((error) => console.error('ERROR in mark reviewed: ', error));
}

function restore(page) {
    apiRequest('put', `${env.PAGES}/${page._id}/restore`, {})
        .then((response) => {
            if (response.data?.status) {
                fetchPages();
                fetchTrash();
            } else {
                $toast.error(response.data?.statusText || t('Toast.something_went_wrong'), { position: 'top-right' });
            }
        })
        .catch((error) => console.error('ERROR in restore doc: ', error));
}

const avatarNode = (userId, agent) => {
    if (agent) return h('span', { class: 'ah-avatar ah-avatar--sm ah-avatar--agent' }, h(ShellIcon, { name: 'agent', size: 12 }));
    const user = userOf(userId);
    if (!user) return null;
    return h('span', { class: 'ah-avatar ah-avatar--sm', title: user.name }, user.image ? h('img', { src: user.image, alt: '' }) : user.initials);
};

const reviewChip = (page) => (page.isWiki
    ? h('span', { class: ['ah-chip', reviewChipClass(page.reviewState)] }, t(reviewLabelKey(page.reviewState)))
    : null);

const DocCard = defineComponent({
    name: 'DocCard',
    props: { page: { type: Object, required: true } },
    emits: ['open'],
    setup(props, { emit }) {
        return () => {
            const page = props.page;
            const agent = Boolean(page.createdByAgent && page.agentStatus !== 'approved');
            return h('button', { type: 'button', class: ['ah-card', 'hub__card', { 'hub__card--agent': agent }], onClick: () => emit('open', page) }, [
                h('span', { class: 'hub__card-title' }, [
                    page.title || t('DocsV2.untitled'),
                    agent ? h('span', { class: 'ah-chip ah-chip--agent ah-chip--mono hub__tag' }, t('DocsV2.agent_draft')) : null,
                ]),
                h('span', { class: 'hub__card-excerpt' }, page.excerpt || t('DocsV2.empty_page_excerpt')),
                h('span', { class: 'hub__card-foot' }, [
                    reviewChip(page),
                    h('span', { class: 'ah-chip hub__card-project' }, projectNameOf(page.ProjectID)),
                    h('span', { class: 'hub__card-meta' }, [
                        avatarNode(page.updatedBy, page.createdByAgent),
                        h('span', { class: 'hub__mono' }, relativeTime(page.updatedAt, t)),
                    ]),
                ]),
            ]);
        };
    },
});

const DocList = defineComponent({
    name: 'DocList',
    props: { rows: { type: Array, default: () => [] }, tree: { type: Boolean, default: false } },
    emits: ['open'],
    setup(props, { emit }) {
        return () => h('div', { class: 'ah-card hub__list' }, props.rows.map((page) => h('button', {
            type: 'button',
            key: page._id,
            class: 'hub__row',
            style: props.tree ? { paddingLeft: `${14 + (page.depth || 0) * 18}px` } : null,
            onClick: () => emit('open', page),
        }, [
            h(ShellIcon, { name: page.isWiki ? 'book' : 'file', size: 14, class: 'hub__row-icon' }),
            h('span', { class: 'hub__row-title' }, page.title || t('DocsV2.untitled')),
            page.createdByAgent && page.agentStatus !== 'approved' ? h('span', { class: 'ah-chip ah-chip--agent ah-chip--mono hub__tag' }, t('DocsV2.agent')) : null,
            reviewChip(page),
            props.tree ? null : h('span', { class: 'hub__row-project' }, projectNameOf(page.ProjectID)),
            h('span', { class: 'hub__row-time' }, shortDate(page.updatedAt)),
        ])));
    },
});

const AgentList = defineComponent({
    name: 'AgentList',
    props: { rows: { type: Array, default: () => [] } },
    emits: ['open', 'approve'],
    setup(props, { emit }) {
        return () => h('div', { class: 'ah-card hub__list' }, props.rows.map((page) => h('div', { key: page._id, class: 'hub__row hub__row--agent' }, [
            avatarNode('', true),
            h('span', { class: 'hub__row-main' }, [
                h('span', { class: 'hub__row-title' }, [
                    page.title || t('DocsV2.untitled'),
                    h('span', { class: 'ah-chip ah-chip--agent ah-chip--mono hub__tag' }, t('DocsV2.agent')),
                ]),
                h('span', { class: 'ah-small hub__row-sub' }, page.excerpt || t('DocsV2.empty_page_excerpt')),
            ]),
            h('span', { class: 'hub__row-time' }, [
                page.agentName ? `${t('DocsV2.by_agent', { name: page.agentName })} · ` : '',
                relativeTime(page.updatedAt, t),
            ]),
            h('button', { type: 'button', class: 'ah-btn ah-btn--sm ah-btn--secondary', onClick: () => emit('open', page) }, t('DocsV2.review')),
            h('button', { type: 'button', class: 'ah-btn ah-btn--sm ah-btn--primary', onClick: () => emit('approve', page) }, t('DocsV2.approve')),
        ])));
    },
});

const WikiTable = defineComponent({
    name: 'WikiTable',
    props: { rows: { type: Array, default: () => [] } },
    emits: ['open', 'review'],
    setup(props, { emit }) {
        const dot = (state) => (state === 'verified'
            ? h(ShellIcon, { name: 'check', size: 12 })
            : h('span', { class: ['ah-dot', state === 'stale' ? 'ah-dot--danger' : 'ah-dot--warn'] }));
        return () => h('div', { class: 'ah-card hub__wiki' }, [
            h('div', { class: 'hub__wiki-head' }, [
                h('span', t('DocsV2.page').toUpperCase()),
                h('span', t('DocsV2.owner').toUpperCase()),
                h('span', t('DocsV2.reviewed').toUpperCase()),
                h('span', t('DocsV2.state').toUpperCase()),
                h('span'),
            ]),
            ...props.rows.map((page) => {
                const owner = userOf(page.ownerId);
                return h('div', { key: page._id, class: ['hub__wiki-row', `hub__wiki-row--${page.reviewState}`] }, [
                    h('button', { type: 'button', class: 'hub__wiki-page', onClick: () => emit('open', page) }, [
                        h('span', { class: 'hub__wiki-title' }, page.title || t('DocsV2.untitled')),
                        h('span', { class: 'ah-small hub__row-sub' }, [projectNameOf(page.ProjectID), page.excerpt ? ` · ${page.excerpt}` : '']),
                    ]),
                    h('span', { class: 'hub__wiki-owner' }, owner
                        ? [avatarNode(page.ownerId), owner.name]
                        : [h('span', { class: 'ah-avatar ah-avatar--sm hub__avatar-none' }, '?'), t('DocsV2.no_owner')]),
                    h('span', { class: ['hub__mono', { 'hub__mono--danger': page.reviewState === 'stale' }] }, page.reviewedAt ? shortDate(page.reviewedAt) : '—'),
                    h('span', { class: ['hub__wiki-state', `hub__wiki-state--${page.reviewState}`] }, [dot(page.reviewState), t(reviewLabelKey(page.reviewState))]),
                    h('button', { type: 'button', class: 'ah-btn ah-btn--sm ah-btn--ghost', onClick: () => emit('review', page) }, t('DocsV2.mark_reviewed')),
                ]);
            }),
        ]);
    },
});
</script>

<style>
/* Not scoped on purpose: DocCard, DocList, AgentList and WikiTable are render-function
   components defined in this file, and scoped rules never reach their elements. Every
   selector here is hub__-prefixed, so nothing leaks. */
.hub {
    display: flex; height: 100%; min-height: 0;
    background: var(--canvas); color: var(--ink); font-family: var(--font-ui);
}
.hub__side {
    width: var(--sidebar-w); flex: none;
    background: var(--surface); border-right: 1px solid var(--hairline);
    padding: 14px 10px; display: flex; flex-direction: column; gap: 14px;
    font-size: 13px; overflow-y: auto;
}
.hub__search { position: relative; }
.hub__search-icon { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: var(--ink-3); pointer-events: none; }
.hub__search-input { height: 32px; padding-left: 30px; font-size: 12.5px; }
.hub__nav { display: flex; flex-direction: column; gap: 1px; }
.hub__label { padding: 0 9px 4px; display: flex; align-items: center; }
.hub__item {
    display: flex; align-items: center; gap: 8px;
    padding: 6px 9px; border-radius: 7px; border: 0; background: transparent;
    font: 400 13px var(--font-ui); color: var(--ink); text-align: left; cursor: pointer; width: 100%;
    transition: background var(--t-state) var(--ease);
}
.hub__item:hover { background: var(--surface-hover); }
.hub__item.is-active { background: var(--brand-tint); color: var(--brand); font-weight: 600; }
.hub__item-icon { color: var(--ink-3); flex: none; }
.hub__item.is-active .hub__item-icon { color: var(--brand); }
.hub__item-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hub__item-count { margin-left: auto; font: 500 11px var(--font-mono); color: var(--ink-3); }
.hub__item-badge { margin-left: auto; background: var(--brand); color: #fff; font: 700 10px/1 var(--font-mono); padding: 3px 6px; border-radius: 9px; }
.hub__item-badge--warn { background: var(--warn); }
.hub__swatch { width: 7px; height: 7px; border-radius: 2px; flex: none; }
.hub__swatch--none { background: var(--ink-3); }
.hub__new { margin-top: auto; }

.hub__main { flex: 1; min-width: 0; display: flex; flex-direction: column; min-height: 0; }
.hub__stats { margin-left: 4px; }
.hub__view-select { display: none; height: 30px; border: 1px solid var(--border); border-radius: var(--r-input); background: var(--surface); color: var(--ink); font: 500 12.5px var(--font-ui); padding: 0 8px; }
.hub__content { flex: 1; min-height: 0; overflow-y: auto; padding: 20px 24px 40px; display: flex; flex-direction: column; gap: 16px; }
.hub__section { display: flex; flex-direction: column; gap: 8px; }
.hub__section-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 30px; }
.hub__hint { margin: 0; }
.hub__grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }

.hub__card {
    display: flex; flex-direction: column; gap: 6px; text-align: left;
    padding: 12px 14px; min-height: 130px; cursor: pointer;
    font-family: var(--font-ui); color: var(--ink);
    transition: border-color var(--t-state) var(--ease), box-shadow var(--t-state) var(--ease);
}
.hub__card:hover { border-color: var(--border); box-shadow: var(--shadow-pop); }
.hub__card:focus-visible { outline: none; box-shadow: var(--focus); }
.hub__card--agent { border-color: var(--agent); }
.hub__card-title { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font: 600 13px/1.3 var(--font-ui); }
.hub__tag { height: 16px; padding: 0 4px; font-size: 8.5px; }
.hub__card-excerpt { flex: 1; font: 400 11.5px/1.45 var(--font-ui); color: var(--ink-2); overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; }
.hub__card-foot { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.hub__card-project { max-width: 50%; overflow: hidden; text-overflow: ellipsis; display: inline-block; line-height: 22px; }
.hub__card-meta { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; }
.hub__mono { font: 500 10.5px var(--font-mono); color: var(--ink-3); }
.hub__mono--danger { color: var(--danger-ink); }

.hub__list { display: flex; flex-direction: column; overflow: hidden; }
.hub__row {
    display: flex; align-items: center; gap: 10px;
    padding: 9px 14px; border: 0; border-bottom: 1px solid var(--hairline); background: transparent;
    font: 400 12.5px var(--font-ui); color: var(--ink); text-align: left; width: 100%; cursor: pointer;
    transition: background var(--t-state) var(--ease);
}
.hub__row:last-child { border-bottom: 0; }
.hub__row:hover { background: var(--surface-hover); }
.hub__row--agent { cursor: default; padding: 10px 14px; }
.hub__row--agent:hover { background: transparent; }
.hub__row-icon { color: var(--ink-3); flex: none; }
.hub__row-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: flex; align-items: center; gap: 6px; }
.hub__row-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.hub__row-sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hub__row-project { color: var(--ink-2); flex: none; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hub__row-time { font: 500 10.5px var(--font-mono); color: var(--ink-3); flex: none; }

.hub__wiki { overflow: hidden; }
.hub__wiki-head, .hub__wiki-row {
    display: grid; grid-template-columns: minmax(0, 1fr) 120px 90px 110px 120px; gap: 10px; align-items: center;
    padding: 9px 14px; border-bottom: 1px solid var(--hairline);
}
.hub__wiki-head { font: var(--text-label); letter-spacing: .06em; color: var(--ink-3); }
.hub__wiki-row { padding: 11px 14px; font-size: 12.5px; }
.hub__wiki-row:last-child { border-bottom: 0; }
.hub__wiki-row--stale { background: var(--danger-bg); }
.hub__wiki-page { border: 0; background: transparent; padding: 0; text-align: left; cursor: pointer; display: flex; flex-direction: column; gap: 2px; min-width: 0; font-family: var(--font-ui); color: var(--ink); }
.hub__wiki-page:hover .hub__wiki-title { color: var(--brand); }
.hub__wiki-title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hub__wiki-owner { display: flex; align-items: center; gap: 6px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hub__avatar-none { background: var(--surface-hover); color: var(--ink-2); }
.hub__wiki-state { display: flex; align-items: center; gap: 5px; font-size: 11.5px; font-weight: 600; }
.hub__wiki-state--verified { color: var(--ok-ink); }
.hub__wiki-state--due { color: var(--warn-ink); }
.hub__wiki-state--stale { color: var(--danger-ink); }

.hub__tpl { align-items: flex-start; gap: 6px; padding: 12px 14px; min-height: 130px; text-align: left; cursor: pointer; display: flex; flex-direction: column; font-family: var(--font-ui); color: var(--ink); }
.hub__tpl:hover { border-color: var(--border); box-shadow: var(--shadow-pop); }
.hub__tpl-icon { width: 26px; height: 26px; border-radius: 7px; background: var(--brand-tint); color: var(--brand); display: inline-grid; place-items: center; }
.hub__tpl-cta { margin-top: auto; font: 600 12px var(--font-ui); color: var(--brand); }
.hub__blank {
    border: 1.5px dashed rgba(47, 57, 144, .35); border-radius: var(--r-card); background: transparent;
    min-height: 130px; display: grid; place-items: center; cursor: pointer;
    font: 600 12.5px var(--font-ui); color: var(--brand);
}
.hub__blank:hover { background: var(--brand-tint); }

.hub__empty { border: 1px dashed var(--border); border-radius: 10px; padding: 22px; background: var(--surface-2); display: flex; flex-direction: column; gap: 6px; }
.hub__empty p { margin: 0; }
.hub__empty-actions { display: flex; gap: 8px; margin-top: 6px; }

@media (max-width: 1279px) {
    .hub__side { display: none; }
    .hub__view-select { display: inline-block; }
    .hub__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 767px) {
    .hub__content { padding: 14px 16px 32px; }
    .hub__grid { grid-template-columns: 1fr; }
    .hub__wiki-head { display: none; }
    .hub__wiki-row { grid-template-columns: 1fr 1fr; }
    .hub__row-project { display: none; }
    .hub__stats { display: none; }
}
</style>
