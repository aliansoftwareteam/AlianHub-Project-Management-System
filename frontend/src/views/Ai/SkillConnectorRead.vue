<template>
    <div class="sk-read" data-test="connector-read">
        <p class="ah-small sk-read__lead">{{ $t('Ai.skill_connector_read_lead', { app }) }}</p>

        <div v-for="field in fields" :key="field.name" class="ah-field">
            <label v-if="field.type === 'boolean'" class="sk-editor__check">
                <input :id="`${id}-${field.name}`" type="checkbox" class="ah-check" :checked="params[field.name] ?? field.default === true" :data-test="`connector-param-${field.name}`" @change="set(field.name, $event.target.checked)" />
                <span class="ah-mono">{{ field.name }}</span>
            </label>
            <template v-else>
                <label class="ah-field__label ah-mono" :for="`${id}-${field.name}`">{{ field.name }}</label>
                <input
                    v-if="field.type === 'string'"
                    :id="`${id}-${field.name}`"
                    :value="params[field.name] ?? ''"
                    type="text"
                    class="ah-input ah-mono"
                    :class="{ 'ah-input--error': errorAt(field.name) }"
                    :maxlength="field.maxLength"
                    :data-test="`connector-param-${field.name}`"
                    autocomplete="off"
                    spellcheck="false"
                    @input="set(field.name, $event.target.value)"
                />
                <input
                    v-else
                    :id="`${id}-${field.name}`"
                    :value="params[field.name] ?? ''"
                    type="number"
                    class="ah-input ah-mono"
                    :class="{ 'ah-input--error': errorAt(field.name) }"
                    :min="field.min"
                    :max="field.max"
                    :step="field.type === 'integer' ? 1 : 'any'"
                    :placeholder="field.default === undefined ? '' : String(field.default)"
                    :data-test="`connector-param-${field.name}`"
                    @input="setNumber(field.name, $event.target.value)"
                />
                <span class="ah-field__hint">{{ hintOf(field) }}</span>
            </template>
            <span v-if="errorAt(field.name)" class="ah-field__error" :data-test="`connector-param-error-${field.name}`">{{ errorAt(field.name) }}</span>
        </div>

        <label class="sk-editor__check">
            <input type="checkbox" class="ah-check" :checked="optional" data-test="connector-read-optional" @change="$emit('optional', $event.target.checked)" />
            <span><b>{{ $t('Ai.skill_connector_read_optional') }}</b> <span class="ah-small">{{ $t('Ai.skill_connector_read_optional_hint', { name: as }) }}</span></span>
        </label>
        <span v-if="errorFor(`gather[${index}].optional`)" class="ah-field__error">{{ errorFor(`gather[${index}].optional`) }}</span>
    </div>
</template>

<script setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { connectorParamsOf } from "./declaredReads";

defineOptions({ name: "SkillConnectorRead" });

const props = defineProps({
    index: { type: Number, required: true },
    reader: { type: Object, required: true },
    params: { type: Object, required: true },
    optional: { type: Boolean, default: false },
    as: { type: String, default: "" },
    errorFor: { type: Function, default: () => "" }
});
const emit = defineEmits(["set", "optional"]);

const { t } = useI18n();

const id = computed(() => `sk-conn${props.index}`);
const app = computed(() => props.reader.connectorName || props.reader.connector || "");
const fields = computed(() => connectorParamsOf(props.reader));

const errorAt = (name) => props.errorFor(`gather[${props.index}].params.${name}`);

const hintOf = (field) => {
    const range = field.type === "string" ? t("Ai.skill_connector_param_text", { max: field.maxLength }) : t("Ai.skill_read_cap_range", { min: field.min, max: field.max });
    return field.required ? t("Ai.skill_connector_param_required", { range }) : range;
};

const set = (name, value) => emit("set", name, value);
const setNumber = (name, text) => set(name, text === "" ? "" : Number(text));
</script>
