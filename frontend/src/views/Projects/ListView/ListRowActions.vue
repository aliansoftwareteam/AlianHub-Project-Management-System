<template>
    <span class="lv2__actions" @click.stop>
        <button v-if="has('rename')" type="button" class="lv2__act lv2__act--hover" data-action="rename" :aria-label="t('List.action_rename', { name })" :title="t('List.menu_rename')" @click="emit('choose', 'rename')">
            <span aria-hidden="true">✎</span>
        </button>
        <button v-if="has('subtask')" type="button" class="lv2__act lv2__act--hover" data-action="subtask" :aria-label="t('List.action_subtask', { name })" :title="t('List.menu_subtask')" @click="emit('choose', 'subtask')">
            <ShellIcon name="plus" :size="13" aria-hidden="true" />
        </button>
        <button v-if="has('copy-link')" type="button" class="lv2__act lv2__act--hover" data-action="copy-link" :aria-label="t('List.action_copy_link', { name })" :title="t('List.menu_copy_link')" @click="emit('choose', 'copy-link')">
            <ShellIcon name="link" :size="13" aria-hidden="true" />
        </button>
        <a v-if="has('new-tab')" class="lv2__act lv2__act--hover" data-action="new-tab" :href="href" target="_blank" rel="noopener" :aria-label="t('List.action_new_tab', { name })" :title="t('List.menu_new_tab')">
            <ShellIcon name="external" :size="13" aria-hidden="true" />
        </a>
        <span class="lv2__menu-anchor">
            <button
                ref="menuButton"
                type="button"
                class="lv2__act"
                data-action="menu"
                aria-haspopup="menu"
                :aria-expanded="open ? 'true' : 'false'"
                :aria-label="t('List.action_menu', { name })"
                :title="t('List.action_menu', { name })"
                @click="toggle"
            >
                <ShellIcon name="dots" :size="14" aria-hidden="true" />
            </button>
            <div v-if="open" ref="menu" class="ah-pop lv2__menu" :style="menuStyle" role="menu" :aria-label="t('List.action_menu', { name })" @keydown="onMenuKey">
                <template v-for="item in items" :key="item.id">
                    <div v-if="item.separated" class="ah-pop__sep" role="separator"></div>
                    <a v-if="item.id === 'new-tab'" class="ah-pop__item" role="menuitem" :data-item="item.id" :href="href" target="_blank" rel="noopener" @click="close(false)">{{ t(item.labelKey) }}</a>
                    <button v-else type="button" class="ah-pop__item" :class="{ 'lv2__menu-danger': item.danger }" role="menuitem" :data-item="item.id" @click="choose(item.id)">{{ t(item.labelKey) }}</button>
                </template>
            </div>
        </span>
    </span>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref } from "vue";
import { useI18n } from "vue-i18n";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { useEscapeLayer } from "@/composable/useEscapeLayer";

defineOptions({ name: "ListRowActions" });

const props = defineProps({
    task: { type: Object, required: true },
    href: { type: String, default: "" },
    items: { type: Array, default: () => [] }
});
const emit = defineEmits(["choose"]);

const { t } = useI18n();
const open = ref(false);
const menu = ref(null);
const menuButton = ref(null);
const menuStyle = ref({});

const name = computed(() => props.task.TaskName || "");
const has = (id) => props.items.some((item) => item.id === id);

const menuItems = () => [...(menu.value?.querySelectorAll('[role="menuitem"]') || [])];

function onOutside(event) {
    if (!menu.value?.contains(event.target) && event.target !== menuButton.value && !menuButton.value?.contains(event.target)) close(false);
}

function toggle() {
    if (open.value) {
        close(true);
        return;
    }
    menuStyle.value = placeMenu(menuButton.value.getBoundingClientRect());
    open.value = true;
    document.addEventListener("click", onOutside, true);
    window.addEventListener("scroll", onScroll, true);
    nextTick(() => menuItems()[0]?.focus());
}

const MENU_ROOM = 400;

/* Fixed to the viewport: the group card clips its rows, so an anchored menu on the last
 * row would be cut off. It opens upwards when there is no room below. */
function placeMenu(rect) {
    const right = `${Math.max(8, window.innerWidth - rect.right)}px`;
    return rect.bottom + MENU_ROOM > window.innerHeight
        ? { right, bottom: `${window.innerHeight - rect.top + 4}px` }
        : { right, top: `${rect.bottom + 4}px` };
}

function onScroll(event) {
    if (!menu.value?.contains(event.target)) close(false);
}

function close(returnFocus) {
    if (!open.value) return;
    open.value = false;
    document.removeEventListener("click", onOutside, true);
    window.removeEventListener("scroll", onScroll, true);
    if (returnFocus) nextTick(() => menuButton.value?.focus());
}

const MOVES_FOCUS = ["rename", "subtask", "open", "save-template", "move", "convert-subtask", "convert-list", "merge"];

function choose(id) {
    close(!MOVES_FOCUS.includes(id));
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
        close(false);
    }
}

useEscapeLayer(open, () => close(true));
onBeforeUnmount(() => {
    document.removeEventListener("click", onOutside, true);
    window.removeEventListener("scroll", onScroll, true);
});
</script>
