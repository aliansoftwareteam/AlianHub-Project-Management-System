<template>
    <button
        ref="trigger"
        type="button"
        :class="triggerClass"
        aria-haspopup="menu"
        :aria-expanded="open ? 'true' : 'false'"
        :aria-label="label"
        :title="label"
        @click.stop.prevent="toggle"
        @keydown.down.prevent.stop="show"
    >
        <slot></slot>
    </button>
    <teleport to="body">
        <div v-if="open" ref="menu" class="ah-pop task-menu" :style="menuStyle" role="menu" :aria-label="label" @keydown="onMenuKey">
            <template v-for="item in items" :key="item.id">
                <div v-if="item.separated" class="ah-pop__sep" role="separator"></div>
                <button type="button" class="ah-pop__item" :class="{ 'task-menu__danger': item.danger }" role="menuitem" :data-item="item.id" @click="choose(item.id)">{{ t(item.labelKey) }}</button>
            </template>
        </div>
    </teleport>
</template>

<script setup>
import { nextTick, onBeforeUnmount, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useEscapeLayer } from "@/composable/useEscapeLayer";
import { placeMenu } from "@/views/Projects/composables/menuPlacement";

defineOptions({ name: "TaskMenuPopup" });

defineProps({
    items: { type: Array, default: () => [] },
    label: { type: String, default: "" },
    triggerClass: { type: [String, Array, Object], default: "" }
});
const emit = defineEmits(["choose"]);

const { t } = useI18n();
const open = ref(false);
const menu = ref(null);
const trigger = ref(null);
const HIDDEN_UNTIL_PLACED = { top: "0px", left: "0px", visibility: "hidden" };
const menuStyle = ref(HIDDEN_UNTIL_PLACED);

const menuItems = () => [...(menu.value?.querySelectorAll('[role="menuitem"]') || [])];

function onOutside(event) {
    if (!menu.value?.contains(event.target) && !trigger.value?.contains(event.target)) close(false);
}

function onScroll(event) {
    if (!menu.value?.contains(event.target)) close(false);
}

const onResize = () => close(false);

function stopListening() {
    document.removeEventListener("click", onOutside, true);
    window.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", onResize);
}

function show() {
    if (open.value) return;
    menuStyle.value = HIDDEN_UNTIL_PLACED;
    open.value = true;
    document.addEventListener("click", onOutside, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    nextTick(() => {
        if (!menu.value || !trigger.value) return;
        menuStyle.value = placeMenu(
            trigger.value.getBoundingClientRect(),
            { width: menu.value.offsetWidth, height: menu.value.offsetHeight },
            { width: window.innerWidth, height: window.innerHeight }
        );
        nextTick(() => menuItems()[0]?.focus());
    });
}

function close(returnFocus) {
    if (!open.value) return;
    open.value = false;
    stopListening();
    if (returnFocus) trigger.value?.focus();
}

function toggle() {
    if (open.value) close(true);
    else show();
}

function choose(id) {
    close(true);
    emit("choose", id);
}

function onMenuKey(event) {
    const list = menuItems();
    const index = list.indexOf(document.activeElement);
    if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close(true);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        list[(index + step + list.length) % list.length]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        (event.key === "Home" ? list[0] : list[list.length - 1])?.focus();
    } else if (event.key === "Tab") {
        close(true);
    }
}

useEscapeLayer(open, () => close(true));
onBeforeUnmount(stopListening);
</script>

<style scoped>
/* Teleported to the body, so it stacks above the task panel (40) and below the sidebars (100). */
.task-menu {
    position: fixed;
    z-index: 50;
    max-height: calc(100dvh - 16px);
    overflow-y: auto;
    overscroll-behavior: contain;
}
.task-menu .task-menu__danger,
.task-menu .task-menu__danger:hover { color: var(--danger); }
</style>
