<template>
    <div class="formkit__content-view-column" :id="Id">
        <CheckboxComponent v-model="checkboxValue" @click="handleClick" customClasses="custom-field__checkbox" />
    </div>
</template>

<script setup>
    // Packages
    import { ref, defineProps, defineEmits, watch} from "vue";
    import { useCustomComposable } from "@/composable";
    import CheckboxComponent from "@/components/atom/Checkbox/CheckboxComponent.vue";

    const { makeUniqueId } = useCustomComposable();

    // Props
    const props = defineProps({
        detail: {
            type: Object,
            default: () => {}
        },
        customFieldId:{
            type:String,
            default:''
        }
    });

    // Emits
    const emit = defineEmits(['blurUpdate']);

    // Variables
    const Id = ref(makeUniqueId(5));
    const checkboxValue = ref(props.detail?.fieldValue ? props.detail?.fieldValue : false);
    watch(() => props.detail?.fieldValue,(val)=>{
        checkboxValue.value = val;
    });
    const handleClick = () => {
        checkboxValue.value =! checkboxValue.value;
        emit('blurUpdate',checkboxValue.value,props.detail,Id.value);
    };
</script>
<style>
    .main-checkbox-component input.custom-field__checkbox[type=checkbox]{
        border: 1px solid var(--ink-3);
    }
    .main-checkbox-component input.custom-field__checkbox[type=checkbox]:before{
        border: none;
    }
    .main-checkbox-component input.custom-field__checkbox[type=checkbox]:checked {
        background-position: center;
        background-repeat: no-repeat;
        background-image: url('@/assets/images/png/right_check.png');
    }
</style>