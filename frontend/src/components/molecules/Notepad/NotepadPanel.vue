<template>
    <div v-if="modelValue" class="notepad__overlay" @click.self="close">
        <div class="notepad__panel" @click="openMenuId = null">
            <div class="d-flex align-items-center justify-content-between notepad__head">
                <span class="font-size-16 font-weight-700">{{ $t('Notepad.title') }}</span>
                <div class="d-flex align-items-center">
                    <button class="btn-primary font-size-12 mr-10px notepad__add-btn" :disabled="isBusy" @click="addNote">+ {{ $t('Notepad.add') }}</button>
                    <span class="cursor-pointer font-size-16 notepad__close" @click="close">&#10005;</span>
                </div>
            </div>

            <p class="gray81 font-size-11 notepad__hint">{{ $t('Notepad.hint') }}</p>

            <div v-if="isLoading" class="gray81 font-size-12 notepad__empty">{{ $t('Notepad.loading') }}</div>
            <div v-else-if="!notes.length" class="gray81 font-size-12 notepad__empty">{{ $t('Notepad.empty') }}</div>

            <div v-else class="notepad__list">
                <div
                    v-for="note in notes"
                    :key="note._id"
                    class="notepad__note"
                    :class="{ 'notepad__note--menu-open': openMenuId === note._id }"
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
                        class="notepad__title"
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
    background: rgba(0, 0, 0, 0.35);
    z-index: 1000;
    display: flex;
    justify-content: flex-end;
}
.notepad__panel {
    background: #fff;
    width: min(400px, 92vw);
    height: 100%;
    padding: 16px 18px;
    overflow-y: auto;
    box-shadow: -8px 0 30px rgba(0, 0, 0, 0.18);
}
.notepad__head { margin-bottom: 6px; }
.notepad__add-btn { color: #fff; }
.notepad__close { color: #9a9a9a; }
.notepad__close:hover { color: #e84a4a; }
.notepad__hint { margin: 0 0 14px; }
.notepad__empty { padding: 32px 12px; text-align: center; }
.notepad__list { display: flex; flex-direction: column; gap: 12px; }
.notepad__note {
    position: relative;
    border: 1px solid #ececf0;
    border-radius: 8px;
    padding: 10px;
    background: #fcfcfd;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
    display: flex;
    flex-direction: column;
}
.notepad__note--menu-open { z-index: 5; }
.notepad__note-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 18px;
    margin-bottom: 2px;
}
.notepad__badge {
    font-size: 10px;
    font-weight: 600;
    color: #2e7d32;
    background: #e7f5e8;
    border-radius: 10px;
    padding: 2px 8px;
}
.notepad__menu-btn {
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 0 2px;
    line-height: 1;
}
.notepad__menu {
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
.notepad__menu-item {
    font-size: 13px;
    color: #3a3a3a;
    padding: 7px 8px;
    border-radius: 6px;
    cursor: pointer;
}
.notepad__menu-item:hover { background: #f5f6fa; }
.notepad__menu-item--danger { color: #e84a4a; }
.notepad__title {
    background: transparent;
    border: none;
    outline: none;
    width: 100%;
    font-size: 13px;
    font-weight: 700;
    color: #2b2b2b;
    margin-bottom: 4px;
}
.notepad__text {
    background: transparent;
    border: none;
    resize: vertical;
    outline: none;
    width: 100%;
    font-size: 13px;
    color: #3a3a3a;
    line-height: 1.4;
    min-height: 70px;
}
.notepad__convert-btn {
    align-self: flex-start;
    margin-top: 8px;
    background: #eef0ff;
    color: #1b1b38;
    border: none;
    border-radius: 6px;
    padding: 5px 12px;
    font-size: 12px;
    cursor: pointer;
}
.notepad__convert-btn:hover { background: #e2e5ff; }
</style>
