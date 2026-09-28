<template>
    <template v-if="shown">
        <aside id="project-tree-panel" class="ptp" :class="{ 'ptp--drawer': !wide }" :aria-label="$t('ProjectTree.label')" @keydown.esc="closeDrawer">
            <div class="ptp__head">
                <span class="ptp__title">{{ $t('ProjectTree.label') }}</span>
                <button v-if="!wide" ref="closeButton" type="button" class="ptp__close" :aria-label="$t('ProjectTree.close')" :title="$t('ProjectTree.close')" @click="closeDrawer">
                    <ShellIcon name="x" :size="14" />
                </button>
            </div>
            <ProjectTree :projects="treeProjects" :label="$t('ProjectTree.label')" />
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
    padding: 12px 8px;
    background: var(--surface);
    border-right: 1px solid var(--hairline);
    display: flex;
    flex-direction: column;
    gap: 8px;
    scrollbar-width: thin;
}
.ptp ~ .section-right { min-width: 0; }
.ptp__head { display: flex; align-items: center; justify-content: space-between; padding: 0 9px; min-height: 24px; }
.ptp__title { font: 600 10px/1.2 var(--font-mono); letter-spacing: .06em; text-transform: uppercase; color: var(--ink-2); }
.ptp__close { border: 0; background: transparent; color: var(--ink-2); cursor: pointer; padding: 4px; border-radius: 5px; line-height: 0; min-width: 28px; min-height: 28px; display: inline-flex; align-items: center; justify-content: center; }
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
