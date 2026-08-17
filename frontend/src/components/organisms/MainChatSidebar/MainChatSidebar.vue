<template>
    <!--
      Main Chat conversation pane (left column of the 3-pane layout).

      The TEMPLATE was rebuilt to the new layout; the script block below is the
      original and untouched, so every existing behaviour still runs through the
      same code: project switching (setProject), conversation selection
      (setActiveChat) with its route sync, the category/channel tree, favourites,
      search, and the create-category / create-channel flows.
    -->
    <div class="mcs">
        <!-- workspace + overflow actions -->
        <header class="mcs-top">
            <button
                v-if="clientWidth <= 1200"
                type="button"
                class="mcs-icon"
                :title="$t('MainChat.cancel')"
                @click="$emit('hide')"
            >
                <img :src="sidebarArrowIcon" alt="" />
            </button>

            <span class="mcs-workspace" :title="currentCompanyName">
                <template v-if="currentCompanyImage">
                    <img v-if="currentCompanyImage?.includes('http')" :src="currentCompanyImage" :alt="currentCompanyName" />
                    <WasabiImageComp
                        v-else
                        :data="{url: currentCompanyImage, filename: currentCompanyImage.split('/').pop(), extension: currentCompanyImage.split('/').pop().split('.').pop()}"
                    />
                </template>
                <template v-else>{{ (currentCompanyName || '?').charAt(0).toUpperCase() }}</template>
            </span>

            <span class="mcs-workspace-name">{{ currentCompanyName }}</span>

            <DropDown
                v-if="selectedProject?._id && !selectedProject?.default && canManageCategory"
                :title="selectedProject.ProjectName"
                class="mcs-top-menu"
            >
                <template #button>
                    <button ref="createChannelBtn" type="button" class="mcs-icon" :title="$t('Category.create_category')">
                        <img src="@/assets/images/svg/horizontalDots.svg" alt="" />
                    </button>
                </template>
                <template #options>
                    <DropDownOption @click="$refs.createChannelBtn.click(), showCreateCategory = true">
                        <div class="d-flex align-items-center project-mobile-desc">
                            <img :src="createCategory" alt="" class="mr-10px" />
                            {{ $t('Category.create_category') }}
                        </div>
                    </DropDownOption>
                </template>
            </DropDown>
        </header>

        <!-- one tab per chat project: Chats (direct) + each channel workspace -->
        <nav class="mcs-tabs" v-if="projects.length > 1">
            <button
                v-for="project in projects"
                :key="project._id"
                type="button"
                class="mcs-tab"
                :class="{ 'mcs-tab--on': selectedProject._id === project._id }"
                @click="setProject(project)"
            >
                <span class="mcs-tab-label">{{ project?.default ? $t('Chat.chats') : $t('MainChat.channels') }}</span>
                <span v-if="checkAllCount(project)" class="mcs-count">{{ checkAllCount(project) > 99 ? '+99' : checkAllCount(project) }}</span>
            </button>
        </nav>

        <!-- search — the placeholder names the field each tab actually matches on
             (people's names vs channel + category names), so "Search here…" no
             longer leaves the user guessing what will be found -->
        <div class="mcs-search" v-if="selectedProject?.default ? allowOneToOneChatFeature : allowChannelFeature">
            <InputText
                v-model="searchChat"
                :placeholder="`${selectedProject?.default ? $t('MainChat.search_people') : $t('MainChat.search_channels')}...`"
                class="mcs-search-input"
                :isOutline="false"
            />
        </div>

        <!-- list -->
        <div class="mcs-list style-scroll" v-if="!loadingChats">
            <!-- ============ CHANNELS ============ -->
            <template v-if="!selectedProject?.default">
                <div v-if="allowChannelFeature">
                    <template v-if="!loadingSprints">
                        <template v-if="category && Object.keys(category).length">
                            <TransitionGroup>
                                <div v-for="folder in category" :key="folder.folderId">
                                    <ChatListItem
                                        :key="folder.folderId"
                                        :item="folder"
                                        :active="Object.values(folder?.sprintsObj || {})?.map((x) => x?.id).includes(selectedChat?.id)"
                                        @click="(e) => e ? setActiveChat(e) : folder.isExpanded = !folder.isExpanded"
                                        @toggle="folder.isExpanded = !folder.isExpanded"
                                        type="category"
                                        :selectedProject="selectedProject"
                                        @edit="editChannel"
                                        @delete="confirmDeleteChannel"
                                    >
                                        <!-- Direct children of .mcs-item-trail (no wrapper), so the
                                             count and the menu sit on the same rhythm as a
                                             channel row's below. -->
                                        <template #options>
                                            <Transition>
                                                <span v-if="checkCount(folder)" class="mcs-badge">
                                                    {{ checkCount(folder) > 99 ? '+99' : checkCount(folder) }}
                                                </span>
                                            </Transition>
                                            <!-- Two permissions meet on this row: adding a channel
                                                 answers to chat_channel, renaming the category to
                                                 chat_category. Each option is gated on its own, and
                                                 the menu only appears if at least one is allowed. -->
                                            <DropDown :id="`category_${folder.folderId}`" :title="folder.name" v-if="canCreateChannel || canManageCategory" class="mcs-menu">
                                                <template #button>
                                                    <span :ref="`category_${folder.folderId}Ref`" class="mcs-menu-btn" :title="$t('MainChat.more')">
                                                        <MainChatIcon name="more" :size="16" />
                                                    </span>
                                                </template>
                                                <template #options>
                                                    <DropDownOption v-if="canCreateChannel" @click="$refs[`category_${folder.folderId}Ref`][0].click(), folderId=folder.folderId, showCreateChannel = true">
                                                        <span class="mcs-menu-item">{{$t('Category.create_channel')}}</span>
                                                    </DropDownOption>
                                                    <DropDownOption v-if="canManageCategory" @click="$refs[`category_${folder.folderId}Ref`][0].click(), editCategory(folder)">
                                                        <span class="mcs-menu-item">{{$t('Category.edit_category')}}</span>
                                                    </DropDownOption>
                                                </template>
                                            </DropDown>
                                        </template>
                                    </ChatListItem>
                                </div>
                            </TransitionGroup>
                        </template>
                        <p v-else class="mcs-empty">
                            {{ searchChat.trim() ? $t('MainChat.no_matches') : $t('Category.no_chat_found') }}
                        </p>
                    </template>
                    <div v-else class="mcs-skel">
                        <Skelaton v-for="i in 6" :key="i" style="height: 44px;" class="border-radius-8-px mb-6px" />
                    </div>
                </div>
                <UpgradePlan
                    v-else
                    :buttonText="$t('Upgrades.upgrade_your_plan')"
                    :lastTitle="$t('Upgrades.unlock_channel')"
                    :secondTitle="$t('Upgrades.unlimited')"
                    :firstTitle="$t('Upgrades.upgrade_to')"
                    :message="$t('Upgrades.the_feature_not_available')"
                />
            </template>

            <!-- ============ DIRECT MESSAGES ============ -->
            <template v-else>
                <template v-if="allowOneToOneChatFeature">
                    <template v-if="!loadingSprints">
                        <!-- favourites -->
                        <template v-if="favoritesFilter?.length">
                            <p class="mcs-group">{{ $t('Chat.favorites') }}</p>
                            <button
                                v-for="chat in sortedFavoriteChat"
                                :key="chat.id"
                                type="button"
                                class="mcs-row"
                                :class="{ 'mcs-row--on': chat.id === selectedChat?.id }"
                                @click="setActiveChat(chat)"
                            >
                                <MainChatAvatar :name="peerName(chat)" :src="peerImage(chat)" :size="34" />
                                <span class="mcs-row-main">
                                    <span class="mcs-row-name">{{ peerName(chat) }}</span>
                                    <span class="mcs-row-preview" v-html="previewOf(chat)"></span>
                                </span>
                                <span class="mcs-row-side">
                                    <span class="mcs-row-time">{{ chat?.lastMessage ? convertDateFormat(chat.lastMessage) : '' }}</span>
                                    <span v-if="unreadOf(chat)" class="mcs-badge">{{ unreadOf(chat) > 99 ? '+99' : unreadOf(chat) }}</span>
                                </span>
                            </button>
                        </template>

                        <!-- conversations -->
                        <p class="mcs-group">{{ $t('Chat.chats') }}</p>
                        <template v-if="chatsFilter?.length">
                            <button
                                v-for="chat in sortedChat"
                                :key="chat.id"
                                type="button"
                                class="mcs-row"
                                :class="{ 'mcs-row--on': chat.id === selectedChat?.id }"
                                @click="setActiveChat(chat)"
                            >
                                <MainChatAvatar :name="peerName(chat)" :src="peerImage(chat)" :size="34" />
                                <span class="mcs-row-main">
                                    <span class="mcs-row-name">{{ peerName(chat) }}</span>
                                    <span class="mcs-row-preview" v-html="previewOf(chat)"></span>
                                </span>
                                <span class="mcs-row-side">
                                    <span class="mcs-row-time">{{ chat?.lastMessage ? convertDateFormat(chat.lastMessage) : '' }}</span>
                                    <span v-if="unreadOf(chat)" class="mcs-badge">{{ unreadOf(chat) > 99 ? '+99' : unreadOf(chat) }}</span>
                                </span>
                            </button>
                        </template>
                        <p v-else class="mcs-empty">{{ $t('Category.no_chat_found') }}</p>

                        <!-- people you haven't messaged yet — only when you could
                             actually start one (see canSendDirectMessages) -->
                        <template v-if="usersFilter?.length && canSendDirectMessages">
                            <p class="mcs-group">{{ $t('UserTimesheet.users') }}</p>
                            <button
                                v-for="user in usersFilter"
                                :key="user.id"
                                type="button"
                                class="mcs-row"
                                :class="{ 'mcs-row--on': user.id === selectedChat?.id }"
                                @click="setActiveChat(user)"
                            >
                                <MainChatAvatar :name="user.name" :src="peerImage(user)" :size="34" />
                                <span class="mcs-row-main">
                                    <span class="mcs-row-name">{{ user.name }}</span>
                                    <span class="mcs-row-preview mcs-row-preview--muted">{{ $t('MainChat.start_conversation') }}</span>
                                </span>
                            </button>
                        </template>
                    </template>
                    <div v-else class="mcs-skel">
                        <Skelaton v-for="i in 7" :key="i" style="height: 48px;" class="border-radius-8-px mb-6px" />
                    </div>
                </template>
                <UpgradePlan
                    v-else
                    :buttonText="$t('Upgrades.upgrade_your_plan')"
                    :lastTitle="$t('Upgrades.unlock_one_chat')"
                    :secondTitle="$t('Upgrades.unlimited')"
                    :firstTitle="$t('Upgrades.upgrade_to')"
                    :message="$t('Upgrades.the_feature_not_available')"
                />
            </template>
        </div>

        <div class="mcs-list mcs-skel" v-else>
            <Skelaton v-for="i in 7" :key="i" style="height: 48px;" class="border-radius-8-px mb-6px" />
        </div>

        <CreateCategorySidebar v-if="showCreateCategory" v-model:visible="showCreateCategory"/>
        <CreateChannelSidebar v-if="showCreateChannel"  v-model:visible="showCreateChannel" :folder="Object.values(selectedProject?.sprintsfolders || {})?.find((x) => x?.folderId === folderId)"/>
        <EditChannelSidebar v-if="showEditChannel" v-model:visible="showEditChannel" :channel="editingChannel" @saved="onChannelSaved"/>
        <EditCategorySidebar v-if="showEditCategory" v-model:visible="showEditCategory" :category="editingCategory" @saved="onCategorySaved"/>
    </div>
</template>


<script setup>
// PACKAGES
import isEqual from "lodash/isEqual";
import { useRoute, useRouter } from "vue-router";
import { useToast } from "vue-toast-notification";
import { useI18n } from "vue-i18n";
import Swal from "sweetalert2";
import { computed, defineEmits, defineProps, inject, nextTick, onMounted, ref, watch, watchEffect } from "vue"

// COMPONENT
import InputText from "@/components/atom/InputText/InputText.vue"
import WasabiImageComp from "@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue"
import ChatListItem from "@/components/atom/ChatListItem/ChatListItem.vue"
import MainChatAvatar from "@/components/organisms/MainChat/MainChatAvatar.vue"
import MainChatIcon from "@/components/organisms/MainChat/MainChatIcon.vue"
import DropDown from '@/components/molecules/DropDown/DropDown.vue'
import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue'
import CreateChannelSidebar from '@/components/organisms/CreateChannelSidebar/CreateChannelSidebar.vue'
import CreateCategorySidebar from '@/components/organisms/CreateCategorySidebar/CreateCategorySidebar.vue'
import EditChannelSidebar from '@/components/organisms/EditChannelSidebar/EditChannelSidebar.vue'
import EditCategorySidebar from '@/components/organisms/EditCategorySidebar/EditCategorySidebar.vue'
import Skelaton from "@/components/atom/Skelaton/Skelaton.vue"
import { useConvertDate, useCustomComposable, useGetterFunctions } from "@/composable";
import { useStore } from "vuex";
import UpgradePlan from '@/components/atom/UpgradYourPlanComponent/UpgradYourPlanComponent.vue';
import * as env from '@/config/env';
import { apiRequest } from "@/services";

// UTILS
const clientWidth = inject("$clientWidth");
const companyId = inject("$companyId");
const userId = inject("$userId");
const selectedProject = inject("selectedProject");
const {getters, dispatch, commit} = useStore();
const {debounce, checkPermission, changeText} = useCustomComposable();
const {getUser} = useGetterFunctions();
const {convertDateFormat} = useConvertDate()
const { t } = useI18n();

const router = useRouter()
const route = useRoute()
const $toast = useToast();

// IMAGES
const createCategory = require("@/assets/images/png/add_category.png");
const sidebarArrowIcon = require("@/assets/images/svg/sidebarclose_arrow.svg");
// const triangleBlack = require("@/assets/images/svg/triangleBlack.svg");

// EMITS
const emit = defineEmits(["hide", "selectedChat", "loading"])

const props = defineProps({
    selectedChat: {
        type: Object,
        default: () => {}
    },
    projects: {
        type: Array,
        default: () => []
    },
    loadingChats: {
        type: Boolean,
        default: false
    }
})

const myCounts = computed(() => getters["users/myCounts"]?.data || {})
const currentCompanyImage = computed(() => getters['settings/companies'].find((x) => x._id === companyId.value)?.Cst_profileImage || null)
const currentCompanyName = computed(() => getters['settings/companies'].find((x) => x._id === companyId.value)?.Cst_CompanyName || null)

const companyUserDetail = computed(() => getters['settings/companyUserDetail'])
const chatsGetters = computed(() => JSON.parse(JSON.stringify(getters["mainChat/chats"]?.data)));

/**
 * Is this user still an active member of the company?
 *
 * getUser() flags two cases as `ghostUser`: an id that is no longer in the users
 * store at all (name falls back to the literal "Ghost User"), and a company user
 * marked isDelete — whose name is replaced by their email address, which is why
 * removed people were showing up in chat as raw addresses. Neither belongs in any
 * chat list. Same test the rest of the app uses (Assignee, TaskFilter, …).
 */
function isActiveUser(id) {
    if (!id) return false;
    // Until the users store has loaded, getUser() reports EVERYONE as a ghost.
    // Filtering then would empty the whole chat list and clear the selection, so
    // hold off while there is nothing to check against.
    if (!(getters["users/users"] || []).length) return true;
    return !(getUser(id) || {}).ghostUser;
}

const usersGetter = computed(() => {
    return getters["users/users"].map((x) => ({
        name: x.Employee_Name,
        id: x._id,
        AssigneeUserId: [x._id],
        newUser: true,
        receiverId: x._id
    })).filter((x) => {
        return x.id !== userId.value && isActiveUser(x.id) && !chatsGetters.value.filter((y) => y.AssigneeUserId.filter((z) => x.AssigneeUserId.includes(z)).length).length
    })
});
const currentPlan = computed(() => getters['settings/selectedCompany']?.planFeature);
const allowChannelFeature = computed(() => currentPlan.value && currentPlan.value?.chanels);
const allowOneToOneChatFeature = computed(() => currentPlan.value && currentPlan.value?.oneToOneChat);

/*
 * Write access to categories and channels. "Create" carries edit and delete with it:
 * renaming or removing is a lesser act than adding, and there is no separate key for
 * either. Computed rather than called inline so the check does not re-run per row on
 * every render.
 */
const canManageCategory = computed(() => checkPermission('chat.chat_category') === true);
const canCreateChannel = computed(() => checkPermission('chat.chat_channel') === true);

// Read on one-to-one chat means visible but not writable, so someone who cannot post
// should not be offered a person to start a new conversation with — the composer
// would just be closed. Provided by Chat.vue.
const canSendDirectMessages = inject("canSendDirectMessages", computed(() => true));

const folderId = ref(null);
const searchChat = ref("");
const showCreateChannel = ref(false);
const showCreateCategory = ref(false);
const showEditChannel = ref(false);
const editingChannel = ref({});
const showEditCategory = ref(false);
const editingCategory = ref({});
const usersFilter = ref([]);
const chats = ref([]);
const chatsFilter = ref([]);
const favorites = ref([]);
const favoritesFilter = ref([]);
const category = ref([]);

const loadingSprints = ref(false);
// Surface the load state so the conversation pane can hold a neutral placeholder
// instead of flashing the "no chats" welcome screen while a project's channels
// are still being resolved (switching Chats <-> Channels nulls the selection).
watch(loadingSprints, (value) => emit('loading', value), { immediate: true });
const sprintFolders = ref({});
const sprintData = ref([]);
const folderData = ref([]);

const users = ref(usersGetter.value || []);
watchEffect(() => {
    const val = usersGetter.value.filter((x) => !chatsFilter.value.length || chatsFilter.value.filter((y) => !y.AssigneeUserId.includes(x.id)).length)
    users.value = val;
})

const sortedChat = computed(() => {
    let chats = chatsFilter.value;
    let lastUpdate = chats.filter((x) => x?.lastMessage)?.sort((a, b) => new Date(a.lastMessage) > new Date(b.lastMessage) ? -1 : 1)
    let nameSorted = chats.filter((x) => !x?.lastMessage)?.sort((a, b) => a?.TaskName?.trim()?.toLowerCase() > b?.TaskName?.trim()?.toLowerCase() ? 1 : -1)

    return [...lastUpdate, ...nameSorted]
})
const sortedFavoriteChat = computed(() => {
    let chats = favoritesFilter.value;
    let lastUpdate = chats.filter((x) => x?.lastMessage)?.sort((a, b) => new Date(a.lastMessage) > new Date(b.lastMessage) ? -1 : 1)
    let nameSorted = chats.filter((x) => !x?.lastMessage)?.sort((a, b) => a?.TaskName?.trim()?.toLowerCase() > b?.TaskName?.trim()?.toLowerCase() ? 1 : -1)

    return [...lastUpdate, ...nameSorted]
})

function checkAllCount(project) {
    let total = 0;

    Object.keys(myCounts.value || {}).forEach((key) => {
        if(key.includes(`task_${project._id}`)) {
            total += myCounts.value[key];
        }
    })

    return total;
}

function separateFav() {
    let channelId = route.params.sid;

    let channel = null;
    let sprints = [];

    if(selectedProject.value?.default) {
        sprints = JSON.parse(JSON.stringify(chatsGetters.value))

        if(!sprints.length) {
            chats.value = [];
            favorites.value = [];
        }

        // MAP _id to id for created chats and selection
        sprints = sprints.map((x) => {
            x.id = x._id;
            return x;
        })

        // Drop conversations whose other participant has left the company. Filtered
        // HERE rather than in the list markup so a removed person's chat can also
        // never be auto-selected below.
        sprints = sprints.filter((x) => isActiveUser(peerIdOf(x)));
    } else {
        Object.values(selectedProject.value?.sprintsfolders || {}).forEach((folder) => {
            Object.values(folder?.sprintsObj || {}).forEach((sprint) => {
                if(companyUserDetail.value.roleType !== 1 && companyUserDetail.value.roleType !== 2 && sprint.private) {
                    if(sprint.AssigneeUserId.includes(userId.value)) {
                        sprints.push(sprint)
                    }
                } else {
                    sprints.push(sprint)
                }
            })
        })
        setCategories()
    }
    if(!channelId && !sprints.length) {
        emit('selectedChat', null);
        if(usersFilter.value.findIndex((x) => x.id === channelId) !== -1) {
            let userIndex = usersFilter.value.findIndex((x) => x.id === channelId)
            if(userIndex !== -1) {
                let sprint = Object.values(selectedProject.value?.sprintsObj)?.[0]
                emit('selectedChat', {...usersFilter.value[userIndex], sprintId: sprint?._id, newChat: true});
            }
        } else if(route.name === "chat_project_channel") {
            // $toast.error(`You don't have access to the requested chat`, {position: "top-right"});
            router.push({name: "chats", params: {cid: companyId.value}});
        }
        return; // NO SPRINTS
    }

    if(channelId) {
        channel = sprints.find((x) => (selectedProject.value?.default ? x._id : x.id) === channelId)
    }

    let foundChat = null;
    if(channel) {
        const receiverId = channel?.AssigneeUserId?.filter((x) => x !== userId.value)[0];
        emit('selectedChat', {...channel, receiverId});
        foundChat = {...channel, receiverId};
    } else if(usersFilter.value.findIndex((x) => x.id === channelId) !== -1) {
        let userIndex = usersFilter.value.findIndex((x) => x.id === channelId)
        if(userIndex !== -1) {
            let sprint = Object.values(selectedProject.value?.sprintsObj)?.[0]
            const obj = {...usersFilter.value[userIndex], sprintId: sprint?._id, newChat: true}
            emit('selectedChat', obj);
            foundChat = obj;
        }
    } else {
        if(!channelId || (sprints?.length && channelId && !foundChat)) {
            if(!channel && channelId) {
                // $toast.error(`You don't have access to the requested chat`, {position: "top-right"});
            }
            if(sprints.length) {
                let selectChat = {};
                if(selectedProject.value?.default) {
                    let lastMessaged = sprints?.filter((x) => x.lastMessage)
                    lastMessaged = lastMessaged.sort((a,b) => new Date(a.lastMessage) > new Date(b.lastMessage) ? -1 : 1);

                    if(lastMessaged?.length) {
                        selectChat = lastMessaged[0]
                    } else {
                        selectChat = sprints[0];
                    }
                } else {
                    selectChat = sprints[0];
                }
                setActiveChat(selectChat);
            } else {
                if(selectedProject.value?._id) {
                    router.push({name: "chat_project", params: {cid: companyId.value, pid: props?.selectedProject?._id || ""}});
                } else {
                    router.push({name: "chats", params: {cid: companyId.value}});
                }
            }
        }
    }

    if(selectedProject.value?.default) {
       setOntToOne(sprints)
    } else {
        setCategories();
    }
}

function setOntToOne(sprints) {
    usersFilter.value = users.value;

    sprints = sprints.map((x) => {
        let receiverId = x?.AssigneeUserId?.filter((x) => x !== userId.value)[0];
        x.TaskName = getUser(receiverId)?.Employee_Name;

        let ind = users.value.findIndex((y) => y.receiverId === receiverId);
        if(ind !== -1) {
            users.value.splice(ind, 1);
        }
        return x;
    })

    sprints = sprints?.sort((a, b) => a?.TaskName?.trim()?.toLowerCase() > b?.TaskName?.trim()?.toLowerCase() ? 1 : -1);

    sprints.filter((x) => x?.favouriteTasks?.filter((x) => x !== userId.value).length || true).forEach((sprint) => {
        let chatIndex = chats.value.findIndex((x) => x.id === sprint.id);

        if(chatIndex !== -1) {
            chats.value[chatIndex] = {...sprint}
        } else {
            chats.value.push(sprint)
        }
    })

    sprints.filter((x) => x?.favouriteTasks?.filter((x) => x === userId.value).length).forEach((sprint) => {
        let chatIndex = favorites.value.findIndex((x) => x.id === sprint.id);

        if(chatIndex !== -1) {
            favorites.value[chatIndex] = {...sprint}
        } else {
            favorites.value.push(sprint)
        }
    })
}

/**
 * Does a category / channel name match what is typed in the search box?
 *
 * An empty box matches everything, which is what keeps the unsearched tree
 * byte-for-byte identical to before search was wired up for channels.
 */
function matchesSearch(name) {
    const term = searchChat.value.trim().toLowerCase();
    if(!term) return true;
    return String(name || "").toLowerCase().includes(term);
}

function setCategories() {
    const tmp = JSON.parse(JSON.stringify(selectedProject.value?.sprintsfolders || {}));
    let sprintsfolders = {};

    Object.values(tmp)?.forEach((x) => {
        const folder = {...x, sprintsObj: {}, isExpanded: category.value.find((y) => y.folderId === x.folderId)?.isExpanded || true}
        // A category whose own name matches keeps all of its channels; otherwise
        // only the channels that match survive. The search is applied HERE rather
        // than in chatsInit because channels are a folder tree, not a flat list.
        const folderMatches = matchesSearch(x.name);

        Object.values(x?.sprintsObj || {})?.forEach((sprint) => {
            if(!folderMatches && !matchesSearch(sprint.name)) return;

            if(companyUserDetail.value.roleType !== 1 && companyUserDetail.value.roleType !== 2 && sprint.private) {
                if(sprint.AssigneeUserId.includes(userId.value)) {
                    folder.sprintsObj[sprint.id] = {...sprint, folderId: folder.folderId};
                }
            } else {
                folder.sprintsObj[sprint.id] = sprint;
            }
        })

        // Drop a category that has nothing left to show, so a search does not
        // leave a column of empty headers behind. Without a search term
        // folderMatches is always true, so every category is kept as before.
        if(folderMatches || Object.keys(folder.sprintsObj).length) {
            sprintsfolders[folder.folderId] = folder;
        }
    })
    category.value = Object.values(sprintsfolders);
}

onMounted(() => {
    sprintData.value = getters["mainChat/mainChatSprints"][selectedProject.value._id];
    folderData.value = getters["mainChat/mainChatFolders"][selectedProject.value._id];
    separateFav();
    if(selectedProject?.value?._id){
        getSprintFolderData(selectedProject.value._id); 
    }
    chatsInit();
})

/**
 * Drop conversations with people who are no longer active company members.
 *
 * separateFav() already keeps them out of what it builds, but `chats` and
 * `favorites` are accumulated with push and never pruned, so a conversation added
 * before the company-users store had loaded would otherwise linger for the rest
 * of the session.
 *
 * Each ref is reassigned ONLY when something was actually dropped: a fresh array
 * identity re-triggers the `users` watchEffect, which re-triggers the debounced
 * watcher that calls this — assigning unconditionally would spin every second.
 */
function pruneInactiveChats() {
    const activeChats = chats.value.filter((x) => isActiveUser(peerIdOf(x)));
    if(activeChats.length !== chats.value.length) {
        chats.value = activeChats;
    }

    const activeFavorites = favorites.value.filter((x) => isActiveUser(peerIdOf(x)));
    if(activeFavorites.length !== favorites.value.length) {
        favorites.value = activeFavorites;
    }
}

function chatsInit() {
    // Channels: rebuild the folder tree so the search term is re-applied.
    if(!selectedProject.value?.default) {
        setCategories();
    }

    pruneInactiveChats();

    if(selectedProject.value?.default && searchChat.value.length) {
        chatsFilter.value = chats.value.filter((x) => x.TaskName.toLowerCase().includes(searchChat.value.toLowerCase()))
        favoritesFilter.value = favorites.value.filter((x) => x.TaskName.toLowerCase().includes(searchChat.value.toLowerCase()))
        usersFilter.value = JSON.parse(JSON.stringify(users.value)).filter((x) => x.name.toLowerCase().includes(searchChat.value.toLowerCase()))
    } else {
        chatsFilter.value = chats.value;
        favoritesFilter.value = favorites.value;
        usersFilter.value = JSON.parse(JSON.stringify(users.value));
    }
}

watch(() => selectedProject.value, (newVal, oldVal) => {
    if(newVal._id !== oldVal._id) {
        searchChat.value = "";
        getSprintFolderData(newVal._id);
    }
})
watch(route, (newRoute) => {
    if(newRoute.params.sid) {
        getSprintFolderData(selectedProject.value._id);
    }
})
watch(chatsGetters, (newVal, oldVal) => {
    if(oldVal === undefined) {
        return;
    }
    if(!isEqual(newVal, oldVal)) {
        getSprintFolderData(selectedProject.value._id);
    }
},{deep:true,immediate:true})

watch(() => getters["mainChat/mainChatSprints"],(sprintfold) => {
    if(JSON.stringify(sprintData.value) !== JSON.stringify(sprintfold[selectedProject.value._id] || [])){
        sprintData.value = sprintfold[selectedProject.value._id];
        getSprintFolderData(selectedProject.value._id);
    }
})

watch(() => getters["mainChat/mainChatFolders"],(folder) => {
    if(JSON.stringify(folderData.value) !== JSON.stringify(folder[selectedProject.value._id] || [])){
        folderData.value = folder[selectedProject.value._id];
        getSprintFolderData(selectedProject.value._id);
    }
})

// `category` is deliberately NOT a dependency here. chatsInit() now rebuilds the
// category tree, so watching it would re-trigger this watcher on every run and
// loop forever. Nothing inside chatsInit() reads `category`, so the dropped
// dependency changes no behaviour.
watch([searchChat, chats, favorites, users], debounce(() => {
    chatsInit();
}, 1000))

/* ------------------------------------------------------------------ *
 * Row helpers for the rebuilt conversation list. Read-only derivations —
 * they present existing state and add no behaviour of their own.
 * ------------------------------------------------------------------ */

/** The other participant's id in a direct conversation. */
function peerIdOf(chat) {
    if (!chat) return '';
    if (chat.receiverId) return chat.receiverId;
    return (chat.AssigneeUserId || []).filter((x) => x !== userId.value)[0] || '';
}

/** The other participant of a direct conversation. */
function peerOf(chat) {
    const other = peerIdOf(chat);
    return other ? getUser(other) : null;
}

function peerName(chat) {
    const peer = peerOf(chat);
    return (peer && peer.Employee_Name) || (chat && (chat.TaskName || chat.name)) || '';
}

function peerImage(chat) {
    const peer = peerOf(chat);
    return (peer && peer.Employee_profileImageURL) || '';
}

/** Last-message preview: mentions rendered, single line. */
function previewOf(chat) {
    const raw = (chat && chat.message) || '';
    if (raw === 'general.message_deleted') return '';
    return changeText(String(raw), '', '');
}

/** Unread count for a direct conversation, using the existing counter keys. */
function unreadOf(chat) {
    if (!chat || !selectedProject.value) return 0;
    const key = `task_${selectedProject.value._id}_${chat.sprintId}_${chat._id}_comments`;
    return myCounts.value?.[key] || 0;
}

/* ------------------------------------------------------------------ *
 * channel management (rename / members / delete)
 * ------------------------------------------------------------------ */

function editChannel(channel) {
    if (!channel) return;
    editingChannel.value = { ...channel };
    showEditChannel.value = true;
}

/**
 * Reflect a rename straight into the open tree.
 *
 * The store commit inside the edit panel updates the cached sprint list, but the
 * rendered tree is built by setCategories() from selectedProject.sprintsfolders —
 * a separate copy — so without this the new name only appears after the project's
 * channels are refetched.
 */
function onChannelSaved(updated) {
    if (!updated) return;
    const id = updated._id || updated.id;

    Object.values(selectedProject.value?.sprintsfolders || {}).forEach((folder) => {
        const sprint = (folder?.sprintsObj || {})[id];
        if (sprint) Object.assign(sprint, updated, { id });
    });

    const live = selectedProject.value?.sprintsObj?.[id];
    if (live) Object.assign(live, updated, { id });

    setCategories();

    // The header title comes from the selected chat, so refresh it too.
    if (props.selectedChat?.id === id) {
        emit('selectedChat', { ...props.selectedChat, ...updated, id });
    }
}

function editCategory(folder) {
    if (!folder) return;
    editingCategory.value = { ...folder };
    showEditCategory.value = true;
}

/**
 * Reflect a rename into the open tree, same reason as onChannelSaved: the rendered
 * categories are built by setCategories() from selectedProject.sprintsfolders, which
 * is a separate copy from the cached folder list the store commit updates.
 */
function onCategorySaved(updated) {
    if (!updated) return;
    const id = updated._id || updated.id;
    const folder = (selectedProject.value?.sprintsfolders || {})[id];
    if (!folder) return;

    folder.name = updated.name;
    // Channels carry a denormalised copy of their category's name.
    Object.values(folder?.sprintsObj || {}).forEach((sprint) => {
        if (sprint) sprint.folderName = updated.name;
    });

    setCategories();
}

/**
 * Delete a channel, behind a confirmation.
 *
 * Soft delete: the server flags the sprint and gives the company's channel quota
 * back. The conversation history is deliberately left in place.
 */
function confirmDeleteChannel(channel) {
    if (!channel) return;
    const id = channel._id || channel.id;
    if (!id) return;

    Swal.fire({
        title: t('Channel.confirm_delete_channel').replace('CHANNEL_NAME', channel.name || ''),
        text: t('Channel.confirm_delete_channel_note'),
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#3085d6',
        cancelButtonColor: '#d33',
        cancelButtonText: t('MainChat.cancel'),
        confirmButtonText: t('Channel.delete_channel'),
    }).then((result) => {
        if (result.isConfirmed) deleteChannel(channel, id);
    });
}

async function deleteChannel(channel, id) {
    try {
        const response = await apiRequest("patch", `${env.SPRINT}/${id}`, {
            companyId: companyId.value,
            projectId: selectedProject.value?._id || channel.projectId,
            type: "deleteChannel",
            mainChat: true,
        });

        if (!response?.data?.status) {
            $toast.error(response?.data?.statusText || t('Toast.something_went_wrong'), { position: "top-right" });
            return;
        }

        // `removed` matches on data.id in this mutation, not data._id.
        commit("mainChat/mutateChatSprints", { op: "removed", data: { id, projectId: selectedProject.value?._id } });

        // Drop it out of the rendered tree without waiting for a refetch.
        Object.values(selectedProject.value?.sprintsfolders || {}).forEach((folder) => {
            if (folder?.sprintsObj) delete folder.sprintsObj[id];
        });
        if (selectedProject.value?.sprintsObj) delete selectedProject.value.sprintsObj[id];
        setCategories();

        $toast.success(t('Toast.Channel_deleted_successfully'), { position: "top-right" });

        // Leave a conversation that no longer exists.
        if (props.selectedChat?.id === id) {
            emit('selectedChat', null);
            router.push({ name: "chat_project", params: { cid: companyId.value, pid: selectedProject.value?._id || "" } });
        }
    } catch (error) {
        console.error("ERROR in delete channel: ", error);
        $toast.error(t('Toast.something_went_wrong'), { position: "top-right" });
    }
}

function setProject(data) {
    if(!data || data._id === selectedProject.value?._id) return;
    router.push({name: "chat_project", params: {cid: companyId.value, pid: data?._id}});
    emit('selectedChat', null);
}

function setActiveChat(data) {
    if(!data || data.id === props.selectedChat?.id) return;
    router.push({name: "chat_project_channel", params: {cid: companyId.value, pid: selectedProject.value._id, sid: data._id ? data._id : data.id}});
    emit('selectedChat', null);
}

// CHECK COUNT
function checkCount(folder) {
    let count = 0;

    let sprints = Object.values(folder?.sprintsObj || {})?.map((x) => x.id);

    if(Object.keys(myCounts.value || {}).length) {
        Object.keys(myCounts.value).forEach((countKey) => {
            if(sprints.filter((x) => countKey.includes(x)).length && countKey.includes("task_") && countKey.includes("_comments")) {
                count += myCounts.value?.[countKey]
            }
        })
    }

    return count;
}


function getSprintData(id) {
    return new Promise((resolve, reject) => {
        try {
            if(Object.keys(getters["mainChat/mainChatSprints"]).includes(id)){
                // Always take the cache entry for the REQUESTED project. The old
                // `if (sprintData is empty)` guard meant that once this ref held any
                // project's sprints it was never refreshed, so switching
                // Channels -> Chats -> Channels resolved with the other project's
                // sprints; getSprintFolderData then filtered them by projectId,
                // matched nothing, and the channel list rendered empty until a
                // page reload repopulated the cache from scratch.
                sprintData.value = getters["mainChat/mainChatSprints"][id] || [];
                resolve(sprintData.value);
                return;
            }

            let projectId = id;
            dispatch("mainChat/setChatSprints",{projectId}).then((sprintss) => {
                sprintData.value = sprintss;
                resolve(sprintss);
            }).catch(() => {
            })
        } catch (error) {
            reject(error);
        }
    })
}

function getFolderData(id) {
    return new Promise((resolve, reject) => {
        try {
            if(Object.keys(getters["mainChat/mainChatFolders"]).includes(id) || selectedProject.value.default){
                // Same fix as getSprintData: read the cache for THIS project every
                // time instead of only when the ref happens to be empty, otherwise
                // stale folders from the previously opened project leak through and
                // the category list comes back empty.
                folderData.value = getters["mainChat/mainChatFolders"][id] || [];
                resolve(folderData.value);
                return;
            }
            let projectId = id;
            // ATTENTION PLEASE DO NOT REMOVE THIS COMMENTED CODE AS IT IS REQUIRED WHEN WE IMPLEMENT SOCKT IN IT
            // const uid = companyUserDetail.value.userId;
            // let publicQuery = {
            //     private:false,
            //     projectId : BSON.ObjectId(projectId)
            // }

            // let snapPublicQuery = {
            //     "fullDocument.projectId" : BSON.ObjectId(projectId)
            // }
            // let privateQuery = {
            //     projectId : BSON.ObjectId(projectId)
            // }

            // let snapPrivateQuery = {
            //     "fullDocument.projectId" : BSON.ObjectId(projectId)
            // }
            dispatch("mainChat/setChatFolders",{projectId}).then((folders) => {
                resolve(folders);
                folderData.value = folders;
            })
        } catch (error) {
            reject(error);
        }
    })
}

// const isLoading = ref(false);
const getSprintFolderData = async (id) => {
    try {
        loadingSprints.value = true;
        Promise.allSettled([getSprintData(id), getFolderData(id)])
        .then((results) => {
            const resolvedPromises = results.filter((result) => result.status === 'fulfilled');
            if (resolvedPromises.length === 2) {
                const [sprintsResult, foldersResult] = resolvedPromises.map((result) => result.value);
                const sprintsArray = sprintsResult?.filter(sprint => sprint.projectId === id && !sprint.folderId).map((x) => ({ ...x, id:x._id }));

                const foldersObject = foldersResult?.reduce((acc, folder) => {
                    if (folder.projectId === id) {
                        let folId = folder._id
                        acc[folId] = {
                            folderId: folId,
                            name: folder.name,
                            sprintsObj: {},
                            deletedStatusKey: folder.deletedStatusKey,
                            legacyId : folder?.legacyId ? folder?.legacyId : '',
                            id: folder._id,
                            _id: folder._id,
                        };
                    }
                    return acc;
                }, {});

                sprintsResult?.forEach(sprint => {
                    if (sprint.projectId === id && sprint.folderId && foldersObject[sprint.folderId]) {
                        sprint.folderName = foldersObject[sprint.folderId].name;
                        sprint.id = sprint?._id;
                        foldersObject[sprint.folderId].sprintsObj[sprint.id] = sprint;
                    }
                });
                sprintFolders.value = {
                    [id]: {
                        folders: foldersObject,
                        sprints: sprintsArray,
                    }
                };

                let project = selectedProject.value;
                let allSprints = sprintFolders.value !== undefined && sprintFolders.value && sprintFolders.value[selectedProject.value._id] ? sprintFolders.value[selectedProject.value._id]?.sprints : []
                allSprints = [...allSprints];

                let allFolders = sprintFolders.value && sprintFolders.value[selectedProject.value._id] ? sprintFolders.value[selectedProject.value._id]?.folders : {}

                const sprintIdToObject = {};
                allSprints.forEach(item => {sprintIdToObject[item.id] = item;});

                project.sprintsObj = sprintIdToObject;
                project.sprintsfolders = allFolders;
                // var newObj = {snap: null, privateSnap: false, userId: userId.value,roleType: companyUserDetail.value.roleType, op: "modified", data: {...project, isExpanded: true}};

                selectedProject.value.sprintsObj = project.sprintsObj;
                selectedProject.value.sprintsfolders = project.sprintsfolders;

                // commit("mainChat/mutateChatProjects",[newObj]);
                nextTick(() => {
                    loadingSprints.value = false;
                    separateFav();
                })
            } else {
                loadingSprints.value = false;
                console.error("One or more promises were rejected");
            }
        })
        .catch((error) => {
            loadingSprints.value = false;
            console.error("Error in Promise.allSettled", error);
        });
    } catch (error) {
        console.error("ERROR", error);
    }
}
</script>

<style lang="css">
/* Chat module tokens + the .mcs-* conversation-pane styles; imported here so
   the pane is styled even when the v2 panel (which also loads it) is absent. */
@import "../MainChat/style.css";
.v-enter-active,
.v-leave-active {
  transition: all 0.2s ease;
}
.v-enter-from,
.v-leave-to {
  opacity: 0;
}
.chat__chanel-icons{
    width: 69px;
}
.chanel__detail-icon{
    width: calc(100% - 70px);
}
.h-35px{
    height: 35px;
}
.selected__projectid-div{
    width: 5px;
    left: 0px;
}
.all_chats-img{
    width: 20px; 
    height: 20px;
}
.checkall__count{
    top: -5px;
    right: -5px; 
    left: unset;
}
.chanel__searchinput-wrapper{
    height: 50px;
}
.chanel__searchinput{
   height: 30px !important;
}
.chanel__defultchat-wrapper{
    height: calc(100% - 61px); 
    padding: 5px;
    scrollbar-width: none;
}
.fav__h4{
    line-height: 23px;
}
.date_or_text {
    font-family: Roboto;
    font-size: 11px;
    font-weight: 500;
    line-height: 18px;
    letter-spacing: 0em;
    text-align: right;
    color: rgba(149, 149, 149, 1);
}
.leftside_replay-count {
    width: 18px;
    height: 18px;
    font-family: Roboto;
    font-size: 9px;
    font-weight: 500;
    text-align: center;
    line-height: 12px;
    letter-spacing: 0em;
    margin-left: auto;
}
.convertdate_formate-wrapper {
    width: 20%;
}
span.notification-tick.blinking.checkall__count {
    width: 18px;
    height: 18px;
    font-size: 9px;
    text-align: center;
    line-height: 18px;
    top: inherit;
    bottom: -5px;
    border-radius: 50%;
}
span.company_latter{
    display: block;
    height: 100%;
    width: 100%;
    text-align: center;
    line-height: 33px;
    border-radius: 3px;
}
</style>