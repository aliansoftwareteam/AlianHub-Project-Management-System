<template>
    <div v-if="item" class="w-100">
        <div class="w-100 hover-bg-light-gray border-radius-5-px cursor-pointer d-flex align-items-center justify-content-between p-10px my-2px" :class="{'bg-light-gray purple': active}"  @click.stop="$emit('click', type === 'category' ? null : item)">
            <div class="d-flex align-items-center user_photo-name_wrapper">
                <div v-if="type === 'category'" class="if__category">
                    <img
                        v-if="Object.keys(item?.sprintsObj || {})?.length"
                        :src="triangleBlack" alt="triangleBlack"
                        :style="`transform: rotateZ(${!item.isExpanded ? 0 : 90 }deg); margin-right: 5px;`"
                        @click.stop="$emit('toggle')"
                    >
                </div>
                <div class="mr-5px">
                    <template v-if="type === 'user' && receiver?.Employee_Name">
                        <UserProfile :data="{title: receiver?.Employee_Name, image: (receiver?.Employee_profileImageURL)}" width="30px" :showDot="false" :thumbnail="'30x30'"/>
                    </template>
                    <template v-else-if="type === 'category'">
                    </template>
                    <template v-else-if="type === 'channel'">
                        #
                    </template>
                </div>
                <div class="d-flex flex-column without_img-text__msg_wrapper">
                    <div class="text-ellipsis">
                        <template v-if="type === 'user'">
                            <span class="font-size-14 font-weight-700 gray63 ">{{receiver?.Employee_Name}}</span>
                        </template>
                        <template v-else-if="type === 'category'">
                            <span class="font-size-14 font-weight-700 gray63">{{item.name}}</span>
                        </template>
                        <template v-else-if="type === 'channel'">
                            <div class="d-flex align-items-center">
                                <WasabiImage v-if="item?.type == 'image'" :data="{url: item?.url}" class="profile-sm-square m0px-5px"/>
                                <FontAwesomeIcon v-if="item?.type == 'icon'" :icon="renderIcon(item)"  size="sm" class="w-20 m0px-5px" />
                                <span class="font-size-14 font-weight-700">{{item.name}}</span>
                            </div>
                        </template>
                    </div>
                    <div class="text-ellipsis font-size-14 font-weight-400 gray63">
                        <span v-if="item?.message === 'general.message_deleted'">
                            {{ $t('general.message_deleted') }}
                        </span>
                        <span v-else v-html="sanitizeInline(changeText(item?.message || '', '', ''))"></span>
                    </div>
                </div>
                <img v-if="item?.private" :src="privateIcon" alt="privateIcon" class="private__icon">
            </div>
            <slot name="options"></slot>
        </div>
        <Transition>
            <div class="channel_mian_wrapper" v-if="item.isExpanded && Object.keys(item.sprintsObj || {}).length">
                <TransitionGroup>
                    <ChatListItem
                        v-for="chat in (item?.sprintsObj || {})" :key="chat.id"
                        :item="chat"
                        :active="chat.id === selectedChat?.id"
                        @click="$emit('click', chat)"
                        type="channel"
                        class="ml-25px"
                        @toggle="chat.isExpanded = !chat.isExpanded"
                        style="width:calc(100% - 25px);"
                    >
                        <template #options>
                            <Transition>
                                <div v-if="myCounts?.[`task_${selectedProject._id}_${chat.id}_default_comments`]" class="red border-radius-1 font-size-12 bg-transparent p2x-5px border-red">
                                    {{myCounts?.[`task_${selectedProject._id}_${chat.id}_default_comments`] > 99 ? "+99" : myCounts?.[`task_${selectedProject._id}_${chat.id}_default_comments`]}}
                                </div>
                            </Transition>
                        </template>
                    </ChatListItem>
                </TransitionGroup>
            </div>
        </Transition>
    </div>
</template>

<script setup>
// PACKAGES
import { computed, inject, onMounted, ref, watch } from "vue";
import { useCustomComposable, useGetterFunctions } from "@/composable";
import { useStore } from "vuex";
import { library, dom } from "@fortawesome/fontawesome-svg-core";
import { far } from "@fortawesome/free-regular-svg-icons";
import { fab } from "@fortawesome/free-brands-svg-icons"
import { fas } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";
library.add(far);
library.add(fab)
library.add(fas);
dom.watch();
const icons = [...new Set([...Object.keys(far).map(key => far[key]),...Object.keys(fab).map(key => fab[key]),...Object.keys(fas).map(key => fas[key])])]

// COMPONENTS
import UserProfile from "@/components/atom/UserProfile/UserProfile.vue"
import ChatListItem from "@/components/atom/ChatListItem/ChatListItem.vue"
import WasabiImage from "@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue";

// UTILS
import { sanitizeInline } from "@/utils/sanitizeHtml";
const {getUser} = useGetterFunctions()
const {getters} = useStore();
const {changeText} = useCustomComposable();
const userId = inject("$userId")
const selectedChat = inject("selectedChat")

// IMAGES
const triangleBlack = require("@/assets/images/svg/triangleBlack.svg");
const privateIcon = require("@/assets/images/private.png");

// EMITS
defineEmits(["toggle", "click"])
// PROPS
const props = defineProps({
    item: {
        type: Object,
        default: null
    },
    selectedProject: {
        type: Object,
        default: null
    },
    active: {
        type: Boolean,
        default: false
    },
    type: {
        type: String,
        default: null
    }
})

const receiver = ref(null);
const myCounts = computed(() => getters["users/myCounts"]?.data || {})

function getImage(arr = []) {
    if(!arr.length) return null;

    let receiverId = arr.filter((x) => x !== userId.value)[0]
    receiver.value = getUser(receiverId);
}

onMounted(() => {
    if(props.type === 'user') {
        getImage(props?.item?.AssigneeUserId || [])
    }
})

watch(() => props.item, () => {
    if(props.type === 'user') {
        getImage(props?.item?.AssigneeUserId || [])
    }
})

function renderIcon(icon) {
    const tmpIcon =  icons.find((x) => x.iconName === icon.iconName && x.prefix === icon.prefix);
    return tmpIcon;
}
</script>

<style scoped>
.private__icon{
    width: 13px;
     height: 20px; 
     object-fit:contain;
}
.chat__wrapper{
   background-color: red;
   padding: 2px 5px;
}
.if__category{
    width: 6px !important;
}
.user_photo-name_wrapper {
    width: 80%;
}
.channel_mian_wrapper .user_photo-name_wrapper {
    width: 100%;
}
.convertdate_formate-wrapper {
    width: 20%;
    text-align: right;
}
.without_img-text__msg_wrapper {
    width: calc(100% - 30px);
}
</style>