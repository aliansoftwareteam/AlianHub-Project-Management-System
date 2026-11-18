<template>
    <div v-if="modelValue" class="mtf__overlay" @click.self="$emit('update:modelValue', false)" @keydown.esc="$emit('update:modelValue', false)">
        <div class="mtf__card" role="dialog" aria-modal="true" :aria-label="title || $t('Projects.move_to_folder')">
            <div class="mtf__head">
                <span class="mtf__title">{{ title || $t('Projects.move_to_folder') }}</span>
                <button type="button" class="mtf__close" :aria-label="$t('Projects.cancel')" @click="$emit('update:modelValue', false)">&#10005;</button>
            </div>

            <div class="mtf__hint">{{ hint || $t('Projects.select_folder') }}</div>

            <div class="mtf__list ah-scroll">
                <button
                    type="button"
                    class="mtf__item mtf__item--root"
                    :class="{ 'mtf__item--active': !currentFolderId }"
                    :aria-current="!currentFolderId ? 'true' : undefined"
                    @click="!currentFolderId ? null : $emit('select', null)"
                >
                    <span class="mtf__icon-wrap">
                        <img :src="homeIcon" alt="" class="mtf__icon" />
                    </span>
                    <span class="mtf__name mtf__name--root">{{ rootLabel || $t('Projects.no_folder_root') }}</span>
                    <span v-if="!currentFolderId" class="mtf__check" aria-hidden="true">&#10003;</span>
                </button>

                <div v-if="folders.length" class="mtf__sep"></div>

                <button
                    v-for="folder in folders"
                    :key="folder.id"
                    type="button"
                    class="mtf__item"
                    :class="{ 'mtf__item--active': folder.id === currentFolderId, 'mtf__item--sub': folder.depth > 0 }"
                    :aria-current="folder.id === currentFolderId ? 'true' : undefined"
                    @click="folder.id === currentFolderId ? null : $emit('select', folder)"
                >
                    <span class="mtf__icon-wrap">
                        <img :src="folderIcon" alt="" class="mtf__icon" />
                    </span>
                    <span class="mtf__name">{{ folder.name }}</span>
                    <span v-if="folder.id === currentFolderId" class="mtf__check" aria-hidden="true">&#10003;</span>
                </button>
            </div>

            <div class="mtf__footer">
                <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="$emit('update:modelValue', false)">{{ $t('Projects.cancel') }}</button>
            </div>
        </div>
    </div>
</template>

<script setup>
import { defineProps, defineEmits } from "vue";

import homeIcon from "@/assets/images/svg/Home.svg";
import folderIcon from "@/assets/images/svg/blue_folder.svg";

/* `folders` is [{ id, name, depth }]: a subfolder (depth 1) follows its folder and is set in from it.
   `title`, `hint` and `rootLabel` replace the wording for moving a sprint when something else is moved. */
defineProps({
    modelValue: {
        type: Boolean,
        default: false
    },
    folders: {
        type: Array,
        default: () => []
    },
    currentFolderId: {
        type: [String, Number],
        default: null
    },
    title: {
        type: String,
        default: ''
    },
    hint: {
        type: String,
        default: ''
    },
    rootLabel: {
        type: String,
        default: ''
    }
});

defineEmits(['select', 'update:modelValue']);
</script>

<style scoped>
.mtf__overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, .35);
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--sp-7);
}
.mtf__card {
    background: var(--surface);
    color: var(--ink);
    border-radius: 10px;
    width: min(420px, 100%);
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    padding: var(--sp-7) var(--sp-8);
    box-shadow: var(--shadow-pop);
    font-family: var(--font-ui);
}
.mtf__head { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3); margin-bottom: var(--sp-5); }
.mtf__title { font-size: 16px; font-weight: 700; }
.mtf__close {
    border: 0;
    background: transparent;
    color: var(--ink-2);
    font-size: 16px;
    cursor: pointer;
    min-width: 28px;
    min-height: 28px;
    border-radius: 5px;
}
.mtf__close:hover { color: var(--danger); background: var(--surface-hover); }
.mtf__close:focus-visible { outline: none; box-shadow: var(--focus); }
.mtf__hint { font-size: 13px; color: var(--ink-2); margin-bottom: var(--sp-4); }
.mtf__list {
    overflow-y: auto;
    max-height: 46vh;
    margin-bottom: var(--sp-5);
}
.mtf__item {
    display: flex;
    align-items: center;
    width: 100%;
    padding: 9px var(--sp-5);
    border: 1px solid var(--border);
    border-radius: 8px;
    margin-bottom: var(--sp-3);
    background: transparent;
    color: var(--ink);
    font: inherit;
    text-align: left;
    cursor: pointer;
}
.mtf__item:hover { background: var(--surface-hover); }
.mtf__item:focus-visible { outline: none; box-shadow: var(--focus); }
.mtf__item--active {
    background: var(--brand-tint);
    border-color: var(--brand-border);
    cursor: default;
}
.mtf__item--root {
    border-style: dashed;
    margin-bottom: var(--sp-4);
}
.mtf__item--sub {
    width: calc(100% - var(--sp-9));
    margin-left: var(--sp-9);
}
.mtf__icon-wrap {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-right: var(--sp-4);
    flex: 0 0 auto;
    background: var(--fill);
}
.mtf__icon { width: 16px; height: 16px; }
.mtf__name {
    flex: 1 1 auto;
    min-width: 0;
    font-size: 14px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.mtf__name--root { font-weight: 600; }
.mtf__check {
    margin-left: auto;
    padding-left: var(--sp-3);
    flex: 0 0 auto;
    font-size: 13px;
    color: var(--brand);
}
.mtf__sep {
    height: 1px;
    background: var(--hairline);
    margin: 2px 2px var(--sp-5);
}
.mtf__footer { display: flex; justify-content: flex-end; margin-top: var(--sp-1); }
</style>
