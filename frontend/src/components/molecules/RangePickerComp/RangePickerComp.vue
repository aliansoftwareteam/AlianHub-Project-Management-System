<template>
    <div class="range-picker">
        <CalenderCompo
            :hideExtraLayouts="['time' ,'minutes' , 'hours' , 'seconds']"
            menuClass="calender-menu-class-range-picker"
            :disabledDates="validate !== false ? disableDates : []"
            :range="true"
            position="left"
            :hideCalenderIcon="true"
            :hideClearButton="true"
            @update:model-value="($event) => {$emit('SelectedDate', {dateVal:$event})}"
            :modelValue="null"
            :clearable="clearable"
            :preSelectable="preSelectable"
            :preSelectType="preSelectType"
            :message="message"
        >
        </CalenderCompo>
    </div>
</template>

<script setup>
//Imports
import { defineComponent,defineEmits,defineProps, ref } from 'vue';
import CalenderCompo from '@/components/atom/CalenderCompo/CalenderCompo.vue';
defineEmits(['SelectedDate'])
const props = defineProps({
    isValidate: {
        type: Boolean,
        default: true
    },
    clearable : {
        type: Boolean,
        default: false
    },
    preSelectable: {
        type: Boolean,
        default: true
    },
    preSelectType: {
        type: String,
        default: "month"
    },
    message: {
        type: String,
        default: ""
    }
});
const validate = ref(props.isValidate);
const disableDates = (date) => {
    const today = new Date();
    return date > today;
};
//Define Emits, Props, & Refs
defineComponent({
    components: { CalenderCompo }
})
</script>
<style>
.range-picker{
    width: 24% !important;
}
.calender-menu-class-range-picker .dp__arrow_top {
    left: 15%;
    top: -1px;
    height: 8px;
    width: 8px;
}
.calender-menu-class-range-picker .dp__arrow_bottom{
    left: 15%;
    bottom: -1px;
    height: 8px;
    width: 8px;
}
.timesheet__wrapper .range-picker.rangeComp {
    min-width: 265px !important;
    width: fit-content !important;
}
</style>