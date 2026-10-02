<template>
    <section class="ah-time" :aria-labelledby="`${uid}-head`">
        <div class="ah-time__head">
            <span :id="`${uid}-head`" class="ah-label">{{ $t('TaskPanel.time') }}</span>
            <span class="ah-mono ah-time__total" data-test="time-total">{{ totalText }}</span>
        </div>
        <div
            v-if="estimate"
            class="ah-time__bar"
            :class="{ 'is-over': over > 0 }"
            role="progressbar"
            :aria-label="$t('TaskPanel.time_progress')"
            aria-valuemin="0"
            :aria-valuemax="estimate"
            :aria-valuenow="Math.min(total, estimate)"
            :aria-valuetext="totalText"
        ><span class="ah-time__fill" :style="{ width: `${progress}%` }"></span></div>
        <p v-if="over > 0" class="ah-small ah-time__over">{{ $t('TaskPanel.time_over', { over: formatMinutes(over) }) }}</p>

        <div class="ah-time__actions">
            <TaskTimerChip v-if="showTimer" :task="task" :project="project" :canStart="canTrack" @logged="refresh" />
            <button
                v-if="!formOpen"
                type="button"
                class="ah-btn ah-btn--secondary ah-btn--sm ah-time__add"
                :aria-expanded="formOpen ? 'true' : 'false'"
                data-test="time-add"
                @click="openForm()"
            ><ShellIcon name="plus" :size="13" /> {{ $t('TaskPanel.time_add') }}</button>
        </div>

        <form v-if="formOpen" class="ah-time__form" novalidate :aria-label="form.timeSheetId ? $t('TaskPanel.time_edit_entry') : $t('TaskPanel.time_add')" @submit.prevent="submit">
            <div class="ah-time__grid">
                <label class="ah-time__field">
                    <span class="ah-time__caption">{{ $t('TaskPanel.time_date') }}</span>
                    <input v-model="form.date" type="date" class="ah-time__input" required data-test="time-date" />
                </label>
                <label class="ah-time__field">
                    <span class="ah-time__caption">{{ $t('TaskPanel.time_start') }}</span>
                    <input v-model="form.start" type="time" class="ah-time__input" required data-test="time-start" />
                </label>
                <label class="ah-time__field">
                    <span class="ah-time__caption">{{ $t('TaskPanel.time_hours') }}</span>
                    <input v-model.number="form.hours" type="number" min="0" max="23" class="ah-time__input" data-test="time-hours" />
                </label>
                <label class="ah-time__field">
                    <span class="ah-time__caption">{{ $t('TaskPanel.time_minutes') }}</span>
                    <input
                        v-model.number="form.minutes" type="number" min="0" max="59" class="ah-time__input" data-test="time-minutes"
                        @keydown.up.prevent="form.minutes = nudgedMinutes(form.minutes, 1)"
                        @keydown.down.prevent="form.minutes = nudgedMinutes(form.minutes, -1)"
                    />
                </label>
            </div>
            <label class="ah-time__field">
                <span class="ah-time__caption">{{ $t('TaskPanel.time_note') }}</span>
                <input v-model="form.note" type="text" maxlength="500" class="ah-time__input" :placeholder="$t('TaskPanel.time_note_ph')" data-test="time-note" />
            </label>
            <label class="ah-time__check">
                <input v-model="form.billable" type="checkbox" data-test="time-billable" />
                {{ $t('TaskPanel.time_billable') }}
            </label>
            <p v-if="formError" class="ah-time__error" role="alert">{{ formError }}</p>
            <div class="ah-time__form-actions">
                <button type="submit" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="saving" data-test="time-save">{{ $t('TaskPanel.time_save') }}</button>
                <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="closeForm">{{ $t('TaskPanel.time_cancel') }}</button>
            </div>
        </form>

        <ul v-if="entries.length" class="ah-time__list" :aria-label="$t('TaskPanel.time_entries')">
            <li v-for="entry in entries" :key="entry._id" class="ah-time__entry" data-test="time-entry">
                <div class="ah-time__entry-main">
                    <span class="ah-time__who">{{ nameOf(entry.userId) }}</span>
                    <span class="ah-small ah-time__when">{{ dayOf(entry.startedAt) }}</span>
                    <span v-if="entry.note" class="ah-small ah-time__note">{{ entry.note }}</span>
                </div>
                <span class="ah-mono ah-time__minutes">{{ formatMinutes(entry.minutes) }}</span>
                <span v-if="entry.locked" class="ah-time__flag" :title="$t('TaskPanel.time_locked')">
                    <ShellIcon name="lock" :size="12" /><span class="visually-hidden">{{ $t('TaskPanel.time_locked') }}</span>
                </span>
                <span v-else-if="entry.running" class="ah-time__flag ah-small">{{ $t('TaskPanel.time_running') }}</span>
                <span v-else-if="entry.source === 'tracker'" class="ah-time__flag" :title="$t('TaskPanel.time_tracker_entry')">
                    <ShellIcon name="monitor" :size="12" /><span class="visually-hidden">{{ $t('TaskPanel.time_tracker_entry') }}</span>
                </span>
                <span v-if="entry.canEdit" class="ah-time__entry-actions">
                    <button type="button" class="ah-time__icon-btn ah-small" :aria-label="$t('TaskPanel.time_edit_entry')" data-test="time-edit" @click="openForm(entry)">{{ $t('TaskPanel.time_edit') }}</button>
                    <button
                        type="button"
                        class="ah-time__icon-btn"
                        :class="{ 'is-confirming': confirmId === entry._id }"
                        :aria-label="confirmId === entry._id ? $t('TaskPanel.time_confirm_delete') : $t('TaskPanel.time_delete_entry')"
                        :title="confirmId === entry._id ? $t('TaskPanel.time_confirm_delete') : $t('TaskPanel.time_delete_entry')"
                        data-test="time-delete"
                        @click="removeEntry(entry)"
                    >
                        <ShellIcon name="trash" :size="13" />
                        <span v-if="confirmId === entry._id" class="ah-small">{{ $t('TaskPanel.time_confirm_delete') }}</span>
                    </button>
                </span>
            </li>
        </ul>
        <p v-else-if="loaded" class="ah-small ah-time__empty">{{ $t('TaskPanel.time_no_entries') }}</p>
        <p v-if="!seesEveryone && total > mine" class="ah-small ah-time__scope">{{ $t('TaskPanel.time_only_yours', { mine: formatMinutes(mine) }) }}</p>
    </section>
</template>

<script setup>
import { computed, inject, reactive, ref, watch } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import moment from "moment";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { useGetterFunctions } from "@/composable";
import { useEscapeLayer } from "@/composable/useEscapeLayer";
import { timeLogFailureKey } from "@/composable/timeLogFailure";
import TaskTimerChip from "./TaskTimerChip.vue";
import { formatMinutes, emptyTimeForm, timeFormFromEntry, timeFormProblem, nudgedMinutes, manualLogBody, deleteLogBody } from "./taskTime";

defineOptions({ name: "TaskTimeSection" });

const props = defineProps({
    task: { type: Object, required: true },
    project: { type: Object, default: () => ({}) },
    canTrack: { type: Boolean, default: true },
    showTimer: { type: Boolean, default: true }
});

const { t } = useI18n();
const $toast = useToast();
const { getters } = useStore();
const { getUser } = useGetterFunctions();
const userId = inject("$userId");
const companyId = inject("$companyId", ref(""));

const uid = `time-${Math.random().toString(36).slice(2, 9)}`;
const entries = ref([]);
const total = ref(0);
const mine = ref(0);
const estimate = ref(0);
const seesEveryone = ref(false);
const loaded = ref(false);
const formOpen = ref(false);
const saving = ref(false);
const formError = ref("");
const confirmId = ref("");
const form = reactive(emptyTimeForm());

const over = computed(() => (estimate.value ? total.value - estimate.value : 0));
const progress = computed(() => (estimate.value ? Math.min(100, Math.round((total.value / estimate.value) * 100)) : 0));
const totalText = computed(() => (estimate.value
    ? t("TaskPanel.time_logged_of", { logged: formatMinutes(total.value), estimate: formatMinutes(estimate.value) })
    : t("TaskPanel.time_logged", { logged: formatMinutes(total.value) })));

useEscapeLayer(formOpen, () => closeForm());

function nameOf(id) {
    return getUser(id)?.Employee_Name || t("TaskPanel.time_someone");
}

function dayOf(seconds) {
    return moment((Number(seconds) || 0) * 1000).format("ddd D MMM, HH:mm");
}

function context() {
    const owner = getters["settings/companyOwnerDetail"] || {};
    return {
        task: props.task,
        companyId: companyId.value || props.task.CompanyId || "",
        userId: userId.value,
        projectName: props.project?.ProjectName || "",
        dateFormat: getters["settings/companyDateFormat"]?.dateFormat || "DD/MM/YYYY",
        companyOwnerId: owner.userId || owner._id || userId.value,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        defaultNote: t("TaskPanel.time_default_note")
    };
}

async function refresh() {
    const taskId = props.task?._id;
    if (!taskId) return;
    try {
        const response = await apiRequest("get", `/api/v1/timesheet/task/${taskId}`);
        const data = response?.data?.status ? response.data.data : null;
        if (!data || String(props.task?._id) !== String(taskId)) return;
        entries.value = data.entries || [];
        total.value = Number(data.totalMinutes) || 0;
        mine.value = Number(data.mineMinutes) || 0;
        estimate.value = Number(data.estimateMinutes) || 0;
        seesEveryone.value = Boolean(data.seesEveryone);
    } catch (error) {
        console.error("ERROR in task time entries: ", error);
    } finally {
        loaded.value = true;
    }
}

function openForm(entry) {
    Object.assign(form, entry ? timeFormFromEntry(entry) : emptyTimeForm());
    formError.value = "";
    confirmId.value = "";
    formOpen.value = true;
}

function closeForm() {
    formOpen.value = false;
    formError.value = "";
}

const failureOf = (response, fallback) => {
    const key = timeLogFailureKey(response, "");
    return key ? t(key) : (response?.statusText || t(fallback));
};

async function submit() {
    const problem = timeFormProblem(form);
    if (problem) { formError.value = t(problem); return; }
    saving.value = true;
    formError.value = "";
    try {
        const response = await apiRequest("post", env.ADD_TIMELOG, manualLogBody(form, context()));
        if (response?.data?.status === false) {
            formError.value = failureOf(response.data, "TaskPanel.time_failed");
            return;
        }
        formOpen.value = false;
        $toast.success(t("TaskPanel.time_saved"), { position: "top-right" });
        await refresh();
    } catch (error) {
        formError.value = failureOf(error?.response?.data, "TaskPanel.time_failed");
    } finally {
        saving.value = false;
    }
}

async function removeEntry(entry) {
    if (confirmId.value !== entry._id) {
        confirmId.value = entry._id;
        return;
    }
    confirmId.value = "";
    try {
        const response = await apiRequest("post", env.DELETE_TIMELOG, deleteLogBody(entry, context()));
        if (response?.data?.status === false) {
            $toast.error(failureOf(response.data, "TaskPanel.time_delete_failed"), { position: "top-right" });
            return;
        }
        $toast.success(t("TaskPanel.time_deleted"), { position: "top-right" });
        await refresh();
    } catch (error) {
        $toast.error(failureOf(error?.response?.data, "TaskPanel.time_delete_failed"), { position: "top-right" });
    }
}

watch(() => props.task?._id, () => {
    entries.value = [];
    loaded.value = false;
    closeForm();
    refresh();
}, { immediate: true });

watch(() => props.task?.totalEstimatedTime, (value) => {
    if (value !== undefined) estimate.value = Number(value) || 0;
});

defineExpose({ refresh });
</script>

<style scoped>
.ah-time { display: flex; flex-direction: column; gap: 8px; }
.ah-time__head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.ah-time__total { color: var(--ink); font-size: var(--fs-sm, 12px); }
.ah-time__bar { height: 6px; border-radius: 3px; background: var(--surface-2); overflow: hidden; }
.ah-time__fill { display: block; height: 100%; background: var(--ok); border-radius: inherit; }
.ah-time__bar.is-over .ah-time__fill { background: var(--danger); }
.ah-time__over { margin: 0; color: var(--danger); }
.ah-time__actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.ah-time__add { display: inline-flex; align-items: center; gap: 5px; }
.ah-time__form { display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
.ah-time__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.ah-time__field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.ah-time__caption { font: 500 var(--fs-xs, 11px) var(--font-ui); color: var(--ink-label); }
.ah-time__input {
    width: 100%; min-height: 32px; padding: 4px 8px; border: 1px solid var(--border); border-radius: 7px;
    background: var(--surface); color: var(--ink); font: 400 var(--fs-md, 13px) var(--font-ui);
}
.ah-time__check { display: inline-flex; align-items: center; gap: 6px; font: 400 var(--fs-md, 13px) var(--font-ui); color: var(--ink); }
.ah-time__error { margin: 0; color: var(--danger); font: 500 var(--fs-sm, 12px) var(--font-ui); }
.ah-time__form-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.ah-time__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.ah-time__entry { display: flex; align-items: center; gap: 8px; padding: 7px 0; border-top: 1px solid var(--hairline); }
.ah-time__entry-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.ah-time__who { font: 500 var(--fs-md, 12.5px) var(--font-ui); color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ah-time__when, .ah-time__note { color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ah-time__minutes { font-size: var(--fs-sm, 12px); color: var(--ink); flex: none; }
.ah-time__flag { display: inline-flex; align-items: center; color: var(--ink-2); flex: none; }
.ah-time__entry-actions { display: inline-flex; gap: 2px; flex: none; }
.ah-time__icon-btn {
    display: inline-flex; align-items: center; gap: 4px; min-width: 28px; min-height: 28px; padding: 0 5px; border: 0; border-radius: 6px;
    background: transparent; color: var(--ink-2); cursor: pointer;
}
.ah-time__icon-btn:hover { background: var(--surface-hover); color: var(--ink); }
.ah-time__icon-btn.is-confirming { color: var(--danger); background: var(--danger-bg); }
.ah-time__icon-btn:focus-visible, .ah-time__input:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
.ah-time__empty, .ah-time__scope { margin: 0; color: var(--ink-2); }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
@media (max-width: 767px) {
    .ah-time__input, .ah-time__icon-btn { min-height: 40px; }
    .ah-time__icon-btn { min-width: 40px; }
}
</style>
