<template>
    <div class="au-wrap">
        <div class="au-topbar">
            <router-link :to="{ name: 'Home', params: { cid: cid } }" class="au-home" :title="$t('Automations.home')">
                <img src="@/assets/images/svg/Home.svg" alt="Home" />
            </router-link>
            <h1 class="au-title">{{ $t('Automations.title') }}</h1>
            <button v-if="!building" class="au-btn au-primary" @click="startNew">{{ $t('Automations.new') }}</button>
        </div>

        <!-- ── list ─────────────────────────────────────────────── -->
        <section v-if="!building" class="au-body">
            <p v-if="loadError" class="au-error">{{ loadError }}</p>

            <div v-if="!loading && !rules.length" class="au-empty">
                <h2>{{ $t('Automations.empty_title') }}</h2>
                <p>{{ $t('Automations.empty_sub') }}</p>
                <button class="au-btn au-primary" @click="startNew">{{ $t('Automations.new') }}</button>
            </div>

            <div v-for="r in rules" :key="r._id" class="au-card" :class="{ off: !r.enabled }">
                <div class="au-card-main">
                    <span class="au-card-name">{{ r.name }}</span>
                    <span class="au-card-sentence">{{ r.summary }}</span>
                </div>
                <div class="au-card-side">
                    <span class="au-pill" :class="r.enabled ? 'on' : 'paused'">
                        {{ r.enabled ? $t('Automations.on') : $t('Automations.off') }}
                    </span>
                    <button class="au-mini" @click="toggle(r)">
                        {{ r.enabled ? $t('Automations.turn_off') : $t('Automations.turn_on') }}
                    </button>
                    <button class="au-mini" @click="edit(r)">{{ $t('Automations.edit') }}</button>
                    <button class="au-mini au-danger" @click="remove(r)">{{ $t('Automations.delete') }}</button>
                </div>
            </div>
        </section>

        <!-- ── sentence builder ─────────────────────────────────── -->
        <section v-else class="au-body">
            <div class="au-builder">
                <input v-model="draft.name" class="au-name" :placeholder="$t('Automations.name_placeholder')" />

                <!-- WHEN -->
                <div class="au-line">
                    <span class="au-kw">{{ $t('Automations.when') }}</span>
                    <select v-model="draft.trigger.event" class="au-slot">
                        <option v-for="t in manifest.triggers" :key="t.key" :value="t.key">{{ t.label }}</option>
                    </select>
                    <span class="au-kw">{{ $t('Automations.in') }}</span>
                    <select v-model="scopeChoice" class="au-slot">
                        <option value="all">{{ $t('Automations.all_projects') }}</option>
                        <option v-for="p in projects" :key="p._id" :value="String(p._id)">{{ p.ProjectName || '—' }}</option>
                    </select>
                </div>

                <!-- IF -->
                <div class="au-line au-block">
                    <span class="au-kw">{{ $t('Automations.if') }}</span>
                    <div class="au-conds">
                        <div v-if="!conditions.length" class="au-hint">{{ $t('Automations.any_time') }}</div>
                        <div v-for="(c, i) in conditions" :key="i" class="au-cond">
                            <select v-model="c.field" class="au-slot" @change="onFieldChange(c)">
                                <option v-for="f in manifest.conditionFields" :key="f.field" :value="f.field">{{ f.label }}</option>
                            </select>
                            <select v-model="c.op" class="au-slot">
                                <option v-for="op in opsFor(c.field)" :key="op" :value="op">{{ opLabel(op) }}</option>
                            </select>
                            <select v-if="optionsFor(c.field).length && needsValue(c.op)" v-model="c.value" class="au-slot">
                                <option v-for="o in optionsFor(c.field)" :key="o" :value="o">{{ o }}</option>
                            </select>
                            <input v-else-if="needsValue(c.op)" v-model="c.value" class="au-slot au-input" :placeholder="$t('Automations.value')" />
                            <button class="au-x" :title="$t('Automations.remove')" @click="conditions.splice(i, 1)">×</button>
                        </div>
                        <button class="au-add" @click="addCondition">{{ $t('Automations.add_condition') }}</button>
                        <p v-if="changeOpWarning" class="au-warn">{{ changeOpWarning }}</p>
                    </div>
                </div>

                <!-- THEN -->
                <div class="au-line au-block">
                    <span class="au-kw">{{ $t('Automations.then') }}</span>
                    <div class="au-conds">
                        <div v-for="(s, i) in draft.steps" :key="s.id" class="au-cond">
                            <select v-model="s.action" class="au-slot" @change="resetConfig(s)">
                                <option v-for="a in manifest.actions" :key="a.key" :value="a.key">{{ a.label }}</option>
                            </select>
                            <!-- Rendered from the action's own schema: a new action needs no code here. -->
                            <template v-for="(spec, field) in schemaOf(s.action)" :key="field">
                                <select v-if="spec.options" v-model="s.config[field]" class="au-slot">
                                    <option v-for="o in spec.options" :key="o" :value="o">{{ o }}</option>
                                </select>
                                <input v-else v-model="s.config[field]" class="au-slot au-input" :placeholder="spec.label" />
                            </template>
                            <button class="au-x" :title="$t('Automations.remove')" @click="draft.steps.splice(i, 1)">×</button>
                        </div>
                        <button class="au-add" @click="addStep">{{ $t('Automations.add_action') }}</button>
                    </div>
                </div>

                <p class="au-preview">{{ sentence }}</p>
                <ul v-if="errors.length" class="au-errors">
                    <li v-for="(e, i) in errors" :key="i">{{ e }}</li>
                </ul>

                <div class="au-actions">
                    <button class="au-btn" @click="cancel">{{ $t('Automations.cancel') }}</button>
                    <button class="au-btn" :disabled="saving" @click="save(false)">{{ $t('Automations.save_draft') }}</button>
                    <button class="au-btn au-primary" :disabled="saving" @click="save(true)">{{ $t('Automations.save_on') }}</button>
                </div>
            </div>
        </section>
    </div>
</template>

<script>
export default { name: 'AutomationsPage' };
</script>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { apiRequest } from '@/services';
import * as env from '@/config/env';

const route = useRoute();
const cid = computed(() => route.params.cid);

const manifest = reactive({ triggers: [], conditionFields: [], actions: [], operators: {} });
const rules = ref([]);
const projects = ref([]);
const loading = ref(true);
const loadError = ref('');
const saving = ref(false);
const building = ref(false);
const editingId = ref(null);
const errors = ref([]);

const scopeChoice = ref('all');
const conditions = ref([]);
const draft = reactive({ name: '', trigger: { type: 'event', event: '' }, steps: [] });

let stepSeq = 0;
const nextStepId = () => { stepSeq += 1; return `s${stepSeq}`; };

// Operators that compare against a value; the rest are unary ("is empty").
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

const triggerDef = computed(() => manifest.triggers.find((t) => t.key === draft.trigger.event) || null);

// The same check the server runs, surfaced while the user is still typing: a
// "changed to" condition on a trigger with no before/after can never match.
const changeOpWarning = computed(() => {
    const t = triggerDef.value;
    if (!t || t.hasDiff) return '';
    const uses = conditions.value.some((c) => ['changed', 'changedTo', 'changedFrom'].includes(c.op));
    return uses ? `"${t.label}" has no before/after, so a "changed" condition will never match.` : '';
});

const sentence = computed(() => {
    const when = triggerDef.value?.label || '…';
    const where = scopeChoice.value === 'all'
        ? 'any project'
        : (projects.value.find((p) => String(p._id) === scopeChoice.value)?.ProjectName || 'a project');
    const ifs = conditions.value.length
        ? conditions.value.map((c) => `${fieldDef(c.field)?.label || c.field} ${opLabel(c.op)} ${needsValue(c.op) ? (c.value || '…') : ''}`.trim()).join(' and ')
        : 'anything happens';
    const thens = draft.steps.map((s) => manifest.actions.find((a) => a.key === s.action)?.label || s.action).join(', ') || '…';
    return `When ${when} in ${where}, if ${ifs}, then ${thens}.`;
});

const onFieldChange = (c) => {
    const ops = opsFor(c.field);
    if (!ops.includes(c.op)) c.op = ops[0] || 'eq';
    c.value = '';
};

const addCondition = () => {
    const f = manifest.conditionFields[0];
    if (f) conditions.value.push({ field: f.field, op: f.ops[0], value: '' });
};

const resetConfig = (step) => {
    step.config = {};
    Object.entries(schemaOf(step.action)).forEach(([field, spec]) => {
        step.config[field] = spec.options ? spec.options[0] : '';
    });
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

const startNew = () => {
    errors.value = [];
    editingId.value = null;
    draft.name = '';
    draft.trigger = { type: 'event', event: manifest.triggers[0]?.key || '' };
    draft.steps = [];
    conditions.value = [];
    scopeChoice.value = 'all';
    stepSeq = 0;
    addStep();
    building.value = true;
};

const edit = (rule) => {
    errors.value = [];
    editingId.value = rule._id;
    draft.name = rule.name || '';
    draft.trigger = { type: 'event', event: rule.trigger?.event || manifest.triggers[0]?.key || '' };
    draft.steps = (rule.steps || []).filter((s) => s.type === 'action')
        .map((s) => ({ id: s.id, type: 'action', action: s.action, config: { ...(s.config || {}) } }));
    stepSeq = draft.steps.length;
    conditions.value = loadConditions(rule.conditions);
    scopeChoice.value = rule.scope?.allProjects === false && rule.scope.projectIds?.length
        ? String(rule.scope.projectIds[0]) : 'all';
    building.value = true;
};

const cancel = () => { building.value = false; errors.value = []; };

const payload = (enabled) => ({
    name: draft.name,
    enabled,
    trigger: { type: 'event', event: draft.trigger.event },
    scope: scopeChoice.value === 'all'
        ? { allProjects: true, projectIds: [] }
        : { allProjects: false, projectIds: [scopeChoice.value] },
    conditions: buildConditions(),
    steps: draft.steps,
});

const save = async (enabled) => {
    saving.value = true;
    errors.value = [];
    try {
        const body = payload(enabled);
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

<style scoped>
.au-wrap { padding: 0 0 40px; }
.au-topbar { display: flex; align-items: center; gap: 12px; padding: 16px 24px; border-bottom: 1px solid #e6e6ef; }
.au-home img { width: 20px; height: 20px; }
.au-title { font-size: 18px; font-weight: 700; margin: 0; flex: 1; }
.au-body { padding: 20px 24px; }

.au-btn { border: 1px solid #d7d5e4; background: #fff; border-radius: 8px; padding: 7px 14px; font-size: 13px; font-weight: 600; cursor: pointer; }
.au-btn:disabled { opacity: .55; cursor: default; }
.au-primary { background: #2f3990; border-color: #2f3990; color: #fff; }
.au-mini { border: 1px solid #d7d5e4; background: #fff; border-radius: 6px; padding: 4px 9px; font-size: 12px; cursor: pointer; }
.au-danger { color: #a82e28; border-color: #f0cfcd; }

.au-empty { text-align: center; padding: 56px 20px; color: #6b6980; }
.au-empty h2 { font-size: 17px; margin: 0 0 6px; color: #17162a; }
.au-empty p { margin: 0 0 16px; }
.au-error { color: #a82e28; }

.au-card { display: flex; align-items: center; gap: 16px; border: 1px solid #e6e6ef; border-radius: 10px; padding: 14px 16px; margin-bottom: 10px; background: #fff; }
.au-card.off { opacity: .62; }
.au-card-main { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1; }
.au-card-name { font-weight: 600; font-size: 14px; }
.au-card-sentence { font-size: 12.5px; color: #6b6980; }
.au-card-side { display: flex; align-items: center; gap: 8px; flex: none; }
.au-pill { font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 5px; text-transform: uppercase; }
.au-pill.on { background: #e3f3ed; color: #0d6e52; }
.au-pill.paused { background: #f2f1f7; color: #7b7994; }

.au-builder { border: 1px solid #e6e6ef; border-radius: 12px; padding: 22px; background: #fff; max-width: 900px; }
.au-name { width: 100%; border: none; border-bottom: 1px solid #e6e6ef; font-size: 18px; font-weight: 700; padding: 6px 0 10px; margin-bottom: 20px; outline: none; }
.au-line { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
.au-block { align-items: flex-start; }
.au-kw { font-size: 13px; font-weight: 700; color: #7b7994; min-width: 42px; text-transform: uppercase; letter-spacing: .04em; padding-top: 6px; }
.au-slot { border: 1px solid #2f3990; color: #2f3990; background: rgba(47, 57, 144, .06); border-radius: 7px; padding: 5px 10px; font-size: 13px; font-weight: 600; cursor: pointer; }
.au-input { min-width: 150px; }
.au-conds { display: flex; flex-direction: column; gap: 8px; flex: 1; }
.au-cond { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.au-add { border: 1px dashed #d7d5e4; color: #7b7994; background: none; border-radius: 7px; padding: 5px 11px; font-size: 12.5px; font-weight: 600; cursor: pointer; align-self: flex-start; }
.au-x { border: none; background: none; color: #a09eb4; font-size: 17px; line-height: 1; cursor: pointer; padding: 0 4px; }
.au-hint { font-size: 13px; color: #a09eb4; padding-top: 5px; }
.au-warn { font-size: 12.5px; color: #95610a; background: #faf0dc; border-radius: 6px; padding: 7px 10px; margin: 4px 0 0; }

.au-preview { margin: 20px 0 0; padding: 12px 14px; background: #f4f3f9; border-radius: 8px; font-size: 13.5px; color: #4a4863; }
.au-errors { margin: 12px 0 0; padding: 10px 14px 10px 30px; background: #fae7e5; border-radius: 8px; color: #a82e28; font-size: 12.5px; }
.au-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }

@media (max-width: 767px) {
    .au-card { flex-direction: column; align-items: flex-start; }
    .au-builder { padding: 16px; }
    .au-kw { min-width: auto; }
}
</style>
