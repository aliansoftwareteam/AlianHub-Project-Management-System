<template>
    <div>
        <div v-if="showDay" class="position-re bg-gray my-1 w-100 show__day">
            <span class="bg-light-gray position-ab px-1 border-radius-5-px cursor-default show__day-format">{{convertDateFormat(message.createdAt)}}</span>
        </div>
        <div v-if="showUnread" class="d-flex justify-content-center w-100 mt-10px">
            <span class="border-radius-10-px cursor-default text-center unread__message-text bg-lightgreen py-10px">{{showUnread}} {{$t('Comments.unread_message')}}</span>
        </div>
        <div class="message d-flex align-items-center mt-1" :style="{marginTop: (!showMessageTime ? '5px' : '')}" :class="{'right-message': message.sent, 'justify-content-between': !message.sent}">
            <div class="d-flex" :style="{paddingLeft: (!message.sent && !showUser ? '35px' : '')}">
                <UserProfile
                    v-if="!message.sent && showUser"
                    :showDot="false"
                    class="cursor-pointer profile-image message__profile-image mr-10px"
                    :data="{
                        id: message.userId,
                        title: getUser(message.userId).Employee_Name,
                        image: getUser(message.userId).Employee_profileImageURL
                    }"
                    width="30px"
                    :thumbnail="'30x30'"
                />
                <div>
                    <div class="cursor-default mb-5px" :class="{'text-right': message.sent, 'text-left': !message.sent}">
                        <span v-if="showUser" class="font-size-14 font-weight-700 mr-5px color63 show__user">
                            {{!message.sent ? getUser(message.userId).Employee_Name : ''}}
                        </span>
                        <span class="font-size-12 font-weight-300 gray text-lowercase show" v-if="showMessageTime">
                            {{getDateType(new Date(message.createdAt).getTime())}}
                        </span>
                    </div>
                    <div class="d-flex position-re" :class="{'justify-content-end': message.sent}">
                        <span v-if="!message.isDeleted && message.sent && new Date(message.createdAt)?.getTime() !== new Date(message.updatedAt)?.getTime()" class="font-size-10">({{$t('Comments.edited')}})</span>
                        <div :id="message._id" class="border-radius-10-px p-10px message_id-sent" :class="{'bg-white': !message.sent, 'bg-light-blue': message.sent}" :style="`${message.type !== 'text' || message.type !== 'link' ? 'width: auto;' : ''}`">
                            <template v-if="message.isDeleted">
                                <pre class="red font-italic" v-html="message.userId === userId ? $t('Comments.You_deleted_this_message') : $t('Comments.This_message_is_deleted')"/>
                            </template>
                            <template v-else>
                                <Spinner
                                    :isSpinner="message?.isSending !== undefined && message?.isSending?.length > 0"
                                />
                                <template v-if="message.type === 'image'">
                                    <div class="d-flex flex-column" @click.prevent="previewImageFun()">
                                        <ImageIcon
                                            v-if="message.mediaURL.includes('http')"
                                            :src="message.mediaURL"
                                            :alt="message.mediaOriginalName"
                                            :extension="message.mediaOriginalName.split('.').pop()"
                                            class="comment-media comment__image" />
                                        <WasabiImageComp v-else
                                            :data="{url: message.mediaURL,title: message.mediaOriginalName, filename: message.mediaOriginalNamem, extension: message.mediaOriginalName.split('.').pop()}"
                                            @downloadUrl="handleDownloadUrl" class="comment-media comment__image" />
                                    </div>
                                </template>

                                <template v-else-if="message.type === 'audio'">
                                    <div class="d-flex flex-column">
                                        <WasabiAudioComp :id="`audio_${message._id}`" @downloadUrl="handleDownloadUrl"
                                            :data="message.mediaURL"
                                            @play="pauseOthers(message.type, `audio_${message._id}`)" />
                                    </div>
                                </template>

                                <template v-else-if="message.type === 'video'">
                                    <div class="d-flex flex-column" @click.prevent="previewImageFun()">
                                        <WasabiVideoComp @downloadUrl="handleDownloadUrl" :id="`video_${message._id}`"
                                            :data="message.mediaURL" class="comment-media video_controls"
                                            @play="pauseOthers(message.type, `video_${message._id}`)" />
                                    </div>
                                </template>

                                <template v-else-if="message.type !== 'text' && message.type !== 'link'">
                                    <div class="d-flex flex-column" @click.prevent="previewImageFun()">
                                        <ImageIcon v-if="message.mediaURL.includes('http')" :src="message.mediaURL" :extension="message.mediaName.split('.').pop()" :alt="message.mediaName" class="comment-media"/>
                                        <WasabiImageComp
                                            v-else
                                            :data="{url: message.mediaURL, title: message.mediaOriginalName, filename: message.mediaOriginalNamem, extension: message.mediaOriginalName.split('.').pop()}"
                                            class="comment-media comment__image"
                                            @downloadUrl="(eve) => {downloadurl(eve)}"
                                        />
                                    </div>
                                </template>

                                <template v-else>
                                    <template v-if="message.hasReply">
                                        <div>
                                            <div @click="$emit('highlight', message.reply)" class="d-flex align-items-center border-radius-10-px cursor-pointer p-10px mb-5px message_replay" :class="{'bg-light-gray': !message.sent, 'bg-fresh-air' : message.sent}">
                                                <UserProfile
                                                    :showDot="false"
                                                    class="profile-image message__profile-image mr-10px"
                                                    :data="{
                                                        id: message.reply_userId,
                                                        title: getUser(message.reply_userId).Employee_Name,
                                                        image: getUser(message.reply_userId).Employee_profileImageURL
                                                    }"
                                                    width="30px"
                                                    :thumbnail="'30x30'"
                                                />
                                                <strong class="text-nowrap mr-5px">{{getUser(message.reply_userId).Employee_Name}}: </strong>
                                                <pre
                                                    class="text-ellipsis text-nowrap white__space-nowrap"
                                                    :title="['link', 'text'].includes(message.reply_type) ? checkLink(changeText(message?.reply_message || ''), true) : message?.reply_mediaOriginalName"
                                                    v-html="['link', 'text'].includes(message.reply_type) ? checkLink(changeText(message?.reply_message || ''), true) : message?.reply_mediaOriginalName"
                                                />
                                            </div>
                                            <pre
                                                :class="{'para-overflow': message.overflow && !showMore}"
                                                v-html="message.type === 'link' ? checkLink(changeText(message.message), true) : changeText(message.message)"
                                            />
                                            <div v-if="message.overflow" class="text-center cursor-pointer border-top mt-10px pt-5px text-center" @click="showMore = !showMore">
                                                <span>{{$t('Permissions.Read')}} {{showMore ? $t('Comments.less') : $t('Comments.more')}}</span>
                                            </div>
                                        </div>
                                    </template>
                                    <template v-else>
                                        <pre
                                            :class="{'para-overflow': message.overflow && !showMore}"
                                            v-html="message.type === 'link' ? checkLink(changeText(message.message), true) : changeText(message.message)"
                                        />
                                        <div v-if="message.overflow" class="text-center cursor-pointer border-top mt-10px pt-5px text-center" @click="showMore = !showMore">
                                            <span>{{$t('Permissions.Read')}} {{showMore ? $t('Comments.less') : $t('Comments.more')}}</span>
                                        </div>
                                    </template>
                                </template>
                            </template>
                        </div>
                        <span v-if="!message.isDeleted && !message.sent && new Date(message.createdAt).getTime() !== new Date(message.updatedAt).getTime()"  class="font-size-10">({{$t('Comments.edited')}})</span>
                    </div>
                </div>
            </div>
            <DropDown v-if="showOptions && !message?.isDeleted" class="align-self-start"  :bodyClass="{'comments__message--dropdown' : true}">
                <template #button>
                    <img :ref="`message_option_${message._id}`" :src="verticalDots" alt="verticalDots" class="cursor-pointer ml-10px" :class="[showMessageTime ? 'mt-30px' : 'mt-10px']">
                </template>
                <template #options>
                    <template v-if="!message.isDeleted">
                        <DropDownOption v-if="message.sent && (message.type === 'text' || message.type === 'link') && new Date(message.createdAt).setSeconds(0, 0) > (new Date().setSeconds(0, 0) - 360000)" @click="$emit('edit', JSON.parse(JSON.stringify(message))), $refs[`message_option_${message._id}`].click()">
                            {{$t('Comments.edit')}}
                        </DropDownOption>
                        <DropDownOption v-if="!mainChat && (message.type === 'text' || message.type === 'link')" @click="$emit('createTask', message), $refs[`message_option_${message._id}`].click()">
                            {{$t('Comments.create_task')}}
                        </DropDownOption>
                        <DropDownOption v-if="!mainChat && (message.type === 'text' || message.type === 'link')" @click="$emit('addCheckList', message), $refs[`message_option_${message._id}`].click()">
                            {{ $t('Comments.add_to_checklist') }}
                        </DropDownOption>
                        <DropDownOption v-if="message.type === 'text' || message.type === 'link'" @click="$emit('copy', message), $refs[`message_option_${message._id}`].click()">
                            {{$t('Comments.copy_message')  }}
                        </DropDownOption>
                        <DropDownOption v-if="message.sent" @click="$emit('delete', message), $refs[`message_option_${message._id}`].click()">
                            {{$t('Projects.delete')}}
                        </DropDownOption>
                        <DropDownOption @click="$emit('reply', message), $refs[`message_option_${message._id}`].click()">
                            {{$t('Comments.reply')}}
                        </DropDownOption>
                        <DropDownOption v-if="mainChat" @click="$emit('pin', message), $refs[`message_option_${message._id}`].click()">
                            {{!message?.pinnedMessage ? $t('Projects.pin') : $t('Projects.unpin')}} {{$t('Comments.message')}}
                        </DropDownOption>
                    </template>
                    <DropDownOption id="mark_as_unread" @click="showUnread ? '' : $emit('markUnread', message), $refs[`message_option_${message._id}`].click()">
                        {{$t('Comments.mark_unread')}}
                    </DropDownOption>
                </template>
            </DropDown>
            <span v-else class="cursor-pointer ml-15px"></span>
        </div>
    </div>
</template>

<script setup>
// PACKAGES
import { defineComponent, defineProps, inject, onMounted, ref } from 'vue';
import { useConvertDate, useCustomComposable, useGetterFunctions } from '@/composable';

// COMPONENTS
import WasabiImageComp from "@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue"
import WasabiAudioComp from "@/components/atom/wasabiComps/wasabAudio.vue"
import WasabiVideoComp from "@/components/atom/wasabiComps/wasabVideo.vue"
import DropDown from '@/components/molecules/DropDown/DropDown.vue'
import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue'
import ImageIcon from "@/components/atom/ImageIcon/ImageIcon.vue"
import UserProfile from "@/components/atom/UserProfile/UserProfile.vue"
import Spinner from "@/components/atom/SpinnerComp/SpinnerComp.vue"
import { useProjects } from '@/composable/projects';

import { storageHelper } from "@/composable/commonFunction";
const { handleStorageImageRequest } = storageHelper();

const {getDateType} = useProjects();

// UTILS
const {changeText, checkLink} = useCustomComposable();
const {convertDateFormat} = useConvertDate();
const {getUser} = useGetterFunctions();
const userId = inject("$userId");
const companyId = inject("$companyId");
// IMAGES
const verticalDots = require("@/assets/images/svg/Forma.svg");

const emit = defineEmits(['createTask', 'copy', 'reply', 'edit', 'delete', 'markUnread', 'addCheckList', 'highlight', 'pin', 'previewImage',"downloadUrl"])

defineComponent({
    name: "Comment-Component",
    components: {
        DropDown,
        DropDownOption,
        ImageIcon,
        Spinner
    }
})

// PROPS
const props = defineProps({
    mainChat: {
        type: Boolean,
        default: false
    },
    message: {
        type: Object,
        default: () => {}
    },
    showDay: {
        type: Boolean,
        default: false
    },
    showOptions: {
        type: Boolean,
        default: true
    },
    showUser: {
        type: Boolean,
        default: false
    },
    showMessageTime: {
        type: Boolean,
        default: false
    },
    showUnread: {
        type: Number,
        default: 0
    }
})

const showMore = ref(false);

// function openFileInWindow(url) {
//     window.open(url, "_blank")
// }

const downloadValue = ref("");
function downloadurl (e) {
    downloadValue.value = e;
}

function pauseOthers(type, id) {
    let items = Array.from(document.getElementsByTagName(`${type}`))

    items.forEach((item) => {
        if(!item.id || item.id !== id) {
            item.pause();
        }
    })
}

function previewImageFun() {
    let previewData = {
        title: props.message.mediaOriginalName,
        filename: props.message.mediaOriginalName,
        extension: props.message.mediaOriginalName.split(".").pop(),
        type: props.message.type,   
        url: downloadValue.value ? downloadValue.value : props.message.mediaURL,
        downloadUrl: downloadValue.value ? downloadValue.value : props.message.mediaURL,
    }
    emit('previewImage', previewData);
}


async function processUrl(message) {
    if (message.type !== "video" || message.type !== "audio" || message.type !== "image") {
        let properUrl = message.downloadURL || message.mediaURL;

        // Text/link comments carry no media URL; skip cleanly instead of
        // throwing `Cannot read properties of undefined (reading 'includes')`.
        if (!properUrl) return;

        if (!properUrl.includes("http")) {

            try {
                const fetchedUrl = await handleStorageImageRequest({
                    companyId: companyId.value,
                    data:  { url: properUrl },
                    isCache: true,
                });
                if (fetchedUrl) {
                    properUrl = fetchedUrl.url;
                } else {
                    console.error("getStorageImage returned an invalid response:", fetchedUrl);
                }
            } catch (error) {
                console.error(`Error fetching URL for ${message.mediaOriginalName}:`, error);
                return;
            }
        }

        handleDownloadUrl(properUrl);
    }
}

function handleDownloadUrl(url) {
    emit("downloadUrl", {url,id: props.message._id});
}

onMounted(async () => {
    await processUrl(props.message);   
});
</script>

<style scoped>
@import './style.css';
@media(min-width:1300px){
    .message_replay{
    max-width: 460px;
}
}
@media(min-width:1440px){
    .message_replay{
    max-width: 590px;
}
}
@media(min-width:1640px){
    .message_replay{
    max-width: 840px;
}
}


</style>