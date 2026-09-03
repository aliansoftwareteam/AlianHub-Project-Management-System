<template>
    <div class="ah-page au">
        <div class="ah-toolbar">
            <div class="ah-toolbar__title">{{ $t('Automations.title') }}</div>
            <span class="parity-count">{{ $t('ParityV2.n_active', { n: activeCount }) }}</span>
            <div class="ah-toolbar__spacer"></div>
            <button v-if="!building" type="button" class="ah-btn ah-btn--primary ah-btn--sm" @click="startNew">
                <ShellIcon name="plus" :size="14" />{{ $t('Automations.new') }}
            </button>
            <button v-else type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="cancel">{{ $t('Automations.cancel') }}</button>
        </div>

        <div class="au__body ah-scroll">
            <p v-if="loadError" class="ah-field__error">{{ loadError }}</p>

            <template v-if="building">
                <div class="au__sentence">
                    <ShellIcon name="ai" :size="14" class="au__spark" />
                    <input
                        ref="sentenceInput"
                        v-model="sentence"
                        class="au__sentence-input"
                        type="text"
                        :placeholder="$t('ParityV2.sentence_placeholder')"
                        @keyup.enter="compileSentence"
                        @blur="compileSentence"
                    />
                    <span class="ah-kbd">↵</span>
                </div>

                <p v-if="grammar.shape" class="ah-small au__grammar">{{ $t('ParityV2.grammar_shape', { shape: grammar.shape }) }}</p>

                <div v-for="(item, i) in ambiguities" :key="i" class="au__ambiguous">
                    <div class="ah-label">{{ $t('ParityV2.ambiguous') }}</div>
                    <p class="au__ambiguous-q">{{ item.question }}</p>
                    <div class="au__ambiguous-opts">
                        <button v-for="opt in item.options" :key="opt.sentence" type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="resolve(item, opt)">
                            {{ opt.label }}
                        </button>
                    </div>
                </div>

                <ul v-if="errors.length" class="au__errors">
                    <li v-for="(e, i) in errors" :key="i">{{ e }}</li>
                </ul>

                <div class="au__compiled">
                    <div class="ah-label">{{ $t('ParityV2.compiled_rule') }}</div>

                    <div class="au__slots">
                        <span class="au__kw">{{ $t('Automations.when') }}</span>
                        <select v-model="draft.trigger.event" class="au__slot" @change="onRuleEdit">
                            <option v-for="trigger in manifest.triggers" :key="trigger.key" :value="trigger.key">{{ trigger.label }}</option>
                        </select>

                        <span class="au__kw">{{ $t('Automations.in') }}</span>
                        <select v-model="scopeChoice" class="au__slot" @change="onRuleEdit">
                            <option value="all">{{ $t('Automations.all_projects') }}</option>
                            <option v-for="p in projects" :key="p._id" :value="String(p._id)">{{ p.ProjectName || '—' }}</option>
                        </select>

                        <template v-for="(c, i) in conditions" :key="`c${i}`">
                            <span class="au__kw">{{ i === 0 ? $t('Automations.if') : $t('ParityV2.and') }}</span>
                            <select v-model="c.field" class="au__slot" @change="onFieldChange(c)">
                                <option v-for="f in manifest.conditionFields" :key="f.field" :value="f.field">{{ f.label }}</option>
                            </select>
                            <select v-model="c.op" class="au__slot" @change="onRuleEdit">
                                <option v-for="op in opsFor(c.field)" :key="op" :value="op">{{ opLabel(op) }}</option>
                            </select>
                            <select v-if="optionsFor(c.field).length && needsValue(c.op)" v-model="c.value" class="au__slot" @change="onRuleEdit">
                                <option v-for="o in optionsFor(c.field)" :key="o" :value="o">{{ o }}</option>
                            </select>
                            <input v-else-if="needsValue(c.op)" v-model="c.value" class="au__slot au__slot--text" :placeholder="$t('Automations.value')" @change="onRuleEdit" />
                            <button type="button" class="au__x" :title="$t('Automations.remove')" @click="conditions.splice(i, 1); onRuleEdit()">×</button>
                        </template>
                        <button type="button" class="au__add" @click="addCondition">{{ $t('Automations.add_condition') }}</button>
                    </div>

                    <div class="au__slots">
                        <template v-for="(s, i) in draft.steps" :key="s.id">
                            <span class="au__kw">{{ i === 0 ? $t('Automations.then') : $t('ParityV2.and') }}</span>
                            <select v-model="s.action" class="au__slot" @change="resetConfig(s)">
                                <option v-for="a in manifest.actions" :key="a.key" :value="a.key">{{ a.label }}</option>
                            </select>
                            <template v-for="(spec, field) in schemaOf(s.action)" :key="field">
                                <select v-if="spec.options" v-model="s.config[field]" class="au__slot" @change="onRuleEdit">
                                    <option v-for="o in spec.options" :key="o" :value="o">{{ o }}</option>
                                </select>
                                <input v-else v-model="s.config[field]" class="au__slot au__slot--text" :placeholder="spec.label" @change="onRuleEdit" />
                            </template>
                            <button type="button" class="au__x" :title="$t('Automations.remove')" @click="draft.steps.splice(i, 1); onRuleEdit()">×</button>
                        </template>
                        <button type="button" class="au__add" @click="addStep">{{ $t('Automations.add_action') }}</button>
                    </div>

                    <p v-if="changeOpWarning" class="au__warn">{{ changeOpWarning }}</p>

                    <div class="au__save">
                        <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="saving" @click="save(true)">
                            {{ saving ? $t('ParityV2.saving') : $t('ParityV2.save_automation') }}
                        </button>
                        <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="saving" @click="save(false)">{{ $t('Automations.save_draft') }}</button>
                        <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="testing" @click="test">
                            {{ backtest ? $t('ParityV2.backtest_result', { n: backtest.matched, days: backtest.windowDays }) : $t('ParityV2.test_30_days') }}
                        </button>
                    </div>
                    <p v-if="backtest" class="ah-small">{{ backtest.basis }}</p>
                </div>
            </template>

            <template v-else>
                <p v-if="loading" class="ah-empty">{{ $t('ParityV2.loading') }}</p>
                <div v-else-if="!rules.length" class="ah-empty au__empty">
                    <h2 class="ah-h2">{{ $t('Automations.empty_title') }}</h2>
                    <p>{{ $t('Automations.empty_sub') }}</p>
                    <button type="button" class="ah-btn ah-btn--primary" @click="startNew">{{ $t('Automations.new') }}</button>
                </div>

                <div v-for="r in rules" :key="r._id" class="au__rule" :class="{ 'au__rule--off': !r.enabled }">
                    <button
                        type="button"
                        class="au__toggle"
                        :class="{ 'is-on': r.enabled }"
                        :aria-label="r.enabled ? $t('Automations.turn_off') : $t('Automations.turn_on')"
                        @click="toggle(r)"
                    ><span class="au__knob"></span></button>
                    <span class="au__rule-text">{{ r.sentence || r.summary }}</span>
                    <span class="au__rule-count ah-mono">{{ $t('ParityV2.fired_n', { n: r.firedCount || 0 }) }}</span>
                    <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" @click="edit(r)">{{ $t('Automations.edit') }}</button>
                    <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm au__delete" @click="remove(r)">{{ $t('Automations.delete') }}</button>
                </div>
            </template>
        </div>
    </div>
</template>

<script setup>
import { ref, reactive, computed, nextTick, onMounted } from 'vue';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';

// Automations (handoff 13d). You describe the rule in a sentence; the compiled
// rule sits beside it and either can be edited. The compiler is a deterministic
// parser on the server (Modules/Automations/helpers/sentenceRules), never a
// model call — the whole point of the screen is that nothing is a black box.
defineOptions({ name: 'AutomationsPage' });

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
const ambiguities = ref([]);
const grammar = ref({});
const sentence = ref('');
const sentenceInput = ref(null);
const backtest = ref(null);

const scopeChoice = ref('all');
const conditions = ref([]);
const draft = reactive({ name: '', trigger: { type: 'event', event: '' }, steps: [] });

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
const opLabel = (op) => OP_LABELS[op] || op;

const activeCount = computed(() => rules.value.filter((r) => r.enabled).length);
const triggerDef = computed(() => manifest.triggers.find((t) => t.key === draft.trigger.event) || null);

// The same check the server runs, surfaced while the user is still typing: a
// "changed to" condition on a trigger with no before/after can never match.
const changeOpWarning = computed(() => {
    const t = triggerDef.value;
    if (!t || t.hasDiff) return '';
    const uses = conditions.value.some((c) => ['changed', 'changedTo', 'changedFrom'].includes(c.op));
    return uses ? `"${t.label}" has no before/after, so a "changed" condition will never match.` : '';
});

const onFieldChange = (c) => {
    const ops = opsFor(c.field);
    if (!ops.includes(c.op)) c.op = ops[0] || 'eq';
    c.value = '';
    onRuleEdit();
};

const addCondition = () => {
    const f = manifest.conditionFields[0];
    if (f) conditions.value.push({ field: f.field, op: f.ops[0], value: '' });
    onRuleEdit();
};

const resetConfig = (step) => {
    step.config = {};
    Object.entries(schemaOf(step.action)).forEach(([field, spec]) => {
        step.config[field] = spec.options ? spec.options[0] : '';
    });
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
        .map((c) => (needsValue(c.op) ? { op: c.op, field: c.field, value: c.value } : { op: c.op, field: c.field }));
    if (!list.length) return {};
    return list.length === 1 ? list[0] : { op: 'and', args: list };
};

/* And unfolded again on edit, so a rule saved here reopens exactly as it was. */
const loadConditions = (node) => {
    if (!node || !node.op) return [];
    const list = node.op === 'and' && Array.isArray(node.args) ? node.args : [node];
    return list.filter((n) => n && n.field).map((n) => ({ field: n.field, op: n.op, value: n.value ?? '' }));
};

const currentRule = () => ({
    name: draft.name || sentence.value.slice(0, 120),
    version: 2,
    trigger: { type: 'event', event: draft.trigger.event },
    scope: scopeChoice.value === 'all'
        ? { allProjects: true, projectIds: [] }
        : { allProjects: false, projectIds: [scopeChoice.value] },
    conditions: buildConditions(),
    steps: draft.steps,
});

const applyRule = (rule) => {
    if (!rule) return;
    draft.trigger = { type: 'event', event: rule.trigger?.event || draft.trigger.event };
    draft.steps = (rule.steps || []).filter((s) => s.type === 'action')
        .map((s) => ({ id: s.id, type: 'action', action: s.action, config: { ...(s.config || {}) } }));
    stepSeq = draft.steps.length;
    conditions.value = loadConditions(rule.conditions);
    scopeChoice.value = rule.scope?.allProjects === false && rule.scope.projectIds?.length ? String(rule.scope.projectIds[0]) : 'all';
};

/* sentence → rule */
const compileSentence = async () => {
    if (!sentence.value.trim()) return;
    backtest.value = null;
    const body = (await apiRequest('post', env.AUTOMATIONS_COMPILE, { sentence: sentence.value, name: draft.name }))?.data;
    if (!body?.status) { errors.value = [body?.statusText || 'Could not read that sentence.']; return; }
    errors.value = body.data.errors || [];
    ambiguities.value = body.data.ambiguities || [];
    grammar.value = body.data.grammar || {};
    if (body.data.rule) {
        applyRule(body.data.rule);
        sentence.value = body.data.sentence;
    }
};

/* rule → sentence, so editing a slot rewrites the sentence above it. */
const onRuleEdit = async () => {
    backtest.value = null;
    const body = (await apiRequest('post', env.AUTOMATIONS_COMPILE, { rule: currentRule(), name: draft.name }))?.data;
    if (!body?.status) return;
    errors.value = body.data.errors || [];
    sentence.value = body.data.sentence;
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

const startNew = async () => {
    errors.value = [];
    ambiguities.value = [];
    backtest.value = null;
    editingId.value = null;
    draft.name = '';
    draft.trigger = { type: 'event', event: manifest.triggers[0]?.key || '' };
    draft.steps = [];
    conditions.value = [];
    scopeChoice.value = 'all';
    sentence.value = '';
    stepSeq = 0;
    addStep();
    building.value = true;
    await nextTick();
    if (sentenceInput.value) sentenceInput.value.focus();
    onRuleEdit();
};

const edit = (rule) => {
    errors.value = [];
    ambiguities.value = [];
    backtest.value = null;
    editingId.value = rule._id;
    draft.name = rule.name || '';
    applyRule(rule);
    sentence.value = rule.sentence || '';
    building.value = true;
};

const cancel = () => { building.value = false; errors.value = []; };

const save = async (enabled) => {
    saving.value = true;
    errors.value = [];
    try {
        const body = { ...currentRule(), name: draft.name || sentence.value.slice(0, 120), enabled };
        const res = editingId.value
            ? await apiRequest('put', `${env.AUTOMATIONS_V2}/${editingId.value}`, body)
            : await apiRequest('post', env.AUTOMATIONS_V2, body);
        const data = res?.data;
        if (data && data.status === false) {
            errors.value = data.errors && data.errors.length ? data.errors : [data.statusText || 'Could not save.'];
            return;
        }
        building.value = false;
        await loadRules();
    } catch (e) {
        errors.value = [e?.message || 'Could not save.'];
    } finally {
        saving.value = false;
    }
};

const toggle = async (rule) => {
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
        projects.value = body?.data || [];
    } catch (e) { projects.value = []; }
};

onMounted(async () => {
    try {
        await loadRegistry();
        await Promise.all([loadRules(), loadProjects()]);
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
