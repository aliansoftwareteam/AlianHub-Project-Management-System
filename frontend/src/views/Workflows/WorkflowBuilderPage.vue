<template>
    <div class="ah-page wb">
        <div class="ah-toolbar">
            <div class="ah-toolbar__title">{{ $t('WorkflowBuilder.title') }}</div>
            <span v-if="!engineOff" class="parity-count">{{ $t('WorkflowBuilder.n_on', { n: enabledCount }) }}</span>
            <div class="ah-toolbar__spacer"></div>
            <button v-if="!building && canManage && !engineOff" type="button" class="ah-btn ah-btn--primary ah-btn--sm" @click="startNew">
                <ShellIcon name="plus" :size="14" />{{ $t('WorkflowBuilder.new') }}
            </button>
            <button v-else-if="building" type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="cancel">{{ $t('WorkflowBuilder.cancel') }}</button>
        </div>

        <div class="wb__body ah-scroll">
            <div v-if="engineOff" class="ah-empty wb__off" data-test="engine-off">
                <h2 class="ah-h2">{{ $t('WorkflowBuilder.engine_off_title') }}</h2>
                <p>{{ engineOff }}</p>
            </div>

            <p v-else-if="!canManage" class="ah-small wb__readonly">{{ $t('WorkflowBuilder.manage_owner_admin') }}</p>

            <template v-else>
                <p v-if="loadError" class="ah-field__error">{{ loadError }}</p>

                <template v-if="building">
                    <div class="wb__compiled">
                        <div class="wb__slots">
                            <span class="wb__kw">{{ $t('WorkflowBuilder.called') }}</span>
                            <input v-model="draft.name" class="wb__slot wb__slot--text" :placeholder="$t('WorkflowBuilder.name_placeholder')" />
                            <span class="wb__kw">{{ $t('WorkflowBuilder.within') }}</span>
                            <input v-model.number="draft.deadlineMinutes" type="number" min="0" class="wb__slot wb__slot--num" :placeholder="$t('WorkflowBuilder.unbounded')" />
                            <span class="wb__kw">{{ $t('WorkflowBuilder.minutes') }}</span>
                            <span class="wb__kw">{{ $t('WorkflowBuilder.spending_at_most') }}</span>
                            <input v-model.number="draft.budgetUsd" type="number" min="0" step="0.5" class="wb__slot wb__slot--num" :placeholder="$t('WorkflowBuilder.unbounded')" />
                            <span class="wb__kw">{{ $t('WorkflowBuilder.usd') }}</span>
                        </div>

                        <div v-for="(step, i) in draft.steps" :key="step.id" class="wb__step" :data-step="step.id">
                            <div class="wb__slots">
                                <span class="wb__kw">{{ i === 0 ? $t('WorkflowBuilder.first') : $t('WorkflowBuilder.then') }}</span>
                                <select v-model="step.type" class="wb__slot" data-test="step-type" @change="resetConfig(step)">
                                    <option v-for="type in manifest.stepTypes" :key="type.key" :value="type.key">{{ type.label }}</option>
                                </select>

                                <template v-for="(spec, field) in configOf(step.type)" :key="field">
                                    <span class="wb__kw wb__kw--field">{{ spec.label }}</span>

                                    <select v-if="spec.options" v-model="step.config[field]" class="wb__slot">
                                        <option value="">{{ $t('WorkflowBuilder.unset') }}</option>
                                        <option v-for="option in spec.options" :key="option" :value="option">{{ option }}</option>
                                    </select>

                                    <select v-else-if="spec.type === 'agent'" v-model="step.config[field]" class="wb__slot">
                                        <option value="">{{ $t('WorkflowBuilder.unset') }}</option>
                                        <option v-for="agent in agents" :key="agent._id" :value="String(agent._id)">{{ agent.name }}</option>
                                    </select>

                                    <select v-else-if="spec.type === 'user'" v-model="step.config[field]" class="wb__slot">
                                        <option value="">{{ $t('WorkflowBuilder.unset') }}</option>
                                        <option v-for="user in users" :key="user._id" :value="String(user._id)">{{ user.Employee_Name }}</option>
                                    </select>

                                    <select v-else-if="spec.type === 'action'" v-model="step.config[field]" class="wb__slot">
                                        <option value="">{{ $t('WorkflowBuilder.unset') }}</option>
                                        <option v-for="action in actions" :key="action.key" :value="action.key">{{ action.label }}</option>
                                    </select>

                                    <select v-else-if="spec.type === 'step_type'" v-model="step.config[field]" class="wb__slot">
                                        <option value="">{{ $t('WorkflowBuilder.unset') }}</option>
                                        <option v-for="type in manifest.stepTypes" :key="type.key" :value="type.key">{{ type.label }}</option>
                                    </select>

                                    <select v-else-if="spec.type === 'step'" v-model="step.config[field]" class="wb__slot">
                                        <option value="">{{ $t('WorkflowBuilder.unset') }}</option>
                                        <option v-for="other in otherSteps(step)" :key="other.id" :value="other.id">{{ other.id }}</option>
                                    </select>

                                    <select v-else-if="spec.type === 'steps'" v-model="step.config[field]" class="wb__slot wb__slot--multi" multiple>
                                        <option v-for="other in otherSteps(step)" :key="other.id" :value="other.id">{{ other.id }}</option>
                                    </select>

                                    <template v-else-if="spec.type === 'duration'">
                                        <input
                                            class="wb__slot wb__slot--num"
                                            type="number"
                                            min="0"
                                            :value="toMinutes(step.config[field])"
                                            :placeholder="$t('WorkflowBuilder.unbounded')"
                                            @input="step.config[field] = fromMinutes($event.target.value)"
                                        />
                                        <span class="wb__kw">{{ $t('WorkflowBuilder.minutes') }}</span>
                                    </template>

                                    <input v-else-if="spec.type === 'number'" v-model.number="step.config[field]" type="number" class="wb__slot wb__slot--num" />

                                    <input v-else-if="spec.type === 'datetime'" v-model="step.config[field]" type="datetime-local" class="wb__slot" />

                                    <textarea
                                        v-else-if="isStructured(spec.type)"
                                        class="wb__slot wb__slot--json"
                                        :value="rawOf(step, field)"
                                        :placeholder="spec.type === 'list' ? '[]' : '{}'"
                                        @input="onStructured(step, field, $event.target.value)"
                                    ></textarea>

                                    <input v-else v-model="step.config[field]" class="wb__slot wb__slot--text" :placeholder="spec.label" />
                                </template>

                                <button type="button" class="wb__x" :title="$t('WorkflowBuilder.remove')" @click="removeStep(i)">×</button>
                            </div>

                            <div class="wb__slots wb__slots--after">
                                <span class="wb__kw">{{ $t('WorkflowBuilder.after') }}</span>
                                <select v-model="step.dependsOn" class="wb__slot wb__slot--multi" data-test="depends-on" multiple>
                                    <option v-for="other in otherSteps(step)" :key="other.id" :value="other.id">{{ other.id }}</option>
                                </select>
                                <span class="wb__kw wb__kw--id ah-mono">{{ step.id }}</span>
                            </div>
                        </div>

                        <button type="button" class="wb__add" @click="addStep">{{ $t('WorkflowBuilder.add_step') }}</button>

                        <ul v-if="errors.length" class="wb__errors" data-test="errors">
                            <li v-for="(error, i) in errors" :key="i">{{ error }}</li>
                        </ul>

                        <div class="wb__try">
                            <span class="wb__kw">{{ $t('WorkflowBuilder.try_against') }}</span>
                            <select v-model="tryProjectId" class="wb__slot" data-test="try-project" @change="loadTasks">
                                <option value="">{{ $t('WorkflowBuilder.no_input') }}</option>
                                <option v-for="project in projects" :key="project._id" :value="String(project._id)">{{ project.ProjectName || '—' }}</option>
                            </select>
                            <select v-if="tryProjectId" v-model="tryTaskId" class="wb__slot" data-test="try-task">
                                <option value="">{{ $t('WorkflowBuilder.whole_project') }}</option>
                                <option v-for="task in tasks" :key="task._id" :value="String(task._id)">{{ task.TaskName }}</option>
                            </select>
                            <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="trying" data-test="dry-run" @click="dryRun">
                                {{ trying ? $t('WorkflowBuilder.dry_running') : $t('WorkflowBuilder.dry_run') }}
                            </button>
                        </div>

                        <div v-if="plan" class="wb__plan" data-test="plan">
                            <div class="ah-label">{{ $t('WorkflowBuilder.plan_title') }}</div>
                            <p class="ah-small">{{ $t('WorkflowBuilder.plan_nothing_written') }}</p>
                            <p v-if="plan.input && plan.input.kind !== 'none'" class="ah-small">
                                {{ plan.input.found ? $t('WorkflowBuilder.plan_input', { name: plan.input.name }) : $t('WorkflowBuilder.plan_input_missing') }}
                            </p>
                            <p v-if="plan.summary" class="ah-small wb__plan-sum">
                                {{ $t('WorkflowBuilder.plan_summary', {
                                    steps: plan.summary.stepCount,
                                    waves: plan.summary.waveCount,
                                    writes: plan.summary.writeCount,
                                    asks: plan.summary.approvalCount,
                                }) }}
                            </p>
                            <ol class="wb__plan-steps">
                                <li v-for="step in plan.steps" :key="step.stepId" class="wb__plan-step" :class="{ 'is-refused': step.refused }">
                                    <span class="ah-mono">{{ step.stepId }}</span>
                                    <span>{{ step.label }}</span>
                                    <span class="wb__plan-wave">{{ step.wave ? $t('WorkflowBuilder.plan_wave', { n: step.wave }) : $t('WorkflowBuilder.plan_unreachable') }}</span>
                                    <span class="wb__plan-effect">{{ $t(`WorkflowBuilder.effect_${step.effect}`) }}</span>
                                    <span v-if="step.refused" class="wb__plan-refused">{{ step.refused.reason }}</span>
                                </li>
                            </ol>
                        </div>

                        <div class="wb__save">
                            <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="saving" data-test="save" @click="save">
                                {{ saving ? $t('WorkflowBuilder.saving') : $t('WorkflowBuilder.save') }}
                            </button>
                            <span class="ah-small">{{ $t('WorkflowBuilder.saved_off_note') }}</span>
                        </div>
                    </div>
                </template>

                <template v-else>
                    <p v-if="loading" class="ah-empty">{{ $t('WorkflowBuilder.loading') }}</p>
                    <div v-else-if="!workflows.length" class="ah-empty wb__empty">
                        <h2 class="ah-h2">{{ $t('WorkflowBuilder.empty_title') }}</h2>
                        <p>{{ $t('WorkflowBuilder.empty_sub') }}</p>
                        <button type="button" class="ah-btn ah-btn--primary" @click="startNew">{{ $t('WorkflowBuilder.new') }}</button>
                    </div>

                    <div v-for="workflow in workflows" :key="workflow._id" class="wb__row" :class="{ 'wb__row--off': !workflow.enabled }">
                        <button
                            type="button"
                            class="wb__toggle"
                            :class="{ 'is-on': workflow.enabled }"
                            :aria-label="workflow.enabled ? $t('WorkflowBuilder.turn_off') : $t('WorkflowBuilder.turn_on')"
                            @click="toggle(workflow)"
                        ><span class="wb__knob"></span></button>
                        <span class="wb__row-name">{{ workflow.name }}</span>
                        <span class="wb__row-count ah-mono">{{ $t('WorkflowBuilder.n_steps', { n: (workflow.steps || []).length }) }}</span>
                        <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" @click="edit(workflow)">{{ $t('WorkflowBuilder.edit') }}</button>
                        <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm wb__delete" @click="remove(workflow)">{{ $t('WorkflowBuilder.delete') }}</button>
                    </div>
                </template>
            </template>
        </div>
    </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { useStore } from 'vuex';
import { useI18n } from 'vue-i18n';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { isOwnerOrAdmin } from '@/utils/roles';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';

// The workflow builder (task 028, interface row C Orchestration). It is the
// automation sentence builder one level up: the slots come from the step-type
// manifest the server serves, so a step type the engine does not know cannot be
// composed here and a rule the engine enforces cannot be missing from the form.
//
// Two things this screen deliberately does not do. It never saves a workflow
// turned on — enabling is its own act on the list, the way an automation rule
// already works. And its dry run writes nothing: the plan comes from the same
// validation and the same ready-set scheduling a start would reach, against a
// real task or project, without that task or project being touched.
defineOptions({ name: 'WorkflowBuilderPage' });

const STRUCTURED = ['object', 'list', 'condition'];

const { getters } = useStore();
const { t } = useI18n();

const manifest = reactive({ stepTypes: [], bounds: {} });
const workflows = ref([]);
const projects = ref([]);
const tasks = ref([]);
const agents = ref([]);
const actions = ref([]);
const loading = ref(true);
const loadError = ref('');
const engineOff = ref('');
const saving = ref(false);
const trying = ref(false);
const building = ref(false);
const editingId = ref(null);
const errors = ref([]);
const plan = ref(null);
const tryProjectId = ref('');
const tryTaskId = ref('');

const draft = reactive({ name: '', deadlineMinutes: null, budgetUsd: null, steps: [] });

const canManage = computed(() => isOwnerOrAdmin(Number(getters['settings/companyUserDetail']?.roleType)));
const users = computed(() => getters['users/users'] || []);
const enabledCount = computed(() => workflows.value.filter((workflow) => workflow.enabled).length);

const contractOf = (type) => manifest.stepTypes.find((entry) => entry.key === type) || null;
const configOf = (type) => contractOf(type)?.config || {};
const isStructured = (type) => STRUCTURED.includes(type);
const otherSteps = (step) => draft.steps.filter((other) => other.id !== step.id);

let stepSeq = 0;
const nextStepId = () => { stepSeq += 1; return `s${stepSeq}`; };

const toMinutes = (ms) => (Number(ms) > 0 ? Math.round(Number(ms) / 60000) : '');
const fromMinutes = (minutes) => (Number(minutes) > 0 ? Math.round(Number(minutes) * 60000) : undefined);

const rawOf = (step, field) => {
    if (step.raw[field] !== undefined) return step.raw[field];
    const value = step.config[field];
    return value === undefined || value === null || value === '' ? '' : JSON.stringify(value);
};

/* A half-typed object is kept as text so the field does not fight the typist;
 * it only becomes configuration once it parses. */
const onStructured = (step, field, text) => {
    step.raw[field] = text;
    if (!text.trim()) { delete step.config[field]; return; }
    try {
        step.config[field] = JSON.parse(text);
    } catch (error) {
        step.config[field] = undefined;
    }
};

const blankConfig = (type) => {
    const config = {};
    Object.entries(configOf(type)).forEach(([field, spec]) => {
        if (spec.type === 'steps') config[field] = [];
        else if (spec.options) config[field] = '';
        else if (!STRUCTURED.includes(spec.type)) config[field] = '';
    });
    return config;
};

const resetConfig = (step) => {
    step.config = blankConfig(step.type);
    step.raw = {};
};

const addStep = () => {
    const type = manifest.stepTypes[0];
    if (!type) return;
    draft.steps.push({ id: nextStepId(), type: type.key, dependsOn: [], config: blankConfig(type.key), raw: {} });
};

const removeStep = (index) => {
    const [gone] = draft.steps.splice(index, 1);
    draft.steps.forEach((step) => { step.dependsOn = step.dependsOn.filter((id) => id !== gone.id); });
};

/* An empty slot is an absent field, not an empty string: "required" has to mean
 * the same thing on the form as it does in the contract. */
const cleanConfig = (config) => Object.fromEntries(
    Object.entries(config).filter(([, value]) => value !== '' && value !== undefined && value !== null && !(Array.isArray(value) && !value.length)),
);

const definitionBody = () => ({
    name: draft.name,
    deadlineMs: fromMinutes(draft.deadlineMinutes) || null,
    budgetUsd: Number(draft.budgetUsd) > 0 ? Number(draft.budgetUsd) : null,
    steps: draft.steps.map((step) => ({
        id: step.id,
        type: step.type,
        dependsOn: step.dependsOn,
        config: cleanConfig(step.config),
    })),
});

const errorsFrom = (error, fallback) => {
    const body = error?.response?.data;
    if (body?.errors?.length) return body.errors;
    if (body?.statusText) return [body.statusText];
    return [error?.message || fallback];
};

const startNew = () => {
    editingId.value = null;
    errors.value = [];
    plan.value = null;
    draft.name = '';
    draft.deadlineMinutes = null;
    draft.budgetUsd = null;
    draft.steps = [];
    stepSeq = 0;
    addStep();
    building.value = true;
};

const edit = (workflow) => {
    editingId.value = workflow._id;
    errors.value = [];
    plan.value = null;
    draft.name = workflow.name || '';
    draft.deadlineMinutes = toMinutes(workflow.deadlineMs) || null;
    draft.budgetUsd = workflow.budgetUsd || null;
    draft.steps = (workflow.steps || []).map((step) => ({
        id: step.id,
        type: step.type,
        dependsOn: (step.dependsOn || []).map(String),
        config: { ...blankConfig(step.type), ...(step.config || {}) },
        raw: {},
    }));
    stepSeq = draft.steps.length;
    building.value = true;
};

const cancel = () => { building.value = false; errors.value = []; plan.value = null; };

const save = async () => {
    saving.value = true;
    errors.value = [];
    try {
        const body = definitionBody();
        if (editingId.value) await apiRequest('put', `${env.WORKFLOW_DEFINITIONS}/${editingId.value}`, body);
        else await apiRequest('post', env.WORKFLOW_DEFINITIONS, body);
        building.value = false;
        await loadWorkflows();
    } catch (error) {
        errors.value = errorsFrom(error, t('WorkflowBuilder.could_not_save'));
    } finally {
        saving.value = false;
    }
};

const toggle = async (workflow) => {
    try {
        await apiRequest('patch', `${env.WORKFLOW_DEFINITIONS}/${workflow._id}/enabled`, { enabled: !workflow.enabled });
    } catch (error) {
        loadError.value = errorsFrom(error, t('WorkflowBuilder.could_not_save'))[0];
    }
    await loadWorkflows();
};

const remove = async (workflow) => {
    try {
        await apiRequest('delete', `${env.WORKFLOW_DEFINITIONS}/${workflow._id}`);
    } catch (error) { /* the reload below shows the real state */ }
    await loadWorkflows();
};

const dryRun = async () => {
    trying.value = true;
    errors.value = [];
    plan.value = null;
    try {
        const body = { ...definitionBody(), projectId: tryProjectId.value || undefined, taskId: tryTaskId.value || undefined };
        const data = (await apiRequest('post', env.WORKFLOW_DRY_RUN, body))?.data?.data;
        if (!data) return;
        if (!data.valid) errors.value = data.errors || [];
        plan.value = data;
    } catch (error) {
        errors.value = errorsFrom(error, t('WorkflowBuilder.could_not_dry_run'));
    } finally {
        trying.value = false;
    }
};

const loadTasks = async () => {
    tryTaskId.value = '';
    tasks.value = [];
    if (!tryProjectId.value) return;
    try {
        const body = await apiRequest('post', `${env.TASK}/find`, {
            findQuery: { $match: { deletedStatusKey: 0, mainChat: { $ne: true }, ProjectID: tryProjectId.value } },
        });
        tasks.value = (body?.data || []).slice(0, 200);
    } catch (error) { tasks.value = []; }
};

const loadWorkflows = async () => {
    const body = (await apiRequest('get', env.WORKFLOW_DEFINITIONS))?.data;
    workflows.value = body?.data || [];
};

const loadManifest = async () => {
    const body = (await apiRequest('get', env.WORKFLOW_STEP_TYPES))?.data;
    manifest.stepTypes = body?.data?.stepTypes || [];
    manifest.bounds = body?.data?.bounds || {};
};

const loadSideLists = async () => {
    const [projectBody, agentBody, registryBody] = await Promise.all([
        apiRequest('get', env.PROJECT).catch(() => null),
        apiRequest('get', env.AGENTS).catch(() => null),
        apiRequest('get', `${env.AUTOMATIONS_V2}/registry`).catch(() => null),
    ]);
    projects.value = projectBody?.data?.data || [];
    agents.value = agentBody?.data?.data || [];
    actions.value = registryBody?.data?.data?.actions || [];
};

onMounted(async () => {
    if (!canManage.value) { loading.value = false; return; }
    try {
        await loadManifest();
        await Promise.all([loadWorkflows(), loadSideLists()]);
    } catch (error) {
        // The engine being off is not a failure of this page: the API says 503
        // with the reason, and the reason is what a person needs to read.
        if (error?.response?.status === 503) engineOff.value = error.response.data?.statusText || t('WorkflowBuilder.engine_off_sub');
        else loadError.value = error?.message || t('WorkflowBuilder.could_not_load');
    } finally {
        loading.value = false;
    }
});
</script>

<style>
@import "./style.css";
</style>
