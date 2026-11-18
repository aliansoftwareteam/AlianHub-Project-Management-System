<template>
    <textarea v-model="fileContent" readonly rows="10" ref="textRef" class="previewer_sj text-previewer-style-scroll">
    </textarea>
</template>

<script setup>
import { onMounted, ref, defineProps, defineEmits, watch } from 'vue';
import { apiRequest } from '@/services';

const props = defineProps({
    url: {
        type: String,
        required: false
    }
})

const emits = defineEmits(["load", "error"]);

const fileContent = ref('');
const textRef = ref();

async function fetchFileContent(url) {
  if (url) {
    try {
      fileContent.value = '';
      const response = await apiRequest('get', url, {
        responseType: 'text',
      });

      const val = response.data?.trim?.() || '';
      fileContent.value = val;

      emits('load', val);
    } catch (error) {
      emits('error', error);
      console.error('Error fetching file:', error);
    }
  }
}

watch(() => props.url, (newUrl) => {
    fetchFileContent(newUrl);
});

onMounted(() => {
    fetchFileContent(props.url);
});
</script>

<style lang="css" scoped>
@import url("./style.css");
</style>

<style scoped>
.text-previewer-style-scroll::-webkit-scrollbar-track {
    background-color: var(--canvas);
}
.text-previewer-style-scroll::-webkit-scrollbar {
    width: 2px;
    height: 2px;
    background-color: var(--canvas);
    border-radius: 8px;
}
.text-previewer-style-scroll::-webkit-scrollbar-thumb {
    background-color: var(--ink-3);
    border-radius: 8px;
}
</style>
