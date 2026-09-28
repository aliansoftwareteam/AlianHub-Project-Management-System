<template>
    <Teleport to="body">
        <div class="aw-backdrop" @click.self="$emit('close')">
            <div class="ah-card aw" role="dialog" aria-modal="true" aria-labelledby="aw-title" @keydown.esc.stop="$emit('close')">
                <div class="aw__head">
                    <span class="ah-avatar ah-avatar--agent"><ShellIcon name="agent" :size="13" /></span>
                    <span id="aw-title" class="ah-h3">{{ $t('Ai.new_agent') }}</span>
                    <span class="ah-chip ah-chip--mono">{{ $t('Ai.step_of', { a: step, b: 3 }) }}</span>
                    <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :aria-label="$t('AgentCatalogue.close')" @click="$emit('close')"><ShellIcon name="x" :size="15" /></button>
                </div>

                <div class="aw__body">
                    <template v-if="step === 1">
                        <div class="ah-field">
                            <label class="ah-field__label" for="aw-name">{{ $t('Ai.job_name') }}</label>
                            <input id="aw-name" ref="nameField" v-model.trim="form.name" type="text" class="ah-input" :class="{ 'ah-input--error': errors.name }" maxlength="80" />
                            <div v-if="errors.name" class="ah-field__error">{{ errors.name }}</div>
                            <p v-if="whyOf('name')" class="ah-small aw__why" data-test="why-name">{{ whyOf('name') }}</p>
                        </div>
                        <div v-if="!props.prefill" class="ah-field">
                            <label class="ah-field__label" for="aw-template">{{ $t('Ai.start_from') }}</label>
                            <select id="aw-template" v-model="chosenSlug" class="ah-input">
                                <option value="">{{ $t('Ai.no_template') }}</option>
                                <option v-for="tpl in startOptions" :key="tpl.slug" :value="tpl.slug">{{ templateName(t, tpl) }} — {{ tpl.skills.map((key) => skillLabel(t, key)).join(', ') }}</option>
                            </select>
                        </div>
                        <div v-else-if="skillKeys.length" class="ah-field">
                            <span class="ah-field__label">{{ $t('AgentCatalogue.skills') }}</span>
                            <div class="aw__skills">
                                <span v-for="key in skillKeys" :key="key" class="ah-chip" :title="skillAbout(t, key)">{{ skillLabel(t, key) }}</span>
                            </div>
                            <p v-if="whyOf('skills')" class="ah-small aw__why" data-test="why-skills">{{ whyOf('skills') }}</p>
                        </div>
                        <ul v-if="requirements.length" class="aw__reqs">
                            <li v-for="code in requirements" :key="code" class="ah-small"><ShellIcon name="info" :size="13" />{{ $t(`Ai.req_${code}`) }}</li>
                        </ul>
                        <div class="ah-field">
                            <label class="ah-field__label" for="aw-desc">{{ $t('Ai.job_desc') }}</label>
                            <textarea id="aw-desc" v-model.trim="form.description" class="ah-input ah-textarea" maxlength="500" :placeholder="$t('Ai.job_desc_hint')"></textarea>
                        </div>
                    </template>

                    <template v-else-if="step === 2">
                        <p class="ai-lead">{{ $t('Ai.actions_lead') }}</p>
                        <p v-if="whyOf('actions')" class="ah-small aw__why" data-test="why-actions">{{ whyOf('actions') }}</p>
                        <p v-if="requirements.length" class="ah-small aw__reqs-line">{{ $t('Ai.needs_line', { what: requirements.map((code) => $t(`Ai.req_${code}`)).join(' · ') }) }}</p>
                        <div class="aw__actions">
                            <label v-for="action in writeActions" :key="action.key" class="aw__action" :title="action.key">
                                <input v-model="form.allowedActions" type="checkbox" :value="action.key" class="ah-check" />
                                <span class="aw__action-label">{{ actionLabel(t, action) }}</span>
                                <span v-if="action.risk !== 'low'" class="ah-chip ah-chip--warn">{{ riskLabel(action.risk) }}</span>
                            </label>
                        </div>
                        <p class="ai-never">
                            <strong>{{ $t('Ai.never_label') }}</strong>
                            <span>{{ never }}</span>
                        </p>
                    </template>

                    <template v-else>
                        <div class="ah-field">
                            <span class="ah-field__label">{{ $t('Ai.autonomy') }}</span>
                            <div class="ai-radios">
                                <label v-for="level in WIZARD_LEVELS" :key="level" class="ai-radio" :class="{ 'is-on': form.autonomy === level }" :title="autonomyTip(t, level)">
                                    <input v-model.number="form.autonomy" type="radio" :value="level" class="ah-check" />
                                    <span class="aw__level"><strong>{{ autonomyName(t, level) }}</strong><span class="ah-small">{{ autonomyAbout(t, level) }}</span></span>
                                </label>
                            </div>
                            <span class="ah-field__hint">{{ $t('Ai.start_suggesting') }}</span>
                            <p v-if="whyOf('autonomy')" class="ah-small aw__why" data-test="why-autonomy">{{ whyOf('autonomy') }}</p>
                            <p v-if="props.prefill && props.prefill.cadence" class="ah-small aw__why" data-test="wizard-cadence">{{ $t(`AgentCatalogue.cadence_${props.prefill.cadence}`) }} · {{ $t('AgentCatalogue.schedule_later') }}</p>
                        </div>
                        <div class="ah-field">
                            <span class="ah-field__label">{{ $t('Ai.scope') }}</span>
                            <div v-if="projects.length" class="ai-radios">
                                <label v-for="p in projects" :key="p._id" class="ai-radio" :class="{ 'is-on': form.projectIds.includes(String(p._id)) }">
                                    <input v-model="form.projectIds" type="checkbox" :value="String(p._id)" class="ah-check" />
                                    <span>{{ p.ProjectName }}</span>
                                </label>
                            </div>
                            <span v-else class="ah-field__hint">{{ $t('Ai.scope_no_projects') }}</span>
                            <span class="ah-field__hint">{{ $t('Ai.scope_lead') }}</span>
                            <p v-if="whyOf('scope')" class="ah-small aw__why" data-test="why-scope">{{ whyOf('scope') }}</p>
                        </div>
                        <div class="ah-field">
                            <label class="ah-field__label" for="aw-cap">{{ $t('Ai.spend_cap') }}</label>
                            <input id="aw-cap" v-model.number="form.spendCapUsd" type="number" min="0" step="1" class="ah-input" />
                            <p v-if="whyOf('spendCap')" class="ah-small aw__why" data-test="why-spendCap">{{ whyOf('spendCap') }}</p>
                        </div>
                    </template>

                    <div v-if="errors.form" class="ah-field__error">{{ errors.form }}</div>
                </div>

                <div class="aw__foot">
                    <button v-if="step > 1" type="button" class="ah-btn ah-btn--ghost" @click="step -= 1">{{ $t('Ai.back') }}</button>
                    <div class="ah-toolbar__spacer"></div>
                    <button type="button" class="ah-btn ah-btn--secondary" @click="$emit('close')">{{ $t('Ai.cancel') }}</button>
                    <button v-if="step < 3" type="button" class="ah-btn ah-btn--primary" @click="next">{{ $t('Ai.next') }}</button>
                    <button v-else type="button" class="ah-btn ah-btn--primary" :disabled="busy" @click="create">{{ busy ? $t('Ai.creating') : $t('Ai.create_agent') }}</button>
                </div>
            </div>
        </div>
    </Teleport>
</template>

<script setup>
import { computed, nextTick, onMounted, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { useAgents, NEW_AGENT_DEFAULTS } from "./useAgents";
import { selectableTemplates, templateName } from "./agentCatalogue";
import { requirementsOf, indexSkills } from "./skillInputs";
import { actionLabel, autonomyAbout, autonomyName, autonomyTip, skillAbout, skillLabel } from "./plainLabels";

defineOptions({ name: "AgentWizard" });

const props = defineProps({ prefill: { type: Object, default: null } });
const emit = defineEmits(["close", "created"]);

const WIZARD_LEVELS = [0, 1, 2];

const { t } = useI18n();
const { getters } = useStore();
const { registryManifest, loadRegistry, saveAgent, skillManifest, loadSkills } = useAgents();
const projects = computed(() => (getters["projectData/projects"]?.data || []).filter((p) => !p.deletedStatusKey));

const step = ref(1);
const chosenSlug = ref("");
const skillIndex = computed(() => indexSkills(skillManifest.value));
const startOptions = computed(() => selectableTemplates(skillManifest.value));
const chosenTemplate = computed(() => startOptions.value.find((tpl) => tpl.slug === chosenSlug.value) || null);
const skillKeys = computed(() => (props.prefill ? props.prefill.skills || [] : [...(chosenTemplate.value?.skills || [])]));
const requirements = computed(() => (skillKeys.value.length ? requirementsOf({ skills: skillKeys.value }, skillIndex.value) : []));
const busy = ref(false);
const nameField = ref(null);
const errors = reactive({ name: "", form: "" });

const openProjectIds = (ids) => {
    const open = new Set(projects.value.map((p) => String(p._id)));
    return (ids || []).map(String).filter((id) => open.has(id));
};

const initialForm = (prefill) => ({
    name: prefill ? String(prefill.name || "") : "",
    description: prefill ? String(prefill.description || "") : "",
    allowedActions: [...(prefill?.allowedActions?.length ? prefill.allowedActions : NEW_AGENT_DEFAULTS.allowedActions)],
    autonomy: prefill && WIZARD_LEVELS.includes(prefill.autonomy) ? prefill.autonomy : NEW_AGENT_DEFAULTS.autonomy,
    spendCapUsd: Number(prefill?.spendCapUsd) > 0 ? Number(prefill.spendCapUsd) : NEW_AGENT_DEFAULTS.spendCapUsd,
    projectIds: prefill ? openProjectIds(prefill.projectIds) : [...NEW_AGENT_DEFAULTS.projectIds]
});
const form = reactive(initialForm(props.prefill));

watch(chosenTemplate, (tpl) => {
    form.allowedActions = [...(tpl ? tpl.actions : NEW_AGENT_DEFAULTS.allowedActions)];
});

const whyOf = (field) => {
    const prefill = props.prefill;
    if (!prefill) return "";
    if ((prefill.adjusted || []).includes(field)) return t(`AgentCatalogue.why_adjusted_${field}`);
    return (prefill.why && prefill.why[field]) || "";
};

const writeActions = computed(() => (registryManifest.value.actions || []).filter((a) => !a.proposeOnly));
const never = computed(() => (registryManifest.value.never || []).map((key) => actionLabel(t, key)).join(" · "));
const riskLabel = (risk) => t(`Ai.risk_level_${risk === "high" ? "high" : "medium"}`);

const next = () => {
    errors.name = "";
    if (step.value === 1 && !form.name) {
        errors.name = t("Ai.name_required");
        return;
    }
    step.value += 1;
};

const create = async () => {
    busy.value = true;
    errors.form = "";
    try {
        await saveAgent({
            name: form.name,
            description: form.description,
            allowedActions: form.allowedActions,
            autonomy: form.autonomy,
            spendCapUsd: form.spendCapUsd,
            projectIds: form.projectIds,
            skills: skillKeys.value.map((key) => ({ key, name: key, actions: form.allowedActions, enabled: true }))
        });
        emit("created");
    } catch (e) {
        errors.form = e.message;
    } finally {
        busy.value = false;
    }
};

/* A prefill comes from a model or a template: keep only actions the checkboxes can show. */
const keepOfferedActions = () => {
    const offered = new Set(writeActions.value.map((a) => a.key));
    if (props.prefill && offered.size) form.allowedActions = form.allowedActions.filter((key) => offered.has(key));
};

onMounted(async () => {
    await Promise.all([loadRegistry(), loadSkills().catch(() => [])]);
    keepOfferedActions();
    await nextTick();
    nameField.value?.focus();
});
</script>

<style>
@import "./style.css";
.aw__actions { display: flex; flex-direction: column; gap: 6px; max-height: 300px; overflow: auto; }
.aw__reqs { list-style: none; margin: -6px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.aw__reqs li { display: flex; align-items: center; gap: 6px; color: var(--ink-2); }
.aw__reqs-line { margin: -8px 0 0; color: var(--ink-2); }
.aw__action { display: flex; align-items: center; gap: 10px; padding: 9px 11px; border: 1px solid var(--hairline); border-radius: 9px; cursor: pointer; }
.aw__action-label { flex: 1; min-width: 0; }
.aw__level { display: flex; flex-direction: column; gap: 2px; }
.aw__skills { display: flex; flex-wrap: wrap; gap: 4px; }
.aw__why { margin: 2px 0 0; color: var(--ink-2); }
</style>
