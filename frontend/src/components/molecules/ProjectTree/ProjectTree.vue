<template>
    <ul ref="treeEl" class="pt" role="tree" :aria-label="label" @keydown="onKeydown" @focusin="onFocusin">
        <li v-for="row in rows" :key="row.key" role="none">
            <div role="none" class="pt-row" :class="[`pt-row--l${row.level}`, { 'is-current': row.key === currentKey }]">
                <router-link
                    role="treeitem"
                    class="pt-row__link"
                    :to="row.to"
                    :data-key="row.key"
                    :tabindex="row.key === focusKey ? 0 : -1"
                    :aria-level="row.level"
                    :aria-setsize="row.setsize"
                    :aria-posinset="row.posinset"
                    :aria-expanded="row.expandable ? String(row.expanded) : undefined"
                    :aria-selected="row.key === currentKey ? 'true' : 'false'"
                    :aria-current="row.key === currentKey ? 'page' : undefined"
                >
                    <span v-if="row.kind === 'project'" class="pt-row__dot" :style="{ background: colorOf(row.id) }"></span>
                    <span class="pt-row__name">{{ row.name }}</span>
                    <template v-if="row.count !== null && row.count !== undefined">
                        <span class="pt-row__count" aria-hidden="true">{{ row.count }}</span>
                        <span class="ah-sr-only">, {{ $t('ProjectTree.tasks', { n: row.count }) }}</span>
                    </template>
                </router-link>
                <FavouriteStar
                    class="pt-row__star"
                    :type="row.kind"
                    :id="row.id"
                    :name="row.name"
                    :projectId="row.projectId"
                    :folderId="row.folderId"
                    :size="12"
                    tabindex="-1"
                    aria-hidden="true"
                />
                <button
                    v-if="row.expandable"
                    type="button"
                    class="pt-row__chev"
                    :class="{ 'is-open': row.expanded }"
                    tabindex="-1"
                    aria-hidden="true"
                    :aria-expanded="String(row.expanded)"
                    :aria-label="$t('Home.show_lists', { project: row.name })"
                    @click="toggle(row)"
                >
                    <ShellIcon name="chevronDown" :size="12" />
                </button>
            </div>
        </li>
    </ul>
</template>

<script setup>
import { computed, inject, nextTick, reactive, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useStore } from "vuex";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import FavouriteStar from "@/components/atom/FavouriteStar/FavouriteStar.vue";
import { isOwnerOrAdmin } from "@/utils/roles";
import { projectColor } from "@/components/molecules/Home/homeFormat";
import { treeCache, loadProjectTree } from "./projectTreeData";
import { identitiesOf, projectBranch, visibleRows } from "./projectTreeModel";

defineOptions({ name: "ProjectTree" });

const props = defineProps({
    projects: { type: Array, default: () => [] },
    label: { type: String, default: "" }
});

const route = useRoute();
const { getters } = useStore();
const companyId = inject("$companyId");
const userId = inject("$userId");

const expanded = reactive({});
const focusKey = ref("");
const treeEl = ref(null);

const access = computed(() => ({
    privileged: isOwnerOrAdmin(getters["settings/companyUserDetail"]?.roleType),
    identities: identitiesOf(userId?.value, getters["settings/teams"])
}));

/* The open project's sprints and folders are kept live in the store by the project page and its
   socket; every other project reads the tree's own copy. */
function sourceOf(projectId) {
    const sprints = (getters["projectData/sprints"] || {})[projectId];
    const folders = (getters["projectData/folders"] || {})[projectId];
    if (Array.isArray(sprints)) return { sprints, folders: Array.isArray(folders) ? folders : treeCache[projectId]?.folders || [] };
    return treeCache[projectId]?.loaded ? treeCache[projectId] : null;
}

const branchOf = (projectId) => {
    const source = sourceOf(projectId);
    return source ? projectBranch(source, access.value) : null;
};

const rows = computed(() => visibleRows(props.projects, { branchOf, expanded, cid: companyId?.value }));

const currentKey = computed(() => {
    const { id, folderId, sprintId } = route.params || {};
    if (sprintId) return `sprint:${sprintId}`;
    if (folderId) return `folder:${folderId}`;
    return id ? `project:${id}` : "";
});

const colorOf = (id) => projectColor(props.projects.find((project) => String(project._id) === id) || {});

function setExpanded(key, open) {
    expanded[key] = open;
    if (open && key.startsWith("project:")) loadProjectTree(key.slice("project:".length));
}

function toggle(row) {
    setExpanded(row.key, !row.expanded);
}

watch(() => [route.params?.id, route.params?.folderId], ([id, folderId]) => {
    if (id) setExpanded(`project:${id}`, true);
    if (folderId) expanded[`folder:${folderId}`] = true;
}, { immediate: true });

// Until the reader moves, the tab stop follows the current location, which may load after the projects.
const readerMoved = ref(false);
watch([rows, currentKey], ([list]) => {
    if (readerMoved.value && list.some((row) => row.key === focusKey.value)) return;
    focusKey.value = (list.find((row) => row.key === currentKey.value) || list.find((row) => row.key === focusKey.value) || list[0] || {}).key || "";
}, { immediate: true });

function focusRow(key) {
    if (!key) return;
    focusKey.value = key;
    nextTick(() => treeEl.value?.querySelector(`[data-key="${key}"]`)?.focus());
}

function onFocusin(event) {
    const key = event.target?.getAttribute?.("data-key");
    if (!key) return;
    focusKey.value = key;
    readerMoved.value = true;
}

const MOVES = {
    ArrowDown: (list, at) => list[Math.min(at + 1, list.length - 1)],
    ArrowUp: (list, at) => list[Math.max(at - 1, 0)],
    Home: (list) => list[0],
    End: (list) => list[list.length - 1]
};

function onKeydown(event) {
    const list = rows.value;
    const fromKey = event.target?.closest?.("[data-key]")?.getAttribute("data-key") || focusKey.value;
    const at = list.findIndex((row) => row.key === fromKey);
    const row = list[at];
    if (!row) return;

    if (MOVES[event.key]) {
        event.preventDefault();
        focusRow(MOVES[event.key](list, at).key);
    } else if (event.key === "ArrowRight" && row.expandable) {
        event.preventDefault();
        if (!row.expanded) setExpanded(row.key, true);
        else if (list[at + 1]?.parentKey === row.key) focusRow(list[at + 1].key);
    } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (row.expandable && row.expanded) setExpanded(row.key, false);
        else if (row.parentKey) focusRow(row.parentKey);
    }
}
</script>

<style>
.pt { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 1px; }
.pt-row {
    position: relative; display: flex; align-items: center; gap: 4px; min-height: 30px;
    padding: 0 6px 0 0; border-radius: 7px; color: var(--ink);
    transition: background var(--t-state) var(--ease);
}
.pt-row:hover { background: var(--surface-hover); }
.pt-row.is-current { background: var(--brand-tint); }
.pt-row__link {
    flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; padding: 6px 9px;
    color: inherit; text-decoration: none; font: 400 13px/1.3 var(--font-ui); border-radius: 7px;
}
.pt-row__link:hover { color: inherit; text-decoration: none; }
.pt-row__link:focus-visible { outline: none; box-shadow: var(--focus); }
.pt-row--l2 .pt-row__link { padding-left: 24px; font-size: 12.5px; color: var(--ink-label); }
.pt-row--l3 .pt-row__link { padding-left: 38px; font-size: 12.5px; color: var(--ink-label); }
.pt-row.is-current .pt-row__link { color: var(--brand); font-weight: 600; }
.pt-row__dot { width: 7px; height: 7px; border-radius: 2px; flex: none; }
.pt-row__name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pt-row__count { margin-left: auto; font: 400 11px/1 var(--font-ui); color: var(--ink-2); }
.pt-row.is-current .pt-row__count { color: var(--brand); }
.pt-row__star { visibility: hidden; }
.pt-row:hover .pt-row__star, .pt-row:focus-within .pt-row__star, .pt-row__star.is-on { visibility: visible; }
.pt-row__chev {
    min-width: 24px; min-height: 24px; display: inline-flex; align-items: center; justify-content: center;
    border: 0; background: transparent; color: var(--ink-2); padding: 2px; cursor: pointer; border-radius: 4px;
    transition: transform var(--t-state) var(--ease);
}
.pt-row__chev.is-open { transform: rotate(180deg); }
@media (hover: none) {
    .pt-row__star { visibility: visible; }
}
</style>
