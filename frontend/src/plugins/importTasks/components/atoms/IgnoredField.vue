<template>
    <div class="d-flex flex-row justify-content-between w-100 p-10px align-items-center ignored-field-bg-light-gray">
        <div class="w-618px">
            <table class="w-100 text-left ignored-field-bg-white">
                <thead>
                    <tr class="ignored-field-bg-colorlightgray">
                        <th
                            class="w-250px ignored-field-bg-colorlightgray p8px-12px ignored-field-font-size-14 text-left ignored-field-dark-gray opacity-5">
                            {{ header }}
                        </th>
                    </tr>
                </thead>
            </table>
        </div>
        <div class="d-flex">
            <img :src=eye_hide_svg alt="eye_hide_svg" class="w-25px mr-10px"> 
            <p class="m-0">{{ $t('headerMapping.ignored_text') }}</p>
        </div>
        <div>
            <button class="outline-primary w-max-content" @click="emitEditIgnoredField()">
                {{ $t('headerMapping.edit_button') }}
            </button>
        </div>
    </div>
</template>

<script setup>
import { defineProps, defineEmits } from 'vue'
const eye_hide_svg = require("@/assets/images/svg/eyeHide.svg");


const emit = defineEmits(['editIgnoredField']);

defineProps({
    header: {
        type: String,
        required: true
    }
})

const emitEditIgnoredField = () => {
    emit('editIgnoredField')
}
</script>

<style scoped>
.ignored-field-bg-light-gray {
    background-color: var(--surface-2);
}
.ignored-field-bg-white {
    background-color: var(--surface);
}
.ignored-field-bg-colorlightgray {
    background-color: var(--fill);
}
.ignored-field-font-size-14 {
    font-size: 14px;
}
.ignored-field-dark-gray {
    color: var(--ink);
}
</style>
