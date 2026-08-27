<template>
    <div :id="dyid">
        <div @click.stop.prevent="buttonClick()" @mouseenter="hover ? buttonClick(true) : ''" class="cursor-pointer" :class="[{...bodyClassHeader}]">
            <slot name="button">
                {{title}}
            </slot>
        </div>
        <teleport to="#my-dropdown" v-if="dropdownVisible">
            <div class="position-fi dropdown-back-drop cursor-default" :style="[{'z-index':zIndex}]" v-if="dropdownVisible && !hover" @click.stop="buttonClick()"/>
            <div :id="`dd_${dyid}`" @click.stop class="bg-white gray border border-radius-8-px box-shadow-serach drop-down-menu" :style="[{'z-index':zIndex}]" :class="{'drop-down-hide' : !bind, 'desktop-view position-fi' : clientWidth > 767, 'mobile-view position-fi' : clientWidth <= 767, ...bodyClass}" v-if="dropdownVisible">
                <slot name="head" v-if="clientWidth > 767">
                </slot>
                <div class="border-bottom-mobiledrop cursor-default mobile-title-header p-20px box-sizing-box" v-else :style="{height : clientWidth <=767 ? '64px' : ''}">
                    <div>
                        <slot name="head">
                            <div class="d-flex justify-content-between align-items-center">
                                <span class="font-weight-bold text-ellipsis project-list-mobiletitle mw-85">{{title}}</span>
                                <img :src="closeIcon" alt="close" class="cursor-pointer mobileCloseIcon" @click.stop="buttonClick()">
                            </div>
                        </slot>
                    </div>
                </div>
                <div v-if="options" :style="`padding: ${clientWidth > 767 ? '10px 10px 10px' : '20px;'}`"  class="search-project-filter dropdown_option font-size-12">
                    <div class="overflow-y-auto overflow-x-hidden drop-down-options black" :class="[{'dropDownScroll':props.dropDownClass}]" :style="{'max-height' : maxHeight}">
                        <slot name="options">
                        </slot>
                    </div>
                </div>
            </div>
            <!-- <div class="position-ab bg-white gray border border-radius-5-px z-index-7 box-shadow-4 drop-down-menu" v-if="dropdownVisible">
                <div style="padding: 5px; font-size: 13px; top: 25px;">
                    <slot name="options">
                    </slot>
                </div>
            </div> -->
        </teleport>
    </div>
</template>

<script setup>
// PACKAGES
import {defineProps, nextTick, onMounted, onUnmounted, ref, watch} from "vue";
import { useCustomComposable } from "@/composable";

// COMPOSABLES
const {debounce, makeUniqueId} = useCustomComposable();

// IMAGES
const closeIcon = require("@/assets/images/svg/CloseSidebar.svg");

const emit = defineEmits(['isVisible'])

const props = defineProps({
    id: {
        type: String,
        default: ""
    },
    title: {
        type: String,
        default: ""
    },
    hover: {
        type: Boolean,
        default: false
    },
    maxHeight: {
        type: String,
        default: "40dvh"
    },
    bodyClass: {
        type: Object,
        default: () => {}
    },
    zIndex: {
        type: Number,
        default:7
    },
    dropDownClass: {
        type:Boolean,
        default:false
    },
    options: {
        type: Boolean,
        default: true
    },
    bodyClassHeader: {
        type: Object,
        default: () => {}
    },
    keepSameWidth:{
        type: Boolean,
        default:false
    }
});

const dropdownVisible = ref(false);
const bind = ref(false);
const clientWidth = ref(document.documentElement.clientWidth);
const dyid = ref("");

onMounted(() => {
    if(props.id === "") {
        dyid.value = 'drop_down_'+makeUniqueId(6);
    } else {
        dyid.value = props.id;
    }
})

const listener = debounce((e) => {
    const container = document.getElementById(dyid.value);
    if(container && !container.contains(e.target) && !e.target.className.includes('driver-active') && !e.target.className.includes('driver-popover-title') && !e.target.className.includes('driver-popover-description')) {
        bind.value = false;
        setTimeout(() => {
            dropdownVisible.value = false;
        }, 100);
    }
}, 50)

function startClickListener() {
    document.addEventListener("click", listener);
}
function startMouseListener() {
    document.addEventListener("mousemove", listener);
}
function stopClickListener() {
    document.removeEventListener("click", listener);
}
function stopMouseListener() {
    document.removeEventListener("mousemove", listener);
}

watch(dropdownVisible, (val) => {
    if(val) {
        startClickListener();
        document.addEventListener('keydown', onEscape, true);
        document.addEventListener('kiln-dismiss-dropdown', closeNow);
        if(props.hover) {
            startMouseListener();
        }
    } else {
        stopClickListener();
        document.removeEventListener('keydown', onEscape, true);
        document.removeEventListener('kiln-dismiss-dropdown', closeNow);
        if(props.hover) {
            stopMouseListener();
        }
    }
    emit('isVisible',dropdownVisible.value)
});

function closeNow(event) {
    if (event && (event.key === 'Escape' || event.key === 'Esc' || event.keyCode === 27)) {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    }
    if (!dropdownVisible.value) return;
    bind.value = false;
    dropdownVisible.value = false;
}

function onEscape(event) {
    if (!event || (event.key !== 'Escape' && event.key !== 'Esc' && event.keyCode !== 27)) return;
    closeNow(event);
}

onUnmounted(() => {
    stopClickListener();
    stopMouseListener();
    document.removeEventListener('keydown', onEscape, true);
    document.removeEventListener('kiln-dismiss-dropdown', closeNow);
});

function buttonClick(flag = false) {
    if(flag === true) {
        dropdownVisible.value = true;
        setTimeout(() => {
            bind.value = true;
        }, 100);
    } else {
        if(dropdownVisible.value === false) {
            dropdownVisible.value = !dropdownVisible.value;
            setTimeout(() => {
                bind.value = dropdownVisible.value;
            }, 100);
        } else {
            bind.value = !dropdownVisible.value;
            setTimeout(() => {
                dropdownVisible.value = !dropdownVisible.value;
            }, 100);
        }
    }

    if(dropdownVisible.value === true) {
        clientWidth.value = document.documentElement.clientWidth;

        nextTick(() => {
            if(clientWidth.value <= 767) return;

            const element = document.getElementById(dyid.value);
            let childNode = document.getElementById(`dd_${dyid.value}`);
            if(element == null || childNode == null ) { return }
            const {top, left, width: ddWidth, height: ddHeight} = element.getBoundingClientRect();
            const {height, width} = childNode.getBoundingClientRect();

            if(document.documentElement.clientWidth < (left + width + 25)) {
                const offset = document.documentElement.clientWidth - (left + width + 15);
                childNode.style.left = left + offset + "px";
            } else {
                childNode.style.left = left + "px";
            }

            if(document.documentElement.clientHeight < (top + height + 25)) {
                const offset = document.documentElement.clientHeight - (top + height + 15);
                childNode.style.top = top + offset +"px";
            } else {
                if(props.keepSameWidth){
                    let widthCheck = document.getElementsByClassName(`drop-down-menu`)[0];
                    widthCheck.style.width = ddWidth + "px"
                }
                const position = top + (ddHeight < 25 ? 25 : ddHeight)                    
                childNode.style.top = position +"px";
            }
        })
    }

}

</script>

<style>
@import "./style.css";
</style>