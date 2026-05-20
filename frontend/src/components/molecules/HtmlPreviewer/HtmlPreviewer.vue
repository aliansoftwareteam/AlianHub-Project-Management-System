<template>
    <div class="preview-container" ref="previewContainer">
      <div class="preview-buttons">
        <label class="toggle-switch">
          <input type="checkbox" v-model="viewMode" true-value="html" false-value="code">
          <span class="switch-slider">
            <span class="slider-icon">
              <img v-if="viewMode === 'html'" :src="playIconGray" alt="Play Icon" />
              <img v-else :src="CodeIcon" alt="Code Icon" class="code" />
            </span>
          </span>
        </label>
      </div>

      <div v-if="viewMode === 'html'" v-html="sanitizedFileContent" class="html-previewer style-scroll"></div>

      <textarea v-else v-model="fileContent" readonly ref="textRef" class="code-previewer style-scroll"></textarea>
    </div>
</template>

<script setup>
import { onMounted, ref, computed, defineProps, defineEmits, watch, nextTick } from 'vue';
import playIconGray from '@/assets/images/svg/PriorityIcon/playiconGray.svg';
import CodeIcon from '@/assets/images/png/codeIcon.png';
import { apiRequest } from '@/services';
import { sanitizeHtml } from '@/utils/sanitizeHtml';

  const props = defineProps({
    url: {
      type: String,
      required: true,
    },
  });

  const emits = defineEmits(['load', 'error']);

  const fileContent = ref('');
  const viewMode = ref('html');
  const textRef = ref();

  const sanitizedFileContent = computed(() => sanitizeHtml(fileContent.value));


  const previewContainer = ref(null);
  let savedScrollTop = 0;

  watch(viewMode, async (newVal, oldVal) => {
    if (oldVal === 'code') {
      savedScrollTop = previewContainer.value?.scrollTop || 0;
    }

    await nextTick();

    if (newVal === 'html') {
      previewContainer.value.scrollTop = savedScrollTop;
    }
  });

  function fetchHtmlFile(url) {
    if (url) {
      apiRequest("get", url, { responseType: "text" })
        .then(response => {
          fileContent.value = response.data?.trim?.() || "";
          emits('load', fileContent.value);
        })
        .catch(err => {
          emits('error', err);
          console.error('Error fetching file:', err);
        });
    }
  }
  onMounted(() => {
   fetchHtmlFile(props.url);
  });

  watch(
    () => props.url,
    (newUrl) => {
      fetchHtmlFile(newUrl);
    }
  );

</script>

<style scoped>
  .preview-container {
    border: 1px solid #ccc;
    background: #fff;
    padding: 5px 12px 12px 12px;
    max-width: 100%;
    width: 100%;
    height: 100%;
  }

  .preview-buttons {
    display: flex;
    justify-content: end;
    gap: 10px;
    margin-bottom: 10px;
  }

  .toggle-switch {
    position: relative;
    display: inline-block;
    width: 55px;
    height: 25px;
  }

  .toggle-switch input {
    opacity: 0;
    width: 0;
    height: 0;
  }

  .switch-slider {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: #ccc;
    transition: 0.4s;
    border-radius: 34px;
    overflow: hidden;
  }

  .switch-slider:before {
    position: absolute;
    content: "";
    height: 20px;
    width: 20px;
    left: 6px;
    bottom: 2px;
    background-color: white;
    transition: 0.4s;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1;
  }

  .slider-icon {
    position: absolute;
    left: 6px;
    top: 50%;
    transform: translateY(-50%);
    transition: 0.4s;
    z-index: 2;
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }

  .slider-icon img,
  .slider-icon span {
    object-fit: contain;
    transition: 0.4s;
  }

  .slider-icon .code {
    width: 16px;
    height: 16px;
  }

  input:checked+.switch-slider {
    background-color: #2196F3;
  }

  input:checked+.switch-slider:before {
    transform: translateX(26px);
  }

  input:checked+.switch-slider .slider-icon {
    left: 32px;
  }

  input:checked+.switch-slider .slider-icon img,
  input:checked+.switch-slider .slider-icon span {
    color: white;
    filter: brightness(1) invert(1);
  }

  .html-previewer {
    min-height: 300px;
    overflow: auto;
    padding: 10px;
    border: 1px solid #ccc;
    height: calc(100% - 52px);
  }

  .code-previewer {
    width: 100%;
    height: calc(100% - 52px);
    min-height: 300px;
    border: 1px solid #ccc;
    font-family: monospace;
    padding: 10px;
  }
</style>