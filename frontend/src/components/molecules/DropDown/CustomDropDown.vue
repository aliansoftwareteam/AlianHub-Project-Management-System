<template>
    <div :id="dyid">
        <!--
            BUG-047 / #101 — ARIA semantics for the dropdown trigger.
            The trigger is a div for layout reasons (it accepts arbitrary
            slot content) so we can't use a real <button>. Add the
            equivalent ARIA scaffolding so screen readers announce it as
            a button that opens a listbox.
        -->
        <div
            role="button"
            tabindex="0"
            :aria-haspopup="'listbox'"
            :aria-expanded="dropdownVisible ? 'true' : 'false'"
            :aria-controls="`dd_${dyid}`"
            class="cursor-pointer"
            @click.stop.prevent="buttonClick()"
            @mouseenter="hover ? buttonClick(true) : ''"
            @keydown.enter.prevent="buttonClick()"
            @keydown.space.prevent="buttonClick()"
            @keydown.esc.prevent="closeDropdown()"
            @keydown.down.prevent="openAndFocusFirstOption()"
        >
            <slot name="button">
                {{title}}
            </slot>
        </div>
        <teleport to="#my-dropdown" v-if="dropdownVisible">
            <div class="position-fi dropdown-back-drop cursor-default" :style="[{'z-index':zindexCustomDrop}]" v-if="dropdownVisible && !hover" @click.stop="buttonClick()"/>
            <!--
                BUG-047 / #101 — role=listbox on the floating panel so
                assistive tech recognises the menu. Escape closes; the
                wrapper handles ArrowDown to move focus inside.
            -->
            <div
                :id="`dd_${dyid}`"
                role="listbox"
                @click.stop
                @keydown.esc.prevent="closeDropdown"
                class="bg-white gray box-shadow-5 custom-drop-down-menu cls-custom-dd"
                :style="[{'z-index':zindexCustomDrop}]"
                :class="{'drop-down-hide' : !bind, 'desktop-view position-fi' : clientWidth > 767, 'mobile-view position-fi' : clientWidth <= 767, ...bodyClass}"
                v-if="dropdownVisible"
            >
                <slot name="head" v-if="clientWidth > 767"></slot>
                <div class="border-bottom cursor-default p-20px" v-else :style="{height : clientWidth <=767 ? '64px' : ''}">
                    <div>
                        <slot name="head">
                            <div class="d-flex justify-content-between align-items-center">
                                <span class="font-weight-bold text-ellipsis project-list-mobiletitle mw-85">{{title}}</span>
                                <!--
                                    BUG-047 / #101 — close affordance was a bare
                                    <img>; wrap in a real button with aria-label
                                    so keyboard users can dismiss the panel.
                                -->
                                <button
                                    v-if="clientWidth > 767"
                                    type="button"
                                    class="dropdown-close-btn cursor-pointer"
                                    aria-label="Close"
                                    @click.stop="buttonClick()"
                                >
                                    <img :src="closeIcon" alt="">
                                </button>
                            </div>
                        </slot>
                    </div>
                </div>
                <div class="search-project-filter w-100vw" :class="props.className" :style="{'max-width' : maxWidth}">
                    <div class="overflow-y-auto overflow-x-hidden drop-down-options black" :style="{'max-height' : maxHeight}">
                        <slot name="options">
                        </slot>
                    </div>
                </div>
            </div>
        </teleport>
    </div>
</template>

<script setup>
// PACKAGES
import {defineProps, nextTick, onMounted, ref, watch, defineEmits} from "vue";
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
    maxWidth: {
        type: String,
        default: ""
    },
    bodyClass: {
        type: Object,
        default: () => {}
    },
    zindexCustomDrop: {
        type: Number,
        default: 7
    },
    className: {
        type:String,
        default:''
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
    if(container && !container.contains(e.target)) {
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
        if(props.hover) {
            startMouseListener();
        }
    } else {

        stopClickListener();
        if(props.hover) {
            stopMouseListener();
        }
    }
    emit('isVisible',dropdownVisible.value)
});

// BUG-047 / #101 — keyboard helpers.
function closeDropdown() {
    if (dropdownVisible.value) {
        bind.value = false;
        setTimeout(() => { dropdownVisible.value = false; }, 100);
    }
}

function openAndFocusFirstOption() {
    if (!dropdownVisible.value) {
        buttonClick();
    }
    // Wait for the panel to render, then move focus to the first
    // focusable child inside the options slot.
    nextTick(() => {
        setTimeout(() => {
            const panel = document.getElementById(`dd_${dyid.value}`);
            if (!panel) return;
            const focusable = panel.querySelector(
                'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
            );
            if (focusable) focusable.focus();
        }, 150);
    });
}

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

            const {top, left} = element.getBoundingClientRect();
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
                childNode.style.top = top + 30 +"px";
            }
        })
    }

}

</script>

<style scoped>@import "./style.css"; </style>