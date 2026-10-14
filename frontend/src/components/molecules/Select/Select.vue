<template>
    <div>
        <span>{{title}}</span>
        <div class="select-option form-control mt-5px" :id="`${name}_options`" @click="!disabled ? showOption = !showOption : ''" :class="{'cutom-select-disabled': disabled, 'focused': showOption, 'sel-tokens': themed}">
            <div class="d-flex align-items-center justify-content-between h-100" :class="{'cursor-default' : disabled, 'cursor-pointer': !disabled}">
                <div class="select-option__label text-ellipsis">
                    <slot name="header">
                        <span>
                            {{modelValue && modelValue[displayKey] ? modelValue[displayKey] : placeholder === "Select" ? $t('PlaceHolder.Select') : placeholder}}
                        </span>
                    </slot>
                </div>
                <span v-if="themed" class="ah-mask-icon select-option__arrow" :style="[maskOf(arrowImage), { transform: `rotateZ(${showOption ? '180' : '0'}deg)` }]" aria-hidden="true"></span>
                <img v-else :src="arrowImage" alt="" :style="`transform: rotateZ(${showOption ? '180' : '0'}deg)`">
                
            </div>
            <div class="select-option-value" v-if="showOption">
                <div class="cutsom-select-search p-8px" v-if="enableSearch">
                    <input ref="searchBox" type="text" @click.stop @keydown.enter.prevent v-model="search" :placeHolder="$t('PlaceHolder.search')" class="form-control select-gray">
                </div>
                <div class="custom-selectoptions-wrapper overflow-y-auto">
                    <div class="d-flex flex-column py-10px">
                        <slot name="options">
                            <span 
                                v-for="(item, index) in options.filter((x) => x[displayKey].trim().toLowerCase().includes(search.trim().toLowerCase()))"
                                :key="index"
                                @click.stop="selectOption(item)"
                                :class="{'bg-blue select-bg-blue select-white select-hover-white': JSON.stringify(item) === JSON.stringify(modelValue)}"
                                class="custom-select-options text-ellipsis select-font-size-14 select-gray4b"
                            >
                            <slot name="item" :item="item">
                                <img v-if="item?.image?.includes('http')" :src="item.image" alt="task_type" class="mr-5px">
                                <WasabiImage
                                    v-else
                                    class="mr-5px"
                                    :data="{url: item.image}"
                                />
                                {{ item[displayKey] }}
                            </slot>
                            </span>
                        </slot>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
// PACKAGES
import { computed, defineComponent, defineProps, defineEmits, ref, nextTick, watch,inject } from 'vue';
import WasabiImage from "@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue";
import { maskOf } from '@/utils/iconMask';


// IMAGES
const selectArrow = require('@/assets/images/svg/filter_select_dropdown.svg');
const selectArrowMobile = require('@/assets/images/svg/drop_down_mobile.svg');
const otherArrow = require('@/assets/images/svg/imageArrowUpDown.svg');


defineComponent({
    name: "SelectComponent",
})

const props = defineProps({
    name: {
        type: String,
        required: true
    },
    title: {
        type: String,
        default: ""
    },
    placeholder: {
        type: String,
        required: false,
        default: "Select"
    },

    displayKey: {
        type: String,
        required: false,
        default: "title"
    },
    modelValue: {
        required: true
    },
    options: {
        type: Array,
        required: true
    },
    enableSearch: {
        type: Boolean,
        required: false,
        default: false
    },
    disabled: {
        type: Boolean,
        required: false,
        default: false
    },
    selectImage :{
        type: Boolean,
        required: false,
        default: false
    },
    themed: { type: Boolean, default: false }
})

const emit = defineEmits(["change", "input", "update:modelValue", "ShowOpiton"]);

const showOption = ref(false);
const search = ref("");
const searchBox = ref();
const clientWidth = inject("$clientWidth");
const arrowImage = computed(() => (clientWidth?.value > 767 ? (props.selectImage ? otherArrow : selectArrow) : selectArrowMobile));

emit("ShowOpiton",showOption.value)

watch(showOption, (val) => {
    if(val) {
        startClickListener();
        search.value = "";
        nextTick(() => {
            if(searchBox.value) {
                searchBox.value.focus();
            }
        });
    } else {
        stopClickListener();
    }
})

watch(() => props.modelValue, (newValue, oldValue) => {
    if(newValue !== oldValue && (newValue !== null && newValue !== undefined && newValue !== "")) {
        emit(`change`);
        showOption.value = false;
    }
})

function clickListener(e) {
    const container = document.getElementById(`${props.name}_options`);
    if(container && !container.contains(e.target)) {
        showOption.value = false;
    }
}
function startClickListener() {
    document.addEventListener("click", clickListener);
}
function stopClickListener() {
    document.removeEventListener("click", clickListener);
}

function selectOption(item) {
    showOption.value= false
    emit('input', item),
    emit('update:modelValue', item)
}
</script>

<style>
@import './style.css';
</style>

<style scoped>
.select-gray {
    color: var(--ink-2);
}
.select-gray4b {
    color: var(--ink);
}
.select-bg-blue {
    background-color: var(--brand);
}
.select-white {
    color: var(--on-brand) !important;
}
.select-hover-white:hover {
    color: var(--on-brand) !important;
}
.select-font-size-14 {
    font-size: 14px;
}
</style>
