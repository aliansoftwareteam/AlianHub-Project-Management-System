<template>
    <section v-if="settings" class="ah-card pdc" data-test="project-dispatcher" :aria-labelledby="ids.heading">
        <div class="pdc__head">
            <h5 :id="ids.heading" class="pdc__title">{{ $t('Dispatcher.title') }}</h5>
            <p class="ah-small pdc__lead">{{ $t('Dispatcher.lead') }}</p>
        </div>
        <div class="pdc__row">
            <label class="pdc__label" :for="ids.mode">{{ $t('Dispatcher.mode_label') }}</label>
            <select :id="ids.mode" v-model="mode" class="pdc__select" data-test="dispatcher-mode" :disabled="!canEdit || busy" @change="saveMode">
                <option v-for="choice in MODES" :key="choice" :value="choice">{{ $t(`Dispatcher.mode_${choice}`) }}</option>
            </select>
        </div>

        <h6 class="pdc__subtitle">{{ $t('Dispatcher.roles_title') }}</h6>
        <details v-for="group in roleGroups" :key="group.blueprint" class="pdc__group" data-test="dispatcher-role-group">
            <summary class="pdc__summary">{{ $t('Dispatcher.roles_group', { blueprint: group.label, on: group.on, total: group.roles.length }) }}</summary>
            <label v-for="role in group.roles" :key="role.key" class="pdc__check">
                <input v-model="draftRoles" type="checkbox" :value="role.key" :disabled="!canEdit || busy" :data-test="`dispatcher-role-${role.key}`">
                <span>{{ role.name }}</span>
            </label>
        </details>

        <h6 class="pdc__subtitle">{{ $t('Dispatcher.rules_title') }}</h6>
        <p v-if="!rows.length" class="pdc__hint">{{ $t('Dispatcher.rules_empty') }}</p>
        <ol class="pdc__rules">
            <li v-for="(row, index) in rows" :key="row.id" class="pdc__rule" data-test="dispatcher-rule">
                <select v-model="row.kind" class="pdc__select" :aria-label="$t('Dispatcher.rule_condition')" :disabled="!canEdit || busy" @change="row.value = ''">
                    <option v-for="kind in CONDITION_KINDS" :key="kind" :value="kind">{{ $t(`Dispatcher.condition_${kind}`) }}</option>
                </select>
                <input
                    v-if="row.kind === 'field'"
                    v-model="row.fieldId"
                    class="pdc__input"
                    :aria-label="$t('Dispatcher.rule_field')"
                    :placeholder="$t('Dispatcher.rule_field')"
                    :disabled="!canEdit || busy"
                >
                <select v-if="choicesFor(row.kind).length" v-model="row.value" class="pdc__select" :aria-label="$t('Dispatcher.rule_value')" :disabled="!canEdit || busy">
                    <option value="">{{ $t('Dispatcher.rule_value') }}</option>
                    <option v-for="choice in choicesFor(row.kind)" :key="choice.value" :value="String(choice.value)">{{ choice.label }}</option>
                </select>
                <input v-else v-model="row.value" class="pdc__input" :aria-label="$t('Dispatcher.rule_value')" :placeholder="$t('Dispatcher.rule_value')" :disabled="!canEdit || busy">
                <span class="pdc__arrow" aria-hidden="true">&rarr;</span>
                <select v-model="row.role" class="pdc__select" :aria-label="$t('Dispatcher.rule_role')" :disabled="!canEdit || busy">
                    <option value="">{{ $t('Dispatcher.pick_role') }}</option>
                    <option v-for="role in enabledRoles" :key="role.key" :value="role.key">{{ role.name }}</option>
                </select>
                <span v-if="canEdit" class="pdc__rule-actions">
                    <button type="button" class="pdc__icon" :aria-label="$t('Dispatcher.rule_up')" :disabled="busy || index === 0" @click="move(index, -1)">&uarr;</button>
                    <button type="button" class="pdc__icon" :aria-label="$t('Dispatcher.rule_down')" :disabled="busy || index === rows.length - 1" @click="move(index, 1)">&darr;</button>
                    <button type="button" class="pdc__icon" :aria-label="$t('Dispatcher.rule_remove')" data-test="dispatcher-rule-remove" :disabled="busy" @click="rows.splice(index, 1)">&times;</button>
                </span>
            </li>
        </ol>
        <div v-if="canEdit" class="pdc__row">
            <button type="button" class="pdc__btn" data-test="dispatcher-rule-add" :disabled="busy" @click="addRow">{{ $t('Dispatcher.rule_add') }}</button>
            <button type="button" class="pdc__btn pdc__btn--primary" data-test="dispatcher-save" :disabled="busy || !complete" @click="saveAll">{{ $t('Dispatcher.save') }}</button>
            <span v-if="!complete" class="pdc__hint">{{ $t('Dispatcher.rules_incomplete') }}</span>
        </div>

        <h6 class="pdc__subtitle">{{ $t('Dispatcher.needs_routing') }}</h6>
        <p v-if="!waiting.length" class="pdc__hint" data-test="dispatcher-needs-empty">{{ $t('Dispatcher.needs_routing_empty') }}</p>
        <ul class="pdc__needs">
            <li v-for="item in waiting" :key="item.decision._id" class="pdc__need" data-test="dispatcher-need">
                <span class="pdc__task">{{ item.task.TaskKey }} {{ item.task.TaskName }}</span>
                <template v-if="canEdit">
                    <select v-model="picks[item.decision._id]" class="pdc__select" :aria-label="$t('Dispatcher.pick_role')" :disabled="busy">
                        <option value="">{{ $t('Dispatcher.pick_role') }}</option>
                        <option v-for="role in savedRoles" :key="role.key" :value="role.key">{{ role.name }}</option>
                    </select>
                    <button type="button" class="pdc__btn" data-test="dispatcher-need-send" :disabled="busy || !picks[item.decision._id]" @click="route(item)">{{ $t('Dispatcher.send') }}</button>
                </template>
            </li>
        </ul>
        <p v-if="error" class="pdc__error" role="alert">{{ error }}</p>
    </section>
</template>

<script setup>
import { computed, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
    CONDITION_KINDS, actOnRouting, blueprintName, fetchDispatcher, fetchNeedsRouting, ruleToRow, rowIsComplete, rowToRule, saveDispatcher, useDispatcherChanges
} from "@/utils/dispatcher";
import { refusalText } from "@/utils/assignmentRules";

defineOptions({ name: "ProjectDispatcherCard" });

const props = defineProps({
    projectId: { type: String, required: true },
    canEdit: { type: Boolean, default: false },
    /* { type, tag, priority, status }: [{ value, label }] the project offers; a kind without choices is typed. */
    choices: { type: Object, default: () => ({}) }
});

const MODES = ["off", "suggest", "apply"];
const SETTINGS_CHANGED = "settings_changed";

const { t, te } = useI18n();
const uid = `pdc-${Math.random().toString(36).slice(2, 8)}`;
const ids = { heading: `${uid}-heading`, mode: `${uid}-mode` };

const settings = ref(null);
const allRoles = ref([]);
const mode = ref("off");
const draftRoles = ref([]);
const rows = ref([]);
const waiting = ref([]);
const picks = reactive({});
const busy = ref(false);
const error = ref("");
let nextRowId = 0;

const withId = (row) => ({ ...row, id: (nextRowId += 1) });
const roleGroups = computed(() => {
    const groups = new Map();
    allRoles.value.forEach((role) => groups.set(role.blueprint, [...(groups.get(role.blueprint) || []), role]));
    return [...groups].map(([blueprint, roles]) => ({ blueprint, label: blueprintName(t, te, blueprint), roles, on: roles.filter((role) => draftRoles.value.includes(role.key)).length }));
});
const enabledRoles = computed(() => allRoles.value.filter((role) => draftRoles.value.includes(role.key)));
const savedRoles = computed(() => allRoles.value.filter((role) => (settings.value?.roles || []).includes(role.key)));
const complete = computed(() => rows.value.every(rowIsComplete));
const choicesFor = (kind) => (Array.isArray(props.choices?.[kind]) ? props.choices[kind] : []);

function take(saved) {
    settings.value = saved;
    mode.value = saved?.mode || "off";
    draftRoles.value = [...(saved?.roles || [])];
    rows.value = (saved?.rules || []).map((rule) => withId(ruleToRow(rule)));
}

async function loadNeeds(pid) {
    try {
        const data = await fetchNeedsRouting(pid);
        if (pid === props.projectId) waiting.value = data?.items || [];
    } catch (e) {
        waiting.value = [];
    }
}

async function load(pid) {
    error.value = "";
    try {
        const data = await fetchDispatcher(pid);
        if (pid !== props.projectId) return;
        allRoles.value = data?.roles || [];
        take(data?.on ? data.settings : null);
        if (data?.on) await loadNeeds(pid);
    } catch (e) {
        settings.value = null;
    }
}

watch(() => props.projectId, (pid) => { if (pid) load(pid); }, { immediate: true });
useDispatcherChanges(() => { if (props.projectId && !busy.value) load(props.projectId); });

function addRow() {
    rows.value.push(withId({ kind: "type", fieldId: "", value: "", role: "" }));
}

function move(index, by) {
    const [row] = rows.value.splice(index, 1);
    rows.value.splice(index + by, 0, row);
}

async function save(body) {
    busy.value = true;
    error.value = "";
    try {
        take(await saveDispatcher(props.projectId, body));
    } catch (e) {
        if (e?.response?.data?.reason === SETTINGS_CHANGED) {
            await load(props.projectId);
            error.value = t("Dispatcher.settings_changed");
        } else {
            error.value = refusalText(e, t("Dispatcher.failed"));
        }
    } finally {
        busy.value = false;
    }
}

const savedBody = () => {
    const { roles, rules, threshold, modelGuess, revision } = settings.value;
    return { roles, rules, threshold, modelGuess, revision };
};

async function saveMode() {
    if (!settings.value || busy.value) return;
    await save({ ...savedBody(), mode: mode.value });
    if (error.value) mode.value = settings.value?.mode || "off";
}

async function saveAll() {
    if (!settings.value || busy.value || !complete.value) return;
    await save({ ...savedBody(), mode: settings.value.mode, roles: draftRoles.value, rules: rows.value.map(rowToRule) });
}

async function route(item) {
    const role = picks[item.decision._id];
    if (!role || busy.value) return;
    busy.value = true;
    error.value = "";
    try {
        await actOnRouting(item.task._id, item.decision._id, "route", { role });
        waiting.value = waiting.value.filter((entry) => entry.decision._id !== item.decision._id);
    } catch (e) {
        error.value = refusalText(e, t("Dispatcher.failed"));
    } finally {
        busy.value = false;
    }
}
</script>

<style scoped>
.pdc { display: flex; flex-direction: column; margin: 20px 0 0; padding: 14px 16px; max-width: 720px; box-sizing: border-box; color: var(--ink); font-family: var(--font-ui); }
.pdc__head { display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; }
.pdc__title { margin: 0; font: 600 14px/1.3 var(--font-ui); color: var(--ink); }
.pdc__lead { margin: 0; }
.pdc__subtitle { margin: 12px 0 6px; font-weight: 600; font-size: var(--fs-md, 12.5px); }
.pdc__hint { margin: 0 0 8px; color: var(--ink-2); font-size: var(--fs-sm, 12px); }
.pdc__row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 6px; }
.pdc__label { font-size: var(--fs-md, 12.5px); }
.pdc__group { margin-bottom: 4px; }
.pdc__summary { cursor: pointer; font-size: var(--fs-md, 12.5px); }
.pdc__check { display: flex; align-items: center; gap: 6px; padding: 2px 0 2px 16px; font-size: var(--fs-sm, 12px); }
.pdc__rules, .pdc__needs { margin: 0 0 8px; padding: 0; list-style: none; }
.pdc__rule, .pdc__need { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 6px 0; border-bottom: 1px solid var(--border); }
.pdc__task { flex: 1 1 160px; min-width: 0; overflow-wrap: anywhere; font-size: var(--fs-md, 12.5px); }
.pdc__arrow { color: var(--ink-2); }
.pdc__rule-actions { display: inline-flex; gap: 4px; }
.pdc__select, .pdc__input {
    height: 30px;
    max-width: 100%;
    min-width: 0;
    padding: 0 6px;
    border-radius: var(--r-input, 8px);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--ink);
    font: 400 var(--fs-sm, 12px)/1 var(--font-ui);
    box-sizing: border-box;
}
.pdc__btn, .pdc__icon {
    height: 30px;
    padding: 0 10px;
    border-radius: var(--r-input, 8px);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--ink);
    font: 600 var(--fs-sm, 12px)/1 var(--font-ui);
    cursor: pointer;
}
.pdc__icon { padding: 0 8px; }
.pdc__btn--primary { background: var(--brand); border-color: var(--brand); color: var(--on-brand); }
.pdc__btn:disabled, .pdc__icon:disabled { opacity: .55; cursor: not-allowed; }
.pdc__select:focus-visible, .pdc__input:focus-visible, .pdc__btn:focus-visible, .pdc__icon:focus-visible { outline: none; box-shadow: var(--focus); }
.pdc__error { color: var(--danger); font-size: var(--fs-sm, 12px); }
</style>
