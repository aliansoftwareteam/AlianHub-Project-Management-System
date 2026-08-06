<template>
    <!-- <div> -->
        <div v-if="showUsersList" class="position-fi overflow-y-auto bg-white style-scroll border-radius-5-px z-index-6 show__userlist">
            <ul class="d-flex flex-column m-0 p-0">
                <template v-if="filteredUsers.length">
                    <li
                        class="d-flex align-items-center cursor-pointer p5px-p10px"
                        :class="{'bg-blue white': selectedUserIndex === index}"
                        v-for="(data, index) in filteredUsers"
                        :key="index"
                        @mouseover="selectedUserIndex = index"
                        @click="addMention(data)"
                    >
                        <!-- An agent has no user record, so getUser-based avatars
                             cannot resolve it — its emoji stands in, and the tag
                             makes clear this is not a person. -->
                        <span v-if="data.isAgent" class="mention__agent-avatar mr-10px">{{ data.emoji }}</span>
                        <UserProfile
                            v-else
                            :showDot="false"
                            class="user__profile cursor-pointer mr-10px"
                            :data="{
                                id: data.key,
                                image: data.image,
                                title: data.name
                            }"
                            width="30px"
                            :thumbnail="'30x30'"
                        />
                        <span>{{data.name}}</span>
                        <span v-if="data.isAgent" class="mention__agent-tag ml-5px">{{ $t('Agents.agent_tag') }}</span>
                    </li>
                </template>
                <template v-else>
                    <li class="d-flex align-items-center cursor-pointer p5px-p10px" @click="focusTextArea()">
                        {{$t('Comments.no_user_found')}}
                    </li>
                </template>
            </ul>
        </div>
        <div class="d-flex flex-column w-100">
            <div v-if="reply && Object.keys(reply).length" class="d-flex align-items-center justify-content-between overflow-y-auto bg-white style-scroll border-top-radius-5-px reply-box bg-gainsboro">
                <div class="d-flex align-items-center emp__profile-wrapper">
                    <UserProfile
                        :showDot="false"
                        class="profile-image mr-5px emplyoee__profile-img"
                        :data="{
                            id: reply.userId,
                            title: getUser(reply.userId).Employee_Name,
                            image: getUser(reply.userId).Employee_profileImageURL
                        }"
                        width="30px"
                        :thumbnail="'30x30'"
                    />
                    <strong class="text-nowrap cursor-default mr-5px">{{getUser(reply.userId).Employee_Name}}: </strong>
                    <span v-if="reply.type === 'text' || reply.type === 'link'" class="text-ellipsis cursor-default" :title="checkLink(changeText(reply.message), true)" v-html="checkLink(changeText(reply.message), true)"></span>
                    <span v-else class="text-ellipsis cursor-default" :title="reply.mediaName">{{reply.mediaName}}</span>
                </div>
                <div class="d-flex align-items-center">
                    <img :src="closeIcon" @click="$emit('cancel-reply')" alt="closeIcon" class="cursor-pointer cancel__reply">
                </div>
            </div>

            <textarea
                v-show="!recording"
                type="text"
                class="write-message style-scroll"
                id="message-box"
                ref="messageBox"
                :placeHolder="$t('PlaceHolder.Type_here')"
                @keypress="handleEnter"
                @keydown="keyDown"
                @mouseup="keyUp"
                @keyup="keyUp"
                @paste="handlePaste"
                :value="modelValue"
                :class="{'border-bottom-radius-5-px': reply, 'border-radius-5-px': !Object.keys(reply).length, 'disabled': !sendMessageAllowed}"
                @input="$emit('update:modelValue', $event.target.value)"
                :disabled="!sendMessageAllowed"
            ></textarea>
        </div>
    <!-- </div> -->
</template>

<script setup>
// PACKAGES
import { useCustomComposable, useGetterFunctions } from "@/composable";
import {defineProps, defineEmits, computed, onMounted, onBeforeUnmount, watch, ref, nextTick, inject} from "vue";

// COMPONENTS
import UserProfile from "@/components/atom/UserProfile/UserProfile.vue"

// UTILS
const {getUser} = useGetterFunctions();
const {changeText, checkLink} = useCustomComposable();

// IMAGES
const closeIcon = require("@/assets/images/delete1.png");
const defaultProfile = inject("$defaultUserAvatar");
const clientWidth = inject("$clientWidth");

const props = defineProps({
    recording: {
        type: Boolean,
        default: false
    },
    modelValue: {
        type: String,
        default: ""
    },
    reply: {
        type: Object,
        default: null
    },
    userIds: {
        type: Array,
        default: () => []
    },
    // Automation agents that can be @-mentioned here. Empty by default, so the
    // project-comment and main-chat uses of this input are unchanged; only the
    // task comment view passes any. Each is { _id, name, emoji }.
    agents: {
        type: Array,
        default: () => []
    },
    showAll: {
        type: Boolean,
        default: false
    },
    sendMessageAllowed: {
        type: Boolean,
        default: true
    },
    isHeight: {
        type: Number,
        default: 24
    },
    loadingChat: {
        type: Boolean,
        default: true
    }
});

const emit = defineEmits(["update:modelValue", "enter", "cancel-reply", "pasteFile"]);

const messageBox = ref("");
const showUsersList = ref(false);
const selectedUserIndex = ref(0);
const selectionIndex = ref(0);
const mentionSearch = ref("");
const users = ref([]);

/**
 * Build the @-mention list: people, then agents.
 *
 * Agents are appended, never merged into the people, and carry `isAgent` so the
 * row renders as an agent. `key` is the agent's own id, which is what addMention
 * writes into the [Name](id) token — an agent id is a 24-hex ObjectId exactly like
 * a user id, so the token format needs no change and the server tells them apart
 * by looking the id up.
 *
 * One function for both the mount and the watch: these were two copies of the same
 * mapping, and a third would have been one more place for them to drift.
 */
function buildUsers() {
    const people = (props.userIds || []).map((x) => {
        const user = getUser(x);
        return {
            name: user.Employee_Name,
            image: user.Employee_profileImageURL,
            key: user.id,
            ghost: user.ghostUser
        }
    });

    const agents = (props.agents || []).map((a) => ({
        name: a.name,
        image: '',
        key: String(a._id),
        ghost: false,
        isAgent: true,
        emoji: a.emoji || '🤖'
    }));

    users.value = [...people, ...agents];

    if (props.showAll) {
        users.value.unshift({
            name: "All",
            image: defaultProfile.value,
            key: "everyone",
            ghost: false
        })
    }
}

onMounted(() => {
    buildUsers();

    // nextTick(() => {
    //     autoResize()
    // })
})

watch(()=> props.loadingChat, (val) => {
    if(val === false) {
        nextTick(() => {
            autoResize();
        })
    }
});

// Rebuild when either source changes: agents arrive from an async fetch, so they
// almost always land after the first render.
watch(() => [props.userIds, props.agents], () => buildUsers(), { deep: true })

const filteredUsers = computed(() => {
    return users.value.filter((x) => !x.ghost && x.name.replaceAll(" ", "").toLowerCase().includes(mentionSearch.value.toLowerCase()))
});

function handleEnter(e) {
    if(e.keyCode === 13 && !e.shiftKey) {
        if(clientWidth.value < 768) return;
        e.preventDefault();

        if(showUsersList.value) {
            addMention(filteredUsers.value[selectedUserIndex.value]);
        } else {
            if(props.modelValue.trim().length) {
                emit("enter");
            }
        }
    }
}

// SHOW MENTION USER LIST
function keyDown(e) {
    if(showUsersList.value) {
        if(e.keyCode === 38 || e.keyCode === 40) {
            e.preventDefault();
            if (e.keyCode === 40) {
                selectedUserIndex.value += selectedUserIndex.value < (filteredUsers.value.length -1) ? 1 : 0;
            } else if (e.keyCode === 38) {
                selectedUserIndex.value -= selectedUserIndex.value > 0 ? 1 : 0;
            }
        }
    }
}

/**
 * Dismiss the mention list when the click lands outside it and outside the
 * input. Previously it only closed on selection or Escape, so clicking anywhere
 * else left the list floating over the page.
 */
function handleOutsideClick(event) {
    if(!showUsersList.value) return;

    const list = document.querySelector(".show__userlist");
    const box = document.getElementById("message-box");
    if((list && list.contains(event.target)) || (box && box.contains(event.target))) {
        return;
    }
    resetMentions();
}

onMounted(() => document.addEventListener("click", handleOutsideClick));
onBeforeUnmount(() => document.removeEventListener("click", handleOutsideClick));

//RESET MENTIONS
function resetMentions(reset = true) {
    if(!reset) {
        return;
    }

    selectedUserIndex.value = 0;
    showUsersList.value = false;
    selectionIndex.value = null;
    mentionSearch.value = "";
}

// ADD MENTION
function addMention(data = {}) {
    if(!Object.keys(data).length){
        resetMentions();
        return;
    }

    let message = props.modelValue;
    message = `${props.modelValue.substr(0, selectionIndex.value)}[${data.name}](${data.key}) ${props.modelValue.substr(selectionIndex.value + mentionSearch.value.length, props.modelValue.length)}`;

    emit("update:modelValue", message);

    nextTick(() => {
        messageBox.value.focus();
        messageBox.value.selectionStart = `${props.modelValue.substr(0, selectionIndex.value)}[${data.name}](${data.key}) `.length ;
        messageBox.value.selectionEnd = `${props.modelValue.substr(0, selectionIndex.value)}[${data.name}](${data.key}) `.length ;
        resetMentions();
    })
}

function autoResize() {
    setTimeout(()=>{
        const defaultTextHeight = 56;
        const textarea = document.getElementById("message-box");
        // The timeout can fire after this input is unmounted.
        if(!textarea) return;
        textarea.style.height = defaultTextHeight+"px";
        const newHeight = Math.min(textarea.scrollHeight, 250);
        textarea.style.height = newHeight + "px";

        nextTick(() => {
            const comment_footer = newHeight + props.isHeight;
            // `#message_container` belongs to the comment layout that hosts this
            // input; other hosts (e.g. the Main Chat module, whose transcript
            // sizes itself with flexbox) simply do not have it. Previously the
            // unguarded access threw "Cannot read properties of null (reading
            // 'style')" on every keystroke there. Where the element exists the
            // behaviour is unchanged.
            const message_container = document.getElementById("message_container");
            if(!message_container) return;
            const height = Math.min(comment_footer, 275);
            message_container.style.height = `calc(100% - ${height}px)`;
        });
    });
}

// CHECK MENTIONS
function keyUp(e) {
    // RESIZE TEXT AREA
    nextTick(() => {
        autoResize();
    })

    // check Escape
    if(e.keyCode === 27) {
        e.preventDefault();
        resetMentions();
        return;
    }

    // Check Mention
    let ind = messageBox.value.selectionStart - 1;
    checkShowMentions(ind, e.keyCode);
}

// CHECK TO SHOW MENTIONS
function checkShowMentions(selectionStart, keyCode) {
    if(!props.modelValue || !props.modelValue.length) {
        resetMentions();
        return;
    }
    let selectionIn = selectionStart;
    let counter = 0;
    while(props.modelValue[selectionIn] !== "@" || counter < 1) {
        let value = props.modelValue[selectionIn];
        if(selectionIn < 0) {
            resetMentions(keyCode !== 38 && keyCode !== 40);
            break;
        } else if(value === "@") {
            selectionIndex.value = selectionIn + 1;
            showUsersList.value = true;
            mentionSearch.value = props.modelValue.substr(selectionIndex.value, (selectionStart + 1) - selectionIndex.value)
            break;
        } else if(value === " " || value === "\n") {
            counter++;
        } else {
            resetMentions(keyCode !== 38 && keyCode !== 40);
        }
        selectionIn--;
    }
}

function handlePaste(e) {
    // AHE-3834 — guard: an empty/absent clipboard payload threw on `item.kind`.
    // Also collect ALL pasted files instead of only the first item.
    const items = Array.from(e?.clipboardData?.items || []);
    if(!items.length) return;

    const files = items.filter((item) => item.kind === "file").map((item) => item.getAsFile()).filter(Boolean);
    if(files.length) {
        emit('pasteFile', files);
    }
}
</script>

<style>
@import './style.css';

/* Agent rows in the @-mention list. Dashed ring, matching the assignee chip and
   the agent comment avatar, so the same visual means the same thing everywhere. */
.mention__agent-avatar {
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
.mention__agent-tag {
    padding: 1px 6px;
    border-radius: 999px;
    background: #EEF0FE;
    color: #6473E8;
    font-size: 9.5px;
    font-weight: 650;
    letter-spacing: 0.06em;
    text-transform: uppercase;
}
</style>
