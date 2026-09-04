<template>
    <div class="ah-page fb">
        <div class="fb__main">
            <div class="fb__head">
                <h2 class="ah-h2">{{ $t('Fields.title') }}</h2>
                <span class="fb__count">{{ fields.length }} · {{ $t('Fields.scope_workspace') }}</span>
                <div class="fb__head-actions">
                    <button v-if="canEdit" type="button" class="ah-btn ah-btn--primary ah-btn--sm" @click="startNew('text')">
                        <ShellIcon name="plus" :size="14" /> {{ $t('Fields.new_field') }}
                    </button>
                </div>
            </div>

            <UpgradePlan
                v-if="!planEnabled"
                :buttonText="$t('Upgrades.upgrade_your_plan')"
                :lastTitle="$t('Upgrades.unlock_custom_field')"
                :secondTitle="$t('Upgrades.unlimited')"
                :firstTitle="$t('Upgrades.upgrade_to')"
                :message="$t('Upgrades.the_feature_not_available')"
            />

            <div v-if="fields.length" class="ah-card fb__table">
                <div class="fb__row fb__row-head">
                    <span></span>
                    <span>{{ $t('Fields.col_field') }}</span>
                    <span>{{ $t('Fields.col_type') }}</span>
                    <span>{{ $t('Fields.col_shown_in') }}</span>
                    <span>{{ $t('Fields.col_required') }}</span>
                </div>
                <button
                    v-for="field in fields"
                    :key="field._id"
                    type="button"
                    class="fb__row"
                    :class="{ 'is-active': selectedId === field._id, 'is-off': field.isDelete === false }"
                    @click="selectField(field)"
                >
                    <span class="fb__grip" :aria-hidden="true"><ShellIcon name="grip" :size="14" /></span>
                    <span class="fb__name" :title="field.fieldTitle">{{ field.fieldTitle }}</span>
                    <span class="ah-chip" :class="{ 'ah-chip--brand': isComputed(field) }">{{ typeLabel(field.fieldType) }}</span>
                    <span class="fb__shown" :class="{ 'fb__shown--mono': isComputed(field) }">{{ shownIn(field) }}</span>
                    <span v-if="isComputed(field)" class="fb__req--off">{{ $t('Fields.read_only') }}</span>
                    <span v-else-if="isRequired(field)" class="fb__req"><ShellIcon name="check" :size="14" /></span>
                    <span v-else class="fb__req--off">—</span>
                </button>
            </div>
            <div v-else class="ah-empty">{{ $t('Fields.empty_list') }}</div>

            <div class="ah-card">
                <div class="ah-card__body">
                    <div class="ah-label">{{ $t('Fields.pick_a_type') }}</div>
                    <div class="fb__types" style="margin-top: 9px">
                        <button
                            v-for="option in typeOptions"
                            :key="option.key"
                            type="button"
                            class="fb__type"
                            :class="{ 'fb__type--computed': option.computed }"
                            :disabled="!canEdit"
                            @click="startNew(option.key)"
                        >
                            <strong>{{ option.label }}</strong> <span>· {{ option.hint }}</span>
                        </button>
                    </div>
                    <p class="fb__note" style="margin: 9px 0 0">{{ $t('Fields.type_note') }}</p>
                </div>
            </div>
        </div>

        <aside class="fb__panel">
            <template v-if="draft">
                <div class="fb__panel-head">
                    <span class="fb__panel-mark">{{ draft.fieldType === 'rollup' ? 'Σ' : 'ƒ' }}</span>
                    <span class="fb__panel-title">{{ draft.fieldTitle || $t('Fields.untitled') }}</span>
                    <span class="fb__panel-kind">{{ typeLabel(draft.fieldType) }}</span>
                </div>

                <div class="ah-field">
                    <label class="ah-field__label" for="fb-title">{{ $t('Fields.field_label') }}</label>
                    <input
                        id="fb-title"
                        v-model.trim="draft.fieldTitle"
                        type="text"
                        class="ah-input"
                        :class="{ 'ah-input--error': errors.fieldTitle }"
                        :placeholder="$t('Fields.field_label_placeholder')"
                    />
                    <span v-if="errors.fieldTitle" class="ah-field__error">{{ errors.fieldTitle }}</span>
                </div>

                <template v-if="draft.fieldType === 'formula'">
                    <textarea
                        v-model="draft.formulaExpression"
                        ref="exprRef"
                        class="fb__expr"
                        :class="{ 'fb__expr--error': errors.formulaExpression }"
                        :placeholder="$t('Fields.expression_placeholder')"
                        spellcheck="false"
                        dir="ltr"
                    ></textarea>
                    <span v-if="errors.formulaExpression" class="ah-field__error">{{ errors.formulaExpression }}</span>

                    <div class="fb__tokens">
                        <button v-for="name in visibleNames" :key="name" type="button" class="fb__token" @click="insert('{' + name + '}')">{{ '{' + name + '}' }}</button>
                        <span v-if="hiddenNameCount" class="fb__token fb__token--more">{{ $t('Fields.more_fields', { count: hiddenNameCount }) }}</span>
                    </div>
                    <div class="fb__tokens">
                        <button v-for="fn in functionNames" :key="fn" type="button" class="fb__token fb__token--fn" @click="insert(fn + '(')">{{ fn }}</button>
                    </div>

                    <div v-if="preview.value !== null" class="fb__preview">
                        <strong>{{ $t('Fields.preview') }}</strong>
                        <span class="fb__preview-value">{{ preview.value }}</span>
                    </div>
                    <div v-else-if="preview.error" class="fb__warn">{{ preview.error }}</div>
                </template>

                <template v-if="draft.fieldType === 'rollup'">
                    <div class="ah-field">
                        <label class="ah-field__label" for="fb-rollup-src">{{ $t('Fields.rollup_source') }}</label>
                        <select id="fb-rollup-src" v-model="draft.rollupSourceFieldId" class="ah-input">
                            <option value="">{{ $t('Fields.rollup_source_count') }}</option>
                            <option v-for="field in numericFields" :key="field._id" :value="field._id">{{ field.fieldTitle }}</option>
                        </select>
                    </div>
                    <div class="ah-field">
                        <label class="ah-field__label">{{ $t('Fields.rollup_function') }}</label>
                        <div class="fb__seg">
                            <button v-for="fn in rollupFunctions" :key="fn" type="button" :class="{ 'is-active': draft.rollupFunction === fn }" @click="draft.rollupFunction = fn">{{ fn.toUpperCase() }}</button>
                        </div>
                    </div>
                    <div class="ah-field">
                        <label class="ah-field__label">{{ $t('Fields.rollup_scope') }}</label>
                        <div class="fb__seg">
                            <button type="button" :class="{ 'is-active': draft.rollupScope !== 'sprint' }" @click="draft.rollupScope = 'subtask'">{{ $t('Fields.rollup_scope_subtasks') }}</button>
                            <button type="button" :class="{ 'is-active': draft.rollupScope === 'sprint' }" @click="draft.rollupScope = 'sprint'">{{ $t('Fields.rollup_scope_sprint') }}</button>
                        </div>
                    </div>
                </template>

                <div v-if="isComputed(draft)">
                    <div class="ah-field__label" style="margin-bottom: 5px">{{ $t('Fields.show_as') }}</div>
                    <div class="fb__seg">
                        <button v-for="format in displayFormats" :key="format" type="button" :class="{ 'is-active': draft.fieldValidation === format }" @click="draft.fieldValidation = format">{{ $t('Fields.format_' + format) }}</button>
                    </div>
                </div>

                <div class="fb__warn">{{ isComputed(draft) ? $t('Fields.formula_rules') : $t('Fields.plain_field_note') }}</div>

                <div class="fb__panel-foot">
                    <button type="button" class="ah-btn ah-btn--primary fb__save" :disabled="saving" @click="save">
                        {{ saving ? $t('Fields.saving') : $t('Fields.save_field') }}
                    </button>
                    <button v-if="draft.fieldType === 'formula'" type="button" class="ah-btn ah-btn--secondary" :disabled="testing" @click="test">{{ $t('Fields.test') }}</button>
                    <button type="button" class="ah-btn ah-btn--ghost" @click="closeDraft">{{ $t('Fields.cancel') }}</button>
                </div>
            </template>

            <div v-else class="fb__empty-panel">
                <div class="ah-label">{{ $t('Fields.editor') }}</div>
                <div class="ah-empty">{{ $t('Fields.editor_empty') }}</div>
            </div>
        </aside>

        <CustomFieldsSidebarComponent
            v-if="legacyVisible"
            :componentDetail="legacyDetail"
            :customFieldObject="legacyObject"
            :isCustomField="legacyVisible"
            :isType="true"
            @customFieldStore="storeLegacyField"
            @closeSidebar="closeLegacy"
            @handleClose="closeLegacy"
        />
    </div>
</template>

<script setup>
import { computed, inject, nextTick, ref, watch } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import * as env from "@/config/env";
import { apiRequest } from "@/services";
import { useCustomComposable } from "@/composable";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import UpgradePlan from "@/components/atom/UpgradYourPlanComponent/UpgradYourPlanComponent.vue";
import CustomFieldsSidebarComponent from "../../molecules/customFieldSidebar/customFieldsSidebarComponent/customFieldsSidebarComponent.vue";

defineOptions({ name: "FieldBuilder" });

const { getters, commit } = useStore();
const { t } = useI18n();
const $toast = useToast();
const { checkPermission } = useCustomComposable();
const userId = inject("$userId");

const COMPUTED_TYPES = ["formula", "rollup"];
const NUMERIC_TYPES = ["number", "money", "formula", "rollup"];
const MAX_TOKENS = 5;

const displayFormats = ["money", "number", "text"];
const rollupFunctions = ["sum", "avg", "count", "min", "max"];
const functionNames = ["IF", "ROUND", "SUM", "AVG", "MIN", "MAX", "COUNT"];

const typeOptions = [
    { key: "text", label: t("Fields.type_text"), hint: t("Fields.hint_text") },
    { key: "textarea", label: t("Fields.type_long_text"), hint: t("Fields.hint_long_text") },
    { key: "number", label: t("Fields.type_number"), hint: t("Fields.hint_number") },
    { key: "money", label: t("Fields.type_money"), hint: t("Fields.hint_money") },
    { key: "date", label: t("Fields.type_date"), hint: t("Fields.hint_date") },
    { key: "dropdown", label: t("Fields.type_dropdown"), hint: t("Fields.hint_dropdown") },
    { key: "checkbox", label: t("Fields.type_checkbox"), hint: t("Fields.hint_checkbox") },
    { key: "email", label: t("Fields.type_email"), hint: t("Fields.hint_email") },
    { key: "phone", label: t("Fields.type_phone"), hint: t("Fields.hint_phone") },
    { key: "formula", label: t("Fields.type_formula"), hint: t("Fields.hint_formula"), computed: true },
    { key: "rollup", label: t("Fields.type_rollup"), hint: t("Fields.hint_rollup"), computed: true }
];

const selectedId = ref("");
const draft = ref(null);
const errors = ref({});
const saving = ref(false);
const testing = ref(false);
const preview = ref({ value: null, error: "" });
const scopeNames = ref([]);
const exprRef = ref(null);
const legacyVisible = ref(false);
const legacyDetail = ref({});
const legacyObject = ref({});

const currentCompany = computed(() => getters["settings/selectedCompany"] || {});
const planEnabled = computed(() => currentCompany.value?.planFeature?.customFields !== false);
const canEdit = computed(() => checkPermission("settings.settings_custom_field") === true && planEnabled.value);
const typeCatalogue = computed(() => getters["settings/customFields"] || []);
const fields = computed(() => (getters["settings/finalCustomFields"] || [])
    .slice()
    .sort((a, b) => new Date(b?.createdAt || 0).getTime() - new Date(a?.createdAt || 0).getTime()));

const numericFields = computed(() => fields.value.filter((field) => NUMERIC_TYPES.includes(field.fieldType) && field._id !== draft.value?._id));

const slugOf = (value) => String(value || "").trim().toLowerCase().replace(/\s+/g, "_");

const visibleNames = computed(() => scopeNames.value.slice(0, MAX_TOKENS));
const hiddenNameCount = computed(() => Math.max(scopeNames.value.length - MAX_TOKENS, 0));

const isComputed = (field) => COMPUTED_TYPES.includes(field?.fieldType);
const isRequired = (field) => Array.isArray(field?.fieldRequired) && field.fieldRequired.length > 0;
const typeLabel = (key) => (typeOptions.find((option) => option.key === key) || {}).label || key;

const shownIn = (field) => {
    if (field.fieldType === "formula") return field.formulaExpression || t("Fields.no_expression");
    if (field.fieldType === "rollup") {
        const source = fields.value.find((entry) => entry._id === field.rollupSourceFieldId);
        return `${String(field.rollupFunction || "sum").toUpperCase()} ${t("Fields.of")} ${source ? source.fieldTitle : t("Fields.rollup_scope_subtasks")}`;
    }
    const surfaces = Array.isArray(field.fieldSurfaces) && field.fieldSurfaces.length ? field.fieldSurfaces : ["task_view"];
    return surfaces.map((surface) => t(`Fields.surface_${surface}`)).join(" · ");
};

// The global type catalogue is empty on a fresh install, and the legacy drawer
// renders nothing without a cfType, so fall back to the picker's own entry.
function detailFor(fieldType) {
    const known = typeCatalogue.value.find((entry) => entry.cfType === fieldType);
    if (known) return known;
    const option = typeOptions.find((entry) => entry.key === fieldType);
    return option ? { cfType: fieldType, cfTitle: option.label, cfDescrption: option.hint, cfIcon: '', cfIconGrey: '' } : {};
}

function startNew(fieldType) {
    if (!canEdit.value) return;
    selectedId.value = "";
    if (!COMPUTED_TYPES.includes(fieldType)) {
        legacyDetail.value = detailFor(fieldType);
        legacyObject.value = {};
        legacyVisible.value = true;
        return;
    }
    draft.value = {
        fieldTitle: "",
        fieldDescription: "",
        fieldType,
        fieldValidation: "number",
        formulaExpression: "",
        rollupSourceFieldId: "",
        rollupFunction: "sum",
        rollupScope: "subtask"
    };
    errors.value = {};
    preview.value = { value: null, error: "" };
}

function selectField(field) {
    selectedId.value = field._id;
    if (!isComputed(field)) {
        legacyDetail.value = detailFor(field.fieldType);
        legacyObject.value = field;
        legacyVisible.value = !!legacyDetail.value?.cfType;
        return;
    }
    draft.value = {
        _id: field._id,
        fieldTitle: field.fieldTitle || "",
        fieldDescription: field.fieldDescription || "",
        fieldType: field.fieldType,
        fieldValidation: field.fieldValidation || "number",
        formulaExpression: field.formulaExpression || "",
        rollupSourceFieldId: field.rollupSourceFieldId || "",
        rollupFunction: field.rollupFunction || "sum",
        rollupScope: field.rollupScope || "subtask"
    };
    errors.value = {};
    preview.value = { value: null, error: "" };
}

function closeDraft() {
    draft.value = null;
    selectedId.value = "";
    errors.value = {};
}

function closeLegacy() {
    legacyVisible.value = false;
    legacyDetail.value = {};
    legacyObject.value = {};
    selectedId.value = "";
}

async function insert(snippet) {
    draft.value.formulaExpression = `${draft.value.formulaExpression || ""}${snippet}`;
    await nextTick();
    exprRef.value?.focus();
}

async function loadScope() {
    try {
        const response = await apiRequest("get", env.CUSTOM_FIELD_FORMULA_SCOPE);
        const names = response?.data?.data?.names || [];
        scopeNames.value = [...new Set(names.map((entry) => entry.name).filter(Boolean))];
    } catch (error) {
        scopeNames.value = [];
    }
}

// The expression is never evaluated in the browser: the server parses it in a
// sandbox and returns the preview number the panel shows.
async function checkExpression(sample) {
    const response = await apiRequest("post", env.CUSTOM_FIELD_FORMULA_VALIDATE, {
        expression: draft.value.formulaExpression || "",
        fieldId: draft.value._id || "",
        fieldTitle: draft.value.fieldTitle || "",
        sample: sample || {}
    });
    return response?.data || { status: false, message: t("Toast.something_went_wrong") };
}

async function test() {
    testing.value = true;
    try {
        const sample = {};
        scopeNames.value.forEach((name, index) => { sample[name] = index + 1; });
        const result = await checkExpression(sample);
        if (!result.status) {
            errors.value = { ...errors.value, formulaExpression: result.message || result.statusText };
            preview.value = { value: null, error: result.message || result.statusText };
            return;
        }
        errors.value = { ...errors.value, formulaExpression: "" };
        preview.value = { value: result.data?.preview, error: result.data?.previewError || "" };
    } catch (error) {
        preview.value = { value: null, error: t("Toast.something_went_wrong") };
    } finally {
        testing.value = false;
    }
}

function validate() {
    const next = {};
    if (!draft.value.fieldTitle) next.fieldTitle = t("Fields.error_title_required");
    else if (fields.value.some((field) => field._id !== draft.value._id && slugOf(field.fieldTitle) === slugOf(draft.value.fieldTitle))) {
        next.fieldTitle = t("Fields.error_title_taken");
    }
    if (draft.value.fieldType === "formula" && !String(draft.value.formulaExpression || "").trim()) {
        next.formulaExpression = t("Fields.error_expression_required");
    }
    errors.value = next;
    return !Object.keys(next).length;
}

async function save() {
    if (!validate()) return;
    saving.value = true;
    try {
        if (draft.value.fieldType === "formula") {
            const check = await checkExpression({});
            if (!check.status) {
                errors.value = { ...errors.value, formulaExpression: check.message || check.statusText };
                return;
            }
        }
        const detail = detailFor(draft.value.fieldType);
        const payload = {
            fieldTitle: draft.value.fieldTitle,
            fieldDescription: draft.value.fieldDescription || draft.value.fieldTitle,
            fieldType: draft.value.fieldType,
            fieldValidation: draft.value.fieldValidation,
            formulaExpression: draft.value.fieldType === "formula" ? String(draft.value.formulaExpression).trim() : "",
            rollupSourceFieldId: draft.value.fieldType === "rollup" ? draft.value.rollupSourceFieldId : "",
            rollupFunction: draft.value.fieldType === "rollup" ? draft.value.rollupFunction : "",
            rollupScope: draft.value.fieldType === "rollup" ? draft.value.rollupScope : "",
            fieldImage: detail.cfIcon || "",
            fieldImageGrey: detail.cfIconGrey || "",
            fieldPrimaryColor: detail.cfPrimaryColor || "",
            fieldBackgroundColor: detail.cfBackgroundColor || "",
            type: "task",
            updatedAt: new Date()
        };

        if (draft.value._id) {
            const response = await apiRequest("put", env.CUSTOM_FIELD, { type: "updateOne", key: "$set", id: draft.value._id, updateObject: payload });
            if (response?.status !== 200) throw new Error(response?.data?.message || t("Toast.something_went_wrong"));
            commit("settings/mutateFinalCustomFields", { data: { ...fields.value.find((field) => field._id === draft.value._id), ...payload, _id: draft.value._id }, op: "modified" });
        } else {
            const created = { ...payload, global: true, isDelete: true, projectId: [], userId: userId?.value || "", createdAt: new Date() };
            const response = await apiRequest("post", env.CUSTOM_FIELD, { type: "save", updateObject: created });
            if (response?.status !== 200) throw new Error(response?.data?.message || t("Toast.something_went_wrong"));
            commit("settings/mutateFinalCustomFields", { data: { ...created, _id: response?.data?._id || "" }, op: "added" });
        }
        $toast.success(t("Toast.Field_Updated_Successfully"), { position: "top-right" });
        closeDraft();
    } catch (error) {
        const message = error?.response?.data?.message || error?.message || t("Toast.something_went_wrong");
        errors.value = { ...errors.value, formulaExpression: draft.value?.fieldType === "formula" ? message : errors.value.formulaExpression };
        if (draft.value?.fieldType !== "formula") $toast.error(message, { position: "top-right" });
    } finally {
        saving.value = false;
    }
}

async function storeLegacyField(value, isEdit) {
    try {
        if (isEdit) {
            const response = await apiRequest("put", env.CUSTOM_FIELD, { type: "updateOne", key: "$set", id: legacyObject.value._id, updateObject: { ...value, updatedAt: new Date() } });
            if (response?.status !== 200) throw new Error(response?.data?.message);
            commit("settings/mutateFinalCustomFields", { data: { ...legacyObject.value, ...value }, op: "modified" });
        } else {
            const created = { ...value, global: true, isDelete: true, createdAt: new Date(), updatedAt: new Date(), userId: userId?.value || "", type: value?.type ? String(value.type).toLowerCase() : "task" };
            const response = await apiRequest("post", env.CUSTOM_FIELD, { type: "save", updateObject: created });
            if (response?.status !== 200) throw new Error(response?.data?.message);
            commit("settings/mutateFinalCustomFields", { data: { ...created, _id: response?.data?._id || "" }, op: "added" });
        }
        $toast.success(t("Toast.Field_Updated_Successfully"), { position: "top-right" });
    } catch (error) {
        $toast.error(error?.message || t("Toast.something_went_wrong"), { position: "top-right" });
    } finally {
        closeLegacy();
    }
}

watch(() => draft.value?.formulaExpression, () => { preview.value = { value: null, error: "" }; });

loadScope();
</script>

<style scoped>
@import "./style.css";
</style>
