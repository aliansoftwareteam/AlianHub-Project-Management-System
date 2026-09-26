<template>
    <div v-if="!disabled">
        <DropDown :id="uid" @isVisible="$event ? '' : statusSearch = ''" :zIndex="9">
            <template #button>
                <div :ref="uid" class="status-main-div d-flex align-items-center">
                    <slot name="head">
                        <span v-if="!showLabel" class="status_square" :style="{ 'background-color': (modelValue?.textColor || '#c1c1c1'), verticalAlign: 'middle', marginLeft: '6px'}" :title="modelValue?.name"></span>
                        <span v-else class="border-radius-5-px text-nowrap p5px-p10px status-main_name ah-status-ink" :style="[statusChipStyle(modelValue), { verticalAlign: 'middle', marginLeft: '10px' }]" :title="modelValue?.name">{{modelValue?.name}}</span>
                    </slot>
                </div>
            </template>

            <template #head>
                <div :style="{padding: clientWidth > 765 ? '10px' : ''}" :class="{'border-bottom': clientWidth > 765}">
                    <InputText
                        input-id="taskStatusSearch"
                        v-model="statusSearch"
                        :is-direct-focus="true"
                        :maxLength="250"
                        :minLength="3"
                        :place-holder="`${$t('PlaceHolder.search')}...`"
                        width="-webkit-fill-available"
                    />
                </div>
            </template>

            <template #options>
                <DropDownOption v-for="(status, statusIndex) in filteredOptions" :key="statusIndex" @click="$emit('select', status,convertStatus), $emit('update:modelValue', item), $refs[uid].click()">
                    <div class="d-flex align-items-center">
                        <span class="status_square" :style="{ 'background-color': status.textColor || '#c1c1c1', verticalAlign: 'middle'}" :title="status.name"></span>
                        <span class="ml-5px"  :style="{color: status.textColor}">{{status.name}}</span>
                    </div>
                </DropDownOption>
            </template>
        </DropDown>
    </div>
    <template v-else>
        <div v-if="showLabel" :id="tourId" class="status-main-div cursor-default d-flex align-items-center justify-content-center border-radius-5-px w-fitcontent ah-status-ink" :style="[statusChipStyle(modelValue), { verticalAlign: 'middle', marginLeft: '6px' }]">
            <span class="text-nowrap p5px-p10px" :title="modelValue?.name">{{modelValue?.name}}</span>
        </div>
        <div v-else class="status_square cursor-default" :style="{ 'background-color': (modelValue?.textColor || '#c1c1c1'), verticalAlign: 'middle', marginLeft: '6px', minWidth:'12px'}">
        </div>
    </template>
</template>

<script setup>
import {computed, defineEmits, defineProps, inject, onMounted, ref} from 'vue';

import DropDown from '@/components/molecules/DropDown/DropDown.vue'
import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue'
import InputText from '@/components/atom/InputText/InputText.vue'
import { useCustomComposable } from '@/composable';
import { statusChipStyle } from '@/utils/statusChipColors';

const clientWidth = inject('$clientWidth');
const { makeUniqueId } = useCustomComposable();

defineEmits(['update:modelValue', 'select'])

// PROPS
const props = defineProps({
    id: {
        type: String,
        default: ""
    },
    modelValue: {
        type: Object,
        required: true
    },
    options: {
        type: Array,
        required: true,
    },
    showLabel: {
        type: Boolean,
        required: false,
    },
    disabled: {
        type: Boolean,
        default: false
    },
    convertStatus: {
        type: Object,
        default: () => ({})
    }
})

const statusSearch = ref("");
const uid = ref("");

onMounted(() => {
    if(!props.id.length) {
        uid.value = `status_${makeUniqueId()}`
    } else {
        uid.value = props.id;
    }
})

const filteredOptions = computed(() => {
    return props.options.filter((item) => {
        return item.name?.toLowerCase()?.includes(statusSearch.value.toLowerCase());
    })
})
</script>

<style lang="scss" scoped>

</style>