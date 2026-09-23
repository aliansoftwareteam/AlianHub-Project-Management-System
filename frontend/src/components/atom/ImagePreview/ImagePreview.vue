<template>
    <div class="preview_wrapper" style="overflow-y: auto;">

        <img     
            v-if="!errorLoadImage && image.type === 'image'"
            :src="previewData.url"
            class="bg-img"
            @error="errorLoad"
            @load="loadingFile = false"
        >

        <!-- HEADER -->
        <div class="preview_header" :style="`${image.type === 'image' || image.ext === 'pdf' ? '' : 'grid-template-columns: 1fr auto;'}`" v-if="!loadingFile" :class="{'hide_handles': hideHandles}">
            <!-- NAME -->
            <div class="preview_image_name">
                <span :title="image.name">{{ image.name }}</span>
            </div>

            <!-- ZOOM -->
            <div class="preview_image_zoom" v-if="image.type === 'image' && clientWidth > 420">
                <button class="zoomBtn" tabindex="-1" @click="handleZoom('decr', true)"
                    :disabled="errorLoadImage || loadingFile">-</button>
                <span>{{Math.round(zoom * 100)}}%</span>
                <button class="zoomBtn" tabindex="-1" @click="handleZoom('incr', true)"
                    :disabled="errorLoadImage || loadingFile">+</button>
            </div>

            <div class="preview_image_zoom" v-if="showPdfControls && clientWidth > 420">
                <span class="page-info">{{ pdfCurrentPage }} / {{ pdfTotalPages }}</span>
                <div class="divider"></div>
                <button class="zoomBtn" tabindex="-1" 
                        @click="pdfViewerRef?.zoomOut?.()" 
                        :disabled="!canZoomOut">−</button>
                <span>{{ Math.round(pdfScale * 100) }}%</span>
                <button class="zoomBtn" tabindex="-1" 
                        @click="pdfViewerRef?.zoomIn?.()" 
                        :disabled="!canZoomIn">+</button>
            </div>


            <!-- RIGHT BUTTON -->
            <div class="top-buttons">
                <template v-if="clientWidth >= 768">
                    <button class="close button-style" @click="openFile(image)">
                        <img src="@/assets/images/png/open.png" alt="open" :title="$t('Attachments.open_in_new_tab')" width="16px">
                    </button>
                    <button class="close button-style"
                        @click="downloadFile(image?.path, `${image?.name}`)">
                        <img src="@/assets/images/svg/download_bottom_wrapper.svg" class="download_icon" alt="download" :title="$t('Attachments.download')" width="16px">
                    </button>
                    <button class="close button-style" @click="$emit('close')">
                        <img src="@/assets/images/svg/delete.svg" />
                    </button>
                </template>
                <template v-else>
                    <DropDown :zIndex="999">
                        <template #button>
                            <button class="close button-style">
                                <img :ref="`my_dd_options`" src="@/assets/images/svg/verticalDropdownthreedots.svg" alt="options" :title="$t('Attachments.actions')" width="10px" class="verticalDots">
                            </button>
                        </template>
                        <template #options>
                            <DropDownOption @click="$refs[`my_dd_options`].click(), openFile(image)">
                                
                                <button class="close button-style mr-10px">
                                    <img src="@/assets/images/png/open.png" alt="open" :title="$t('Attachments.open_in_new_tab')" width="16px">
                                </button>
                                {{ $t('Attachments.open_in_new_tab') }}
                            </DropDownOption>
                            <DropDownOption
                                @click="$refs[`my_dd_options`].click(), downloadFile(image?.path, `${image?.name}`)"
                                style="margin-bottom:0px !important;">
                                <button class="close button-style mr-10px">
                                    <img src="@/assets/images/svg/download_bottom_wrapper.svg" class="download_icon" alt="download" :title="$t('Attachments.download')" width="16px">
                                </button>
                                {{ $t('Attachments.download') }}
                            </DropDownOption>
                        </template>
                    </DropDown>
                    <button class="close button-style" @click="$emit('close')">
                        <img src="@/assets/images/svg/delete.svg" />
                    </button>
                </template>
            </div>
        </div>

        <template v-if="!loadingFile && clientWidth <= 420">
            <div class="preview_image_zoom" v-if="image.type === 'image'">
                <button class="zoomBtn" tabindex="-1" @click="handleZoom('decr', true)"
                    :disabled="errorLoadImage || loadingFile">-</button>
                <span>{{Math.round(zoom * 100)}}%</span>
                <button class="zoomBtn" tabindex="-1" @click="handleZoom('incr', true)"
                    :disabled="errorLoadImage || loadingFile">+</button>
            </div>

            <div class="preview_image_zoom" v-if="showPdfControls">
                <span class="page-info">{{ pdfCurrentPage }} / {{ pdfTotalPages }}</span>
                <div class="divider"></div>
                <button class="zoomBtn" tabindex="-1" 
                        @click="pdfViewerRef?.zoomOut?.()" 
                        :disabled="!canZoomOut">−</button>
                <span>{{ Math.round(pdfScale * 100) }}%</span>
                <button class="zoomBtn" tabindex="-1" 
                        @click="pdfViewerRef?.zoomIn?.()" 
                        :disabled="!canZoomIn">+</button>
            </div>
        </template>

        <div class="preview_container" @dblclick="image.type === 'image' ? resetPosition() : null"
            @mousewheel="!errorLoadImage ? handleZoom($event) : null" v-show="!loadingFile"
            @mouseup="image.type === 'image' ? handleMouseUp($event, '.preview_container .preview') : null"
            @mousedown="image.type === 'image' ? handleMouseDown($event, '.preview_container .preview') : null"
            @mousemove="image.type === 'image' ? handleMouseMove($event, '.preview_container .preview') : null"
            @touchstart="image.type === 'image' ? handleTouchStart($event, '.preview_container .preview') : null"
            @touchmove="image.type === 'image' ? handleTouchMove($event, '.preview_container .preview') : null"
            @touchend="image.type === 'image' ? handleTouchEnd($event, '.preview_container .preview') : null"
            @dragstart.prevent>
            <WasabiIamgeCompp
                v-if="!errorLoadImage && image.type === 'image'"
                :data="{ url: image.bgUrl ?? image.url }"
                class="bg-img"
                @error="errorLoad"
                @load="loadingFile = false"
            />
            <!-- PREVIEW IMAGE -->
            <template v-if="!errorLoadImage">
                <!-- IMAGE -->
                 <div v-if="previewData.type === 'image'" class="preview_image">
            
                     <img
                         ref="imageRef"
                         :src="previewData.url"
                         @load="loadingFile = false, resetPosition()"
                         :alt="previewData.alt"
                         :title="previewData.filename"
                         class="preview"
                         @error="errorLoad"
                     >
     
                 </div>





                <!-- VIDEO -->
                <video v-else-if="previewData.type === 'video'" ref="videoRef" :title="previewData.title"
                    class="preview" controls @loadeddata="loadingFile = false">
                    <source :src="previewData.url" :alt="previewData.alt" @error="errorLoad">
                    {{ $t('Attachments.video_not_supported') }}
                </video>

                <!-- Audio -->
                <audio v-else-if="previewData.type === 'audio'" ref="audioRef" :title="previewData.title"
                    class="preview" controls @loadeddata="loadingFile = false">
                    <source :src="previewData.url" :alt="previewData.alt" @error="errorLoad">
                </audio>

                <template v-else-if="previewData.type === 'pdf' || previewData.ext?.includes('pdf') && previewData.url">
                    <PdfViewer
                        ref="pdfViewerRef"
                        :source="previewData"
                        @error="errorLoad"
                        @loadedData="loadingFile = false"
                    />
                </template>
                
 


                <TextPreviewer v-else-if="['js', 'json', 'txt']?.includes(previewData.ext)" class="preview"
                    :url="previewData.url" @load="loadingFile = false" @error="errorLoad" />

                <HtmlPreviewer v-else-if="previewData.ext === 'html'" class="preview" :url="previewData.url"
                    :key="previewData.id" @load="loadingFile = false" @error="errorLoad" />

                <DocsPreviewer v-else-if="['doc', 'docx' ,'xls', 'xlsx' ,'ppt', 'pptx']?.includes(previewData.ext)" class="preview"
                    :url="previewData.url" @load="loadingFile = false" @error="errorLoad" />
                
                <!-- OTHER FILES -->
                <img v-else :src="previewData.url" :alt="previewData.alt" @load="loadingFile = false"
                    :title="previewData.title" class="preview" @error="errorLoad">
            </template>

            <!-- ON PREVIEW ERROR -->
            <template v-else>
                <div v-if="!defaultFailImage" class="no_preview_available">
                    <span>{{ $t('Attachments.no_preview_available') }}</span>
                </div>
                <img v-else :src="defaultFailImage" :alt="previewData.alt" :title="previewData.title" class="preview"
                    @error="errorLoad">
            </template>
        </div>

        <!-- LOADING -->
        <div class="loading" v-if="loadingFile">
            <MacLoader />
        </div>
    </div>
</template>

<script setup>
import { dragHelper } from "@/components/organisms/ImagePreviewer/hepler";
import {defineProps, defineEmits, inject, ref, watch, computed} from "vue";
import DropDown from '@/components/molecules/DropDown/DropDown.vue';
import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue';

import TextPreviewer from "@/components/molecules/TextPreviewer/TextPreviewer.vue";
import HtmlPreviewer from "@/components/molecules/HtmlPreviewer/HtmlPreviewer.vue";
import MacLoader from "../MacLoader/MacLoader.vue";
import { download } from "@/utils/StorageOprations/download";
import { storageHelper } from "@/composable/commonFunction";
import PdfViewer from "../Attachments/PdfViewer.vue";
import DocsPreviewer from "@/components/molecules/DocsPreviewer/DocsPreviewer.vue";
import * as env from '@/config/env';
const pdfViewerRef = ref(null);
const showPdfControls = computed(() => {
    return (previewData.value.type === 'pdf' || previewData.value.ext?.includes('pdf')) 
           && pdfViewerRef.value 
           && !pdfViewerRef.value.isLoading;
});

const pdfCurrentPage = computed(() => pdfViewerRef.value?.currentPage || 1);
const pdfTotalPages = computed(() => pdfViewerRef.value?.totalPages || 1);
const pdfScale = computed(() => pdfViewerRef.value?.scale || 1);
const canZoomOut = computed(() => pdfViewerRef.value && pdfViewerRef.value.scale > 0.5);
const canZoomIn = computed(() => pdfViewerRef.value && pdfViewerRef.value.scale < 3);

const {handleStorageImageRequest} = storageHelper();
defineEmits(["close"]);
const companyId = inject("$companyId");
const clientWidth = inject("$clientWidth");
const props = defineProps({
    image: {
        type: Object,
        required: true
    },
    downloadFun: {
        type: Function,
        required: false
    }
})

const {handleMouseUp, handleMouseDown, handleMouseMove, handleTouchEnd, handleTouchStart, handleTouchMove,setScale,resetOffsets} = dragHelper();

const defaultFailImage = inject("defaultFailImage")
const hideHandles = inject("hideHandles")
const errorLoadImage = ref(false);
const previewData = ref(props.image);

const defaultScale = computed(() => clientWidth?.value >= 768 ? 0.6 : 1);
const zoom = ref(defaultScale.value);
const loadingFile = ref(true);
const imageRef = ref(null);
const videoRef = ref(null);
const audioRef = ref(null);

watch(() => props.image, async (val) => {
    previewData.value = {};
    loadingFile.value = true;
    errorLoadImage.value = false;

    if (!val.type) {
        errorLoadImage.value = true;
        loadingFile.value = false;
        return;
    }

    previewData.value = JSON.parse(JSON.stringify(props.image));

    errorLoadImage.value = false;
}, { immediate: true });

function handleZoom(e, manual = false) {
    if(previewData.value.type === "image") {
        let element;
        if(!manual) {
            element = e.target.classList.contains("preview") ? e.target : e.target.querySelector("img.preview");
        } else {
            element = document.querySelector(".preview_container img.preview");
        }
        const tmpZoom = Number(element.style.scale) || defaultScale.value;

        const scaleJump = 0.05;
        
        element.style.scale = ((!manual && e.deltaY > 0) || (manual && e === "decr")) ? (tmpZoom > scaleJump ? tmpZoom - scaleJump : scaleJump) : (tmpZoom < 5 ? tmpZoom + scaleJump : 5);

        zoom.value = element.style.scale;
        setScale(zoom.value);
    }
}

function resetPosition() {
    if (previewData.value.type === "image") {
        const element = document.querySelector(".preview_container img.preview");
        element.style.position = "relative";
        element.style.transform = "translate(0px, 0px)";
        element.style.scale = defaultScale.value;
        
        setScale(defaultScale.value);
        resetOffsets();

        zoom.value = defaultScale.value;
    }
}


async function openFile(file) {
  try {
    window.open(file.url, "_blank");
  } catch (error) {
    console.error("Failed to open file:", error.message);
  }
}

async function downloadFile(url, name) {
  try {
    let downloadUrl;

    if (!env?.STORAGE_TYPE || env.STORAGE_TYPE !== 'server') {
      const res = await handleStorageImageRequest({
        companyId: companyId.value,
        data: { url: url },
      });

      if (res) {
        downloadUrl = res.url;
      } else {
        console.error('getStorageImage returned an invalid response:', res);
        return;
      }
    } else {
      const res = await handleStorageImageRequest({
        data: {
           url: url,
        },
        companyId: companyId.value,
        tuhumbnailSize: null,
      });

      if (res?.downloadUrl) {
        downloadUrl = res.downloadUrl;
      } else {
        console.error('getStorageImageServerStorage returned an invalid response:', res);
        return;
      }
    }

    await download(downloadUrl, name);
  } catch (error) {
    console.error('Download failed:', error.message);
  }
}

function errorLoad() {
    errorLoadImage.value = true;
    loadingFile.value = false;
}

</script>

<style lang="css" scoped>
@import url("./style.css");
</style>