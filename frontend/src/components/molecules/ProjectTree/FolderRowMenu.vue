<template>
    <div v-if="entries.length" ref="root" class="pt-menu">
        <button
            type="button"
            class="pt-row__more"
            tabindex="-1"
            aria-haspopup="menu"
            :aria-expanded="String(shown)"
            :aria-label="t('ProjectTree.folder_actions', { folder: folder.name })"
            :title="t('ProjectTree.folder_actions', { folder: folder.name })"
            @click="shown ? close() : open()"
        >
            <ShellIcon name="dots" :size="14" />
        </button>
        <div v-if="shown" ref="menu" class="ah-pop pt-menu__pop" role="menu" :aria-label="t('ProjectTree.folder_actions', { folder: folder.name })" @keydown.stop="onMenuKeydown">
            <button
                v-for="entry in entries"
                :key="entry.kind"
                type="button"
                class="ah-pop__item"
                :class="{ 'pt-menu__danger': entry.kind === 'delete' }"
                role="menuitem"
                tabindex="-1"
                @click="start(entry.kind)"
            >
                <ShellIcon :name="entry.icon" :size="14" />{{ entry.label }}
            </button>
        </div>

        <teleport to="body">
            <div v-if="mode === 'subfolder'" class="pt-menu__overlay" @click.self="mode = ''">
                <div class="pt-menu__card" role="dialog" aria-modal="true" :aria-label="t('Projects.new_subfolder')">
                    <h3 class="ah-h3 pt-menu__title">{{ t('Projects.new_subfolder_in', { folder: folder.name }) }}</h3>
                    <SprintFolderInput
                        :createSprint="false"
                        :createFolder="true"
                        :project="project"
                        :parentFolderId="folder.id"
                        :subItems="siblings"
                        @cancel="mode = ''"
                        @updateData="emit('reveal', folder.id)"
                    />
                </div>
            </div>
            <MoveToFolderModal
                v-if="mode === 'move'"
                :modelValue="true"
                :folders="targets"
                :currentFolderId="folder.parentFolderId || null"
                :title="t('Projects.move_folder')"
                :hint="t('Projects.move_folder_hint', { folder: folder.name })"
                :rootLabel="t('Projects.top_level')"
                @update:modelValue="mode = ''"
                @select="move"
            />
            <div v-if="removal" class="pt-menu__overlay" @click.self="mode = ''" @keydown.esc="mode = ''">
                <div class="pt-menu__card" role="alertdialog" aria-modal="true" :aria-label="removal.title">
                    <h3 class="ah-h3 pt-menu__title">{{ removal.title }}</h3>
                    <p class="pt-menu__text">{{ removal.text }}</p>
                    <div class="pt-menu__actions">
                        <button ref="cancelButton" type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="mode = ''">{{ t('Projects.cancel') }}</button>
                        <button
                            type="button"
                            class="ah-btn ah-btn--sm"
                            :class="mode === 'delete' ? 'ah-btn--danger' : 'ah-btn--primary'"
                            :disabled="busy"
                            data-action="confirm"
                            @click="remove"
                        >{{ removal.confirm }}</button>
                    </div>
                </div>
            </div>
        </teleport>
    </div>
</template>

<script setup>
/**
 * The actions of one folder row in the project tree: a subfolder under a top-level folder, rename,
 * a move into a top-level folder or out to the top level, archive and delete. Folders nest one
 * level, so a subfolder offers no subfolder and a folder that holds subfolders has nowhere to move.
 * Archive and delete ask first and say what goes with the folder; both can be undone.
 *
 * Props
 *   project   Object   the folder's project; its isGlobalPermission decides which rules are read
 *   folder    Object   { id, name, parentFolderId }
 *   folders   Array    the project's folder documents
 *   sprints   Array    the project's sprint documents, to count what an archive or delete takes
 *
 * Emits
 *   reveal(folderId)    a folder now holds something new, so the tree should open it
 *   rename(folderId)    the row should let its name be edited in place
 */
import { computed, defineAsyncComponent, defineEmits, defineExpose, defineProps, inject, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import { useCustomComposable } from "@/composable";
import { showUndoToast } from "@/composable/useUndoToast";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { canHoldSubfolders, folderContents, folderIdOf, folderMoveTargets, parentIdOf } from "@/utils/folderTree";
import { moveFolder, restoreFolderFromTrash, setFolderStatus } from "@/views/Projects/folderActions";

const SprintFolderInput = defineAsyncComponent(() => import("@/components/atom/SprintFolderInput/SprintFolderInput.vue"));
const MoveToFolderModal = defineAsyncComponent(() => import("@/components/molecules/MoveToFolder/MoveToFolderModal.vue"));

defineOptions({ name: "FolderRowMenu" });

const LIVE = 0;
const DELETED = 1;
const ARCHIVED = 2;

const props = defineProps({
    project: { type: Object, required: true },
    folder: { type: Object, required: true },
    folders: { type: Array, default: () => [] },
    sprints: { type: Array, default: () => [] }
});

const emit = defineEmits(["reveal", "rename"]);

const { t } = useI18n();
const store = useStore();
const $toast = useToast();
const companyId = inject("$companyId");
const { checkPermission } = useCustomComposable();

const shown = ref(false);
const mode = ref("");
const busy = ref(false);
const root = ref(null);
const menu = ref(null);
const cancelButton = ref(null);

const stored = computed(() => props.folders.find((item) => folderIdOf(item) === props.folder.id) || null);
const allowed = (key) => props.project?.status !== "close" && checkPermission(key, props.project?.isGlobalPermission) === true;
const mayCreate = computed(() => allowed("project.project_folder_create"));
const mayRename = computed(() => allowed("project.project_folder_name_edit"));

const targets = computed(() => folderMoveTargets(props.folders, stored.value).map((item) => ({ id: folderIdOf(item), name: item.name, depth: 0 })));
const canMove = computed(() => (mayCreate.value || mayRename.value) && Boolean(stored.value) && (Boolean(parentIdOf(stored.value)) || targets.value.length > 0));
const siblings = computed(() => props.folders.map((item) => ({ ...item, folderId: folderIdOf(item) })));

const entries = computed(() => [
    mayCreate.value && canHoldSubfolders(props.folders, stored.value) && { kind: "subfolder", icon: "plus", label: t("Projects.new_subfolder") },
    mayRename.value && { kind: "rename", icon: "file", label: t("Projects.rename") },
    canMove.value && { kind: "move", icon: "arrowRight", label: t("Projects.move_folder") },
    allowed("project.folder_archive") && { kind: "archive", icon: "book", label: t("Projects.archive") },
    allowed("project.folder_delete") && { kind: "delete", icon: "trash", label: t("Projects.delete") }
].filter(Boolean));

const goesWith = computed(() => {
    const { subfolders, lists, tasks, tasksKnown } = folderContents({ folders: props.folders, sprints: props.sprints }, props.folder.id);
    return [
        subfolders && t("Projects.count_subfolders", { n: subfolders }, subfolders),
        lists && t("Projects.count_lists", { n: lists }, lists),
        lists && !tasksKnown ? t("Projects.their_tasks") : tasks && t("Projects.count_tasks", { n: tasks }, tasks)
    ].filter(Boolean).join(", ");
});

const removal = computed(() => {
    if (mode.value !== "archive" && mode.value !== "delete") return null;
    const key = `Projects.folder_${mode.value}`;
    return {
        title: t(`${key}_title`, { folder: props.folder.name }),
        text: goesWith.value ? t(`${key}_with`, { parts: goesWith.value }) : t(`${key}_empty`),
        confirm: t(`Projects.${mode.value}`)
    };
});

watch(removal, (asking) => { if (asking) nextTick(() => cancelButton.value?.focus()); });

const menuItems = () => [...(menu.value?.querySelectorAll('[role="menuitem"]') || [])];

function open() {
    shown.value = true;
    nextTick(() => menuItems()[0]?.focus());
}

function close(refocus = false) {
    if (!shown.value) return;
    shown.value = false;
    if (refocus) root.value?.closest(".pt-row")?.querySelector('[role="treeitem"]')?.focus();
}

/* The menu sits inside the tree, whose own arrow keys would otherwise walk the rows behind it. */
function onMenuKeydown(event) {
    if (event.key === "Escape" || event.key === "Tab") {
        event.preventDefault();
        close(true);
        return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = menuItems();
    const at = items.indexOf(document.activeElement);
    items[(at + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
}

function start(kind) {
    close();
    if (kind === "rename") emit("rename", props.folder.id);
    else mode.value = kind;
}

const complain = (result) => $toast.error(result.message || t("Toast.something_went_wrong"), { position: "top-right" });

/* A row is unmounted, and its emits with it, as soon as the store no longer shows its folder there:
   under a closed parent after a move, anywhere after an archive or delete. So the tree is asked to
   open the target before the move is sent, and an undo keeps what it needs. */
async function move(target) {
    mode.value = "";
    if (target) emit("reveal", target.id);
    const result = await moveFolder(store, {
        companyId: companyId?.value,
        projectId: props.project._id,
        folderId: props.folder.id,
        parentFolderId: target ? target.id : null
    });
    if (result.ok) $toast.success(t("Toast.Folder_moved_successfully"), { position: "top-right" });
    else complain(result);
}

function offerUndo(status, { project, folder, company }) {
    const name = { folder: folder.name };
    if (status === ARCHIVED) {
        if (!allowed("project.folder_restore")) {
            $toast.success(t("Projects.folder_archived", name), { position: "top-right" });
            return;
        }
        showUndoToast({
            message: t("Projects.folder_archived", name),
            undo: async () => {
                const result = await setFolderStatus(store, { companyId: company, project, folder, status: LIVE });
                if (!result.ok) complain(result);
            }
        });
        return;
    }
    showUndoToast({
        message: t("Projects.folder_deleted", name),
        undo: async () => {
            const result = await restoreFolderFromTrash(store, { projectId: project._id, folderId: folder.id });
            if (!result.ok) complain(result);
        }
    });
}

async function remove() {
    const status = mode.value === "archive" ? ARCHIVED : DELETED;
    const context = { project: props.project, folder: { id: props.folder.id, name: props.folder.name }, company: companyId?.value };
    busy.value = true;
    const result = await setFolderStatus(store, { companyId: context.company, project: context.project, folder: context.folder, status });
    busy.value = false;
    mode.value = "";
    if (!result.ok) {
        complain(result);
        return;
    }
    offerUndo(status, context);
}

const closeOnOutsideClick = (event) => { if (!root.value?.contains(event.target)) close(); };
onMounted(() => document.addEventListener("click", closeOnOutsideClick));
onUnmounted(() => document.removeEventListener("click", closeOnOutsideClick));

defineExpose({ open });
</script>

<style>
.pt-menu { position: relative; display: inline-flex; }
.pt-row__more {
    min-width: 24px; min-height: 24px; display: inline-flex; align-items: center; justify-content: center;
    border: 0; background: transparent; color: var(--ink-2); padding: 2px; cursor: pointer; border-radius: 4px;
    visibility: hidden;
}
.pt-row__more:hover { color: var(--ink); background: var(--fill); }
.pt-row__more:focus-visible { outline: none; box-shadow: var(--focus); }
.pt-row:hover .pt-row__more, .pt-row:focus-within .pt-row__more, .pt-row__more[aria-expanded="true"] { visibility: visible; }
.pt-menu__pop { position: absolute; top: calc(100% + var(--sp-1)); right: 0; z-index: 40; min-width: 180px; }
.pt-menu__danger, .pt-menu__danger:hover { color: var(--danger); }
.pt-menu__overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, .35); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: var(--sp-7); }
.pt-menu__card { background: var(--surface); color: var(--ink); border-radius: 12px; width: min(420px, 100%); padding: 18px var(--sp-8) 26px; box-shadow: var(--shadow-pop); font-family: var(--font-ui); }
.pt-menu__title { margin: 0 0 var(--sp-5); overflow-wrap: anywhere; }
.pt-menu__text { margin: 0 0 var(--sp-8); font-size: 13px; line-height: 1.5; color: var(--ink-2); overflow-wrap: anywhere; }
.pt-menu__actions { display: flex; justify-content: flex-end; gap: var(--sp-4); }
@media (hover: none) {
    .pt-row__more { visibility: visible; }
}
</style>
