<template>
    <div :class="props.isProjectDetail ? 'formkit__content-wrapper-project-detail' : 'formkit__content-wrapper'">
        <div class="formkit-wrapper">
            <div class="formkit-label__wrapper">
                <label class="formkit-label">
                    <img class="custom__field-image" :src="getImageData(props.detail.fieldImageGrey)">
                    <ToolTip :label="props?.detail?.fieldTitle" :text="props?.detail?.fieldDescription" :showReadMore="true" width="150px" />
                </label>
                <span>
                    <img @click="handleEdit" :src="editIconImage" class="formkit-label__image pr-22px cursor-pointer" />
                </span>
            </div>
            <div class="formkit-inner formkit__content-padding">
                <CalenderCompo
                    :format="props.detail?.fieldDateFormate"
                    :modelValue="props.detail?.fieldValue ? props.detail?.fieldValue : ''"
                    :minDate="limits.minDate"
                    :maxDate="limits.maxDate"
                    :daysWeekDisable="props.detail?.fieldDaysDisable || []"
                    @update:modelValue="($event) => emit('blurUpdate',$event,props.detail)"
                    :isShowDateAndicon="true"
                    :valueAsText="true"
                    :hideExtraLayouts="props.detail.fieldTimeFormate ? [] : ['time' ,'minutes' , 'hours' , 'seconds']"
                    :timeFormate="props.detail.fieldTimeFormate ? props.detail.fieldTimeFormate === 'AM/PM' ? false : true : false"
                    :showTimeFormate="props.detail.fieldTimeFormate ? true : false"
                    @outsideClick="handleOutside"
                    @handleSubmit="handleSubmit"
                    :isTask="true"
                    :position="`left`"
                />
            </div>
            <div v-if="validationError" class="position-ab formkit__error-message">
                {{ $t('CustomField.field_is_required', { field: props.detail.fieldTitle }) }}
            </div>
        </div>
    </div>
</template>

<script setup>
    import CalenderCompo from '@/components/atom/CalenderCompo/CalenderCompo.vue';
    import { dateFieldLimits } from '@/plugins/customFieldView/dateFieldLimits';
    import ToolTip from "@/components/molecules/ToolTip/ToolTip.vue";
    import { computed, ref } from 'vue';
    import useCustomFieldImage from '@/composable/customFieldIcon.js';
    const { getImageData } = useCustomFieldImage();
    const props = defineProps({
        detail:{
            type:Object,
            default:() => {}
        },
        isProjectDetail:{
            type: String,
            default: ''
        }
    });
    const limits = computed(() => dateFieldLimits(props.detail));
    const emit = defineEmits(['blurUpdate','handleEdit']);
    const editIconImage = require("@/assets/images/editing.png");
    const validationError = ref(false);
    const handleOutside = () => {
        if(props.detail.fieldRequired && props.detail.fieldRequired.length){
            validationError.value = true;
        }else{
            validationError.value = false;
        }
    }
    const handleSubmit = () => {
        validationError.value = false;
    }
    const handleEdit = () => {
        emit('handleEdit',props?.detail)
    }
</script>
<style scoped>
    .formkit__content-wrapper input::placeholder{
        color: var(--ink-2) !important;
        font-family: var(--font-ui);
        font-size: 13px;
        font-style: normal;
        font-weight: 400;
        line-height: 19.24px;
    }
    .formkit__content-wrapper .formkit__error-message {
        left: 9px;
        bottom: -1px;
        color: var(--danger);
        font-size: 11px;
    }
</style>
