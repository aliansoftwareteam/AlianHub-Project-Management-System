<template>
    <div :class="[{ 'cursor-pointer': permission === true }]"
        class="position-re project__detail-atttachment mobile__bg--withPadding" @dragenter="handleDragOver"
        @mouseleave="showDropZone = false" @dragleave="handleDragLeave" @dragover="handleDragOver">
        <DragAndDropDivCompo v-if="showDropZone && permission" @handleDrop="(e) => handleDrop(e)"
            :extensions="props.extensions" class="position-ab w-100 h-100 drag_drop-compo"
            :class="{ 'z-index-9': showDropZone === true }" @dragLeave="showDropZone = false" @drop="showDropZone = false">
        </DragAndDropDivCompo>
        <div class="d-flex justify-content-between">
            <h4 class="task-details-subtitle m-0"
                :class="{ 'font-size-16 font-weight-600': clientWidth <= 767, 'font-size-14 font-weight-700': clientWidth > 767 }">
                {{ $t('Attachments.attachments') }}({{ attachments.length }})
                <span class="custom-popover position-re pl-5px" v-if="permission === true && clientWidth > 767">
                    <img src="@/assets/images/help_icon.png" alt="">
                    <span class="popover-content">{{ $t('Attachments.drag_file') }}</span>
                </span>
            </h4>
            <div class="d-flex align-items-center">
                <span v-if="props.isMainSpinner === true || isLoadingAttachments"
                    class="d-block text-right p-1 blue text-decoration-underline font-weight-500 font-size-14 cursor-pointer">
                    <Skelaton style="height: 30px;width: 114px;" class="border-radius-6-px mb-5px" />
                </span>
                <template v-else>
                    <!--
                        BUG-043 / #97 fix: clickable <span> had no
                        role/aria-label/keyboard focus. Replace with a
                        real <button type="button"> so keyboard users can
                        Tab + Enter to trigger Download All.
                    -->
                    <button
                        v-if="visibleAttachments.length > 0"
                        type="button"
                        class="download-all-btn d-block text-right p-1 blue text-decoration-underline font-weight-500 font-size-14 cursor-pointer"
                        @click="downloadAllImages()"
                    >Download All</button>
                </template>
                <button v-if="permission === true && !(props.isMainSpinner === true || isLoadingAttachments)"
                    type="button" class="clip-record-btn cursor-pointer mr-10px"
                    :title="$t('ClipRecorder.record_clip')" @click="$emit('record-clip')">
                    <img src="@/assets/images/svg/clip_record_icon.svg" alt="record clip" />
                </button>
                <!-- The "+" opens a source menu when this workspace has cloud
                     providers set up; with none it stays exactly what it was — a
                     plain label wired straight to the file input. -->
                <div v-if="permission === true" class="attach-add position-re">
                    <div class="cursor-link cursor-pointer" v-if="props.isMainSpinner === true || isLoadingAttachments">
                        <Skelaton style="height: 30px;width: 25px;" class="border-radius-6-px mb-5px" />
                    </div>
                    <label v-else-if="!cloudProviders.length" for="UploadedFile">
                        <img class="cursor-link cursor-pointer" src="@/assets/images/black_plus.png" />
                    </label>
                    <template v-else>
                        <img
                            class="cursor-link cursor-pointer"
                            src="@/assets/images/black_plus.png"
                            :alt="$t('Attachments.attach_from')"
                            @click.stop="toggleSourceMenu"
                        />
                        <div v-if="showSourceMenu" class="attach-sourcemenu" @click.stop>
                            <button type="button" class="attach-sourcemenu__item" @click="pickFromComputer">
                                <img src="@/assets/images/svg/draganddropImg.svg" alt="" />
                                <span>{{ $t('Attachments.upload_from_computer') }}</span>
                            </button>
                            <div class="attach-sourcemenu__sep"></div>
                            <button
                                v-for="p in cloudProviders"
                                :key="p.provider"
                                type="button"
                                class="attach-sourcemenu__item"
                                :disabled="cloudBusy === p.provider"
                                @click="chooseCloudSource(p)"
                            >
                                <img :src="providerIcon(p.provider)" :alt="p.name" />
                                <span>{{ p.name }}</span>
                                <span v-if="!p.connected" class="attach-sourcemenu__hint">{{ $t('Attachments.connect_provider', { provider: '' }).trim() }}</span>
                                <span v-else-if="cloudBusy === p.provider" class="attach-sourcemenu__hint">…</span>
                            </button>
                        </div>
                    </template>
                </div>
                <input type="file" id="UploadedFile" hidden multiple ref="attach_files" :accept="extensions"
                    @change.prevent.stop="uploadFiles" />
            </div>
        </div>
        <div v-if="props.isMainSpinner || isLoadingAttachments">
            <Skelaton style="height: 93px;" class="border-radius-6-px" />
            <div class="pt-1 pb-1">
                <Skelaton style="height: 20px;width: 80px;margin-left:auto" class="border-radius-6-px" />
            </div>
        </div>
        <div v-else>
            <div class="drag-and-drop-attchement" v-if="visibleAttachments.length === 0">
                <img :src="draganddropImg" alt="draganddropImg" />{{ $t('Attachments.drop_file') }}
                <span class="text-decoration-underline blue">{{ $t('Attachments.browse') }}</span>
            </div>
            <div class="slider-main p-0" ref="sliderMain" @click="attchmentDivClick">
                <Attchment v-for="(attachment, index) in visibleAttachments" :key="attachment.id" :data="attachment"
                    :isDelete="permission === true" @delete="$emit('update:delete', attachment)" :isSpinner="isSpinner"
                    @click="(event) => handleAttachmentClick(event, index)" />

                <SpinnerComp is-spinner="isSpinner" v-if="isSpinner && visibleAttachments.length === 0" />
                <div ref="loadMoreTrigger" class="load-more-trigger"></div>
            </div>
            <div class="d-block text-right p-1 blue text-decoration-underline font-weight-500 font-size-14 see__all"
                :class="{ 'pt-40px': visibleAttachments.length === 0 }"
                @click="$emit('seAll', selectedData.ProjectID ? 'task' : 'project')">{{ $t('Attachments.see_all') }}
            </div>

            <ImagesPreviewer v-if="transformedAttachments.length" :showPreviewer="showPreviewer"
                :items="transformedAttachments" :activeIndex="activeIndex" @close="closePreviewer"
                @loadMore="loadMoreAttachments" :config="{ handlesTimer: 2000 }" />
        </div>
    </div>
</template>

<script setup>
import { defineComponent, ref, inject, watch, onMounted, onUnmounted, nextTick } from "vue";
import Attchment from "@/components/atom/Attachments/AttachmentImage.vue";
import SpinnerComp from "@/components/atom/SpinnerComp/SpinnerComp.vue";
import DragAndDropDivCompo from "@/components/atom/DragAndDropDivCompo/DragAndDropDivCompo.vue";
import { useToast } from "vue-toast-notification";
import { useRoute } from "vue-router";
import { useI18n } from "vue-i18n";
import JSZip from "jszip";
import ImagesPreviewer from "@/components/organisms/ImagePreviewer/ImagesPreviewer.vue";
import * as env from "@/config/env";
import { storageHelper } from "@/composable/commonFunction";
import { isCloudAttachment, openCloudAttachment, CLOUD_PROVIDERS } from "@/utils/cloudAttachment";
import { fetchCloudProviders, pickCloudFiles, connectCloudProvider } from "@/composable/cloudPicker";
import Skelaton from "../Skelaton/Skelaton.vue";
const { handleStorageImageRequest } = storageHelper();
const { t } = useI18n();
const route = useRoute();
const companyId = inject("$companyId");
watch(route, (newVal) => {
    if (newVal && newVal.hash) {
        document.querySelector(newVal.hash).scrollIntoView();
    }
})
defineComponent({
    name: "AttachmentsComponent"
});

//IMAGES

const draganddropImg = require("@/assets/images/svg/draganddropImg.svg");
const clientWidth = inject("$clientWidth");

const props = defineProps({
    attachments: {
        type: Array,
        default: () => []
    },
    permission: {
        type: Boolean,
        default: false
    },
    extensions: {
        type: Array,
    },
    isSpinner: {
        type: Boolean
    },
    selectedData: {
        type: Object
    },
    isMainSpinner: {
        type: Boolean,
        default: false
    }
});
const showDropZone = ref(false);
const emit = defineEmits(["update:add", "update:delete", "seAll","updateProjectAttachment","record-clip","update:cloud-add"]);
// eslint-disable-next-line
const extensions = ref("");
extensions.value = props.extensions.map(exe => exe.name).join();
const $toast = useToast();
const attach_files = ref(null);
const showPreviewer = ref(false);
const activeIndex = ref(0);
const visibleAttachments = ref([]);
const itemsPerLoad = ref(15);
const isLoading = ref(false);
const transformedAttachments = ref([]);
const sliderMain = ref(null);
const loadMoreTrigger = ref(null);
const isLoadingAttachments = ref(false);
let observer = null;

// ── cloud sources (AHE-3838) ───────────────────────────────────────────────
// Empty until the workspace configures a provider, and the menu is only rendered
// when it is non-empty — so an instance that never sets one up keeps the original
// single-click "+" behaviour.
const cloudProviders = ref([]);
const showSourceMenu = ref(false);
const cloudBusy = ref('');

const providerIcon = (key) => (CLOUD_PROVIDERS[key] ? CLOUD_PROVIDERS[key].icon : '');

const closeSourceMenu = () => { showSourceMenu.value = false; };

const toggleSourceMenu = () => { showSourceMenu.value = !showSourceMenu.value; };

const pickFromComputer = () => {
    closeSourceMenu();
    const input = document.getElementById('UploadedFile');
    if (input) input.click();
};

const chooseCloudSource = async (provider) => {
    // Not connected yet → send them through consent first. The server round-trips
    // the current path so they land back here.
    if (!provider.connected) {
        closeSourceMenu();
        try {
            await connectCloudProvider(provider.provider);
        } catch (error) {
            $toast.error(error?.message || t('Attachments.cloud_attach_failed'), { position: 'top-right' });
        }
        return;
    }
    cloudBusy.value = provider.provider;
    try {
        const files = await pickCloudFiles({ provider: provider.provider, multiple: true });
        closeSourceMenu();
        if (!files || !files.length) return;   // cancelled
        emit('update:cloud-add', { provider: provider.provider, files });
    } catch (error) {
        closeSourceMenu();
        if (error?.code === 'not_connected' || error?.code === 'reauth_required') {
            // The grant is gone (revoked, password change). Re-consent rather
            // than showing an error the user can do nothing with.
            try { await connectCloudProvider(provider.provider); return; } catch (_e) { /* fall through */ }
        }
        $toast.error(error?.message || t('Attachments.cloud_attach_failed'), { position: 'top-right' });
    } finally {
        cloudBusy.value = '';
    }
};

const loadCloudProviders = async () => {
    const list = await fetchCloudProviders();
    // Only providers the workspace actually set up are offered.
    cloudProviders.value = (list || []).filter((p) => p.configured);
};

// Close the menu on any outside click, matching the other popovers in the app.
const onDocumentClick = () => { if (showSourceMenu.value) closeSourceMenu(); };

// COLLAB-04 / global clips: the "Record clip" button no longer mounts a local
// recorder. It emits `record-clip` to the task container (which owns taskClass),
// which opens the GLOBAL recorder and attaches the resulting clip to the task.

const setupIntersectionObserver = (val) => {
    nextTick(() => {
        const options = {
            root: sliderMain.value,
            rootMargin: "0px",
            threshold: 0.1
        };

        observer = new IntersectionObserver((entries) => {
            if (entries[0]?.isIntersecting && !isLoading.value) {
                const currentLength = visibleAttachments.value.length;
                if (currentLength < props.attachments.length) {
                    loadMoreAttachments(val);
                }
            }
        }, options);

        if (observer && loadMoreTrigger.value) {
            observer.observe(loadMoreTrigger.value);
        }
    });
};

onMounted(() => {
    if (props.isMainSpinner === false) {
        setupIntersectionObserver(true);
    }
    if (props.permission === true) loadCloudProviders();
    document.addEventListener('click', onDocumentClick);
});

watch(() => props.isMainSpinner, (newVal) => {
    if (newVal === false) {
        setupIntersectionObserver(true);
    }
})

watch(() => props.attachments.length, (newVal,oldValue) => {
    if(newVal !== oldValue){
        loadMoreAttachments(false);
    }
})
onUnmounted(() => {
    if (observer) {
        observer.disconnect();
    }
    document.removeEventListener('click', onDocumentClick);
});


const loadMoreAttachments = async (val) => {
    if (isLoading.value) return;
    
    const currentLength = visibleAttachments.value.length;
    if (currentLength  > props.attachments.length) {
        
        const currentIds = new Set(props.attachments.map(att => att.id));
        
        visibleAttachments.value = visibleAttachments.value.filter(
            att => currentIds.has(att.id)
        );
        
        transformedAttachments.value = transformedAttachments.value.filter(
            att => currentIds.has(att.id)
        );
        
        // Close previewer if deleted item was being viewed
        if (showPreviewer.value && activeIndex.value >= transformedAttachments.value.length) {
            closePreviewer();
        }
        
        return; // Exit after sync
    }
    
    if (currentLength >= props.attachments.length) return;

    isLoading.value = true;
    if(val){
        isLoadingAttachments.value = true;
    }

    try {
        const nextBatch = props.attachments.slice(
            currentLength,
            currentLength + itemsPerLoad.value
        );

        const transformedBatch = await fetchAttachmentUrls(nextBatch);

        visibleAttachments.value = [...visibleAttachments.value, ...nextBatch];
        transformedAttachments.value = [...transformedAttachments.value, ...transformedBatch];
    } catch (error) {
        console.error("Error fetching or transforming attachments:", error);
    } finally {
        isLoading.value = false;
        if(val){
            isLoadingAttachments.value = false;
        }
    }
};

const uploadFiles = (event) => {
    const files = event.target.files;

    let arr = [];
    let isErrorInUpload = false;
    props.extensions.forEach((v) =>
        arr.push(v.name.replaceAll(" ", "_").toLowerCase())
    );

    files.forEach((file) => {
        if (file == null) {
            isErrorInUpload = true;
            $toast.error(t("Toast.Please_select_valid_file"), {
                position: "top-right",
            });
            return;
        }
        let fileName = file.name;
        var ele = fileName.substring(fileName.lastIndexOf(".") + 1);

        const isExists = arr.includes("." + ele.toLowerCase());
        if (!isExists) {
            isErrorInUpload = true;
            if (props.extensions.length > 1) {
                $toast.error(t("Toast.require_image_format_message"), {
                    position: "top-right",
                });
            } else {
                $toast.error(t("Toast.You_have_to_add_extension_in_setting"), {
                    position: "top-right",
                });
            }
            return;
        }
    });

    if (!isErrorInUpload) {
        emit("update:add", files);
    }
    attach_files.value.value = null;
}
const handleDrop = (e) => {
    emit("update:add", e);
}

const attchmentDivClick = (clickEvent) => {
    if (clickEvent.target.nodeName === 'DIV' && props.permission === true) {
        let fileInput = document.getElementById('UploadedFile')
        fileInput.click();
    }
}
const handleDragLeave = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.target.getBoundingClientRect();
    const isLeavingContainer = (
        event.clientX < rect.left ||
        event.clientX >= rect.right ||
        event.clientY < rect.top ||
        event.clientY >= rect.bottom
    );
    if (isLeavingContainer) {
        showDropZone.value = false;
    }
}
const handleDragOver = (event) => {
    showDropZone.value = true;
    event.preventDefault();
    event.stopPropagation();
};

const handleAttachmentClick = (event, index) => {
    // A cloud-linked file has no bytes on our side, so there is nothing for the
    // previewer to show — hand off to the provider instead.
    const attachment = visibleAttachments.value[index];
    if (isCloudAttachment(attachment)) {
        if (!openCloudAttachment(attachment)) {
            $toast.error(t('Attachments.cloud_link_missing'), { position: 'top-right' });
        }
        return;
    }
    // `transformedAttachments` (the previewer's list) skips cloud links, so the
    // tile index is not the previewer index once one is present. Count the
    // previewable tiles ahead of this one instead of assuming they line up —
    // otherwise the previewer opens on the wrong file.
    const previewIndex = visibleAttachments.value
        .slice(0, index)
        .filter((item) => !isCloudAttachment(item))
        .length;
    openPreviewer(previewIndex);
};

const openPreviewer = (index) => {
    activeIndex.value = index;
    showPreviewer.value = true;
};

const closePreviewer = () => {
    showPreviewer.value = false;
};

async function downloadAllImages() {
    // Cloud-linked files can't go in the zip — we hold a link, not the bytes.
    // Say so rather than quietly shipping a zip that's missing files.
    const all = props.selectedData?.attachments ?? [];
    const downloadable = all.filter((attachment) => !isCloudAttachment(attachment));
    const skipped = all.length - downloadable.length;
    if (skipped > 0) {
        $toast.info(t('Attachments.cloud_skipped_in_zip', { count: skipped }), { position: 'top-right' });
    }
    if (!downloadable.length) return;

    if (!env?.STORAGE_TYPE || env.STORAGE_TYPE !== 'server') {
        const attachments = downloadable;
        const zip = new JSZip();

        const filenameMap = new Map();
        const imagePromises = attachments.map(async (attachment) => {
            try {
                const res = await handleStorageImageRequest({
                    companyId: companyId.value,
                    data: {
                        url: attachment.url,
                    },
                });

                if (res) {
                    const blob = await fetchImageAsBlob(res.url);
                    if (blob) {
                        let originalName = attachment.filename;
                        let name = originalName;
                        let count = filenameMap.get(originalName) || 0;

                        if (count > 0) {
                            const extIndex = originalName.lastIndexOf('.');
                            if (extIndex !== -1) {
                                name = `${originalName.slice(0, extIndex)} (${count})${originalName.slice(extIndex)}`;
                            } else {
                                name = `${originalName} (${count})`;
                            }
                        }

                        filenameMap.set(originalName, count + 1);
                        zip.file(name, blob);
                    }
                }
            } catch (error) {
                console.error('Error fetching or updating the file URL:', error);
            }
        });

        await Promise.allSettled(imagePromises);

        zip.generateAsync({ type: "blob" }).then((zipBlob) => {
            const zipName = props.selectedData.ProjectID
                ? props.selectedData.TaskName
                : props.selectedData.ProjectName;

            saveAs(zipBlob, `${zipName}_attachments.zip`);
        });
    } else {
        const attachments = downloadable;
        const zip = new JSZip();

        const filenameMap = new Map();
        const imagePromises = attachments.map(async (attachment) => {
            try {
                const res = await handleStorageImageRequest({
                    data: {
                        url: attachment.url,
                    },
                    companyId: companyId.value,
                    tuhumbnailSize: null
                });

                if (res?.downloadUrl) {
                    const blob = await fetchImageAsBlob(res.downloadUrl);
                    if (blob) {
                        let originalName = attachment.filename;
                        let name = originalName;
                        let count = filenameMap.get(originalName) || 0;

                        if (count > 0) {
                            const extIndex = originalName.lastIndexOf('.');
                            if (extIndex !== -1) {
                                name = `${originalName.slice(0, extIndex)} (${count})${originalName.slice(extIndex)}`;
                            } else {
                                name = `${originalName} (${count})`;
                            }
                        }
                        filenameMap.set(originalName, count + 1);
                        zip.file(name, blob);
                    }
                }
            } catch (error) {
                console.error('Error handling server-stored attachment:', error);
            }
        });

        await Promise.allSettled(imagePromises);

        zip.generateAsync({ type: "blob" }).then((zipBlob) => {
            const zipName = props.selectedData.ProjectID
                ? props.selectedData.TaskName
                : props.selectedData.ProjectName;
            saveAs(zipBlob, `${zipName}_attachments.zip`);
        });
    }
}

async function fetchImageAsBlob(url) {
    try {
        const response = await fetch(url);
        return await response.blob();
    } catch (error) {
        console.error(`Failed to fetch image: ${url}`, error);
        return null;
    }
}
function saveAs(blob, filename) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
}

async function fetchAttachmentUrls(attachments) {
    // Cloud-linked files are dropped here rather than presigned: there is no
    // Wasabi object behind them, so handleStorageImageRequest would fail, and
    // the previewer can't render a third-party link anyway. handleAttachmentClick
    // maps tile index → previewer index to account for the gap.
    return await Promise.all(
        attachments.filter((attachment) => !isCloudAttachment(attachment)).map(async (attachment) => {
            const baseName = attachment.filename.replace(/\.[^/.]+$/, "");
            let properUrl = attachment.url;

            try {
                const newUrl = await handleStorageImageRequest({
                    companyId: companyId.value,
                    data: { url: attachment.url },
                    isCache: true,
                });

                if (newUrl) properUrl = newUrl.url;


            } catch (err) {
                console.error(`Error fetching URL for ${attachment.filename}:`, err);
            }

            return {
                id: attachment.id,
                title: baseName,
                name: attachment.filename,
                alt: `${baseName} file`,
                type: attachment.type,
                ext: attachment.extension,
                url: properUrl,
                path: attachment.url || "",
            };
        })
    );
}

watch(
    () => props.selectedData,
    async (newId, oldId) => {
        if (newId._id && newId._id !== oldId._id) {
            emit("updateProjectAttachment", true);
            visibleAttachments.value = [];
            transformedAttachments.value = [];
            if (props.attachments.length) {
                await loadMoreAttachments(true);
                await nextTick(); // Wait for DOM to update after data loads
            }
            
            emit("updateProjectAttachment", false);
        }
    }
);


</script>
<style scoped src="./style.css"></style>
<style>
.slider-main::-webkit-scrollbar {
    display: none;
}

.slider-main {
    display: -webkit-box;
    position: relative;
    width: 100%;
    z-index: 5;
    height: 93px;
    margin-top: 20px;
    gap: 10px;
    overflow: auto;
    scrollbar-width: none;
}

.drag_drop-compo {
    top: 33px;
}

.custom-popover {
    top: 2px;
}

@media(max-width: 767px) {
    .slider-main {
        height: 70px;
        overflow-y: hidden;
    }

    .see__all {
        padding-right: 0 !important;
    }
}

.load-more-trigger {
    width: 1px;
    height: 1px;
    visibility: hidden;
    position: relative;
    margin-left: 10px;
}

/*
 * BUG-043 / #97 — the Download All control was a <span> with a click
 * handler; replaced with a <button>. Strip native button chrome so the
 * visual result matches the old <span>, but keep focus-visible for
 * keyboard accessibility.
 */
.download-all-btn {
    background: none;
    border: 0;
    font: inherit;
    color: inherit;
}
.download-all-btn:focus-visible {
    outline: 2px solid #2f3990;
    outline-offset: 2px;
    border-radius: 2px;
}

/*
 * COLLAB-04 — "Record clip" trigger. Strip native button chrome so it sits
 * inline next to the upload (+) control as a plain icon.
 */
.clip-record-btn {
    background: none;
    border: 0;
    padding: 0;
    display: inline-flex;
    align-items: center;
}
.clip-record-btn img {
    width: 18px;
    height: 18px;
    display: block;
}
.clip-record-btn:focus-visible {
    outline: 2px solid #2f3990;
    outline-offset: 2px;
    border-radius: 2px;
}
</style>