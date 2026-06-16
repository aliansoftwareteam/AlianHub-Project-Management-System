<template>
    <div v-if="modelValue" class="stickies__overlay" @click.self="close">
        <div class="stickies__panel" @click="openMenuId = null">
            <div class="d-flex align-items-center justify-content-between stickies__head">
                <span class="font-size-16 font-weight-700">{{ $t('Stickies.title') }}</span>
                <div class="d-flex align-items-center">
                    <button class="btn-primary font-size-12 mr-10px" :disabled="isBusy" @click="addNote">+ {{ $t('Stickies.add') }}</button>
                    <span class="cursor-pointer font-size-16 stickies__close" @click="close">&#10005;</span>
                </div>
            </div>

            <div v-if="isLoading" class="gray81 font-size-12 stickies__empty">{{ $t('Stickies.loading') }}</div>
            <div v-else-if="!notes.length" class="gray81 font-size-12 stickies__empty">{{ $t('Stickies.empty') }}</div>

            <Draggable
                v-else
                class="stickies__grid"
                :list="notes"
                item-key="_id"
                handle=".stickies__note-head"
                @end="onReorder"
            >
                <template #item="{ element: note }">
                    <div
                        class="stickies__note"
                        :class="{ 'stickies__note--menu-open': openMenuId === note._id, 'stickies__note--pinned': note.isPinned }"
                        :style="{ background: colorBg(note.color) }"
                    >
                        <!-- Head doubles as the drag handle so the textarea below stays editable. -->
                        <div class="stickies__note-head" :title="$t('Stickies.drag_hint')">
                            <span class="stickies__head-left">
                                <img :src="dragGrip" alt="" class="stickies__drag-grip">
                                <span v-if="note.isPinned" class="stickies__pin">&#128204;</span>
                            </span>
                            <button class="stickies__menu-btn" :title="$t('Stickies.options')" @click.stop="toggleMenu(note)">
                                <img :src="horizontalDots" alt="options" class="vertical-middle">
                            </button>
                        </div>

                        <!-- Per-note actions menu (pin / expand / color / delete live here
                             so new options can be added without crowding the card). -->
                        <div v-if="openMenuId === note._id" class="stickies__menu" @click.stop>
                            <div class="stickies__menu-item" @click="togglePin(note)">{{ note.isPinned ? $t('Stickies.unpin') : $t('Stickies.pin') }}</div>
                            <div class="stickies__menu-item" @click="expand(note)">{{ $t('Stickies.expand') }}</div>
                            <div class="stickies__menu-colors">
                                <span
                                    v-for="c in colors"
                                    :key="note._id + '-' + c"
                                    class="stickies__dot"
                                    :class="{ 'stickies__dot--active': note.color === c }"
                                    :style="{ background: colorBg(c) }"
                                    :title="c"
                                    @click="setColor(note, c)"
                                ></span>
                            </div>
                            <div class="stickies__menu-item stickies__menu-item--danger" @click="remove(note)">{{ $t('Stickies.delete') }}</div>
                        </div>

                        <input
                            v-model="note.title"
                            class="stickies__title"
                            :placeholder="$t('Stickies.title_placeholder')"
                            @input="scheduleSave(note)"
                            @blur="saveNow(note)"
                        />
                        <textarea
                            v-model="note.content"
                            class="stickies__text"
                            :placeholder="$t('Stickies.placeholder')"
                            rows="5"
                            @input="scheduleSave(note)"
                            @blur="saveNow(note)"
                        ></textarea>
                    </div>
                </template>
            </Draggable>
        </div>

        <!-- Expanded single-note view. -->
        <div v-if="expandedNote" class="stickies__expand-overlay" @click.self="closeExpand">
            <div class="stickies__expand-card" :style="{ background: colorBg(expandedNote.color) }">
                <div class="d-flex align-items-center justify-content-between stickies__expand-head">
                    <div class="d-flex align-items-center">
                        <span
                            v-for="c in colors"
                            :key="'exp-' + c"
                            class="stickies__dot"
                            :class="{ 'stickies__dot--active': expandedNote.color === c }"
                            :style="{ background: colorBg(c) }"
                            :title="c"
                            @click="setColor(expandedNote, c)"
                        ></span>
                    </div>
                    <span class="cursor-pointer font-size-16 stickies__close" @click="closeExpand">&#10005;</span>
                </div>
                <input
                    v-model="expandedNote.title"
                    class="stickies__expand-title"
                    :placeholder="$t('Stickies.title_placeholder')"
                    @input="scheduleSave(expandedNote)"
                    @blur="saveNow(expandedNote)"
                />
                <textarea
                    v-model="expandedNote.content"
                    class="stickies__expand-text"
                    :placeholder="$t('Stickies.placeholder')"
                    @input="scheduleSave(expandedNote)"
                    @blur="saveNow(expandedNote)"
                ></textarea>
            </div>
        </div>
    </div>
</template>

<script setup>
// PACKAGES
import { defineProps, inject, ref, watch } from "vue";
import { useToast } from "vue-toast-notification";
import { useI18n } from "vue-i18n";

// COMPONENTS
import Draggable from 'vuedraggable';

// IMAGE
import horizontalDots from "@/assets/images/svg/horizontalDots.svg";
import dragGrip from "@/assets/images/svg/4DotsDrag.svg";

// UTILS
import { apiRequest } from '@/services';

const { t } = useI18n();
const $toast = useToast();
const userId = inject('$userId');

const props = defineProps({
    modelValue: {
        type: Boolean,
        default: false,
    },
});

const emit = defineEmits(['update:modelValue']);

const colors = ['yellow', 'green', 'blue', 'pink', 'orange', 'purple', 'gray'];
const COLOR_BG = {
    yellow: '#fff3b0', green: '#c8e6c9', blue: '#bbdefb', pink: '#f8bbd0',
    orange: '#ffe0b2', purple: '#e1bee7', gray: '#e6e6e6',
};
const SAVE_DEBOUNCE_MS = 600;

const notes = ref([]);
const isLoading = ref(false);
const isBusy = ref(false);
const openMenuId = ref(null);
const expandedNote = ref(null);
const saveTimers = {};

const colorBg = (color) => COLOR_BG[color] || COLOR_BG.yellow;

function close() {
    emit('update:modelValue', false);
}

watch(() => props.modelValue, (open) => {
    if (open) {
        openMenuId.value = null;
        expandedNote.value = null;
        fetchStickies();
    }
});

function toggleMenu(note) {
    openMenuId.value = openMenuId.value === note._id ? null : note._id;
}

function expand(note) {
    openMenuId.value = null;
    expandedNote.value = note;
}

function closeExpand() {
    saveNow(expandedNote.value);
    expandedNote.value = null;
}

function fetchStickies() {
    isLoading.value = true;
    apiRequest('get', `/api/v2/stickies?uid=${encodeURIComponent(userId.value)}`)
    .then((response) => {
        notes.value = response.data?.status ? (response.data.data || []) : [];
    })
    .catch((error) => console.error('ERROR in fetch stickies: ', error))
    .finally(() => { isLoading.value = false; });
}

function addNote() {
    if (isBusy.value) return;
    isBusy.value = true;
    apiRequest('post', '/api/v2/stickies', { content: '', color: 'yellow', userData: { id: userId.value } })
    .then((response) => {
        if (response.data?.status) {
            notes.value.unshift(response.data.data);
        } else {
            $toast.error(response.data?.statusText || t('Toast.something_went_wrong'), { position: 'top-right' });
        }
    })
    .catch((error) => console.error('ERROR in add sticky: ', error))
    .finally(() => { isBusy.value = false; });
}

// Debounced per-note content save (keyed by id so editing one note never
// cancels a pending save on another).
function scheduleSave(note) {
    if (saveTimers[note._id]) clearTimeout(saveTimers[note._id]);
    saveTimers[note._id] = setTimeout(() => saveNow(note), SAVE_DEBOUNCE_MS);
}

function saveNow(note) {
    if (!note) return;
    if (saveTimers[note._id]) {
        clearTimeout(saveTimers[note._id]);
        delete saveTimers[note._id];
    }
    apiRequest('put', `/api/v2/stickies/${note._id}`, { title: note.title, content: note.content, userData: { id: userId.value } })
    .catch((error) => console.error('ERROR in save sticky: ', error));
}

function setColor(note, color) {
    note.color = color;
    apiRequest('put', `/api/v2/stickies/${note._id}`, { color, userData: { id: userId.value } })
    .catch((error) => console.error('ERROR in set sticky color: ', error));
}

// Re-sort to match the server order: pinned first, then sortIndex, then newest.
function resort() {
    notes.value = [...notes.value].sort((a, b) =>
        (Number(b.isPinned) - Number(a.isPinned))
        || ((a.sortIndex || 0) - (b.sortIndex || 0))
        || (new Date(b.updatedAt) - new Date(a.updatedAt))
    );
}

function togglePin(note) {
    openMenuId.value = null;
    note.isPinned = !note.isPinned;
    apiRequest('put', `/api/v2/stickies/${note._id}`, { isPinned: note.isPinned, userData: { id: userId.value } })
    .then(() => resort())
    .catch((error) => console.error('ERROR in toggle pin: ', error));
}

// Persist the new manual order after a drag (vuedraggable has already
// reordered `notes` in place); write sequential sortIndex values.
function onReorder() {
    const ids = notes.value.map((n) => n._id);
    notes.value.forEach((n, i) => { n.sortIndex = i; });
    apiRequest('put', '/api/v2/stickies/reorder', { ids, userData: { id: userId.value } })
    .catch((error) => console.error('ERROR in reorder stickies: ', error));
}

function remove(note) {
    openMenuId.value = null;
    // Cancel any pending debounced save so it can't fire a stale PUT after delete.
    if (saveTimers[note._id]) {
        clearTimeout(saveTimers[note._id]);
        delete saveTimers[note._id];
    }
    apiRequest('delete', `/api/v2/stickies/${note._id}?uid=${encodeURIComponent(userId.value)}`)
    .then((response) => {
        if (response.data?.status) {
            if (expandedNote.value && expandedNote.value._id === note._id) expandedNote.value = null;
            notes.value = notes.value.filter((n) => n._id !== note._id);
        } else {
            $toast.error(response.data?.statusText || t('Toast.something_went_wrong'), { position: 'top-right' });
        }
    })
    .catch((error) => console.error('ERROR in delete sticky: ', error));
}
</script>

<style scoped>
.stickies__overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.35);
    z-index: 1000;
    display: flex;
    justify-content: flex-end;
}
.stickies__panel {
    background: #fff;
    width: min(400px, 92vw);
    height: 100%;
    padding: 16px 18px;
    overflow-y: auto;
    box-shadow: -8px 0 30px rgba(0, 0, 0, 0.18);
}
.stickies__head { margin-bottom: 14px; }
.stickies__close { color: #9a9a9a; }
.stickies__close:hover { color: #e84a4a; }
.stickies__empty { padding: 32px 12px; text-align: center; }
.stickies__grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    /* start (not stretch) so resizing one note doesn't stretch its row sibling */
    align-items: start;
}
.stickies__note {
    position: relative;
    border-radius: 8px;
    padding: 10px;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
    display: flex;
    flex-direction: column;
}
.stickies__note--menu-open { z-index: 5; }
.stickies__note--pinned { box-shadow: 0 0 0 2px rgba(91, 91, 107, 0.4), 0 1px 4px rgba(0, 0, 0, 0.12); }
.stickies__note-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    cursor: grab;
    margin-bottom: 2px;
}
.stickies__note-head:active { cursor: grabbing; }
.stickies__head-left { display: flex; align-items: center; gap: 4px; }
.stickies__drag-grip { width: 14px; height: 14px; opacity: 0.4; }
.stickies__pin { font-size: 12px; }
.stickies__menu-btn {
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 0 2px;
    line-height: 1;
}
.stickies__menu {
    position: absolute;
    top: 26px;
    right: 8px;
    z-index: 10;
    background: #fff;
    border: 1px solid #e6e6e6;
    border-radius: 8px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
    padding: 6px;
    min-width: 150px;
}
.stickies__menu-item {
    font-size: 13px;
    color: #3a3a3a;
    padding: 7px 8px;
    border-radius: 6px;
    cursor: pointer;
}
.stickies__menu-item:hover { background: #f5f6fa; }
.stickies__menu-item--danger { color: #e84a4a; }
.stickies__menu-colors {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 6px 8px;
    border-top: 1px solid #f0f0f0;
    border-bottom: 1px solid #f0f0f0;
    margin: 2px 0;
}
.stickies__dot {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    cursor: pointer;
    border: 1px solid rgba(0, 0, 0, 0.12);
    display: inline-block;
    margin-right: 4px;
}
.stickies__dot--active { outline: 2px solid #555; outline-offset: 1px; }
.stickies__title {
    background: transparent;
    border: none;
    outline: none;
    width: 100%;
    font-size: 13px;
    font-weight: 700;
    color: #2b2b2b;
    margin-bottom: 4px;
}
.stickies__text {
    background: transparent;
    border: none;
    resize: vertical;
    outline: none;
    width: 100%;
    font-size: 13px;
    color: #3a3a3a;
    line-height: 1.4;
    min-height: 84px;
}
/* Expanded single-note view */
.stickies__expand-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    z-index: 1100;
    display: flex;
    align-items: center;
    justify-content: center;
}
.stickies__expand-card {
    border-radius: 10px;
    width: min(680px, 92vw);
    height: min(70vh, 640px);
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.28);
}
.stickies__expand-head { margin-bottom: 10px; }
.stickies__expand-title {
    background: transparent;
    border: none;
    outline: none;
    width: 100%;
    font-size: 16px;
    font-weight: 700;
    color: #2b2b2b;
    margin-bottom: 8px;
}
.stickies__expand-text {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    resize: none;
    width: 100%;
    font-size: 15px;
    color: #3a3a3a;
    line-height: 1.5;
}
@media (max-width: 480px) {
    .stickies__grid { grid-template-columns: 1fr; }
}
</style>
