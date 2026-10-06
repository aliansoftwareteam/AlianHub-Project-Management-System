<template>
    <!-- Boundary box: a faint tint of the icon's own colour + a hairline, applied
         directly on the icon element (not a wrapper) so a light SVG stroke reads as
         a distinct, bounded badge. Styling the element itself keeps caller margins
         (ml-*, etc. arriving via $attrs) external — a wrapper would trap them inside
         the tint. --tt-color drives the tint. -->
    <!-- Layout-neutral wrapper whose only job is the hover tooltip: a `title` on an
         ancestor fires when any child is hovered, so this reliably covers the library
         SVG case (Chromium ignores a `title` attribute on an <svg> itself). $attrs +
         the boundary box stay on the inner element, so caller margins remain external. -->
    <span class="tticon" :title="taskType?.name || undefined">
        <!-- Library icon (Iconify). Gated on `ready` so the curated sets are
             registered before render → resolves offline, never hits the CDN.
             Unknown names fall back to DEFAULT_ICON (which is always loaded). -->
        <template v-if="isLibrary">
            <Icon v-if="ready" v-bind="$attrs" class="tticon--lib tticon__box" :style="boxStyle" :icon="effectiveIcon" :color="iconColor" />
            <span v-else v-bind="$attrs" class="tticon__placeholder tticon--lib tticon__box" :style="boxStyle" />
        </template>
        <!-- Uploaded icon stored as a full URL. -->
        <img
            v-else-if="isHttp"
            v-bind="$attrs"
            class="tticon__box"
            :style="boxStyle"
            :src="taskType.taskImage"
            :alt="taskType?.name || 'task_type'"
        >
        <!-- Uploaded icon stored as a storage path → resolve via WasabiImage. -->
        <WasabiImage
            v-else
            v-bind="$attrs"
            class="tticon__box"
            :style="boxStyle"
            :data="{ url: taskType?.taskImage, title: taskType?.name }"
        />
    </span>
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
// Drives the boundary-box tint; kept as a CSS var so the color-mix lives in CSS.
const boxStyle = computed(() => ({ '--tt-color': iconColor.value }));

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
/* Tooltip host. inline-flex so it hugs the icon and stays vertically centred like
   the bare icon did; no background/padding of its own → layout-neutral, the caller's
   margin on the inner icon still reads as external spacing. */
.tticon {
    /* !important: this span is TaskTypeIcon's root, so it inherits the host's scoped
       styles; an ancestor `span { display:flex }` would otherwise flip it block-level
       and push the label onto its own line. */
    display: inline-flex !important;
    vertical-align: middle;
}
/* Boundary box painted on the icon element itself. content-box so the 2px padding
   frames the icon outward instead of shrinking it, keeping each call-site's declared
   icon size intact. Tint + hairline derive from the icon's own colour via color-mix,
   so the badge always matches the icon and stays legible for pale strokes. */
/* Default size so uploaded images render even where the caller's size class lives in a
   CSS chunk that page never loads (e.g. .task__type-image ships with the task-list). */
.tticon__box {
    box-sizing: content-box;
    width: 15px;
    height: 15px;
    object-fit: contain;
    flex: none;
    padding: 2px;
    border-radius: 4px;
    vertical-align: middle;
    background: color-mix(in srgb, var(--tt-color, #2F3990) 12%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--tt-color, #2F3990) 28%, transparent);
}
/* Library (Iconify) icons render as crisp SVG, so we size them a bit larger and
   uniformly for legibility — !important so it wins over the many small legacy
   per-call-site classes/inline styles (e.g. 13–14px task__type-image). Does not
   affect uploaded images (they don't get this class). */
.tticon--lib {
    width: 15px !important;
    height: 15px !important;
    vertical-align: middle;
    flex: none;
}
.tticon__placeholder {
    display: inline-block;
}
</style>
