<template>
    <div class="afp">
        <div class="ah-field">
            <label class="ah-field__label" for="ai-field-title">{{ $t('Fields.field_label') }}</label>
            <input
                id="ai-field-title"
                :value="modelValue.fieldTitle"
                type="text"
                class="ah-input"
                :class="{ 'ah-input--error': errors.fieldTitle }"
                :placeholder="$t('Fields.field_label_placeholder')"
                @input="set({ fieldTitle: $event.target.value })"
            />
            <span v-if="errors.fieldTitle" class="ah-field__error">{{ errors.fieldTitle }}</span>
        </div>

        <div class="ah-field">
            <span :id="`${uid}-output`" class="ah-field__label">{{ $t('AiFields.output') }}</span>
            <div class="fb__seg afp__outputs" role="group" :aria-labelledby="`${uid}-output`">
                <button
                    v-for="output in AI_OUTPUTS"
                    :key="output"
                    type="button"
                    :data-ai-output="output"
                    :class="{ 'is-active': modelValue.output === output }"
                    :aria-pressed="modelValue.output === output ? 'true' : 'false'"
                    @click="setOutput(output)"
                >{{ $t(`AiFields.output_${output}`) }}</button>
            </div>
        </div>

        <div class="ah-field">
            <span :id="`${uid}-template`" class="ah-field__label">{{ $t('AiFields.template') }}</span>
            <div class="afp__templates" role="group" :aria-labelledby="`${uid}-template`">
                <button
                    v-for="template in templates"
                    :key="template"
                    type="button"
                    class="afp__template"
                    :data-ai-template="template"
                    :class="{ 'is-active': modelValue.template === template }"
                    :aria-pressed="modelValue.template === template ? 'true' : 'false'"
                    @click="set({ template })"
                >
                    <strong>{{ $t(`AiFields.template_${template}`) }}</strong>
                    <span>{{ $t(`AiFields.template_${template}_hint`) }}</span>
                </button>
            </div>
            <span v-if="errors.template" class="ah-field__error">{{ errors.template }}</span>
        </div>

        <div v-if="modelValue.template === 'translation'" class="ah-field">
            <label class="ah-field__label" for="ai-field-language">{{ $t('AiFields.language') }}</label>
            <input
                id="ai-field-language"
                :value="modelValue.language"
                type="text"
                class="ah-input"
                maxlength="40"
                :class="{ 'ah-input--error': errors.language }"
                :placeholder="$t('AiFields.language_placeholder')"
                @input="set({ language: $event.target.value })"
            />
            <span v-if="errors.language" class="ah-field__error">{{ errors.language }}</span>
        </div>

        <div class="ah-field">
            <label class="ah-field__label" for="ai-field-prompt">{{ modelValue.template === 'custom' ? $t('AiFields.prompt_required') : $t('AiFields.prompt_optional') }}</label>
            <textarea
                id="ai-field-prompt"
                :value="modelValue.prompt"
                class="ah-input afp__prompt"
                maxlength="1000"
                rows="3"
                :class="{ 'ah-input--error': errors.prompt }"
                :placeholder="$t('AiFields.prompt_placeholder')"
                @input="set({ prompt: $event.target.value })"
            ></textarea>
            <span v-if="errors.prompt" class="ah-field__error">{{ errors.prompt }}</span>
        </div>

        <fieldset v-if="modelValue.output === 'number'" class="afp__group">
            <legend class="ah-field__label">{{ $t('AiFields.number_settings') }}</legend>
            <div class="afp__numbers">
                <div class="ah-field">
                    <label class="ah-field__label" for="ai-field-min">{{ $t('AiFields.min') }}</label>
                    <input
                        id="ai-field-min"
                        :value="modelValue.min"
                        type="text"
                        inputmode="decimal"
                        class="ah-input"
                        :class="{ 'ah-input--error': errors.range }"
                        :placeholder="$t('AiFields.no_limit')"
                        @input="set({ min: $event.target.value })"
                    />
                </div>
                <div class="ah-field">
                    <label class="ah-field__label" for="ai-field-max">{{ $t('AiFields.max') }}</label>
                    <input
                        id="ai-field-max"
                        :value="modelValue.max"
                        type="text"
                        inputmode="decimal"
                        class="ah-input"
                        :class="{ 'ah-input--error': errors.range }"
                        :placeholder="$t('AiFields.no_limit')"
                        @input="set({ max: $event.target.value })"
                    />
                </div>
                <div class="ah-field">
                    <label class="ah-field__label" for="ai-field-decimals">{{ $t('AiFields.decimals') }}</label>
                    <input
                        id="ai-field-decimals"
                        :value="modelValue.decimals"
                        type="text"
                        inputmode="numeric"
                        class="ah-input"
                        :class="{ 'ah-input--error': errors.decimals }"
                        :placeholder="$t('AiFields.decimals_any')"
                        @input="set({ decimals: $event.target.value })"
                    />
                </div>
            </div>
            <span v-if="errors.range" class="ah-field__error">{{ errors.range }}</span>
            <span v-if="errors.decimals" class="ah-field__error">{{ errors.decimals }}</span>
            <span :id="`${uid}-range`" class="ah-field__label">{{ $t('AiFields.out_of_range') }}</span>
            <div class="fb__seg" role="group" :aria-labelledby="`${uid}-range`">
                <button
                    v-for="choice in OUT_OF_RANGE"
                    :key="choice"
                    type="button"
                    :data-ai-out-of-range="choice"
                    :class="{ 'is-active': modelValue.outOfRange === choice }"
                    :aria-pressed="modelValue.outOfRange === choice ? 'true' : 'false'"
                    @click="set({ outOfRange: choice })"
                >{{ $t(`AiFields.out_of_range_${choice}`) }}</button>
            </div>
            <p class="afp__hint">{{ $t(`AiFields.out_of_range_${modelValue.outOfRange === 'reject' ? 'reject' : 'clamp'}_hint`) }}</p>
        </fieldset>

        <p v-if="modelValue.output === 'rating'" class="afp__hint">{{ $t('AiFields.rating_hint', { max: RATING_MAX }) }}</p>

        <div v-if="modelValue.output === 'date'" class="ah-field">
            <label class="ah-field__label" for="ai-field-date-rule">{{ $t('AiFields.date_rule') }}</label>
            <select id="ai-field-date-rule" :value="modelValue.dateRule" class="ah-input" @change="set({ dateRule: $event.target.value })">
                <option v-for="rule in DATE_RULES" :key="rule || 'none'" :value="rule">{{ $t(`AiFields.date_rule_${rule || 'none'}`) }}</option>
            </select>
            <p class="afp__hint">{{ $t('AiFields.date_hint') }}</p>
        </div>

        <fieldset v-if="OPTION_OUTPUTS.includes(modelValue.output)" class="afp__group">
            <legend class="ah-field__label">{{ $t('AiFields.options') }}</legend>
            <p class="afp__hint">{{ modelValue.output === 'labels' ? $t('AiFields.labels_hint') : $t('AiFields.options_hint') }}</p>
            <div v-for="(option, index) in modelValue.options" :key="option.id || index" class="afp__option">
                <input
                    :value="option.label"
                    type="text"
                    class="ah-input"
                    :aria-label="$t('AiFields.option_label', { n: index + 1 })"
                    @input="setOption(index, $event.target.value)"
                />
                <button type="button" class="afp__remove" :aria-label="$t('AiFields.option_remove', { n: index + 1 })" @click="removeOption(index)">
                    <ShellIcon name="x" :size="12" aria-hidden="true" />
                </button>
            </div>
            <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm afp__add" @click="addOption">
                <ShellIcon name="plus" :size="12" aria-hidden="true" /> {{ $t('AiFields.option_add') }}
            </button>
            <span v-if="errors.options" class="ah-field__error">{{ errors.options }}</span>
        </fieldset>

        <fieldset class="afp__group">
            <legend class="ah-field__label">{{ $t('AiFields.reads') }}</legend>
            <label v-for="part in AI_READ_PARTS" :key="part" class="afp__check">
                <input type="checkbox" class="ah-check" :checked="modelValue.reads.includes(part)" :data-ai-read="part" @change="toggleRead(part, $event.target.checked)" />
                <span>{{ $t(`AiFields.read_${part}`) }}</span>
            </label>
            <span v-if="errors.reads" class="ah-field__error">{{ errors.reads }}</span>
        </fieldset>

        <label class="afp__check">
            <input type="checkbox" class="ah-check" :checked="modelValue.autoRefill" data-ai-auto-refill @change="set({ autoRefill: $event.target.checked })" />
            <span>{{ $t('AiFields.auto_refill') }}</span>
        </label>
        <p class="afp__hint">{{ $t('AiFields.auto_refill_hint') }}</p>
    </div>
</template>

<script setup>
import { computed } from "vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { AI_OUTPUTS, AI_READ_PARTS, DATE_RULES, OPTION_OUTPUTS, RATING_MAX, templatesFor } from "@/views/Projects/composables/aiFields";

defineOptions({ name: "AiFieldPanel" });

const props = defineProps({
    modelValue: { type: Object, required: true },
    errors: { type: Object, default: () => ({}) }
});
const emit = defineEmits(["update:modelValue"]);

const uid = "ai-field-panel";
const OUT_OF_RANGE = ["clamp", "reject"];
const templates = computed(() => templatesFor(props.modelValue.output));

const set = (patch) => emit("update:modelValue", { ...props.modelValue, ...patch });

function setOutput(output) {
    const allowed = templatesFor(output);
    const template = allowed.includes(props.modelValue.template) && props.modelValue.template !== "custom" ? props.modelValue.template : allowed[0];
    const needsOptions = OPTION_OUTPUTS.includes(output) && !props.modelValue.options.length;
    set({ output, template, options: needsOptions ? [{ id: "", label: "" }] : props.modelValue.options });
}

function setOption(index, label) {
    set({ options: props.modelValue.options.map((option, at) => (at === index ? { ...option, label } : option)) });
}

const addOption = () => set({ options: [...props.modelValue.options, { id: "", label: "" }] });

const removeOption = (index) => set({ options: props.modelValue.options.filter((_, at) => at !== index) });

function toggleRead(part, on) {
    const reads = on ? [...new Set([...props.modelValue.reads, part])] : props.modelValue.reads.filter((read) => read !== part);
    set({ reads: AI_READ_PARTS.filter((read) => reads.includes(read)) });
}
</script>

<style scoped>
@import "./style.css";

.afp { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.afp__outputs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
.afp__outputs button { padding: 7px 4px; overflow-wrap: anywhere; }
.afp__numbers { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.afp__numbers .ah-field { min-width: 0; }
.afp__numbers .ah-input { width: 100%; min-width: 0; box-sizing: border-box; }
.afp__templates { display: grid; grid-template-columns: minmax(0, 1fr); gap: 5px; }
.afp__template {
    display: flex; flex-direction: column; gap: 2px;
    padding: 7px 10px; border: 1px solid var(--border); border-radius: 8px;
    background: var(--surface); color: var(--ink); text-align: start; font: var(--text-body); cursor: pointer;
}
.afp__template span { font-size: 11.5px; color: var(--ink-label); }
.afp__template.is-active { border: 1.5px solid var(--brand); background: var(--brand-tint); }
.afp__template.is-active strong { color: var(--brand); }
.afp__template:focus-visible, .fb__seg button:focus-visible, .afp__remove:focus-visible { outline: none; box-shadow: var(--focus); }
.afp__prompt { min-height: 64px; resize: vertical; }
.afp__group { display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 0; border: 0; min-width: 0; }
.afp__check { display: inline-flex; align-items: center; gap: 8px; margin: 0; color: var(--ink); font: var(--text-body); cursor: pointer; }
.afp__hint { margin: 0; font-size: 11.5px; color: var(--ink-label); line-height: 1.45; }
.afp__option { display: flex; align-items: center; gap: 6px; }
.afp__option .ah-input { flex: 1; min-width: 0; }
.afp__remove {
    display: inline-flex; align-items: center; justify-content: center; flex: none;
    width: 28px; height: 28px; border: 0; border-radius: 6px; background: none; color: var(--ink-2); cursor: pointer;
}
.afp__remove:hover { background: var(--surface-hover); color: var(--danger); }
.afp__add { align-self: flex-start; }
</style>
