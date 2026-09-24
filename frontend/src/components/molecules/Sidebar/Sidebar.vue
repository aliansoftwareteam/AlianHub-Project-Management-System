<template>
    <teleport to="#my-sidebar" v-if="visible">
        <div
            class="position-fi justify-content-end sidebar"
            v-if="unMount ? visible : true"
            :class="`${className} ${left ? 'flex-row-reverse' : ''} ${!visible ? 'd-none' : 'd-flex'}`"
            :style="[{'z-index':zIndex}]"
        >
            <div class="back-drop" v-if="!disableBackdrop" @click="closeOnBackDrop ? $emit('update:visible', !visible) : ''"></div>
            <div
                ref="panelRef"
                role="dialog"
                :aria-modal="disableBackdrop ? null : 'true'"
                :aria-label="title"
                tabindex="-1"
                @keydown.esc.stop="$emit('update:visible', false)"
                :style="`${width ? `width: ${width}` : ''}; top: ${top}; height: calc(100% - ${top});`"
                :class="{'hide-side-left':!showSide && left, 'hide-side-right':!showSide && !left,}"
                class="position-fi bg-white d-flex flex-column sidebar-content z-index-7"
                :id="tourId"
            >
                <div v-if="!hideHeader" :class="headClass" class="sidebar-head bg-white d-flex align-items-center justify-content-between px-1 blue border-bottom cursor-default">
                    <slot name="head">
                        <div class="assignee-headtitle d-block text-ellipsis text-nowrap">
                            <slot name="head-left">
                                {{title}}
                            </slot>
                        </div>
                        <div>
                            <slot name="head-mid">
                            </slot>
                        </div>
                        <div class="cursor-pointer d-flex align-items-center text-nowrap">
                            <slot name="head-right">
                                <button v-if="multiSelect && showClear" class="clear-all outline-primary bg-light-gray black mr-1" :class="{'opacity-5 cursor-default': !value.length, 'opacity-10 cursor-pointer': value.length}" @click="$emit('clear')">{{$t('Filters.clearall')}}</button>
                                <button type="button" class="sidebar-close" :aria-label="$t('Projects.close')" @click="$emit('update:visible', !visible)">
                                    <img :src="closeBlueImage" alt="" class="cursor-pointer"/>
                                </button>
                            </slot>
                        </div>
                    </slot>
                </div>
                <div class="black sidebar-body bg-white style-scroll" :id="uniqueId" :style="{
                    'height': (hideHeader ? '100%' : '')
                }">
                    <div v-if="enableSearch" class="bg-white mobile-list-inputsearch-wrapper border-bottom p-15px">
                        <input ref="sidebar_search" type="text" v-model="search" :placeHolder="$t('PlaceHolder.search')" :aria-label="$t('PlaceHolder.search')" class="form-control listsidebar-search font-size-16" @input="$emit('searchChange', search)">
                    </div>
                    <slot name="body">
                        <div v-if="defaultLayout" class="overflow-y-auto sidebar-options overflow-x-hidden" :role="filteredOptions?.length ? 'listbox' : null" :aria-multiselectable="multiSelect ? 'true' : null" :style="`height: ${!enableSearch ? 'calc(100% - 0px);' : 'calc(100% - 62px);'}`">
                            <template v-if="!grouped">
                                <template v-if="filteredOptions?.length">
                                    <SidebarItems
                                        v-for="(item, itemIndex) in filteredOptions"
                                        :key="'item'+itemIndex"
                                        :id="'item'+itemIndex"
                                        :item="item"
                                        :multiSelect="multiSelect"
                                        :highlight="itemIndex === highlightIndex"
                                        :selected="checkSelected(item)"
                                        @select="(item) => updateItem('add', item)"
                                        @remove="(item) => updateItem('remove', item)"
                                        :isDefault="isDefault"
                                        :imageDisplayForPriority="imageDisplayForPriority"
                                    />
                                </template>
                                <template v-else>
                                    <div class="text-center mt-10px">
                                        <span class="red" >{{$t('ProjectSlider.no_result_found')}}</span>
                                    </div>
                                </template>
                            </template>
                            <template v-else>
                                <template v-for="(group, index) in filteredOptions">
                                    <div v-if="group.options.length" :key="index" role="group" :aria-label="group.label">
                                        <div class="group-title p-1">
                                            {{group.label}}
                                        </div>

                                        <SidebarItems
                                            v-for="(item, itemIndex) in group.options"
                                            :key="'item'+itemIndex"
                                            :id="'item'+itemIndex"
                                            :item="item"
                                            :multiSelect="multiSelect"
                                            :highlight="`${index}_${itemIndex}` === `${groupIndex}_${highlightIndex}`"
                                            :selected="checkSelected(item)"
                                            @select="(item) => updateItem('add', item)"
                                            @remove="(item) => updateItem('remove', item)"
                                            :imageDisplayForPriority="imageDisplayForPriority"
                                        />
                                    </div>
                                    <div v-else :key="'no_result'+index">
                                        <div class="group-title p-1">
                                            {{group.label}}
                                        </div>
                                        <div class="text-center mt-10px">
                                            <span class="red">{{$t('ProjectSlider.no_result_found')}}</span>
                                        </div>
                                    </div>
                                </template>
                            </template>
                        </div>
                    </slot>
                </div>
            </div>
        </div>
    </teleport>
</template>

<script setup>
// PACKAGES
import { computed, defineComponent, defineProps, defineEmits, ref, watch, nextTick, onMounted, onUnmounted } from "vue";

// COMPONENTS
import SidebarItems from "../SidebarItems/SidebarItems.vue";

// COMPOSABLES
import { useCustomComposable } from "@/composable";
import { useFocusTrap } from "@/composable/useFocusTrap";
import { useEscapeLayer } from "@/composable/useEscapeLayer";

// USE COMPOSABLES
const { debounce } = useCustomComposable();

// IMAGES
const closeBlueImage = require("@/assets/images/svg/CloseSidebar.svg");

// COMPONENT
defineComponent({
    name: "Sidebar-Component",
    components: {
        SidebarItems
    },
})

// EMITS
const emit = defineEmits(["update:visible", "selected", "removed", "update:value", "clear", "searchChange", "item-clicked"])

// PROPS
const props = defineProps({
    title: {
        type: String,
        default: "Title"
    },
    top: {
        type: String,
        default: "var(--legacy-header-h)"
    },
    visible: {
        type: Boolean,
        default: true
    },
    disableBackdrop: {
        type: Boolean,
        default: false
    },
    defaultLayout: {
        type: Boolean,
        default: true
    },
    options: {
        type: Array,
        default: () => []
    },
    value: {
        type: Array,
        default: () => []
    },
    left: {
        type: Boolean,
        default: false
    },
    className: {
        type: String,
        default: ""
    },
    width: {
        type: String,
        default: "374px"
    },
    headClass: {
        type: String,
        default: ""
    },

    unMount: {
        type: Boolean,
        default: true
    },
    hideHeader: {
        type: Boolean,
        default: false
    },

    grouped: {
        type: Boolean,
        default: false
    },
    enableSearch: {
        type: Boolean,
        default: false
    },
    closeOnBackDrop: {
        type: Boolean,
        default: true
    },
    closeOnSelect: {
        type: Boolean,
        default: true
    },
    multiSelect: {
        type: Boolean,
        default: false
    },
    showClear: {
        type: Boolean,
        default: true
    },
    zIndex: {
        type: Number,
        default:7
    },
    isDefault: {
        type:Boolean,
        default:false
    },
    imageDisplayForPriority: {
        type:Boolean,
        default:false
    },
    tourId:{
        type:String,
        default:""
    },
    uniqueId:{
        type: String,
        default: ""
    },
    porpHighlightIndex: {
        type: Number,
        default: 0
    },
    listenKeys: {
        type: Boolean,
        default:false
    }
})
const showSide = ref(false);
const search = ref("");
const sidebar_search = ref(null);
// eslint-disable-next-line
const visible = ref(false);
useEscapeLayer(() => props.visible, () => emit('update:visible', false));
// FILTER OPTIONS
const filteredOptions = ref();

const highlightIndex = ref(-1);
watch(() => props.porpHighlightIndex, (val) => {
    highlightIndex.value = val;
})

const groupIndex = ref(0);

function startListener() {
    document.addEventListener("keydown", keyListener)
}
function stopListener() {
    document.removeEventListener("keydown", keyListener)
}
function keyListener(event) {
    if (event.target?.closest?.('[role="option"]')) return;
    const currentGroup = filteredOptions.value[groupIndex.value];
    const options = currentGroup?.options || [];
    if(event.keyCode === 13) { // Enter
        if(!props.grouped){
            if(highlightIndex.value < 0) {
                return;
            }
        }else{
            if(highlightIndex.value < 0 || highlightIndex.value >= options.length) {
                return;
            }
        }
        const item = filteredOptions.value[groupIndex.value]
        if(checkSelected(item)) {
            !props.grouped ? updateItem("remove" ,filteredOptions.value[highlightIndex.value]) : updateItem("remove" ,filteredOptions.value[groupIndex.value].options[highlightIndex.value]);
        } else {
            !props.grouped ? updateItem("add" ,filteredOptions.value[highlightIndex.value]) : updateItem("add" ,filteredOptions.value[groupIndex.value]?.options[highlightIndex.value]);
        }
    } else if(event.keyCode === 38){ // UP
        if (!props.grouped) {
            highlightIndex.value = highlightIndex.value > 0 ? highlightIndex.value - 1 : 0;
        }else{
            if(highlightIndex.value > 0) {
                highlightIndex.value--;
            }else if (groupIndex.value > 0) {
                groupIndex.value--;
                highlightIndex.value = filteredOptions.value[groupIndex.value]?.options.length - 1 || 0;
            }
        }
        nextTick(() => {
            document.getElementById('item'+highlightIndex.value)?.scrollIntoView({behavior: "smooth", block: 'end'})
        })
    } else if (event.keyCode === 40){ // DOWN
        if(!props.grouped){
            highlightIndex.value = highlightIndex.value < filteredOptions.value.length-1 ? highlightIndex.value+1 : filteredOptions.value.length-1;
        } else {
            if (highlightIndex.value < options.length - 1) {
                highlightIndex.value++;
            } else if (groupIndex.value < filteredOptions.value.length - 1) {
                groupIndex.value++;
                highlightIndex.value = 0;
            }
        }
        nextTick(() => {
            document.getElementById('item'+highlightIndex.value)?.scrollIntoView({behavior: "smooth", block: 'nearest', inline: 'start'})
        })
    }
}

onMounted(() => {
    filteredOptions.value = props.options;

    if(props.visible === true) {
        visible.value = true;

        setTimeout(() => {
            showSide.value = true;
        }, 100)

        if(props.enableSearch && props.visible) {
            nextTick(() => {
                sidebar_search.value.focus();
            })
        }

        if(props.listenKeys)
            startListener();
    }
})

watch(() => props.visible, (val) => {
    if(props.enableSearch && props.visible) {
        nextTick(() => {
            sidebar_search.value.focus();
        })
    }
    if(val === false) {
        setTimeout(() => {
            visible.value = val;
            search.value = "";
        }, 100)

        if(props.listenKeys)
            stopListener();

        showSide.value = val;
    } else {
        setTimeout(() => {
            showSide.value = val;
        }, 100)
        if(props.listenKeys)
            startListener();
        visible.value = val;
    }
})


function updateItem(type, item) {
    if (type === "add") {
        if (props.value) {
            if (props.value.some((x) => x.value === item.value)) {
                emit('item-clicked', item);
                return;
            }

            emit('selected', item);
            if(!props.multiSelect) {
                emit('update:visible', !visible.value)
                emit('update:value', [item])
            } else {
                const value = [...props.value, item]
                emit('update:value', value)
            }
        }
    } else {
        if(props.value) {
            const value = props.value.filter((x) => x.value !== item.value);
            emit('update:value', value)
            emit('removed', item)
        }
    }
}

function checkSelected(item) {
    if (props.value) {
        return props.value.some((x) => x.value === item.value);
    }
    return false;
}

onUnmounted(() => {
    if(!props.grouped && props.listenKeys)
        stopListener();
})

watch([search], debounce(([val]) => {
        searchOptions(val);
    }, 1000)
)

function searchOptions(val) {
    highlightIndex.value = -1;
    if(!props.grouped) {
        filteredOptions.value = props.options.filter((item) => item && item.label && item.label.toLowerCase().includes(val.toLowerCase()));
    } else {
        filteredOptions.value = props.options.map((group) => {
            return {
                ...group,
                options: group.options.filter((item) => item && item.label && item.label.toLowerCase().includes(val.toLowerCase()))
            }
        })
    }
}

watch(() => props.options, () => {
    searchOptions(search.value);
})

const panelRef = ref(null);
useFocusTrap(panelRef, computed(() => props.visible && !props.disableBackdrop));
</script>

<style>
@import "./style.css";
</style>
