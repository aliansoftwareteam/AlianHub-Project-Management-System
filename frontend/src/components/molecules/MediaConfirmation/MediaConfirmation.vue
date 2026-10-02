<template>
    <div class="d-flex flex-column media__component w-100 mb-10px">
        <div class="d-flex align-items-center justify-content-center">
            <div class="d-flex w-100">
                <div class="d-flex overflow-x-auto style-scroll media__component-left">
                    <div
                        v-for="(file, index) in modelValue" :key="index"
                        class="border-radius-5-px cursor-pointer position-re d-flex align-items-center justify-content-center mr-10px media__file-value"
                    >
                        <img :src="closeIcon" alt="closeIcon" class="position-ab cursor-pointer close__icon-img"  @click.stop="removeItem(index)">
                        <Image
                            :src="file.mediaURL"
                            :alt="file.mediaName"
                            :extension="file.mediaName.split('.').pop()"
                            class="media__image"
                        />
                    </div>
                </div>
                <div class="d-flex align-items-center justify-content-center border-radius-5-px cursor-pointer media__component-right" @click.stop="$emit('addNew')">
                    <span class="ah-mask-icon add__new-image" :style="maskOf(addNew)"></span>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
// PACKAGES
import {defineProps, defineEmits} from "vue";

// COMPONENTS
import Image from "@/components/atom/ImageIcon/ImageIcon.vue"
import { maskOf } from "@/utils/iconMask";

// IMAGES
const closeIcon = require("@/assets/images/png/cancelImage.png");
const addNew = require("@/assets/images/add_log.png");

const emits = defineEmits(["addNew", "update:modelValue", "cancel"])
const props = defineProps({
    modelValue: {
        type: Array,
        default: () => []
    }
})

function removeItem(index) {
    let val = props.modelValue.filter((_, index2) => index2 !== index)
    if(val.length) {
        emits('update:modelValue', val)
    } else {
        emits('cancel')
    }
}
</script>

<style lang="css" scoped>
    .media__component{
        bottom: 70px; 
        left: 0px; 
    }
    .media__component-left{
        max-width: calc(100% - 30px);
    }
    .media__component-right{
        width: 30px;
        background: var(--fill);
        color: var(--ink-2);
    }
    .media__component-right .add__new-image{
        width: 15px; 
        height: 15px;
    }
    .close__icon-img{
        right: 5px; 
        top: 5px;
    }
    .media__file-value{
        min-width: 140px;
        border: 1px solid var(--border);
        background: var(--surface-2);
    }
    .media__image{
       width: 140px; 
       height: 140px; 
       object-fit: contain;

    }
</style>