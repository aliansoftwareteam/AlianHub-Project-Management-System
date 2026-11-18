<template>
    <div class="imu">
        <p v-if="state === 'done'" class="ah-small imu__text" role="status" data-test="imu-done">{{ $t('WorkspaceImport.undo_done', { count: trashed }) }}</p>
        <button v-else-if="state === 'idle'" type="button" class="ah-btn ah-btn--ghost ah-btn--sm" data-test="imu-start" @click="state = 'confirm'">{{ $t('WorkspaceImport.undo_start') }}</button>
        <div v-else class="imu__box" role="group" :aria-label="$t('WorkspaceImport.undo_start')">
            <p class="ah-small imu__text" data-test="imu-question">{{ edited.length ? $t('WorkspaceImport.undo_edited', { count: editedCount }) : $t('WorkspaceImport.undo_confirm', { count }) }}</p>
            <ul v-if="edited.length" class="ah-small imu__list" data-test="imu-edited">
                <li v-for="task in edited" :key="task.id">{{ task.name }}</li>
            </ul>
            <p v-if="error" class="ah-small imu__error" role="alert">{{ error }}</p>
            <div class="imu__actions">
                <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="busy" data-test="imu-confirm" @click="run">{{ edited.length ? $t('WorkspaceImport.undo_keep_edited') : $t('WorkspaceImport.undo_confirm_button') }}</button>
                <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :disabled="busy" data-test="imu-cancel" @click="cancel">{{ $t('WorkspaceImport.undo_cancel') }}</button>
            </div>
        </div>
        <template v-if="kept.length">
            <p class="ah-small imu__text">{{ $t('WorkspaceImport.undo_kept', { count: kept.length }) }}</p>
            <ul class="ah-small imu__list" data-test="imu-kept">
                <li v-for="task in kept" :key="task.id">{{ task.name }}</li>
            </ul>
        </template>
    </div>
</template>

<script setup>
import { defineEmits, defineProps, ref } from "vue";
import { useI18n } from "vue-i18n";
import { undoImportJob } from "./importUndo";

defineOptions({ name: "ImportUndo" });

const props = defineProps({
    jobIds: { type: Array, required: true },
    count: { type: Number, default: 0 }
});
const emit = defineEmits(["undone"]);
const { t } = useI18n();

const state = ref("idle");
const busy = ref(false);
const error = ref("");
const edited = ref([]);
const editedCount = ref(0);
const kept = ref([]);
const trashed = ref(0);
let pending = null;

function cancel() {
    state.value = "idle";
    error.value = "";
}

/* A job with tasks someone has worked on is held back until the person says those tasks may stay. */
async function run() {
    const keepEdited = edited.value.length > 0;
    pending = pending || props.jobIds.map(String);
    busy.value = true;
    error.value = "";
    const held = [];
    const heldTasks = [];
    let heldCount = 0;
    for (const jobId of pending) {
        const answer = await undoImportJob(jobId, keepEdited);
        if (answer.outcome === "undone") {
            trashed.value += answer.trashed;
            kept.value = [...kept.value, ...answer.kept];
        } else if (answer.outcome === "edited") {
            held.push(jobId);
            heldTasks.push(...answer.edited);
            heldCount += answer.editedCount;
        } else if (answer.outcome === "failed") {
            held.push(jobId);
            error.value = answer.message || t("WorkspaceImport.undo_failed");
        }
    }
    pending = held;
    edited.value = heldTasks;
    editedCount.value = heldCount;
    busy.value = false;
    if (pending.length) return;
    state.value = "done";
    emit("undone", { trashed: trashed.value });
}
</script>

<style scoped>
.imu { display: flex; flex-direction: column; gap: 6px; min-width: 0; align-items: flex-start; }
.imu__box { display: flex; flex-direction: column; gap: 6px; width: 100%; padding: 10px; border: 1px solid var(--border); border-radius: var(--r-input, 6px); background: var(--canvas); }
.imu__text { margin: 0; color: var(--ink); overflow-wrap: anywhere; }
.imu__list { margin: 0; padding-left: 18px; color: var(--ink-2); display: grid; gap: 2px; overflow-wrap: anywhere; }
.imu__error { margin: 0; color: var(--danger-ink, var(--danger)); }
.imu__actions { display: flex; flex-wrap: wrap; gap: 8px; }
</style>
