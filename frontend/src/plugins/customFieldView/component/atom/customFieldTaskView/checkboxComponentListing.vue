<template>
    <div class="dis-dropdown-custom-field" :id="Id">
        <div :class="props.isProjectDetail ? 'formkit__content-wrapper-project-detail' : 'formkit__content-wrapper'">
            <div class="">
                <div class="formkit-outer" data-family="text" data-type="text" data-empty="true">
                    <div class="formkit-wrapper">
                        <div class="formkit-label__wrapper">
                            <label class="formkit-label">
                                <img class="custom__field-image" :src="getImageData(props.detail.fieldImageGrey)">
                                <ToolTip :text="props?.detail?.fieldDescription" :showReadMore="true" :label="props?.detail?.fieldTitle" width="150px" />
                            </label>
                            <span>
                                <img @click="handleEdit" :src="editIconImage" class="formkit-label__image pr-22px cursor-pointer" />
                            </span>
                        </div>
                        <div class="formkit-inner">
                            <CheckboxComponent v-model="checkboxValue" @click="handleClick" customClasses="custom-field__checkbox" />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
    // Packages
    import { ref, defineProps, defineEmits, watch} from "vue";
    import { useCustomComposable } from "@/composable";
    import ToolTip from "@/components/molecules/ToolTip/ToolTip.vue";
    import CheckboxComponent from "@/components/atom/Checkbox/CheckboxComponent.vue";
    import useCustomFieldImage from '@/composable/customFieldIcon.js';
    const { getImageData } = useCustomFieldImage();

    const { makeUniqueId } = useCustomComposable();

    // Props
    const props = defineProps({
        detail: {
            type: Object,
            default: () => {}
        },
        isProjectDetail:{
            type: String,
            default: ''
        }
    });

    // Emits
    const emit = defineEmits(['blurUpdate','handleEdit']);

    //Image
    const editIconImage = require("@/assets/images/editing.png");

    // Variables
    const Id = ref(makeUniqueId(5));
    const checkboxValue = ref(props.detail?.fieldValue ? props.detail?.fieldValue : false);
    watch(() => props.detail?.fieldValue,(val)=>{
        checkboxValue.value = val;
    });
    // Function
    const handleEdit = () => {
        emit('handleEdit',props?.detail)
    };
    const handleClick = () => {
        checkboxValue.value =! checkboxValue.value;
        emit('blurUpdate',checkboxValue.value,props.detail,Id.value);
    };
</script>
<style>
    .main-checkbox-component input.custom-field__checkbox[type=checkbox]{
        border: 1px solid var(--border);
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