<template>
    <CustomFieldListing 
        :type="props.detail?.fieldType"
        :label="props.detail?.fieldTitle"
        :bindValue="props.detail?.fieldValue"
        @inputUpdate="handleInput"
        @blurUpdate="(value,detail,id) => emit('blurUpdate',value,detail,id)"
        :options="props.detail?.fieldOptions"
        :validations="error ? 'is' : props.detail?.fieldValidation"
        :placeholder="props.detail?.fieldPlaceholder"
        :detail="props.detail"
        :customValidationMessage="error ? {is: $t('CustomField.must_be_valid_email', { field: props.detail?.fieldTitle })} : {}"
        @handleEdit="(val) => emit('handleEdit',val)"
    />
</template>

<script setup>
    import CustomFieldListing from "../customFieldTaskView/customFieldListing/customFieldListing.vue";
    import { ref, watch } from "vue";
    const props = defineProps({
        detail:{
            type:Object,
            default:() => {}
        }
    });
    const fieldInputValue = ref(props.detail?.fieldValue);
    const error = ref(false);
    watch(() => props.detail?.fieldValue , (val) => {
        fieldInputValue.value = val;
    })
    const emit = defineEmits(['blurUpdate','inputUpdate','handleEdit']);
    const handleInput = (val) => {
        emit('inputUpdate',val);
        fieldInputValue.value = val;
        if(val){
            const regexPattern = /\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+/
            if (!regexPattern.test(val)) {
                error.value = true;
            }else{
                error.value = false;
            }
        }else{
            error.value = false;
        }
    }
</script>
