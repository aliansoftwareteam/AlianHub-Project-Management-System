<template>
    <div v-if="canNest || canMove" ref="root" class="pt-menu">
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
            <button v-if="canNest" type="button" class="ah-pop__item" role="menuitem" tabindex="-1" @click="start('subfolder')">
                <ShellIcon name="plus" :size="14" />{{ t('Projects.new_subfolder') }}
            </button>
            <button v-if="canMove" type="button" class="ah-pop__item" role="menuitem" tabindex="-1" @click="start('move')">
                <ShellIcon name="arrowRight" :size="14" />{{ t('Projects.move_folder') }}
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
        </teleport>
    </div>
</template>

<script setup>
/**
 * The actions of one folder row in the project tree: a subfolder under a top-level folder, and a
 * move into a top-level folder or out to the top level. Folders nest one level, so a subfolder
 * offers no subfolder and a folder that holds subfolders has nowhere to move.
 *
 * Props
 *   project   Object   the folder's project; its isGlobalPermission decides which rules are read
 *   folder    Object   { id, name, parentFolderId }
 *   folders   Array    the project's folder documents
 *
 * Emits
 *   reveal(folderId)   a folder now holds something new, so the tree should open it
 */
import { computed, defineAsyncComponent, defineEmits, defineExpose, defineProps, inject, nextTick, onMounted, onUnmounted, ref } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import { useCustomComposable } from "@/composable";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { canHoldSubfolders, folderIdOf, folderMoveTargets, parentIdOf } from "@/utils/folderTree";
import { moveFolder } from "@/views/Projects/folderActions";

const SprintFolderInput = defineAsyncComponent(() => import("@/components/atom/SprintFolderInput/SprintFolderInput.vue"));
const MoveToFolderModal = defineAsyncComponent(() => import("@/components/molecules/MoveToFolder/MoveToFolderModal.vue"));

defineOptions({ name: "FolderRowMenu" });

const props = defineProps({
    project: { type: Object, required: true },
    folder: { type: Object, required: true },
    folders: { type: Array, default: () => [] }
});

const emit = defineEmits(["reveal"]);

const { t } = useI18n();
const store = useStore();
const $toast = useToast();
const companyId = inject("$companyId");
const { checkPermission } = useCustomComposable();

const shown = ref(false);
const mode = ref("");
const root = ref(null);
const menu = ref(null);

const stored = computed(() => props.folders.find((item) => folderIdOf(item) === props.folder.id) || null);
const allowed = (key) => props.project?.status !== "close" && checkPermission(key, props.project?.isGlobalPermission) === true;
const mayCreate = computed(() => allowed("project.project_folder_create"));
const mayMove = computed(() => mayCreate.value || allowed("project.project_folder_name_edit"));

const targets = computed(() => folderMoveTargets(props.folders, stored.value).map((item) => ({ id: folderIdOf(item), name: item.name, depth: 0 })));
const canNest = computed(() => mayCreate.value && canHoldSubfolders(props.folders, stored.value));
const canMove = computed(() => mayMove.value && Boolean(stored.value) && (Boolean(parentIdOf(stored.value)) || targets.value.length > 0));
const siblings = computed(() => props.folders.map((item) => ({ ...item, folderId: folderIdOf(item) })));

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
    mode.value = kind;
}

async function move(target) {
    mode.value = "";
    const result = await moveFolder(store, {
        companyId: companyId?.value,
        projectId: props.project._id,
        folderId: props.folder.id,
        parentFolderId: target ? target.id : null
    });
    if (!result.ok) {
        $toast.error(result.message || t("Toast.something_went_wrong"), { position: "top-right" });
        return;
    }
    $toast.success(t("Toast.Folder_moved_successfully"), { position: "top-right" });
    if (target) emit("reveal", target.id);
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
.pt-menu__overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, .35); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: var(--sp-7); }
.pt-menu__card { background: var(--surface); color: var(--ink); border-radius: 12px; width: min(420px, 100%); padding: 18px var(--sp-8) 26px; box-shadow: var(--shadow-pop); font-family: var(--font-ui); }
.pt-menu__title { margin: 0 0 var(--sp-5); overflow-wrap: anywhere; }
@media (hover: none) {
    .pt-row__more { visibility: visible; }
}
</style>
