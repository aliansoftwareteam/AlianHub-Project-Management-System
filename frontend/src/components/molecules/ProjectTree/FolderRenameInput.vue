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
import { defineEmits, defineProps, inject, nextTick, onMounted, ref } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import { folderIdOf, parentIdOf } from "@/utils/folderTree";
import { renameFolder } from "@/views/Projects/folderActions";

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
const $toast = useToast();
const companyId = inject("$companyId");

const input = ref(null);
const name = ref(props.folder.name);
const saving = ref(false);
let over = false;

const complain = (message) => $toast.error(message, { position: "top-right" });

const taken = (wanted) => props.folders.some((item) => folderIdOf(item) !== props.folder.id
    && Number(item.deletedStatusKey) !== DELETED
    && parentIdOf(item) === String(props.folder.parentFolderId || "")
    && String(item.name || "").toLowerCase() === wanted.toLowerCase());

function finish() {
    if (over) return;
    over = true;
    emit("done");
}

function cancel() {
    if (!saving.value) finish();
}

async function save() {
    const wanted = name.value.trim();
    if (wanted === props.folder.name) return finish();
    if (wanted.length < MIN_LENGTH) return complain(t("Projects.folder_name_short", { n: MIN_LENGTH }));
    if (taken(wanted)) return complain(t("Toast.Folder_already_exists"));

    saving.value = true;
    const result = await renameFolder(store, { companyId: companyId?.value, projectId: props.project._id, folderId: props.folder.id, folderName: wanted });
    saving.value = false;
    if (!result.ok) {
        complain(result.message || t("Toast.something_went_wrong"));
        return nextTick(() => input.value?.focus());
    }
    return finish();
}

function onKeydown(event) {
    if (event.key === "Enter") {
        event.preventDefault();
        save();
    } else if (event.key === "Escape") {
        event.preventDefault();
        finish();
    }
}

onMounted(() => {
    input.value?.focus();
    input.value?.select();
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
</style>
