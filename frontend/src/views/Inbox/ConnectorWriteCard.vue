<template>
    <div class="cwc" data-test="connector-card">
        <div class="cwc__head">
            <span class="ah-label" data-test="connector-card-tool">{{ t(card.label) }}</span>
            <span class="ah-chip ah-chip--warn">{{ t('Connectors.approval.outside') }}</span>
        </div>

        <dl class="cwc__fields">
            <template v-if="target">
                <dt class="ah-small">{{ t('Connectors.card.target') }}</dt>
                <dd data-test="connector-card-target">{{ target }}</dd>
            </template>
            <template v-if="card.title">
                <dt class="ah-small">{{ t('Connectors.card.title') }}</dt>
                <dd data-test="connector-card-title">{{ card.title }}</dd>
            </template>
            <template v-if="card.text">
                <dt class="ah-small">{{ t('Connectors.card.text') }}</dt>
                <dd class="cwc__text" data-test="connector-card-text">{{ card.text }}</dd>
            </template>
            <template v-for="(row, i) in card.rows || []" :key="i">
                <dt class="ah-small">{{ t(row.label) }}</dt>
                <dd data-test="connector-card-row">{{ row.valueLabel ? t(row.valueLabel) : row.value }}</dd>
            </template>
            <template v-if="(card.attachments || []).length">
                <dt class="ah-small">{{ t('Connectors.card.attachments') }}</dt>
                <dd>
                    <ul class="cwc__files">
                        <li v-for="(name, i) in card.attachments" :key="i" data-test="connector-card-attachment">{{ name }}</li>
                    </ul>
                </dd>
            </template>
        </dl>

        <div v-if="editing && fields.length" class="cwc__form" data-test="connector-card-form">
            <label v-for="field in fields" :key="field.param" class="cwc__field" :class="{ 'cwc__field--toggle': field.toggle }">
                <input
                    v-if="field.toggle"
                    type="checkbox"
                    class="ah-check"
                    :checked="params[field.param] === true"
                    :disabled="disabled"
                    :data-test="`connector-field-${field.param}`"
                    @change="retype(field, $event.target.checked)"
                />
                <span class="ah-field__label">{{ t(field.label) }}</span>
                <select
                    v-if="field.options"
                    class="ah-input"
                    :value="valueOf(field)"
                    :disabled="disabled"
                    :data-test="`connector-field-${field.param}`"
                    @change="retype(field, $event.target.value)"
                >
                    <option value="">{{ t(field.blank) }}</option>
                    <option v-for="option in field.options" :key="option.value" :value="option.value">{{ t(option.label) }}</option>
                </select>
                <textarea
                    v-else-if="field.long"
                    class="ah-input ah-textarea"
                    :value="valueOf(field)"
                    :disabled="disabled"
                    :data-test="`connector-field-${field.param}`"
                    @input="retype(field, $event.target.value)"
                ></textarea>
                <input
                    v-else-if="!field.toggle"
                    type="text"
                    class="ah-input"
                    :value="valueOf(field)"
                    :disabled="disabled"
                    :data-test="`connector-field-${field.param}`"
                    @input="retype(field, $event.target.value)"
                />
                <span v-if="field.hint" class="ah-small cwc__note" data-test="connector-field-hint">{{ t(field.hint) }}</span>
            </label>
            <p class="ah-small cwc__note">{{ t('Connectors.approval.edit_note') }}</p>
        </div>

        <p v-if="delivery" class="ah-small cwc__result" :class="{ 'ah-field__error': !delivery.ok }" data-test="connector-card-result">
            {{ delivery.ok ? t('Connectors.approval.sent', { answer: delivery.answer }) : t('Connectors.approval.failed', { error: delivery.error }) }}
        </p>
        <p v-else-if="waiting" class="ah-small cwc__note">{{ t('Connectors.approval.note') }}</p>
    </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

defineOptions({ name: 'ConnectorWriteCard' });

const props = defineProps({
    change: { type: Object, required: true },
    editing: { type: Boolean, default: false },
    disabled: { type: Boolean, default: false },
    delivery: { type: Object, default: null },
    waiting: { type: Boolean, default: true },
});
const emit = defineEmits(['update:params']);

const { t } = useI18n();

const card = computed(() => props.change.card || {});
const target = computed(() => (card.value.targetLabel ? t(card.value.targetLabel) : card.value.target));
const fields = computed(() => card.value.fields || []);
const params = computed(() => props.change.params || {});

const heldAtStart = ref({});
watch([() => props.change, () => props.editing], () => { heldAtStart.value = { ...params.value }; }, { immediate: true });

const valueOf = (field) => params.value[field.param] ?? '';
const retype = (field, value) => {
    const next = { ...params.value, [field.param]: value };
    // A blank value is sent and clears the field at the provider, so a field that was never named stays unnamed.
    const untouched = (value === '' || value === false) && !(field.param in heldAtStart.value);
    // A choice's blank is its default, which the input takes by being left out.
    if (untouched || (field.options && value === '')) delete next[field.param];
    emit('update:params', next);
};
</script>

<style scoped>
.cwc { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--r-md, 8px); background: var(--surface); min-width: 0; }
.cwc__head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.cwc__fields { margin: 0; display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 6px 12px; }
.cwc__fields dt { color: var(--ink-2); }
.cwc__fields dd { margin: 0; color: var(--ink); min-width: 0; overflow-wrap: anywhere; }
.cwc__text { white-space: pre-wrap; padding: 8px 10px; border-radius: var(--r-sm, 6px); background: var(--fill); }
.cwc__files { margin: 0; padding: 0; list-style: none; }
.cwc__form { display: flex; flex-direction: column; gap: 8px; padding-top: 8px; border-top: 1px solid var(--hairline); }
.cwc__field { display: flex; flex-direction: column; gap: 4px; }
.cwc__field--toggle { flex-direction: row; align-items: center; gap: 8px; cursor: pointer; }
.cwc__note, .cwc__result { margin: 0; }
.cwc__note { color: var(--ink-2); }
@media (max-width: 480px) { .cwc__fields { grid-template-columns: minmax(0, 1fr); } }
</style>
