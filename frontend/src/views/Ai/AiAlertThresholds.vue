<template>
    <section id="alert-thresholds" class="ah-card ai-thresholds" data-test="alert-thresholds">
        <div class="ai-thresholds__head">
            <div class="ai-thresholds__intro">
                <div class="ah-label">{{ $t('AiAlerts.thresholds_title') }}</div>
                <p class="ah-small">{{ $t('AiAlerts.thresholds_lead') }}</p>
            </div>
            <div class="ai-thresholds__enabled">
                <span class="ah-chip" :class="draft.enabled ? 'ah-chip--ok' : 'ah-chip--mono'" :data-state="draft.enabled ? 'on' : 'off'" data-test="enabled-state">{{ draft.enabled ? $t('AiAlerts.enabled_on') : $t('AiAlerts.enabled_off') }}</span>
                <AhSwitch v-model="draft.enabled" :label="$t('AiAlerts.enabled_label')" :disabled="!loaded" />
            </div>
        </div>

        <p v-if="loadError" class="ah-field__error" data-test="thresholds-load-error">{{ loadError }}</p>
        <div v-else-if="!loaded" class="ah-empty">{{ $t('Ai.loading') }}</div>
        <form v-else class="ai-thresholds__form" :class="{ 'is-off': !draft.enabled }" novalidate @submit.prevent="save">
            <div class="ai-thresholds__grid">
                <fieldset v-for="type in ALERT_TYPES" :key="type" class="ai-thresholds__group" :data-type="type">
                    <legend class="ai-thresholds__legend">
                        <span class="ai-alerts__mark" :class="`ai-alerts__mark--${ALERT_FORMS[type]}`" aria-hidden="true"></span>{{ $t(`AiAlerts.type_${type}`) }}
                    </legend>
                    <label v-for="field in fieldsOf(type)" :key="field.key" class="ai-thresholds__field">
                        <span class="ai-thresholds__label">{{ $t(field.label) }}</span>
                        <input
                            v-model.number="draft[field.key]"
                            type="number"
                            class="ah-input"
                            :class="{ 'is-invalid': errors[field.key] }"
                            :min="field.min"
                            :max="field.max"
                            :step="field.integer ? 1 : 'any'"
                            :data-field="field.key"
                            :aria-invalid="errors[field.key] ? 'true' : 'false'"
                        />
                        <span v-if="errors[field.key]" class="ah-field__error" :data-error="field.key">{{ $t(errors[field.key].key, errors[field.key].params) }}</span>
                        <span v-else class="ah-small">{{ $t(field.help) }}</span>
                    </label>
                </fieldset>
            </div>
            <div class="ai-thresholds__actions">
                <span v-if="saveError" class="ah-field__error" data-test="thresholds-save-error">{{ saveError }}</span>
                <span v-else-if="justSaved" class="ah-chip ah-chip--ok" data-test="thresholds-saved">{{ $t('AiAlerts.saved') }}</span>
                <div class="ah-toolbar__spacer"></div>
                <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" data-test="thresholds-close" @click="emit('close')">{{ $t('AiAlerts.cancel') }}</button>
                <button type="submit" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="busy || !dirty || hasErrors" data-test="thresholds-save">{{ busy ? $t('AiAlerts.saving') : $t('AiAlerts.save') }}</button>
            </div>
        </form>
    </section>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import AhSwitch from "@/components/molecules/Setting/AhSwitch.vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { reasonOf } from "./useAgents";
import { ALERT_DEFAULTS, ALERT_FORMS, ALERT_TYPES, THRESHOLD_FIELDS, alertSettingsOf, changedSettings, thresholdErrors } from "./rateAlerts";

defineOptions({ name: "AiAlertThresholds" });

const emit = defineEmits(["close", "saved"]);
const { t } = useI18n();

const draft = reactive({ ...ALERT_DEFAULTS });
const baseline = ref({ ...ALERT_DEFAULTS });
const loaded = ref(false);
const busy = ref(false);
const loadError = ref("");
const saveError = ref("");
const justSaved = ref(false);

const fieldsOf = (type) => THRESHOLD_FIELDS.filter((field) => field.type === type);
const errors = computed(() => thresholdErrors(draft));
const hasErrors = computed(() => Object.keys(errors.value).length > 0);
const patch = computed(() => changedSettings(draft, baseline.value));
const dirty = computed(() => Object.keys(patch.value).length > 0);

const seed = (alerts) => {
    const settings = alertSettingsOf(alerts);
    Object.assign(draft, settings);
    baseline.value = { ...settings };
};

const load = async () => {
    loadError.value = "";
    try {
        const res = await apiRequest("get", env.AGENT_SETTINGS);
        if (res?.data?.status !== true) throw new Error(res?.data?.statusText || t("AiAlerts.load_settings_failed"));
        seed(res.data.data?.alerts);
        loaded.value = true;
    } catch (e) {
        loadError.value = reasonOf(e, "AiAlerts.load_settings_failed");
    }
};

const save = async () => {
    if (busy.value || !dirty.value || hasErrors.value) return;
    busy.value = true;
    saveError.value = "";
    try {
        const res = await apiRequest("put", env.AGENT_SETTINGS, { alerts: patch.value });
        if (res?.data?.status !== true) throw new Error(res?.data?.statusText || t("AiAlerts.save_error"));
        seed(res.data.data?.alerts);
        justSaved.value = true;
        emit("saved", { ...baseline.value });
    } catch (e) {
        saveError.value = reasonOf(e, "AiAlerts.save_error");
    } finally {
        busy.value = false;
    }
};

watch(draft, () => { justSaved.value = false; });

onMounted(load);
</script>

<style>
@import "./rateAlerts.css";
</style>

<style scoped>
.ai-thresholds { padding: 14px 16px; margin-bottom: 14px; }
.ai-thresholds__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.ai-thresholds__intro p { margin: 4px 0 0; }
.ai-thresholds__enabled { display: flex; align-items: center; gap: 8px; }
.ai-thresholds__form { margin-top: 12px; }
.ai-thresholds__form.is-off .ai-thresholds__grid { opacity: .55; }
.ai-thresholds__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
.ai-thresholds__group { border: 1px solid var(--hairline); border-radius: 8px; padding: 10px 12px; margin: 0; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
.ai-thresholds__legend { display: flex; align-items: center; padding: 0 4px; font: var(--text-label); letter-spacing: .06em; text-transform: uppercase; color: var(--ink-2); }
.ai-thresholds__field { display: flex; flex-direction: column; gap: 4px; }
.ai-thresholds__label { font: var(--text-small); color: var(--ink); }
.ai-thresholds__field .ah-input { max-width: 140px; }
.ai-thresholds__field .ah-input.is-invalid { border-color: var(--danger); box-shadow: inset 3px 0 0 var(--danger); }
.ai-thresholds__actions { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
</style>
