<template>
    <form ref="root" class="gtf" data-test="gtf" :aria-label="$t(target ? 'Goals.edit_target_title' : 'Goals.new_target')" novalidate @submit.prevent="submit" @keydown.esc.stop="$emit('cancel')">
        <label v-if="!target" class="ah-field gtf__kind">
            <span class="ah-field__label">{{ $t('Goals.kind') }}</span>
            <select v-model="form.kind" class="ah-input" data-test="gtf-kind" @change="clear('kind')">
                <option v-for="kind in KINDS" :key="kind" :value="kind">{{ $t(`Goals.kind_${kind}`) }}</option>
            </select>
        </label>
        <p v-else class="gtf__fixed">{{ $t(`Goals.kind_${target.kind}`) }} · {{ $t('Goals.kind_fixed') }}</p>

        <label class="ah-field gtf__name">
            <span class="ah-field__label">{{ $t('Goals.target_name') }}</span>
            <input v-model="form.name" type="text" class="ah-input" :maxlength="LIMITS.name" data-test="gtf-name" v-bind="state('name')" @input="clear('name')" />
            <span v-if="errors.name" :id="idOf('name')" class="ah-field__error" role="alert" data-error-for="name">{{ errors.name }}</span>
        </label>

        <template v-if="measured">
            <label class="ah-field">
                <span class="ah-field__label">{{ $t('Goals.start') }}</span>
                <input v-model="form.start" type="number" step="any" inputmode="decimal" class="ah-input" placeholder="0" data-test="gtf-start" v-bind="state('start')" @input="clear('start')" />
                <span v-if="errors.start" :id="idOf('start')" class="ah-field__error" role="alert" data-error-for="start">{{ errors.start }}</span>
            </label>
            <label class="ah-field">
                <span class="ah-field__label">{{ $t('Goals.target') }}</span>
                <input v-model="form.target" type="number" step="any" inputmode="decimal" class="ah-input" data-test="gtf-target" v-bind="state('target')" @input="clear('target')" />
                <span v-if="errors.target" :id="idOf('target')" class="ah-field__error" role="alert" data-error-for="target">{{ errors.target }}</span>
            </label>
            <label v-if="!target" class="ah-field">
                <span class="ah-field__label">{{ $t('Goals.current') }}</span>
                <input v-model="form.current" type="number" step="any" inputmode="decimal" class="ah-input" data-test="gtf-current" v-bind="state('current')" @input="clear('current')" />
                <span v-if="errors.current" :id="idOf('current')" class="ah-field__error" role="alert" data-error-for="current">{{ errors.current }}</span>
                <span v-else class="ah-field__hint">{{ $t('Goals.current_hint') }}</span>
            </label>
            <label v-if="kind === 'currency'" class="ah-field">
                <span class="ah-field__label">{{ $t('Goals.currency') }}</span>
                <select v-model="form.currencyCode" class="ah-input" data-test="gtf-currency" v-bind="state('currencyCode')" @change="clear('currencyCode')">
                    <option value="">{{ $t('Goals.currency_pick') }}</option>
                    <option v-for="currency in currencies" :key="currency.code" :value="currency.code">{{ currency.label }}</option>
                </select>
                <span v-if="errors.currencyCode" :id="idOf('currencyCode')" class="ah-field__error" role="alert" data-error-for="currencyCode">{{ errors.currencyCode }}</span>
            </label>
            <label v-else class="ah-field">
                <span class="ah-field__label">{{ $t('Goals.unit') }}</span>
                <input v-model="form.unit" type="text" class="ah-input" :maxlength="LIMITS.unit" :placeholder="$t('Goals.unit_placeholder')" data-test="gtf-unit" v-bind="state('unit')" @input="clear('unit')" />
                <span v-if="errors.unit" :id="idOf('unit')" class="ah-field__error" role="alert" data-error-for="unit">{{ errors.unit }}</span>
            </label>
        </template>

        <div v-if="kind === TASKS" class="gtf__sources">
            <GoalSourcePicker :model-value="form.sources" :names="target?.sourceNames" :refused="refused" :error="errors.sources" :error-id="idOf('sources')" @update:modelValue="setSources" />
            <span class="ah-field__hint">{{ $t('Goals.sources_hint') }}</span>
        </div>

        <label class="ah-field">
            <span class="ah-field__label">{{ $t('Goals.weight') }}</span>
            <input v-model="form.weight" type="number" min="1" :max="LIMITS.weight" step="1" inputmode="numeric" class="ah-input" data-test="gtf-weight" v-bind="state('weight')" @input="clear('weight')" />
            <span v-if="errors.weight" :id="idOf('weight')" class="ah-field__error" role="alert" data-error-for="weight">{{ errors.weight }}</span>
            <span v-else class="ah-field__hint">{{ $t('Goals.weight_hint') }}</span>
        </label>

        <p v-if="errors.form" class="ah-field__error gtf__error" role="alert" data-error-for="form">{{ errors.form }}</p>
        <div class="gtf__actions">
            <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" data-test="gtf-cancel" @click="$emit('cancel')">{{ $t('Goals.cancel') }}</button>
            <button type="submit" class="ah-btn ah-btn--primary ah-btn--sm" data-test="gtf-save" :disabled="busy">{{ $t(busy ? 'Goals.saving' : 'Goals.save') }}</button>
        </div>
    </form>
</template>

<script setup>
import { computed, nextTick, onMounted, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import GoalSourcePicker from "./GoalSourcePicker.vue";
import { KINDS, LIMITS, NUMBER, TASKS, checkTarget, isMeasured, refusedSources, sourcesOf } from "./goalRequest";

defineOptions({ name: "GoalTargetForm" });

const FIELDS = ["kind", "name", "start", "target", "current", "unit", "currencyCode", "sources", "weight"];

const props = defineProps({
    target: { type: Object, default: null },
    currencies: { type: Array, default: () => [] },
    busy: { type: Boolean, default: false },
    refusal: { type: Object, default: null },
    linking: { type: Boolean, default: false }
});
const emit = defineEmits(["save", "cancel"]);

const { t } = useI18n();
const uid = `gtf-${Math.random().toString(36).slice(2, 8)}`;
const root = ref(null);

const text = (value) => (value === undefined || value === null ? "" : String(value));
const form = reactive(props.target
    ? { kind: props.target.kind, name: props.target.name, start: text(props.target.start), target: text(props.target.target), current: "", unit: text(props.target.unit), currencyCode: text(props.target.currencyCode), weight: text(props.target.weight || 1), sources: sourcesOf(props.target.sources) }
    : { kind: NUMBER, name: "", start: "", target: "", current: "", unit: "", currencyCode: "", weight: "1", sources: sourcesOf() });
const errors = reactive({});
const refused = ref(null);
let sent = null;

const kind = computed(() => form.kind);
const measured = computed(() => isMeasured(form.kind));

const idOf = (field) => `${uid}-${field}`;
const state = (field) => (errors[field]
    ? { class: "ah-input--error", "aria-invalid": "true", "aria-describedby": idOf(field) }
    : {});
const clear = (field) => { errors[field] = ""; errors.form = ""; };
function setSources(sources) {
    form.sources = sources;
    clear("sources");
    refused.value = null;
}

function show(found) {
    [...FIELDS, "form"].forEach((field) => { errors[field] = found[field] || ""; });
    nextTick(() => root.value?.querySelector("[aria-invalid=\"true\"]")?.focus());
}

function submit() {
    const found = Object.fromEntries(Object.entries(checkTarget(form)).map(([field, key]) => [field, t(key)]));
    show(found);
    refused.value = null;
    if (Object.keys(found).length || props.busy) return;
    sent = sourcesOf(form.sources);
    emit("save", { ...form, sources: sent });
}

/* What the server refused lands on the field it named; a field this form does not show is said under the form.
   A refused list or task is marked among the ones that were sent. */
watch(() => props.refusal, (refusal) => {
    if (!refusal?.message) return;
    show({ [FIELDS.includes(refusal.field) ? refusal.field : "form"]: refusal.message });
    refused.value = refusal.field === "sources" ? refusedSources({ field: refusal.pointer, sources: refusal.sources }, sent) : null;
});

onMounted(() => root.value?.querySelector(props.linking ? ".gsp__search" : "select, input")?.focus());
</script>
