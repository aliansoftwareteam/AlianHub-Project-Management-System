<template>
    <Teleport to="body">
        <div class="aw-backdrop" @click.self="$emit('close')">
            <div class="ah-card aw" role="dialog" aria-modal="true">
                <div class="aw__head">
                    <span class="ah-avatar ah-avatar--agent"><ShellIcon name="agent" :size="13" /></span>
                    <span class="ah-h3">{{ $t('Ai.new_agent') }}</span>
                    <span class="ah-chip ah-chip--mono">{{ $t('Ai.step_of', { a: step, b: 3 }) }}</span>
                    <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" @click="$emit('close')"><ShellIcon name="x" :size="15" /></button>
                </div>

                <div class="aw__body">
                    <template v-if="step === 1">
                        <div class="ah-field">
                            <label class="ah-field__label" for="aw-name">{{ $t('Ai.job_name') }}</label>
                            <input id="aw-name" ref="nameField" v-model.trim="form.name" type="text" class="ah-input" :class="{ 'ah-input--error': errors.name }" maxlength="80" />
                            <div v-if="errors.name" class="ah-field__error">{{ errors.name }}</div>
                        </div>
                        <div v-if="!props.template" class="ah-field">
                            <label class="ah-field__label" for="aw-template">{{ $t('Ai.start_from') }}</label>
                            <select id="aw-template" v-model="chosenSlug" class="ah-input">
                                <option value="">{{ $t('Ai.no_template') }}</option>
                                <option v-for="tpl in AGENT_TEMPLATES" :key="tpl.slug" :value="tpl.slug">{{ tpl.name }} — {{ tpl.skills.join(', ') }}</option>
                            </select>
                        </div>
                        <div class="ah-field">
                            <label class="ah-field__label" for="aw-desc">{{ $t('Ai.job_desc') }}</label>
                            <textarea id="aw-desc" v-model.trim="form.description" class="ah-input ah-textarea" maxlength="500" :placeholder="$t('Ai.job_desc_hint')"></textarea>
                        </div>
                    </template>

                    <template v-else-if="step === 2">
                        <p class="ai-lead">{{ $t('Ai.actions_lead') }}</p>
                        <div class="aw__actions">
                            <label v-for="action in writeActions" :key="action.key" class="aw__action">
                                <input v-model="form.allowedActions" type="checkbox" :value="action.key" class="ah-check" />
                                <span class="aw__action-label">
                                    <span class="ah-mono">{{ action.key }}</span>
                                    <span class="ah-small">{{ action.label }}</span>
                                </span>
                                <span v-if="action.risk !== 'low'" class="ah-chip ah-chip--warn">{{ action.risk }}</span>
                            </label>
                        </div>
                        <p class="ai-never">
                            <strong>{{ $t('Ai.never_label') }}</strong>
                            <span class="ah-mono">{{ never }}</span>
                        </p>
                    </template>

                    <template v-else>
                        <div class="ah-field">
                            <span class="ah-field__label">{{ $t('Ai.autonomy') }}</span>
                            <div class="ai-radios">
                                <label v-for="level in [0, 1, 2]" :key="level" class="ai-radio" :class="{ 'is-on': form.autonomy === level }">
                                    <input v-model.number="form.autonomy" type="radio" :value="level" class="ah-check" />
                                    <span><strong>L{{ level }}</strong> · {{ $t(`Ai.autonomy_${level}`) }}</span>
                                </label>
                            </div>
                            <span class="ah-field__hint">{{ $t('Ai.start_low') }}</span>
                        </div>
                        <div class="ah-field">
                            <label class="ah-field__label" for="aw-cap">{{ $t('Ai.spend_cap') }}</label>
                            <input id="aw-cap" v-model.number="form.spendCapUsd" type="number" min="0" step="1" class="ah-input" />
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
import { computed, defineEmits, defineProps, nextTick, onMounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { useAgents } from "./useAgents";

defineOptions({ name: "AgentWizard" });
import { AGENT_TEMPLATES } from "./agentTemplates";

const props = defineProps({ template: { type: Object, default: null } });
const emit = defineEmits(["close", "created"]);

const { t } = useI18n();
const { registryManifest, loadRegistry, saveAgent } = useAgents();

const step = ref(1);
const chosenSlug = ref("");
const effectiveTemplate = computed(() => props.template || AGENT_TEMPLATES.find((t) => t.slug === chosenSlug.value) || null);
const busy = ref(false);
const nameField = ref(null);
const errors = reactive({ name: "", form: "" });
const form = reactive({
    name: props.template ? props.template.name : "",
    description: "",
    allowedActions: ["task.comment", "tasks.search", "task.get"],
    autonomy: 1,
    spendCapUsd: 30
});

const writeActions = computed(() => (registryManifest.value.actions || []).filter((a) => !a.proposeOnly));
const never = computed(() => (registryManifest.value.never || []).join(" · "));

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
            skills: (effectiveTemplate.value?.skills || []).map((key) => ({ key, name: key, actions: form.allowedActions, enabled: true }))
        });
        emit("created");
    } catch (e) {
        errors.form = e.message;
    } finally {
        busy.value = false;
    }
};

onMounted(async () => {
    await loadRegistry();
    await nextTick();
    nameField.value?.focus();
});
</script>

<style>
.aw-backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, .45); z-index: 70; display: flex; align-items: center; justify-content: center; padding: 20px; }
.aw { width: 560px; max-width: 100%; max-height: 86dvh; display: flex; flex-direction: column; border-radius: var(--r-modal); box-shadow: var(--shadow-modal); }
.aw__head { display: flex; align-items: center; gap: 10px; padding: 14px 16px; border-bottom: 1px solid var(--hairline); }
.aw__head .ah-btn { margin-left: auto; }
.aw__body { padding: 16px; overflow: auto; display: flex; flex-direction: column; gap: 14px; }
.aw__foot { display: flex; align-items: center; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--hairline); }
.aw__actions { display: flex; flex-direction: column; gap: 6px; max-height: 300px; overflow: auto; }
.aw__action { display: flex; align-items: center; gap: 10px; padding: 9px 11px; border: 1px solid var(--hairline); border-radius: 9px; cursor: pointer; }
.aw__action-label { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
</style>
