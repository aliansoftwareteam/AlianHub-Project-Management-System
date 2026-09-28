<template>
    <div
        ref="root"
        :id="id"
        :role="role"
        :tabindex="role ? -1 : undefined"
        :aria-selected="role === 'option' ? String(selected) : undefined"
        class="d-flex align-items-center  hover-bg-lighter-gray-dropdown hover-purple cursor-pointer text-nowrap drop-down-item gray81 p-7px"
        :class="{'bg-gray91 border-radius-8-px': clientWidth <= 767 , 'border-radius-4-px' : clientWidth > 767,'bg-blue white': highlight}"
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
