<template>
    <form class="mfe" novalidate @submit.prevent="save(false)">
        <div class="ah-field">
            <label class="ah-field__label" :for="titleId">{{ $t('Fields.field_label') }}</label>
            <input
                :id="titleId"
                ref="titleInput"
                v-model.trim="draft.fieldTitle"
                type="text"
                class="ah-input"
                :class="{ 'ah-input--error': errors.fieldTitle }"
                maxlength="80"
                data-field-title
                @keydown.enter.prevent="saveFromName"
            />
            <span v-if="errors.fieldTitle" class="ah-field__error">{{ errors.fieldTitle }}</span>
        </div>
        <component :is="ui.settings" v-if="ui.settings" v-model="draft" :error="errors.settings" />
        <FieldTaskTypesPicker v-model="draft.fieldTaskTypes" />
        <p class="mfe__note">{{ $t('FieldTypes.builder_note') }}</p>
        <div class="mfe__foot">
            <button type="button" class="ah-btn ah-btn--ghost" data-field-cancel @click="$emit('cancel')">{{ $t('Fields.cancel') }}</button>
            <button v-if="!draft._id" type="button" class="ah-btn ah-btn--secondary" data-field-save-another @click="save(true)">{{ $t('Fields.save_and_add_another') }}</button>
            <button type="button" class="ah-btn ah-btn--primary" data-field-save @click="save(false)">{{ $t('Fields.save_field') }}</button>
        </div>
    </form>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import FieldTaskTypesPicker from "../component/atom/FieldTaskTypesPicker/FieldTaskTypesPicker.vue";
import { fieldTypeUi, moduleFieldDraft, moduleFieldSettings, moduleFieldSettingsError } from "./index";

defineOptions({ name: "ModuleFieldEditor" });

const props = defineProps({
    fieldType: { type: String, required: true },
    field: { type: Object, default: () => ({}) }
});
const emit = defineEmits(["save", "cancel"]);

const { t } = useI18n();
const titleId = `mfe-title-${props.fieldType}`;
const ui = computed(() => fieldTypeUi(props.fieldType));
const draftOf = () => moduleFieldDraft({ ...props.field, fieldType: props.fieldType });
const draft = ref(draftOf());
const errors = ref({});
const titleInput = ref(null);

onMounted(() => nextTick(() => titleInput.value?.focus()));

watch(() => [props.field, props.fieldType], () => {
    draft.value = draftOf();
    errors.value = {};
});

function saveFromName(event) {
    if (!event.isComposing) save(false);
}

function save(another) {
    const settingsError = moduleFieldSettingsError(draft.value);
    errors.value = {
        ...(draft.value.fieldTitle ? {} : { fieldTitle: t("Fields.error_title_required") }),
        ...(settingsError ? { settings: t(settingsError) } : {})
    };
    if (Object.keys(errors.value).length) return;
    const { _id, ...fields } = draft.value;
    emit("save", { ...fields, fieldDescription: fields.fieldDescription || fields.fieldTitle, ...moduleFieldSettings(draft.value) }, Boolean(_id), another === true);
}
</script>

<style>
.mfe { display: flex; flex-direction: column; gap: 16px; padding: 4px 0 16px; }
.mfe__note { margin: 0; color: var(--ink-2); font: var(--text-small); }
.mfe__foot { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
</style>
