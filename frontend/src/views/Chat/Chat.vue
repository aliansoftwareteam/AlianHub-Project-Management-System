<template>
    <div v-if="!allowChatFeature" class="cv-upgrade">
        <UpgradePlan
            :buttonText="$t('Upgrades.upgrade_your_plan')"
            :lastTitle="$t('Upgrades.unlock_chat')"
            :secondTitle="$t('Upgrades.unlimited')"
            :firstTitle="$t('Upgrades.upgrade_to')"
            :message="$t('Upgrades.the_feature_not_available')"
        />
    </div>

    <div v-else class="ah-page cv" :class="{ 'cv--mobile': isMobile }">
        <ChatSidebar
            v-if="showList"
            :groups="channelGroups"
            :direct="directMessages"
            :people="people"
            :selected-id="selectedId"
            :can-create-channel="canCreateChannel"
            :loading="paneBusy"
            @select="onSelect"
            @new-channel="showCreateChannel = true"
        />

        <section v-if="showPane" class="cv-main">
            <MainChatPanel
                v-if="selectedChat && selectedProject && selectedProject._id"
                :key="`mc_${selectedProject._id}_${selectedChat.id}`"
                :taskId="isDirect ? selectedChat.id : 'default'"
                :sprintId="isDirect ? selectedChat.sprintId : selectedChat.id"
                :folderId="isDirect ? '' : (selectedChat.folderId || '')"
                :newChat="selectedChat.newChat || false"
                :watchers="watchers"
                :isChannel="!isDirect"
                :icon="isDirect ? {} : selectedChat"
                :title="selectedChat.name || ''"
                :subtitle="subtitle"
                :avatarSrc="isDirect ? (selectedChat.image || '') : ''"
                :channel="isDirect ? null : selectedChat"
                :linked-project="linkedProject"
                :presence="isDirect ? !selectedChat.isDnd : null"
                :sendMessageAllowed="sendMessageAllowed"
                :details-open="detailsOpen"
                @created="onChatCreated"
                @toggle-details="detailsOpen = !detailsOpen"
            >
                <template #header-lead>
                    <button
                        v-if="isMobile"
                        type="button"
                        class="cv-back"
                        :title="$t('ChatV2.back_to_list')"
                        @click="backToList"
                    ><ShellIcon name="chevronLeft" :size="18" /></button>
                </template>
            </MainChatPanel>

            <div v-else-if="paneBusy" class="cv-busy">
                <span class="cv-skel cv-skel--head"></span>
                <span class="cv-skel"></span>
                <span class="cv-skel cv-skel--short"></span>
            </div>

            <div v-else class="cv-empty">
                <div class="cv-empty-card">
                    <ShellIcon name="chat" :size="26" />
                    <h2 class="ah-h2">{{ $t('Chat.welcome_message').replace('BRAND_NAME', brandName) }}</h2>
                    <p class="ah-small">{{ hasAnyConversation ? $t('ChatV2.pick_up') : $t('ChatV2.no_channels') }}</p>
                    <button v-if="canCreateChannel" type="button" class="ah-btn ah-btn--primary" @click="showCreateChannel = true">
                        <ShellIcon name="plus" :size="14" /> {{ $t('ChatV2.new_channel') }}
                    </button>
                </div>
            </div>
        </section>

        <CreateChannelSidebar
            v-if="showCreateChannel"
            v-model:visible="showCreateChannel"
            :project="channelProject"
            :folders="channelFolders"
            @created="onChannelCreated"
        />
    </div>
</template>

<script setup>
import { computed, inject, onMounted, onUnmounted, provide, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useStore } from 'vuex';
import { useI18n } from 'vue-i18n';
import { useCustomComposable } from '@/composable';
import UpgradePlan from '@/components/atom/UpgradYourPlanComponent/UpgradYourPlanComponent.vue';
import MainChatPanel from '@/components/organisms/MainChat/MainChatPanel.vue';
import CreateChannelSidebar from '@/components/organisms/CreateChannelSidebar/CreateChannelSidebar.vue';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';
import ChatSidebar from './ChatSidebar.vue';
import { useMainChat } from './helper';
import { useChatDirectory } from './useChatDirectory';

defineOptions({ name: 'ChatView' });

const MOBILE_WIDTH = 768;
const DETAILS_WIDTH = 1280;

const clientWidth = inject('$clientWidth');
const companyId = inject('$companyId');
const userId = inject('$userId');
const socket = inject('$socket');

const { getters, commit } = useStore();
const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const { getProjects, dispatchChats } = useMainChat();
const { checkPermission } = useCustomComposable();

const isMobile = computed(() => clientWidth.value < MOBILE_WIDTH);
const detailsOpen = ref(clientWidth.value >= DETAILS_WIDTH);

const currentPlan = computed(() => getters['settings/selectedCompany'] && getters['settings/selectedCompany'].planFeature);
const allowChatFeature = computed(() => !!(currentPlan.value && currentPlan.value.chat));
const brandName = computed(() => {
    const brand = getters['brandSettingTab/brandSettings'];
    return (brand && brand.productName) || 'Alian Hub';
});

const oneToOnePermission = computed(() => checkPermission('chat.one_to_one_chat'));
const canViewDirectMessages = computed(() => oneToOnePermission.value === true || oneToOnePermission.value === false);
const canSendDirectMessages = computed(() => oneToOnePermission.value === true);
const canCreateChannel = computed(() => checkPermission('chat.chat_channel') === true);
provide('canSendDirectMessages', canSendDirectMessages);

const projects = ref([]);
const loadingChats = ref(true);
const showCreateChannel = ref(false);
// A direct message created moments ago may not have reached the chats store yet.
const justCreated = ref(null);

const mainChatProjects = computed(() => getters['mainChat/mainChatProjects']);

function visibleChatProjects(list) {
    const rows = list || [];
    return canViewDirectMessages.value ? rows : rows.filter((p) => p.default === false);
}

const directory = useChatDirectory({ projects, userId, canStartDirect: canSendDirectMessages });
const { channelGroups, directMessages, people, directProject, channelProjects, directSprint, findChannel, findDirect, findPerson, sprintsOf } = directory;

const paneBusy = computed(() => loadingChats.value || directory.loading.value);
const hasAnyConversation = computed(() => directMessages.value.length > 0 || channelGroups.value.some((g) => g.all.length));

const companyUsers = computed(() => (getters['settings/companyUsers'] || [])
    .filter((x) => x && x.isDelete !== true)
    .map((x) => x.userId));

const activeProjects = computed(() => {
    const list = getters['projectData/onlyActiveProjects'];
    return (list && list.data) || [];
});

/* ------------------------------------------------------------------ *
 * selection — derived from the route, never held separately
 * ------------------------------------------------------------------ */
const routeProject = computed(() => projects.value.find((p) => String(p._id) === String(route.params.pid)) || null);

const selection = computed(() => {
    const sid = route.params.sid;
    const project = routeProject.value;
    if (!sid || !project) return null;

    if (project.default) {
        const direct = findDirect(sid);
        if (direct) return { project, chat: direct, kind: 'direct' };
        if (justCreated.value && String(justCreated.value.id) === String(sid)) {
            return { project, chat: justCreated.value, kind: 'direct' };
        }
        const person = findPerson(sid);
        if (!person) return null;
        const sprint = directSprint();
        return { project, chat: { ...person, sprintId: sprint ? sprint._id : '', newChat: true }, kind: 'direct' };
    }

    const channel = findChannel(sid);
    return channel ? { project, chat: channel, kind: 'channel' } : null;
});

const selectedChat = computed(() => (selection.value ? selection.value.chat : null));
const isDirect = computed(() => !!(selection.value && selection.value.kind === 'direct'));
const selectedId = computed(() => (selectedChat.value ? String(selectedChat.value.id) : ''));

/** The project the open conversation lives in, with its sprints keyed by id. */
const selectedProject = computed(() => {
    const project = selection.value ? selection.value.project : routeProject.value;
    if (!project) return {};
    const sprintsObj = {};
    sprintsOf(project._id).forEach((s) => { sprintsObj[s._id] = { ...s, id: s._id }; });
    return { ...project, sprintsObj };
});

provide('selectedProject', selectedProject);
provide('selectedChat', selectedChat);

const watchers = computed(() => {
    const chat = selectedChat.value;
    if (!chat) return [];
    if (isDirect.value) return [...(chat.AssigneeUserId || [])];
    return chat.private ? [...(chat.AssigneeUserId || [])] : companyUsers.value;
});

const linkedProject = computed(() => {
    const chat = selectedChat.value;
    if (!chat || isDirect.value || !chat.linkedProjectId) return null;
    return activeProjects.value.find((p) => String(p._id) === String(chat.linkedProjectId)) || null;
});

const subtitle = computed(() => {
    const chat = selectedChat.value;
    if (!chat) return '';
    if (isDirect.value) return chat.isDnd ? t('Shell.status_dnd') : '';
    const count = watchers.value.length;
    const parts = [];
    if (linkedProject.value) parts.push(linkedProject.value.ProjectName);
    parts.push(count === 1 ? t('ChatV2.member_one') : t('ChatV2.members_count', { count }));
    return parts.join(' · ');
});

const sendMessageAllowed = computed(() => {
    if (isDirect.value) return canSendDirectMessages.value;
    if (!selectedChat.value || selectedChat.value.sendMessage !== false) return true;
    const roleType = (getters['settings/companyUserDetail'] || {}).roleType;
    return roleType === 1 || roleType === 2;
});

const showList = computed(() => !isMobile.value || !route.params.sid);
const showPane = computed(() => !isMobile.value || !!route.params.sid);

/* ------------------------------------------------------------------ *
 * navigation
 * ------------------------------------------------------------------ */
function open(projectId, id) {
    if (!projectId || !id) return;
    if (String(route.params.pid) === String(projectId) && String(route.params.sid) === String(id)) return;
    router.push({ name: 'chat_project_channel', params: { cid: companyId.value, pid: projectId, sid: id } });
}

function onSelect({ kind, item }) {
    if (kind === 'channel') open(item.projectId, item.id);
    else if (directProject.value) open(directProject.value._id, item.id);
}

function backToList() {
    router.push({ name: 'chats', params: { cid: companyId.value } });
}

function onChatCreated(taskId) {
    if (!taskId || !selectedChat.value) return;
    justCreated.value = { ...selectedChat.value, id: taskId, _id: taskId, newChat: false };
    router.replace({ name: 'chat_project_channel', params: { cid: companyId.value, pid: route.params.pid, sid: taskId } });
}

const channelProject = computed(() => routeProject.value && !routeProject.value.default
    ? routeProject.value
    : (channelProjects.value[0] || null));

const channelFolders = computed(() => {
    const group = channelGroups.value.find((g) => channelProject.value && String(g.project._id) === String(channelProject.value._id));
    return group ? group.categories : [];
});

function onChannelCreated(channel) {
    if (channel && channel._id) open(channel.projectId || (channelProject.value && channelProject.value._id), channel._id);
}

/** Land somewhere useful on a wide screen when the URL names no conversation. */
function autoSelect() {
    if (isMobile.value || route.params.sid || paneBusy.value) return;
    const unread = directory.allChannels.value.find((c) => c.unread > 0);
    if (unread) return open(unread.projectId, unread.id);
    const recent = directMessages.value.find((c) => c.lastMessage);
    if (recent && directProject.value) return open(directProject.value._id, recent.id);
    const first = directory.allChannels.value[0];
    if (first) return open(first.projectId, first.id);
    if (directMessages.value[0] && directProject.value) return open(directProject.value._id, directMessages.value[0].id);
    return undefined;
}

/* ------------------------------------------------------------------ *
 * loading
 * ------------------------------------------------------------------ */
const socketReady = new Promise((resolve) => {
    let attempts = 0;
    const timer = setInterval(() => {
        attempts += 1;
        if ((socket.value && socket.value.id) || attempts > 4) {
            clearInterval(timer);
            resolve();
        }
    }, 800);
});

async function initialise() {
    if (!projects.value.length) {
        loadingChats.value = false;
        return;
    }
    await directory.loadAll();
    const direct = projects.value.find((p) => p.default);
    if (direct) {
        await socketReady;
        try {
            await dispatchChats(direct._id, (sprintsOf(direct._id)[0] || {})._id);
        } catch (error) {
            console.error('Chat: could not load direct messages', error);
        }
    }
    loadingChats.value = false;
    autoSelect();
}

onMounted(() => {
    if (mainChatProjects.value && mainChatProjects.value.data && mainChatProjects.value.data.length) {
        projects.value = visibleChatProjects(mainChatProjects.value.data);
        initialise();
    } else {
        getProjects().catch((error) => {
            console.error('Chat: could not load chat projects', error);
            loadingChats.value = false;
        });
    }
});

watch(mainChatProjects, (value, previous) => {
    if (!value || !value.data || !value.data.length) return;
    if (JSON.stringify(value) === JSON.stringify(previous)) return;
    projects.value = visibleChatProjects(value.data);
    initialise();
});

watch(() => [route.params.pid, route.params.sid], () => {
    if (!route.params.sid) autoSelect();
});

watch(() => clientWidth.value, (width) => {
    if (width < DETAILS_WIDTH && detailsOpen.value) detailsOpen.value = false;
});

onUnmounted(() => {
    commit('mainChat/setChatPayload', {});
    if (!socket.value || !socket.value.id) return;
    socket.value.emit('getRoomList', socket.value.id, (rooms) => {
        const chatRooms = (rooms || []).filter((x) => x.includes('chat_'));
        if (!chatRooms.length) return;
        ['chatTaskInsert', 'chatTaskUpdate', 'chatTaskDelete', 'chatTaskReplace'].forEach((event) => socket.value.off(event));
        chatRooms.forEach((room) => socket.value.emit('leaveChats', room));
    });
});
</script>

<style src="./style.css"></style>
