<template>
  <div class="my-component dashboard-container" ref="containerRef" style="overflow:hidden;">
    <div class="cardHeader">
      <span class="font-size-18 font-weight-bold text-ellipsis w-85" :title="title">{{ title }}</span>  
      <span class="cursor-pointer dashboard-container-setting-controller">
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
defineEmits(['delete-card','edit-card','refresh-card']); // Define delete-card event
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
}
.dashboard-container {
  container-type: inline-size; /* Enables container queries */
  container-name: dashboard; /* This name is referenced in @container */
  box-shadow: 0px 4px 12px rgba(0, 0, 0, 0.08);
}
.dashboard-container-setting-controller {
  min-width: 38px;
  display: inline-flex;
  align-items: center;
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
