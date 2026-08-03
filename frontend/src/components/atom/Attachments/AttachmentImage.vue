<template>
    <div  @click="handleClick" class="attachment-display" :title="props.data.filename" :style="[{width : clientWidth>767 ? '131px' : '169px'}]" :id="data.id">
        <ul class="d-flex position-ab hover_icon-slider z-index-1">
            <!-- A linked cloud file has no bytes here to download — the provider
                 owns them. Opening the tile goes to the provider instead. -->
            <li v-if="!cloudProvider">
                <a @click.stop.prevent="downloadAttachment(data)">
                    <img
                        src="@/assets/images/download_attchment.png"
                        alt=""
                    />
                </a>
            </li>
            <li v-if="isDelete">
                <a @click.stop.prevent="$emit('delete')">
                    <img
                        src="@/assets/images/delete_attechment.png"
                        alt=""
                    />
                </a>
            </li>
        </ul>

        <!-- Cloud-linked: provider thumbnail when it gave us one, else the
             provider's own file icon, else the generic extension tile. -->
        <ImageIcon
            v-if="cloudProvider"
            :src="props.data.thumbnailUrl || props.data.externalIcon || ''"
            :alt="props.data.filename"
            :extension="props.data.extension"
            class="w-100"
            :style="[{height : clientWidth>767 ? '100px' : '120px',objectFit : 'contain'}]"
        />
        <ImageIcon
            v-else-if="hasHttpUrl"
            :src="props.data.url"
            :alt="props.data.filename"
            :extension="props.data.extension"
            class="w-100"
            :style="[{height : clientWidth>767 ? '100px' : '120px',objectFit : 'contain'}]"
        />
        <WasabiIamgeCompp
            v-else
            :data="data"
            class="attachment__image-height w-100"
            :style="[{height : clientWidth>767 ? '100px' : '120px'}]"
            :thumbnail="showThumbnails ? '130x93' : ''"
            @downloadUrl="(eve) => {downloadurl(eve)}"
        />

        <span
            v-if="cloudProvider"
            class="attachment-cloudbadge"
            :title="`${props.data.filename} — opens in ${cloudProvider.label}`"
        >
            <img :src="cloudProvider.icon" :alt="cloudProvider.label" />
            <span class="attachment-cloudbadge__label">{{ cloudProvider.short }}</span>
        </span>
    </div>
    <SpinnerComp :is-spinner="isSpinner" v-if="isSpinner"/>
</template>

<script setup>
import WasabiIamgeCompp from "@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue"
import { defineComponent, defineProps, defineEmits, ref, computed, inject, onMounted} from "vue";
import { download } from "@/utils/StorageOprations/download";
import SpinnerComp from '@/components/atom/SpinnerComp/SpinnerComp.vue';
import ImageIcon from "@/components/atom/ImageIcon/ImageIcon.vue"
import '@/components/atom/Attachments/styleAttachment.css';
import { storageHelper } from "@/composable/commonFunction";
import { cloudProviderOf } from "@/utils/cloudAttachment";


const {handleStorageImageRequest} = storageHelper();
const companyId = inject("$companyId");
// import Pdf from 'vue-pdf';
defineComponent({
    name: "AttchmentSingleComponent"
});

const emit = defineEmits(["delete", "click"]);

const props = defineProps({
    data: {
        type: Object,
        default: () => {}
    },
    isDelete: {
        type: Boolean,
        default: false
    },
    isSpinner: {
        type: Boolean
    }
});
const clientWidth = inject("$clientWidth");
const itemData = ref(props.data);
const showThumbnails =ref(false)
const downloadValue = ref('');

// null for every ordinary upload, so the existing render path is unchanged.
const cloudProvider = computed(() => cloudProviderOf(props.data));
// `url` is absent on cloud-linked records; the old `props.data.url.includes()`
// threw on undefined, so read it defensively.
const hasHttpUrl = computed(() => String(props.data?.url || '').includes('http'));

onMounted(() => {
    const fixedDate = new Date(2024,6,9).getTime();
    const today = new Date().setHours(0,0,0,0);
    showThumbnails.value = props.data.type === 'image' ? today >= fixedDate : false;
})

const downloadAttachment = () => {
    handleStorageImageRequest({
        companyId: companyId.value,
        data: {
            url: props.data.url
        }
    })
    .then((res) => {
        download(res.url, props.data.filename).catch((error) => {
            console.error('Error while downloading file.', error);
        });
    })
    .catch((error) => {
        console.error("ERR: ", error);
    })
}

function downloadurl (e) {
    itemData.value.downloadUrl = e;
    downloadValue.value = e;
}
const handleClick = (event) => {
    event.stopPropagation();
    emit("click", props.data);
};
</script>
<style scoped>
.attachment-display {
    /* background-color: #e1dbdb; */
    margin-right: 10px;
    padding: 5px;
    border-radius: 6px;
    position: relative;
}
.attachment-display ul li {
    list-style: none;
    position: relative;
}
.attachment-display ul li img {
    background-color: #F4F5F7;
    height: 22px;
    border-radius: 2px;
    object-fit: contain;
    cursor: pointer;
}
.hover_icon-slider{
    gap: 5px;
    padding: 0;
    width: auto;
    right: 5px;
    top: 5px;
}
img.attachment__image-height {
    object-fit: contain;
}
/* Provider badge on a cloud-linked tile — bottom-left so it never collides with
   the download/delete actions that appear top-right on hover. */
.attachment-cloudbadge {
    position: absolute;
    left: 8px;
    bottom: 6px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    max-width: calc(100% - 16px);
    padding: 2px 6px;
    background: rgba(255, 255, 255, 0.94);
    border: 1px solid #E6E7EF;
    border-radius: 999px;
    box-shadow: 0 1px 3px rgba(23, 24, 36, 0.12);
    pointer-events: none;
}
.attachment-cloudbadge img {
    width: 12px;
    height: 12px;
    flex: none;
}
.attachment-cloudbadge__label {
    font-size: 9.5px;
    font-weight: 600;
    line-height: 1.4;
    color: #4A4B63;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
@media(max-width: 767px){
    /* The mobile tile is 66px wide — only the icon fits. */
    .attachment-cloudbadge {
        left: 3px;
        bottom: 3px;
        padding: 2px;
    }
    .attachment-cloudbadge__label {
        display: none;
    }
}
@media(max-width: 767px){
    .attachment-display{  margin-right: 10px;padding: 0;width: 66px!important; 
        height: -webkit-fill-available;
    }
    img.attachment__image-height {
    object-fit: cover !important;
    border-radius: 8px;
}
}

</style>