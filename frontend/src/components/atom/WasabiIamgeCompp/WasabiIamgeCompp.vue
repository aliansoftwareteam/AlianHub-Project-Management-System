<template>
    <ImageIcon :src="imgUrl" :title="data.title" :alt="altText" :extension="data.extension" v-if="!loading && imgUrl!== ''" :style="style" :class="props.class" :userImage="userImage" :imageErrorOccured="imageLoadError"/>
    <SkelatonVue v-else :style="style" :class="props.class"/>
</template>

<script setup>
    import { computed, onMounted, defineProps, inject, ref, defineEmits, watch } from 'vue';
    import ImageIcon from "@/components/atom/ImageIcon/ImageIcon.vue"
    import * as env from '@/config/env';
    import isEqual from "lodash/isEqual"
    import SkelatonVue from '../Skelaton/Skelaton.vue';
    import { apiRequest, apiRequestWithoutCompnay } from '../../../services';
    import {storageQueryBuilder} from '@/utils/storageQueryBuild.js';
    const defaultUserAvatar = inject("$defaultUserAvatar")
    const defaultImage = require("@/assets/images/image_name.png")
    // eslint-disable-next-line
    const companyId = inject('$companyId');  
    const props = defineProps({
        data: {
            type: Object,
            required: true,
        },
        class: {},
        companyId: {
            type: String,
            default: ""
        },
        style: {},
        thumbnail: {
            type: String,
            default: ""
        },
        userImage: {
            type: Boolean,
            default: false
        },
        fromWhere: {
            type: String,
            default: ""
        },
        alt: {
            type: String,
            default: null
        }
    });

    /* A person's picture is stored as a data URL, whose last path segment is the tail of the data, not a name. */
    const altText = computed(() => props.alt ?? (props.userImage ? '' : (props.data.filename || '')));

    const emit = defineEmits(["downloadUrl"]);
    const imageObject = ref();
    const imgUrl = ref("");
    const loading = ref(false);
    const tuhumbnailSize = ref(props.thumbnail);
    const isthumbnailOriginal = ref(false);
    onMounted(() => {
        imageObject.value = JSON.parse(JSON.stringify(props.data))
        getImage();
    })

    watch(() => props.thumbnail,(thumb) => {
        tuhumbnailSize.value = thumb;
        if(thumb){
            getImage();
        }
        isthumbnailOriginal.value = false;
    })

    watch(() => props.data, (newVal, oldVal) => {
        if(!isEqual(newVal, oldVal) && props.fromWhere == '') {
            imageObject.value = JSON.parse(JSON.stringify(props.data))
            getImage(newVal.url !== oldVal.url);
            isthumbnailOriginal.value = false;
        }
    })

    function getFileURl(filePath) {
        return new Promise((resolve,reject)=>{
            let bucketId = props.userImage ? "USER_PROFILES" : (props.companyId?.length ? props.companyId : companyId.value);
            let path = '';
            if (tuhumbnailSize.value) {
                const lastDotIndex = filePath.lastIndexOf(".");
                const filename = filePath.substring(0, lastDotIndex);
                const extension = filePath.substring(lastDotIndex + 1);
                path = `${filename}-${tuhumbnailSize.value}.${extension}`;
            } else {
                path = filePath
            }
            let axiousObject = storageQueryBuilder('get',bucketId,path);
            if(filePath?.startsWith('data:') == false) {
                apiRequest(axiousObject.method,axiousObject.route).then((res)=>{
                    resolve(res);
                }).catch((error) => {
                    reject(error);
                });
            }
        })
    }
    function getImage(isLoad = true,isThumbnailRetry = false) {
        if(isLoad){
            loading.value = true;
        }
        const cid = props.companyId?.length ? props.companyId : companyId.value;
        let path = ''
        if (tuhumbnailSize.value && !isThumbnailRetry) {
            const [filename, extension] = props.data.url.split(".");
            if(extension !== 'pdf'){
                path = `${filename}-${tuhumbnailSize.value}.${extension}`;
            }else{
                path = props.data.url
            }
        } else {
            path = props.data.url
        }
        if (path && path.includes("base64")) {
            if(props.userImage){
                imgUrl.value = props.data.url;
                return loading.value = false
            }else{
                imgUrl.value = path;
                if(imgUrl.value.includes('undefined')){
                    imgUrl.value = imgUrl.value.slice(0, imgUrl.value.length - 18)
                }
                return loading.value = false;
            }
        }

        if(env.STORAGE_TYPE && env.STORAGE_TYPE == 'server') {
            getFileURl(props.data.url).then((response)=>{
                imageObject.value.downloadUrl = response.data.url;
                emit("downloadUrl",response.data.url + "&download=true");
                imgUrl.value = response.data.url;
                loading.value = false;
            }).catch((err)=>{
                loading.value = false;
                console.error(err,"error in get image data");
            });
            return;
        }
        const formData = {
            companyId: cid,
            path: path
        }
        let url = props.userImage ? env.WASABI_RETRIVE_USER_PROFILE : env.WASABI_RETRIVE_OBJECT;
        let reqAPi;
        if (props.userImage) {
            reqAPi = apiRequestWithoutCompnay("get", `${url}/${cid}/${path}`, formData);
        } else {
            if (formData.path) {
                reqAPi = apiRequest("post", url, formData);
            }else{
                return loading.value = false;
            }
        }
        reqAPi.then((response)=>{
            if (response.data.status === false) {
                return loading.value = false;
            }
            if(response.data.status === true){
                imageObject.value.downloadUrl = response.data.statusText;
                emit("downloadUrl",response.data.statusText)
                imgUrl.value = response.data.statusText;
                loading.value = false;
            } else {
                loading.value = false;
            }
        }).catch((err)=>{
            loading.value = false;
            console.error(err,"error in get image data");
        })
    }

    function imageLoadError() {
        if (tuhumbnailSize.value) {
            if (isthumbnailOriginal.value == false) {
                getImage(true,true);
                isthumbnailOriginal.value = true;
            } else {
                if (props.userImage) {
                    imgUrl.value = defaultUserAvatar
                } else {
                    imgUrl.value = defaultImage
                }
            }
        } else {
            if (props.userImage) {
                imgUrl.value = defaultUserAvatar
            } else {
                imgUrl.value = defaultImage
            }
        }
    }
</script> 