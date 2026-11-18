<template>
    <Modal
        :modelValue="open"
        :title="$t('TaskPanel.open_in_desktop_tracker')"
        :acceptButtonText="$t('TaskPanel.tracker_start_accept')"
        bodyClasses="tracker-modal-body"
        @close="open = false"
        @accept="confirm"
    >
        <template #body>
            <div class="tracker-modal-task">{{ task?.TaskKey }} · {{ task?.TaskName }}</div>
            <label class="tracker-modal-label" for="tracker-handoff-comment">{{ $t('TaskPanel.tracker_working_on') }}</label>
            <textarea
                id="tracker-handoff-comment"
                v-model="comment"
                rows="4"
                class="tracker-modal-textarea"
                :placeholder="$t('TaskPanel.tracker_comment_ph')"
                @input="error = ''"
            ></textarea>
            <div class="tracker-modal-error" v-if="error" role="alert">{{ error }}</div>
        </template>
    </Modal>
</template>

<script setup>
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import Modal from "@/components/atom/Modal/Modal.vue";
import { openInTracker, isTrackerCapableDevice } from "@/utils/trackerDeepLink";

defineOptions({ name: "TaskTrackerHandoff" });

const props = defineProps({
    task: { type: Object, required: true }
});

const { t } = useI18n();
const $toast = useToast();

const open = ref(false);
const comment = ref("");
const error = ref("");

function start() {
    if (!isTrackerCapableDevice()) {
        $toast.warning(t("TaskPanel.tracker_desktop_only"));
        return;
    }
    comment.value = "";
    error.value = "";
    open.value = true;
}

function confirm() {
    const text = (comment.value || "").trim();
    if (!text) {
        error.value = t("TaskPanel.tracker_comment_required");
        return;
    }
    const res = openInTracker({
        taskId: props.task?._id,
        projectId: props.task?.ProjectID,
        sprintId: props.task?.sprintId,
        folderId: props.task?.folderObjId || "",
        comment: text
    }, {
        // The web cannot tell "not installed" from "too old for the myapp:// link", so one toast covers both.
        onNotOpened: () => $toast.warning(t("Toast.tracker_not_opened"))
    });
    open.value = false;
    if (res.ok) $toast.success(t("TaskPanel.tracker_opening"));
    else if (res.reason === "unsupported") $toast.warning(t("TaskPanel.tracker_desktop_only"));
    else if (res.reason === "missing") $toast.error(t("TaskPanel.tracker_task_incomplete"));
    else $toast.error(t("TaskPanel.tracker_open_failed"));
}

defineExpose({ start });
</script>

<style>
.tracker-modal-task {
    font-size: 13px; color: var(--ink-2); background: var(--surface-2); border-radius: 6px;
    padding: 8px 10px; margin-bottom: 12px; overflow-wrap: break-word;
}
.tracker-modal-label { display: block; font-size: 13px; font-weight: 500; color: var(--ink); margin-bottom: 6px; }
.tracker-modal-textarea {
    width: 100%; border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px;
    font-size: 14px; font-family: inherit; resize: none; outline: none; background: var(--surface); color: var(--ink);
}
.tracker-modal-textarea:focus { border-color: var(--brand); box-shadow: 0 0 0 3px var(--brand-ring); }
.tracker-modal-error { color: var(--danger); font-size: 12px; margin-top: 6px; }
</style>
