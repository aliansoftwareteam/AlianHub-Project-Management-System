<template>
  <div class="position-re overflow-x-auto style-scroll time__bar-componenet w-auto">
    <div class="time-bar">
      <div
        v-for="(timeSlot, index) in timeSlots"
        :key="index"
        class="time-slot w-100"
        ref="scrollElement"
        :class="{ 'selected': selectedSlot === timeSlot.time,'inRange':  selectedSlot !== timeSlot.time && timeSlots[index].inRange, 'last-element': timeSlots.length -1 === index ,'cursor-pointer': timeSlots[index].inRange}"
        @click="selectSlot(timeSlot)"
        v-memo="[selectedSlot === timeSlot.time, timeSlot.inRange]"
      >
        <div class="time__slot--countwrapper">
          <div class="colorlightgray">|</div>
          <span class="time__slot--count">{{ formatTimeSlot(timeSlot.time) }}</span>
        </div>
        <div v-if="index === timeSlots?.length - 1" class="time__slot-length">
          <div class="colorlightgray else_condition">|</div>
          <span class="time__slot--count else_condition">{{timeFormat == "12" ? '12 AM' : '00:00'}}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref ,defineEmits,watch, inject} from 'vue';
import { useGetterFunctions } from "@/composable";
import moment from 'moment';
const scrollElement = ref(null);
const emit = defineEmits(["update:getSelectedRange", "toggle"]);
const props = defineProps({
  selectedSlot : {
    type: Number,
  },
  logRangeValue : {
      type : Array,
      default: () => []
  },
})
const timeSlots = ref(props.logRangeValue);
const {getUser} = useGetterFunctions()
const userId = inject('$userId');
const timeFormat = ref(getUser(userId.value).timeFormat);
watch(()=> props.logRangeValue,(newValue) => {
    timeSlots.value = newValue;
})
function selectSlot(timeSlot) {
  if(!timeSlot.inRange) return;
  timeSlot.isSelected = true;
  emit("toggle", timeSlot.time)
}
function formatTimeSlot(slot) {
  let slotTime =  (slot % 12 === 0 ? 12 : slot % 12) + (slot < 12 || slot === 24 ? ' AM' : ' PM');
  if (timeFormat.value == "24") {
      return `${moment(slotTime,"hh:mm A").format("HH:mm")}`
  } else {
      return slotTime
  }
}
</script>

<style src="./TimebarComponent.css" scoped></style>
