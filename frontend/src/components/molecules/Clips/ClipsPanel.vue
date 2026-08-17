<!--
    My Clips — anchored popover, styled to match the Notepad popover.

      list   : one row per clip (type badge, title, date), with hover actions for
               play / convert to task / rename / copy link / delete.
      player : the selected clip expands inline; its media url is resolved lazily
               on first play (the stored value is a storage key, not a url).

    Replaces the previous full-height sidebar.
-->
<template>
    <div v-if="modelValue" class="cl__overlay" @click.self="close">
        <div class="cl__pop" @click="openMenuId = null">
            <!-- ── Header ─────────────────────────────────────────────── -->
            <div class="cl__head">
                <span class="cl__htitle">{{ $t('Clips.my_clips') }}</span>
                <div class="cl__hmenuwrap">
                    <button type="button" class="cl__hbtn" :class="{ 'is-on': showSearch }" :title="$t('Clips.search')" @click.stop="toggleSearch">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path></svg>
                    </button>
                </div>
                <button type="button" class="cl__hbtn" :title="$t('Reminders.close')" @click.stop="close">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"></path></svg>
                </button>
            </div>

            <div v-if="showSearch" class="cl__searchbar">
                <input ref="searchInput" v-model="search" class="cl__searchinput" :placeholder="$t('Clips.search_placeholder')" />
            </div>

            <div v-if="isLoading" class="cl__state">{{ $t('Clips.loading') }}</div>
            <div v-else-if="!visibleClips.length" class="cl__state">
                {{ search ? $t('Clips.no_results') : $t('Clips.empty') }}
            </div>

            <div v-else class="cl__list" @scroll="openMenuId = null">
                <div v-for="clip in visibleClips" :key="clip._id" class="cl__row">
                    <span class="cl__type" :class="clip.mediaType === 'video' ? 'is-video' : 'is-audio'">
                        <svg v-if="clip.mediaType === 'video'" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 8-6 4 6 4V8Z"></path><rect x="2" y="6" width="14" height="12" rx="2"></rect></svg>
                        <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" x2="12" y1="19" y2="22"></line></svg>
                    </span>

                    <div class="cl__main" @click="togglePlay(clip)">
                        <input
                            v-if="renameId === clip._id"
                            ref="renameInput"
                            v-model="renameValue"
                            class="cl__renameinput"
                            :maxlength="120"
                            :placeholder="$t('Clips.rename_placeholder')"
                            @click.stop
                            @keyup.enter="commitRename(clip)"
                            @blur="commitRename(clip)"
                        />
                        <div v-else class="cl__title" :title="clip.title">{{ clip.title || $t('Clips.untitled') }}</div>
                        <div class="cl__meta">
                            <span>{{ formatDate(clip.createdAt) }}</span>
                            <span v-if="clip.durationSec">· {{ formatDuration(clip.durationSec) }}</span>
                            <span v-if="clip.convertedTaskId" class="cl__converted">{{ $t('Clips.converted_badge') }}</span>
                        </div>
                    </div>

                    <div class="cl__actions" @click.stop>
                        <button type="button" class="cl__a" :title="playingId === clip._id ? $t('Clips.hide') : $t('Clips.play')" @click="togglePlay(clip)">
                            <svg v-if="playingId !== clip._id" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"></path></svg>
                            <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 15l-6-6-6 6"></path></svg>
                        </button>
                        <button type="button" class="cl__a" :title="$t('Clips.convert_action')" @click="startConvert(clip)">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"></path><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>
                        </button>
                        <div class="cl__menuwrap">
                            <button type="button" class="cl__a" :title="$t('Clips.options')" @click="toggleMenu(clip, $event)">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.6"></circle><circle cx="12" cy="12" r="1.6"></circle><circle cx="19" cy="12" r="1.6"></circle></svg>
                            </button>
                        </div>
                    </div>

                    <!-- Inline player -->
                    <div v-if="playingId === clip._id" class="cl__player" @click.stop>
                        <template v-if="playUrls[clip._id]">
                            <video v-if="clip.mediaType === 'video'" :src="playUrls[clip._id]" class="cl__media" controls autoplay></video>
                            <audio v-else :src="playUrls[clip._id]" class="cl__media cl__media--audio" controls autoplay></audio>
                        </template>
                        <div v-else class="cl__resolving">{{ $t('Clips.loading') }}</div>
                    </div>
                </div>
            </div>

            <button type="button" class="cl__new" @click.stop="recordNew">
                <span class="cl__rec"></span> {{ $t('Clips.record_new') }}
            </button>
        </div>

        <!-- Row overflow menu — fixed so the scrolling list cannot clip it. -->
        <div v-if="openMenuId" class="cl__menu" :style="menuStyle" @click.stop>
            <button type="button" class="cl__mitem" @click="startRename(menuClip)">{{ $t('Clips.rename') }}</button>
            <button type="button" class="cl__mitem" @click="copyLink(menuClip)">{{ $t('Clips.copy_link') }}</button>
            <button type="button" class="cl__mitem cl__mitem--danger" @click="askDelete(menuClip)">{{ $t('Clips.delete') }}</button>
        </div>

        <!-- Delete confirmation -->
        <div v-if="pendingDelete" class="cl__confirmwrap" @click.self="pendingDelete = null">
            <div class="cl__confirm">
                <span class="cl__cicon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"></path></svg>
                </span>
                <h3 class="cl__ctitle">{{ $t('Clips.confirm_delete_title') }}</h3>
                <p class="cl__cdesc">{{ $t('Notepad.confirm_delete_desc') }}</p>
                <div class="cl__cactions">
                    <button type="button" class="cl__cbtn" @click="pendingDelete = null">{{ $t('Projects.cancel') }}</button>
                    <button type="button" class="cl__cbtn cl__cbtn--danger" @click="confirmDelete">{{ $t('Clips.delete') }}</button>
                </div>
            </div>
        </div>

        <!-- Reuses the notepad's convert dialog: it only reads title/content, so a
             clip can drive it, with the recording passed through as an attachment. -->
        <ConvertNoteToTask
            v-if="convertClip"
            :note="{ title: convertClip.title, content: '' }"
            :dialogTitle="$t('Clips.convert_title')"
            :attachment="clipAttachment(convertClip)"
            @close="convertClip = null"
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
import { listClips, renameClip, deleteClip } from "@/services/clips";
import { useClipRecorder } from "@/composables/useClipRecorder";
import { storageHelper } from "@/composable/commonFunction";
import { useCustomComposable } from "@/composable";

const { t } = useI18n();
const $toast = useToast();
const companyId = inject("$companyId");
const userId = inject("$userId");
const { handleStorageImageRequest } = storageHelper();
const { openRecorder } = useClipRecorder();
const { makeUniqueId } = useCustomComposable();

const props = defineProps({
    modelValue: { type: Boolean, default: false },
});
const emit = defineEmits(["update:modelValue"]);

const clips = ref([]);
const isLoading = ref(false);
const openMenuId = ref(null);
const menuClip = ref(null);
const menuStyle = ref({});
const renameId = ref(null);
const renameValue = ref("");
const renameInput = ref(null);
const playingId = ref(null);
const playUrls = ref({});
const pendingDelete = ref(null);
const convertClip = ref(null);
const showSearch = ref(false);
const search = ref("");
const searchInput = ref(null);

function close() {
    emit("update:modelValue", false);
}

const visibleClips = computed(() => {
    const term = search.value.trim().toLowerCase();
    if (!term) return clips.value;
    return clips.value.filter((c) => String(c.title || "").toLowerCase().includes(term));
});

function toggleSearch() {
    showSearch.value = !showSearch.value;
    if (!showSearch.value) search.value = "";
    else nextTick(() => searchInput.value && searchInput.value.focus());
}

function fetchClips() {
    isLoading.value = true;
    listClips()
        .then((response) => {
            clips.value = response.data && response.data.status ? (response.data.data || []) : [];
        })
        .catch((error) => console.error("ERROR in fetch clips: ", error))
        .finally(() => { isLoading.value = false; });
}

function recordNew() {
    openMenuId.value = null;
    openRecorder();
}

// The row menu is position:fixed, so its coordinates come from the trigger and it
// flips upward when there is not enough room below.
const MENU_H = 132;
const MENU_W = 156;
function toggleMenu(clip, event) {
    if (openMenuId.value === clip._id) {
        openMenuId.value = null;
        return;
    }
    const rect = event && event.currentTarget && event.currentTarget.getBoundingClientRect();
    if (rect) {
        const flipUp = rect.bottom + MENU_H > window.innerHeight;
        menuStyle.value = {
            top: flipUp ? `${Math.max(8, rect.top - MENU_H)}px` : `${rect.bottom + 4}px`,
            left: `${Math.max(8, rect.right - MENU_W)}px`,
        };
    }
    menuClip.value = clip;
    openMenuId.value = clip._id;
}

function formatDate(value) {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

function formatDuration(sec) {
    const total = Math.max(0, Math.round(Number(sec) || 0));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
}

// Expand/collapse the inline player. The stored value is a storage key, so the
// playable url is resolved on first open and then cached.
function togglePlay(clip) {
    openMenuId.value = null;
    if (playingId.value === clip._id) {
        playingId.value = null;
        return;
    }
    playingId.value = clip._id;
    if (playUrls.value[clip._id]) return;
    resolveUrl(clip)
        .then((url) => { playUrls.value = { ...playUrls.value, [clip._id]: url }; })
        .catch(() => { playUrls.value = { ...playUrls.value, [clip._id]: clip.url }; });
}

function resolveUrl(clip) {
    return handleStorageImageRequest({ companyId: companyId.value, data: { url: clip.url } })
        .then((res) => (res && (res.url || res.downloadUrl)) || clip.url);
}

function startRename(clip) {
    openMenuId.value = null;
    if (!clip) return;
    renameId.value = clip._id;
    renameValue.value = clip.title || "";
    nextTick(() => {
        const el = Array.isArray(renameInput.value) ? renameInput.value[0] : renameInput.value;
        if (el) el.focus();
    });
}

function commitRename(clip) {
    if (renameId.value !== clip._id) return;
    const next = (renameValue.value || "").trim();
    renameId.value = null;
    if (!next || next === clip.title) return;
    const previous = clip.title;
    clip.title = next; // optimistic
    renameClip(clip._id, next)
        .then((response) => {
            if (!(response.data && response.data.status)) {
                clip.title = previous;
                $toast.error(t("Clips.rename_failed"), { position: "top-right" });
            }
        })
        .catch((error) => {
            clip.title = previous;
            console.error("ERROR in rename clip: ", error);
            $toast.error(t("Clips.rename_failed"), { position: "top-right" });
        });
}

async function copyLink(clip) {
    openMenuId.value = null;
    if (!clip) return;
    const done = () => $toast.success(t("Clips.copied"), { position: "top-right" });
    const fail = () => $toast.error(t("Clips.copy_failed"), { position: "top-right" });
    let text = playUrls.value[clip._id] || "";
    if (!text) {
        try {
            text = await resolveUrl(clip);
        } catch (error) {
            console.error("ERROR resolving clip link: ", error);
            text = clip.url || "";
        }
    }
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        navigator.clipboard.writeText(text).then(done).catch(fail);
        return;
    }
    // Fallback for non-secure contexts where the async clipboard API is absent.
    try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        done();
    } catch (error) {
        console.error("ERROR copying clip link: ", error);
        fail();
    }
}

function askDelete(clip) {
    openMenuId.value = null;
    pendingDelete.value = clip;
}

function confirmDelete() {
    const clip = pendingDelete.value;
    pendingDelete.value = null;
    if (!clip) return;
    deleteClip(clip._id)
        .then((response) => {
            if (response.data && response.data.status) {
                clips.value = clips.value.filter((c) => c._id !== clip._id);
                if (playingId.value === clip._id) playingId.value = null;
            } else {
                $toast.error(t("Toast.something_went_wrong"), { position: "top-right" });
            }
        })
        .catch((error) => console.error("ERROR in delete clip: ", error));
}

// --- convert to task ----------------------------------------------------
function startConvert(clip) {
    openMenuId.value = null;
    convertClip.value = clip;
}

// Task-attachment record for the clip. The media is already in storage, so the
// task just points at the same key — nothing is re-uploaded. Shape matches the
// entries TaskDetailTab writes.
function clipAttachment(clip) {
    if (!clip || !clip.url) return null;
    const ext = String(clip.url).includes(".") ? String(clip.url).split(".").pop() : "webm";
    return {
        filename: `${clip.title || "clip"}.${ext}`,
        extension: ext,
        size: Number(clip.size) || 0,
        id: makeUniqueId(17),
        createdAt: new Date(),
        userId: userId?.value || userId,
        type: clip.mediaType === "video" ? "video" : "audio",
        url: clip.url,
    };
}

function onConverted({ taskId }) {
    const clip = convertClip.value;
    convertClip.value = null;
    if (!clip || !taskId) return;
    clip.convertedTaskId = String(taskId);
    apiRequest("patch", `/api/v1/clips/${clip._id}`, { convertedTaskId: String(taskId) })
        .catch((error) => console.error("ERROR in stamp converted clip: ", error));
}

watch(() => props.modelValue, (open) => {
    if (open) {
        openMenuId.value = null;
        renameId.value = null;
        playingId.value = null;
        pendingDelete.value = null;
        convertClip.value = null;
        showSearch.value = false;
        search.value = "";
        playUrls.value = {};
        fetchClips();
    }
});
</script>

<style scoped src="./panel.css"></style>
