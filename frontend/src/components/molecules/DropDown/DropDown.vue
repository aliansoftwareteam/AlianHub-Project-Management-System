<template>
    <div :id="dyid">
        <DropDownTrigger :attrs="mode ? triggerAttrs : null" :class="['cursor-pointer', {...bodyClassHeader}]" @click.stop.prevent="onTriggerClick" @mouseenter="hover ? buttonClick(true) : ''">
            <template #default="slotProps">
                <slot name="button" v-bind="slotProps">
                    {{title}}
                </slot>
            </template>
        </DropDownTrigger>
        <teleport to="#my-dropdown" v-if="dropdownVisible">
            <div class="position-fi dropdown-back-drop cursor-default" :style="[{'z-index':zIndex}]" v-if="dropdownVisible && !hover" @click.stop="buttonClick()"/>
            <div :id="panelId" v-bind="panelAttrs" @click.stop="onPanelClick" @keydown="onPanelKeydown" class="bg-white gray border border-radius-8-px box-shadow-serach drop-down-menu" :style="[{'z-index':zIndex}]" :class="{'drop-down-hide' : !bind, 'desktop-view position-fi' : clientWidth > 767, 'mobile-view position-fi' : clientWidth <= 767, ...bodyClass}" v-if="dropdownVisible">
                <slot name="head" v-if="clientWidth > 767">
                </slot>
                <div class="border-bottom-mobiledrop cursor-default mobile-title-header p-20px box-sizing-box" v-else :style="{height : clientWidth <=767 ? '64px' : ''}">
                    <div>
                        <slot name="head">
                            <div class="d-flex justify-content-between align-items-center">
                                <span class="font-weight-bold text-ellipsis project-list-mobiletitle mw-85">{{title}}</span>
                                <button v-if="mode" type="button" class="dropdown-close-btn" :aria-label="$t('Common.close')" @click.stop="close()">
                                    <img :src="closeIcon" alt="" class="cursor-pointer mobileCloseIcon">
                                </button>
                                <img v-else :src="closeIcon" alt="close" class="cursor-pointer mobileCloseIcon" @click.stop="buttonClick()">
                            </div>
                        </slot>
                    </div>
                </div>
                <div v-if="options" :style="`padding: ${clientWidth > 767 ? '10px 10px 10px' : '20px;'}`"  class="search-project-filter dropdown_option font-size-12">
                    <div v-if="$slots.search" class="drop-down-search black">
                        <slot name="search"></slot>
                    </div>
                    <div :id="listRole ? listId : undefined" :role="listRole" :aria-labelledby="listRole ? triggerId : undefined" :aria-multiselectable="listRole === 'listbox' && multiselectable ? 'true' : undefined" class="overflow-y-auto overflow-x-hidden drop-down-options black" :class="[{'dropDownScroll':props.dropDownClass}]" :style="{'max-height' : maxHeight}">
                        <slot name="options">
                        </slot>
                    </div>
                </div>
            </div>
        </teleport>
    </div>
</template>

<script setup>
import {Comment, Fragment, computed, defineProps, h, isVNode, nextTick, provide, ref, watch} from "vue";
import { useCustomComposable } from "@/composable";

const {debounce, makeUniqueId} = useCustomComposable();

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
    mode: {
        type: String,
        default: "",
        validator: (value) => ["", "menu", "listbox", "dialog"].includes(value)
    },
    ariaLabel: {
        type: String,
        default: ""
    },
    multiselectable: {
        type: Boolean,
        default: false
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

const TRIGGER_MARKER = "data-dropdown-trigger";
const ITEM_SELECTOR = '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"]';
const TABBABLE_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const AUTOFOCUS_SELECTOR = "[data-dropdown-autofocus]";
const TEXT_FIELD_SELECTOR = 'input:not([type]):not([disabled]), input[type="text"]:not([disabled]), input[type="search"]:not([disabled]), textarea:not([disabled])';
const FORM_FIELD_SELECTOR = 'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])';
const HAS_POPUP = { listbox: "listbox", dialog: "dialog" };
const TOUR_CLASSES = ["driver-active", "driver-popover-title", "driver-popover-description"];

const dropdownVisible = ref(false);
const bind = ref(false);
const clientWidth = ref(document.documentElement.clientWidth);
const dyid = ref(props.id || "drop_down_" + makeUniqueId(6));

const triggerId = computed(() => `${dyid.value}_trigger`);
const panelId = computed(() => `dd_${dyid.value}`);
const listId = computed(() => `${dyid.value}_list`);
const isSheet = computed(() => Boolean(props.mode) && clientWidth.value <= 767);
const isDialog = computed(() => props.mode === "dialog");
const listRole = computed(() => (props.mode === "menu" || props.mode === "listbox" ? props.mode : undefined));

provide("dropDownMode", computed(() => props.mode));

const triggerAttrs = computed(() => ({
    id: triggerId.value,
    [TRIGGER_MARKER]: "",
    "aria-haspopup": HAS_POPUP[props.mode] || "menu",
    "aria-expanded": dropdownVisible.value ? "true" : "false",
    "aria-controls": props.options && listRole.value ? listId.value : panelId.value,
    onKeydown: onTriggerKeydown,
    onKeyup: preventSpaceClick,
    ...(props.hover ? { onFocus: onTriggerFocus, onBlur: onTriggerBlur } : {})
}));

const panelAttrs = computed(() => {
    if (!isDialog.value && !isSheet.value) return {};
    return {
        role: "dialog",
        "aria-modal": "true",
        tabindex: isDialog.value ? "-1" : undefined,
        ...(props.ariaLabel ? { "aria-label": props.ariaLabel } : { "aria-labelledby": triggerId.value })
    };
});

function bindsTriggerAttrs(nodes) {
    return nodes.some((node) => {
        if (!isVNode(node) || node.type === Comment) return false;
        if (node.type === Fragment) return Array.isArray(node.children) && bindsTriggerAttrs(node.children);
        return Boolean(node.props && TRIGGER_MARKER in node.props);
    });
}

// A call site that binds triggerAttrs on its own button keeps the plain wrapper div, so no button ever nests in another.
function DropDownTrigger(triggerProps, { slots, attrs }) {
    const content = slots.default({ triggerAttrs: triggerProps.attrs || {} });
    if (!triggerProps.attrs || bindsTriggerAttrs(content)) return h("div", attrs, content);
    return h("button", { ...attrs, ...triggerProps.attrs, type: "button", class: [attrs.class, "dropdown-trigger"] }, content);
}
DropDownTrigger.props = ["attrs"];
DropDownTrigger.inheritAttrs = false;

const triggerEl = () => document.getElementById(triggerId.value);
const panelEl = () => document.getElementById(panelId.value);
const menuItems = () => {
    const panel = panelEl();
    return panel ? [...panel.querySelectorAll(ITEM_SELECTOR)].filter((el) => el.getAttribute("aria-disabled") !== "true") : [];
};

function focusItem(el) {
    if (!el) return;
    if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
    el.focus();
}

// A search field above the options keeps focus so people can type at once; a dialog starts on its first field.
function openingField() {
    const panel = panelEl();
    if (!panel) return null;
    const marked = panel.querySelector(AUTOFOCUS_SELECTOR);
    if (marked) return marked;
    if (isDialog.value) return panel.querySelector(FORM_FIELD_SELECTOR) || panel.querySelector(TABBABLE_SELECTOR) || panel;
    return [...panel.querySelectorAll(TEXT_FIELD_SELECTOR)].find((el) => !el.closest(ITEM_SELECTOR)) || null;
}

function focusOnOpen(target, fieldOnly = false) {
    nextTick(() => {
        const field = openingField();
        if (field) {
            field.focus();
            return;
        }
        if (fieldOnly) return;
        const items = menuItems();
        if (target === "last") {
            focusItem(items[items.length - 1]);
            return;
        }
        const first = items.find((el) => el.getAttribute("aria-selected") === "true") || items[0];
        if (first) focusItem(first);
        else if (isSheet.value) panelEl()?.querySelector(TABBABLE_SELECTOR)?.focus();
    });
}

function open(target) {
    if (!dropdownVisible.value) buttonClick(true);
    focusOnOpen(target);
}

// Focus coming back to the trigger must not reopen a hover menu.
let returningFocus = false;
function close() {
    if (!dropdownVisible.value) return;
    const panel = panelEl();
    if (props.mode && panel && panel.contains(document.activeElement)) {
        returningFocus = true;
        triggerEl()?.focus();
        returningFocus = false;
    }
    bind.value = false;
    setTimeout(() => {
        dropdownVisible.value = false;
    }, 100);
}

function onTriggerClick(event) {
    const wasOpen = dropdownVisible.value;
    buttonClick();
    if (!props.mode || wasOpen) return;
    // detail 0 is a click from the keyboard or a screen reader; a mouse click on a desktop menu or listbox leaves the options unfocused.
    focusOnOpen("first", event.detail !== 0 && !isSheet.value && !isDialog.value);
}

function onTriggerKeydown(event) {
    switch (event.key) {
        case "ArrowDown":
            event.preventDefault();
            open("first");
            break;
        case "ArrowUp":
            event.preventDefault();
            open("last");
            break;
        case "Enter":
        case " ":
            event.preventDefault();
            if (dropdownVisible.value && !props.hover) close();
            else open("first");
            break;
        case "Escape":
            if (dropdownVisible.value) {
                event.preventDefault();
                event.stopPropagation();
                close();
            }
            break;
    }
}

// Some browsers click a button on the keyup of Space even when its keydown was prevented.
function preventSpaceClick(event) {
    if (event.key === " ") event.preventDefault();
}

function onTriggerFocus() {
    if (!returningFocus && !dropdownVisible.value) buttonClick(true);
}

function onTriggerBlur(event) {
    if (event.relatedTarget && !panelEl()?.contains(event.relatedTarget)) close();
}

function trapFocus(event) {
    event.preventDefault();
    const tabbables = [...panelEl().querySelectorAll(TABBABLE_SELECTOR)];
    const step = event.shiftKey ? -1 : 1;
    const found = tabbables.indexOf(event.target);
    let index = found === -1 && event.shiftKey ? 0 : found;
    // A hidden element (display: none) refuses focus, so keep stepping until one takes it.
    for (let tries = 0; tries < tabbables.length; tries++) {
        index = (index + step + tabbables.length) % tabbables.length;
        tabbables[index].focus();
        if (document.activeElement === tabbables[index]) return;
    }
}

function onPanelKeydown(event) {
    if (!props.mode) return;
    if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
    }
    if (event.key === "Tab") {
        // Closing puts focus on the trigger before the browser acts, so Tab carries on from the trigger.
        if (isDialog.value || isSheet.value) trapFocus(event);
        else close();
        return;
    }
    if (isDialog.value) return;
    const items = menuItems();
    const index = items.indexOf(event.target);
    const onItem = index !== -1;
    const field = onItem ? openingField() : null;
    switch (event.key) {
        case "ArrowDown":
            event.preventDefault();
            if (field && index === items.length - 1) field.focus();
            else focusItem(items[onItem ? (index + 1) % items.length : 0]);
            break;
        case "ArrowUp":
            event.preventDefault();
            if (field && index === 0) field.focus();
            else focusItem(items[onItem ? (index - 1 + items.length) % items.length : items.length - 1]);
            break;
        case "Home":
        case "End":
            if (onItem) {
                event.preventDefault();
                focusItem(event.key === "Home" ? items[0] : items[items.length - 1]);
            }
            break;
        case "Enter":
        case " ":
            if (onItem) {
                event.preventDefault();
                items[index].click();
            }
            break;
    }
}

// A menu closes once an item runs; a listbox may take several picks, so its call site closes it.
function onPanelClick(event) {
    if (props.mode === "menu" && event.target.closest?.(ITEM_SELECTOR)) close();
}

const listener = debounce((e) => {
    const container = document.getElementById(dyid.value);
    // An SVG element's className is an SVGAnimatedString, not a string.
    const className = e.target.getAttribute?.("class") || "";
    if(container && !container.contains(e.target) && !TOUR_CLASSES.some((name) => className.includes(name))) {
        close();
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

function buttonClick(flag = false) {
    if(flag === true) {
        dropdownVisible.value = true;
        setTimeout(() => {
            bind.value = true;
        }, 100);
    } else if(dropdownVisible.value === false) {
        dropdownVisible.value = true;
        setTimeout(() => {
            bind.value = dropdownVisible.value;
        }, 100);
    } else {
        close();
    }

    if(dropdownVisible.value === true) {
        clientWidth.value = document.documentElement.clientWidth;

        nextTick(() => {
            if(clientWidth.value <= 767) return;

            const element = document.getElementById(dyid.value);
            let childNode = document.getElementById(panelId.value);
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
