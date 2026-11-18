<template>
    <div class="mfl" :data-field-type="detail.fieldType">
        <span class="mfl__label" :title="detail.fieldDescription || detail.fieldTitle || null">
            <ShellIcon :name="ui.icon" :size="16" class="mfl__icon" />
            <span class="mfl__title">{{ detail.fieldTitle }}</span>
            <button
                v-if="editable"
                type="button"
                class="mfl__edit"
                data-field-edit
                :aria-label="$t('FieldTypes.edit_field', { field: detail.fieldTitle || '' })"
                :title="$t('FieldTypes.edit_field', { field: detail.fieldTitle || '' })"
                @click="$emit('edit')"
            >
                <ShellIcon name="edit" :size="12" />
            </button>
        </span>
        <span class="mfl__value">
            <component
                :is="ui.value"
                :def="detail"
                :value="detail.fieldValue"
                :editable="editable"
                :label="detail.fieldTitle || ''"
                v-bind="taskPropFor(detail.fieldType, task)"
                @change="$emit('change', $event)"
            />
        </span>
    </div>
</template>

<script setup>
import { computed } from "vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { fieldTypeUi, taskPropFor } from "@/plugins/customFieldView/fieldTypes";

defineOptions({ name: "ModuleFieldListing" });

const props = defineProps({
    detail: { type: Object, required: true },
    task: { type: Object, default: () => ({}) },
    editable: { type: Boolean, default: false }
});
defineEmits(["change", "edit"]);

const ui = computed(() => fieldTypeUi(props.detail.fieldType));
</script>

<style>
.mfl { display: flex; align-items: stretch; width: 100%; border-bottom: 1px solid var(--border); color: var(--ink); font: var(--text-body); }
.mfl__label { flex: 0 0 min(298px, 50%); display: flex; align-items: center; min-width: 0; padding: 7px 0 5px; color: var(--ink-2); }
.mfl__icon { flex: none; margin: 0 10px; }
.mfl__title { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mfl__edit {
    flex: none; display: inline-flex; align-items: center; justify-content: center;
    width: 24px; height: 24px; margin: 0 8px; padding: 0;
    border: 0; border-radius: 6px;
    background: none; color: var(--ink-2); cursor: pointer;
    opacity: 0; transition: opacity var(--t-state) var(--ease);
}
.mfl__label:hover .mfl__edit, .mfl__edit:focus-visible { opacity: 1; }
.mfl__edit:hover { background: var(--surface-hover); color: var(--ink); }
.mfl__edit:focus-visible { outline: none; box-shadow: var(--focus); }
.mfl__value { flex: 1 1 0; display: flex; align-items: center; min-width: 0; min-height: 40px; padding: 6px 20px; border-left: 1px solid var(--border); }
@media (max-width: 767px) {
    .mfl__value { padding: 6px 10px; }
    .mfl__edit { opacity: 1; }
}
</style>
