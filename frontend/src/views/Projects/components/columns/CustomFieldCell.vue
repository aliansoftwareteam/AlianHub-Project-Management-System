<template>
    <span class="cfc" :class="`cfc--${type}`" :data-field-type="type" @click.stop>
        <AiFieldMark v-if="isAi && applies" :def="def" :task="task" :canFill="editable" />
        <span v-if="!applies" class="ah-sr-only">{{ $t('ViewColumns.field_not_for_type', { field: def.fieldTitle }) }}</span>
        <ComputedComponentViewColumn
            v-else-if="computedType"
            class="cfc__computed"
            :def="def"
            :task="task"
            :allTasks="allTasks"
            :defs="defs"
        />
        <input
            v-else-if="type === 'checkbox'"
            type="checkbox"
            class="ah-check cfc__check"
            :checked="checked"
            :disabled="!editable"
            :aria-label="label"
            @change="$emit('change', $event.target.checked)"
        />
        <template v-else-if="editing">
            <select
                v-if="type === 'dropdown'"
                ref="input"
                v-model="draft"
                class="cfc__input"
                :aria-label="def.fieldTitle"
                @keydown.enter.prevent="commit"
                @keydown.esc="cancel"
                @blur="commit"
            >
                <option value="">{{ $t('ViewColumns.field_none') }}</option>
                <option v-for="option in def.fieldOptions || []" :key="option.id" :value="option.id">{{ option.label || option.value }}</option>
            </select>
            <input
                v-else
                ref="input"
                v-model="draft"
                class="cfc__input"
                :type="inputType"
                :inputmode="type === 'number' || type === 'money' ? 'decimal' : null"
                :aria-label="def.fieldTitle"
                :placeholder="def.fieldPlaceholder || null"
                @keydown.enter.prevent="commit"
                @keydown.esc="cancel"
                @blur="commit"
            />
        </template>
        <button
            v-else-if="editable"
            ref="trigger"
            type="button"
            class="cfc__btn"
            data-cell-edit
            :class="{ 'is-empty': !text }"
            :aria-label="label"
            :title="text || null"
            @click="start"
        >
            <template v-if="type === 'dropdown' && choices.length">
                <span v-for="option in choices" :key="option.id" class="cfc__chip" :style="chipStyle(option)">{{ option.label || option.value }}</span>
            </template>
            <span v-else-if="text" class="cfc__text">{{ text }}</span>
            <ShellIcon v-else name="plus" :size="12" class="cfc__empty" aria-hidden="true" />
        </button>
        <span v-else class="cfc__value" :title="text || null">
            <template v-if="type === 'dropdown' && choices.length">
                <span v-for="option in choices" :key="option.id" class="cfc__chip" :style="chipStyle(option)">{{ option.label || option.value }}</span>
            </template>
            <span v-else class="cfc__text">{{ text }}</span>
        </span>
    </span>
</template>

<script setup>
import { computed, inject, nextTick, ref } from "vue";
import { useI18n } from "vue-i18n";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import AiFieldMark from "@/components/atom/AiFieldMark/AiFieldMark.vue";
import { isAiField } from "@/views/Projects/composables/aiFields";
import ComputedComponentViewColumn from "@/plugins/customFieldView/component/atom/customFieldViewColumn/computedComponentViewColumn.vue";
import {
    COMPUTED_TYPES, customFieldText, dropdownChoices, fieldAppliesToTask, fieldEditValue, fieldIsChecked, storedEntry
} from "@/views/Projects/composables/projectCustomFields";

defineOptions({ name: "CustomFieldCell" });

const props = defineProps({
    def: { type: Object, required: true },
    task: { type: Object, required: true },
    editable: { type: Boolean, default: false },
    allTasks: { type: Array, default: () => [] },
    defs: { type: Array, default: () => [] }
});
const emit = defineEmits(["change"]);

const { t } = useI18n();
const dateFormat = inject("$dateFormat", ref("DD/MM/YYYY"));

const INPUT_TYPES = { number: "text", money: "text", date: "date", email: "email", phone: "tel" };

const type = computed(() => props.def.fieldType);
const applies = computed(() => fieldAppliesToTask(props.def, props.task));
const computedType = computed(() => COMPUTED_TYPES.includes(type.value));
const isAi = computed(() => isAiField(props.def));
const inputType = computed(() => INPUT_TYPES[type.value] || "text");
const text = computed(() => customFieldText(props.def, props.task, { allTasks: props.allTasks, dateFormat: dateFormat.value }));
const checked = computed(() => fieldIsChecked(props.def, props.task));
const choices = computed(() => dropdownChoices(props.def, storedEntry(props.task, props.def)?.fieldValue));

const label = computed(() => {
    const field = props.def.fieldTitle || "";
    if (type.value === "checkbox") return field;
    if (!props.editable) return text.value ? t("List.cell_value", { field, value: text.value }) : t("List.cell_none", { field });
    return text.value ? t("List.cell_change", { field, value: text.value }) : t("List.cell_set", { field });
});

const chipStyle = (option) => (option.color ? { color: option.color, backgroundColor: `${option.color}20` } : {});

const editing = ref(false);
const draft = ref("");
const input = ref(null);
const trigger = ref(null);

function start() {
    if (!props.editable || !applies.value) return;
    draft.value = fieldEditValue(props.def, props.task);
    editing.value = true;
    nextTick(() => input.value?.focus());
}

function finish() {
    editing.value = false;
    nextTick(() => trigger.value?.focus());
}

function commit() {
    if (!editing.value) return;
    const value = draft.value;
    finish();
    if (value !== fieldEditValue(props.def, props.task)) emit("change", value);
}

function cancel() {
    if (!editing.value) return;
    finish();
}
</script>

<style>
.cfc { display: inline-flex; align-items: center; min-width: 0; max-width: 100%; }
.cfc__btn, .cfc__value {
    display: inline-flex; align-items: center; gap: 4px;
    min-width: 24px; min-height: 24px; max-width: 100%;
    padding: 0 4px;
    border: 0; border-radius: 6px;
    background: none; color: inherit; font: inherit; text-align: left;
    overflow: hidden;
}
.cfc__btn { cursor: pointer; }
.cfc__btn:hover { background: var(--surface-hover); }
.cfc__btn:focus-visible, .cfc__input:focus-visible { outline: none; box-shadow: var(--focus); }
.cfc__text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cfc__empty { color: var(--ink-2); opacity: 0; transition: opacity var(--t-state) var(--ease); }
[role="row"]:hover .cfc__empty, [role="row"]:focus-within .cfc__empty, .cfc__btn:focus-visible .cfc__empty { opacity: 1; }
.cfc__chip {
    display: inline-block; max-width: 100%;
    padding: 1px 8px; border-radius: 999px;
    background: var(--surface-2); color: var(--ink);
    font-size: 11.5px; line-height: 18px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.cfc__input {
    width: 100%; min-width: 0; height: 26px;
    padding: 2px 6px;
    border: 1px solid var(--brand); border-radius: 6px;
    background: var(--surface); color: var(--ink); font: inherit;
}
.cfc__computed { color: var(--ink-2); }
@media (max-width: 767px) {
    .cfc__empty { opacity: 1; }
}
</style>
