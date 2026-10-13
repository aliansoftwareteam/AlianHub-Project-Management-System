<template>
    <section class="ah-card ai-agent" data-test="schedules">
        <div class="ah-label">{{ $t('Ai.schedule_title') }}</div>
        <p v-if="!isL3" class="ai-lead ai-schedules__lead" data-test="schedule-needs-l3">{{ $t('Ai.schedule_needs_l3') }}</p>
        <template v-else>
            <p class="ai-lead ai-schedules__lead">{{ $t('Ai.schedule_lead') }}</p>
            <div v-if="loading" class="ah-empty">{{ $t('Ai.loading') }}</div>
            <p v-else-if="!rows.length && !editing" class="ah-small" data-test="schedule-empty">{{ $t('Ai.schedule_empty') }}</p>

            <ul v-if="rows.length" class="ai-schedules">
                <li v-for="row in rows" :key="row._id" class="ai-schedule" data-test="schedule-row">
                    <div class="ai-schedule__main">
                        <div class="ai-schedule__head">
                            <strong>{{ $t(`Ai.report_${row.report}`) }}</strong>
                            <span v-if="!row.enabled" class="ah-chip">{{ $t('Ai.off') }}</span>
                            <span class="ah-chip ah-chip--sm">{{ row.ownerId === String(userId) ? $t('Ai.schedule_runs_as_you') : $t('Ai.schedule_runs_as_other') }}</span>
                            <span v-if="row.deliver && row.deliver.email" class="ah-chip ah-chip--sm">{{ row.mailConfigured === false ? $t('Ai.schedule_email_no_mail') : $t('Ai.schedule_email_on') }}</span>
                            <span v-if="row.deliver && row.deliver.taskId" class="ah-chip ah-chip--sm" :class="row.writes && row.writes.comment ? '' : 'ah-chip--warn'">{{ row.writes && row.writes.comment ? $t('Ai.schedule_comment_on') : $t('Ai.schedule_comment_read_only') }}</span>
                            <span v-if="row.deliver && row.deliver.pageProjectId" class="ah-chip ah-chip--sm" :class="row.writes && row.writes.page ? '' : 'ah-chip--warn'">{{ row.writes && row.writes.page ? $t('Ai.schedule_page_on') : $t('Ai.schedule_page_read_only') }}</span>
                        </div>
                        <span class="ah-small">{{ describeSchedule(t, row) }}</span>
                        <span class="ah-small ah-mono" data-test="schedule-next">{{ nextRunText(t, row, { locale }) }}</span>
                        <span class="ah-small ai-schedule__last">
                            {{ lastResultText(t, row) }}
                            <router-link v-if="row.lastResult && row.lastResult.runId" :to="{ name: 'AiRun', params: { cid: companyId, runId: row.lastResult.runId } }" data-test="schedule-last">{{ $t('Ai.schedule_last_open') }}</router-link>
                        </span>
                        <span v-if="row.lastResult && row.lastResult.reason && row.lastResult.status !== 'done'" class="ah-small ai-schedule__reason">{{ row.lastResult.reason }}</span>
                    </div>
                    <div v-if="mayEdit(row)" class="ai-schedule__actions">
                        <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :disabled="busy" data-test="schedule-toggle" @click="toggle(row)">{{ row.enabled ? $t('Ai.schedule_pause') : $t('Ai.schedule_resume') }}</button>
                        <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :disabled="busy" @click="edit(row)">{{ $t('Ai.schedule_edit') }}</button>
                        <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :disabled="busy" data-test="schedule-remove" @click="remove(row)">{{ $t('Ai.schedule_remove') }}</button>
                    </div>
                </li>
            </ul>

            <div v-if="editing" class="ai-schedule-editor" data-test="schedule-editor">
                <div class="ai-fields">
                    <div class="ah-field">
                        <label class="ah-field__label" for="sch-report">{{ $t('Ai.schedule_report') }}</label>
                        <select id="sch-report" v-model="form.report" class="ah-input" data-test="schedule-report">
                            <option v-for="key in REPORT_KEYS" :key="key" :value="key">{{ $t(`Ai.report_${key}`) }}</option>
                        </select>
                        <span class="ah-field__hint">{{ $t(`Ai.report_${form.report}_about`) }}</span>
                    </div>
                    <div class="ah-field">
                        <label class="ah-field__label" for="sch-every">{{ $t('Ai.schedule_every') }}</label>
                        <select id="sch-every" v-model="form.every" class="ah-input" data-test="schedule-every">
                            <option v-for="key in EVERY" :key="key" :value="key">{{ $t(`Ai.schedule_every_option_${key}`) }}</option>
                        </select>
                    </div>
                    <div v-if="form.every === 'weekly'" class="ah-field">
                        <label class="ah-field__label" for="sch-weekday">{{ $t('Ai.schedule_weekday') }}</label>
                        <select id="sch-weekday" v-model.number="form.weekday" class="ah-input" data-test="schedule-weekday">
                            <option v-for="day in WEEKDAYS" :key="day" :value="day">{{ weekdayName(t, day) }}</option>
                        </select>
                    </div>
                    <div class="ah-field">
                        <label class="ah-field__label" for="sch-at">{{ $t('Ai.schedule_at') }}</label>
                        <input id="sch-at" v-model="form.at" type="time" class="ah-input" data-test="schedule-at" />
                    </div>
                    <div class="ah-field">
                        <label class="ah-field__label" for="sch-zone">{{ $t('Ai.schedule_timezone') }}</label>
                        <input id="sch-zone" v-model.trim="form.timezone" type="text" class="ah-input" autocomplete="off" data-test="schedule-timezone" />
                        <span class="ah-field__hint">{{ $t('Ai.schedule_timezone_hint') }}</span>
                    </div>
                    <div v-if="form.report === 'deadline_watch'" class="ah-field">
                        <label class="ah-field__label" for="sch-days">{{ $t('Ai.schedule_days') }}</label>
                        <input id="sch-days" v-model.number="form.days" type="number" min="1" :max="MAX_DAYS" class="ah-input" data-test="schedule-days" />
                    </div>
                </div>

                <div class="ah-label ai-schedule-editor__deliver">{{ $t('Ai.schedule_deliver') }}</div>
                <p class="ah-small">{{ $t('Ai.schedule_deliver_inbox') }}</p>
                <label class="ai-schedule-editor__check">
                    <input v-model="form.email" type="checkbox" class="ah-check" data-test="schedule-email" />
                    <span>{{ $t('Ai.schedule_deliver_email') }}</span>
                </label>
                <div class="ai-fields">
                    <div class="ah-field">
                        <span class="ah-field__label">{{ $t('Ai.schedule_deliver_task') }}</span>
                        <div class="ai-schedule-editor__task">
                            <span class="ah-small">{{ form.taskId ? (taskLabel || $t('Ai.schedule_task_chosen')) : $t('Ai.schedule_task_none') }}</span>
                            <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" data-test="schedule-pick-task" @click="picking = true">{{ $t('Ai.schedule_pick_task') }}</button>
                            <button v-if="form.taskId" type="button" class="ah-btn ah-btn--ghost ah-btn--sm" @click="clearTask">{{ $t('Ai.schedule_task_clear') }}</button>
                        </div>
                    </div>
                    <div class="ah-field">
                        <label class="ah-field__label" for="sch-page">{{ $t('Ai.schedule_deliver_page') }}</label>
                        <select id="sch-page" v-model="form.pageProjectId" class="ah-input" data-test="schedule-page">
                            <option value="">{{ $t('Ai.schedule_page_none') }}</option>
                            <option v-for="p in projects" :key="p._id" :value="String(p._id)">{{ p.ProjectName }}</option>
                        </select>
                    </div>
                </div>
                <p class="ah-field__hint" data-test="schedule-writes-note">{{ $t('Ai.schedule_writes_note') }}</p>
                <p v-if="form.taskId || form.pageProjectId" class="ah-field__hint" data-test="schedule-shared-note">{{ $t('Ai.schedule_shared_scope_note') }}</p>

                <div v-if="formError" class="ah-field__error" data-test="schedule-error">{{ $t(formError) }}</div>
                <div v-else-if="saveError" class="ah-field__error" data-test="schedule-error">{{ saveError }}</div>
                <div class="ai-actions">
                    <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="busy" data-test="schedule-save" @click="save">{{ busy ? $t('Ai.saving') : $t('Ai.schedule_save') }}</button>
                    <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="busy" @click="cancel">{{ $t('Ai.cancel') }}</button>
                </div>
            </div>

            <button v-if="mayCreate && !editing" type="button" class="ah-btn ah-btn--secondary ah-btn--sm" data-test="schedule-add" @click="add">{{ $t('Ai.schedule_add') }}</button>
        </template>

        <RunTaskPicker
            v-if="picking"
            :agent="{ name: '', projectIds }"
            :title="$t('Ai.schedule_pick_task')"
            :cta="$t('Ai.schedule_pick_task_cta')"
            :requirement-codes="[]"
            @run="onPickTask"
            @close="picking = false"
        />
    </section>
</template>

<script setup>
import { computed, inject, onMounted, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import RunTaskPicker from "./RunTaskPicker.vue";
import { reasonOf } from "./useAgents";
import { EVERY, MAX_DAYS, REPORT_KEYS, WEEKDAYS, blankSchedule, describeSchedule, lastResultText, nextRunText, scheduleError, scheduleForm, schedulePayload, weekdayName } from "./agentSchedule";

defineOptions({ name: "AgentSchedules" });

const L3 = 3;

const props = defineProps({
    agentId: { type: String, required: true },
    autonomy: { type: Number, default: 0 },
    canManage: { type: Boolean, default: false },
    agentOwnerId: { type: String, default: "" },
    projectIds: { type: Array, default: () => [] },
    projects: { type: Array, default: () => [] }
});

const { t, locale } = useI18n();
const injectedUserId = inject("$userId", null);
const injectedCompanyId = inject("$companyId", null);
const userId = computed(() => injectedUserId?.value ?? injectedUserId ?? "");
const companyId = computed(() => injectedCompanyId?.value ?? injectedCompanyId ?? "");

const isL3 = computed(() => Number(props.autonomy) >= L3);
const mayCreate = computed(() => props.canManage || (Boolean(props.agentOwnerId) && props.agentOwnerId === String(userId.value)));
const mayEdit = (row) => mayCreate.value || row.ownerId === String(userId.value);

const rows = ref([]);
const loading = ref(false);
const busy = ref(false);
const editing = ref(false);
const editingId = ref("");
const picking = ref(false);
const taskLabel = ref("");
const formError = ref("");
const saveError = ref("");
const form = reactive(blankSchedule());

const base = computed(() => `${env.AGENTS}/${props.agentId}/schedules`);

const load = async () => {
    if (!isL3.value) return;
    loading.value = true;
    try {
        const res = await apiRequest("get", base.value);
        rows.value = res?.data?.status ? (res.data.data || []) : [];
    } catch (e) {
        saveError.value = reasonOf(e, "Ai.load_failed");
    } finally {
        loading.value = false;
    }
};

const reset = (values) => {
    Object.assign(form, values);
    formError.value = "";
    saveError.value = "";
    taskLabel.value = "";
};

const add = () => { reset(blankSchedule()); editingId.value = ""; editing.value = true; };
const edit = (row) => { reset(scheduleForm(row)); editingId.value = row._id; editing.value = true; };
const cancel = () => { editing.value = false; editingId.value = ""; };
const clearTask = () => { form.taskId = ""; taskLabel.value = ""; };
const onPickTask = (task) => {
    form.taskId = String(task._id);
    taskLabel.value = [task.TaskKey, task.TaskName].filter(Boolean).join(" ");
    picking.value = false;
};

const send = async (type, url, body) => {
    const res = await apiRequest(type, url, body);
    if (!res?.data?.status) throw new Error(res?.data?.message || res?.data?.statusText || t("Ai.schedule_save_failed"));
    return res.data.data;
};

const save = async () => {
    formError.value = scheduleError(form);
    if (formError.value) return;
    busy.value = true;
    saveError.value = "";
    try {
        const payload = schedulePayload(form);
        if (editingId.value) await send("put", `${base.value}/${editingId.value}`, payload);
        else await send("post", base.value, payload);
        editing.value = false;
        await load();
    } catch (e) {
        saveError.value = reasonOf(e, "Ai.schedule_save_failed");
    } finally {
        busy.value = false;
    }
};

const toggle = async (row) => {
    busy.value = true;
    try {
        await send("put", `${base.value}/${row._id}`, { enabled: !row.enabled });
        await load();
    } catch (e) {
        saveError.value = reasonOf(e, "Ai.schedule_save_failed");
    } finally {
        busy.value = false;
    }
};

const remove = async (row) => {
    busy.value = true;
    try {
        await send("delete", `${base.value}/${row._id}`);
        await load();
    } catch (e) {
        saveError.value = reasonOf(e, "Ai.schedule_save_failed");
    } finally {
        busy.value = false;
    }
};

watch(() => props.autonomy, (now, before) => { if (now >= L3 && !(before >= L3)) load(); });
onMounted(load);
</script>

<style>
.ai-schedules__lead { margin: 6px 0 10px; }
.ai-schedules { list-style: none; margin: 0 0 10px; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.ai-schedule { display: flex; gap: 10px; align-items: flex-start; justify-content: space-between; padding: 10px 12px; border: 1px solid var(--hairline); border-radius: 9px; flex-wrap: wrap; }
.ai-schedule__main { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1; }
.ai-schedule__head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ai-schedule__last { display: flex; gap: 6px; align-items: baseline; flex-wrap: wrap; color: var(--ink-2); }
.ai-schedule__reason { color: var(--ink-2); overflow-wrap: anywhere; }
.ai-schedule__actions { display: flex; gap: 4px; flex-wrap: wrap; }
.ai-schedule-editor { margin: 6px 0 12px; padding: 12px; border: 1px solid var(--border); border-radius: 9px; background: var(--surface); }
.ai-schedule-editor__deliver { margin-top: 12px; }
.ai-schedule-editor__check { display: flex; align-items: center; gap: 8px; font: var(--text-body); margin: 6px 0; }
.ai-schedule-editor__task { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
</style>
