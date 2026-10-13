<template>
    <div class="formkit__content-view-column">
        <div class="formkit-wrapper">
            <div>
                <CalenderCompo
                    :format="props.detail?.fieldDateFormate"
                    :modelValue="props.detail?.fieldValue ? props.detail?.fieldValue : ''"
                    :minDate="limits.minDate"
                    :maxDate="limits.maxDate"
                    :daysWeekDisable="props.detail?.fieldDaysDisable || []"
                    @update:modelValue="($event) => emit('blurUpdate',pickedDateValue(props.detail,$event),props.detail)"
                    :isShowDateAndicon="true"
                    :hideExtraLayouts="withTime ? [] : ['time' ,'minutes' , 'hours' , 'seconds']"
                    :timeFormate="withTime && props.detail.fieldTimeFormate !== 'AM/PM'"
                    :showTimeFormate="withTime"
                    @outsideClick="handleOutside"
                    @handleSubmit="handleSubmit"
                    :position="'left'"
                    :isEllipsis="true"
                />
            </div>
        </div>
    </div>
</template>

<script setup>
    import CalenderCompo from '@/components/atom/CalenderCompo/CalenderCompo.vue';
    import { dateFieldLimits, holdsTime, pickedDateValue } from '@/plugins/customFieldView/dateFieldLimits';
    import { computed, ref } from 'vue';
    const props = defineProps({
        detail:{
            type:Object,
            default:() => {}
        }
    });
    const limits = computed(() => dateFieldLimits(props.detail));
    const withTime = computed(() => holdsTime(props.detail));
    const emit = defineEmits(['blurUpdate']);
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
</script>
<style scoped>
    .formkit__content-wrapper input::placeholder{
        color: #505050 !important;
        font-family: var(--font-ui);
        font-size: 13px;
        font-style: normal;
        font-weight: 400;
        line-height: 19.24px;
    }
    .formkit__content-wrapper .formkit__error-message {
        left: 9px;
        bottom: -1px;
        color: red;
        font-size: 11px;
    }
</style>
