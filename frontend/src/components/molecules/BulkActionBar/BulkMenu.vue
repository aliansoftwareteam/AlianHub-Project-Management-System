<template>
    <div class="bulk-menu">
        <button
            class="bulk-action-bar__btn"
            :class="{ 'bulk-action-bar__btn--active': open, 'bulk-action-bar__btn--disabled': disabled }"
            :disabled="disabled"
            :title="disabled ? 'No permission or no options' : label"
            @click.stop="onToggle"
        >
            <span>{{ label }}</span>
        </button>
        <div
            v-if="open"
            class="bulk-menu__panel"
            :style="{ width }"
            @click.stop
        >
            <slot />
        </div>
    </div>
</template>

<script setup>
import { defineProps, defineEmits } from 'vue';

defineProps({
    label: { type: String, required: true },
    open: { type: Boolean, default: false },
    disabled: { type: Boolean, default: false },
    width: { type: String, default: '220px' },
});

const emit = defineEmits(['toggle']);
function onToggle() { emit('toggle'); }
</script>

<style scoped>
.bulk-menu { position: relative; }

.bulk-action-bar__btn {
    appearance: none;
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.14);
    color: #fff;
    border-radius: 8px;
    padding: 7px 14px;
    font-size: 13px;
    cursor: pointer;
    transition: background-color 0.15s ease, border-color 0.15s ease;
    white-space: nowrap;
}
.bulk-action-bar__btn:hover:not(.bulk-action-bar__btn--disabled):not(:disabled) {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.22);
}
.bulk-action-bar__btn--active {
    background: rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 255, 255, 0.28);
}
.bulk-action-bar__btn--disabled,
.bulk-action-bar__btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
}

.bulk-menu__panel {
    position: absolute;
    bottom: calc(100% + 16px);
    left: 0;
    background: #fff;
    color: #2b2b35;
    border: 1px solid rgba(15, 17, 26, 0.06);
    border-radius: 12px;
    box-shadow: 0 12px 32px rgba(15, 17, 26, 0.18), 0 2px 6px rgba(15, 17, 26, 0.06);
    padding: 4px 0;
    max-height: 360px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    z-index: 1001;
}
.bulk-menu__panel :deep(.bulk-menu__item) {
    display: block;
    width: 100%;
    text-align: left;
    background: transparent;
    border: none;
    padding: 6px 12px;
    font-size: 13px;
    cursor: pointer;
    color: #2b2b35;
}
.bulk-menu__panel :deep(.bulk-menu__item:hover) {
    background: #f4f5f7;
}
.bulk-menu__panel :deep(.bulk-menu__row) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 12px;
}
.bulk-menu__panel :deep(.bulk-menu__row:hover) {
    background: #f4f5f7;
}
.bulk-menu__panel :deep(.bulk-menu__row-label) {
    flex: 1;
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
</style>
