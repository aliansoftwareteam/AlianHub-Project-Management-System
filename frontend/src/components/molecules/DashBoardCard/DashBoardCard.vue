<template>
  <div class="my-component dashboard-container" ref="containerRef" style="overflow:hidden;">
    <div class="cardHeader">
      <span class="font-size-18 font-weight-bold text-ellipsis dashboard-card-title" :title="title">{{ title }}</span>
      <span class="cursor-pointer dashboard-container-setting-controller">
        <!-- Inline time-period selector — only when the parent passes
             periodOptions. Sits BEFORE the refresh/settings icons. -->
        <select
          v-if="periodOptions && periodOptions.length"
          class="dashboard-period-select mr-10px"
          :value="periodValue"
          title="Time period"
          @click.stop
          @change="$emit('period-change', $event.target.value)"
        >
          <option v-for="opt in periodOptions" :key="opt.id" :value="opt.id">{{ opt.label }}</option>
        </select>
        <!-- Refresh icon — only renders when the parent passes showRefresh.
             Sits BEFORE the settings (edit) icon per design spec. -->
        <svg
          v-if="showRefresh"
          class="mr-10px dashboard-refresh-icon"
          width="14" height="14"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          title="Refresh"
          @click.stop="$emit('refresh-card', id)"
        >
          <path d="M21 12a9 9 0 1 1-3-6.7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M21 3v6h-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <img :src="editIcon" style="height:14px;width:14px;" class="mr-10px" @click="$emit('edit-card', id)"/>
        <img :src="closeIcon" @click="$emit('delete-card', id)"/><!-- Emit event -->
      </span>
  </div>
  <div class="content">
    <slot></slot>
  </div>
</div>
</template>

<script setup>
import { defineProps, defineEmits, onMounted, ref, provide, onUnmounted} from 'vue';
const closeIcon = require("@/assets/images/svg/CloseSidebar.svg");
const editIcon = require("@/assets/images/svg/Setting_icon.svg");
defineProps({
  title: {
    type:String,
    default: ""
  },
  id: {
    type:String,
    default: ''
  },
  componentId : {
    type: String,
    default: ''
  },
  // When true, renders a refresh icon in the card chrome (before the
  // settings icon). The parent listens to @refresh-card to act on it.
  showRefresh: {
    type: Boolean,
    default: false,
  },
  // Optional inline time-period selector shown in the header (before the
  // refresh/settings icons). When periodOptions is non-empty a <select>
  // renders; the parent listens to @period-change.
  periodOptions: {
    type: Array,
    default: () => [],
  },
  periodValue: {
    type: [Number, String],
    default: '',
  },
});
const containerRef = ref(null)
const containerWidth = ref(0)
let resizeObserver = null;
onMounted(() => {
  if (containerRef.value) {
    resizeObserver = new ResizeObserver(([entry]) => {
      containerWidth.value = entry.contentRect.width
    })
    resizeObserver.observe(containerRef.value)
  }
})

onUnmounted(() => {
  if (resizeObserver && containerRef.value) {
    resizeObserver.unobserve(containerRef.value);
    resizeObserver.disconnect();
  }
})
provide("$containerWidth", containerWidth);
defineEmits(['delete-card','edit-card','refresh-card','period-change']); // Define delete-card event
</script>



<style scoped>
.my-component {
  height: 100%;
  padding: 20px;
  background-color: #ffffff;
  border: 1px solid #f0f0f0;
  border-radius: 10px;
}
h2 {
  margin: 0;
  font-size: 1.5em;
}
.content {
  margin-top: 8px;
  height: calc(100% - 35px);
}
.cardHeader {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.dashboard-card-title {
  flex: 1 1 auto;
  min-width: 0; /* let the title ellipsize instead of pushing the controls out */
}
.dashboard-container {
  container-type: inline-size; /* Enables container queries */
  container-name: dashboard; /* This name is referenced in @container */
  box-shadow: 0px 4px 12px rgba(0, 0, 0, 0.08);
}
.dashboard-container-setting-controller {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  flex-shrink: 1;
}
/* Icons keep their size; only the period <select> absorbs the shrink. */
.dashboard-container-setting-controller img,
.dashboard-container-setting-controller svg {
  flex-shrink: 0;
}
.dashboard-period-select {
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  color: #3a3f52;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 3px 24px 3px 8px;
  max-width: 130px;
  min-width: 56px;
  flex-shrink: 1;
  background-color: #fff;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%235a6478' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>");
  background-repeat: no-repeat;
  background-position: right 7px center;
  -webkit-appearance: none;
  -moz-appearance: none;
  appearance: none;
  cursor: pointer;
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.dashboard-period-select:hover {
  border-color: #c7ccd9;
}
.dashboard-period-select:focus {
  border-color: #2F3990;
  box-shadow: 0 0 0 2px rgba(47, 57, 144, 0.12);
}
.dashboard-refresh-icon {
  color: #5a6478;
  cursor: pointer;
  transition: color 0.15s ease, transform 0.3s ease;
  display: inline-block;
  vertical-align: middle;
}
.dashboard-refresh-icon:hover {
  color: #2F3990;
  transform: rotate(90deg);
}
</style>
