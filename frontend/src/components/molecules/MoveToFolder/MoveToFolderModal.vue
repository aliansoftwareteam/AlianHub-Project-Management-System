<template>
    <div v-if="modelValue" class="mtf__overlay" @click.self="$emit('update:modelValue', false)">
        <div class="mtf__card">
            <div class="d-flex align-items-center justify-content-between mtf__head">
                <span class="font-size-16 font-weight-700">{{ $t('Projects.move_to_folder') }}</span>
                <span class="cursor-pointer font-size-16 mtf__close" @click="$emit('update:modelValue', false)">&#10005;</span>
            </div>

            <div class="font-size-13 gray81 mb-10px">{{ $t('Projects.select_folder') }}</div>

            <div class="mtf__list style-scroll">
                <!-- ROOT (no folder): home icon in a neutral chip so it reads clearly as the top level, not a folder -->
                <div
                    class="mtf__item mtf__item--root d-flex align-items-center"
                    :class="{ 'mtf__item--active': !currentFolderId }"
                    @click="!currentFolderId ? null : $emit('select', null)"
                >
                    <span class="mtf__icon-wrap mtf__icon-wrap--root">
                        <img :src="homeIcon" alt="root" class="mtf__icon" />
                    </span>
                    <span class="mtf__name font-size-14 font-weight-600">{{ $t('Projects.no_folder_root') }}</span>
                    <span v-if="!currentFolderId" class="mtf__check font-size-13 blue">&#10003;</span>
                </div>

                <!-- divider so "root" is visually separated from the list of folders -->
                <div v-if="folders.length" class="mtf__sep"></div>

                <!-- FOLDERS: folder icon in a blue chip -->
                <div
                    v-for="folder in folders"
                    :key="folder.id"
                    class="mtf__item d-flex align-items-center"
                    :class="{ 'mtf__item--active': folder.id === currentFolderId }"
                    @click="folder.id === currentFolderId ? null : $emit('select', folder)"
                >
                    <span class="mtf__icon-wrap mtf__icon-wrap--folder">
                        <img :src="folderIcon" alt="folder" class="mtf__icon" />
                    </span>
                    <span class="mtf__name font-size-14 text-ellipse">{{ folder.name }}</span>
                    <span v-if="folder.id === currentFolderId" class="mtf__check font-size-13 blue">&#10003;</span>
                </div>
            </div>

            <div class="d-flex align-items-center justify-content-end mtf__footer">
                <button class="outline-primary font-size-14" @click="$emit('update:modelValue', false)">{{ $t('Projects.cancel') }}</button>
            </div>
        </div>
    </div>
</template>

<script setup>
// PACKAGES
import { defineProps, defineEmits } from "vue";

// IMAGES — distinct glyphs so the user can tell root from a folder at a glance
import homeIcon from "@/assets/images/svg/Home.svg";
import folderIcon from "@/assets/images/svg/blue_folder.svg";

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
    }
});

defineEmits(['select', 'update:modelValue']);
</script>

<style scoped>
.mtf__overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.35);
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
}
.mtf__card {
    background: #fff;
    color: #172b4d;
    border-radius: 10px;
    width: min(420px, 92vw);
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    padding: 16px 20px;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.18);
}
.mtf__head { margin-bottom: 12px; }
.mtf__close { color: #9a9a9a; }
.mtf__close:hover { color: #e84a4a; }
.mtf__list {
    overflow-y: auto;
    max-height: 46vh;
    margin-bottom: 12px;
}
.mtf__item {
    padding: 9px 12px;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    margin-bottom: 8px;
    cursor: pointer;
}
.mtf__item:hover { background: #f4f5f7; }
.mtf__item--active {
    background: #f4f5f7;
    border-color: #8591F9;
    cursor: default;
}
/* root row reads as the "top level" — subtle dashed look sets it apart from real folders */
.mtf__item--root {
    border-style: dashed;
    margin-bottom: 10px;
}
/* icon chip — neutral tint for root, blue for folders */
.mtf__icon-wrap {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-right: 10px;
    flex: 0 0 auto;
}
.mtf__icon-wrap--root { background: #eceef3; }
.mtf__icon-wrap--folder { background: #eef0ff; }
.mtf__icon { width: 16px; height: 16px; }
.mtf__name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.mtf__check {
    margin-left: auto;
    padding-left: 8px;
    flex: 0 0 auto;
}
/* separator between the root option and the folder list */
.mtf__sep {
    height: 1px;
    background: #ececf0;
    margin: 2px 2px 12px;
}
.mtf__footer { margin-top: 4px; }
</style>
