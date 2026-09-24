<template>
    <div class="story-points" ref="rootEl" :class="{ 'sp-disabled': !permission }">
        <button type="button" class="sp-trigger" :disabled="!permission" :aria-expanded="open ? 'true' : 'false'" @click="toggle">
            <span v-if="display !== null" class="sp-chip">{{ display }}</span>
            <span v-else class="sp-empty">{{ emptyLabel || $t('Scrum.story_points_empty') }}</span>
        </button>
        <div v-if="open" class="sp-menu">
            <button
                v-for="opt in options"
                :key="'sp-' + opt"
                type="button"
                class="sp-option"
                :class="{ 'sp-active': Number(pointsVal) === opt }"
                :aria-pressed="Number(pointsVal) === opt ? 'true' : 'false'"
                @click="choose(opt)"
            >{{ opt }}</button>
            <button type="button" class="sp-option sp-clear" @click="choose(null)">{{ $t('Scrum.story_points_clear') }}</button>
        </div>
    </div>
</template>

<script>
export default { name: 'StoryPoints' };
</script>

<script setup>
import { computed, ref, onBeforeUnmount } from 'vue';

const props = defineProps({
    pointsVal: { type: [Number, String], default: null },
    estimationScale: { type: String, default: 'fibonacci' },
    permission: { type: Boolean, default: true },
    emptyLabel: { type: String, default: '' },
});
const emit = defineEmits(['select']);

// Point scales offered by the picker; the project's estimationScale selects one.
const SCALES = {
    fibonacci: [1, 2, 3, 5, 8, 13, 21],
    linear: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    tshirt: [1, 2, 3, 5, 8],
    hours: [1, 2, 4, 8, 16, 24, 40],
};

const rootEl = ref(null);
const open = ref(false);
const options = computed(() => SCALES[props.estimationScale] || SCALES.fibonacci);
const display = computed(() => (
    props.pointsVal === null || props.pointsVal === undefined || props.pointsVal === '' ? null : props.pointsVal
));

// Close when the click lands outside this picker. Capture phase + a contains()
// check, so it never fires for the click that just opened the menu and so
// opening another row's picker closes this one. Listener lives only while open.
function onDocClick(event) {
    if (rootEl.value && !rootEl.value.contains(event.target)) closeMenu();
}
function openMenu() {
    open.value = true;
    document.addEventListener('click', onDocClick, true);
}
function closeMenu() {
    if (!open.value) return;
    open.value = false;
    document.removeEventListener('click', onDocClick, true);
}
function toggle() {
    if (!props.permission) return;
    if (open.value) closeMenu();
    else openMenu();
}
function choose(value) {
    closeMenu();
    emit('select', value);
}
onBeforeUnmount(() => document.removeEventListener('click', onDocClick, true));
</script>

<style scoped>
.story-points { position: relative; display: inline-block; font-size: 13px; }
.sp-trigger { cursor: pointer; min-width: 34px; padding: 2px 8px; border-radius: 6px; border: 1px solid var(--border, #e0e0e0); background: transparent; color: inherit; font: inherit; text-align: center; }
.sp-trigger:focus-visible, .sp-option:focus-visible { outline: none; box-shadow: var(--focus, 0 0 0 2px #2f3990); }
.sp-disabled .sp-trigger { cursor: default; opacity: 0.7; }
.sp-chip { font-weight: 600; color: var(--brand, #2f3990); }
.sp-empty { color: var(--ink-2, #6b6b6b); }
.sp-menu { position: absolute; z-index: 50; top: 115%; left: 0; background: var(--surface, #fff); border: 1px solid var(--border, #e0e0e0); border-radius: 8px; box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12); padding: 6px; display: flex; flex-wrap: wrap; gap: 4px; width: max-content; max-width: 210px; }
.sp-option { cursor: pointer; padding: 3px 8px; border: 0; border-radius: 6px; background: var(--fill, #f4f6fb); color: inherit; font: inherit; min-width: 26px; text-align: center; }
.sp-option:hover { background: var(--surface-hover, #e8ecf7); }
.sp-active, .sp-active:hover { background: var(--brand, #2f3990); color: var(--on-brand, #fff); }
.sp-clear { width: 100%; color: var(--danger, #e84a4a); background: transparent; }
</style>
