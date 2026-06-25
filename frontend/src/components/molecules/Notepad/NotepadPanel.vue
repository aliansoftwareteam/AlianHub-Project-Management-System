<template>
    <div v-if="modelValue" class="notepad__overlay" @click.self="close">
        <div class="notepad__panel" @click="openMenuId = null">
            <div class="notepad__head">
                <span class="notepad__title">{{ $t('Notepad.title') }}</span>
                <div class="notepad__head-actions">
                    <button class="notepad__add" :disabled="isBusy" @click="addNote">+ {{ $t('Notepad.add') }}</button>
                    <button class="notepad__close" @click="close" aria-label="Close">&#10005;</button>
                </div>
            </div>

            <p class="notepad__hint">{{ $t('Notepad.hint') }}</p>

            <div v-if="isLoading" class="notepad__state">{{ $t('Notepad.loading') }}</div>
            <div v-else-if="!notes.length" class="notepad__state notepad__state--empty">{{ $t('Notepad.empty') }}</div>

            <div v-else class="notepad__list">
                <div
                    v-for="note in notes"
                    :key="note._id"
                    class="notepad__note"
                    :class="{ 'notepad__note--menu-open': openMenuId === note._id, 'notepad__note--converted': note.convertedTaskId }"
                >
                    <div class="notepad__note-head">
                        <span v-if="note.convertedTaskId" class="notepad__badge" :title="$t('Notepad.converted_badge')">&#10003; {{ $t('Notepad.converted_badge') }}</span>
                        <span v-else></span>
                        <button class="notepad__menu-btn" :title="$t('Notepad.options')" @click.stop="toggleMenu(note)">
                            <img :src="horizontalDots" alt="options" class="vertical-middle">
                        </button>
                    </div>

                    <div v-if="openMenuId === note._id" class="notepad__menu" @click.stop>
                        <div class="notepad__menu-item" @click="startConvert(note)">{{ $t('Notepad.convert_action') }}</div>
                        <div class="notepad__menu-item notepad__menu-item--danger" @click="remove(note)">{{ $t('Notepad.delete') }}</div>
                    </div>

                    <input
                        v-model="note.title"
                        class="notepad__note-title"
                        :placeholder="$t('Notepad.title_placeholder')"
                        :maxlength="250"
                        @input="scheduleSave(note)"
                        @blur="saveNow(note)"
                    />
                    <textarea
                        v-model="note.content"
                        class="notepad__text"
                        :placeholder="$t('Notepad.placeholder')"
                        rows="4"
                        @input="scheduleSave(note)"
                        @blur="saveNow(note)"
                    ></textarea>

                    <button class="notepad__convert-btn" @click.stop="startConvert(note)">{{ $t('Notepad.convert_action') }}</button>
                </div>
            </div>
        </div>

        <ConvertNoteToTask
            v-if="convertNote"
            :note="convertNote"
            @close="convertNote = null"
            @converted="onConverted"
        />
    </div>
</template>

<script setup>
// PACKAGES
import { defineProps, defineEmits, inject, ref, watch } from "vue";
import { useToast } from "vue-toast-notification";
import { useI18n } from "vue-i18n";

// COMPONENTS
import ConvertNoteToTask from "@/components/molecules/Notepad/ConvertNoteToTask.vue";

// IMAGE
import horizontalDots from "@/assets/images/svg/horizontalDots.svg";

// UTILS
import { apiRequest } from "@/services";

const { t } = useI18n();
const $toast = useToast();
const userId = inject("$userId");

const props = defineProps({
    modelValue: {
        type: Boolean,
        default: false,
    },
});

const emit = defineEmits(["update:modelValue"]);

const SAVE_DEBOUNCE_MS = 600;

const notes = ref([]);
const isLoading = ref(false);
const isBusy = ref(false);
const openMenuId = ref(null);
const convertNote = ref(null);
const saveTimers = {};

function close() {
    emit("update:modelValue", false);
}

watch(() => props.modelValue, (open) => {
    if (open) {
        openMenuId.value = null;
        convertNote.value = null;
        fetchNotes();
    }
});

function toggleMenu(note) {
    openMenuId.value = openMenuId.value === note._id ? null : note._id;
}

function fetchNotes() {
    isLoading.value = true;
    apiRequest("get", "/api/v1/notes")
        .then((response) => {
            notes.value = response.data && response.data.status ? (response.data.data || []) : [];
        })
        .catch((error) => console.error("ERROR in fetch notes: ", error))
        .finally(() => { isLoading.value = false; });
}

function addNote() {
    if (isBusy.value) return;
    isBusy.value = true;
    apiRequest("post", "/api/v1/notes", { title: "", content: "", userData: { id: userId.value } })
        .then((response) => {
            if (response.data && response.data.status) {
                notes.value.unshift(response.data.data);
            } else {
                $toast.error((response.data && response.data.statusText) || t("Toast.something_went_wrong"), { position: "top-right" });
            }
        })
        .catch((error) => console.error("ERROR in add note: ", error))
        .finally(() => { isBusy.value = false; });
}

// Debounced per-note save, keyed by id so editing one note never cancels a
// pending save on another (same approach as StickiesPanel).
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
    apiRequest("patch", `/api/v1/notes/${note._id}`, { title: note.title, content: note.content })
        .catch((error) => console.error("ERROR in save note: ", error));
}

function startConvert(note) {
    openMenuId.value = null;
    saveNow(note);
    convertNote.value = note;
}

// After a successful convert, stamp convertedTaskId on the note (server) and
// reflect it locally. The note is kept (not deleted) so the user retains it.
function onConverted({ taskId }) {
    const note = convertNote.value;
    convertNote.value = null;
    if (!note || !taskId) return;
    note.convertedTaskId = String(taskId);
    apiRequest("patch", `/api/v1/notes/${note._id}`, { convertedTaskId: String(taskId) })
        .catch((error) => console.error("ERROR in stamp converted note: ", error));
}

function remove(note) {
    openMenuId.value = null;
    if (saveTimers[note._id]) {
        clearTimeout(saveTimers[note._id]);
        delete saveTimers[note._id];
    }
    apiRequest("delete", `/api/v1/notes/${note._id}`)
        .then((response) => {
            if (response.data && response.data.status) {
                notes.value = notes.value.filter((n) => n._id !== note._id);
            } else {
                $toast.error((response.data && response.data.statusText) || t("Toast.something_went_wrong"), { position: "top-right" });
            }
        })
        .catch((error) => console.error("ERROR in delete note: ", error));
}
</script>

<style scoped>
.notepad__overlay {
    position: fixed;
    inset: 0;
    background: rgba(17, 24, 39, 0.38);
    backdrop-filter: blur(2px);
    z-index: 1000;
    display: flex;
    justify-content: flex-end;
    font-family: 'Roboto', sans-serif;
}
.notepad__panel {
    background: #f6f8fc;
    width: min(420px, 94vw);
    height: 100%;
    padding: 20px 18px 26px;
    overflow-y: auto;
    border-radius: 18px 0 0 18px;
    box-shadow: -16px 0 48px rgba(20, 30, 60, 0.20);
    animation: notepad-slide-in 0.22s ease;
}
@keyframes notepad-slide-in {
    from { transform: translateX(26px); opacity: 0.5; }
    to { transform: translateX(0); opacity: 1; }
}
/* Header */
.notepad__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
}
.notepad__title {
    font-size: 18px;
    font-weight: 700;
    color: #1b2233;
    letter-spacing: -0.2px;
}
.notepad__head-actions { display: flex; align-items: center; gap: 8px; }
.notepad__add {
    border: none;
    cursor: pointer;
    color: #fff;
    background: linear-gradient(120deg, #4d7cff, #6a5cff);
    border-radius: 9px;
    padding: 7px 14px;
    font-size: 12.5px;
    font-weight: 600;
    box-shadow: 0 4px 12px rgba(77, 124, 255, 0.34);
    transition: transform 0.12s ease, box-shadow 0.12s ease, opacity 0.12s ease;
}
.notepad__add:hover { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(77, 124, 255, 0.42); }
.notepad__add:active { transform: translateY(0); }
.notepad__add:disabled { opacity: 0.55; cursor: default; box-shadow: none; transform: none; }
.notepad__close {
    border: none;
    background: transparent;
    color: #9aa1b2;
    font-size: 15px;
    cursor: pointer;
    width: 30px;
    height: 30px;
    border-radius: 8px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: background 0.12s ease, color 0.12s ease;
}
.notepad__close:hover { background: #fdeaea; color: #e84a4a; }
.notepad__hint { margin: 4px 0 16px; color: #8b91a0; font-size: 11.5px; line-height: 1.5; }
/* States */
.notepad__state {
    color: #9aa1b2;
    font-size: 12.5px;
    text-align: center;
    padding: 40px 16px;
}
.notepad__state--empty {
    border: 1px dashed #d7dbe6;
    border-radius: 14px;
    background: #fff;
}
/* List + cards */
.notepad__list { display: flex; flex-direction: column; gap: 14px; }
.notepad__note {
    position: relative;
    border: 1px solid #ebedf3;
    border-radius: 14px;
    padding: 12px 14px 14px;
    background: #fff;
    box-shadow: 0 1px 2px rgba(20, 30, 60, 0.05);
    display: flex;
    flex-direction: column;
    transition: box-shadow 0.16s ease, transform 0.16s ease, border-color 0.16s ease;
}
.notepad__note::before {
    content: "";
    position: absolute;
    left: 0;
    top: 14px;
    bottom: 14px;
    width: 3px;
    border-radius: 3px;
    background: linear-gradient(#4d7cff, #6a5cff);
    opacity: 0.85;
}
.notepad__note:hover {
    box-shadow: 0 8px 22px rgba(20, 30, 60, 0.10);
    transform: translateY(-1px);
    border-color: #dfe3ee;
}
.notepad__note--menu-open { z-index: 5; }
.notepad__note--converted::before { background: linear-gradient(#2e7d32, #43a047); }
.notepad__note-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 20px;
    margin-bottom: 4px;
}
.notepad__badge {
    font-size: 10px;
    font-weight: 700;
    color: #1e7a35;
    background: #e7f7ec;
    border: 1px solid #c7ebcf;
    border-radius: 20px;
    padding: 2px 9px;
    letter-spacing: 0.2px;
}
.notepad__menu-btn {
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 2px;
    line-height: 1;
    width: 26px;
    height: 24px;
    border-radius: 7px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: background 0.12s ease;
}
.notepad__menu-btn:hover { background: #f0f2f7; }
.notepad__menu {
    position: absolute;
    top: 30px;
    right: 10px;
    z-index: 10;
    background: #fff;
    border: 1px solid #ececf0;
    border-radius: 10px;
    box-shadow: 0 10px 28px rgba(20, 30, 60, 0.18);
    padding: 6px;
    min-width: 158px;
}
.notepad__menu-item {
    font-size: 13px;
    color: #3a3f4d;
    padding: 8px 10px;
    border-radius: 7px;
    cursor: pointer;
    transition: background 0.1s ease;
}
.notepad__menu-item:hover { background: #f4f6fb; }
.notepad__menu-item--danger { color: #e84a4a; }
.notepad__menu-item--danger:hover { background: #fdeaea; }
.notepad__note-title {
    background: transparent;
    border: none;
    outline: none;
    width: 100%;
    font-size: 14px;
    font-weight: 700;
    color: #20263a;
    padding: 2px 0;
    margin-bottom: 2px;
}
.notepad__note-title::placeholder { color: #b6bccb; font-weight: 600; }
.notepad__text {
    background: transparent;
    border: none;
    resize: vertical;
    outline: none;
    width: 100%;
    font-size: 13px;
    color: #515869;
    line-height: 1.5;
    min-height: 64px;
    padding: 2px 0;
}
.notepad__text::placeholder { color: #b6bccb; }
.notepad__convert-btn {
    align-self: flex-start;
    margin-top: 10px;
    background: #eef2ff;
    color: #3856d6;
    border: none;
    border-radius: 8px;
    padding: 6px 14px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.12s ease, color 0.12s ease;
}
.notepad__convert-btn:hover { background: #e0e7ff; color: #2b44b8; }
.notepad__panel::-webkit-scrollbar { width: 7px; }
.notepad__panel::-webkit-scrollbar-thumb { background: #d3d8e4; border-radius: 7px; }
.notepad__panel::-webkit-scrollbar-track { background: transparent; }
</style>
