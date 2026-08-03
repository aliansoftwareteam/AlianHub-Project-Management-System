<template>
    <div v-if="!allowChatFeature">
        <UpgradePlan
            :buttonText="$t('Upgrades.upgrade_your_plan')"
            :lastTitle="$t('Upgrades.unlock_chat')"
            :secondTitle="$t('Upgrades.unlimited')"
            :firstTitle="$t('Upgrades.upgrade_to')"
            :message="$t('Upgrades.the_feature_not_available')"
        />
    </div>
    <div class="d-flex h-100" v-else>
        <!-- LEFT SECTION -->
        <MainChatSidebarVue
            v-if="clientWidth > responseWidth"
            class="mainchatcomponent"
            :selectedChat="selectedChat"
            @selectedChat="onSelectedChat($event)"
            :projects="projects"
            :loadingChats="loadingChats"
            @loading="sidebarBusy = $event"
        />
        <Sidebar v-else v-model:visible="visible" title="Chats" :left="true" width="395px" :unMount="false" :hideHeader="true">
            <template #body>
                <MainChatSidebarVue
                    :selectedChat="selectedChat"
                    @selectedChat="onSelectedChat($event)"
                    :projects="projects"
                    @hide="visible = !visible"
                    :loadingChats="loadingChats"
                    @loading="sidebarBusy = $event"
                />
            </template>
        </Sidebar>
        <!-- RIGHT SECTION -->
        <template v-if="allowChannelFeature">
            <div :style="`width: calc(100%${clientWidth > responseWidth ?' - 350px' : ''});`">
                <!-- Legacy conversation header. The new module renders its own
                     (MainChatHeader), so this must stay hidden when v2 is active or
                     the page shows two stacked headers. -->
                <div class="border-bottom d-flex align-items-center justify-content-between selected__chat-div  p0x-10px" v-if="!useNewChatUI && (selectedChat?.id || loadingChats)">
                    <template v-if="!loadingChats">
                        <div class="d-flex">
                            <img :src="sidebarArrowIcon" alt="sidebarArrowIcon" @click="visible =! visible" v-if="clientWidth <= responseWidth" class="mr-10px">
                            <div class="d-flex" v-if="selectedProject.default">
                                <div class="d-flex align-items-center">
                                    <UserProfile
                                        :data="{title: getUser(selectedChat.receiverId)?.Employee_Name, image: getUser(selectedChat.receiverId)?.Employee_profileImageURL}"
                                        width="30px"
                                        :thumbnail="'30x30'"
                                        :showDot="false"
                                    />
                                </div>
                                <div class="d-flex flex-column ml-10px">
                                    <span class="font-size-14 font-weight-700 gray63 selectedchat__empname">{{getUser(selectedChat.receiverId).Employee_Name}}</span>
                                    <span class="font-size-12 font-wight-400 dark-gray2 selected__chat-last">{{selectedChat?.lastMessage ? convertDateFormat(selectedChat?.lastMessage) : ""}}</span>
                                </div>
                            </div>
                            <div class="d-flex" v-else>
                                <div class="d-flex align-items-center">
                                    #
                                </div>
                                <div class="d-flex align-items-center flex-row">
                                    <WasabiImage v-if="selectedChat?.type == 'image'" :data="{url: selectedChat.url}" class="profile-sm-square m0px-5px"/>
                                    <FontAwesomeIcon v-if="selectedChat?.type == 'icon'" :icon="selectedChat" size="sm" class="w-20 m0px-5px"/>
                                    <span>{{selectedChat.name}}</span>
                                </div>
                            </div>
                        </div>
                        <div class="d-flex align-items-center">
                            <Assignee
                                v-if="selectedChat?.private"
                                :users="selectedChat?.AssigneeUserId || []"
                                :num-of-users="2"
                                :options="[...users, ...teams.map((x) => 'tId_'+x._id)]"
                                image-width="25px"
                                class="mr-15px"
                                @selected="changeAssignee('add', $event.id)"
                                @removed="changeAssignee('remove', $event.id)"
                                :isDisplayTeam="true"
                            />
                            <img class="cursor-pointer mr-15px" @click="isSidebar = true,sidebarTitle='files_links'" :src="fileLinkIcon" alt="fileLinkIcon">
                            <img class="cursor-pointer mr-15px" :src="searchIcon" alt="searchIcon" @click="toggleChatSidebar('search')">
                            <img class="cursor-pointer mr-15px" :src="pinIcon" alt="pinIcon" @click="toggleChatSidebar('pin')">
                            <img class="cursor-pointer mr-10px" @click="isSidebar = true,sidebarTitle='audio_files'" :src="audioIcon" alt="audioIcon">
                        </div>
                    </template>
                    <template v-else>
                        <div class="d-flex">
                            <Skelaton style="height: 30px; width: 30px;" class="mr-10px border-radius-50-per"/>
                            <Skelaton style="height: 30px; width: 150px;"/>
                        </div>
                    </template>
                </div>
                <template v-if="loadingChats">
                    <div class="bg-light-gray commments__component-wrapper position-re" :class="{'commments__component-wrapper--full': useNewChatUI}">
                        <div class="d-grid flex-column w-100">
                            <div class="d-flex w-100 pl-10px">
                                <div>
                                    <Skelaton style="height: 30px; width: 30px;" class="border-radius-50-per d-flex align-items-center mt-1 justify-self-start"/>
                                </div>
                                <div class="w-100 ml-10px">
                                    <Skelaton style="height: 40px; width: 10%;" class="border-radius-5-px d-flex align-items-center mt-1 justify-self-start"/>
                                    <Skelaton style="height: 40px; width: 25%;" class="border-radius-5-px d-flex align-items-center mt-5px justify-self-start"/>
                                </div>
                            </div>
                            <Skelaton style="height: 40px; width: 50%;" class="border-radius-5-px d-flex align-items-center mr-10px mt-1 justify-self-end"/>
                            <Skelaton style="height: 40px; width: 10%;" class="border-radius-5-px d-flex align-items-center mr-10px mt-5px justify-self-end"/>
                            <Skelaton style="height: 40px; width: 25%;" class="border-radius-5-px d-flex align-items-center mr-10px mt-5px justify-self-end"/>
                            <div class="d-flex w-100 pl-10px">
                                <div>
                                    <Skelaton style="height: 30px; width: 30px;" class="border-radius-50-per d-flex align-items-center mt-1 justify-self-start"/>
                                </div>
                                <div class="w-100 ml-10px">
                                    <Skelaton style="height: 40px; width: 50%;" class="border-radius-5-px d-flex align-items-center mt-1 justify-self-start"/>
                                    <Skelaton style="height: 40px; width: 35%;" class="border-radius-5-px d-flex align-items-center mt-5px justify-self-start"/>
                                    <Skelaton style="height: 120px; width: 80%;" class="border-radius-5-px d-flex align-items-center mt-5px justify-self-start"/>
                                </div>
                            </div>
                        </div>
                        <div class="position-ab" style="bottom: 0; width: 100%">
                            <Skelaton style="height: 70px; width: 100%;" class="border-radius-5-px d-flex align-items-center mt-1 justify-self-start"/>
                        </div>
                    </div>
                </template>
                <template v-else>
                    <div class="bg-light-gray commments__component-wrapper" :class="{'commments__component-wrapper--full': useNewChatUI}" v-if="selectedChat?.id && selectedProject?._id">
                        <!-- New Main Chat module (components/organisms/MainChat): owns the
                             chat UI on its own, separate from the shared Comments component
                             below (which task + project comments also use, and which is
                             deliberately left untouched). Opt in with
                             localStorage `alianhub.mainChatUI` = "v2". -->
                        <MainChatPanel
                            v-if="useNewChatUI && selectedChat?.id && !loadingChats"
                            :key="`mc_${selectedProject?._id}_${selectedChat?.id}`"
                            :taskId="selectedProject?.default ? selectedChat?.id : 'default'"
                            :sprintId="selectedProject?.default ? selectedChat?.sprintId : selectedChat?.id"
                            :newChat="selectedChat?.newChat || false"
                            :watchers="[...(selectedProject?.default ? (selectedChat.AssigneeUserId || []) : ((selectedChat?.private ? selectedChat?.AssigneeUserId : users) || []))]"
                            :isChannel="!selectedProject?.default"
                            :icon="selectedProject?.default ? {} : (selectedChat || {})"
                            :title="selectedProject?.default ? (getUser(selectedChat?.receiverId)?.Employee_Name || '') : (selectedChat?.name || '')"
                            :subtitle="selectedProject?.default ? '' : (selectedChat?.private ? $t('MainChat.private_channel') : '')"
                            :avatarSrc="selectedProject?.default ? (getUser(selectedChat?.receiverId)?.Employee_profileImageURL || '') : ''"
                            :sendMessageAllowed="sendMessageAllowed"
                            @created="onChatCreated"
                        />
                        <Comments
                            v-else-if="selectedChat?.id && !loadingChats"
                            :taskId="selectedProject?.default ? selectedChat?.id : 'default'"
                            :sprintId="selectedProject?.default ? selectedChat.sprintId : selectedChat?.id"
                            :userIds="[...(selectedProject?.default ? (selectedChat.AssigneeUserId || []) : ((selectedChat?.private ? selectedChat?.AssigneeUserId : users) || []))]"
                            :watchers="[...(selectedProject?.default ? (selectedChat.AssigneeUserId || []) : ((selectedChat?.private ? selectedChat?.AssigneeUserId : users) || []))]"
                            :mainChat="true"
                            :newChat="selectedChat?.newChat || false"
                            :title="selectedProject.default ? getUser(userId)?.Employee_Name : selectedChat?.name"
                            :sendMessageAllowed="sendMessageAllowed"
                            :selectedChat="selectedChat"
                        />
                    </div>
                    <!-- Switching Chats <-> Channels clears the selection while the new
                         project's conversations resolve. Hold a neutral panel during
                         that window, otherwise the "welcome" screen flashes for a few
                         hundred ms as though the user had no chats at all. -->
                    <div v-else-if="chatPaneBusy" class="bg-light-gray w-100 h-100"></div>
                    <div v-else class="bg-light-gray flex-column d-flex align-items-center justify-content-center text-center w-100 h-100 position-re">
                        <div class="position-ab bg-white pl-15px pr-15px pt-10px pb-10px border-right-radius-5-px box-shadow-2" style="top: 10px; left: 0px;" v-if="!visible && clientWidth <= responseWidth">
                            <img :src="sidebarArrowIcon" alt="sidebarArrowIcon" @click="visible =! visible">
                        </div>
                        <img :src="noResultImage" alt="No Chats">
                        <h2>{{$t('Chat.welcome_message').replace('BRAND_NAME', brandSettings && brandSettings?.productName ? brandSettings.productName : 'Alian Hub')}}</h2>
                        <span class="nochat__text">{{$t('Chat.msg2')}}</span>
                    </div>
                </template>
            </div>
            <Sidebar
                v-if="isSidebar"
                className="task-sub-sidebar"
                v-model:visible="isSidebar"
                :title="$t(`Projects.${sidebarTitle}`)"
                width="375px"
            >
                <template #body>
                    <FileAndLinks
                        v-if="sidebarTitle === 'files_links'"
                        :handleType="'chat'"
                        @closeSidebar="(val) => isSidebar = val"
                        :selectedData="selectedProject?.default ? selectedChat : {id:'default',sprintId:selectedChat?.id,ProjectID:selectedProject?._id}"
                    />
                    <TaskAudioFiles
                        v-else-if="sidebarTitle === 'audio_files'"
                        :fromWhich="'chat'"
                        :key="`${selectedProject?._id}` + 'chats'"
                        :selectedData="selectedProject?.default ? selectedChat : {id:'default',sprintId:selectedChat?.id,ProjectID:selectedProject?._id}"
                    />
                </template>
            </Sidebar>
            <Sidebar
                v-if="chatSidebar"
                v-model:visible="chatSidebar"
                :title="`${$t(`PlaceHolder.${searchType}`)}`"
                width="375px"
            >
                <template #body>
                    <FilteredChats
                        :mainChat="true"
                        :searchOnMount="searchType !== 'Search'"
                        :projectId="selectedProject?.default ? selectedChat.ProjectID : selectedProject?._id"
                        :sprintId="selectedProject?.default ? selectedChat.sprintId : selectedChat?.id"
                        :taskId="selectedProject?.default ? selectedChat.id : 'default'"
                        :isPinnedMessage="selectedMessageType === 'pin' ? true : false"
                    />
                </template>
            </Sidebar>
        </template>
    </div>
</template>

<script setup>
// PACKAGES
import { computed, defineComponent, inject, onMounted, onUnmounted, provide, ref, watch } from "vue";
import { useConvertDate, useGetterFunctions,useCustomComposable } from "@/composable";
import { useRoute, useRouter } from "vue-router";
import {useMainChat} from "./helper"
import { useStore } from "vuex";
import { useToast } from "vue-toast-notification";
import FileAndLinks from '@/components/molecules/FileAndLinks/FileAndLinks.vue'
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";
// AHE-3834 — this view renders a channel FontAwesomeIcon in its header but never
// registered the icon packs; it silently relied on ChatListItem's side effect
// (so the header icon broke when no chat row had rendered yet). Register here too
// — the call is memoized, so it costs nothing after the first.
import { ensureFaIcons } from "@/utils/faIcons";
import UpgradePlan from '@/components/atom/UpgradYourPlanComponent/UpgradYourPlanComponent.vue';

// COMPONENTS
import MainChatSidebarVue from "@/components/organisms/MainChatSidebar/MainChatSidebar.vue";
import Sidebar from "@/components/molecules/Sidebar/Sidebar.vue"
import Skelaton from "@/components/atom/Skelaton/Skelaton.vue"
import Comments from '@/views/Projects/Comments/Comments.vue'
import MainChatPanel from '@/components/organisms/MainChat/MainChatPanel.vue'
import UserProfile from "@/components/atom/UserProfile/UserProfile.vue"
import Assignee from "@/components/molecules/Assignee/Assignee.vue"
import TaskAudioFiles from '@/components/molecules/TaskAudioFiles/TaskAudioFiles.vue'
import FilteredChats from "@/components/organisms/FilterChat/FilterChat.vue"
import WasabiImage from "@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue";
import * as env from '@/config/env';
import { apiRequest } from "../../services";
import { useI18n } from "vue-i18n";
const { t } = useI18n();

// UTILS
const clientWidth = inject("$clientWidth");
const responseWidth = 1200;
const companyId = inject("$companyId");
const userId = inject("$userId");
const {getUser} = useGetterFunctions();
const {convertDateFormat} = useConvertDate();
const {getters,commit} = useStore();
const route = useRoute();
const router = useRouter();
const $toast = useToast();
const {getProjects, dispatchChats} = useMainChat();
const {checkPermission} = useCustomComposable();
const allowChannelFeature = computed(() => currentPlan.value && currentPlan.value?.chanels);

const brandSettings = computed(() => getters['brandSettingTab/brandSettings']);

// IMAGES
const noResultImage = require("@/assets/images/svg/Artwork-updated.svg");
const searchIcon = require("@/assets/images/svg/serchIcon.svg");
const pinIcon = require("@/assets/images/svg/pinned_message.svg")
const sidebarArrowIcon = require("@/assets/images/svg/sidebarclose_arrow.svg");
const fileLinkIcon = require("@/assets/images/svg/Fileslinks.svg")
const audioIcon = require("@/assets/images/svg/audio.svg")

defineComponent({
    name: "chat-component",

    components: {
        MainChatSidebarVue,
        Sidebar,
        Comments
    }
})

// Register the FA icon packs used by the channel icon in this view's header.
ensureFaIcons();

const chatSidebar = ref(false);
const searchType = ref("");
const assigneeInProgress = ref(false);

const visible = ref(false);
const isSidebar = ref(false);
const selectedProject = ref({});
const selectedChat = ref(null);
const selectedMessageType = ref('search');
const projects = ref([]);
const snapRef = ref(null);
const loadingChats = ref(true);
// True while the sidebar is resolving a project's conversations.
const sidebarBusy = ref(false);
// True from the moment a tab switch clears the selection until something is
// selected again. `sidebarBusy` alone was not enough: setProject() nulls the
// selection synchronously, and the fetch that raises sidebarBusy only starts a
// few ticks later (route push -> watcher -> getSprintFolderData), so the welcome
// screen still flashed in that gap.
const switchingProject = ref(false);
let switchingTimer = null;

const chatPaneBusy = computed(() => loadingChats.value || sidebarBusy.value || switchingProject.value);

function onSelectedChat(chat) {
    selectedChat.value = chat;
    clearTimeout(switchingTimer);

    if (chat && chat.id) {
        switchingProject.value = false;
        return;
    }

    // Selection cleared -> a switch is in flight. The backstop matters: a project
    // with no conversations at all never selects anything, and the welcome screen
    // is the correct thing to show there — it must not be suppressed forever.
    switchingProject.value = true;
    switchingTimer = setTimeout(() => { switchingProject.value = false; }, 1500);
}

// New Main Chat surface (components/organisms/MainChat), reached from the header
// chat icon like any other chat route. Unread counts and push notifications are
// ported, so the recipient side behaves as before. Escape hatch, no rebuild
// needed, if anything looks off:
//     localStorage.setItem('alianhub.mainChatUI', 'legacy')  // previous UI
//     localStorage.removeItem('alianhub.mainChatUI')         // new UI
// Still to come: reactions, edit, pin, @-mention autocomplete, audio record and
// in-conversation search — the legacy surface remains mounted below for those.
const useNewChatUI = computed(() => {
    try {
        return localStorage.getItem('alianhub.mainChatUI') !== 'legacy';
    } catch (error) {
        return true;
    }
});

// A brand-new one-to-one has no task until the first message creates it; point
// the route at the real conversation so a refresh lands in the same place.
function onChatCreated(taskId) {
    if (!taskId) return;
    selectedChat.value = { ...(selectedChat.value || {}), id: taskId, newChat: false };
    router.push({ ...route, params: { ...route.params, sid: taskId } });
}
const sidebarTitle = ref('');
const socket= inject("$socket");

// Members of a public channel. Deleted members are excluded at the source:
// settings/companyUsers keeps them (flagged isDelete), which is how removed people
// were turning up as channel members — and in the unread / notification fan-out
// this list also drives. isDelete is used rather than getUser().ghostUser because
// it carries no load-order hazard: ghostUser reads true for EVERYONE until the
// users store arrives, which would briefly empty the watcher list.
const users = computed(()=> (getters["settings/companyUsers"] || [])
    .filter((x) => x?.isDelete !== true)
    .map((x) => x.userId))
const teams = computed(() => getters["settings/teams"])
const currentPlan = computed(() => getters['settings/selectedCompany']?.planFeature);
const allowChatFeature = computed(() => currentPlan.value && currentPlan.value?.chat);

provide("selectedProject", selectedProject);
provide("selectedChat", selectedChat);

const mainChatProjectGetter = computed(() => getters["mainChat/mainChatProjects"])

/* ------------------------------------------------------------------ *
 * One-to-one chat permission
 *
 * checkPermission returns the raw permission: true = Read & Write, false = Read,
 * null/undefined = None (and always true for Owner/Admin).
 *
 * Read used to be indistinguishable from None here — anything other than `true`
 * filtered the direct-message project out entirely, so a role granted Read lost the
 * Chats tab completely. Read now means what it says: the conversations are visible,
 * but the composer is closed.
 * ------------------------------------------------------------------ */
const oneToOnePermission = computed(() => checkPermission('chat.one_to_one_chat'));
const canViewDirectMessages = computed(() => oneToOnePermission.value === true || oneToOnePermission.value === false);
const canSendDirectMessages = computed(() => oneToOnePermission.value === true);

provide("canSendDirectMessages", canSendDirectMessages);

/** Chat projects this user may see: the DM project is dropped only on None. */
function visibleChatProjects(list) {
    const projectList = list || [];
    return (canViewDirectMessages.value ? projectList : projectList.filter((e) => e.default === false)) || [];
}

/**
 * May the current user post in the open conversation?
 *
 * Direct messages answer to the one-to-one permission; a channel answers to its own
 * "members may send messages" flag, which is unchanged.
 */
const sendMessageAllowed = computed(() => {
    if (selectedProject.value?.default) return canSendDirectMessages.value;
    if (selectedChat.value?.sendMessage !== false) return true;

    // The switch reads "Allows MEMBERS to send messages in this channel", so Owner and
    // Admin keep posting rights — otherwise an owner turning it off silences themselves
    // too, which is what makes the setting look broken.
    //
    // Only roleType 1 (Owner) and 2 (Admin) are fixed. The shared comment component
    // also lists 7, but roles beyond 3 are company-created and 7 means something
    // different in every company, so it is deliberately not copied here.
    const roleType = getters['settings/companyUserDetail']?.roleType;
    return roleType === 1 || roleType === 2;
});

onMounted(() => {
    if(mainChatProjectGetter.value?.data?.length) {
        projects.value = visibleChatProjects(mainChatProjectGetter.value?.data);
        initalProcess(true);
    } else {
        handleSnapshot();
    }

    if(clientWidth.value < responseWidth) {
        if(visible.value === false) {
            visible.value = true;
        }
    }
})

watch(mainChatProjectGetter, (newVal, oldVal) => {
    if(newVal?.data?.length && JSON.stringify(newVal) !== JSON.stringify(oldVal)) {
        projects.value = visibleChatProjects(newVal?.data);
        initalProcess();
    }
})


const socketConnectionPromise = new Promise((resolve) => {
    setTimeout(()=> {
        let attempts = 0;
        const maxAttempts = 3;
        const checkSocketConnection = setInterval(() => {
            if (socket.value && socket.value.id) {
                clearInterval(checkSocketConnection);
                resolve();
            } else if (attempts >= maxAttempts) {
                clearInterval(checkSocketConnection);
                resolve();
            }
            attempts++;
        }, 1000);
    })
});

async function initalProcess(inital = false) {
    if(projects.value.length) {
        selectProject();
    }

    projects.value.forEach((x) => {
        if(Object.keys(x?.sprintsfolders || {}).length) {
            x.sprintsfolders = Object.values(x?.sprintsfolders)?.sort((a, b) => a?.name?.trim()?.toLowerCase() > b?.name?.trim()?.toLowerCase() ? 1 : -1)

            Object.keys(x?.sprintsfolders).forEach((fid) => {
                if(Object.values(x.sprintsfolders?.[fid]?.sprintsObj || {}).length) {
                    x.sprintsfolders[fid].sprintsObj = Object.values(x.sprintsfolders[fid].sprintsObj)?.sort((a, b) => a?.name?.trim()?.toLowerCase() > b?.name?.trim()?.toLowerCase() ? 1 : -1)
                }
            })
        }
    })
    
    let defaultProject = projects.value.find((x) => x?.default)
    if(defaultProject) {
        if(inital) {
            loadingChats.value = true;
        }
        await socketConnectionPromise
        dispatchChats(defaultProject._id, Object.keys(defaultProject.sprintsObj || {})?.[0])
        .then(() => {
            loadingChats.value = false;
        })
        .catch((error) => {
            loadingChats.value = false
            console.error("ERROR in get chats: ", error);
        })
    } else {
        loadingChats.value = false;
    }
}

onUnmounted(() => {
    clearTimeout(switchingTimer);
    if(snapRef.value && snapRef.value !== null) {
        snapRef.value();
    }
    commit("mainChat/setChatPayload",{});
    // AHE-3834 — guard: on a dropped/never-established socket this threw on unmount.
    if(!socket.value || !socket.value.id) return;
    socket.value.emit('getRoomList', socket.value.id, (rooms) => {
        let chatRooms = rooms.filter((x)=> x.includes('chat_'));
        if (chatRooms.length) {
            const events = ['chatTaskInsert', 'chatTaskUpdate','chatTaskDelete','chatTaskReplace'];
            events.forEach(event => {
                socket.value.off(event);
            });
            chatRooms.forEach((ele)=>{
                socket.value.emit('leaveChats',ele);
            })
        }
    });
})

watch([route, projects], () => {
    selectProject();
})

function selectProject() {
    try {
        if(!projects.value.length) return;

        let urlPid = route.params.pid;
        let project = null;

        if(urlPid) {
            project = projects.value.find((x) => x._id === urlPid) || projects.value[0]
        } else {
            project = projects.value[0];
        }

        if(!project) return;
        // UPDATE SELECTED PROJECT
        selectedProject.value = JSON.parse(JSON.stringify(project));
    } catch (error) {
        console.error("ERROR: ", error);
    }
}

// GET MAIN CHATS FROM PROJECTS
function handleSnapshot() {
    getProjects()
    .catch((error) => {
        console.error("ERROR in get chats: ", error);
    })
}

// CHANGE ASSIGNEE OF PRIVATE CHANNELS
function changeAssignee(type, uid) {
    if(assigneeInProgress.value) return;
    assigneeInProgress.value = true;

    let updateData = {};
    if(type === "add") {
        if(!selectedChat.value?.AssigneeUserId.includes(uid)) {
            updateData.$addToSet = {
                'AssigneeUserId': uid,
                'watchers': uid
            }
        }
    } else {
        if(selectedChat.value?.AssigneeUserId.includes(uid)) {
            updateData.$pull = {
                AssigneeUserId: uid,
                watchers: uid
            }

            if(selectedChat.value?.AssigneeUserId?.length === 1) {
                updateData.$set = {
                    private: false
                }
            }
        }
    }

    if(updateData) {
        try {
            apiRequest("patch", `${env.SPRINT}/${selectedChat.value.id}`, {
                companyId: companyId.value,
                projectId: selectedProject.value._id,
                folderId: selectedChat.value.folderId || "",
                type: "updateSprint",
                updateObject: updateData,
                mainChat: true
            })
            .then((resp) => {
                commit('mainChat/mutateChatSprints', {op: "modified", data: resp.data.data});
                if(resp.data.status) {
                    $toast.success(t(`Toast.Assignee ${type === "add" ? 'added' : 'removed'} successfully`), {position: "top-right"})
                }
                assigneeInProgress.value = false;
            })
            .catch((error) => {
                console.error('ERROR in update assignee: ', error);
                $toast.error(t('Toast.something_went_wrong'),{position: 'top-right'})
                assigneeInProgress.value = false;
            })
        } catch (error) {
            $toast.error(t('Toast.something_went_wrong'),{position: 'top-right'})
            console.error('ERROR in update assignee: ', error);
            assigneeInProgress.value = false;
        }
    } else {
        assigneeInProgress.value = false;
    }
}

function toggleChatSidebar(type = '') {
    if(!type) return;
    chatSidebar.value = !chatSidebar.value;
    selectedMessageType.value = type;
    searchType.value = type === 'search' ? 'Search' : 'Pinned_messages';
}


</script>

<style scoped>
.mainchatcomponent{
    /* fixed 350px, matching the right-hand details pane. Both panes must agree
       with the conversation column's calc() below or the layout drifts. */
    flex: 0 0 350px;
    width: 350px;
    max-width: 350px;
}
.selected__chat-div{
    height: 50px;
}
.selectedchat__empname{
    line-height: 23px;
}
.selected__chat-last{
    line-height:18px;
}
.commments__component-wrapper{
    height: calc(100% - 51px);
}
/* The 51px above is the legacy conversation header's allowance. The new module
   renders its own header INSIDE the panel, so subtracting it there left an empty
   strip below the composer. */
.commments__component-wrapper--full{
    height: 100%;
}
.nochat__text{
    max-width: 496px;
}
.plan-upgrade-massage {
    position: absolute;
    top: 50%;
    left: 40%;
}
</style>