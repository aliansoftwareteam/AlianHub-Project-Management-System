<template>
    <div v-if="group.loading" class="evr__skeleton" data-test="evr-group-loading" aria-hidden="true">
        <span v-for="n in skeletonRows" :key="n" class="evr__skeleton-row"></span>
    </div>
    <div v-else-if="group.failed" class="evr__group-error" role="alert">
        <span>{{ $t('Everything.group_failed') }}</span>
        <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="$emit('load')">{{ $t('Everything.retry') }}</button>
    </div>
    <button v-else-if="more" type="button" class="ah-btn ah-btn--ghost ah-btn--sm evr__more" data-test="evr-more" @click="$emit('load')">
        {{ $t('Everything.load_more') }}
    </button>
</template>

<script setup>
import { computed } from "vue";

defineOptions({ name: "EverythingGroupFoot" });

const SKELETON_MAX = 3;

const props = defineProps({
    group: { type: Object, required: true },
    more: { type: Boolean, default: false }
});
defineEmits(["load"]);

const skeletonRows = computed(() => Math.max(1, Math.min(SKELETON_MAX, props.group.count - props.group.rows.length)));
</script>
