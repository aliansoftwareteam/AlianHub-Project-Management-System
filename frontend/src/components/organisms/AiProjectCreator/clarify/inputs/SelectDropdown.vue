<template>
    <!--
        Single-choice dropdown. Used when the option list is long or screen
        space is constrained and descriptions aren't needed inline.
    -->
    <div class="select-dropdown" ref="wrapperRef">
        <button
            type="button"
            class="select-dropdown__trigger"
            :class="{ 'select-dropdown__trigger--open': isOpen }"
            :aria-expanded="isOpen"
            aria-haspopup="listbox"
            @click="toggleOpen"
        >
            <span class="select-dropdown__value">
                <template v-if="selectedOption">
                    {{ selectedOption.label }}
                    <span
                        v-if="recommended === selectedOption.value"
                        class="select-dropdown__rec-pill"
                    >Recommended</span>
                </template>
                <span v-else class="select-dropdown__placeholder">{{ placeholder }}</span>
            </span>
            <svg
                class="select-dropdown__chevron"
                :class="{ 'select-dropdown__chevron--open': isOpen }"
                width="16" height="16" viewBox="0 0 16 16" fill="none"
                aria-hidden="true"
            >
                <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5"
                      stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        </button>

        <Transition name="select-dropdown__panel">
            <ul
                v-if="isOpen"
                class="select-dropdown__panel"
                role="listbox"
                :aria-activedescendant="modelValue ? `opt-${modelValue}` : undefined"
            >
                <li
                    v-for="opt in options"
                    :key="opt.value"
                    :id="`opt-${opt.value}`"
                    class="select-dropdown__option"
                    :class="{
                        'select-dropdown__option--selected': modelValue === opt.value,
                        'select-dropdown__option--recommended': recommended === opt.value && modelValue !== opt.value,
                    }"
                    role="option"
                    :aria-selected="modelValue === opt.value"
                    @click="select(opt.value)"
                >
                    <span class="select-dropdown__radio" aria-hidden="true">
                        <span v-if="modelValue === opt.value" class="select-dropdown__radio-dot"></span>
                    </span>
                    <span class="select-dropdown__body">
                        <span class="select-dropdown__title">
                            {{ opt.label }}
                            <span v-if="recommended === opt.value" class="select-dropdown__rec-pill">Recommended</span>
                        </span>
                        <span v-if="opt.description" class="select-dropdown__desc">{{ opt.description }}</span>
                    </span>
                </li>
            </ul>
        </Transition>
    </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, defineProps, defineEmits } from 'vue';

const props = defineProps({
    modelValue: { type: [String, Number, null], default: null },
    options:    { type: Array, required: true },
    recommended:{ type: [String, null], default: null },
    placeholder:{ type: String, default: 'Select an option' },
});
const emit = defineEmits(['update:modelValue']);

const isOpen     = ref(false);
const wrapperRef = ref(null);

const selectedOption = computed(() =>
    props.options.find(o => o.value === props.modelValue) ?? null
);

function toggleOpen() { isOpen.value = !isOpen.value; }

function select(value) {
    emit('update:modelValue', value);
    isOpen.value = false;
}

function onOutsideClick(e) {
    if (wrapperRef.value && !wrapperRef.value.contains(e.target)) {
        isOpen.value = false;
    }
}

onMounted(()      => document.addEventListener('mousedown', onOutsideClick));
onBeforeUnmount(() => document.removeEventListener('mousedown', onOutsideClick));
</script>

<style scoped>
/* ── Container ─────────────────────────────────────────── */
.select-dropdown {
    position: relative;
    width: 100%;
}

/* ── Trigger button ────────────────────────────────────── */
.select-dropdown__trigger {
    appearance: none;
    width: 100%;
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 10px;
    padding: 10px 14px;
    font: inherit;
    font-size: 14px;
    color: #2b2b35;
    cursor: pointer;
    text-align: left;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    transition: background-color 0.15s ease, border-color 0.15s ease;
}
.select-dropdown__trigger:hover:not(.select-dropdown__trigger--open) {
    background: #f8f9fb;
    border-color: #d1d5db;
}
.select-dropdown__trigger--open {
    background: #eef0ff;
    border-color: #2F3990;
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
}

/* ── Trigger internals ─────────────────────────────────── */
.select-dropdown__value {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-weight: 500;
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.select-dropdown__placeholder {
    color: #9ca3af;
    font-weight: 400;
}
.select-dropdown__chevron {
    flex-shrink: 0;
    color: #9ca3af;
    transition: transform 0.2s ease;
}
.select-dropdown__chevron--open {
    transform: rotate(180deg);
    color: #2F3990;
}

/* ── Panel ─────────────────────────────────────────────── */
.select-dropdown__panel {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    z-index: 50;
    background: #fff;
    border: 1px solid #2F3990;
    border-top: none;
    border-bottom-left-radius: 10px;
    border-bottom-right-radius: 10px;
    padding: 4px;
    margin: 0;
    list-style: none;
    box-shadow: 0 8px 24px rgba(64, 84, 236, 0.1);
    overflow: hidden;
}

/* ── Panel transition ──────────────────────────────────── */
.select-dropdown__panel-enter-active,
.select-dropdown__panel-leave-active {
    transition: opacity 0.15s ease, transform 0.15s ease;
}
.select-dropdown__panel-enter-from,
.select-dropdown__panel-leave-to {
    opacity: 0;
    transform: translateY(-4px);
}

/* ── Option rows ───────────────────────────────────────── */
.select-dropdown__option {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 10px 10px;
    border-radius: 7px;
    cursor: pointer;
    transition: background-color 0.12s ease;
}
.select-dropdown__option:hover:not(.select-dropdown__option--selected) {
    background: #f8f9fb;
}
.select-dropdown__option--selected {
    background: #eef0ff;
}
.select-dropdown__option--recommended {
    outline: 1px solid #c7cdfa;
    outline-offset: -1px;
}

/* ── Radio indicator ───────────────────────────────────── */
.select-dropdown__radio {
    flex-shrink: 0;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 1.5px solid #d1d5db;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-top: 2px;
    background: #fff;
}
.select-dropdown__option--selected .select-dropdown__radio {
    border-color: #2F3990;
}
.select-dropdown__radio-dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: #2F3990;
}

/* ── Option body ───────────────────────────────────────── */
.select-dropdown__body {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
}
.select-dropdown__title {
    font-size: 14px;
    font-weight: 500;
    color: #2b2b35;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
}
.select-dropdown__rec-pill {
    font-size: 10px;
    font-weight: 600;
    color: #2F3990;
    background: #e6e8ff;
    padding: 2px 6px;
    border-radius: 4px;
    letter-spacing: 0.3px;
    text-transform: uppercase;
}
.select-dropdown__desc {
    font-size: 12px;
    color: #6b7280;
    line-height: 1.45;
}
</style>