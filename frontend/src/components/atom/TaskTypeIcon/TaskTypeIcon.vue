<template>
    <!-- Library icon (Iconify). Gated on `ready` so the curated sets are
         registered before render → resolves offline, never hits the CDN.
         Unknown names fall back to DEFAULT_ICON (which is always loaded). -->
    <template v-if="isLibrary">
        <Icon v-if="ready" v-bind="$attrs" class="tticon--lib" :icon="effectiveIcon" :color="iconColor" />
        <span v-else v-bind="$attrs" class="tticon__placeholder tticon--lib" />
    </template>
    <!-- Uploaded icon stored as a full URL. -->
    <img
        v-else-if="isHttp"
        v-bind="$attrs"
        :src="taskType.taskImage"
        :alt="taskType?.name || 'task_type'"
        :title="taskType?.name || ''"
    >
    <!-- Uploaded icon stored as a storage path → resolve via WasabiImage. -->
    <WasabiImage
        v-else
        v-bind="$attrs"
        :data="{ url: taskType?.taskImage, title: taskType?.name }"
    />
</template>

<script setup>
// Single renderer for a task type's icon, covering all three kinds:
//   library (Iconify name) | uploaded http URL | uploaded storage path.
// Centralizes the previously-duplicated `taskImage.includes('http')` idiom.
import { computed, ref, watch } from 'vue';
import { Icon, iconLoaded } from '@iconify/vue';
import WasabiImage from '@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue';
import { loadIconSets, isLoaded, DEFAULT_ICON, DEFAULT_ICON_COLOR } from '@/utils/iconLibrary';

defineOptions({ inheritAttrs: false });

const props = defineProps({
    // Task-type / status object: { iconType, iconValue, iconColor, taskImage, name }
    taskType: { type: Object, default: () => ({}) },
});

const isLibrary = computed(() => props.taskType?.iconType === 'library' && !!props.taskType?.iconValue);
const isHttp = computed(() => !!props.taskType?.taskImage && props.taskType.taskImage.includes('http'));
const iconColor = computed(() => props.taskType?.iconColor || DEFAULT_ICON_COLOR);

// Only pass an icon name that is actually loaded → prevents any API lookup for
// an unknown name, and gives a clean fallback.
const effectiveIcon = computed(() =>
    (ready.value && iconLoaded(props.taskType?.iconValue)) ? props.taskType.iconValue : DEFAULT_ICON);

const ready = ref(isLoaded());
watch(isLibrary, (lib) => {
    if (lib && !ready.value) {
        loadIconSets().then(() => { ready.value = true; }).catch(() => {});
    }
}, { immediate: true });
</script>

<style scoped>
/* Library (Iconify) icons render as crisp SVG, so we size them a bit larger and
   uniformly for legibility — !important so it wins over the many small legacy
   per-call-site classes/inline styles (e.g. 13–14px task__type-image). Does not
   affect uploaded images (they don't get this class). */
.tticon--lib {
    width: 17px !important;
    height: 17px !important;
    vertical-align: middle;
    flex: none;
}
.tticon__placeholder {
    display: inline-block;
}
</style>
