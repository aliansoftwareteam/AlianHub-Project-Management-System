<template>
    <div :id="uid" v-if="modelValue" class="position-fi modal-wrapper">
        <teleport to="#my-modal">
            <div class="modal-overlay" @click="closeOnBackdrop ? closeModal() : ''"></div>
            <!--
                BUG-044 / #98 — give the modal proper ARIA dialog
                semantics so screen readers announce it and assistive
                tech can trap focus. role="dialog" + aria-modal="true"
                + aria-labelledby pointing at the title element.
            -->
            <div
                ref="modalRef"
                class="modal"
                :style="styles"
                :class="className"
                role="dialog"
                aria-modal="true"
                :aria-labelledby="titleId"
                tabindex="-1"
                @keydown.tab="handleTabKeydown"
                @keydown.esc.stop="closeModal"
            >
                <div class="modal-header d-flex align-items-center justify-content-between" :class="headerClasses" v-if="header">
                    <slot name="header">
                        <span :id="titleId">{{title}}</span>
                        <img v-if="closeIcon" :src="cancelIcon" class="cursor-pointer cancel__icon-img" alt="close" @click.prevent="closeModal()">
                    </slot>
                </div>
                <div class="modal-body" :class="bodyClasses">
                    <slot name="body"/>
                </div>
                <div class="modal-footer" v-if="footer">
                    <slot class="modal-footer" name="footer">
                        <div class="d-flex justify-content-end">
                            <button class="outline-secondary" @click="closeModal()" v-if="cancelButton">{{cancelButtonText === "Cancel" ? $t('Projects.cancel') : cancelButtonText}}</button>
                            <button class="btn-primary ml-10px" @click="$emit('accept', true)" v-if="acceptButton">{{acceptButtonText}}</button>
                        </div>
                    </slot>
                </div>
            </div>
        </teleport>
    </div>
</template>

<script setup>
// PACKAGES
import { useCustomComposable } from "@/composable";
import { computed, defineComponent, defineEmits, defineProps, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue"

// UTILS
const {makeUniqueId} = useCustomComposable();

// IMAGES
const cancelIcon = require("@/assets/images/cancel_icon.png");

defineComponent({
    name: 'ModalComponent'
})

const emit = defineEmits(["close", "accept", "removeListners"])

const props = defineProps({
    closeOnBackdrop: {
        type: Boolean,
        default: true
    },
    closeIcon: {
        type: Boolean,
        default: true
    },

    className: {
        type: String,
        default: ""
    },

    styles: {
        type: [String, Object],
        default: ""
    },

    modelValue: {
        type: Boolean,
        default: false
    },

    title: {
        type: String,
        default: ""
    },

    id: {
        type: String,
        default: ""
    },

    header: {
        type: Boolean,
        default: true
    },
    footer: {
        type: Boolean,
        default: true
    },

    cancelButton: {
        type: Boolean,
        default: true
    },
    cancelButtonText: {
        type: String,
        default: "Cancel"
    },

    acceptButton: {
        type: Boolean,
        default: true
    },
    acceptButtonText: {
        type: String,
        default: "Accept"
    },
    headerClasses: {
        type: String,
        default: ""
    },
    bodyClasses: {
        type: String,
        default: ""
    },
})

const uid = ref("");
const modalRef = ref(null);

// BUG-044 / #98 — id for the title element so `aria-labelledby` can
// point at it. Memoised per-instance via makeUniqueId() so multiple
// modals on the same page don't collide.
const titleId = computed(() => `${uid.value || 'modal'}-title`);

let previouslyFocused = null;

const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
].join(',');

function getFocusable() {
    const root = modalRef.value;
    if (!root) return [];
    return Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR))
        .filter(el => !el.hasAttribute('aria-hidden') && el.offsetParent !== null);
}

// BUG-044 / #98 — keep focus inside the modal. Tab cycles forward,
// Shift+Tab cycles backward; both wrap at the ends.
function handleTabKeydown(e) {
    const focusable = getFocusable();
    if (!focusable.length) {
        // Nothing inside is focusable — pin focus on the dialog itself.
        e.preventDefault();
        modalRef.value && modalRef.value.focus();
        return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
    }
}

async function activateFocusTrap() {
    previouslyFocused = document.activeElement;
    await nextTick();
    const focusable = getFocusable();
    if (focusable.length) {
        focusable[0].focus();
    } else if (modalRef.value) {
        modalRef.value.focus();
    }
}

function deactivateFocusTrap() {
    if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
    }
    previouslyFocused = null;
}

onMounted(() => {
    if(props.id) {
        uid.value = props.id
    } else {
        uid.value = makeUniqueId();
    }
    if (props.modelValue) {
        activateFocusTrap();
    }
})

// Re-arm the focus trap whenever the modal opens, and restore focus
// on close.
watch(() => props.modelValue, (isOpen) => {
    if (isOpen) {
        activateFocusTrap();
    } else {
        deactivateFocusTrap();
    }
});

onBeforeUnmount(() => {
    deactivateFocusTrap();
});

function closeModal() {
    emit("close", !props.modelValue);
    emit("removeListners");
}
</script>

<style scoped>
@import './style.css';

</style>