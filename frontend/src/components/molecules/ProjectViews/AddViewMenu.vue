<template>
    <DropDown ref="menu" id="embeddropdown" mode="dialog" :aria-label="$t('Projects.add_view')" maxHeight="80vh" :bodyClass="{'embed__dropdown': true}" @isVisible="onVisible">
        <template #button="{ triggerAttrs }">
            <button type="button" v-bind="triggerAttrs" class="ph2__tab ph2__tab--add d-flex align-items-center justify-content-center">
                <img :src="addIcon" alt="" aria-hidden="true" class="mr-10px">
                <span>{{ $t('Projects.add_view') }}</span>
            </button>
        </template>
        <template #options>
            <ViewsDropdown :projectData="projectData" :tourId="tourId" @closeDropdown="close" />
        </template>
    </DropDown>
</template>

<script setup>
import { onBeforeUnmount, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import DropDown from '@/components/molecules/DropDown/DropDown.vue';
import ViewsDropdown from './ViewsDropdown.vue';

defineOptions({ name: 'AddViewMenu' });

const props = defineProps({
    projectData: { type: Object, default: () => ({}) },
    activeView: { type: String, default: '' },
    tourId: { type: String, default: '' }
});

const addIcon = require('@/assets/images/Shape 614.png');
const OTHER_PANELS = '.drop-down-menu, .custom-drop-down-menu';

const route = useRoute();
const menu = ref(null);

const close = () => menu.value?.close();

// View tabs and other header controls sit above the backdrop and stop their clicks, so the press is caught before it reaches them.
function onPressOutside(event) {
    const target = event.target;
    if (!(target instanceof Element) || document.body.classList.contains('driver-active')) return;
    if (menu.value?.$el?.contains(target) || target.closest(OTHER_PANELS)) return;
    close();
}

function onVisible(visible) {
    if (visible) document.addEventListener('pointerdown', onPressOutside, true);
    else document.removeEventListener('pointerdown', onPressOutside, true);
}

watch(() => route?.fullPath, close);
watch(() => props.activeView, close);

onBeforeUnmount(() => document.removeEventListener('pointerdown', onPressOutside, true));
</script>
