<template>
    <div v-if="item" class="w-100">
        <div class="w-100 hover-bg-light-gray border-radius-5-px cursor-pointer d-flex align-items-center justify-content-between p-10px my-2px mcs-item" :class="{'bg-light-gray purple': active}"  @click.stop="$emit('click', type === 'category' ? null : item)">
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
                        <!-- Colour-seeded initials instead of the identical grey
                             silhouette every row used to show, so people in the list
                             are distinguishable at a glance. -->
                        <MainChatAvatar
                            :name="receiver?.Employee_Name"
                            :src="receiver?.Employee_profileImageURL"
                            :size="28"
                        />
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
                        <span v-else v-html="changeText(item?.message || '', '', '')"></span>
                    </div>
                </div>
            </div>

            <!--
              Trailing controls, always in the same order: lock -> count -> menu.
              The lock used to live at the end of the NAME block, whose width is a
              percentage of the row, so it landed in a different place depending on
              whether a count was present and never lined up down the column. One
              right-aligned flex row with a single gap fixes both the order and the
              spacing.
            -->
            <div class="mcs-item-trail">
                <!-- The lock keeps its slot even when the row is public, so the count
                     beside it starts from the same x on every row. -->
                <span class="mcs-lock-slot" :title="item?.private ? $t('MainChat.private_channel') : ''">
                    <MainChatIcon v-if="item?.private" name="lock" :size="13" class="mcs-lock" />
                </span>
                <slot name="options"></slot>
            </div>
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
                        @edit="$emit('edit', $event)"
                        @delete="$emit('delete', $event)"
                    >
                        <!-- No wrapper element: these become direct children of
                             .mcs-item-trail so its single gap spaces them, rather than
                             each call site inventing its own margins. -->
                        <template #options>
                            <Transition>
                                <!-- .mcs-badge (MainChat/style.css, loaded globally by the chat
                                     sidebar) so a channel's count is the same filled square as
                                     the category and direct-message counts beside it. -->
                                <div v-if="myCounts?.[`task_${selectedProject._id}_${chat.id}_default_comments`]" class="mcs-badge">
                                    {{myCounts?.[`task_${selectedProject._id}_${chat.id}_default_comments`] > 99 ? "+99" : myCounts?.[`task_${selectedProject._id}_${chat.id}_default_comments`]}}
                                </div>
                            </Transition>

                            <!-- Channel actions. Gated by the same permission the
                                 create-channel action uses, so anyone who cannot add a
                                 channel cannot rename or remove one either. Re-emitted
                                 from the nested row up to the sidebar, which owns the
                                 edit panel and the delete confirmation. -->
                            <DropDown
                                v-if="canManageChannel"
                                :id="`channel_${chat.id}`"
                                :title="chat.name"
                                class="mcs-menu"
                            >
                                <template #button>
                                    <span :ref="`channel_${chat.id}Ref`" class="mcs-menu-btn" :title="$t('MainChat.more')">
                                        <MainChatIcon name="more" :size="16" />
                                    </span>
                                </template>
                                <template #options>
                                    <DropDownOption @click="closeChannelMenu(chat.id), $emit('edit', chat)">
                                        <span class="mcs-menu-item">{{ $t('Channel.edit_channel') }}</span>
                                    </DropDownOption>
                                    <DropDownOption @click="closeChannelMenu(chat.id), $emit('delete', chat)">
                                        <span class="mcs-menu-item mcs-menu-item--danger">{{ $t('Channel.delete_channel') }}</span>
                                    </DropDownOption>
                                </template>
                            </DropDown>
                        </template>
                    </ChatListItem>
                </TransitionGroup>
            </div>
        </Transition>
    </div>
</template>

<script setup>
// PACKAGES
import { computed, getCurrentInstance, inject, onMounted, ref, watch } from "vue";
import { useCustomComposable, useGetterFunctions } from "@/composable";
import { useStore } from "vuex";
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";
// AHE-3834 — one-time shared FA registration (was per-row in <script setup>).
import { ensureFaIcons, findFaIcon } from "@/utils/faIcons";

// COMPONENTS
import MainChatAvatar from "@/components/organisms/MainChat/MainChatAvatar.vue"
import MainChatIcon from "@/components/organisms/MainChat/MainChatIcon.vue"
import ChatListItem from "@/components/atom/ChatListItem/ChatListItem.vue"
import WasabiImage from "@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue";
import DropDown from '@/components/molecules/DropDown/DropDown.vue'
import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue'

// UTILS
const {getUser} = useGetterFunctions()
const {getters} = useStore();
const {changeText, checkPermission} = useCustomComposable();
const userId = inject("$userId")
const selectedChat = inject("selectedChat")
const instance = getCurrentInstance();

// IMAGES
const triangleBlack = require("@/assets/images/svg/triangleBlack.svg");

// EMITS
defineEmits(["toggle", "click", "edit", "delete"])
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

// Same gate as "Create channel" on the category row above.
const canManageChannel = computed(() => checkPermission('chat.chat_channel') === true);

// DropDown has no close method; the app's idiom is to re-click the trigger.
function closeChannelMenu(chatId) {
    const trigger = instance && instance.refs && instance.refs[`channel_${chatId}Ref`];
    const node = Array.isArray(trigger) ? trigger[0] : trigger;
    if (node && node.click) node.click();
}

function getImage(arr = []) {
    if(!arr.length) return null;

    let receiverId = arr.filter((x) => x !== userId.value)[0]
    receiver.value = getUser(receiverId);
}

// Register the FA icon packs once, at setup time — matching the timing of the
// previous per-instance `library.add(...)` so channel icons resolve on first
// render. Memoized, so every row after the first is a no-op.
ensureFaIcons();

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
    return findFaIcon(icon.iconName, icon.prefix);
}
</script>

<style scoped>
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