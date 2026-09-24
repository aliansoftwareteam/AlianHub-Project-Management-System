<template>
    <div class="ah-undo-toast-region" role="status" aria-live="polite">
        <div
            v-if="undoToast.current"
            :key="undoToast.current.id"
            class="ah-undo-toast"
            @mouseenter="holdUndoToast"
            @mouseleave="releaseUndoToast"
            @focusin="holdUndoToast"
            @focusout="releaseUndoToast"
        >
            <span class="ah-undo-toast__text">{{ undoToast.current.message }}</span>
            <button
                type="button"
                class="ah-undo-toast__undo"
                aria-keyshortcuts="Control+Z Meta+Z"
                :title="$t('UndoToast.undo_hint')"
                @click="runUndo"
            >{{ $t('UndoToast.undo') }}</button>
            <button type="button" class="ah-undo-toast__close" :aria-label="$t('UndoToast.dismiss')" @click="dismissUndoToast">×</button>
        </div>
    </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted } from "vue";
import { undoToast, runUndo, dismissUndoToast, holdUndoToast, releaseUndoToast } from "@/composable/useUndoToast";

defineOptions({ name: "UndoToast" });

const EDITABLE = "input, textarea, select, [contenteditable]:not([contenteditable=\"false\"]), [role=\"textbox\"]";

// Ctrl/Cmd+Z in a text field is the field's own undo, so the shortcut only applies outside one.
function onKeydown(event) {
    if (!undoToast.current || event.defaultPrevented || event.altKey || event.shiftKey) return;
    if (!(event.ctrlKey || event.metaKey) || String(event.key).toLowerCase() !== "z") return;
    const target = event.target && event.target.nodeType === 1 ? event.target : null;
    if (target && (target.isContentEditable || target.closest(EDITABLE))) return;
    event.preventDefault();
    runUndo();
}

onMounted(() => document.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => document.removeEventListener("keydown", onKeydown));
</script>

<style>
.ah-undo-toast-region {
    position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); z-index: 60;
    max-width: calc(100vw - 32px); pointer-events: none;
}
.ah-undo-toast {
    display: flex; align-items: center; gap: 12px; padding: 8px 8px 8px 14px; pointer-events: auto;
    background: var(--rail); color: #fff; border-radius: 9px; box-shadow: var(--shadow-pop); font: 500 12.5px/1.3 var(--font-ui);
}
.ah-undo-toast__text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ah-undo-toast__undo {
    flex: none; min-height: 32px; padding: 0 10px; border: 0; border-radius: 6px; background: transparent;
    color: #c4b5ff; font: 600 12.5px/1 var(--font-ui); cursor: pointer;
}
.ah-undo-toast__undo:hover { background: rgba(255, 255, 255, .12); }
.ah-undo-toast__close {
    flex: none; width: 32px; height: 32px; border: 0; border-radius: 6px; background: transparent;
    color: rgba(255, 255, 255, .7); font-size: 18px; line-height: 1; cursor: pointer;
}
.ah-undo-toast__close:hover { background: rgba(255, 255, 255, .12); color: #fff; }
.ah-undo-toast__undo:focus-visible, .ah-undo-toast__close:focus-visible { outline: 2px solid #c4b5ff; outline-offset: 1px; }
@media (max-width: 767px) {
    .ah-undo-toast-region { bottom: calc(var(--tabbar-h, 56px) + 72px + env(safe-area-inset-bottom, 0px)); width: calc(100vw - 32px); }
    .ah-undo-toast { justify-content: space-between; }
}
</style>
