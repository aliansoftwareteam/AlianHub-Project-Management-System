<template>
    <div v-if="headless || entries.length" ref="root" :class="{ 'pt-menu': inTree, lm: !inTree && !headless }">
        <template v-if="inTree">
            <button
                type="button"
                class="pt-row__more"
                tabindex="-1"
                aria-haspopup="menu"
                :aria-expanded="String(shown)"
                :aria-label="label"
                :title="label"
                @click="shown ? close() : open()"
            >
                <ShellIcon name="dots" :size="14" />
            </button>
            <div v-if="shown" ref="menu" class="ah-pop pt-menu__pop" role="menu" :aria-label="label" @keydown.stop="onMenuKeydown">
                <template v-for="entry in entries" :key="entry.id">
                    <div v-if="entry.separated" class="ah-pop__sep" role="separator"></div>
                    <button
                        type="button"
                        class="ah-pop__item"
                        :class="{ 'pt-menu__danger': entry.danger }"
                        role="menuitem"
                        tabindex="-1"
                        :data-item="entry.id"
                        @click="pick(entry.id)"
                    >
                        <ShellIcon :name="entry.icon" :size="14" />{{ t(entry.labelKey) }}
                    </button>
                </template>
            </div>
        </template>
        <TaskMenuPopup v-else-if="!headless" :items="entries" :label="label" trigger-class="lm__more" @choose="run">
            <ShellIcon name="dots" :size="14" />
        </TaskMenuPopup>

        <teleport to="body">
            <MoveToFolderModal
                v-if="mode === 'move'"
                :modelValue="true"
                :folders="targets"
                :currentFolderId="list.folderId || null"
                :hint="t('Projects.move_list_hint', { list: list.name })"
                :rootLabel="t('Projects.top_level')"
                @update:modelValue="mode = ''"
                @select="move"
            />
            <SprintSetupModal v-if="mode === 'sprint-settings'" :sprint="list" @close="mode = ''" @saved="(saved) => sprintChanged(store, saved)" />
            <CloseSprintStep v-if="mode === 'complete-sprint'" :sprint="list" :siblings="siblings" @close="mode = ''" @completed="completed" />
            <div v-if="mode === 'rename'" class="lm__overlay" @click.self="mode = ''">
                <div class="lm__card" role="dialog" aria-modal="true" :aria-label="t('Projects.rename_list')">
                    <h3 class="ah-h3 lm__title">{{ t('Projects.rename_list') }}</h3>
                    <div class="lm__rename">
                        <SprintRenameInput :project="project" :sprint="list" :sprints="projectSprints" @done="mode = ''" />
                    </div>
                    <p class="lm__text lm__hint">{{ t('Projects.rename_list_hint') }}</p>
                </div>
            </div>
            <div v-if="asking" class="lm__overlay" @click.self="mode = ''" @keydown.esc="mode = ''">
                <div class="lm__card" role="alertdialog" aria-modal="true" :aria-label="asking.title">
                    <h3 class="ah-h3 lm__title">{{ asking.title }}</h3>
                    <p class="lm__text">{{ asking.text }}</p>
                    <div class="lm__actions">
                        <button ref="cancelButton" type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="mode = ''">{{ t('Projects.cancel') }}</button>
                        <button
                            type="button"
                            class="ah-btn ah-btn--sm"
                            :class="mode === 'delete' ? 'ah-btn--danger' : 'ah-btn--primary'"
                            :disabled="busy"
                            data-action="confirm"
                            @click="confirm"
                        >{{ asking.confirm }}</button>
                    </div>
                </div>
            </div>
        </teleport>
    </div>
</template>

<script setup>
/**
 * The menu of one list, the same wherever a list is shown: the project tree, the project header,
 * a List view heading and the Calendar tab. Its entries come from listMenuEntries, so an action
 * cannot exist in one place only.
 *
 * Props
 *   project       Object    the list's project; its isGlobalPermission decides which rules are read
 *   sprint        Object    the list, or { id, name, folderId } of it; the rest is read from the store
 *   folders       Array     the project's folder documents; the store's when left out
 *   sprints       Array     the project's sprint documents; the store's when left out
 *   archivedView  Boolean   the place shows archived lists
 *   inTree        Boolean   draw inside a project tree row, which renames in place
 *   headless      Boolean   draw no button: the place draws the entries and calls run(id)
 *
 * Emits
 *   reveal(folderId)   the list now sits in that folder, so a tree should open the way to it
 *   rename(listId)     in a tree: the row should let its name be edited in place
 */
import { computed, defineAsyncComponent, defineEmits, defineExpose, defineProps, inject, nextTick, ref, watch } from "vue";
import { routeLocationKey, routerKey } from "vue-router";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import { useCustomComposable } from "@/composable";
import { showUndoToast } from "@/composable/useUndoToast";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import TaskMenuPopup from "@/views/Projects/components/taskMenu/TaskMenuPopup.vue";
import { folderIdOf, nestedFolders } from "@/utils/folderTree";
import { treeRoute } from "@/components/molecules/ProjectTree/projectTreeModel";
import { useRowMenu } from "@/components/molecules/ProjectTree/useRowMenu";
import { listMenuEntries, listMenuRights, listUrl } from "@/views/Projects/composables/listMenu";
import { makePlainList, moveSprint, refreshSprints, setSprintStatus, sprintChanged, startSprint } from "@/views/Projects/sprintActions";

const MoveToFolderModal = defineAsyncComponent(() => import("@/components/molecules/MoveToFolder/MoveToFolderModal.vue"));
const SprintSetupModal = defineAsyncComponent(() => import("@/components/molecules/SprintScrum/SprintSetupModal.vue"));
const CloseSprintStep = defineAsyncComponent(() => import("@/components/organisms/SprinstList/CloseSprintStep.vue"));
const SprintRenameInput = defineAsyncComponent(() => import("@/components/molecules/ProjectTree/SprintRenameInput.vue"));

defineOptions({ name: "ListMenu" });

const LIVE = 0;
const DELETED = 1;
const ARCHIVED = 2;
const TOAST = { position: "top-right" };
const ASKED_FIRST = ["archive", "delete", "plain-list"];

const props = defineProps({
    project: { type: Object, required: true },
    sprint: { type: Object, required: true },
    folders: { type: Array, default: null },
    sprints: { type: Array, default: null },
    archivedView: { type: Boolean, default: false },
    inTree: { type: Boolean, default: false },
    headless: { type: Boolean, default: false }
});

const emit = defineEmits(["reveal", "rename"]);

const { t } = useI18n();
const store = useStore();
const $toast = useToast();
/* Read without useRoute and useRouter, which warn where a place is drawn outside a router. */
const router = inject(routerKey, null);
const route = inject(routeLocationKey, null);
const companyId = inject("$companyId", null);
const { checkPermission } = useCustomComposable();
const { shown, root, menu, open, close, onMenuKeydown } = useRowMenu();

const mode = ref("");
const busy = ref(false);
const cancelButton = ref(null);

const listId = computed(() => String(props.sprint.id || props.sprint._id || ""));
const projectSprints = computed(() => props.sprints || (store.getters["projectData/sprints"] || {})[props.project?._id] || []);
const projectFolders = computed(() => props.folders || (store.getters["projectData/folders"] || {})[props.project?._id] || []);

const list = computed(() => {
    const stored = projectSprints.value.find((item) => String(item._id || item.id) === listId.value);
    const known = stored || props.sprint;
    return { ...known, id: listId.value, name: known.name || props.sprint.name, folderId: known.folderId ? String(known.folderId) : "" };
});
const siblings = computed(() => projectSprints.value.map((item) => ({ ...item, id: String(item._id || item.id) })));
const label = computed(() => t("ProjectTree.list_actions", { list: list.value.name }));

const check = (key) => checkPermission(key, props.project?.isGlobalPermission);
const entries = computed(() => listMenuEntries({ project: props.project, list: list.value, folders: projectFolders.value, check, archivedView: props.archivedView }));
const targets = computed(() => nestedFolders(projectFolders.value).map((folder) => ({ id: folderIdOf(folder), name: folder.name || folder.folderName || "", depth: folder.depth })));

const asking = computed(() => {
    if (!ASKED_FIRST.includes(mode.value)) return null;
    const name = { list: list.value.name };
    if (mode.value === "plain-list") return { title: t("Projects.list_plain_title", name), text: t("Projects.list_plain_text"), confirm: t("Scrum.make_it_a_plain_list") };
    return { title: t(`Projects.list_${mode.value}_title`, name), text: t(`Projects.list_${mode.value}_text`), confirm: t(`Projects.${mode.value}`) };
});

watch(asking, (now) => { if (now) nextTick(() => cancelButton.value?.focus()); });

const complain = (result) => $toast.error(result.message || t("Toast.something_went_wrong"), TOAST);
const context = () => ({ companyId: companyId?.value, project: props.project, sprint: { ...list.value } });

async function copyLink() {
    try {
        await navigator.clipboard.writeText(listUrl(router, { companyId: companyId?.value, projectId: props.project._id, list: list.value }));
        $toast.success(t("Toast.Link_is_Copied_to_clipboard"), TOAST);
    } catch (error) {
        complain({});
    }
}

async function start() {
    const result = await startSprint(store, listId.value);
    if (result.ok) $toast.success(t("Scrum.sprint_started"), TOAST);
    else complain(result);
}

/* A tree row is unmounted, and its emits with it, once the store shows the list under a closed
   folder, so the tree is asked to open the target before the move is sent. */
async function move(target) {
    mode.value = "";
    if (target) emit("reveal", target.id);
    const from = projectFolders.value.find((folder) => folderIdOf(folder) === list.value.folderId);
    const result = await moveSprint(store, {
        ...context(),
        folder: target ? { id: target.id, name: target.name } : null,
        fromFolderName: from?.name || ""
    });
    if (result.ok) $toast.success(t("Projects.list_moved"), TOAST);
    else complain(result);
}

/* Unfinished work has moved into another sprint, whose task count the store still holds. */
function completed(saved) {
    sprintChanged(store, saved);
    refreshSprints(store, props.project._id);
}

/* The page of a list that was archived or deleted shows nothing, so its reader goes one level up. */
function leaveItsPage(sprint) {
    if (!router || String(route?.params?.sprintId || "") !== sprint.id) return;
    const cid = companyId?.value;
    router.push(sprint.folderId ? treeRoute("folder", { cid, projectId: props.project._id, id: sprint.folderId }) : treeRoute("project", { cid, projectId: props.project._id }));
}

async function restore(at = context()) {
    const result = await setSprintStatus(store, { ...at, status: LIVE });
    if (result.ok) $toast.success(t("Projects.list_restored", { list: at.sprint.name }), TOAST);
    else complain(result);
}

function announce(status, at) {
    const name = { list: at.sprint.name };
    const mayUndo = status === ARCHIVED && listMenuRights({ project: at.project, list: { ...at.sprint, deletedStatusKey: ARCHIVED }, check }).restore;
    if (mayUndo) showUndoToast({ message: t("Projects.list_archived", name), undo: () => restore(at) });
    else $toast.success(t(status === ARCHIVED ? "Projects.list_archived" : "Projects.list_deleted", name), TOAST);
}

/* The menu is unmounted as soon as the store no longer shows the list, so what follows the write keeps its own copy. */
async function confirm() {
    const asked = mode.value;
    const at = context();
    busy.value = true;
    const result = asked === "plain-list"
        ? await makePlainList(store, listId.value)
        : await setSprintStatus(store, { ...at, status: asked === "archive" ? ARCHIVED : DELETED });
    busy.value = false;
    mode.value = "";
    if (!result.ok) {
        complain(result);
        return;
    }
    if (asked === "plain-list") {
        $toast.success(t("Projects.list_is_plain", { list: at.sprint.name }), TOAST);
        return;
    }
    announce(asked === "archive" ? ARCHIVED : DELETED, at);
    leaveItsPage(at.sprint);
}

const IMMEDIATE = { "copy-link": copyLink, "start-sprint": start, restore: () => restore() };

function run(id) {
    if (id === "rename" && props.inTree) emit("rename", listId.value);
    else if (IMMEDIATE[id]) IMMEDIATE[id]();
    else mode.value = id;
}

function pick(id) {
    close();
    run(id);
}

defineExpose({ open, run });
</script>

<style>
.lm { display: inline-flex; flex: none; }
.lm__more {
    min-width: var(--hit-min); min-height: var(--hit-min); display: inline-flex; align-items: center; justify-content: center;
    border: 0; background: transparent; color: var(--ink-2); padding: 0; cursor: pointer; border-radius: var(--r-sm, 4px);
}
.lm__more:hover, .lm__more[aria-expanded="true"] { color: var(--ink); background: var(--fill); }
.lm__more:focus-visible { outline: none; box-shadow: var(--focus); }
.lm__overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, .35); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: var(--sp-7); }
.lm__card { background: var(--surface); color: var(--ink); border-radius: var(--r-card); width: min(420px, 100%); padding: 18px var(--sp-8) 26px; box-shadow: var(--shadow-pop); font-family: var(--font-ui); }
.lm__title { margin: 0 0 var(--sp-5); overflow-wrap: anywhere; }
.lm__text { margin: 0 0 var(--sp-8); font-size: var(--fs-md, 13px); line-height: var(--lh-body, 1.5); color: var(--ink-2); overflow-wrap: anywhere; }
.lm__hint { margin: var(--sp-4) 0 0; }
.lm__actions { display: flex; justify-content: flex-end; gap: var(--sp-4); }
.lm__rename { display: flex; }
.lm__rename .pt-row__rename { margin-left: 0; }
@media (max-width: 767px) {
    .lm__more { min-width: 32px; min-height: 32px; }
}
</style>
