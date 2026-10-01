<template>
    <input
        ref="input"
        v-model="name"
        type="text"
        class="pt-row__rename"
        :maxlength="MAX_LENGTH"
        :disabled="saving"
        :aria-label="t('ProjectTree.rename_list', { list: sprint.name })"
        @keydown.stop="onKeydown"
        @blur="cancel"
    >
</template>

<script setup>
/**
 * A list row's name, edited in place: Enter saves, Escape or leaving the field cancels.
 *
 * Props
 *   project   Object   the list's project
 *   sprint    Object   { id, name, folderId }
 *   sprints   Array    the project's sprint documents, for the rule that lists in one place differ by name
 *
 * Emits
 *   done   the edit is over, saved or not
 */
import { defineEmits, defineProps, inject } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { renameSprint } from "@/views/Projects/sprintActions";
import { useRowRename } from "./useRowRename";

defineOptions({ name: "SprintRenameInput" });

const MIN_LENGTH = 3;
const MAX_LENGTH = 50;
const DELETED = 1;

const props = defineProps({
    project: { type: Object, required: true },
    sprint: { type: Object, required: true },
    sprints: { type: Array, default: () => [] }
});

const emit = defineEmits(["done"]);

const { t } = useI18n();
const store = useStore();
const companyId = inject("$companyId");

const taken = (wanted) => props.sprints.some((item) => String(item._id || item.id) !== props.sprint.id
    && Number(item.deletedStatusKey) !== DELETED
    && String(item.folderId || "") === String(props.sprint.folderId || "")
    && String(item.name || "").toLowerCase() === wanted.toLowerCase());

const { input, name, saving, cancel, onKeydown } = useRowRename({
    current: props.sprint.name,
    check: (wanted) => {
        if (wanted.length < MIN_LENGTH) return t("Projects.list_name_short", { n: MIN_LENGTH });
        return taken(wanted) ? t("Toast.Sprint_already_exists") : "";
    },
    save: (wanted) => renameSprint(store, { companyId: companyId?.value, projectId: props.project._id, sprintId: props.sprint.id, sprintName: wanted }),
    fallbackMessage: () => t("Toast.something_went_wrong"),
    done: () => emit("done")
});
</script>
