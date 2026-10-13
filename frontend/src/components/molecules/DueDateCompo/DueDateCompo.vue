<template>
    <div class="due-date" :id="tourId">
        <CalenderCompo
            v-model="dateValue"
            :hideExtraLayouts="['time' ,'minutes' , 'hours' , 'seconds']" 
            :isShowDateAndicon="isShowDateAndicon"
            menuClass="calender-menu-class-duedate"
            @update:model-value="($event) => {$emit('SelectedDate', {dateVal:$event, id:id})}"
            :autoposition="autoposition"
            :position="position"
            :overdue="overdue"
            :minDate="minDate"
            :maxDate="maxDate"
            :isWithoutBorderImage="isWithoutBorderImage"
            :format="format"
            :ariaLabel="label"
            :buttonLabel="buttonLabel"
            :emptyText="emptyText"
        >
        </CalenderCompo>
    </div>
</template>

<script setup>
//Import
import { ref, defineComponent, defineProps,defineEmits, watch } from 'vue';
import CalenderCompo from '@/components/atom/CalenderCompo/CalenderCompo.vue';

//Define Emits, Props, & Refs
defineComponent({
    components: { CalenderCompo }
})

defineEmits(['SelectedDate'])

const props = defineProps({
    displyDate: {
        required: true
    },
    label: {
        type: String,
        default: ''
    },
    buttonLabel: {
        type: String,
        default: ''
    },
    emptyText: {
        type: String,
        default: ''
    },
    disabledDates: {
        type: Array,
        default: () => []
    },
    id: {
        type: String,
        default: ''
    },
    isShowDateAndicon: {
        type: Boolean,
        default: false
    },
    allowTillCurrentDate: {
        type: Boolean,
        default: false
    },
    autoposition: {
        type: Boolean,
        default: true
    },
    position: {
        type: String,
        default: ''
    },
    overdue: {
        type: Boolean,
        default: false
    },
    tourId: {
        type: String,
        default: ''
    },
    minDate: {
        type: [Date , String],
        default: ''
    },
    maxDate: {
        type: [Date, String],
        default: ''
    },
    isWithoutBorderImage: {
        type: Boolean,
        default: false
    },
    format: {
        type: String,
        default: ''
    },
})
// const dateValue = ref(props.displyDate);
const dateValue = ref(props.displyDate && props.displyDate != 0 ? props.displyDate?.seconds ? new Date(props.displyDate.seconds * 1000) : (props.displyDate) : '');
// const disableDate = ref(props.disabledDates);
// const diDate = ref([])

watch(() => props.displyDate, (newVal) => {
    dateValue.value = newVal && newVal != 0 ? newVal?.seconds ? new Date(newVal.seconds * 1000) : new Date(newVal) : '';
    // disableDate.value.push({date:{seconds: newVal, nanoseconds: 0}});
    // diDate.value = [];
    // setDatesOfDis();
})

//Define Computeds
// const minDate = computed(() => {
//     if(diDate.value.length == 0) {
//         return new Date();
//     } else {
//         return new Date(Math.max.apply(null, diDate.value));
//     }
// })

//Functions that is used for display value change then set the disable date array
// function setDatesOfDis() {
//     disableDate.value.map((item) => {
//         if(item && Object.keys(item).length > 0) {
//             if(typeof item == 'string') {
//                 if(JSON.parse(item).date) {
//                     diDate.value.push(new Date(JSON.parse(item).date * 1000));
//                 }
//             } else {
//                 diDate.value.push(new Date(item.date.seconds * 1000));
//             }
//         }
//     })
// }

// onMounted(() => {
    // setDatesOfDis();
// })
</script>
<style src="./style.css">
</style>