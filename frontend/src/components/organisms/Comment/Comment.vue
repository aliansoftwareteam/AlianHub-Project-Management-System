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
                <!-- An agent wrote this one. Its userId holds the agent's id, which
                     getUser() cannot resolve, so it gets its own avatar rather than
                     a blank one — and is visibly not a person. -->
                <span
                    v-if="!message.sent && showUser && message.agentId"
                    class="comment__agent-avatar mr-10px"
                    :title="message.agentName || $t('Agents.assignee_group')"
                >{{ agentEmoji }}</span>
                <UserProfile
                    v-else-if="!message.sent && showUser"
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
                            <template v-if="message.agentId">
                                {{ message.agentName || $t('Agents.assignee_group') }}
                                <span class="comment__agent-tag">{{ $t('Agents.agent_tag') }}</span>
                            </template>
                            <template v-else>{{!message.sent ? getUser(message.userId).Employee_Name : ''}}</template>
                        </span>
                        <!-- The agent proposed a change and is waiting. The decision
                             belongs here, next to what it actually said, rather than
                             on a settings page someone has to go and find. -->
                        <span v-if="awaitingApproval" class="comment__approve">
                            <span class="comment__approve-label">{{ $t('Agents.awaiting_approval') }}</span>
                            <button type="button" class="comment__approve-yes" :disabled="deciding" @click="decide(true)">
                                {{ $t('Agents.approve') }}
                            </button>
                            <button type="button" class="comment__approve-no" :disabled="deciding" @click="decide(false)">
                                {{ $t('Agents.reject') }}
                            </button>
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
                                            v-if="message.mediaURL?.includes('http')"
                                            :src="message.mediaURL"
                                            :alt="message.mediaOriginalName"
                                            :extension="message.mediaOriginalName?.split('.').pop()"
                                            class="comment-media comment__image" />
                                        <WasabiImageComp v-else
                                            :data="{url: message.mediaURL,title: message.mediaOriginalName, filename: message.mediaOriginalNamem, extension: message.mediaOriginalName?.split('.').pop()}"
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
                                        <ImageIcon v-if="message.mediaURL?.includes('http')" :src="message.mediaURL" :extension="message.mediaName?.split('.').pop()" :alt="message.mediaName" class="comment-media"/>
                                        <WasabiImageComp
                                            v-else
                                            :data="{url: message.mediaURL, title: message.mediaOriginalName, filename: message.mediaOriginalNamem, extension: message.mediaOriginalName?.split('.').pop()}"
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
                        <ReactionBar
                            v-if="!message.isDeleted"
                            :reactions="localReactions"
                            compact
                            class="mt-5px"
                            @toggle="(emoji) => toggleCommentReaction(emoji)"
                        />
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
import { computed, defineComponent, defineProps, inject, onMounted, ref, watch } from 'vue';
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
import ReactionBar from '@/components/atom/ReactionBar/ReactionBar.vue';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { useToast } from 'vue-toast-notification';
import { useI18n } from 'vue-i18n';

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

// Read off the comment rather than looked up, so an agent's old comments still
// render after it is renamed or deleted. Falls back for rows written before the
// emoji was stored.
const agentEmoji = computed(() => props.message?.agentEmoji || '🤖');

const $toast = useToast();
const { t } = useI18n();

// ── agent approval ─────────────────────────────────────────────────────────
// An agent with "ask me first" proposes a change and stops. Without a control the
// proposal is a dead end — the agent can never act, which is what happened.
const deciding = ref(false);
const decided = ref('');
const awaitingApproval = computed(() =>
    !!props.message?.agentAwaitingApproval && !!props.message?.agentRunId && !decided.value);

const decide = async (approve) => {
    if (deciding.value) return;
    deciding.value = true;
    try {
        const res = await apiRequest('post', `${env.AGENTS}/runs/${props.message.agentRunId}/decide`, { approve });
        if (!res?.data?.status) {
            $toast.error(res?.data?.statusText || t('Agents.decide_failed'), { position: 'top-right' });
            return;
        }
        // Hides the buttons immediately. The agent posts its own follow-up comment,
        // and the socket brings that in — so the outcome is visible in the thread
        // rather than only in a toast that disappears.
        decided.value = approve ? 'approved' : 'rejected';
        $toast.success(res.data.statusText, { position: 'top-right' });
    } catch (error) {
        $toast.error(error?.message || t('Agents.decide_failed'), { position: 'top-right' });
    } finally {
        deciding.value = false;
    }
};


const showMore = ref(false);

// Reactions render from a local copy so we never mutate the prop directly;
// socket-driven prop updates (other users reacting) re-sync it via the watch.
const localReactions = ref([...(props.message?.reactions || [])]);
watch(() => props.message?.reactions, (value) => {
    localReactions.value = [...(value || [])];
});

function toggleCommentReaction(emoji) {
    const user = getUser(userId.value);
    apiRequest('post', '/api/v2/reactions', {
        targetType: 'comment',
        targetId: props.message._id,
        emoji,
        isProjectComment: props.message.project === true,
        userData: { id: user.id, Employee_Name: user.Employee_Name },
    }).then((response) => {
        if (response.data?.status) {
            localReactions.value = response.data.data.reactions || [];
        }
    }).catch((error) => {
        console.error('ERROR in toggle comment reaction: ', error);
    });
}

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
        extension: props.message.mediaOriginalName?.split(".").pop(),
        type: props.message.type,   
        url: downloadValue.value ? downloadValue.value : props.message.mediaURL,
        downloadUrl: downloadValue.value ? downloadValue.value : props.message.mediaURL,
    }
    emit('previewImage', previewData);
}


async function processUrl(message) {
    if (message.type !== "video" || message.type !== "audio" || message.type !== "image") {
        let properUrl = message.downloadURL || message.mediaURL;

        // AHE-3834 — text/link messages carry no media URL. Without this guard
        // `properUrl.includes` threw (undefined) or, when mediaURL was an empty
        // string, fired a pointless storage request for every text message.
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



/* An agent comment: emoji avatar plus a small tag, so it is never mistaken for a
   person. The dashed ring matches the assignee chip for the same reason. */
.comment__agent-avatar {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    flex: none;
    border-radius: 50%;
    background: #EEF0FE;
    border: 1px dashed #A9B2EE;
    font-size: 14px;
    line-height: 1;
}
.comment__agent-tag {
    display: inline-block;
    margin-left: 4px;
    padding: 1px 6px;
    border-radius: 999px;
    background: #EEF0FE;
    color: #6473E8;
    font-size: 9.5px;
    font-weight: 650;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    vertical-align: 1px;
}

/* Approval controls on an agent comment. Amber rather than red: this is a decision
   waiting to be made, not an error. */
.comment__approve {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin-left: 8px;
    padding: 2px 4px 2px 8px;
    border-radius: 999px;
    background: #FEFAF1;
    border: 1px solid #F0DFB8;
    vertical-align: 1px;
}
.comment__approve-label {
    font-size: 10.5px;
    font-weight: 650;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #8A5A0B;
}
.comment__approve-yes, .comment__approve-no {
    padding: 2px 9px;
    font-family: inherit;
    font-size: 11.5px;
    font-weight: 600;
    border-radius: 999px;
    cursor: pointer;
    border: 1px solid transparent;
}
.comment__approve-yes { color: #fff; background: #1B7F3B; border-color: #1B7F3B; }
.comment__approve-yes:hover { background: #166A31; }
.comment__approve-no { color: #6B7280; background: #fff; border-color: #D6D9E4; }
.comment__approve-no:hover { background: #F4F5FB; }
.comment__approve-yes:disabled, .comment__approve-no:disabled { opacity: 0.5; cursor: default; }
.comment__approve-yes:focus-visible, .comment__approve-no:focus-visible { outline: 2px solid #2F3990; outline-offset: 1px; }
</style>
