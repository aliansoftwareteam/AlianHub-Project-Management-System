<template>
<div
    v-if="!isEditing"
    class="time-display"
    :class="{ 'time-display--readonly': !editable }"
    @click="startEditing"
>
    {{ displayTime }}
</div>
  <div class="time-entry-wrapper" ref="wrapper">
    <!-- Display formatted time when not editing -->

    <!-- Input fields when editing -->
    <div 
     v-if="isEditing" 
      class="time-inputs"
      @keydown.enter="saveTime"
      @keydown.escape="cancelEditing"
    >
      <input
        ref="hoursInput"
        type="number"
        v-model.number="editHours"
        @input="validateHours"
        @blur="handleBlur"
        min="0"
        max="99999"
        placeholder="00"
        class="time-input hours-input"
      />
      <span class="separator">:</span>
      <input
        ref="minutesInput"
        type="number"
        v-model.number="editMinutes"
        @input="validateMinutes"
        @blur="handleBlur"
        min="0"
        max="59"
        placeholder="00"
        class="time-input minutes-input"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, onUnmounted } from 'vue'

const props = defineProps({
  task: {
    type: Object,
    required: true
  },
  // false => display-only: clicking never opens the inputs. Needed so the
  // "Read" level of task.task_estimated_hours shows the value without
  // allowing edits. Defaults to true so the editable behaviour is unchanged
  // wherever the prop is not passed.
  editable: {
    type: Boolean,
    default: true
  }
})

const emit = defineEmits(['update:totalEstimatedTime'])

// Reactive references
const isEditing = ref(false)
const wrapper = ref(null)
const hoursInput = ref(null)
const minutesInput = ref(null)
const editHours = ref(0)
const editMinutes = ref(0)
const blurTimer = ref(null)

// Computed property for display time
const displayTime = computed(() => {
  const totalMinutes = props.task.totalEstimatedTime || 0
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m`
})

// Validation functions
const validateHours = () => {
  if (editHours.value > 99999) {
    editHours.value = 99999
  } else if (editHours.value < 0 || isNaN(editHours.value)) {
    editHours.value = 0
  }
}

const validateMinutes = () => {
  if (editMinutes.value > 59) {
    editMinutes.value = 59
  } else if (editMinutes.value < 0 || isNaN(editMinutes.value)) {
    editMinutes.value = 0
  }
}

// Start editing mode
const startEditing = async () => {
  if (!props.editable) {
    return // read-only permission: never enter edit mode
  }
  const totalMinutes = props.task.totalEstimatedTime || 0
  editHours.value = Math.floor(totalMinutes / 60)
  editMinutes.value = totalMinutes % 60
  
  isEditing.value = true
  
  await nextTick()
  hoursInput.value?.focus()
  hoursInput.value?.select()
}

// Save the time
const saveTime = () => {
  validateHours()
  validateMinutes()
  
  const totalMinutes = editHours.value * 60 + editMinutes.value
  emit('update:totalEstimatedTime', totalMinutes)
  isEditing.value = false
}

// Cancel editing
const cancelEditing = () => {
  isEditing.value = false
}

// Handle blur with delay to allow clicking between inputs
const handleBlur = () => {
  clearTimeout(blurTimer.value)
  blurTimer.value = setTimeout(() => {
    if (isEditing.value && !wrapper.value?.contains(document.activeElement)) {
      saveTime()
    }
  }, 150)
}

// Cleanup on unmount
onUnmounted(() => {
  clearTimeout(blurTimer.value)
})
</script>

<style scoped>
.time-entry-wrapper {
  display: inline-block;
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  font-size: 14px;
}

.time-display {
    border-radius: 7px;
    border-width: 2px;
    height: 24px;
    font-size: 13px;
    font-family: 'Roboto';
    font-style: normal;
    font-weight: 400;
    line-height: 23px;
    padding: 0px 8px 0px 8px;
    margin-left: -7px;
    cursor: pointer;
}

/* .time-display:hover {
  background: #e9ecef;
} */

/* Read-only: drop the affordance so the value does not look clickable. */
.time-display--readonly {
  cursor: default;
}

.time-inputs {
  display: flex;
  align-items: center;
  gap: 2px;
  background: white;
  border: 1px solid #cfd0d3;
  border-radius: 4px;
  padding: 4px 8px;
}

.time-input {
  width: 30px;
  padding: 4px 2px;
  border: none;
  outline: none;
  text-align: center;
  font-size: 14px;
  font-weight: 500;
  color: #495057;
  background: transparent;
}

.time-input::-webkit-outer-spin-button,
.time-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.separator {
  font-weight: bold;
  /* color: #007bff; */
  user-select: none;
}

.time-input::placeholder {
  color: #adb5bd;
}
</style>