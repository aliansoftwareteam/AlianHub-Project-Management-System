<template>
    <div class="formkit__content-view-column" v-if="render">
        <!-- <div class="formkit-inner"> -->
        <div class="d-flex justify-content-between w-100">
            <a v-if="!items?.length && !checkDefault.length" class="formkit-input cursor-pointer text-ellipse d-block text-center custom-ellipse-text" @click="isVisible = true">{{ detail.fieldPlaceholder }}</a>
            <div class="d-flex" v-else>
                <div class="dropdown-component-view-column-font-size-12 dropdown-component-view-column-font-weight-400 cursor-pointer" v-for="(item) in items && items.length ? items || [] : checkDefault || []" :key="item.id" @click="isVisible = true">
                    <p class="d-block border-radius-15-px p3x-14px text-ellipse d-block text-center custom-ellipse-text" :style="[{ color: item.color, backgroundColor: item.color + '20' }]">
                        {{ item.label }}
                    </p>
                </div>
            </div>
        </div>
        <!-- </div> -->
        <Sidebar
            v-model:visible="isVisible"
            :title="`Select ${detail.fieldTitle}`"
            :enable-search="true"
            :options="detail.fieldOptions || []"
            @selected="selectedObj($event)"
            :zIndex="8"
            :listenKeys="true"
        />
    </div>
</template>

<script setup>
// Packages
import { ref, defineProps, defineEmits, onMounted,watch, nextTick } from "vue";

// Components
import Sidebar from '@/components/molecules/Sidebar/Sidebar.vue';

// Props
const props = defineProps({
    detail: {
        type: Object,
        default: () => {}
    }
});

// Emits
const emit = defineEmits(['blurUpdate']);

// Variables
const isVisible = ref(false);
const details = ref(props.detail);
const items = ref([]);
const checkDefault = ref([]);
const render = ref(true);


// Watches
watch(() => props.detail, (newVal) => {
    items.value = JSON.parse(JSON.stringify(newVal?.fieldOptions))?.filter(x => newVal?.fieldValue?.includes(x.id)) || [];
    checkDefault.value = JSON.parse(JSON.stringify(newVal?.fieldOptions))?.filter((x) => x.selected === true) || [];
    details.value = newVal;
});

// Initialize data
onMounted(() => {
    render.value = false;
    nextTick(()=>{
        if(props.detail && props?.detail?.fieldValue) {
            details.value = props.detail;
            items.value = JSON.parse(JSON.stringify(props.detail?.fieldOptions)).filter(x => props.detail?.fieldValue?.includes(x.id)) || [];
        }
        checkDefault.value = JSON.parse(JSON.stringify(props.detail?.fieldOptions)).filter((x) => x?.selected === true) || [];
        render.value = true;
    });
})

// This function is used to get selected option from sidebar
const selectedObj = (obj) => {
    items.value = props.detail?.fieldOptions.filter(x => x.id === obj.id);
    emit('blurUpdate', obj, props.detail, "");
}
</script>

<style scoped>
.dropdown-component-view-column-font-size-12 {
    font-size: 12px;
}
.dropdown-component-view-column-font-weight-400 {
    font-weight: 400 !important;
}
</style>
