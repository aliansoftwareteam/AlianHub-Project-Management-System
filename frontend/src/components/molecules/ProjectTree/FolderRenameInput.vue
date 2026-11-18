<template>
    <input
        ref="input"
        v-model="name"
        type="text"
        class="pt-row__rename"
        :maxlength="MAX_LENGTH"
        :disabled="saving"
        :aria-label="t('ProjectTree.rename_folder', { folder: folder.name })"
        @keydown.stop="onKeydown"
        @blur="cancel"
    >
</template>

<script setup>
/**
 * A folder row's name, edited in place: Enter saves, Escape or leaving the field cancels.
 *
 * Props
 *   project   Object   the folder's project
 *   folder    Object   { id, name, parentFolderId }
 *   folders   Array    the project's folder documents, for the rule that siblings differ by name
 *
 * Emits
 *   done   the edit is over, saved or not
 */
import { defineEmits, defineProps, inject } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { folderIdOf, parentIdOf } from "@/utils/folderTree";
import { renameFolder } from "@/views/Projects/folderActions";
import { useRowRename } from "./useRowRename";

defineOptions({ name: "FolderRenameInput" });

const MIN_LENGTH = 3;
const MAX_LENGTH = 50;
const DELETED = 1;

const props = defineProps({
    project: { type: Object, required: true },
    folder: { type: Object, required: true },
    folders: { type: Array, default: () => [] }
});

const emit = defineEmits(["done"]);

const { t } = useI18n();
const store = useStore();
const companyId = inject("$companyId");

const taken = (wanted) => props.folders.some((item) => folderIdOf(item) !== props.folder.id
    && Number(item.deletedStatusKey) !== DELETED
    && parentIdOf(item) === String(props.folder.parentFolderId || "")
    && String(item.name || "").toLowerCase() === wanted.toLowerCase());

const { input, name, saving, cancel, onKeydown } = useRowRename({
    current: props.folder.name,
    check: (wanted) => {
        if (wanted.length < MIN_LENGTH) return t("Projects.folder_name_short", { n: MIN_LENGTH });
        return taken(wanted) ? t("Toast.Folder_already_exists") : "";
    },
    save: (wanted) => renameFolder(store, { companyId: companyId?.value, projectId: props.project._id, folderId: props.folder.id, folderName: wanted }),
    fallbackMessage: () => t("Toast.something_went_wrong"),
    done: () => emit("done")
});
</script>

<style>
/* The field starts where the name did: the row's indent less its own padding. */
.pt-row__rename {
    flex: 1; min-width: 0; box-sizing: border-box; padding: 0 var(--sp-3);
    height: max(var(--hit-min), calc(var(--row-h) - var(--sp-2) - 2px));
    margin-left: calc(var(--sp-9) - var(--sp-3));
    border: 1px solid var(--brand-border); border-radius: var(--r-chip);
    background: var(--surface); color: var(--ink); font: 400 var(--row-font)/var(--lh-snug, 1.3) var(--font-ui);
}
.pt-row__rename:focus { outline: none; box-shadow: var(--focus); }
.pt-row--l3 .pt-row__rename { margin-left: calc(var(--sp-9) + var(--sp-6) - var(--sp-3)); }
.pt-row--l4 .pt-row__rename { margin-left: calc(var(--sp-9) + 2 * var(--sp-6) - var(--sp-3)); }
</style>
