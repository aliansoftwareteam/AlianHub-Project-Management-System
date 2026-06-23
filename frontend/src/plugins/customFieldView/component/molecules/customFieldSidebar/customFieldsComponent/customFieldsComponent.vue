<template>
    <FormKit
        type="form"
        :form-class="submitted ? 'hide' : 'show'"
        @submit="handleSubmit"
        :actions="false"
        ref="myForm"
    >
        <component
            :is="getView(props.componentDetail.cfType)"
            :tabIndex="props.tabIndex"
            :componentDetail="props.componentDetail"
            :customFieldObject="props.customFieldObject"
            @handleFunction="(val,isEdit) => emit('handleFunction',val,isEdit)"
            @tabIndexUpdate="(val) => emit('tabIndexUpdate',val)" 
            ref="childRef"
            :isType="isType"
        />
        <div class="custom_field-btn">
            <FormKit type="button" @click="handleTabCheck" :label="$t('Projects.cancel')" />
            <FormKit type="submit" @click="handleTab" :label="$t('Projects.save')" :disabled="submitted" />
        </div>
    </FormKit>
</template>

<script setup>
    //import
    import { ref} from "vue";
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
    import { useToast } from "vue-toast-notification";
    import { useI18n } from "vue-i18n";
    const { t } = useI18n();

    //emit
    const emit = defineEmits(['handleFunction','tabIndexUpdate','closeSidebar']);
    const $toast = useToast();

    //props
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

    // ref
    const myForm = ref();
    const submitted = ref(false);
    const childRef = ref();

    //function
    // save function
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

    // cancel function
    const handleTabCheck = () => {
       emit('closeSidebar',false)
    };

    // tab validation check
    const handleTab = () => {            
        const node = myForm.value.node;
        childRef.value.handleTabComp(node);
    };

    //component
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
