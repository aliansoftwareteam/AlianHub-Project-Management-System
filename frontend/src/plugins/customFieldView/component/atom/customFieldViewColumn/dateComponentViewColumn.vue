<template>
    <div class="formkit__content-view-column">
        <div class="formkit-wrapper">
            <div>
                <CalenderCompo
                    :format="props.detail?.fieldDateFormate"
                    :modelValue="props.detail?.fieldValue ? props.detail?.fieldValue : ''"
                    :minDate="props.detail.fieldPastFuture.includes('Future') ? props.detail.fieldPastFuture.includes('Future') && props.detail.fieldPastFuture.includes('Past') ? '' : new Date(new Date().setHours(0,0,0,0)) : !props.detail.fieldPastFuture.includes('Future') && !props.detail.fieldPastFuture.includes('Past') ? new Date(new Date().setHours(0,0,0,0)) : ''"
                    :maxDate="props.detail.fieldPastFuture.includes('Past') ? props.detail.fieldPastFuture.includes('Future') && props.detail.fieldPastFuture.includes('Past') ? '' : new Date(new Date().setHours(23,23,59)) : !props.detail.fieldPastFuture.includes('Past') && !props.detail.fieldPastFuture.includes('Future') ? new Date(new Date().setHours(23,23,59)) : ''"
                    :daysWeekDisable="props.detail.fieldDaysDisable"
                    @update:modelValue="($event) => emit('blurUpdate',$event,props.detail)"
                    :isShowDateAndicon="true"
                    :hideExtraLayouts="props.detail.fieldTimeFormate ? [] : ['time' ,'minutes' , 'hours' , 'seconds']"
                    :timeFormate="props.detail.fieldTimeFormate ? props.detail.fieldTimeFormate === 'AM/PM' ? false : true : false"
                    :showTimeFormate="props.detail.fieldTimeFormate ? true : false"
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
    import { ref } from 'vue';
    const props = defineProps({
        detail:{
            type:Object,
            default:() => {}
        }
    });
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
