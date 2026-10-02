<template>
  <div class="preview-container">
    <div v-if="!showIframe" class="progress-bar-container">
      <div
        class="process-bar"
        :style="{ width: (fileProcess > 100 ? 100 : fileProcess) + '%' }"
      ></div>
    </div>
    <iframe
      v-else
      :key="iframeKey"
      :src="viewerUrl"
      frameborder="0"
      allowfullscreen
      @load="onLoad"
      @error="onError"
      class="excel-preview-iframe"
    ></iframe>
   
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';

const emit = defineEmits(['load', 'error']);
const props = defineProps({ url: { type: String, required: true } });

const iframeKey = ref(0);
const showIframe = ref(false);
const fileProcess = ref(0);

const viewerUrl = computed(() => {
  return props.url
    ? `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(props.url)}`
    : '';
});

watch(
  () => props.url,
  (newUrl, oldUrl) => {
    if (newUrl && newUrl !== oldUrl) {
      showIframe.value = false;
      iframeKey.value += 1;
      fileProcess.value = 0;
      showIframe.value = true;

      const interval = setInterval(() => {
        fileProcess.value += 5;
        if (fileProcess.value >= 95) clearInterval(interval);
      }, 100);
    }
  },
  { immediate: true }
);

function onLoad(e) {
  fileProcess.value = 100;
  emit('load', e);
}

function onError(e) {
  emit('error', e);
}
</script>
<style scoped>
  .preview-container {
    max-width: 100%;
    width: 100%;
    height: 100%;
  }
  .excel-preview-iframe {
    width: 100%;
    height: 100%;
    border: none;
  }
  .progress-bar-container {
    width: 100%;
    height: 4px;
    background: var(--track);
    position: relative;
    border-radius: 4px;
    overflow: hidden;
  }
  .process-bar {
    height: 100%;
    background: var(--brand);
    transition: width 0.2s;
  }
</style>