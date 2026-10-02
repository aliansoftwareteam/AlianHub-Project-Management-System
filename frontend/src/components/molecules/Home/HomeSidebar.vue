<template>
    <ContextSidebar :open="homeState.sidebarOpen" :label="$t('Shell.home')" @close="homeState.sidebarOpen = false">
        <button type="button" class="hs-search" :aria-keyshortcuts="ariaKeyShortcuts('palette')" @click="openPalette">
            <ShellIcon name="search" :size="14" />
            <span>{{ $t('Shell.search') }}</span>
            <KeyHint shortcut="palette" class="hs-search__kbd" />
        </button>

        <nav class="hs-group" :aria-label="$t('Inbox.title')">
            <router-link class="hs-item" :class="{ 'is-active': route.name === 'inbox' && !route.query.tab }" :to="to('inbox')">
                <span class="hs-item__text">{{ $t('Home.inbox') }}</span>
                <span v-if="counts.all" class="hs-item__badge">{{ counts.all }}</span>
            </router-link>
            <router-link class="hs-item" :to="to('inbox', { tab: 'primary' })">
                <span class="hs-item__text">{{ $t('Home.replies_mentions') }}</span>
                <span v-if="counts.mentions" class="hs-item__count">{{ counts.mentions }}</span>
            </router-link>
            <router-link v-if="router.hasRoute('chats')" class="hs-item" :to="to('chats')">
                <span class="hs-item__text">{{ $t('Home.chat_activity') }}</span>
            </router-link>
        </nav>

        <nav class="hs-group" :aria-label="$t('Home.my_tasks')">
            <div class="hs-label">{{ $t('Home.my_tasks') }}</div>
            <router-link class="hs-item" :class="{ 'is-active': route.name === 'Home' && route.query.filter === 'assigned' }" :to="to('Home', { filter: 'assigned' })">
                <span class="hs-item__text">{{ $t('Home.assigned_to_me') }}</span>
                <span class="hs-item__count">{{ assignedCount }}</span>
            </router-link>
            <router-link class="hs-item" :class="{ 'is-active': route.name === 'Home' && !route.query.filter }" :to="to('Home')">
                <span class="hs-item__text">{{ $t('Home.today_overdue') }}</span>
            </router-link>
            <router-link class="hs-item" :class="{ 'is-active': route.name === 'PersonalList' }" :to="to('PersonalList')">
                <span class="hs-item__text">{{ $t('Home.personal_list') }}</span>
                <span v-if="!personalProject" class="hs-item__tag">{{ $t('Home.new_tag') }}</span>
                <span v-else class="hs-item__lock" :title="$t('Home.only_you')"><ShellIcon name="lock" :size="12" /></span>
            </router-link>
        </nav>

        <nav v-if="!hidden.includes('favorites')" class="hs-group" :aria-label="$t('Home.favorites')">
            <div class="hs-label">{{ $t('Home.favorites') }}</div>
            <FavouritesList />
        </nav>

        <nav v-if="!hidden.includes('projects')" class="hs-group" :aria-label="$t('Home.projects')">
            <div class="hs-label">
                {{ $t('Home.projects') }}
                <button v-if="canCreate" type="button" class="hs-label__btn" :title="$t('Home.new_project')" @click="$emit('create-project')"><ShellIcon name="plus" :size="13" /></button>
            </div>
            <ProjectTree v-if="projects.length" :projects="projects" :label="$t('Home.projects')" />
            <div v-else class="hs-empty">{{ $t('Home.no_projects') }}</div>
        </nav>

        <div class="hs-foot__wrap" @click.stop>
            <transition name="ah-fade">
                <div v-if="customizeOpen" class="ah-pop hs-foot__pop">
                    <label class="hs-toggle"><input type="checkbox" class="ah-check" :checked="!hidden.includes('favorites')" @change="toggleSection('favorites')" />{{ $t('Home.show_favorites') }}</label>
                    <label class="hs-toggle"><input type="checkbox" class="ah-check" :checked="!hidden.includes('projects')" @change="toggleSection('projects')" />{{ $t('Home.show_projects') }}</label>
                </div>
            </transition>
            <div class="hs-foot">
                <button type="button" @click="customizeOpen = !customizeOpen">{{ $t('Home.customize_sidebar') }}</button>
                <span>·</span>
                <button type="button" @click="toggleTheme()">{{ shellState.theme === 'dark' ? $t('Shell.theme_light') : $t('Shell.theme_dark') }}</button>
            </div>
        </div>
    </ContextSidebar>
</template>

<script setup>
import { computed, defineEmits, defineProps, inject, onMounted, onUnmounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import ContextSidebar from "@/components/organisms/Shell/ContextSidebar.vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import ProjectTree from "@/components/molecules/ProjectTree/ProjectTree.vue";
import FavouritesList from "@/components/molecules/FavouritesList/FavouritesList.vue";
import { shellState, toggleTheme } from "@/components/organisms/Shell/shellState";
import { useCustomComposable } from "@/composable";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { homeState } from "./homeState";
import { openPalette } from "@/components/molecules/AdvanceSearch/paletteKeys";
import KeyHint from "@/components/atom/KeyHint/KeyHint.vue";
import { ariaKeyShortcuts } from "@/composable/shortcuts";
import { wakeTimer } from "@/views/Inbox/snoozeWake";

defineOptions({ name: "HomeSidebar" });

defineProps({
    assignedCount: { type: Number, default: 0 }
});
defineEmits(["create-project"]);

const route = useRoute();
const router = useRouter();
const { getters } = useStore();
const { checkPermission } = useCustomComposable();
const companyId = inject("$companyId");

const counts = ref({ all: 0, mentions: 0, notifications: 0 });
const customizeOpen = ref(false);

const projects = computed(() => (getters["projectData/projects"]?.data || []).filter((p) => !p.deletedStatusKey));
const personalProject = computed(() => getters["projectData/personalProject"]);
const canCreate = computed(() => checkPermission("project.project_create") === true);
const hidden = computed(() => shellState.nav.hidden || []);

const to = (name, query) => ({ name, params: { cid: companyId.value }, query });
function toggleSection(key) {
    shellState.nav.hidden = hidden.value.includes(key) ? hidden.value.filter((k) => k !== key) : [...hidden.value, key];
}

const snoozeWake = wakeTimer(() => loadCounts());
function loadCounts() {
    apiRequest("get", `${env.INBOX}/counts`)
        .then((response) => {
            if (!response?.data?.status) return;
            counts.value = { all: 0, mentions: 0, notifications: 0, ...response.data.data };
            snoozeWake.schedule(response.data.data);
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
    snoozeWake.clear();
});
</script>
