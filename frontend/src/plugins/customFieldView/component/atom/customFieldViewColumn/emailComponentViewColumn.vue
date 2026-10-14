<template>
    <CustomFieldViewColumn
        v-if="props.detail?._id === props?.customFieldId"
        :type="props.detail?.fieldType"
        :bindValue="props.detail?.fieldValue"
        @inputUpdate="handleInput"
        @blurUpdate="handleBlur"
        :placeholder="props.detail?.fieldPlaceholder"
        :detail="props.detail"
        :customValidationMessage="error ? {is:`${props.detail?.fieldTitle} ${$t('authErrorMessage.must_be_a_valid_email')}`} : {}"
        :validations="error ? 'is' : props.detail?.fieldValidation"
        :isLabel="true"
        :label="props.detail?.fieldTitle"
    />
    <span
        v-else
        class="text-ellipse d-block text-center custom-ellipse-text"
        :title="props.detail?.fieldValue ? props.detail?.fieldValue : ''"
    >
        {{props.detail?.fieldValue ? props.detail?.fieldValue : '-'}}
    </span>
</template>

<script setup>
    import { ref } from "vue";
    import CustomFieldViewColumn from "../customFieldViewColumn/customFieldViewColumnInput/customFieldViewColumnInput.vue";
    
    const props = defineProps({
        detail:{
            type:Object,
            default:() => ({})
        },
        customFieldId:{
            type:String,
            default:''
        }
    });
    const emit = defineEmits(['blurUpdate']);

    const checkValue = ref('');
    const error = ref(false);
    const fieldInputValue = ref(props.detail?.fieldValue);

    const handleBlur = (value,detail,id) => {
        value = checkValue.value;
        emit('blurUpdate',value,detail,id);
    }
    const handleInput = (val) => {
        emit('inputUpdate',val);
        checkValue.value = val
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