<!-- Reusable shell for the "pick a template on the left, configure its list on the right"
     step shared by the task-type / project-status / task-status create-project forms.
     Owns the left template picker UI and the mobile two-sub-step flow; the right column
     is a slot and all persistence lives in the consuming (wrapper) component via events. -->
<template>
<div class="statusTaskWrapper d-flex justify-content-between template-select-form">
    <div class="taskStatusLeft" :id="containerId || undefined" v-show="!isMobile || step === 'templates'">
        <div class="d-flex justify-content-between w-90">
            <label class="templetes mb-6px" :class="isMobile ? 'template-label-mobile' : 'template-label-desktop'">{{ $t('Templates.templates') }} ({{ templates.length }})</label>
            <img class="cursor-pointer" src="@/assets/images/svg/pluss.svg" :id="addIconId || undefined" @click="openNewTemplate()"/>
        </div>
        <ul class="templated_name_ul position-re">
            <li v-for="(tempVal, index) in templates" :key="tempVal._id || index" class="cursor-pointer" :class="[{ 'temp_save_value': tempVal.isShowSave }]">
                <span v-if="editingIndex !== index"
                    :class="[{ 'temp_save_dot': tempVal.isShowSave }, isMobile ? 'templated-name-mobile' : 'templated-name-desktop']"
                    :style="isSelected(tempVal) ? 'color: #3845B3 !important; font-weight: 500' : ''"
                    :title="tempVal.TemplateName" @click="selectTemplate(tempVal)"
                    class="templated_name text-ellipsis text-capitalize"> {{ tempVal.TemplateName }} </span>
                <input v-else type="text" class="statusInputText form-control edit-input statuseditInput" :maxlength="50" v-model.trim="editName" @keypress.enter="confirmRename(tempVal, index)" @input="errTempMsg = ''"/>
                <span class="position-ab" v-if="editingIndex === index" :style="[{ paddingTop: isMobile ? '1px' : '8px', right: '20px' }]">
                    <img :src="saveIcon" class="cursor-pointer" @click="confirmRename(tempVal, index)">
                    <img :src="deletered" class="cursor-pointer ml-10px" @click="cancelRename()">
                </span>
                <span class="task-leftside" :class="{ 'tsf-actions-mobile': isMobile }" v-if="editingIndex !== index && !tempVal.isShowSave && tempVal.TemplateName !== 'Custom'">
                    <img :src="templateEditIcon" alt="editicon" class="taskleftEditIcon" @click.stop="startRename(tempVal, index)"/>
                    <img v-if="!tempVal.default" :src="templateDeleteIcon" alt="deleteicon" class="taskleftdeleteIcon" @click.stop="askDelete(tempVal)"/>
                </span>
                <button type="button" :class="[{ 'pointer-event-none': isSaving }]" class="save_template" v-if="tempVal.isShowSave" @click="$emit('save', tempVal)">{{ $t('Templates.save_template') }}</button>
            </li>
        </ul>
        <ConfirmationSidebar
            v-model="isDeleteTemp"
            :acceptButtonClass="`btn-danger`"
            :acceptButton="$t('Projects.delete')"
            :title="$t('Templates.delete_template')"
            :message="$t('Templates.delete_template_confirmation')"
            :isShowInput="false"
            @confirm="confirmDelete"
        >
            <template #body><div></div></template>
        </ConfirmationSidebar>
        <button class="add_template" type="button" @click="openNewTemplate()">+ {{ $t('Templates.new_template') }}</button>
        <div class="d-flex position-re">
            <input v-if="isNewTemplate" :placeholder="$t('PlaceHolder.Enter_Template')" class="add_new_temp form-control" :maxlength="50" type="text" @keypress.enter.prevent="confirmCreate()" v-model.trim="newTemplateName" @input="errTempMsg = ''"/>
            <span class="position-ab edit-rightinput save__closeimg-wrapper">
                <img :src="saveIcon" class="cursor-pointer" v-if="isNewTemplate" @click="confirmCreate()">
                <img :src="deletered" class="cursor-pointer ml-10px" v-if="isNewTemplate" @click="closeNewTemplate()">
            </span>
        </div>
        <div class="err_temp_status">
            <div v-if="fieldError" class="red font-size-11">{{ fieldError }}</div>
            <span v-if="errTempMsg" class="err_temp red font-size-12">{{ errTempMsg }}</span>
        </div>
    </div>
    <div class="taskStatusRight" :class="rightClass" :id="rightId || undefined" v-show="!isMobile || step === 'list'">
        <div v-if="isMobile && step === 'list'" class="tsf-substep-header d-flex align-items-center">
            <button type="button" class="tsf-back-btn d-flex align-items-center" @click="step = 'templates'" aria-label="Back to templates">
                <svg width="9" height="15" viewBox="0 0 9 15" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7.5 1.5 L2 7.5 L7.5 13.5" stroke="#3845B3" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <span class="tsf-active-template text-ellipsis text-capitalize" :title="modelValue && modelValue.TemplateName">{{ modelValue && modelValue.TemplateName }}</span>
            <button v-if="activeDirty" type="button" class="tsf-save-template" :class="{ 'pointer-event-none': isSaving }" @click="saveActive()">{{ $t('Templates.save_template') }}</button>
        </div>
        <slot name="list" />
    </div>
</div>
</template>
<script setup>
import { ref, computed, inject } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToast } from 'vue-toast-notification';
import ConfirmationSidebar from '@/components/molecules/ConfirmationSidebar/ConfirmationSidebar.vue';

const saveIcon = require('@/assets/images/svg/right_tick_green.svg');
const deletered = require('@/assets/images/svg/deletered.svg');
const templateEditIcon = require('@/assets/images/svg/edit_icon.svg');
const templateDeleteIcon = require('@/assets/images/svg/closeLeftHover.svg');

const { t } = useI18n();
const $toast = useToast();
const clientWidth = inject('$clientWidth');
const isMobile = computed(() => clientWidth.value <= 767);

const props = defineProps({
    templates: { type: Array, default: () => [] },
    modelValue: { type: Object, default: () => ({}) },
    fieldError: { type: String, default: '' },
    isSaving: { type: Boolean, default: false },
    containerId: { type: String, default: '' },
    addIconId: { type: String, default: '' },
    rightId: { type: String, default: '' },
    rightClass: { type: String, default: '' },
});
const emit = defineEmits(['update:modelValue', 'create', 'rename', 'delete', 'save', 'left-focus']);

const step = ref('templates');
const isNewTemplate = ref(false);
const newTemplateName = ref('');
const editingIndex = ref(null);
const editName = ref('');
const errTempMsg = ref('');
const isDeleteTemp = ref(false);
const deleteTemplateObj = ref({});

function isSelected(tempVal) {
    return props.modelValue && props.modelValue._id === tempVal._id;
}
// The active template carries unsaved list changes (isShowSave). Surfaced in the mobile
// list sub-step header so users know to persist changes into the template.
const activeTemplateRow = computed(() => props.templates.find((x) => x._id === props.modelValue?._id));
const activeDirty = computed(() => !!activeTemplateRow.value?.isShowSave);
function saveActive() {
    emit('save', activeTemplateRow.value || props.modelValue);
}
function isDuplicateName(name, skipIndex = -1) {
    const norm = (s) => s.replaceAll(' ', '_').toLowerCase();
    return props.templates.some((x, i) => i !== skipIndex && x.TemplateName && norm(x.TemplateName) === norm(name));
}
function validateName(name, skipIndex = -1) {
    if (!name) { errTempMsg.value = t('errorPage.Template_name_is_required'); return false; }
    if (name.toLowerCase() === 'custom') { $toast.error(t('Toast.Can_not_create_template_name_Custom'), { position: 'top-right' }); return false; }
    if (isDuplicateName(name, skipIndex)) { errTempMsg.value = t('errorPage.This_template_name_is_already_exists'); return false; }
    return true;
}

function selectTemplate(tempVal) {
    emit('update:modelValue', tempVal);
    if (isMobile.value) step.value = 'list';
}
function openNewTemplate() {
    isNewTemplate.value = true;
    editingIndex.value = null;
    errTempMsg.value = '';
    emit('left-focus');
}
function closeNewTemplate() {
    isNewTemplate.value = false;
    newTemplateName.value = '';
    errTempMsg.value = '';
}
function confirmCreate() {
    if (!validateName(newTemplateName.value)) return;
    emit('create', newTemplateName.value);
    closeNewTemplate();
    if (isMobile.value) step.value = 'list';
}
function startRename(tempVal, index) {
    editName.value = tempVal.TemplateName;
    editingIndex.value = index;
    isNewTemplate.value = false;
    errTempMsg.value = '';
    emit('left-focus');
}
function cancelRename() {
    editingIndex.value = null;
    errTempMsg.value = '';
}
function confirmRename(tempVal, index) {
    if (!validateName(editName.value, index)) return;
    emit('rename', tempVal, editName.value);
    editingIndex.value = null;
}
function askDelete(tempVal) {
    deleteTemplateObj.value = tempVal;
    editingIndex.value = null;
    isDeleteTemp.value = true;
}
function confirmDelete() {
    emit('delete', deleteTemplateObj.value);
    isDeleteTemp.value = false;
}

// Called by the wrapper when the right column takes over "add" mode, so the two
// mutually-exclusive inline inputs are never open at once (mirrors the old isTemplate reset).
function closeInputs() {
    isNewTemplate.value = false;
    newTemplateName.value = '';
    editingIndex.value = '';
    errTempMsg.value = '';
}
defineExpose({ closeInputs });
</script>
<style>
/* Shared create-project form styles, loaded globally (not scoped) so the rules apply to
   both the shell's own left column and the wrapper-provided right column in the #list slot,
   which live under different scope ids. webpack dedupes the module across the forms. */
@import '@/components/templates/CreateProject/style.css';
</style>
<style scoped>
/* Pinned to the top of the wizard's scrolling section (see .wizard-step-fill .taskStatusSection)
   so Back / template name / Save Template stay visible while the list scrolls under them.
   Solid background so scrolled rows don't show through. */
.tsf-substep-header {
    gap: 6px;
    padding: 2px 0 10px;
    position: sticky;
    top: 0;
    z-index: 3;
    background: #fff;
}
.tsf-back-btn {
    background: transparent;
    border: 0;
    padding: 4px 6px 4px 0;
    cursor: pointer;
}
.tsf-active-template {
    font-weight: 500;
    font-size: 16px;
    line-height: 21px;
    color: #3845B3;
    max-width: 60%;
}
/* Surfaced in the list sub-step header so a user who edited the list sees they must save it
   back into the template to keep the change. */
.tsf-save-template {
    margin-left: auto;
    flex: none;
    border: 1px solid #3845B3;
    background: #fff;
    color: #3845B3;
    border-radius: 4px;
    padding: 4px 10px;
    font-size: 12px;
    line-height: 16px;
    cursor: pointer;
}
@media (max-width: 767px) {
    /* touch has no hover → show the per-row edit/delete icons inline on the templates sub-step */
    .taskStatusLeft ul.templated_name_ul li span.task-leftside.tsf-actions-mobile img.taskleftEditIcon,
    .taskStatusLeft ul.templated_name_ul li span.task-leftside.tsf-actions-mobile img.taskleftdeleteIcon {
        display: inline-block;
    }
}
</style>
