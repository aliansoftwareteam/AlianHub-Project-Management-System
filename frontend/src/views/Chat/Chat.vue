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
            @selectedChat="selectedChat = $event"
            :projects="projects"
            :loadingChats="loadingChats"
        />
        <Sidebar v-else v-model:visible="visible" title="Chats" :left="true" width="395px" :unMount="false" :hideHeader="true">
            <template #body>
                <MainChatSidebarVue
                    :selectedChat="selectedChat"
                    @selectedChat="selectedChat = $event"
                    :projects="projects"
                    @hide="visible = !visible"
                    :loadingChats="loadingChats"
                />
            </template>
        </Sidebar>
        <!-- RIGHT SECTION -->
        <template v-if="allowChannelFeature">
            <div :style="`width: calc(100%${clientWidth > responseWidth ?' - 400px' : ''});`">
                <div class="border-bottom d-flex align-items-center justify-content-between selected__chat-div  p0x-10px" v-if="selectedChat?.id || loadingChats">
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
                    <div class="bg-light-gray commments__component-wrapper position-re">
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
                    <div class="bg-light-gray commments__component-wrapper" v-if="selectedChat?.id && selectedProject?._id">
                        <Comments
                            v-if="selectedChat?.id && !loadingChats"
                            :taskId="selectedProject?.default ? selectedChat?.id : 'default'"
                            :sprintId="selectedProject?.default ? selectedChat.sprintId : selectedChat?.id"
                            :userIds="[...(selectedProject?.default ? (selectedChat.AssigneeUserId || []) : ((selectedChat?.private ? selectedChat?.AssigneeUserId : users) || []))]"
                            :watchers="[...(selectedProject?.default ? (selectedChat.AssigneeUserId || []) : ((selectedChat?.private ? selectedChat?.AssigneeUserId : users) || []))]"
                            :mainChat="true"
                            :newChat="selectedChat?.newChat || false"
                            :title="selectedProject.default ? getUser(userId)?.Employee_Name : selectedChat?.name"
                            :sendMessageAllowed="selectedChat?.sendMessage == false ? false : true"
                            :selectedChat="selectedChat"
                        />
                    </div>
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
import { useRoute } from "vue-router";
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
const sidebarTitle = ref('');
const socket= inject("$socket");

const users = computed(()=> getters["settings/companyUsers"]?.map((x) => x.userId))
const teams = computed(() => getters["settings/teams"])
const currentPlan = computed(() => getters['settings/selectedCompany']?.planFeature);
const allowChatFeature = computed(() => currentPlan.value && currentPlan.value?.chat);

provide("selectedProject", selectedProject);
provide("selectedChat", selectedChat);

const mainChatProjectGetter = computed(() => getters["mainChat/mainChatProjects"])

onMounted(() => {
    if(mainChatProjectGetter.value?.data?.length) {
        projects.value = (checkPermission('chat.one_to_one_chat') === true ? mainChatProjectGetter.value?.data : mainChatProjectGetter.value?.data.filter((e)=>e.default === false)) || [];
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
        projects.value = (checkPermission('chat.one_to_one_chat') === true ? newVal?.data : newVal?.data.filter((e)=>e.default === false)) || [];
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
    max-width: 400px;
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
.nochat__text{
    max-width: 496px;
}
.plan-upgrade-massage {
    position: absolute;
    top: 50%;
    left: 40%;
}
</style>