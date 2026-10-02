<template>
    <div class="d-flex flex-row justify-content-between w-100 p-10px align-items-center confirm-field-bg-light-gray">
        <div class="w-618px">
            <table class="w-100 text-left confirm-field-bg-white">
                <thead>
                    <tr class="confirm-field-border-gray">
                        <th
                            class="w-250px confirm-field-bg-colorlightgray p8px-12px confirm-field-font-size-14 text-left confirm-field-dark-gray position-re overflow-hidden arrow">
                            {{ header.userHeader }}
                        </th>
                        <th class="p8px-12px confirm-field-font-size-14 text-left confirm-field-border-gray  confirm-field-dark-gray border-left-0">
                            {{ header.systemHeader }}
                        </th>
                    </tr>
                </thead>
            </table>
        </div>
        <div class="d-flex">
            <img :src="tick_true_svg" alt="tick_true" class="w-20 mr-5px">
            <p class="m-0 confirm-field-green">{{ $t('headerMapping.confirmed_text') }}</p>
        </div>
        <div>
            <button class="confirm-field-outline-primary w-max-content" @click="emit('edit-confirmed-field')">
                {{ $t('headerMapping.edit_button') }}
            </button>
        </div>
    </div>
</template>

<script setup>
import { defineProps, defineEmits } from 'vue'
const tick_true_svg = require("@/assets/images/svg/tick-true-green.svg");

const emit = defineEmits(['edit-confirmed-field']);

const props = defineProps({
    header: {
        type: String,
        required: true
    }
})
const header = props.header;

</script>

<style scoped>
.confirm-field-font-size-14 {
    font-size: 14px;
}
.confirm-field-bg-white {
    background-color: var(--surface);
}
.confirm-field-bg-light-gray {
    background-color: var(--surface-2);
}
.confirm-field-bg-colorlightgray {
    background-color: var(--fill);
}
.confirm-field-dark-gray {
    color: var(--ink);
}
.confirm-field-green {
    color: var(--ok-ink);
}
.confirm-field-border-gray {
    border: 1px solid var(--hairline) !important;
}
.confirm-field-outline-primary {
    height: 30px;
    background: var(--surface);
    border: 1px solid var(--brand);
    border-radius: 4px;
    color: var(--brand);
    cursor: pointer;
    font-family: var(--font-ui);
}
</style>

<style scoped>
.arrow::before {
    position: absolute;
    right: 0;
    top: 0;
    display: block;
    content: "";
    width: 48px;
    height: 48px;
    background-color: #ffffff;
    z-index: 9;
}

.arrow::after {
    content: "";
    width: 48px;
    height: 48px;
    border-color: #c6d1dd #c6d1dd transparent transparent;
    transform: rotate(45deg) translate(-6px, 10px);
    border-width: 1px;
    background: #DFE1E6;
    display: block;
    z-index: 10;
    position: absolute;
    top: -11px;
    right: 0;
}
</style>