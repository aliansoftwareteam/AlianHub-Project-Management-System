<template>
    <div class="rtx ah-page">
        <header class="ah-toolbar rtx__bar">
            <h1 class="ah-toolbar__title">{{ $t('Members.recurring') }}</h1>
            <span class="ah-mono rtx__count">{{ $t('Members.rules_count', { rules: defs.length }) }}</span>
            <div class="ah-toolbar__spacer"></div>
            <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" @click="startNew()">
                <ShellIcon name="plus" :size="14" /> {{ $t('Members.new_rule') }}
            </button>
        </header>

        <div class="rtx__body ah-scroll">
            <section v-if="editing" class="ah-card rtx__editor">
                <div class="ah-card__body rtx__editor-body">
                    <div class="rtx__editor-head">
                        <input v-model.trim="form.name" class="rtx__name-input" :placeholder="$t('Members.rule_name_ph')" maxlength="120" />
                        <span class="ah-mono rtx__project">{{ (project.ProjectName || '').toUpperCase() }}</span>
                        <label v-if="form._id" class="rtx__toggle" :class="{ 'is-on': form.enabled }">
                            <input type="checkbox" v-model="form.enabled" />
                            <span class="rtx__toggle-track"><span class="rtx__toggle-knob"></span></span>
                        </label>
                    </div>

                    <input v-model.trim="form.taskName" class="ah-input" :placeholder="$t('Members.rule_task_ph')" maxlength="200" />

                    <div class="rtx__rule">
                        <span class="rtx__word">{{ $t('Members.every') }}</span>
                        <input v-if="form.freq !== 'weekly'" type="number" min="1" max="52" v-model.number="form.interval" class="rtx__pill rtx__num" />
                        <select v-model="form.freq" class="rtx__pill">
                            <option value="daily">{{ $t('Members.unit_days') }}</option>
                            <option value="weekly">{{ $t('Members.unit_weeks') }}</option>
                            <option value="monthly">{{ $t('Members.unit_months') }}</option>
                        </select>

                        <template v-if="form.freq === 'weekly'">
                            <span class="rtx__word">{{ $t('Members.on_day') }}</span>
                            <select v-model.number="form.weekday" class="rtx__pill">
                                <option v-for="(day, index) in weekdayNames" :key="day" :value="index">{{ day }}</option>
                            </select>
                        </template>
                        <template v-if="form.freq === 'monthly'">
                            <span class="rtx__word">{{ $t('Members.on_day') }}</span>
                            <input type="number" min="1" max="28" v-model.number="form.monthday" class="rtx__pill rtx__num" />
                        </template>

                        <span class="rtx__word">{{ $t('Members.at_time') }}</span>
                        <select v-model.number="form.runHour" class="rtx__pill">
                            <option v-for="hour in 24" :key="hour" :value="hour - 1">{{ String(hour - 1).padStart(2, '0') }}:00</option>
                        </select>

                        <template v-if="!form._id">
                            <span class="rtx__word">{{ $t('Members.assign_to') }}</span>
                            <select v-model="form.assignee" class="rtx__pill">
                                <option value="">{{ $t('Members.assign_nobody') }}</option>
                                <option v-for="member in members" :key="member.id" :value="member.id">{{ member.name }}</option>
                            </select>
                        </template>

                        <span class="rtx__word">{{ $t('Members.ends') }}</span>
                        <input type="date" v-model="form.until" class="rtx__pill" />
                    </div>

                    <div class="rtx__section">
                        <div class="ah-label">{{ $t('Members.next_occurrences') }}</div>
                        <div v-if="preview.length" class="rtx__chips">
                            <span v-for="(date, index) in preview" :key="date.getTime()" class="rtx__chip" :class="{ 'is-first': index === 0 }">{{ dayLabel(date) }}</span>
                        </div>
                        <p v-else class="ah-small">{{ $t('Members.no_occurrences') }}</p>
                    </div>

                    <div class="rtx__section">
                        <div class="ah-label">{{ $t('Members.missed_head') }}</div>
                        <div class="rtx__choices">
                            <button
                                v-for="option in missedOptions"
                                :key="option.value"
                                type="button"
                                class="rtx__choice"
                                :class="{ 'is-on': form.missedPolicy === option.value }"
                                @click="form.missedPolicy = option.value"
                            >{{ $t(option.label) }}</button>
                        </div>
                    </div>

                    <p class="ah-small">{{ $t('Members.copy_template') }}</p>
                    <p v-if="formError" class="ah-field__error">{{ formError }}</p>

                    <div class="rtx__actions">
                        <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="saving" @click="save()">
                            {{ form._id ? $t('Members.save_rule') : $t('Members.create_rule') }}
                        </button>
                        <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="editing = false">{{ $t('Members.cancel') }}</button>
                        <button v-if="form._id" type="button" class="ah-btn ah-btn--ghost ah-btn--sm" @click="runNow(form)">{{ $t('Members.run_now') }}</button>
                        <button v-if="form._id" type="button" class="ah-btn ah-btn--ghost ah-btn--sm rtx__danger" @click="remove(form)">{{ $t('Members.delete_rule') }}</button>
                    </div>
                </div>
            </section>

            <p v-if="loading" class="ah-small">{{ $t('Members.loading') }}</p>
            <div v-else-if="!defs.length && !editing" class="ah-empty">{{ $t('Members.no_rules') }}</div>

            <div class="rtx__list">
                <article v-for="def in listedDefs" :key="def._id" class="ah-card rtx__row" :class="{ 'is-paused': !def.enabled }">
                    <label class="rtx__toggle" :class="{ 'is-on': def.enabled }" @click.stop>
                        <input type="checkbox" :checked="def.enabled" @change="toggle(def)" />
                        <span class="rtx__toggle-track"><span class="rtx__toggle-knob"></span></span>
                    </label>
                    <button type="button" class="rtx__row-main" @click="edit(def)">
                        <span class="rtx__row-name">{{ def.name }}</span>
                        <span class="rtx__row-sub">{{ scheduleText(def) }}</span>
                    </button>
                    <span v-if="def.enabled && def.nextRunAt" class="ah-mono rtx__next">{{ $t('Members.next_run', { when: dayLabel(new Date(def.nextRunAt)) }) }}</span>
                    <span v-else class="ah-mono rtx__next">{{ $t('Members.rule_paused') }}</span>
                </article>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, inject, onMounted, reactive, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { apiRequest } from "@/services";
import { useGetterFunctions } from "@/composable";
import { nextOccurrences, missedPolicyOf, missedPolicyFields } from "@/views/Projects/composables/recurrence";

defineOptions({ name: "RecurringTasksManager" });

const props = defineProps({
    projectData: { type: Object, default: () => ({}) },
    sprints: { type: Array, default: () => [] }
});

const { t } = useI18n();
const $toast = useToast();
const route = useRoute();
const { getters } = useStore();
const { getUser } = useGetterFunctions();
const userId = inject("$userId");
const selectedProject = inject("selectedProject", ref({}));

const PREVIEW_COUNT = 4;
const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const missedOptions = [
    { value: "skip", label: "Members.missed_skip" },
    { value: "create", label: "Members.missed_create" },
    { value: "roll", label: "Members.missed_roll" }
];

const defs = ref([]);
const loading = ref(false);
const saving = ref(false);
const editing = ref(false);
const formError = ref("");
const form = reactive(emptyForm());

const allProjects = computed(() => getters["projectData/allProjects"]?.data || []);
const project = computed(() => {
    if (selectedProject.value?._id) return selectedProject.value;
    if (props.projectData?._id) return props.projectData;
    return allProjects.value.find((p) => String(p._id) === String(route.params.id)) || {};
});

const members = computed(() => (project.value?.AssigneeUserId || [])
    .map((id) => ({ id, name: getUser(id)?.Employee_Name || "" }))
    .filter((m) => m.name));

const listedDefs = computed(() => defs.value.filter((d) => String(d._id) !== String(form._id)));

const preview = computed(() => nextOccurrences({
    freq: form.freq,
    interval: form.interval,
    byweekday: form.freq === "weekly" ? [form.weekday] : [],
    monthday: form.monthday,
    runHour: form.runHour,
    until: form.until || null
}, new Date(), PREVIEW_COUNT));

function emptyForm() {
    return {
        _id: "",
        name: "",
        taskName: "",
        freq: "weekly",
        interval: 1,
        weekday: 5,
        monthday: 1,
        runHour: 9,
        until: "",
        assignee: "",
        enabled: true,
        missedPolicy: "skip"
    };
}

function dayLabel(date) {
    if (!date || Number.isNaN(date.getTime())) return "—";
    return date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

function scheduleText(def) {
    const at = `${String(def.runHour ?? 9).padStart(2, "0")}:00`;
    if (def.freq === "weekly") {
        const days = (def.byweekday || []).map((i) => weekdayNames[i]).join(", ");
        return `${t("Members.every")} ${days || weekdayNames[0]} ${at}`;
    }
    if (def.freq === "monthly") {
        return `${t("Members.every")} ${def.interval || 1} ${t("Members.unit_months")} · ${t("Members.day_of_month", { day: def.monthday || 1 })} ${at}`;
    }
    return `${t("Members.every")} ${def.interval || 1} ${t("Members.unit_days")} ${at}`;
}

function startNew() {
    Object.assign(form, emptyForm());
    formError.value = "";
    editing.value = true;
}

function edit(def) {
    Object.assign(form, {
        _id: def._id,
        name: def.name || "",
        taskName: def.templateSnapshot?.TaskName || "",
        freq: def.freq || "daily",
        interval: def.interval || 1,
        weekday: (def.byweekday || [])[0] ?? 1,
        monthday: def.monthday || 1,
        runHour: def.runHour ?? 9,
        until: def.until ? String(def.until).slice(0, 10) : "",
        assignee: (def.templateSnapshot?.AssigneeUserId || [])[0] || "",
        enabled: def.enabled !== false,
        missedPolicy: missedPolicyOf(def)
    });
    formError.value = "";
    editing.value = true;
}

function buildUserData() {
    const me = getUser(userId.value) || {};
    return {
        id: userId.value,
        Employee_Name: me.Employee_Name || "",
        companyOwnerId: getters["settings/companyOwnerDetail"]?.userId || ""
    };
}

async function load() {
    const p = project.value;
    if (!p?._id) return;
    loading.value = true;
    try {
        const res = await apiRequest("get", `/api/v1/recurring-tasks/project/${p._id}`);
        defs.value = res.data?.status && Array.isArray(res.data.data) ? res.data.data : [];
    } catch (error) {
        console.error("ERROR in load recurring rules: ", error);
        defs.value = [];
    } finally {
        loading.value = false;
    }
}

async function save() {
    if (saving.value) return;
    if (!form.name || !form.taskName) {
        formError.value = t("Members.rule_needs_name");
        return;
    }
    formError.value = "";
    saving.value = true;
    const schedule = {
        freq: form.freq,
        interval: Math.max(1, Number(form.interval) || 1),
        byweekday: form.freq === "weekly" ? [Number(form.weekday)] : [],
        monthday: form.freq === "monthly" ? Number(form.monthday) : undefined,
        runHour: Number(form.runHour),
        until: form.until || null,
        ...missedPolicyFields(form.missedPolicy)
    };
    try {
        if (form._id) {
            const res = await apiRequest("patch", `/api/v1/recurring-tasks/${form._id}`, { name: form.name, enabled: form.enabled, ...schedule });
            if (!res.data?.status) throw new Error(res.data?.statusText || "");
        } else {
            const p = project.value;
            const sprint = props.sprints?.[0] || {};
            const res = await apiRequest("post", "/api/v1/recurring-tasks", {
                name: form.name,
                taskName: form.taskName,
                ...schedule,
                assignees: form.assignee ? [form.assignee] : [],
                projectData: { _id: p._id, CompanyId: p.CompanyId, ProjectCode: p.ProjectCode, ProjectName: p.ProjectName },
                sprintArray: sprint,
                sprintId: sprint.id || sprint._id || "",
                userData: buildUserData()
            });
            if (!res.data?.status) throw new Error(res.data?.statusText || "");
        }
        editing.value = false;
        await load();
    } catch (error) {
        formError.value = error?.message || t("Toast.something_went_wrong");
    } finally {
        saving.value = false;
    }
}

async function toggle(def) {
    try {
        await apiRequest("patch", `/api/v1/recurring-tasks/${def._id}`, { enabled: !def.enabled });
        await load();
    } catch (error) {
        $toast.error(t("Toast.something_went_wrong"), { position: "top-right" });
    }
}

async function remove(def) {
    try {
        await apiRequest("delete", `/api/v1/recurring-tasks/${def._id}`);
        editing.value = false;
        await load();
    } catch (error) {
        $toast.error(t("Toast.something_went_wrong"), { position: "top-right" });
    }
}

async function runNow(def) {
    try {
        const res = await apiRequest("post", `/api/v1/recurring-tasks/${def._id}/run-now`, {});
        $toast.success(res.data?.statusText || t("Toast.task_created_successfully"), { position: "top-right" });
        await load();
    } catch (error) {
        $toast.error(t("Toast.something_went_wrong"), { position: "top-right" });
    }
}

watch(() => project.value?._id, (id) => { if (id) load(); });
onMounted(load);
</script>

<style scoped>
.rtx { display: flex; flex-direction: column; height: 100%; background: var(--canvas); color: var(--ink); font: var(--text-body); }
.rtx__bar { gap: 10px; }
.rtx__count { color: var(--ink-3); }
.rtx__body { flex: 1; min-height: 0; overflow: auto; padding: 20px 24px; display: flex; flex-direction: column; gap: 12px; }

.rtx__editor { border: 1.5px solid var(--brand); }
.rtx__editor-body { display: flex; flex-direction: column; gap: 10px; }
.rtx__editor-head { display: flex; align-items: center; gap: 10px; }
.rtx__name-input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: transparent;
    color: var(--ink);
    font: 600 13px/1.3 var(--font-ui);
    outline: none;
}
.rtx__name-input::placeholder { color: var(--ink-3); }
.rtx__project { color: var(--ink-3); white-space: nowrap; }

.rtx__toggle { display: inline-flex; align-items: center; cursor: pointer; flex: none; }
.rtx__toggle input { position: absolute; opacity: 0; width: 0; height: 0; }
.rtx__toggle-track {
    width: 30px;
    height: 18px;
    border-radius: 9px;
    background: rgba(0, 0, 0, .15);
    position: relative;
    transition: background var(--t-state) var(--ease);
}
.rtx__toggle-knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #fff;
    transition: left var(--t-state) var(--ease);
}
.rtx__toggle.is-on .rtx__toggle-track { background: var(--brand); }
.rtx__toggle.is-on .rtx__toggle-knob { left: 14px; }

.rtx__rule { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.rtx__word { color: var(--ink-2); }
.rtx__pill {
    height: 26px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: var(--r-chip);
    background: var(--surface);
    color: var(--ink);
    font: 400 12.5px/1 var(--font-ui);
}
.rtx__pill:focus { outline: none; border-color: var(--brand); box-shadow: var(--focus); }
.rtx__num { width: 56px; }

.rtx__section { display: flex; flex-direction: column; gap: 5px; padding-top: 6px; border-top: 1px solid var(--hairline); }
.rtx__chips { display: flex; gap: 8px; flex-wrap: wrap; }
.rtx__chip {
    padding: 4px 9px;
    border-radius: var(--r-chip);
    background: rgba(0, 0, 0, .05);
    font: 400 12px/1.2 var(--font-ui);
    color: var(--ink-label);
}
:root[data-theme="dark"] .rtx__chip { background: rgba(255, 255, 255, .08); }
.rtx__chip.is-first { background: var(--brand-tint); color: var(--brand); font-weight: 600; }

.rtx__choices { display: flex; gap: 6px; flex-wrap: wrap; }
.rtx__choice {
    padding: 5px 10px;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: var(--surface);
    color: var(--ink-label);
    font: 400 12px/1.2 var(--font-ui);
    cursor: pointer;
    transition: border-color var(--t-state) var(--ease), color var(--t-state) var(--ease);
}
.rtx__choice.is-on { border: 1.5px solid var(--brand); color: var(--brand); font-weight: 600; }

.rtx__actions { display: flex; gap: 8px; flex-wrap: wrap; }
.rtx__danger { color: var(--danger-ink); }

.rtx__list { display: flex; flex-direction: column; gap: 6px; }
.rtx__row { display: flex; align-items: center; gap: 10px; padding: 11px 13px; }
.rtx__row.is-paused { opacity: .6; }
.rtx__row-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    border: 0;
    background: transparent;
    padding: 0;
    text-align: left;
    cursor: pointer;
}
.rtx__row-name { font-weight: 600; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rtx__row-sub { font-size: 11.5px; color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rtx__next { color: var(--ink-3); white-space: nowrap; }

@media (max-width: 767px) {
    .rtx__body { padding: 14px 12px; }
}
</style>
