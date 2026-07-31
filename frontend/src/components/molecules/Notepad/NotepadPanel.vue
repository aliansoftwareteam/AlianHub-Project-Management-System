<!--
    Notepad — anchored popover with a two-level flow, modelled on ClickUp:

      list view   : searchable note rows (title + one-line preview) with hover
                    actions, an overflow menu (show archived / sort) and a
                    "+ New note" footer.
      detail view : the note's own editor, reached by clicking a row, with a
                    back arrow in the header.

    Replaces the previous full-height sidebar.
-->
<template>
    <div v-if="modelValue" class="np__overlay" @click.self="close">
        <div class="np__pop" @click="closeRowMenu">
            <!-- ── Header ─────────────────────────────────────────────── -->
            <div class="np__head">
                <button v-if="openNote" type="button" class="np__hbtn" :title="$t('Notepad.back')" @click.stop="closeNote">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"></path></svg>
                </button>
                <!-- In the detail view the header title IS the note's title field,
                     editable in place — there is no separate title input below. -->
                <input
                    v-if="openNote"
                    ref="titleInput"
                    v-model="openNote.title"
                    class="np__htitleinput"
                    :placeholder="$t('Notepad.title_placeholder')"
                    :maxlength="250"
                    @input="scheduleSave(openNote)"
                    @blur="saveNow(openNote)"
                    @keyup.enter="focusBody"
                />
                <span v-else class="np__htitle">{{ $t('Notepad.title') }}</span>

                <button v-if="!openNote" type="button" class="np__hbtn" :class="{ 'is-on': showSearch }" :title="$t('Notepad.search')" @click.stop="toggleSearch">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path></svg>
                </button>
                <div class="np__hmenuwrap">
                    <button type="button" class="np__hbtn" :title="$t('Notepad.options')" @click.stop="showHeadMenu = !showHeadMenu">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.6"></circle><circle cx="12" cy="12" r="1.6"></circle><circle cx="19" cy="12" r="1.6"></circle></svg>
                    </button>
                    <div v-if="showHeadMenu" class="np__hmenu" @click.stop>
                        <button type="button" class="np__hmitem" @click="toggleArchivedView">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="4" rx="1"></rect><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4"></path></svg>
                            {{ viewArchived ? $t('Notepad.show_active') : $t('Notepad.show_archived') }}
                        </button>
                        <div class="np__hmitem np__hmitem--static">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 15l5 5 5-5M7 9l5-5 5 5"></path></svg>
                            <span class="np__hmlabel">{{ $t('Notepad.sort_recent') }}</span>
                            <button type="button" class="np__switch" :class="{ 'is-on': sortRecent }" :aria-pressed="sortRecent" @click.stop="sortRecent = !sortRecent">
                                <span class="np__knob"></span>
                            </button>
                        </div>
                    </div>
                </div>
                <button type="button" class="np__hbtn" :title="$t('Reminders.close')" @click.stop="close">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"></path></svg>
                </button>
            </div>

            <!-- ── Detail view ────────────────────────────────────────── -->
            <template v-if="openNote">
                <div class="np__editor">
                    <textarea
                        ref="editorArea"
                        v-model="openNote.content"
                        class="np__etext"
                        :placeholder="$t('Notepad.editor_placeholder')"
                        @input="scheduleSave(openNote)"
                        @blur="saveNow(openNote)"
                    ></textarea>
                </div>
                <div class="np__efoot">
                    <span class="np__saved">{{ savingId === openNote._id ? $t('Notepad.saving') : $t('Notepad.saved') }}</span>
                    <button type="button" class="np__eaction" :title="$t('Notepad.convert_action')" @click.stop="startConvert(openNote)">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"></path><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>
                    </button>
                    <button type="button" class="np__eaction" :title="$t('Notepad.archive')" @click.stop="archive(openNote, true)">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="4" rx="1"></rect><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4"></path></svg>
                    </button>
                    <button type="button" class="np__eaction np__eaction--danger" :title="$t('Notepad.delete')" @click.stop="askDelete(openNote)">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"></path></svg>
                    </button>
                </div>
            </template>

            <!-- ── List view ──────────────────────────────────────────── -->
            <template v-else>
                <div v-if="showSearch" class="np__searchbar">
                    <input ref="searchInput" v-model="search" class="np__searchinput" :placeholder="$t('Notepad.search_placeholder')" />
                </div>

                <div v-if="isLoading" class="np__state">{{ $t('Notepad.loading') }}</div>
                <div v-else-if="!visibleNotes.length" class="np__state">
                    {{ search ? $t('Notepad.no_results') : (viewArchived ? $t('Notepad.empty_archived') : $t('Notepad.empty')) }}
                </div>

                <div v-else class="np__list" @scroll="closeRowMenu">
                    <div
                        v-for="note in visibleNotes"
                        :key="note._id"
                        class="np__row"
                        @click="openNoteDetail(note)"
                    >
                        <div class="np__rowmain">
                            <div class="np__rtitle">{{ noteLabel(note) }}</div>
                            <div class="np__rpreview">{{ preview(note) }}</div>
                        </div>

                        <div class="np__rowactions" @click.stop>
                            <button type="button" class="np__ra" :title="$t('Notepad.edit')" @click="openNoteDetail(note)">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"></path></svg>
                            </button>
                            <button type="button" class="np__ra" :title="$t('Notepad.convert_action')" @click="startConvert(note)">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"></path><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>
                            </button>
                            <button type="button" class="np__ra" :title="viewArchived ? $t('Notepad.restore') : $t('Notepad.archive')" @click="archive(note, !viewArchived)">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="4" rx="1"></rect><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4"></path></svg>
                            </button>
                            <button type="button" class="np__ra np__ra--danger" :title="$t('Notepad.delete')" @click="askDelete(note)">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"></path></svg>
                            </button>
                        </div>
                    </div>
                </div>

                <button type="button" class="np__new" :disabled="isBusy" @click.stop="addNote">
                    <span class="np__plus">+</span> {{ $t('Notepad.add') }}
                </button>
            </template>
        </div>

        <!-- ── Delete confirmation ────────────────────────────────────── -->
        <div v-if="pendingDelete" class="np__confirmwrap" @click.self="pendingDelete = null">
            <div class="np__confirm">
                <span class="np__cicon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"></path></svg>
                </span>
                <h3 class="np__ctitle">{{ $t('Notepad.confirm_delete_title') }}</h3>
                <p class="np__cdesc">{{ $t('Notepad.confirm_delete_desc') }}</p>
                <div class="np__cactions">
                    <button type="button" class="np__cbtn" @click="pendingDelete = null">{{ $t('Projects.cancel') }}</button>
                    <button type="button" class="np__cbtn np__cbtn--danger" @click="confirmDelete">{{ $t('Notepad.delete') }}</button>
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
import { computed, inject, nextTick, ref, watch } from "vue";
import { useToast } from "vue-toast-notification";
import { useI18n } from "vue-i18n";

// COMPONENTS
import ConvertNoteToTask from "@/components/molecules/Notepad/ConvertNoteToTask.vue";

// UTILS
import { apiRequest } from "@/services";

const { t } = useI18n();
const $toast = useToast();
const userId = inject("$userId");

const props = defineProps({
    modelValue: { type: Boolean, default: false },
});
const emit = defineEmits(["update:modelValue"]);

const SAVE_DEBOUNCE_MS = 600;

const notes = ref([]);
const isLoading = ref(false);
const isBusy = ref(false);
const convertNote = ref(null);
const openNote = ref(null);
const pendingDelete = ref(null);
const showHeadMenu = ref(false);
const showSearch = ref(false);
const search = ref("");
const viewArchived = ref(false);
const sortRecent = ref(true);
const savingId = ref("");
const searchInput = ref(null);
const editorArea = ref(null);
const titleInput = ref(null);
const saveTimers = {};

// Enter in the header title drops focus into the body, so a new note can be
// typed start-to-finish without reaching for the mouse.
function focusBody() {
    if (editorArea.value) editorArea.value.focus();
}

function close() {
    emit("update:modelValue", false);
}

function closeRowMenu() {
    showHeadMenu.value = false;
}

// A note with no title still needs a label in the list and header — fall back to
// the first line of its content, then to a generic placeholder.
function noteLabel(note) {
    const title = (note && note.title ? String(note.title) : "").trim();
    if (title) return title;
    const first = (note && note.content ? String(note.content) : "").split(/\r?\n/).find((l) => l.trim());
    return (first && first.trim()) || t("Notepad.untitled");
}

// One-line preview for the row: content minus whatever is already the label.
function preview(note) {
    const body = (note && note.content ? String(note.content) : "").replace(/\s+/g, " ").trim();
    if (!body) return t("Notepad.no_content");
    return body.length > 120 ? `${body.slice(0, 120)}…` : body;
}

const visibleNotes = computed(() => {
    const term = search.value.trim().toLowerCase();
    let list = notes.value.slice();
    if (term) {
        list = list.filter((n) => `${n.title || ""} ${n.content || ""}`.toLowerCase().includes(term));
    }
    if (sortRecent.value) {
        list.sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
    } else {
        list.sort((a, b) => noteLabel(a).localeCompare(noteLabel(b)));
    }
    return list;
});

function toggleSearch() {
    showSearch.value = !showSearch.value;
    if (!showSearch.value) {
        search.value = "";
    } else {
        nextTick(() => searchInput.value && searchInput.value.focus());
    }
}

function toggleArchivedView() {
    viewArchived.value = !viewArchived.value;
    showHeadMenu.value = false;
    openNote.value = null;
    fetchNotes();
}

function fetchNotes() {
    isLoading.value = true;
    const qs = viewArchived.value ? "?archived=1" : "";
    apiRequest("get", `/api/v1/notes${qs}`)
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
                const created = response.data.data;
                notes.value.unshift(created);
                // Straight into the editor, as ClickUp does.
                openNoteDetail(created);
            } else {
                $toast.error((response.data && response.data.statusText) || t("Toast.something_went_wrong"), { position: "top-right" });
            }
        })
        .catch((error) => console.error("ERROR in add note: ", error))
        .finally(() => { isBusy.value = false; });
}

function openNoteDetail(note) {
    showHeadMenu.value = false;
    openNote.value = note;
    // A fresh note starts in the header title; an existing one goes straight to
    // the body, which is what you usually want to add to.
    const isNew = !(note && note.title && String(note.title).trim());
    nextTick(() => {
        if (isNew && titleInput.value) titleInput.value.focus();
        else if (editorArea.value) editorArea.value.focus();
    });
}

function closeNote() {
    if (openNote.value) saveNow(openNote.value);
    openNote.value = null;
}

// Debounced per-note save, keyed by id so editing one note never cancels a
// pending save on another.
function scheduleSave(note) {
    savingId.value = note._id;
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
        .then(() => { note.updatedAt = new Date().toISOString(); })
        .catch((error) => console.error("ERROR in save note: ", error))
        .finally(() => { if (savingId.value === note._id) savingId.value = ""; });
}

// Archive / restore, stored on deletedStatusKey by the API (2 = archived).
function archive(note, archived) {
    apiRequest("patch", `/api/v1/notes/${note._id}`, { archived })
        .then((response) => {
            if (response.data && response.data.status) {
                notes.value = notes.value.filter((n) => n._id !== note._id);
                if (openNote.value && openNote.value._id === note._id) openNote.value = null;
                $toast.success(t(archived ? "Notepad.archived_toast" : "Notepad.restored_toast"), { position: "top-right" });
            } else {
                $toast.error(t("Toast.something_went_wrong"), { position: "top-right" });
            }
        })
        .catch((error) => console.error("ERROR in archive note: ", error));
}

function askDelete(note) {
    showHeadMenu.value = false;
    pendingDelete.value = note;
}

function confirmDelete() {
    const note = pendingDelete.value;
    pendingDelete.value = null;
    if (!note) return;
    if (saveTimers[note._id]) {
        clearTimeout(saveTimers[note._id]);
        delete saveTimers[note._id];
    }
    apiRequest("delete", `/api/v1/notes/${note._id}`)
        .then((response) => {
            if (response.data && response.data.status) {
                notes.value = notes.value.filter((n) => n._id !== note._id);
                if (openNote.value && openNote.value._id === note._id) openNote.value = null;
            } else {
                $toast.error((response.data && response.data.statusText) || t("Toast.something_went_wrong"), { position: "top-right" });
            }
        })
        .catch((error) => console.error("ERROR in delete note: ", error));
}

function startConvert(note) {
    showHeadMenu.value = false;
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

watch(() => props.modelValue, (open) => {
    if (open) {
        showHeadMenu.value = false;
        showSearch.value = false;
        search.value = "";
        openNote.value = null;
        pendingDelete.value = null;
        convertNote.value = null;
        viewArchived.value = false;
        fetchNotes();
    }
});
</script>

<style scoped src="./panel.css"></style>
