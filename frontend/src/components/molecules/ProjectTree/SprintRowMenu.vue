<template>
    <div v-if="entries.length" ref="root" class="pt-menu">
        <button
            type="button"
            class="pt-row__more"
            tabindex="-1"
            aria-haspopup="menu"
            :aria-expanded="String(shown)"
            :aria-label="t('ProjectTree.list_actions', { list: sprint.name })"
            :title="t('ProjectTree.list_actions', { list: sprint.name })"
            @click="shown ? close() : open()"
        >
            <ShellIcon name="dots" :size="14" />
        </button>
        <div v-if="shown" ref="menu" class="ah-pop pt-menu__pop" role="menu" :aria-label="t('ProjectTree.list_actions', { list: sprint.name })" @keydown.stop="onMenuKeydown">
            <button
                v-for="entry in entries"
                :key="entry.kind"
                type="button"
                class="ah-pop__item"
                role="menuitem"
                tabindex="-1"
                @click="start(entry.kind)"
            >
                <ShellIcon :name="entry.icon" :size="14" />{{ entry.label }}
            </button>
        </div>

        <teleport to="body">
            <MoveToFolderModal
                v-if="moving"
                :modelValue="true"
                :folders="targets"
                :currentFolderId="sprint.folderId || null"
                :hint="t('Projects.move_list_hint', { list: sprint.name })"
                :rootLabel="t('Projects.top_level')"
                @update:modelValue="moving = false"
                @select="move"
            />
        </teleport>
    </div>
</template>

<script setup>
/**
 * The actions of one list row in the project tree: a move into a folder or subfolder, or out to
 * the top level, and rename. Its styles are FolderRowMenu's, which the tree always loads.
 *
 * Props
 *   project   Object   the list's project; its isGlobalPermission decides which rules are read
 *   sprint    Object   { id, name, folderId }
 *   folders   Array    the project's folder documents
 *
 * Emits
 *   reveal(folderId)    the list now sits in that folder, so the tree should open the way to it
 *   rename(sprintId)    the row should let its name be edited in place
 */
import { computed, defineAsyncComponent, defineEmits, defineExpose, defineProps, inject, ref } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import { useCustomComposable } from "@/composable";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { folderIdOf, nestedFolders } from "@/utils/folderTree";
import { moveSprint } from "@/views/Projects/sprintActions";
import { useRowMenu } from "./useRowMenu";

const MoveToFolderModal = defineAsyncComponent(() => import("@/components/molecules/MoveToFolder/MoveToFolderModal.vue"));

defineOptions({ name: "SprintRowMenu" });

/* The server takes any one of these for a move (Modules/Sprints/routes.js SPRINT_EDIT) and the first for a rename. */
const RENAME = "project.project_sprint_name_edit";
const MOVE = [RENAME, "project.sprint_type_change", "project.project_sprint_create"];

const props = defineProps({
    project: { type: Object, required: true },
    sprint: { type: Object, required: true },
    folders: { type: Array, default: () => [] }
});

const emit = defineEmits(["reveal", "rename"]);

const { t } = useI18n();
const store = useStore();
const $toast = useToast();
const companyId = inject("$companyId");
const { checkPermission } = useCustomComposable();
const { shown, root, menu, open, close, onMenuKeydown } = useRowMenu();

const moving = ref(false);

const allowed = (key) => props.project?.status !== "close" && checkPermission(key, props.project?.isGlobalPermission) === true;
const targets = computed(() => nestedFolders(props.folders).map((folder) => ({ id: folderIdOf(folder), name: folder.name, depth: folder.depth })));
const canMove = computed(() => MOVE.some(allowed) && (Boolean(props.sprint.folderId) || targets.value.length > 0));

const entries = computed(() => [
    canMove.value && { kind: "move", icon: "arrowRight", label: t("Projects.move_to_folder_menu") },
    allowed(RENAME) && { kind: "rename", icon: "file", label: t("Projects.rename") }
].filter(Boolean));

function start(kind) {
    close();
    if (kind === "rename") emit("rename", props.sprint.id);
    else moving.value = true;
}

/* The row is unmounted, and its emits with it, once the store shows the list under a closed folder,
   so the tree is asked to open the target before the move is sent. */
async function move(target) {
    moving.value = false;
    if (target) emit("reveal", target.id);
    const from = props.folders.find((folder) => folderIdOf(folder) === String(props.sprint.folderId || ""));
    const result = await moveSprint(store, {
        companyId: companyId?.value,
        project: props.project,
        sprint: props.sprint,
        folder: target ? { id: target.id, name: target.name } : null,
        fromFolderName: from?.name || ""
    });
    if (result.ok) $toast.success(t("Projects.list_moved"), { position: "top-right" });
    else $toast.error(result.message || t("Toast.something_went_wrong"), { position: "top-right" });
}

defineExpose({ open });
</script>
