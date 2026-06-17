<template>
    <div class="story-points" ref="rootEl" :class="{ 'sp-disabled': !permission }">
        <div class="sp-trigger" @click="toggle">
            <span v-if="display !== null" class="sp-chip">{{ display }}</span>
            <span v-else class="sp-empty">Points</span>
        </div>
        <div v-if="open" class="sp-menu">
            <span
                v-for="opt in options"
                :key="'sp-' + opt"
                class="sp-option"
                :class="{ 'sp-active': Number(pointsVal) === opt }"
                @click="choose(opt)"
            >{{ opt }}</span>
            <span class="sp-option sp-clear" @click="choose(null)">Clear</span>
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
.sp-trigger { cursor: pointer; min-width: 34px; padding: 2px 8px; border-radius: 6px; border: 1px solid #e0e0e0; text-align: center; }
.sp-disabled .sp-trigger { cursor: default; opacity: 0.7; }
.sp-chip { font-weight: 600; color: #2f3990; }
.sp-empty { color: #9a9a9a; }
.sp-menu { position: absolute; z-index: 50; top: 115%; left: 0; background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12); padding: 6px; display: flex; flex-wrap: wrap; gap: 4px; width: max-content; max-width: 210px; }
.sp-option { cursor: pointer; padding: 3px 8px; border-radius: 6px; background: #f4f6fb; min-width: 26px; text-align: center; }
.sp-option:hover { background: #e8ecf7; }
.sp-active { background: #2f3990; color: #fff; }
.sp-clear { width: 100%; color: #e84a4a; background: transparent; }
</style>
