<template>
    <Teleport to="body">
        <div class="aw-backdrop" @click.self="$emit('close')">
            <div class="ah-card aw sk-editor" role="dialog" aria-modal="true" :aria-label="heading">
                <div class="aw__head">
                    <span class="ah-h3">{{ heading }}</span>
                    <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :aria-label="$t('Ai.cancel')" @click="$emit('close')">
                        <ShellIcon name="x" :size="15" />
                    </button>
                </div>

                <div class="aw__body">
                    <p class="ai-lead">{{ $t('Ai.skill_editor_lead') }}</p>

                    <div class="sk-editor__row">
                        <div class="ah-field">
                            <label class="ah-field__label" for="sk-key">{{ $t('Ai.skill_key') }}</label>
                            <input id="sk-key" v-model.trim="form.key" type="text" class="ah-input ah-mono" :class="{ 'ah-input--error': errorFor('key') }" :disabled="isEdit" :placeholder="$t('Ai.skill_key_hint')" />
                            <span v-if="errorFor('key')" class="ah-field__error">{{ errorFor('key') }}</span>
                        </div>
                        <div class="ah-field">
                            <label class="ah-field__label" for="sk-name">{{ $t('Ai.skill_name') }}</label>
                            <input id="sk-name" v-model.trim="form.name" type="text" class="ah-input" :class="{ 'ah-input--error': errorFor('name') }" />
                            <span v-if="errorFor('name')" class="ah-field__error">{{ errorFor('name') }}</span>
                        </div>
                    </div>

                    <div class="ah-field">
                        <label class="ah-field__label" for="sk-description">{{ $t('Ai.skill_description') }}</label>
                        <input id="sk-description" v-model.trim="form.description" type="text" class="ah-input" />
                    </div>

                    <div class="sk-editor__row">
                        <div class="ah-field">
                            <label class="ah-field__label" for="sk-model">{{ $t('Ai.skill_model_pin') }}</label>
                            <select id="sk-model" v-model="form.model" class="ah-input">
                                <option value="">{{ $t('Ai.skill_model_inherit') }}</option>
                                <option v-for="model in models" :key="model.id || model" :value="model.id || model">{{ model.id || model }}</option>
                            </select>
                            <span class="ah-field__hint">{{ $t('Ai.skill_model_hint') }}</span>
                            <span v-if="errorFor('model')" class="ah-field__error">{{ errorFor('model') }}</span>
                        </div>
                        <div class="ah-field">
                            <label class="ah-field__label" for="sk-risk">{{ $t('Ai.skill_risk_floor') }}</label>
                            <select id="sk-risk" v-model="form.risk" class="ah-input">
                                <option value="">{{ $t('Ai.skill_risk_computed') }}</option>
                                <option v-for="level in catalogues.risks || []" :key="level" :value="level">{{ level }}</option>
                            </select>
                            <span class="ah-field__hint">{{ $t('Ai.skill_risk_hint', { risk: computedRisk }) }}</span>
                        </div>
                    </div>

                    <div class="ah-field">
                        <span class="ah-field__label">{{ $t('Ai.skill_inputs') }}</span>
                        <span class="ah-field__hint">{{ $t('Ai.skill_inputs_hint') }}</span>
                        <label v-for="input in catalogues.inputs || []" :key="input.key" class="sk-editor__check">
                            <input type="checkbox" class="ah-check" :checked="form.inputs.includes(input.key)" @change="toggleInput(input.key)" />
                            <span><b>{{ input.label }}</b> <span class="ah-small">{{ input.description }}</span></span>
                        </label>
                        <span v-if="errorFor('inputs')" class="ah-field__error">{{ errorFor('inputs') }}</span>
                    </div>

                    <div class="ah-field">
                        <span class="ah-field__label">{{ $t('Ai.skill_gather') }}</span>
                        <span class="ah-field__hint">{{ $t('Ai.skill_gather_hint') }}</span>
                        <div v-for="(step, i) in form.gather" :key="`g${i}`" class="sk-editor__step">
                            <select v-model="step.reader" class="ah-input ah-mono" :aria-label="$t('Ai.skill_reader')">
                                <option v-for="reader in catalogues.readers || []" :key="reader.key" :value="reader.key">{{ reader.key }}</option>
                            </select>
                            <input v-model.trim="step.as" type="text" class="ah-input ah-mono" :aria-label="$t('Ai.skill_gather_as')" :placeholder="step.reader" />
                            <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :aria-label="$t('Ai.remove')" @click="form.gather.splice(i, 1)">
                                <ShellIcon name="trash" :size="14" />
                            </button>
                            <p class="ah-small sk-editor__fields">{{ $t('Ai.skill_gather_fields', { fields: fieldsOf(step.reader) }) }}</p>
                            <span v-if="errorFor(`gather[${i}]`)" class="ah-field__error">{{ errorFor(`gather[${i}]`) }}</span>
                        </div>
                        <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="addGather">{{ $t('Ai.skill_add_reader') }}</button>
                    </div>

                    <div class="ah-field">
                        <span class="ah-field__label">{{ $t('Ai.skill_partials') }}</span>
                        <label v-for="partial in catalogues.partials || []" :key="partial.key" class="sk-editor__check">
                            <input type="checkbox" class="ah-check" :checked="form.partials.includes(partial.key)" @change="togglePartial(partial.key)" />
                            <span class="ah-small">{{ partial.text }}</span>
                        </label>
                    </div>

                    <div class="ah-field">
                        <label class="ah-field__label" for="sk-instructions">{{ $t('Ai.skill_instructions') }}</label>
                        <textarea id="sk-instructions" v-model="form.instructions" class="ah-input ah-textarea"></textarea>
                    </div>

                    <div class="ah-field">
                        <label class="ah-field__label" for="sk-template">{{ $t('Ai.skill_template') }}</label>
                        <textarea id="sk-template" v-model="form.template" class="ah-input ah-textarea ah-mono" :class="{ 'ah-input--error': errorFor('prompt.template') }"></textarea>
                        <span class="ah-field__hint">{{ $t('Ai.skill_template_hint', { fields: (catalogues.taskFields || []).join(', ') }) }}</span>
                        <span v-if="errorFor('prompt.template')" class="ah-field__error">{{ errorFor('prompt.template') }}</span>
                    </div>

                    <div class="ah-field">
                        <label class="ah-field__label" for="sk-output">{{ $t('Ai.skill_output') }}</label>
                        <textarea id="sk-output" v-model="form.output" class="ah-input ah-textarea ah-mono" :class="{ 'ah-input--error': errorFor('prompt.output') }"></textarea>
                        <span v-if="errorFor('prompt.output')" class="ah-field__error">{{ errorFor('prompt.output') }}</span>
                    </div>

                    <div class="ah-field">
                        <span class="ah-field__label">{{ $t('Ai.skill_emits') }}</span>
                        <span class="ah-field__hint">{{ $t('Ai.skill_emits_hint') }}</span>
                        <div v-for="(mapping, i) in form.emit" :key="`e${i}`" class="sk-editor__emit">
                            <div class="sk-editor__step">
                                <select v-model="mapping.action" class="ah-input ah-mono" :aria-label="$t('Ai.action')" @change="syncParams(mapping)">
                                    <option v-for="action in catalogues.actions || []" :key="action.key" :value="action.key">{{ action.key }}</option>
                                </select>
                                <input v-model.trim="mapping.each" type="text" class="ah-input ah-mono" :aria-label="$t('Ai.skill_each')" :placeholder="$t('Ai.skill_each_hint')" />
                                <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :aria-label="$t('Ai.remove')" @click="form.emit.splice(i, 1)">
                                    <ShellIcon name="trash" :size="14" />
                                </button>
                            </div>
                            <span class="ah-chip ah-chip--sm" :class="riskChip(riskOfAction(mapping.action))">{{ riskOfAction(mapping.action) }}</span>
                            <div v-for="name in paramNames(mapping)" :key="name" class="ah-field">
                                <label class="ah-field__label" :for="`sk-p${i}-${name}`">{{ name }}</label>
                                <textarea :id="`sk-p${i}-${name}`" v-model="mapping.params[name]" class="ah-input ah-textarea ah-mono"></textarea>
                                <span v-if="errorFor(`emit[${i}].params.${name}`)" class="ah-field__error">{{ errorFor(`emit[${i}].params.${name}`) }}</span>
                            </div>
                            <span v-if="errorFor(`emit[${i}].action`)" class="ah-field__error">{{ errorFor(`emit[${i}].action`) }}</span>
                        </div>
                        <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="addEmit">{{ $t('Ai.skill_add_action') }}</button>
                        <span v-if="errorFor('emit')" class="ah-field__error">{{ errorFor('emit') }}</span>
                    </div>

                    <div class="ah-field">
                        <label class="ah-field__label" for="sk-summary">{{ $t('Ai.skill_summary') }}</label>
                        <textarea id="sk-summary" v-model="form.summary" class="ah-input ah-textarea ah-mono"></textarea>
                    </div>

                    <div class="ah-field">
                        <label class="ah-field__label" for="sk-fallback">{{ $t('Ai.skill_fallback') }}</label>
                        <textarea id="sk-fallback" v-model="form.fallback" class="ah-input ah-textarea ah-mono" :class="{ 'ah-input--error': errorFor('fallback') }"></textarea>
                        <span class="ah-field__hint">{{ $t('Ai.skill_fallback_hint') }}</span>
                        <span v-if="errorFor('fallback')" class="ah-field__error">{{ errorFor('fallback') }}</span>
                    </div>

                    <div class="ah-field">
                        <span class="ah-field__label">{{ $t('Ai.skill_grounded') }}</span>
                        <span class="ah-field__hint">{{ $t('Ai.skill_grounded_hint') }}</span>
                        <div class="sk-editor__row">
                            <input v-model.trim="form.groundedKeys" type="text" class="ah-input ah-mono" :aria-label="$t('Ai.skill_grounded_keys')" :placeholder="$t('Ai.skill_grounded_keys')" />
                            <input v-model.trim="form.groundedNumbers" type="text" class="ah-input ah-mono" :aria-label="$t('Ai.skill_grounded_numbers')" :placeholder="$t('Ai.skill_grounded_numbers')" />
                        </div>
                        <div class="sk-editor__row">
                            <input v-model.trim="form.groundedFields" type="text" class="ah-input ah-mono" :aria-label="$t('Ai.skill_grounded_fields')" :placeholder="$t('Ai.skill_grounded_fields')" />
                            <input v-model.trim="form.groundedMustNameKey" type="text" class="ah-input ah-mono" :aria-label="$t('Ai.skill_grounded_must_name_key')" :placeholder="$t('Ai.skill_grounded_must_name_key')" />
                        </div>
                        <input v-model.trim="form.groundedAllowHours" type="text" class="ah-input ah-mono" :aria-label="$t('Ai.skill_grounded_allow_hours')" :placeholder="$t('Ai.skill_grounded_allow_hours')" />
                        <span v-if="groundedError" class="ah-field__error">{{ groundedError }}</span>
                    </div>

                    <label class="sk-editor__check">
                        <input v-model="form.enabled" type="checkbox" class="ah-check" />
                        <span>{{ $t('Ai.skill_enabled') }}</span>
                    </label>

                    <div v-if="formError" class="ah-field__error">{{ formError }}</div>
                </div>

                <div class="aw__foot">
                    <span class="ah-small">{{ $t('Ai.skill_risk_now', { risk: computedRisk }) }}</span>
                    <div class="ah-toolbar__spacer"></div>
                    <button type="button" class="ah-btn ah-btn--secondary" @click="$emit('close')">{{ $t('Ai.cancel') }}</button>
                    <button type="button" class="ah-btn ah-btn--primary" :disabled="busy" @click="save">
                        {{ busy ? $t('Ai.saving') : $t('Ai.save') }}
                    </button>
                </div>
            </div>
        </div>
    </Teleport>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { useAgents, reasonOf } from "./useAgents";

defineOptions({ name: "SkillEditor" });

const props = defineProps({
    skill: { type: Object, default: null },
    catalogues: { type: Object, default: () => ({}) }
});
const emit = defineEmits(["close", "saved"]);

const { t } = useI18n();
const { createSkill, updateSkill } = useAgents();

const isEdit = computed(() => Boolean(props.skill && props.skill.key));
const heading = computed(() => (isEdit.value ? t("Ai.skill_edit_title", { name: props.skill.name || props.skill.key }) : t("Ai.skill_new_title")));

const busy = ref(false);
const formError = ref("");
const errors = ref([]);
const models = ref([]);

const form = reactive({
    key: props.skill?.key || "",
    name: props.skill?.name || "",
    description: props.skill?.description || "",
    model: props.skill?.model || "",
    risk: props.skill?.risk || "",
    enabled: props.skill?.enabled !== false,
    inputs: [...(props.skill?.inputs || [])],
    gather: (props.skill?.gather || []).map((s) => ({ reader: s.reader, as: s.as || s.reader, params: { ...(s.params || {}) } })),
    partials: [...(props.skill?.prompt?.partials || [])],
    instructions: props.skill?.prompt?.instructions || "",
    template: props.skill?.prompt?.template || "",
    output: props.skill?.prompt?.output || "",
    summary: props.skill?.summary || "",
    fallback: props.skill?.fallback || "",
    groundedKeys: props.skill?.grounded?.keys || "",
    groundedNumbers: props.skill?.grounded?.numbers || "",
    groundedFields: (props.skill?.grounded?.fields || []).join(", "),
    groundedMustNameKey: (props.skill?.grounded?.mustNameKey || []).join(", "),
    groundedAllowHours: (props.skill?.grounded?.allowHours || []).join(", "),
    emit: (props.skill?.emit || []).map((m) => ({ action: m.action, each: m.each || "", params: { ...(m.params || {}) } }))
});

const actionOf = (key) => (props.catalogues.actions || []).find((a) => a.key === key) || null;
const riskOfAction = (key) => actionOf(key)?.risk || "low";
const riskChip = (risk) => (risk === "high" ? "ah-chip--danger" : risk === "medium" ? "ah-chip--warn" : "ah-chip--ok");

const RISK_ORDER = ["low", "medium", "high"];
const computedRisk = computed(() => form.emit.reduce((worst, m) => {
    const risk = riskOfAction(m.action);
    return RISK_ORDER.indexOf(risk) > RISK_ORDER.indexOf(worst) ? risk : worst;
}, "low"));

const fieldsOf = (reader) => ((props.catalogues.readers || []).find((r) => r.key === reader)?.fields || []).join(", ");
const errorFor = (field) => errors.value.find((e) => e.field === field)?.message || "";
const groundedError = computed(() => errors.value.find((e) => e.field.startsWith("grounded"))?.message || "");

const listOf = (value) => String(value || "").split(",").map((v) => v.trim()).filter(Boolean);

/* Only sent when the skill says what the answer is checked against; the
 * validator refuses a half-written clause rather than checking nothing. */
const groundedOf = () => {
    if (!form.groundedKeys && !form.groundedNumbers) return null;
    return {
        ...(form.groundedKeys ? { keys: form.groundedKeys } : {}),
        ...(form.groundedNumbers ? { numbers: form.groundedNumbers } : {}),
        fields: listOf(form.groundedFields),
        mustNameKey: listOf(form.groundedMustNameKey),
        allowHours: listOf(form.groundedAllowHours).map(Number),
    };
};

const toggleInput = (key) => {
    const at = form.inputs.indexOf(key);
    if (at === -1) form.inputs.push(key); else form.inputs.splice(at, 1);
};
const togglePartial = (key) => {
    const at = form.partials.indexOf(key);
    if (at === -1) form.partials.push(key); else form.partials.splice(at, 1);
};

const addGather = () => {
    const first = (props.catalogues.readers || [])[0];
    if (first) form.gather.push({ reader: first.key, as: first.key.replace(/\W/g, "_"), params: {} });
};

const addEmit = () => {
    const first = (props.catalogues.actions || [])[0];
    if (!first) return;
    const mapping = { action: first.key, each: "", params: {} };
    syncParams(mapping);
    form.emit.push(mapping);
};

/* Every parameter the chosen action requires gets a slot, and whatever the
 * skill already set keeps its own. */
function syncParams(mapping) {
    (actionOf(mapping.action)?.required || []).forEach((name) => {
        if (mapping.params[name] === undefined) mapping.params[name] = "";
    });
}
const paramNames = (mapping) => [...new Set([...(actionOf(mapping.action)?.required || []), ...Object.keys(mapping.params)])];

const body = () => ({
    key: form.key,
    name: form.name,
    description: form.description,
    enabled: form.enabled,
    model: form.model || null,
    ...(form.risk ? { risk: form.risk } : {}),
    inputs: [...form.inputs],
    gather: form.gather.map((s) => ({ reader: s.reader, as: s.as || s.reader, params: { ...s.params } })),
    prompt: { partials: [...form.partials], instructions: form.instructions, template: form.template, output: form.output, maxTokens: props.skill?.prompt?.maxTokens || undefined },
    emit: form.emit.map((m) => ({ action: m.action, ...(m.each ? { each: m.each } : {}), params: { ...m.params } })),
    ...(form.summary ? { summary: form.summary } : {}),
    ...(form.fallback ? { fallback: form.fallback } : {}),
    ...(groundedOf() ? { grounded: groundedOf() } : {})
});

const save = async () => {
    busy.value = true;
    formError.value = "";
    errors.value = [];
    try {
        const saved = isEdit.value ? await updateSkill(props.skill.key, body()) : await createSkill(body());
        emit("saved", saved);
    } catch (e) {
        errors.value = e?.errors || [];
        formError.value = e.message;
    } finally {
        busy.value = false;
    }
};

onMounted(async () => {
    const res = await apiRequest("get", `${env.AGENT_MODELS}?configured=true`).catch(() => null);
    models.value = res?.data?.status ? (res.data.data?.models || []) : [];
    if (!form.emit.length) addEmit();
    if (!form.gather.length) addGather();
    formError.value = props.catalogues.inputs ? "" : reasonOf(null, "Ai.load_failed");
});
</script>

<style>
.sk-editor { width: 720px; }
.sk-editor__row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.sk-editor__check { display: flex; align-items: flex-start; gap: 8px; font: var(--text-small); color: var(--ink); }
.sk-editor__step { display: grid; grid-template-columns: 1fr 1fr auto; gap: 8px; align-items: center; }
.sk-editor__fields { grid-column: 1 / -1; margin: 0; }
.sk-editor__emit { display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 1px solid var(--brand-border); border-radius: 9px; background: var(--fill); }
</style>
