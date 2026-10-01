<template>
    <div class="mfl" :data-field-type="detail.fieldType">
        <span class="mfl__label" :title="detail.fieldDescription || detail.fieldTitle || null">
            <ShellIcon :name="ui.icon" :size="16" class="mfl__icon" />
            <span class="mfl__title">{{ detail.fieldTitle }}</span>
        </span>
        <span class="mfl__value">
            <component
                :is="ui.value"
                :def="detail"
                :value="detail.fieldValue"
                :editable="editable"
                :label="detail.fieldTitle || ''"
                @change="$emit('change', $event)"
            />
        </span>
    </div>
</template>

<script setup>
import { computed } from "vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { fieldTypeUi } from "@/plugins/customFieldView/fieldTypes";

defineOptions({ name: "ModuleFieldListing" });

const props = defineProps({
    detail: { type: Object, required: true },
    editable: { type: Boolean, default: false }
});
defineEmits(["change"]);

const ui = computed(() => fieldTypeUi(props.detail.fieldType));
</script>

<style>
.mfl { display: flex; align-items: stretch; width: 100%; border-bottom: 1px solid var(--border); color: var(--ink); font: var(--text-body); }
.mfl__label { flex: 0 0 min(298px, 50%); display: flex; align-items: center; min-width: 0; padding: 7px 0 5px; color: var(--ink-2); }
.mfl__icon { flex: none; margin: 0 10px; }
.mfl__title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mfl__value { flex: 1 1 0; display: flex; align-items: center; min-width: 0; min-height: 40px; padding: 6px 20px; border-left: 1px solid var(--border); }
@media (max-width: 767px) {
    .mfl__value { padding: 6px 10px; }
}
</style>
