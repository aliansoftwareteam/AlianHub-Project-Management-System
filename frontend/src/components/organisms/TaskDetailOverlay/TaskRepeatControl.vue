<template>
    <div v-if="canSee" class="d-flex task-detail-right-side-label ah-repeat">
        <div class="task-detail-field-name" :id="`${uid}-label`">{{ $t('TaskPanel.repeat') }}</div>
        <div class="ah-repeat__body">
            <button
                type="button"
                class="ah-repeat__summary"
                :class="{ 'is-set': rule }"
                :disabled="!canEdit"
                :title="canEdit ? '' : $t('TaskPanel.repeat_no_permission')"
                :aria-labelledby="`${uid}-label ${uid}-summary`"
                :aria-expanded="open ? 'true' : 'false'"
                :aria-controls="`${uid}-editor`"
                @click="toggle"
            >
                <ShellIcon name="refresh" :size="13" />
                <span :id="`${uid}-summary`">{{ loading ? '…' : summary }}</span>
            </button>

            <div v-if="open" :id="`${uid}-editor`" class="ah-repeat__editor" role="group" :aria-label="$t('TaskPanel.repeat_editor')">
                <div class="ah-repeat__row">
                    <label class="ah-repeat__field">
                        <span class="ah-repeat__caption">{{ $t('TaskPanel.repeat_frequency') }}</span>
                        <select v-model="form.freq" class="ah-repeat__input" data-test="repeat-freq">
                            <option value="daily">{{ $t('TaskPanel.repeat_daily') }}</option>
                            <option value="weekly">{{ $t('TaskPanel.repeat_weekly') }}</option>
                            <option value="monthly">{{ $t('TaskPanel.repeat_monthly') }}</option>
                        </select>
                    </label>
                    <label class="ah-repeat__field">
                        <span class="ah-repeat__caption">{{ $t('TaskPanel.repeat_every') }}</span>
                        <span class="ah-repeat__inline">
                            <input v-model.number="form.interval" type="number" min="1" max="365" class="ah-repeat__input ah-repeat__num" data-test="repeat-interval" />
                            <span class="ah-small">{{ $t(unitKey, form.interval || 1) }}</span>
                        </span>
                    </label>
                </div>

                <div v-if="form.freq === 'weekly'" class="ah-repeat__days" role="group" :aria-label="$t('TaskPanel.repeat_on_days')">
                    <button
                        v-for="(name, day) in dayNames"
                        :key="day"
                        type="button"
                        class="ah-repeat__day"
                        :class="{ 'is-on': form.byweekday.includes(day) }"
                        :aria-pressed="form.byweekday.includes(day) ? 'true' : 'false'"
                        :data-test="`repeat-day-${day}`"
                        @click="toggleDay(day)"
                    >{{ name }}</button>
                </div>

                <label v-if="form.freq === 'monthly'" class="ah-repeat__field">
                    <span class="ah-repeat__caption">{{ $t('TaskPanel.repeat_day_of_month') }}</span>
                    <input v-model.number="form.monthday" type="number" min="1" max="28" class="ah-repeat__input ah-repeat__num" data-test="repeat-monthday" />
                </label>

                <fieldset class="ah-repeat__ends">
                    <legend class="ah-repeat__caption">{{ $t('TaskPanel.repeat_ends') }}</legend>
                    <label class="ah-repeat__radio">
                        <input v-model="form.ends" type="radio" value="never" :name="`${uid}-ends`" />
                        {{ $t('TaskPanel.repeat_ends_never') }}
                    </label>
                    <label class="ah-repeat__radio">
                        <input v-model="form.ends" type="radio" value="on" :name="`${uid}-ends`" data-test="repeat-ends-on" />
                        {{ $t('TaskPanel.repeat_ends_on') }}
                        <input
                            v-model="form.until"
                            type="date"
                            class="ah-repeat__input"
                            :disabled="form.ends !== 'on'"
                            :aria-label="$t('TaskPanel.repeat_ends_on')"
                            data-test="repeat-until"
                        />
                    </label>
                    <label class="ah-repeat__radio">
                        <input v-model="form.ends" type="radio" value="after" :name="`${uid}-ends`" data-test="repeat-ends-after" />
                        {{ $t('TaskPanel.repeat_ends_after') }}
                        <input
                            v-model.number="form.maxRuns"
                            type="number"
                            min="1"
                            max="1000"
                            class="ah-repeat__input ah-repeat__num"
                            :disabled="form.ends !== 'after'"
                            :aria-label="$t('TaskPanel.repeat_occurrences')"
                            data-test="repeat-max-runs"
                        />
                        {{ $t('TaskPanel.repeat_occurrences') }}
                    </label>
                </fieldset>

                <label class="ah-repeat__field">
                    <span class="ah-repeat__caption">{{ $t('TaskPanel.repeat_when_open') }}</span>
                    <select v-model="form.missedPolicy" class="ah-repeat__input" data-test="repeat-missed">
                        <option v-for="option in missedOptions" :key="option.value" :value="option.value">{{ $t(option.label) }}</option>
                    </select>
                </label>

                <p class="ah-small ah-repeat__next" aria-live="polite">{{ nextText }}</p>
                <p class="ah-small">{{ $t('TaskPanel.repeat_hint') }}</p>
                <p v-if="error" class="ah-repeat__error" role="alert">{{ error }}</p>

                <div class="ah-repeat__actions">
                    <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="saving" data-test="repeat-save" @click="save">{{ $t('TaskPanel.repeat_save') }}</button>
                    <button v-if="rule" type="button" class="ah-btn ah-btn--ghost ah-btn--sm ah-repeat__danger" :disabled="saving" data-test="repeat-remove" @click="remove">{{ $t('TaskPanel.repeat_remove') }}</button>
                    <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="close">{{ $t('TaskPanel.repeat_cancel') }}</button>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { apiRequest } from "@/services";
import { useCustomComposable } from "@/composable";
import { useEscapeLayer } from "@/composable/useEscapeLayer";
import { emptyRepeat, repeatFromRule, ruleFromRepeat, repeatProblem, describeRepeat, upcomingRuns, weekdayNames } from "./taskRepeat";

defineOptions({ name: "TaskRepeatControl" });

const props = defineProps({
    task: { type: Object, required: true },
    project: { type: Object, default: () => ({}) }
});

const { t, locale } = useI18n();
const $toast = useToast();
const { checkPermission } = useCustomComposable();

const uid = `repeat-${Math.random().toString(36).slice(2, 9)}`;
const missedOptions = [
    { value: "skip", label: "Members.missed_skip" },
    { value: "create", label: "Members.missed_create" },
    { value: "roll", label: "Members.missed_roll" }
];

const rule = ref(null);
const loading = ref(false);
const open = ref(false);
const saving = ref(false);
const error = ref("");
const form = reactive(emptyRepeat());

const global = computed(() => props.project?.isGlobalPermission);
const canSee = computed(() => checkPermission("task.task_due_date", global.value) !== null);
const canEdit = computed(() => checkPermission("task.task_due_date", global.value) === true && checkPermission("task.task_create", global.value) === true);
const dayNames = computed(() => weekdayNames(locale.value));
const summary = computed(() => describeRepeat(rule.value, { t, locale: locale.value }));
const unitKey = computed(() => ({ daily: "TaskPanel.repeat_unit_days", weekly: "TaskPanel.repeat_unit_weeks", monthly: "TaskPanel.repeat_unit_months" }[form.freq]));
const nextText = computed(() => {
    const runs = upcomingRuns(ruleFromRepeat(form), { runCount: rule.value?.runCount || 0 });
    if (!runs.length) return t("TaskPanel.repeat_no_next");
    const dates = runs.map((d) => d.toLocaleDateString(locale.value, { weekday: "short", day: "numeric", month: "short" })).join(", ");
    return t("TaskPanel.repeat_next", { dates });
});

useEscapeLayer(open, () => close());

function close() {
    open.value = false;
    error.value = "";
}

function toggle() {
    if (open.value) return close();
    Object.assign(form, repeatFromRule(rule.value));
    error.value = "";
    open.value = true;
}

function toggleDay(day) {
    const days = new Set(form.byweekday);
    if (days.has(day)) days.delete(day);
    else days.add(day);
    form.byweekday = [...days].sort();
}

const endpoint = () => `/api/v1/recurring-tasks/task/${props.task._id}`;
const failureText = (err, fallback) => err?.response?.data?.statusText || err?.data?.statusText || t(fallback);

async function load() {
    rule.value = null;
    if (!props.task?._id || !canSee.value) return;
    loading.value = true;
    try {
        const response = await apiRequest("get", endpoint());
        rule.value = response?.data?.status ? response.data.data || null : null;
    } catch (err) {
        console.error("ERROR in load task repeat: ", err);
    } finally {
        loading.value = false;
    }
}

async function save() {
    const problem = repeatProblem(form);
    if (problem) { error.value = t(problem); return; }
    saving.value = true;
    error.value = "";
    try {
        const response = await apiRequest("put", endpoint(), ruleFromRepeat(form));
        if (!response?.data?.status) throw { data: response?.data };
        rule.value = response.data.data;
        open.value = false;
        $toast.success(t("TaskPanel.repeat_saved"), { position: "top-right" });
    } catch (err) {
        error.value = failureText(err, "TaskPanel.repeat_failed");
    } finally {
        saving.value = false;
    }
}

async function remove() {
    saving.value = true;
    error.value = "";
    try {
        const response = await apiRequest("delete", endpoint());
        if (!response?.data?.status) throw { data: response?.data };
        rule.value = null;
        open.value = false;
        $toast.success(t("TaskPanel.repeat_removed"), { position: "top-right" });
    } catch (err) {
        error.value = failureText(err, "TaskPanel.repeat_failed");
    } finally {
        saving.value = false;
    }
}

watch(() => props.task?._id, () => { close(); load(); }, { immediate: true });
</script>

<style scoped>
.ah-repeat { align-items: flex-start; }
.ah-repeat__body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.ah-repeat__summary {
    display: inline-flex; align-items: center; gap: 6px; max-width: 100%; min-height: 32px; padding: 5px 8px;
    border: 1px solid transparent; border-radius: 7px; background: transparent; color: var(--ink-2);
    font: 400 13px var(--font-ui); text-align: left; cursor: pointer;
}
.ah-repeat__summary span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ah-repeat__summary.is-set { color: var(--ink); }
.ah-repeat__summary:hover:not(:disabled) { background: var(--surface-hover); }
.ah-repeat__summary:focus-visible, .ah-repeat__day:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
.ah-repeat__summary:disabled { cursor: default; }
.ah-repeat__editor {
    display: flex; flex-direction: column; gap: 10px; padding: 12px; border: 1px solid var(--border);
    border-radius: 10px; background: var(--surface); color: var(--ink);
}
.ah-repeat__row { display: flex; flex-wrap: wrap; gap: 10px; }
.ah-repeat__field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.ah-repeat__caption { font: 500 11px var(--font-ui); color: var(--ink-label); padding: 0; }
.ah-repeat__inline { display: inline-flex; align-items: center; gap: 6px; }
.ah-repeat__input {
    min-height: 32px; padding: 4px 8px; border: 1px solid var(--border); border-radius: 7px;
    background: var(--surface); color: var(--ink); font: 400 13px var(--font-ui); max-width: 100%;
}
.ah-repeat__input:disabled { opacity: .55; }
.ah-repeat__num { width: 68px; }
.ah-repeat__days { display: flex; flex-wrap: wrap; gap: 4px; }
.ah-repeat__day {
    min-width: 40px; min-height: 32px; padding: 0 6px; border: 1px solid var(--border); border-radius: 7px;
    background: var(--surface); color: var(--ink-2); font: 500 12px var(--font-ui); cursor: pointer;
}
.ah-repeat__day.is-on { background: var(--brand); border-color: var(--brand); color: var(--on-brand); }
.ah-repeat__ends { display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 0; border: 0; }
.ah-repeat__radio { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font: 400 13px var(--font-ui); color: var(--ink); }
.ah-repeat__next { color: var(--ink-2); margin: 0; }
.ah-repeat__error { margin: 0; color: var(--danger); font: 500 12px var(--font-ui); }
.ah-repeat__actions { display: flex; flex-wrap: wrap; gap: 6px; }
.ah-repeat__danger { color: var(--danger); }
@media (max-width: 767px) {
    .ah-repeat { flex-direction: column; }
    .ah-repeat__input, .ah-repeat__summary, .ah-repeat__day { min-height: 40px; }
}
</style>
