<template>
    <div class="fl">
        <p v-if="locked" class="fl__note">{{ t('Projects.form_logic_always_named') }}</p>
        <p v-else-if="!rows.length && !candidates.length" class="fl__note">{{ t('Projects.form_logic_no_sources') }}</p>
        <button v-else-if="!rows.length" type="button" class="fl__add" data-test="form-logic-add" @click="addRow">
            {{ t('Projects.form_logic_add') }}
        </button>
        <template v-else>
            <div class="fl__head">
                <span class="fl__title">{{ t('Projects.form_logic_title') }}</span>
                <select
                    v-if="rows.length > 1"
                    class="ah-input fl__select"
                    data-test="form-logic-mode"
                    :value="mode"
                    :aria-label="t('Projects.form_logic_mode_label')"
                    @change="emitRows(rows, $event.target.value)"
                >
                    <option value="all">{{ t('Projects.form_logic_mode_all') }}</option>
                    <option value="any">{{ t('Projects.form_logic_mode_any') }}</option>
                </select>
            </div>

            <div v-for="(row, i) in rows" :key="i" class="fl__row">
                <span v-if="isGroup(row)" class="fl__group">{{ describeGroup(row, sources, t) }}</span>
                <template v-else>
                    <select
                        class="ah-input fl__select"
                        data-test="form-logic-question"
                        :value="row.question"
                        :aria-label="t('Projects.form_logic_question_label')"
                        @change="setQuestion(i, $event.target.value)"
                    >
                        <option value="">{{ t('Projects.form_logic_pick_question') }}</option>
                        <option v-if="row.question && !sourceOf(row)" :value="row.question" disabled>
                            {{ labelOfGone(row.question) }}
                        </option>
                        <option v-for="q in candidates" :key="q.id" :value="q.id">{{ q.label }}</option>
                    </select>

                    <template v-if="sourceOf(row)">
                        <select
                            class="ah-input fl__select"
                            data-test="form-logic-operator"
                            :value="row.op"
                            :aria-label="t('Projects.form_logic_operator_label')"
                            @change="setOperator(i, $event.target.value)"
                        >
                            <option v-for="op in operatorsFor(sourceOf(row).type)" :key="op" :value="op">
                                {{ t(`Projects.form_logic_op_${wordingOf(sourceOf(row).type, op)}`) }}
                            </option>
                        </select>

                        <div v-if="row.op === 'one_of'" class="fl__choices" role="group" :aria-label="t('Projects.form_logic_value_label')">
                            <label v-for="o in optionsOf(row)" :key="o.id" class="fl__choice">
                                <input
                                    type="checkbox"
                                    data-test="form-logic-value"
                                    :checked="(row.value || []).includes(o.id)"
                                    @change="toggleOption(i, o.id)"
                                >
                                <span>{{ o.label }}</span>
                            </label>
                        </div>
                        <select
                            v-else-if="needsValue(row) && picksOption(row)"
                            class="ah-input fl__select"
                            data-test="form-logic-value"
                            :value="row.value"
                            :aria-label="t('Projects.form_logic_value_label')"
                            @change="setValue(i, $event.target.value)"
                        >
                            <option value="">{{ t('Projects.form_logic_pick_option') }}</option>
                            <option v-if="row.value && !optionsOf(row).some((o) => o.id === row.value)" :value="row.value" disabled>
                                {{ t('Projects.form_logic_missing_option') }}
                            </option>
                            <option v-for="o in optionsOf(row)" :key="o.id" :value="o.id">{{ o.label }}</option>
                        </select>
                        <input
                            v-else-if="needsValue(row)"
                            class="ah-input fl__select"
                            data-test="form-logic-value"
                            :type="inputType(row)"
                            :value="row.value"
                            :maxlength="MAX_TEXT_VALUE"
                            :aria-label="t('Projects.form_logic_value_label')"
                            @input="setValue(i, typedValue(row, $event.target.value))"
                        >
                    </template>
                </template>

                <button
                    type="button"
                    class="fl__remove"
                    data-test="form-logic-remove"
                    :title="t('Projects.form_logic_remove_condition')"
                    :aria-label="t('Projects.form_logic_remove_condition')"
                    @click="emitRows(rows.filter((_, at) => at !== i))"
                >
                    <FormIcon name="close" />
                </button>
            </div>

            <p v-if="rows.some(isUnfinished)" class="fl__note" data-test="form-logic-unfinished">{{ t('Projects.form_logic_unfinished') }}</p>
            <button v-if="conditionCount(rule) < MAX_CONDITIONS" type="button" class="fl__add" data-test="form-logic-add" @click="addRow">
                + {{ t('Projects.form_logic_add_condition') }}
            </button>
            <p v-else class="fl__note">{{ t('Projects.form_logic_limit', { n: MAX_CONDITIONS }) }}</p>
        </template>
    </div>
</template>

<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { kindOf, operatorsFor, MAX_CONDITIONS, MAX_TEXT_VALUE, VALUELESS } from '@formLogic';
import FormIcon from './FormIcon.vue';
import { conditionCount, describeGroup, isGroup, isUnfinished, modeOf, rowsOf, wordingOf } from './formLogicBuilder';

defineOptions({ name: 'FormLogicEditor' });

const { t } = useI18n();
const props = defineProps({
    rule: { type: Object, default: undefined },
    index: { type: Number, required: true },
    // Every question of the form, in order, with task field questions already given their type and options.
    sources: { type: Array, required: true },
    locked: { type: Boolean, default: false },
});
const emit = defineEmits(['update:rule']);

const mode = computed(() => modeOf(props.rule));
const rows = computed(() => rowsOf(props.rule));
const candidates = computed(() => props.sources.slice(0, props.index).filter((q) => !q.hidden && operatorsFor(q.type).length));

const sourceOf = (row) => candidates.value.find((q) => q.id === row.question);
const optionsOf = (row) => (sourceOf(row) && sourceOf(row).options) || [];
const needsValue = (row) => !VALUELESS.includes(row.op);
const picksOption = (row) => ['choice', 'multi'].includes(kindOf(sourceOf(row).type));
const inputType = (row) => ({ number: 'number', date: 'date' }[kindOf(sourceOf(row).type)] || 'text');
const typedValue = (row, text) => (kindOf(sourceOf(row).type) === 'number' && text !== '' ? Number(text) : text);
const labelOfGone = (id) => (props.sources.find((q) => q.id === id) || {}).label || t('Projects.form_logic_missing_question');

const emitRows = (next, as = mode.value) => emit('update:rule', next.length ? { [as]: next } : undefined);
const replaceRow = (at, row) => emitRows(rows.value.map((old, i) => (i === at ? row : old)));

const addRow = () => emitRows([...rows.value, { question: '', op: '', value: '' }]);

const setQuestion = (at, id) => {
    const source = candidates.value.find((q) => q.id === id);
    replaceRow(at, { question: id, op: source ? operatorsFor(source.type)[0] : '', value: '' });
};

const setOperator = (at, op) => {
    const { question, value } = rows.value[at];
    if (VALUELESS.includes(op)) return replaceRow(at, { question, op });
    if (op === 'one_of') return replaceRow(at, { question, op, value: Array.isArray(value) ? value : [value].filter(Boolean) });
    return replaceRow(at, { question, op, value: Array.isArray(value) ? (value[0] || '') : (value === undefined ? '' : value) });
};

const setValue = (at, value) => replaceRow(at, { ...rows.value[at], value });

const toggleOption = (at, id) => {
    const picked = rows.value[at].value || [];
    setValue(at, picked.includes(id) ? picked.filter((one) => one !== id) : [...picked, id]);
};
</script>

<style scoped>
.fl { display: flex; flex-direction: column; gap: 6px; padding: 10px; border: 1px solid var(--hairline); border-radius: 9px; background: var(--canvas); }
.fl__head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.fl__title { font: var(--text-small); font-weight: 600; color: var(--ink); }
.fl__row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.ah-input.fl__select { flex: 1 1 140px; min-width: 0; width: auto; height: 30px; font-size: 12.5px; }
.fl__choices { flex: 1 1 100%; display: flex; flex-wrap: wrap; gap: 6px 12px; }
.fl__choice { display: flex; align-items: center; gap: 6px; font: var(--text-small); color: var(--ink); }
.fl__choice input { margin: 0; accent-color: var(--brand); }
.fl__group { flex: 1 1 auto; font: var(--text-small); color: var(--ink-2); }
.fl__remove {
    flex: none; width: 26px; height: 26px; display: grid; place-items: center;
    border: 1px solid var(--hairline); border-radius: 6px;
    background: var(--surface); color: var(--ink-2); cursor: pointer;
}
.fl__remove:hover { border-color: var(--danger); color: var(--danger); }
.fl__add {
    align-self: flex-start;
    border: 1px solid var(--border); border-radius: var(--r-chip);
    background: var(--surface); color: var(--ink-2);
    font: var(--text-small); padding: 5px 10px; cursor: pointer;
}
.fl__add:hover { border-color: var(--brand); color: var(--brand); }
.fl__add:focus-visible, .fl__remove:focus-visible { outline: none; box-shadow: var(--focus); }
.fl__note { margin: 0; font: var(--text-small); color: var(--ink-2); }
</style>
