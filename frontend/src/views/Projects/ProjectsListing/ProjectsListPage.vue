<template>
    <div class="ah-page pl2">
        <div class="pl2__head">
            <h1 class="ah-h1">{{ $t('ProjectsV2.title') }}</h1>
            <span class="pl2__counts">{{ $t('ProjectsV2.counts', { active: activeCount, archived: archivedCount }) }}</span>
            <div class="pl2__head-actions">
                <div class="pl2__filter">
                    <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :class="{ 'is-on': filterOn }" @click.stop="menuFor = ''; filterOpen = !filterOpen">
                        <ShellIcon name="grip" :size="14" />{{ $t('ProjectsV2.filter') }}
                    </button>
                    <div v-if="filterOpen" class="ah-pop pl2__pop" @click.stop>
                        <div class="ah-pop__label ah-label">{{ $t('ProjectsV2.show') }}</div>
                        <button type="button" class="ah-pop__item" :class="{ 'is-active': !showArchived }" @click="showArchived = false; filterOpen = false">{{ $t('ProjectsV2.active_only') }}</button>
                        <button type="button" class="ah-pop__item" :class="{ 'is-active': showArchived }" @click="showArchived = true; filterOpen = false">{{ $t('ProjectsV2.archived_only') }}</button>
                        <div class="ah-pop__sep"></div>
                        <button type="button" class="ah-pop__item" :class="{ 'is-active': onlyFavourites }" @click="onlyFavourites = !onlyFavourites">{{ $t('ProjectsV2.favourites_only') }}</button>
                    </div>
                </div>
                <router-link v-if="hasPortfolio" class="ah-btn ah-btn--secondary ah-btn--sm" :to="{ name: 'Portfolio', params: { cid: companyId } }">{{ $t('ProjectsV2.portfolio_view') }}</router-link>
                <button v-if="canCreate" type="button" class="ah-btn ah-btn--primary ah-btn--sm" @click="creating = true">
                    <ShellIcon name="plus" :size="14" />{{ $t('ProjectsV2.new_project') }}
                </button>
            </div>
        </div>

        <div v-if="rows.length" class="ah-card pl2__table">
            <div class="pl2__row pl2__row--head">
                <span class="ah-label">{{ $t('ProjectsV2.col_project') }}</span>
                <span class="ah-label">{{ $t('ProjectsV2.col_health') }}</span>
                <span class="ah-label">{{ $t('ProjectsV2.col_sprint') }}</span>
                <span class="ah-label">{{ $t('ProjectsV2.col_progress') }}</span>
                <span class="ah-label">{{ $t('ProjectsV2.col_owner') }}</span>
                <span></span>
            </div>

            <div
                v-for="project in rows"
                :key="project._id"
                :ref="(el) => observeRow(el, project._id)"
                class="pl2__row"
                :class="{ 'pl2__row--muted': isArchived(project) }"
                role="button"
                tabindex="0"
                @click="openProject(project)"
                @keydown.enter="openProject(project)"
            >
                <div class="pl2__name">
                    <span class="pl2__swatch" :style="{ background: swatch(project) }"></span>
                    <span class="pl2__title" :title="project.ProjectName">{{ project.ProjectName }}</span>
                    <button
                        type="button"
                        class="pl2__star"
                        :class="{ 'is-on': isFavourite(project) }"
                        :aria-label="$t('ProjectsV2.favourite')"
                        :title="$t('ProjectsV2.favourite')"
                        @click.stop="toggleFavourite(project)"
                    >
                        <ShellIcon name="star" :size="13" />
                    </button>
                    <span v-if="isSample(project)" class="pl2__sample">{{ $t('ProjectsV2.sample') }}</span>
                    <span v-if="isArchived(project)" class="ah-chip">{{ $t('ProjectsV2.archived') }}</span>
                </div>

                <span class="pl2__health" :class="`pl2__health--${health(project).key}`" :title="healthTitle(project)">
                    <span class="ah-dot" :class="healthDotClass(project)"></span>{{ health(project).label }}
                </span>

                <span class="pl2__sprint">{{ sprintLabel(project) }}</span>

                <div class="pl2__bar" :title="progressTitle(project)">
                    <div class="pl2__bar-fill" :style="{ width: progressPct(project) + '%' }"></div>
                </div>

                <span class="ah-avatar ah-avatar--sm" :style="{ background: swatch(project) }" :title="ownerName(project)">{{ ownerInitial(project) }}</span>

                <div class="pl2__menu" @click.stop>
                    <button
                        v-if="isSample(project) && canDelete(project)"
                        type="button"
                        class="pl2__delete"
                        @click="askDelete(project)"
                    >{{ $t('ProjectsV2.remove_sample') }}</button>
                    <template v-else>
                        <button type="button" class="pl2__dots" :aria-label="$t('ProjectsV2.row_menu')" @click.stop="filterOpen = false; menuFor = menuFor === project._id ? '' : project._id">
                            <ShellIcon name="more" :size="15" />
                        </button>
                        <div v-if="menuFor === project._id" class="ah-pop pl2__pop pl2__pop--row">
                            <button type="button" class="ah-pop__item" @click="menuFor = ''; openProject(project)">{{ $t('ProjectsV2.open') }}</button>
                            <button type="button" class="ah-pop__item" @click="menuFor = ''; toggleFavourite(project)">
                                {{ isFavourite(project) ? $t('ProjectsV2.unfavourite') : $t('ProjectsV2.favourite') }}
                            </button>
                            <template v-if="isArchived(project)">
                                <div class="ah-pop__sep"></div>
                                <button type="button" class="ah-pop__item" @click="menuFor = ''; restore(project)">{{ $t('ProjectsV2.restore') }}</button>
                            </template>
                            <template v-else>
                                <div class="ah-pop__sep"></div>
                                <button v-if="canClose(project)" type="button" class="ah-pop__item" @click="menuFor = ''; ask(project, 0)">{{ $t('ProjectsV2.close_project') }}</button>
                                <button v-if="canDelete(project)" type="button" class="ah-pop__item" @click="menuFor = ''; ask(project, 1)">{{ $t('ProjectsV2.archive') }}</button>
                            </template>
                            <button v-if="canDelete(project)" type="button" class="ah-pop__item pl2__pop-danger" @click="menuFor = ''; ask(project, 2)">{{ $t('ProjectsV2.delete') }}</button>
                        </div>
                    </template>
                </div>
            </div>
        </div>

        <div v-else-if="showArchived" class="ah-empty">
            {{ $t('ProjectsV2.empty_archived') }}
            <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="showArchived = false">{{ $t('ProjectsV2.active_only') }}</button>
        </div>

        <div v-else class="ah-card pl2__empty">
            <h2 class="ah-h2">{{ $t('ProjectsV2.empty_title') }}</h2>
            <p class="ah-small pl2__empty-lead">{{ $t('ProjectsV2.empty_lead') }}</p>
            <div class="pl2__empty-actions">
                <button v-if="canCreate" type="button" class="ah-btn ah-btn--primary" @click="creating = true">{{ $t('ProjectsV2.pick_template') }}</button>
                <button v-if="canCreate && aiEnabled" type="button" class="ah-btn ah-btn--outline" @click="aiCreating = true">{{ $t('ProjectsV2.create_with_ai') }}</button>
            </div>
        </div>

        <p v-if="rows.length" class="pl2__note">{{ $t('ProjectsV2.health_note') }}</p>

        <CreateProjectSidebar
            v-if="creating"
            :isActiveCreateSidebar="creating"
            @click:closeSidebar="creating = false"
            @closeSidebar="creating = false"
        />
        <AiProjectCreator v-if="aiCreating" :visible="aiCreating" @close="aiCreating = false" @created="onAiCreated" />

        <ConfirmationSidebar
            v-model="confirmOpen"
            :title="confirmTitle"
            :message="confirmMessage"
            :confirmationString="confirmWord"
            :acceptButtonClass="pendingMode === 1 ? 'btn-primary' : 'btn-danger'"
            :acceptButton="confirmTitle"
            :showSpinner="showSpinner"
            @confirm="runConfirmed"
        />
    </div>
</template>

<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue';
import { useStore } from 'vuex';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useCustomComposable, useGetterFunctions } from '@/composable';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';
import ConfirmationSidebar from '@/components/molecules/ConfirmationSidebar/ConfirmationSidebar.vue';
import CreateProjectSidebar from '@/components/organisms/CreateProject/CreateProjectSidebar.vue';
import AiProjectCreator from '@/components/organisms/AiProjectCreator/AiProjectCreator.vue';
import { SAMPLE_PROJECT_NAME } from '@/components/organisms/CreateProject/templates';
import { useProjectsHelper } from '../helper';
import { useProjectLifecycle } from '../composables/useProjectLifecycle';
import { lifecycleOf, ARCHIVED, TRASHED } from '@/utils/lifecycle';
import { deriveHealth, loadProjectSnapshot, projectSnapshot, sprintWindow } from './useProjectHealth';

const { t } = useI18n();
const { getters } = useStore();
const route = useRoute();
const router = useRouter();
const { checkPermission } = useCustomComposable();
const { getUser } = useGetterFunctions();
const { dispatchProjects } = useProjectsHelper();

const userId = inject('$userId');
const companyId = inject('$companyId');

const showArchived = ref(false);
const isArchived = (project) => lifecycleOf(project, 'project') === ARCHIVED;
const onlyFavourites = ref(localStorage.getItem('favoriteFilter') === 'true');
const filterOpen = ref(false);
const menuFor = ref('');
const creating = ref(false);
const aiCreating = ref(false);

// The lifecycle composable acts on one project at a time; the row menu points it
// at whichever row the user chose before confirming.
const pending = ref({});
const pendingMode = ref(2);
const confirmOpen = ref(false);
const { archive, showSpinner, updateProject, markProjectFavourite } = useProjectLifecycle(pending);

const allProjects = computed(() => getters['projectData/allProjects']?.data || []);
const currentCompany = computed(() => getters['settings/selectedCompany'] || {});
const aiEnabled = computed(() => Boolean(currentCompany.value?.planFeature?.aiPermission));
const hasPortfolio = computed(() => router.hasRoute('Portfolio'));
const canCreate = computed(() => checkPermission('project.project_create') === true);

const visible = computed(() => allProjects.value.filter((p) => p && !p.isPersonal && lifecycleOf(p, 'project') !== TRASHED));
const activeCount = computed(() => visible.value.filter((p) => !isArchived(p)).length);
const archivedCount = computed(() => visible.value.filter((p) => isArchived(p)).length);
const filterOn = computed(() => showArchived.value || onlyFavourites.value);

const isFavourite = (project) => Boolean((project.favouriteTasks || []).find((x) => x.userId === userId.value));

const rows = computed(() => {
    let list = visible.value.filter((p) => (showArchived.value ? isArchived(p) : !isArchived(p)));
    if (onlyFavourites.value) list = list.filter(isFavourite);
    const rank = (p) => (isFavourite(p) ? 0 : 1);
    return [...list].sort((a, b) => rank(a) - rank(b) || new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
});

const isSample = (project) => project.ProjectName === SAMPLE_PROJECT_NAME || project.ProjectCode === 'WELCOME';
const canClose = (project) => checkPermission('project.project_close', project.isGlobalPermission) === true;
const canDelete = (project) => checkPermission('project.project_delete', project.isGlobalPermission) === true;

const PALETTE = ['#2F3990', '#2f9e7e', '#d98324', '#6b5ce7', '#0EA5E9', '#EC4899'];
function swatch(project) {
    if (project.projectIcon?.type === 'color' && project.projectIcon?.data) return project.projectIcon.data;
    const hash = Array.from(String(project.ProjectName || '')).reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 7);
    return PALETTE[hash % PALETTE.length];
}

function ownerId(project) {
    return (project.LeadUserId && project.LeadUserId[0]) || project.projectCreatedBy || '';
}
const ownerName = (project) => getUser(ownerId(project))?.Employee_Name || '';
const ownerInitial = (project) => (ownerName(project) || '?').charAt(0).toUpperCase();

const snapOf = (project) => projectSnapshot(project._id);
const health = (project) => deriveHealth(project, snapOf(project));
const healthDotClass = (project) => {
    const key = health(project).key;
    if (key === 'on-track') return 'ah-dot--ok';
    if (key === 'at-risk') return 'ah-dot--warn';
    if (key === 'blocked') return 'ah-dot--danger';
    return '';
};
function healthTitle(project) {
    const h = health(project);
    return [h.label, h.bySource, ...h.reasons].filter(Boolean).join(' — ');
}

function sprintLabel(project) {
    const snap = snapOf(project);
    if (!snap || !snap.loaded) return '…';
    if (!snap.sprint) return '—';
    const win = sprintWindow(snap.sprint);
    if (!win) return snap.sprint.name || '—';
    return `${snap.sprint.name} · ${t('ProjectsV2.days_left', { n: win.daysLeft })}`;
}

const progressPct = (project) => {
    const snap = snapOf(project);
    return snap && snap.loaded ? snap.progressPct : 0;
};
function progressTitle(project) {
    const snap = snapOf(project);
    if (!snap || !snap.loaded) return '';
    return t('ProjectsV2.progress_title', { done: snap.done, total: snap.total, pct: snap.progressPct });
}

// Each row asks the server for its own numbers only once it is on screen.
const observer = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            loadProjectSnapshot(entry.target.dataset.projectId);
            observer.unobserve(entry.target);
        });
    }, { rootMargin: '200px' })
    : null;

function observeRow(el, id) {
    if (!el) return;
    if (!observer) { loadProjectSnapshot(id); return; }
    el.dataset.projectId = String(id);
    observer.observe(el);
}

function openProject(project) {
    router.push({ name: 'Project', params: { cid: companyId.value, id: project._id } });
}

function toggleFavourite(project) {
    pending.value = project;
    markProjectFavourite();
}

const confirmTitle = computed(() => (pendingMode.value === 0 ? t('ProjectsV2.close_project') : pendingMode.value === 1 ? t('ProjectsV2.archive') : t('ProjectsV2.delete')));
const confirmWord = computed(() => (pendingMode.value === 0 ? 'close' : pendingMode.value === 1 ? 'archive' : 'delete'));
const confirmMessage = computed(() => t('ProjectsV2.confirm_message', { name: pending.value?.ProjectName || '' }));

function ask(project, mode) {
    pending.value = project;
    pendingMode.value = mode;
    archive.value = mode;
    confirmOpen.value = true;
}
const askDelete = (project) => ask(project, 2);

async function runConfirmed() {
    await updateProject();
    confirmOpen.value = false;
}

async function restore(project) {
    pending.value = project;
    await updateProject(0);
}

function onAiCreated(project) {
    aiCreating.value = false;
    if (project?._id) openProject(project);
}

const closeMenus = () => {
    filterOpen.value = false;
    menuFor.value = '';
};

onMounted(() => {
    // ⌘K "new project" lands here with ?create=project.
    if (route.query?.create === 'project') creating.value = true;
    dispatchProjects().catch(() => {});
    document.addEventListener('click', closeMenus);
});

onBeforeUnmount(() => {
    if (observer) observer.disconnect();
    document.removeEventListener('click', closeMenus);
});
</script>

<style>
@import "./projects-list.css";
</style>
