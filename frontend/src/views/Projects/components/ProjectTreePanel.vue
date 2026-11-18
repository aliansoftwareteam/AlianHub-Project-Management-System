<template>
    <template v-if="shown">
        <aside id="project-tree-panel" class="ptp" :class="{ 'ptp--drawer': !wide }" :aria-label="$t('ProjectTree.label')" @keydown.esc="closeDrawer">
            <div class="ptp__head">
                <span class="ptp__title">{{ $t('ProjectTree.label') }}</span>
                <button v-if="!wide" ref="closeButton" type="button" class="ptp__close" :aria-label="$t('ProjectTree.close')" :title="$t('ProjectTree.close')" @click="closeDrawer">
                    <ShellIcon name="x" :size="14" />
                </button>
            </div>
            <div class="ptp__search">
                <ShellIcon name="search" :size="13" class="ptp__search-icon" />
                <input
                    v-model="search"
                    type="search"
                    class="ptp__search-input"
                    data-test="project-tree-search"
                    :placeholder="$t('ProjectTree.search_placeholder')"
                    :aria-label="$t('ProjectTree.search_placeholder')"
                    @keydown.esc="clearSearch"
                />
                <button v-if="search" type="button" class="ptp__search-clear" :aria-label="$t('ProjectTree.search_clear')" :title="$t('ProjectTree.search_clear')" @click="search = ''">
                    <ShellIcon name="x" :size="11" />
                </button>
            </div>
            <ProjectTree v-if="shownProjects.length" :projects="shownProjects" :label="$t('ProjectTree.label')" />
            <p v-else-if="searchTerm" class="ptp__empty" data-test="project-tree-search-empty">{{ $t('ProjectTree.search_empty', { query: search.trim() }) }}</p>
        </aside>
        <div v-if="!wide" class="ptp__scrim" @click="closeDrawer"></div>
    </template>
</template>

<script setup>
import { computed, inject, nextTick, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useStore } from "vuex";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import ProjectTree from "@/components/molecules/ProjectTree/ProjectTree.vue";
import { isWide, projectTreePanelState, projectTreeShown } from "./projectTreePanelState";

defineOptions({ name: "ProjectTreePanel" });

const props = defineProps({
    projects: { type: Array, default: null }
});

const route = useRoute();
const { getters } = useStore();
const clientWidth = inject("$clientWidth");
const closeButton = ref(null);

const wide = computed(() => isWide(clientWidth?.value));
const shown = computed(() => projectTreeShown(clientWidth?.value));
const treeProjects = computed(() => props.projects || (getters["projectData/projects"]?.data || []).filter((project) => !project.deletedStatusKey));
const search = ref("");
const searchTerm = computed(() => search.value.trim().toLowerCase());
const shownProjects = computed(() => {
    if (!searchTerm.value) return treeProjects.value;
    return treeProjects.value.filter((project) => [project.ProjectName, project.ProjectCode].some((value) => String(value || "").toLowerCase().includes(searchTerm.value)));
});

// Esc with text clears it; on an empty box it falls through and closes the drawer.
function clearSearch(event) {
    if (!search.value) return;
    event.stopPropagation();
    search.value = "";
}

function closeDrawer() {
    if (!wide.value) projectTreePanelState.open = false;
}

watch(() => route.fullPath, closeDrawer);
watch(() => projectTreePanelState.open, (open) => {
    if (open && !wide.value) nextTick(() => closeButton.value?.focus());
});
</script>

<style>
.ptp {
    width: 248px;
    flex: none;
    height: 100%;
    overflow-y: auto;
    overflow-x: hidden;
    box-sizing: border-box;
    padding: var(--sp-5) var(--sp-3);
    background: var(--surface);
    border-right: 1px solid var(--hairline);
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
    scrollbar-width: thin;
}
.ptp ~ .section-right { min-width: 0; }
.ptp__head { display: flex; align-items: center; justify-content: space-between; padding: 0 var(--cell-pad-x, 9px); min-height: var(--hit-min); }
.ptp__title { font: 600 var(--fs-2xs, 10px)/var(--lh-tight, 1.2) var(--font-mono); letter-spacing: .06em; text-transform: uppercase; color: var(--ink-2); }
.ptp__close {
    border: 0; background: transparent; color: var(--ink-2); cursor: pointer; padding: 0; border-radius: var(--r-sm, 5px); line-height: 0;
    min-width: max(var(--hit-min), var(--control-h-sm, 28px)); min-height: max(var(--hit-min), var(--control-h-sm, 28px));
    display: inline-flex; align-items: center; justify-content: center;
}
.ptp__search { position: relative; display: flex; align-items: center; margin: 0 var(--sp-1, 2px); }
.ptp__search-icon { position: absolute; left: 9px; color: var(--ink-2); pointer-events: none; }
.ptp__search-input {
    width: 100%; height: var(--control-h, 30px); box-sizing: border-box; padding: 0 26px 0 28px;
    border: 1px solid var(--border); border-radius: var(--r-input); background: var(--surface); color: var(--ink);
    font: 400 var(--fs-sm, 12.5px)/1 var(--font-ui);
}
.ptp__search-input::placeholder { color: var(--ink-2); }
.ptp__search-input:focus { outline: none; border-color: var(--brand); box-shadow: var(--focus); }
.ptp__search-input::-webkit-search-cancel-button { display: none; }
.ptp__search-clear {
    position: absolute; right: 5px; width: 18px; height: 18px; padding: 0; border: 0; border-radius: var(--r-sm, 5px);
    background: transparent; color: var(--ink-2); cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
}
.ptp__search-clear:hover { color: var(--ink); background: var(--surface-hover); }
.ptp__empty { margin: 0; padding: var(--sp-2, 4px) var(--cell-pad-x, 9px); font: 400 var(--fs-sm, 12.5px)/1.4 var(--font-ui); color: var(--ink-2); }
.ptp__close:hover { color: var(--ink); background: var(--surface-hover); }
.ptp__close:focus-visible { outline: none; box-shadow: var(--focus); }
.ptp--drawer {
    position: fixed;
    left: 0;
    top: 0;
    bottom: 0;
    z-index: 60;
    width: min(300px, 86vw);
    box-shadow: var(--shadow-pop);
}
.ptp__scrim { position: fixed; inset: 0; z-index: 59; background: rgba(0, 0, 0, .28); }
</style>
