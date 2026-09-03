<template>
    <ContextSidebar :open="homeState.sidebarOpen" :label="$t('Shell.home')" @close="homeState.sidebarOpen = false">
        <button type="button" class="hs-search" @click="openSearch">
            <ShellIcon name="search" :size="14" />
            <span>{{ $t('Shell.search') }}</span>
            <span class="hs-search__kbd">⌘K</span>
        </button>

        <nav class="hs-group" :aria-label="$t('Inbox.title')">
            <router-link class="hs-item" :class="{ 'is-active': route.name === 'inbox' && !route.query.tab }" :to="to('inbox')">
                <span class="hs-item__text">{{ $t('HomeV2.inbox') }}</span>
                <span v-if="counts.all" class="hs-item__badge">{{ counts.all }}</span>
            </router-link>
            <router-link class="hs-item" :to="to('inbox', { tab: 'primary' })">
                <span class="hs-item__text">{{ $t('HomeV2.replies_mentions') }}</span>
                <span v-if="counts.mentions" class="hs-item__count">{{ counts.mentions }}</span>
            </router-link>
            <router-link v-if="router.hasRoute('chats')" class="hs-item" :to="to('chats')">
                <span class="hs-item__text">{{ $t('HomeV2.chat_activity') }}</span>
            </router-link>
        </nav>

        <nav class="hs-group" :aria-label="$t('HomeV2.my_tasks')">
            <div class="hs-label">{{ $t('HomeV2.my_tasks') }}</div>
            <router-link class="hs-item" :class="{ 'is-active': route.name === 'Home' && route.query.filter === 'assigned' }" :to="to('Home', { filter: 'assigned' })">
                <span class="hs-item__text">{{ $t('HomeV2.assigned_to_me') }}</span>
                <span class="hs-item__count">{{ assignedCount }}</span>
            </router-link>
            <router-link class="hs-item" :class="{ 'is-active': route.name === 'Home' && !route.query.filter }" :to="to('Home')">
                <span class="hs-item__text">{{ $t('HomeV2.today_overdue') }}</span>
            </router-link>
            <router-link class="hs-item" :class="{ 'is-active': route.name === 'PersonalList' }" :to="to('PersonalList')">
                <span class="hs-item__text">{{ $t('HomeV2.personal_list') }}</span>
                <span v-if="!personalProject" class="hs-item__tag">{{ $t('HomeV2.new_tag') }}</span>
                <span v-else class="hs-item__lock" :title="$t('HomeV2.only_you')"><ShellIcon name="lock" :size="12" /></span>
            </router-link>
        </nav>

        <nav v-if="!hidden.includes('favorites')" class="hs-group" :aria-label="$t('HomeV2.favorites')">
            <div class="hs-label">{{ $t('HomeV2.favorites') }}</div>
            <router-link v-for="fav in pinned" :key="fav.id" class="hs-item" :to="fav.to">
                <span class="hs-item__star">★</span>
                <span class="hs-item__text">{{ fav.label }}</span>
                <button type="button" class="hs-item__action" :title="$t('HomeV2.unpin')" @click.prevent.stop="unpin(fav.id)"><ShellIcon name="x" :size="12" /></button>
            </router-link>
            <div v-if="!pinned.length" class="hs-empty">{{ $t('HomeV2.no_favorites') }}</div>
        </nav>

        <nav v-if="!hidden.includes('projects')" class="hs-group" :aria-label="$t('HomeV2.projects')">
            <div class="hs-label">
                {{ $t('HomeV2.projects') }}
                <button v-if="canCreate" type="button" class="hs-label__btn" :title="$t('HomeV2.new_project')" @click="$emit('create-project')"><ShellIcon name="plus" :size="13" /></button>
            </div>
            <template v-for="project in projects" :key="project._id">
                <div class="hs-item" :class="{ 'is-active': isProjectActive(project) }" role="link" tabindex="0" @click="goProject(project)" @keydown.enter="goProject(project)">
                    <span class="hs-item__dot" :style="{ background: projectColor(project) }"></span>
                    <span class="hs-item__text">{{ project.ProjectName }}</span>
                    <button type="button" class="hs-item__action" :class="{ 'is-on': isPinned(project._id) }" :title="isPinned(project._id) ? $t('HomeV2.unpin') : $t('HomeV2.pin')" @click.stop="togglePin(project)">
                        <ShellIcon name="star" :size="12" />
                    </button>
                    <button type="button" class="hs-item__chev" :class="{ 'is-open': expanded[project._id] }" :aria-expanded="!!expanded[project._id]" @click.stop="toggleExpand(project)">
                        <ShellIcon name="chevronDown" :size="12" />
                    </button>
                </div>
                <template v-if="expanded[project._id]">
                    <router-link v-for="sprint in sprintsOf(project._id)" :key="sprint.id" class="hs-item hs-item--child" :to="sprintTo(project, sprint)">
                        <span class="hs-item__text">{{ sprint.name }}</span>
                    </router-link>
                </template>
            </template>
            <div v-if="!projects.length" class="hs-empty">{{ $t('HomeV2.no_projects') }}</div>
        </nav>

        <div class="hs-foot__wrap" @click.stop>
            <transition name="ah-fade">
                <div v-if="customizeOpen" class="ah-pop hs-foot__pop">
                    <label class="hs-toggle"><input type="checkbox" class="ah-check" :checked="!hidden.includes('favorites')" @change="toggleSection('favorites')" />{{ $t('HomeV2.show_favorites') }}</label>
                    <label class="hs-toggle"><input type="checkbox" class="ah-check" :checked="!hidden.includes('projects')" @change="toggleSection('projects')" />{{ $t('HomeV2.show_projects') }}</label>
                </div>
            </transition>
            <div class="hs-foot">
                <button type="button" @click="customizeOpen = !customizeOpen">{{ $t('HomeV2.customize_sidebar') }}</button>
                <span>·</span>
                <button type="button" @click="toggleTheme()">{{ shellState.theme === 'dark' ? $t('Shell.theme_light') : $t('Shell.theme_dark') }}</button>
            </div>
        </div>
    </ContextSidebar>
</template>

<script setup>
import { computed, defineEmits, defineProps, inject, onMounted, onUnmounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import ContextSidebar from "@/components/organisms/Shell/ContextSidebar.vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { shellState, toggleTheme } from "@/components/organisms/Shell/shellState";
import { useCustomComposable } from "@/composable";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { homeState } from "./homeState";
import { projectColor } from "./homeFormat";

defineOptions({ name: "HomeSidebar" });

defineProps({
    assignedCount: { type: Number, default: 0 }
});
defineEmits(["create-project"]);

const route = useRoute();
const router = useRouter();
const { getters, dispatch } = useStore();
const { checkPermission } = useCustomComposable();
const companyId = inject("$companyId");

const counts = ref({ all: 0, mentions: 0, notifications: 0 });
const expanded = reactive({});
const sprintsByProject = reactive({});
const customizeOpen = ref(false);

const projects = computed(() => (getters["projectData/projects"]?.data || []).filter((p) => !p.deletedStatusKey));
const personalProject = computed(() => getters["projectData/personalProject"]);
const canCreate = computed(() => checkPermission("project.project_create") === true);
const pinned = computed(() => shellState.nav.pinned || []);
const hidden = computed(() => shellState.nav.hidden || []);

const to = (name, query) => ({ name, params: { cid: companyId.value }, query });
const isProjectActive = (project) => String(route.params.id || "") === project._id;
const goProject = (project) => router.push({ name: "Project", params: { cid: companyId.value, id: project._id } });
const sprintTo = (project, sprint) => (sprint.folderId
    ? { name: "ProjectFolderSprint", params: { cid: companyId.value, id: project._id, folderId: sprint.folderId, sprintId: sprint.id } }
    : { name: "ProjectSprint", params: { cid: companyId.value, id: project._id, sprintId: sprint.id } });
const sprintsOf = (pid) => sprintsByProject[pid] || [];

function toggleExpand(project) {
    expanded[project._id] = !expanded[project._id];
    if (expanded[project._id] && !sprintsByProject[project._id]) {
        dispatch("projectData/setSprints", { projectId: project._id })
            .then((list) => {
                sprintsByProject[project._id] = (Array.isArray(list) ? list : [])
                    .filter((s) => Number(s.deletedStatusKey || 0) === 0)
                    .map((s) => ({ id: s._id || s.id, name: s.name, folderId: s.folderId || null }));
            })
            .catch((error) => console.error("sprints load failed", error));
    }
}

const isPinned = (id) => pinned.value.some((f) => f.id === id);
function togglePin(project) {
    if (isPinned(project._id)) return unpin(project._id);
    shellState.nav.pinned = [...pinned.value, { id: project._id, type: "project", label: project.ProjectName, to: { name: "Project", params: { cid: companyId.value, id: project._id } } }];
}
function unpin(id) {
    shellState.nav.pinned = pinned.value.filter((f) => f.id !== id);
}
function toggleSection(key) {
    shellState.nav.hidden = hidden.value.includes(key) ? hidden.value.filter((k) => k !== key) : [...hidden.value, key];
}

function openSearch() {
    document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "k", ctrlKey: true }));
}

function loadCounts() {
    apiRequest("get", `${env.INBOX}/counts`)
        .then((response) => {
            if (response?.data?.status) counts.value = { all: 0, mentions: 0, notifications: 0, ...response.data.data };
        })
        .catch(() => {});
}

const closePop = () => { customizeOpen.value = false; };
onMounted(() => {
    loadCounts();
    document.addEventListener("click", closePop);
    document.addEventListener("visibilitychange", loadCounts);
});
onUnmounted(() => {
    document.removeEventListener("click", closePop);
    document.removeEventListener("visibilitychange", loadCounts);
});
</script>
