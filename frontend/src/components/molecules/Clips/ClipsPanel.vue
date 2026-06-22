<template>
    <div v-if="modelValue" class="clips__overlay" @click.self="close">
        <div class="clips__panel" @click="openMenuId = null">
            <div class="d-flex align-items-center justify-content-between clips__head">
                <span class="font-size-16 font-weight-700">{{ $t('Clips.my_clips') }}</span>
                <div class="d-flex align-items-center">
                    <button class="btn-primary font-size-12 mr-10px clips__add-btn" @click="recordNew">+ {{ $t('Clips.record_new') }}</button>
                    <span class="cursor-pointer font-size-16 clips__close" @click="close">&#10005;</span>
                </div>
            </div>

            <div v-if="isLoading" class="gray81 font-size-12 clips__empty">{{ $t('Clips.loading') }}</div>
            <div v-else-if="!clips.length" class="gray81 font-size-12 clips__empty">{{ $t('Clips.empty') }}</div>

            <div v-else class="clips__list">
                <div
                    v-for="clip in clips"
                    :key="clip._id"
                    class="clips__item"
                    :class="{ 'clips__item--menu-open': openMenuId === clip._id }"
                >
                    <div class="clips__item-head">
                        <span class="clips__badge" :class="clip.mediaType === 'video' ? 'clips__badge--video' : 'clips__badge--audio'">
                            {{ clip.mediaType === 'video' ? $t('Clips.video_badge') : $t('Clips.audio_badge') }}
                        </span>
                        <button class="clips__menu-btn" :title="$t('Clips.options')" @click.stop="toggleMenu(clip)">
                            <img :src="horizontalDots" alt="options" class="vertical-middle">
                        </button>
                    </div>

                    <div v-if="openMenuId === clip._id" class="clips__menu" @click.stop>
                        <div class="clips__menu-item" @click="startRename(clip)">{{ $t('Clips.rename') }}</div>
                        <div class="clips__menu-item" @click="copyLink(clip)">{{ $t('Clips.copy_link') }}</div>
                        <div class="clips__menu-item clips__menu-item--danger" @click="remove(clip)">{{ $t('Clips.delete') }}</div>
                    </div>

                    <!-- Rename input (inline) -->
                    <input
                        v-if="renameId === clip._id"
                        v-model="renameValue"
                        class="clips__rename-input font-size-13"
                        :placeholder="$t('Clips.rename_placeholder')"
                        :maxlength="120"
                        @keyup.enter="commitRename(clip)"
                        @blur="commitRename(clip)"
                    />
                    <span v-else class="clips__title font-size-13 font-weight-600" :title="clip.title">{{ clip.title }}</span>

                    <span class="clips__date gray81 font-size-11">{{ formatDate(clip.createdAt) }}</span>

                    <!-- Player: lazily resolves the stored url to a playable url on first open -->
                    <div class="clips__player">
                        <template v-if="playUrls[clip._id]">
                            <video v-if="clip.mediaType === 'video'" :src="playUrls[clip._id]" class="clips__media" controls></video>
                            <audio v-else :src="playUrls[clip._id]" class="clips__media clips__media--audio" controls></audio>
                        </template>
                        <button v-else type="button" class="clips__play-btn font-size-12" :disabled="resolvingId === clip._id" @click="resolvePlay(clip)">
                            <span class="clips__play-tri">&#9658;</span> {{ resolvingId === clip._id ? $t('Clips.loading') : $t('Clips.play') }}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
// PACKAGES
import { defineProps, defineEmits, inject, ref, watch } from "vue";
import { useToast } from "vue-toast-notification";
import { useI18n } from "vue-i18n";

// IMAGE
import horizontalDots from "@/assets/images/svg/horizontalDots.svg";

// UTILS
import { listClips, renameClip, deleteClip } from "@/services/clips";
import { useClipRecorder } from "@/composables/useClipRecorder";
import { storageHelper } from "@/composable/commonFunction";

const { t } = useI18n();
const $toast = useToast();
const companyId = inject("$companyId");
const { handleStorageImageRequest } = storageHelper();
const { openRecorder } = useClipRecorder();

const props = defineProps({
    modelValue: {
        type: Boolean,
        default: false,
    },
});

const emit = defineEmits(["update:modelValue"]);

const clips = ref([]);
const isLoading = ref(false);
const openMenuId = ref(null);
const renameId = ref(null);
const renameValue = ref("");
const resolvingId = ref(null);
// Map of clipId -> resolved playable url (signed / public). Lazily filled.
const playUrls = ref({});

function close() {
    emit("update:modelValue", false);
}

watch(() => props.modelValue, (open) => {
    if (open) {
        openMenuId.value = null;
        renameId.value = null;
        playUrls.value = {};
        fetchClips();
    }
});

function fetchClips() {
    isLoading.value = true;
    listClips()
        .then((response) => {
            clips.value = response.data && response.data.status ? (response.data.data || []) : [];
        })
        .catch((error) => console.error("ERROR in fetch clips: ", error))
        .finally(() => { isLoading.value = false; });
}

function toggleMenu(clip) {
    openMenuId.value = openMenuId.value === clip._id ? null : clip._id;
}

function formatDate(value) {
    if (!value) return "";
    const d = new Date(value);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleString();
}

// Resolve the stored relative url to an actually-playable url (signed/public),
// using the same storage-helper the attachment list uses for previews.
function resolvePlay(clip) {
    if (playUrls.value[clip._id] || resolvingId.value) return;
    resolvingId.value = clip._id;
    handleStorageImageRequest({
        companyId: companyId.value,
        data: { url: clip.url },
    })
        .then((res) => {
            const resolved = res && (res.url || res.downloadUrl);
            playUrls.value = { ...playUrls.value, [clip._id]: resolved || clip.url };
        })
        .catch((error) => {
            console.error("ERROR resolving clip url: ", error);
            // Fall back to the raw stored url so the user can still attempt playback.
            playUrls.value = { ...playUrls.value, [clip._id]: clip.url };
        })
        .finally(() => { resolvingId.value = null; });
}

function startRename(clip) {
    openMenuId.value = null;
    renameId.value = clip._id;
    renameValue.value = clip.title || "";
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

function copyLink(clip) {
    openMenuId.value = null;
    const text = clip.url || "";
    const done = () => $toast.success(t("Clips.copied"), { position: "top-right" });
    const fail = () => $toast.error(t("Clips.copy_failed"), { position: "top-right" });
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

function remove(clip) {
    openMenuId.value = null;
    const ok = typeof window !== "undefined" && typeof window.confirm === "function"
        ? window.confirm(t("Clips.delete_confirm"))
        : true;
    if (!ok) return;
    deleteClip(clip._id)
        .then((response) => {
            if (response.data && response.data.status) {
                clips.value = clips.value.filter((c) => c._id !== clip._id);
                $toast.success(t("Clips.deleted"), { position: "top-right" });
            } else {
                $toast.error(t("Clips.delete_failed"), { position: "top-right" });
            }
        })
        .catch((error) => {
            console.error("ERROR in delete clip: ", error);
            $toast.error(t("Clips.delete_failed"), { position: "top-right" });
        });
}

// Open the global recorder (library-only). When the user saves, refetch so the
// new clip shows up. The recorder itself is mounted at the app shell.
function recordNew() {
    openRecorder(null, () => {
        fetchClips();
    });
}
</script>

<style scoped>
.clips__overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.35);
    z-index: 1000;
    display: flex;
    justify-content: flex-end;
}
.clips__panel {
    background: #fff;
    width: min(400px, 92vw);
    height: 100%;
    padding: 16px 18px;
    overflow-y: auto;
    box-shadow: -8px 0 30px rgba(0, 0, 0, 0.18);
}
.clips__head { margin-bottom: 14px; }
.clips__add-btn { color: #fff; }
.clips__close { color: #9a9a9a; }
.clips__close:hover { color: #e84a4a; }
.clips__empty { padding: 32px 12px; text-align: center; }
.clips__list { display: flex; flex-direction: column; gap: 12px; }
.clips__item {
    position: relative;
    border: 1px solid #ececf0;
    border-radius: 8px;
    padding: 10px;
    background: #fcfcfd;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
    display: flex;
    flex-direction: column;
}
.clips__item--menu-open { z-index: 5; }
.clips__item-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 18px;
    margin-bottom: 4px;
}
.clips__badge {
    font-size: 10px;
    font-weight: 600;
    border-radius: 10px;
    padding: 2px 8px;
}
.clips__badge--video { color: #2f3990; background: #eef0ff; }
.clips__badge--audio { color: #2e7d32; background: #e7f5e8; }
.clips__menu-btn {
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 0 2px;
    line-height: 1;
}
.clips__menu {
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
.clips__menu-item {
    font-size: 13px;
    color: #3a3a3a;
    padding: 7px 8px;
    border-radius: 6px;
    cursor: pointer;
}
.clips__menu-item:hover { background: #f5f6fa; }
.clips__menu-item--danger { color: #e84a4a; }
.clips__title {
    color: #2b2b2b;
    word-break: break-word;
}
.clips__rename-input {
    width: 100%;
    border: 1px solid #2f3990;
    border-radius: 6px;
    padding: 5px 8px;
    outline: none;
    color: #2b2b2b;
}
.clips__date { margin-top: 2px; }
.clips__player { margin-top: 8px; }
.clips__media {
    width: 100%;
    max-height: 220px;
    border-radius: 6px;
    background: #000;
}
.clips__media--audio {
    max-height: none;
    background: transparent;
}
.clips__play-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: #eef0ff;
    color: #1b1b38;
    border: none;
    border-radius: 6px;
    padding: 6px 12px;
    cursor: pointer;
}
.clips__play-btn:hover { background: #e2e5ff; }
.clips__play-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.clips__play-tri { font-size: 10px; }
</style>
