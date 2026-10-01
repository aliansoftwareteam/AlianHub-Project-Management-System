<template>
    <FormKit
        type="form"
        :form-class="submitted ? 'hide' : 'show'"
        @submit="handleSubmit"
        @submit-invalid="showFirstError"
        :actions="false"
        ref="myForm"
    >
        <component
            :is="getView(props.componentDetail.cfType)"
            :tabIndex="props.tabIndex"
            :componentDetail="props.componentDetail"
            :customFieldObject="props.customFieldObject"
            @handleFunction="(val,isEdit) => emit('handleFunction',withTaskTypes(val),isEdit)"
            @tabIndexUpdate="(val) => emit('tabIndexUpdate',val)" 
            ref="childRef"
            :isType="isType"
        />
        <FieldTaskTypesPicker v-if="forTasks" v-model="taskTypes" :projectIds="taskTypeProjectIds" />
        <div class="custom_field-btn">
            <FormKit type="button" @click="handleTabCheck" :label="$t('Projects.cancel')" />
            <FormKit type="submit" @click="handleTab" :label="$t('Projects.save')" :disabled="submitted" />
        </div>
    </FormKit>
</template>

<script setup>
    import { computed, inject, nextTick, ref, unref, watch } from "vue";
    import {FormKit} from '@formkit/vue';
    import TextComponent from "../../../atom/customFieldSidebar/customFieldSidebarComponent/textComponents.vue";
    import CheckboxCustomField from "../../../atom/customFieldSidebar/customFieldSidebarComponent/checkboxCustomFields.vue";
    import PhoneComponent from "../../../atom/customFieldSidebar/customFieldSidebarComponent/phoneComponent.vue";
    import DropdownCustomField from "../../../atom/customFieldSidebar/customFieldSidebarComponent/dropdownCustomField/dropdownCustomField.vue";
    import DateComponentCF from "../../../atom/customFieldSidebar/customFieldSidebarComponent/dateComponent.vue";
    import MoneyComponent from "../../../atom/customFieldSidebar/customFieldSidebarComponent/moneyComponent.vue";
    import TextareaComponent from "../../../atom/customFieldSidebar/customFieldSidebarComponent/textareaComponent.vue";
    import NumberComponent from "../../../atom/customFieldSidebar/customFieldSidebarComponent/numberComponent.vue";
    import EmailComponent from "../../../atom/customFieldSidebar/customFieldSidebarComponent/emailComponent.vue";
    import FormulaComponent from "../../../atom/customFieldSidebar/customFieldSidebarComponent/formulaComponent.vue";
    import RollupComponent from "../../../atom/customFieldSidebar/customFieldSidebarComponent/rollupComponent.vue";
    import FieldTaskTypesPicker from "../../../atom/FieldTaskTypesPicker/FieldTaskTypesPicker.vue";
    import { fieldProjectIds } from "@/plugins/customFieldView/taskTypeOptions";
    import { useToast } from "vue-toast-notification";
    import { useI18n } from "vue-i18n";
    const { t } = useI18n();

    const emit = defineEmits(['handleFunction','tabIndexUpdate','closeSidebar']);
    const $toast = useToast();

    const props = defineProps({
        tabIndex:{
            type: Number,
            default:1
        },
        componentDetail:{
            type: Object,
            default:() => {}
        },
        customFieldObject:{
            type: Object,
            default:() => {}
        },
        isType:{
            type:Boolean,
            default:false
        }
    });

    const myForm = ref();
    const submitted = ref(false);
    const childRef = ref();
    const taskTypes = ref([]);
    const forTasks = !inject('customFieldForProject', false) && props.customFieldObject?.type !== 'project';

    /* Settings (isType) saves a new field company-wide; a task panel or a List saves it to the project it is open in. */
    const hostProject = inject('selectedProject', null);
    const taskTypeProjectIds = computed(() => {
        if (props.customFieldObject?._id) return fieldProjectIds(props.customFieldObject);
        return props.isType ? [] : fieldProjectIds({ projectId: unref(hostProject)?._id });
    });

    watch(() => props.customFieldObject?.fieldTaskTypes, (stored) => { taskTypes.value = [...(stored || [])]; }, { immediate: true });

    /* Only a field that has or gets task types sends the list, so the other callers of this form save what they always did. */
    const withTaskTypes = (val) => {
        if (!forTasks || val?.type === 'project' || !(taskTypes.value.length || props.customFieldObject?.fieldTaskTypes?.length)) return val;
        return { ...val, fieldTaskTypes: [...taskTypes.value] };
    };

    const handleSubmit = async (object) => {
        if(props.componentDetail.cfType == "text" || props.componentDetail.cfType == "textarea" || props.componentDetail.cfType == "number") {
            if(object.fieldEntryLimits.length && object.fieldMinimum === '' && object.fieldMaximum === ''){
                $toast.error(t("Toast.At_least_one_field_is_required"),{position: 'top-right'});
                return;
            }
        }
        if(props.componentDetail.cfType == "text" || props.componentDetail.cfType == "textarea") {
            if(object.fieldMinimum && object.fieldMaximum && Number(object.fieldMaximum) < Number(object.fieldMinimum)){
                return;
            }
        }
        childRef.value.handleSubmitComp(object);
        await new Promise((r) => setTimeout(r, 1000));
        submitted.value = true;
    };

    const handleTabCheck = () => {
       emit('closeSidebar',false)
    };

    const handleTab = () => {
        const node = myForm.value.node;
        childRef.value.handleTabComp(node);
    };

    /* A field in error can sit on a tab that is not shown, where its message cannot be seen. */
    const showFirstError = async (form) => {
        let invalid = null;
        form.walk((child) => {
            if (!invalid && child.type === 'input' && child.context?.state.valid === false) invalid = child;
        });
        const holder = invalid && document.getElementById(invalid.props.id);
        if (!holder) return;
        const tab = Number(holder.closest('[data-field-tab]')?.dataset.fieldTab);
        if (tab) emit('tabIndexUpdate', tab);
        await nextTick();
        (holder.matches('input, textarea, select') ? holder : holder.querySelector('input, textarea, select'))?.focus();
    };

    const getView = (val) => {
        switch(val) {
            case 'text':
                return TextComponent;           
            case 'checkbox':
                return CheckboxCustomField;
            case 'dropdown':
                return DropdownCustomField;
            case 'date':
                return DateComponentCF;        
            case 'money':
                return MoneyComponent;
            case 'textarea':
                return TextareaComponent;
            case 'number':
                return NumberComponent;
            case 'phone':
                return PhoneComponent;
            case 'email':
                return EmailComponent;
            case 'formula':
                return FormulaComponent;
            case 'rollup':
                return RollupComponent;
        }
    };
</script>
<style scoped>
    @import "./style.css"; 
</style>
