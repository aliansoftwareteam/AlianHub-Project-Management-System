<template>
    <div
        ref="root"
        :id="id"
        :role="role"
        :tabindex="role ? -1 : undefined"
        :aria-selected="role === 'option' ? String(selected) : undefined"
        class="d-flex align-items-center  drop-down-option-hover-bg-lighter-gray-dropdown drop-down-option-hover-purple cursor-pointer text-nowrap drop-down-item drop-down-option-gray81 p-7px"
        :class="{'drop-down-option-bg-gray91 border-radius-8-px': clientWidth <= 767 , 'border-radius-4-px' : clientWidth > 767,'drop-down-option-bg-blue drop-down-option-white': highlight}"
        @click.prevent="$emit('click')"
    >
        <slot>
            <div class="d-flex align-items-center project-mobile-desc">
                <img class="drop-down-options-image mr-10px w-15px" :src="item.image" v-if="item && item.image" alt="image">
                <span class="project-mobile-desc">{{item.label}}</span>
            </div>
        </slot>
    </div>
</template>

<script setup>
import { computed, defineProps, defineEmits, inject, onMounted, onUpdated, ref } from "vue";

defineEmits(["click"]);
defineProps({
    item: {
        type: Object,
        default: () => {
            return {
                label: "Item",
                image: ""
            }
        }
    },
    id: {
        type: String,
        default: ""
    },
    highlight: {
        type: Boolean,
        default: false
    },
    selected: {
        type: Boolean,
        default: false
    },
})

const ROLES = { menu: "menuitem", listbox: "option" };
const dropDownMode = inject("dropDownMode", null);
const role = computed(() => ROLES[dropDownMode?.value]);

const root = ref(null);

// The option itself carries focus and aria-selected; a checkbox inside it would be a second tab stop announcing the same state.
function hideInnerCheckboxes() {
    if (role.value !== "option" || !root.value) return;
    root.value.querySelectorAll('input[type="checkbox"]').forEach((box) => {
        box.setAttribute("tabindex", "-1");
        box.setAttribute("aria-hidden", "true");
    });
}

const clientWidth = ref(document.body.clientWidth);
onMounted(() => {
    clientWidth.value = document.body.clientWidth;
    hideInnerCheckboxes();
})
onUpdated(hideInnerCheckboxes);
</script>

<style>
@import "./style.css";
</style>

<style scoped>
.drop-down-option-hover-bg-lighter-gray-dropdown:hover {
    background-color: var(--surface-hover) !important;
}
.drop-down-option-hover-purple:hover {
    color: var(--brand) !important;
}
.drop-down-option-gray81 {
    color: var(--ink-2);
}
.drop-down-option-bg-gray91 {
    background-color: var(--fill);
}
.drop-down-option-bg-blue {
    background-color: var(--brand);
}
.drop-down-option-white {
    color: var(--on-brand) !important;
}
</style>
