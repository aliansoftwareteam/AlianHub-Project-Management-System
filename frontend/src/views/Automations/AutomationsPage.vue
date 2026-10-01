<template>
    <div class="ah-page au">
        <div class="ah-toolbar">
            <div class="ah-toolbar__title">{{ $t('Automations.title') }}</div>
            <span class="parity-count">{{ $t('Parity.n_active', { n: activeCount }) }}</span>
            <div class="ah-toolbar__spacer"></div>
            <button v-if="!building && canManage" type="button" class="ah-btn ah-btn--secondary ah-btn--sm" data-test="open-templates" :aria-pressed="showGallery" @click="showGallery = !showGallery">
                {{ $t('AutomationTemplates.open') }}
            </button>
            <button v-if="!building && canManage" type="button" class="ah-btn ah-btn--primary ah-btn--sm" @click="startNew">
                <ShellIcon name="plus" :size="14" />{{ $t('Automations.new') }}
            </button>
            <button v-else-if="building" type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="cancel">{{ $t('Automations.cancel') }}</button>
        </div>

        <div class="au__body ah-scroll">
            <p v-if="loadError" class="ah-field__error">{{ loadError }}</p>
            <p v-if="!canManage" class="ah-small au__readonly">{{ $t('Automations.manage_owner_admin') }}</p>

            <template v-if="building && canManage">
                <div class="au__sentence">
                    <ShellIcon name="automations" :size="14" class="au__lead" />
                    <input
                        ref="sentenceInput"
                        v-model="sentence"
                        class="au__sentence-input"
                        type="text"
                        :placeholder="$t('Parity.sentence_placeholder')"
                        @keyup.enter="compileSentence"
                        @blur="compileSentence"
                    />
                    <span class="ah-kbd">↵</span>
                </div>

                <p v-if="grammar.shape" class="ah-small au__grammar">{{ $t('Parity.grammar_shape', { shape: grammar.shape }) }}</p>

                <div v-for="(item, i) in ambiguities" :key="i" class="au__ambiguous">
                    <div class="ah-label">{{ $t('Parity.ambiguous') }}</div>
                    <p class="au__ambiguous-q">{{ item.question }}</p>
                    <div class="au__ambiguous-opts">
                        <button v-for="opt in item.options" :key="opt.sentence" type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="resolve(item, opt)">
                            {{ opt.label }}
                        </button>
                    </div>
                </div>

                <ul v-if="errors.length || shownIssues.length" class="au__errors">
                    <li v-for="(e, i) in errors" :key="`e${i}`">{{ e }}</li>
                    <li v-for="(issue, i) in shownIssues" :key="`i${i}`">{{ issue.key ? $t(issue.key, issue.params) : issue.text }}</li>
                </ul>

                <AutomationAiDraft :key="aiKey" :sentence="sentence" :failed="sentenceFailed" @drafted="applyAiDraft" />

                <div class="au__compiled">
                    <div class="ah-label">{{ $t('Parity.compiled_rule') }}</div>

                    <div class="au__slots">
                        <span class="au__kw">{{ $t('Automations.when') }}</span>
                        <select v-model="draft.trigger.event" class="au__slot" @change="onRuleEdit">
                            <option v-for="trigger in manifest.triggers" :key="trigger.key" :value="trigger.key">{{ triggerLabel(trigger, $t) }}</option>
                        </select>

                        <span class="au__kw">{{ $t('Automations.in') }}</span>
                        <select v-model="scopeChoice" class="au__slot" data-test="scope-picker" @change="onScopeChange">
                            <option value="all">{{ $t('Automations.all_projects') }}</option>
                            <option v-for="p in projects" :key="p._id" :value="String(p._id)">{{ p.ProjectName || '—' }}</option>
                        </select>

                        <template v-for="(c, i) in conditions" :key="`c${i}`">
                            <span class="au__kw">{{ i === 0 ? $t('Automations.if') : $t('Parity.and') }}</span>
                            <select v-model="c.field" class="au__slot" @change="onFieldChange(c)">
                                <option v-for="f in manifest.conditionFields" :key="f.field" :value="f.field">{{ f.label }}</option>
                            </select>
                            <select v-model="c.op" class="au__slot" @change="onRuleEdit">
                                <option v-for="op in opsFor(c.field)" :key="op" :value="op">{{ opLabel(op, c.field) }}</option>
                            </select>
                            <select v-if="isStatusField(c.field) && needsValue(c.op)" v-model="c.label" class="au__slot" data-test="status-picker" @change="pickStatus(c)">
                                <option value="" disabled>{{ $t('Automations.status_pick') }}</option>
                                <option v-for="choice in choicesFor(c, projects, scopeChoice)" :key="choice.label" :value="choice.label">{{ choice.label }}</option>
                            </select>
                            <select v-else-if="optionsFor(c.field).length && needsValue(c.op)" v-model="c.value" class="au__slot" @change="onRuleEdit">
                                <option v-for="o in optionsFor(c.field)" :key="o" :value="o">{{ optionText(c.field, o) }}</option>
                            </select>
                            <input v-else-if="needsValue(c.op)" v-model="c.value" class="au__slot au__slot--text" :placeholder="$t('Automations.value')" @change="onRuleEdit" />
                            <button type="button" class="au__x" :title="$t('Automations.remove')" @click="conditions.splice(i, 1); onRuleEdit()">×</button>
                        </template>
                        <button type="button" class="au__add" @click="addCondition">{{ $t('Automations.add_condition') }}</button>
                    </div>
                    <p v-if="triggerHelp" class="ah-small au__help" data-test="trigger-help">{{ $t(triggerHelp) }}</p>

                    <div class="au__slots">
                        <template v-for="(s, i) in draft.steps" :key="s.id">
                            <span class="au__kw">{{ i === 0 ? $t('Automations.then') : $t('Parity.and') }}</span>
                            <select v-model="s.action" class="au__slot" @change="resetConfig(s)">
                                <option v-for="a in manifest.actions" :key="a.key" :value="a.key">{{ actionLabel(a, $t) }}</option>
                            </select>
                            <AssignActionEditor v-if="s.action === 'assign'" v-model="s.config" :trigger="draft.trigger.event" @change="onEditorChange(s)" />
                            <NotifyActionEditor v-else-if="s.action === 'notify'" v-model="s.config" @change="onEditorChange(s)" />
                            <template v-else>
                                <template v-for="(spec, field) in schemaOf(s.action)" :key="field">
                                    <select v-if="spec.options" v-model="s.config[field]" class="au__slot" :data-test="`step-field-${field}`" @change="onFieldEdit(s, field)">
                                        <option v-for="o in spec.options" :key="o" :value="o">{{ o }}</option>
                                    </select>
                                    <input v-else v-model="s.config[field]" class="au__slot au__slot--text" :placeholder="spec.label" :data-test="`step-field-${field}`" @change="onFieldEdit(s, field)" />
                                </template>
                            </template>
                            <button type="button" class="au__x" :title="$t('Automations.remove')" @click="draft.steps.splice(i, 1); onRuleEdit()">×</button>
                        </template>
                        <button type="button" class="au__add" @click="addStep">{{ $t('Automations.add_action') }}</button>
                    </div>
                    <p v-for="key in actionHelps" :key="key" class="ah-small au__help" data-test="action-help">{{ $t(key) }}</p>

                    <label class="au-assign__turns" data-test="react-to-automation-label">
                        <input v-model="reactToAutomation" type="checkbox" data-test="react-to-automation" />
                        {{ $t('Automations.react_to_automation') }}
                    </label>
                    <p v-if="reactToAutomation" class="ah-small au__help">{{ $t('Automations.react_to_automation_help') }}</p>

                    <p v-if="changeOpWarning" class="au__warn">{{ changeOpWarning }}</p>

                    <div class="au__save">
                        <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="saving" @click="save(true)">
                            {{ saving ? $t('Parity.saving') : $t('Parity.save_automation') }}
                        </button>
                        <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="saving" @click="save(false)">{{ $t('Automations.save_draft') }}</button>
                        <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="testing" @click="test">
                            {{ backtest ? $t('Parity.backtest_result', { n: backtest.matched, days: backtest.windowDays }) : $t('Parity.test_30_days') }}
                        </button>
                    </div>
                    <p v-if="backtest" class="ah-small" data-test="backtest-basis">{{ backtestBasis }}</p>
                    <ul v-if="backtest && backtest.assignments && backtest.assignments.length" class="au__plan-reasons" data-test="backtest-assign">
                        <li v-for="a in backtest.assignments" :key="a.stepId">
                            {{ $t(a.roundRobin ? 'Automations.assign_backtest_turns' : 'Automations.assign_backtest_people', { people: peopleText(a.people, $t) }) }}
                            <template v-if="a.skipped.length"> · {{ skippedText(a.skipped, $t) }}</template>
                        </li>
                    </ul>
                    <ul v-if="backtest && backtest.notifications && backtest.notifications.length" class="au__plan-reasons" data-test="backtest-notify">
                        <li v-for="n in backtest.notifications" :key="n.stepId">
                            {{ $t('Automations.notify_backtest_people', { people: peopleText(n.people, $t) }) }}
                            <template v-if="n.skipped.length"> · {{ skippedText(n.skipped, $t) }}</template>
                        </li>
                    </ul>

                    <div v-if="editingId" class="au__try">
                        <div class="au__slots">
                            <span class="au__kw">{{ $t('Automations.dry_run_on') }}</span>
                            <select v-model="tryProjectId" class="au__slot" data-test="dry-run-project" @change="loadTryTasks">
                                <option value="">{{ $t('Automations.dry_run_pick_project') }}</option>
                                <option v-for="p in projects" :key="p._id" :value="String(p._id)">{{ p.ProjectName || '—' }}</option>
                            </select>
                            <select v-if="tryProjectId" v-model="tryTaskId" class="au__slot" data-test="dry-run-task">
                                <option value="">{{ $t('Automations.dry_run_pick_task') }}</option>
                                <option v-for="task in tryTasks" :key="task._id" :value="String(task._id)">{{ task.TaskKey ? `${task.TaskKey} · ${task.TaskName}` : task.TaskName }}</option>
                            </select>
                            <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="!tryTaskId || dryRunning" data-test="dry-run" @click="runDryRun">
                                {{ dryRunning ? $t('Automations.dry_running') : $t('Automations.dry_run') }}
                            </button>
                        </div>
                        <p class="ah-small">{{ $t('Automations.dry_run_saved_only') }}</p>
                        <p v-if="dryRunError" class="ah-field__error" data-test="dry-run-error">{{ dryRunError }}</p>

                        <div v-if="dryRunResult" class="au__plan" data-test="dry-run-result">
                            <p class="au__plan-head" data-test="dry-run-headline">
                                <span class="ah-chip" :class="dryRunVerdict.runs ? 'ah-chip--ok' : 'ah-chip--warn'" data-test="dry-run-verdict">{{ $t(dryRunVerdict.titleKey) }}</span>
                                <span v-if="dryRunVerdict.detailKey">{{ $t(dryRunVerdict.detailKey, dryRunVerdict.detailParams) }}</span>
                                <span v-else-if="dryRunVerdict.detailText">{{ dryRunVerdict.detailText }}</span>
                            </p>
                            <ul v-if="dryRunVerdict.reasons.length || dryRunVerdict.showTrigger" class="au__plan-reasons">
                                <li v-for="(reason, i) in dryRunVerdict.reasons" :key="i">{{ reason }}</li>
                                <li v-if="dryRunVerdict.showTrigger" data-test="dry-run-trigger">{{ $t(triggerReasonKey(dryRunResult.trigger), triggerReasonParams(dryRunResult.trigger)) }}</li>
                            </ul>
                            <ol class="au__plan-actions">
                                <li v-for="(step, i) in dryRunResult.actions" :key="step.id" class="au__plan-action" data-test="dry-run-action">
                                    <span data-test="dry-run-step-name">{{ i + 1 }}. {{ stepName(step) }}</span>
                                    <span class="ah-chip" :class="stepRuns(step) ? 'ah-chip--ok' : ''">
                                        {{ stepRuns(step) ? $t('Automations.dry_run_would_run') : $t('Automations.dry_run_would_not_run') }}
                                    </span>
                                    <dl v-if="step.params && Object.keys(step.params).length && !step.assign && !step.notify" class="au__plan-params">
                                        <template v-for="(value, key) in step.params" :key="key">
                                            <dt>{{ paramLabel(step.action, key) }}</dt>
                                            <dd>{{ shownParam(value) }}</dd>
                                        </template>
                                    </dl>
                                    <div v-if="step.assign" class="ah-small au__plan-note" data-test="dry-run-assign">
                                        <p>{{ step.assign.wouldAssign.length ? $t('Automations.assign_would_assign', { people: peopleText(step.assign.wouldAssign, $t) }) : $t('Automations.assign_would_assign_nobody') }}</p>
                                        <p v-if="step.assign.wouldRemove && step.assign.wouldRemove.length">{{ $t('Automations.assign_would_remove', { people: peopleText(step.assign.wouldRemove, $t) }) }}</p>
                                        <p v-if="step.assign.skipped.length">{{ skippedText(step.assign.skipped, $t) }}</p>
                                    </div>
                                    <div v-if="step.notify" class="ah-small au__plan-note" data-test="dry-run-notify">
                                        <p>{{ step.params.message }}</p>
                                        <p>{{ step.notify.wouldNotify.length ? $t('Automations.notify_would_notify', { people: peopleText(step.notify.wouldNotify, $t) }) : $t('Automations.notify_would_notify_nobody') }}</p>
                                        <p v-if="step.notify.skipped.length">{{ skippedText(step.notify.skipped, $t) }}</p>
                                    </div>
                                    <p v-if="step.note" class="ah-small au__plan-note">{{ step.note }}</p>
                                </li>
                            </ol>
                            <p class="ah-small">{{ dryRunResult.basis }}</p>
                        </div>
                    </div>
                </div>
            </template>

            <template v-else>
                <AutomationTemplateGallery
                    v-if="showGallery && canManage && !loading"
                    v-model:projectId="galleryProjectId"
                    :projects="projects"
                    @use="startFromTemplate"
                    @close="showGallery = false"
                />
                <p v-if="loading" class="ah-empty">{{ $t('Parity.loading') }}</p>
                <EmptyState
                    v-else-if="!rules.length && !showGallery"
                    class="ah-empty"
                    data-test="automations-empty"
                    :heading-level="2"
                    :title="$t('Automations.empty_title')"
                    :message="$t('Automations.empty_sub')"
                    :action-label="$t('Automations.new')"
                    :action-allowed="canManage"
                    :secondary-label="canManage ? $t('AutomationTemplates.open') : ''"
                    @action="startNew"
                    @secondary="showGallery = true"
                />

                <div v-for="r in rules" :key="r._id" class="au__rule" :class="{ 'au__rule--off': !r.enabled }">
                    <button
                        type="button"
                        class="au__toggle"
                        :class="{ 'is-on': r.enabled }"
                        :disabled="!canManage"
                        :aria-label="r.enabled ? $t('Automations.turn_off') : $t('Automations.turn_on')"
                        @click="toggle(r)"
                    ><span class="au__knob"></span></button>
                    <span class="au__rule-text">{{ r.sentence || r.summary }}</span>
                    <span v-if="r.needsReview && r.needsReview.length" class="ah-chip ah-chip--warn" data-test="needs-review">
                        {{ $t('Automations.status_needs_review', { status: r.needsReview.map((n) => n.status).join(', ') }) }}
                    </span>
                    <span class="au__rule-count ah-mono">{{ $t('Parity.fired_n', { n: r.firedCount || 0 }) }}</span>
                    <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" data-test="open-runs" @click="runsRule = r">{{ $t('Automations.runs_open') }}</button>
                    <button v-if="canManage" type="button" class="ah-btn ah-btn--ghost ah-btn--sm" @click="edit(r)">{{ $t('Automations.edit') }}</button>
                    <button v-if="canManage" type="button" class="ah-btn ah-btn--ghost ah-btn--sm au__delete" @click="remove(r)">{{ $t('Automations.delete') }}</button>
                </div>
            </template>
        </div>

        <RunHistoryDrawer v-if="runsRule" :rule="runsRule" :triggers="manifest.triggers" :actions="manifest.actions" @close="runsRule = null" />
    </div>
</template>

<script setup>
import { ref, reactive, computed, nextTick, onMounted, defineAsyncComponent } from 'vue';
import { useStore } from 'vuex';
import { useI18n } from 'vue-i18n';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';
import EmptyState from '@/components/atom/EmptyState/EmptyState.vue';
import RunHistoryDrawer from './RunHistoryDrawer.vue';
import AutomationAiDraft from './AutomationAiDraft.vue';
import AutomationTemplateGallery from './AutomationTemplateGallery.vue';
import { assignPeopleText, assignSkippedText } from './assignText';
import { choicesFor, refsFor } from './statusChoices';
import { triggerLabel, actionLabel, fieldLabel, triggerHelpKey, actionHelpKey } from './registryText';
import { fillTemplate } from '@automationTemplates';

// Loaded on first use: most rules never assign, and the people picker pulls in the shared DropDown.
const AssignActionEditor = defineAsyncComponent(() => import('./AssignActionEditor.vue'));
const NotifyActionEditor = defineAsyncComponent(() => import('./NotifyActionEditor.vue'));

// Automations (handoff 13d). You describe the rule in a sentence; the compiled
// rule sits beside it and either can be edited. The compiler is a deterministic
// parser on the server (Modules/Automations/helpers/sentenceRules), never a
// model call — the whole point of the screen is that nothing is a black box.
defineOptions({ name: 'AutomationsPage' });

const props = defineProps({
    openTemplates: { type: Boolean, default: false },
    templateProjectId: { type: String, default: '' },
});

const showGallery = ref(props.openTemplates);
const galleryProjectId = ref(props.templateProjectId);

const manifest = reactive({ triggers: [], conditionFields: [], actions: [], operators: {} });
const rules = ref([]);
const projects = ref([]);
const loading = ref(true);
const loadError = ref('');
const saving = ref(false);
const testing = ref(false);
const building = ref(false);
const editingId = ref(null);
const errors = ref([]);
const issues = ref([]);
const saveTried = ref(false);
const touched = reactive(new Set());
const ambiguities = ref([]);
const grammar = ref({});
const sentence = ref('');
const sentenceInput = ref(null);
const backtest = ref(null);
const runsRule = ref(null);
const tryProjectId = ref('');
const tryTaskId = ref('');
const tryTasks = ref([]);
const dryRunning = ref(false);
const dryRunResult = ref(null);
const dryRunError = ref('');
const sentenceFailed = ref(false);
const aiKey = ref(0);

/* The sentence the server last wrote or read. Recompiling it on blur would
 * re-parse a canonical sentence that cannot express every drafted condition
 * (a person, say) and quietly widen the rule. */
let settledSentence = '';

const scopeChoice = ref('all');
const conditions = ref([]);
const draft = reactive({ trigger: { type: 'event', event: '' }, steps: [] });
const reactToAutomation = ref(false);

let stepSeq = 0;
const nextStepId = () => { stepSeq += 1; return `s${stepSeq}`; };

const UNARY = ['empty', 'notEmpty', 'changed'];
const needsValue = (op) => !UNARY.includes(op);

const fieldDef = (field) => manifest.conditionFields.find((f) => f.field === field) || null;
const opsFor = (field) => fieldDef(field)?.ops || [];
const optionsFor = (field) => fieldDef(field)?.options || [];
const schemaOf = (actionKey) => manifest.actions.find((a) => a.key === actionKey)?.schema || {};

const OP_LABELS = {
    eq: 'is', neq: 'is not', in: 'is any of', notIn: 'is none of',
    contains: 'contains', empty: 'is empty', notEmpty: 'is not empty',
    gt: 'is more than', gte: 'is at least', lt: 'is less than', lte: 'is at most',
    changed: 'changed', changedTo: 'changed to', changedFrom: 'changed from',
};
const isStatusField = (field) => fieldDef(field)?.type === 'status';
const STATUS_OP_KEYS = { in: 'Automations.status_is', notIn: 'Automations.status_is_not' };
const opLabel = (op, field) => (isStatusField(field) && STATUS_OP_KEYS[op] ? t(STATUS_OP_KEYS[op]) : (OP_LABELS[op] || op));
const optionText = (field, option) => (field === 'statusType' ? t(`Automations.status_type_${option}`) : option);

const { getters } = useStore();
const { t } = useI18n();
const canManage = computed(() => [1, 2].includes(Number(getters['settings/companyUserDetail']?.roleType)));
const activeCount = computed(() => rules.value.filter((r) => r.enabled).length);
const triggerDef = computed(() => manifest.triggers.find((t) => t.key === draft.trigger.event) || null);
const triggerHelp = computed(() => triggerHelpKey(draft.trigger.event));
const actionHelps = computed(() => [...new Set(draft.steps.map((step) => actionHelpKey(step.action)).filter(Boolean))]);
const backtestBasis = computed(() => {
    if (!backtest.value) return '';
    return backtest.value.basisKey ? t(`Automations.backtest_basis_${backtest.value.basisKey}`, { days: backtest.value.windowDays }) : backtest.value.basis;
});

// The same check the server runs, surfaced while the user is still typing: a
// "changed to" condition on a trigger with no before/after can never match.
const changeOpWarning = computed(() => {
    const t = triggerDef.value;
    if (!t || t.hasDiff) return '';
    const uses = conditions.value.some((c) => ['changed', 'changedTo', 'changedFrom'].includes(c.op));
    return uses ? `"${t.label}" has no before/after, so a "changed" condition will never match.` : '';
});

/* What the rule lacks is said for a field the person has been in, or for all of them once they tried to save:
 * a new rule starts with empty fields, and listing them before anyone typed reads as a failure. */
const seenConfigs = new Map();
const fieldKey = (stepId, field) => `${stepId}.${field}`;
const rememberConfig = (step) => seenConfigs.set(step.id, JSON.stringify(step.config || {}));
const touch = (step, field) => touched.add(fieldKey(step.id, field));
const touchChanged = (step) => {
    const before = JSON.parse(seenConfigs.get(step.id) || '{}');
    const now = step.config || {};
    [...new Set([...Object.keys(before), ...Object.keys(now)])]
        .filter((field) => JSON.stringify(before[field]) !== JSON.stringify(now[field]))
        .forEach((field) => touch(step, field));
    rememberConfig(step);
};
const forgetFeedback = () => {
    issues.value = [];
    saveTried.value = false;
    touched.clear();
};

const actionDef = (key) => manifest.actions.find((a) => a.key === key) || null;
const issueLine = (issue) => {
    if (issue.code === 'no_steps') return { key: 'Automations.issue_no_steps' };
    if (issue.step === undefined) return { text: issue.text };
    const params = {
        n: issue.step + 1,
        action: actionLabel(actionDef(issue.action), t) || issue.action,
        field: fieldLabel(issue.action, issue.field, schemaOf(issue.action), t),
    };
    if (issue.code === 'required') return { key: 'Automations.issue_step_required', params };
    if (issue.code === 'not_an_option') return { key: 'Automations.issue_step_not_an_option', params };
    return { key: 'Automations.issue_step_other', params: { ...params, reason: issue.text } };
};
const isTouched = (issue) => issue.step !== undefined && touched.has(fieldKey(draft.steps[issue.step]?.id, issue.field));
const shownIssues = computed(() => issues.value.filter((issue) => saveTried.value || isTouched(issue)).map(issueLine));

/* A server that sends the parts gets them worded here; an older one's sentences are shown as they are. */
const takeFeedback = (data, parseErrors = []) => {
    const parts = Array.isArray(data.issues);
    issues.value = parts ? data.issues : [];
    errors.value = parts ? parseErrors : (data.errors || []);
};

const emptyValue = (field) => (isStatusField(field) ? [] : '');

const onFieldChange = (c) => {
    const ops = opsFor(c.field);
    if (!ops.includes(c.op)) c.op = ops[0] || 'eq';
    c.value = emptyValue(c.field);
    c.label = '';
    onRuleEdit();
};

const addCondition = () => {
    const f = manifest.conditionFields[0];
    if (f) conditions.value.push({ field: f.field, op: f.ops[0], value: emptyValue(f.field), label: '' });
    onRuleEdit();
};

const pickStatus = (c) => {
    c.value = refsFor(c.label, projects.value, scopeChoice.value);
    onRuleEdit();
};

/* A status name is a different key in each project, so the keys follow the scope. */
const onScopeChange = () => {
    conditions.value.filter((c) => isStatusField(c.field) && c.label).forEach((c) => {
        const refs = refsFor(c.label, projects.value, scopeChoice.value);
        if (refs.length) c.value = refs;
    });
    onRuleEdit();
};

const resetConfig = (step) => {
    step.config = {};
    if (step.action === 'assign') step.config = { mode: 'add', userIds: [] };
    else if (step.action === 'notify') step.config = { recipients: [], message: '' };
    else {
        Object.entries(schemaOf(step.action)).forEach(([field, spec]) => {
            step.config[field] = spec.options ? spec.options[0] : '';
        });
    }
    [...touched].filter((key) => key.startsWith(`${step.id}.`)).forEach((key) => touched.delete(key));
    rememberConfig(step);
    onRuleEdit();
};

const onFieldEdit = (step, field) => {
    touch(step, field);
    onRuleEdit();
};
const onEditorChange = (step) => {
    touchChanged(step);
    onRuleEdit();
};

const addStep = () => {
    const a = manifest.actions[0];
    if (!a) return;
    const step = { id: nextStepId(), type: 'action', action: a.key, config: {} };
    resetConfig(step);
    draft.steps.push(step);
};

/* Conditions are held flat in the UI because that is how people think about
 * them, and folded into the AST only on save. */
const buildConditions = () => {
    const list = conditions.value
        .filter((c) => c.field && c.op)
        .filter((c) => !(isStatusField(c.field) && needsValue(c.op) && !(c.value || []).length))
        .map((c) => {
            if (!needsValue(c.op)) return { op: c.op, field: c.field };
            return isStatusField(c.field) ? { op: c.op, field: c.field, value: c.value, label: c.label } : { op: c.op, field: c.field, value: c.value };
        });
    if (!list.length) return {};
    return list.length === 1 ? list[0] : { op: 'and', args: list };
};

/* And unfolded again on edit, so a rule saved here reopens exactly as it was. */
const loadConditions = (node) => {
    if (!node || !node.op) return [];
    const list = node.op === 'and' && Array.isArray(node.args) ? node.args : [node];
    return list.filter((n) => n && n.field).map((n) => ({ field: n.field, op: n.op, value: n.value ?? '', label: n.label || '' }));
};

/* No name: the server composes it from the rule it is saving. A name derived
 * here would come from the sentence box, which is one compile behind whatever was
 * typed last. */
const currentRule = () => ({
    version: 2,
    trigger: { type: 'event', event: draft.trigger.event },
    scope: scopeChoice.value === 'all'
        ? { allProjects: true, projectIds: [] }
        : { allProjects: false, projectIds: [scopeChoice.value] },
    conditions: buildConditions(),
    steps: draft.steps,
    reactToAutomation: reactToAutomation.value,
});

const applyRule = (rule) => {
    if (!rule) return;
    draft.trigger = { type: 'event', event: rule.trigger?.event || draft.trigger.event };
    draft.steps = (rule.steps || []).filter((s) => s.type === 'action')
        .map((s) => ({ id: s.id, type: 'action', action: s.action, config: { ...(s.config || {}) } }));
    draft.steps.forEach(rememberConfig);
    stepSeq = draft.steps.length;
    // A rule read from a sentence says nothing about this choice, and must not undo it.
    if (typeof rule.reactToAutomation === 'boolean') reactToAutomation.value = rule.reactToAutomation;
    conditions.value = loadConditions(rule.conditions);
    scopeChoice.value = rule.scope?.allProjects === false && rule.scope.projectIds?.length ? String(rule.scope.projectIds[0]) : 'all';
};

const clearAiDraft = () => {
    sentenceFailed.value = false;
    aiKey.value += 1;
};

/* sentence → rule */
const compileSentence = async () => {
    if (!sentence.value.trim() || sentence.value === settledSentence) return;
    backtest.value = null;
    const asked = sentence.value;
    const body = (await apiRequest('post', env.AUTOMATIONS_COMPILE, { sentence: asked, scope: currentRule().scope }))?.data;
    if (!body?.status) { errors.value = [body?.statusText || 'Could not read that sentence.']; return; }
    takeFeedback(body.data, body.data.parseErrors || []);
    ambiguities.value = body.data.ambiguities || [];
    grammar.value = body.data.grammar || {};
    if ((body.data.errors || []).length) sentenceFailed.value = true;
    else clearAiDraft();
    if (body.data.rule) {
        applyRule(body.data.rule);
        sentence.value = body.data.sentence;
        // The person wrote this rule as a sentence, so what it lacks is theirs to hear about now.
        issues.value.filter((issue) => issue.step !== undefined && draft.steps[issue.step]).forEach((issue) => touch(draft.steps[issue.step], issue.field));
    }
    settledSentence = body.data.rule ? body.data.sentence : asked;
};

/* The draft only fills the builder: saving stays the person's own step. */
const applyAiDraft = ({ rule, sentence: drafted }) => {
    applyRule(rule);
    sentence.value = drafted;
    settledSentence = drafted;
    errors.value = [];
    forgetFeedback();
    ambiguities.value = [];
    backtest.value = null;
    sentenceFailed.value = false;
};

/* rule → sentence, so editing a slot rewrites the sentence above it. */
const onRuleEdit = async () => {
    backtest.value = null;
    sentenceFailed.value = false;
    const body = (await apiRequest('post', env.AUTOMATIONS_COMPILE, { rule: currentRule() }))?.data;
    if (!body?.status) return;
    takeFeedback(body.data);
    sentence.value = body.data.sentence;
    settledSentence = body.data.sentence;
};

const resolve = (item, option) => {
    sentence.value = sentence.value.replace(/^when\s+[^,]+/i, `When ${option.sentence}`);
    ambiguities.value = ambiguities.value.filter((a) => a !== item);
    compileSentence();
};

const test = async () => {
    testing.value = true;
    try {
        const body = (await apiRequest('post', env.AUTOMATIONS_BACKTEST, { rule: currentRule() }))?.data;
        if (body?.status) backtest.value = body.data;
    } finally {
        testing.value = false;
    }
};

const resetDryRun = () => {
    tryProjectId.value = '';
    tryTaskId.value = '';
    tryTasks.value = [];
    dryRunResult.value = null;
    dryRunError.value = '';
};

const loadTryTasks = async () => {
    tryTaskId.value = '';
    tryTasks.value = [];
    dryRunResult.value = null;
    if (!tryProjectId.value) return;
    try {
        const body = await apiRequest('post', `${env.TASK}/find`, {
            findQuery: { $match: { deletedStatusKey: 0, mainChat: { $ne: true }, ProjectID: { objId: { $in: [tryProjectId.value] } } } },
        });
        tryTasks.value = (Array.isArray(body?.data) ? body.data : []).slice(0, 200);
    } catch (e) { tryTasks.value = []; }
};

const runDryRun = async () => {
    if (!editingId.value || !tryTaskId.value) return;
    dryRunning.value = true;
    dryRunResult.value = null;
    dryRunError.value = '';
    try {
        const body = (await apiRequest('post', `${env.AUTOMATIONS_V2}/${editingId.value}/dry-run`, { taskId: tryTaskId.value }))?.data;
        if (body?.status) dryRunResult.value = body.data;
        else dryRunError.value = body?.statusText || t('Automations.dry_run_failed');
    } catch (e) {
        dryRunError.value = e?.response?.data?.statusText || t('Automations.dry_run_failed');
    } finally {
        dryRunning.value = false;
    }
};

const paramLabel = (actionKey, key) => schemaOf(actionKey)[key]?.label || key;

const stepName = (step) => actionLabel(actionDef(step.action), t) || step.label;
const triggerReasonKey = (state) => `Automations.dry_run_trigger_${state.reason}`;
const triggerReasonParams = (state) => ({ open: state.open, total: state.total });

/* One outcome: conditions that hold on a task the trigger does not reach yet are a rule that would not run now. */
const dryRunVerdict = computed(() => {
    const result = dryRunResult.value;
    if (!result) return null;
    const reasons = result.reasons || [];
    const state = result.trigger || null;
    if (result.matched && state && state.wouldFire === false) {
        return { runs: false, titleKey: 'Automations.dry_run_not_now', detailKey: triggerReasonKey(state), detailParams: triggerReasonParams(state), reasons, showTrigger: false };
    }
    if (!result.matched) {
        return { runs: false, titleKey: 'Automations.dry_run_not_matched', detailText: reasons[0] || '', reasons: reasons.slice(1), showTrigger: Boolean(state) };
    }
    return {
        runs: true,
        titleKey: result.rule && result.rule.enabled === false ? 'Automations.dry_run_matched_when_on' : 'Automations.dry_run_matched',
        detailKey: 'Automations.dry_run_would_do',
        detailParams: { actions: (result.actions || []).filter((step) => step.wouldRun).map(stepName).join(', ') },
        reasons,
        showTrigger: Boolean(state),
    };
});
const stepRuns = (step) => Boolean(step.wouldRun && dryRunVerdict.value && dryRunVerdict.value.runs);
const peopleText = assignPeopleText;
const skippedText = assignSkippedText;
const shownParam = (value) => (value !== null && typeof value === 'object' ? JSON.stringify(value) : String(value ?? ''));

const resetBuilder = () => {
    resetDryRun();
    clearAiDraft();
    errors.value = [];
    forgetFeedback();
    ambiguities.value = [];
    backtest.value = null;
    editingId.value = null;
};

/* The project the page was opened from, while the person can still see it. */
const openedFromProject = () => (projects.value.some((p) => String(p._id) === props.templateProjectId) ? props.templateProjectId : '');

const startNew = async () => {
    resetBuilder();
    draft.trigger = { type: 'event', event: manifest.triggers[0]?.key || '' };
    draft.steps = [];
    conditions.value = [];
    scopeChoice.value = openedFromProject() || 'all';
    reactToAutomation.value = false;
    sentence.value = '';
    settledSentence = '';
    stepSeq = 0;
    addStep();
    building.value = true;
    await nextTick();
    if (sentenceInput.value) sentenceInput.value.focus();
    onRuleEdit();
};

/* A template only fills the builder: the person reviews it, and saving stays their step. */
const startFromTemplate = (template) => {
    resetBuilder();
    reactToAutomation.value = false;
    applyRule(fillTemplate(template, { projects: projects.value, projectId: galleryProjectId.value, translate: t }));
    sentence.value = '';
    settledSentence = '';
    showGallery.value = false;
    building.value = true;
    onRuleEdit();
};

const edit = (rule) => {
    resetBuilder();
    editingId.value = rule._id;
    reactToAutomation.value = false;
    applyRule(rule);
    sentence.value = rule.sentence || '';
    settledSentence = sentence.value;
    building.value = true;
};

const cancel = () => { building.value = false; errors.value = []; forgetFeedback(); clearAiDraft(); };

const save = async (enabled) => {
    saving.value = true;
    saveTried.value = true;
    errors.value = [];
    try {
        const body = { ...currentRule(), enabled };
        const res = editingId.value
            ? await apiRequest('put', `${env.AUTOMATIONS_V2}/${editingId.value}`, body)
            : await apiRequest('post', env.AUTOMATIONS_V2, body);
        const data = res?.data;
        if (data && data.status === false) {
            if (Array.isArray(data.issues) && data.issues.length) issues.value = data.issues;
            else errors.value = data.errors && data.errors.length ? data.errors : [data.statusText || 'Could not save.'];
            return;
        }
        building.value = false;
        clearAiDraft();
        await loadRules();
    } catch (e) {
        errors.value = [e?.message || 'Could not save.'];
    } finally {
        saving.value = false;
    }
};

const toggle = async (rule) => {
    if (!canManage.value) return;
    try {
        await apiRequest('patch', `${env.AUTOMATIONS_V2}/${rule._id}/enabled`, { enabled: !rule.enabled });
        await loadRules();
    } catch (e) { /* the list reload below surfaces the real state */ }
};

const remove = async (rule) => {
    try {
        await apiRequest('delete', `${env.AUTOMATIONS_V2}/${rule._id}`);
        await loadRules();
    } catch (e) { /* noop */ }
};

const loadRegistry = async () => {
    const body = (await apiRequest('get', `${env.AUTOMATIONS_V2}/registry`))?.data;
    const d = body?.data || {};
    manifest.triggers = d.triggers || [];
    manifest.conditionFields = d.conditionFields || [];
    manifest.actions = d.actions || [];
    manifest.operators = d.operators || {};
};

const loadRules = async () => {
    const body = (await apiRequest('get', env.AUTOMATIONS_V2))?.data;
    rules.value = body?.data || [];
};

const loadProjects = async () => {
    try {
        const body = (await apiRequest('get', env.PROJECT))?.data;
        const list = Array.isArray(body) ? body : (body && body.data) || [];
        projects.value = list.filter((p) => p && p.deletedStatusKey !== 1 && p.deletedStatusKey !== 2);
    } catch (e) { projects.value = []; }
};

onMounted(async () => {
    try {
        await loadRegistry();
        await Promise.all([loadRules(), loadProjects()]);
        if (!projects.value.some((p) => String(p._id) === galleryProjectId.value)) galleryProjectId.value = '';
    } catch (e) {
        loadError.value = e?.message || 'Could not load automations.';
    } finally {
        loading.value = false;
    }
});
</script>

<style>
@import "./style.css";
</style>
