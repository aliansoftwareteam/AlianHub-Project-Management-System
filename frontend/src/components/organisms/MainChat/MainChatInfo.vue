<template>
    <aside class="mc-info">
        <div class="mc-info-top">
            <span class="mc-info-title">{{ isChannel ? $t('MainChat.channel_info') : $t('MainChat.user_info') }}</span>
            <button type="button" class="mc-icon-btn" :title="$t('ChatV2.close_details')" @click="$emit('close')"><MainChatIcon name="close" :size="15" /></button>
        </div>

        <div class="mc-info-body ah-scroll">
            <div class="mc-info-id">
                <span class="mc-info-name">
                    <span v-if="isChannel" class="mc-head-hash">#</span>
                    <MainChatAvatar v-else :name="title" :src="avatarSrc" :size="28" />
                    {{ title }}
                </span>
                <p v-if="channel && channel.purpose" class="mc-info-purpose">{{ channel.purpose }}</p>
                <span v-if="role" class="mc-info-role">{{ role }}</span>
                <div v-if="isChannel && (linkedProject || (channel && channel.slackMirror && channel.slackMirror.enabled) || (channel && channel.private))" class="mc-info-chips">
                    <span v-if="linkedProject" class="ah-chip ah-chip--brand"><ShellIcon name="projects" :size="11" /> {{ linkedProject.ProjectName }}</span>
                    <span v-if="channel && channel.private" class="ah-chip"><ShellIcon name="lock" :size="11" /> {{ $t('MainChat.private_channel') }}</span>
                    <span v-if="channel && channel.slackMirror && channel.slackMirror.enabled" class="ah-chip ah-chip--ok">{{ $t('ChatV2.details_slack') }}</span>
                </div>
            </div>

            <dl v-if="facts.length" class="mc-info-facts">
                <template v-for="fact in facts" :key="fact.label">
                    <dt>{{ fact.label }}</dt>
                    <dd>{{ fact.value }}</dd>
                </template>
            </dl>

            <div v-if="isChannel" class="mc-info-section">
                <div class="mc-info-section-head">
                    <span class="ah-label">{{ $t('ChatV2.members') }}</span>
                    <span class="mc-info-count">{{ members.length }}</span>
                </div>
                <ul v-if="members.length" class="mc-info-members">
                    <li v-for="member in visibleMembers" :key="member.id">
                        <MainChatAvatar :name="member.name" :src="member.image" :size="20" />
                        <span class="mc-info-member-name">{{ member.name }}</span>
                    </li>
                </ul>
                <p v-else class="mc-info-none">{{ $t('ChatV2.no_members') }}</p>
                <button v-if="members.length > MEMBER_LIMIT" type="button" class="mc-info-more" @click="showAllMembers = !showAllMembers">
                    {{ showAllMembers ? $t('ChatV2.close_details') : `+${members.length - MEMBER_LIMIT}` }}
                </button>
            </div>

            <div class="mc-info-section">
                <div class="mc-info-section-head">
                    <span class="ah-label">{{ $t('ChatV2.pinned') }}</span>
                    <span class="mc-info-count">{{ pinned.length }}</span>
                </div>
                <div v-if="pinned.length" class="mc-info-pins">
                    <button v-for="item in pinned" :key="item._id" type="button" class="mc-info-pin" @click="$emit('open', item)">
                        <b>{{ authorOf(item) }}</b>
                        <span>{{ snippet(item) }}</span>
                    </button>
                </div>
                <p v-else class="mc-info-none">{{ pinnedLoading ? $t('MainChat.loading') : $t('ChatV2.no_pinned') }}</p>
            </div>

            <div class="mc-info-section">
                <div class="mc-info-section-head">
                    <span class="ah-label">{{ $t('ChatV2.files') }}</span>
                    <span class="mc-info-count">{{ shared.length }}</span>
                </div>
                <div v-if="media.length" class="mc-info-grid">
                    <MainChatMedia
                        v-for="item in media"
                        :key="item._id || item.tempId"
                        :message="item"
                        tile
                        @preview="$emit('preview', item)"
                    />
                </div>
                <ul v-if="documents.length" class="mc-info-docs">
                    <li
                        v-for="item in documents"
                        :key="item._id || item.tempId"
                        class="mc-info-doc"
                        :title="item.mediaOriginalName || item.mediaName"
                        @click="$emit('preview', item)"
                    >
                        <span class="mc-file-ic">{{ ext(item) }}</span>
                        <span class="mc-info-doc-name">{{ item.mediaOriginalName || item.mediaName }}</span>
                    </li>
                </ul>
                <p v-if="!shared.length" class="mc-info-none">{{ $t('ChatV2.no_files') }}</p>
            </div>
        </div>
    </aside>
</template>

<script setup>
/**
 * The right-hand details panel: members, pinned messages and files. Facts are only
 * shown when held; counts describe what is loaded, never a total nobody fetched.
 */
import { computed, defineProps, defineEmits, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useGetterFunctions, useCustomComposable } from '@/composable';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';
import MainChatAvatar from './MainChatAvatar.vue';
import MainChatIcon from './MainChatIcon.vue';
import MainChatMedia from './MainChatMedia.vue';

const MEMBER_LIMIT = 12;

const props = defineProps({
    title: { type: String, default: '' },
    avatarSrc: { type: String, default: '' },
    isChannel: { type: Boolean, default: false },
    channel: { type: Object, default: null },
    linkedProject: { type: Object, default: null },
    peerId: { type: String, default: '' },
    participants: { type: Array, default: () => [] },
    messages: { type: Array, default: () => [] },
    projectId: { type: String, default: '' },
    sprintId: { type: String, default: '' },
    taskId: { type: String, default: '' },
});

defineEmits(['close', 'preview', 'open']);

const { t } = useI18n();
const { getUser } = useGetterFunctions();
const { changeText } = useCustomComposable();

const showAllMembers = ref(false);
const pinned = ref([]);
const pinnedLoading = ref(false);

const peer = computed(() => (props.peerId ? getUser(props.peerId) || {} : {}));
const role = computed(() => peer.value.designation || '');

const facts = computed(() => {
    const rows = [];
    if (peer.value.userEmail) rows.push({ label: t('MainChat.email'), value: peer.value.userEmail });
    if (peer.value.Employee_PhoneNumber) rows.push({ label: t('MainChat.phone'), value: peer.value.Employee_PhoneNumber });
    if (peer.value.timeZone) rows.push({ label: t('MainChat.timezone'), value: peer.value.timeZone });
    return rows;
});

const shared = computed(() => props.messages.filter((m) => !m.isDeleted && !m.isSending && m.mediaURL));
const media = computed(() => shared.value.filter((m) => ['image', 'video'].includes(m.type)));
const documents = computed(() => shared.value.filter((m) => !['image', 'video'].includes(m.type)));

const members = computed(() => props.participants
    .map((id) => {
        const user = getUser(id) || {};
        return { id, name: user.Employee_Name || '', image: user.Employee_profileImageURL || '', ghost: !!user.ghostUser };
    })
    .filter((m) => m.name && !m.ghost));

const visibleMembers = computed(() => (showAllMembers.value ? members.value : members.value.slice(0, MEMBER_LIMIT)));

function ext(item) {
    const name = item.mediaOriginalName || item.mediaName || '';
    const parts = String(name).split('.');
    return parts.length > 1 ? parts.pop().toLowerCase() : 'file';
}

function authorOf(item) {
    if (item.agentName) return item.agentName;
    return (getUser(item.userId) || {}).Employee_Name || '';
}

function snippet(item) {
    if (item.mediaOriginalName) return item.mediaOriginalName;
    const plain = changeText(String(item.message || ''), '', '').replace(/<[^>]*>/g, '');
    return plain.length > 90 ? `${plain.slice(0, 90)}…` : plain;
}

async function loadPinned() {
    if (!props.projectId || !props.taskId) return;
    pinnedLoading.value = true;
    try {
        const url = `${env.API_COMMENTS}/get-searched-messages?searchText=&projectId=${props.projectId}`
            + `&sprintId=${props.sprintId}&taskId=${props.taskId}&isPinnedMessage=true&sort=desc&skip=0&limit=25`;
        const response = await apiRequest('get', url);
        pinned.value = (response && response.data && response.data.data) || [];
    } catch (error) {
        console.error('MainChat: pinned load failed', error);
    } finally {
        pinnedLoading.value = false;
    }
}

onMounted(loadPinned);
watch(() => [props.projectId, props.sprintId, props.taskId], loadPinned);
// A pin toggled in the transcript is reflected here without a refetch.
watch(() => props.messages.map((m) => `${m._id}:${m.pinnedMessage ? 1 : 0}`).join(','), () => {
    const local = props.messages.filter((m) => m.pinnedMessage && !m.isDeleted);
    const known = new Set(pinned.value.map((p) => String(p._id)));
    const additions = local.filter((m) => !known.has(String(m._id)));
    const unpinned = new Set(props.messages.filter((m) => !m.pinnedMessage).map((m) => String(m._id)));
    pinned.value = [...additions, ...pinned.value.filter((p) => !unpinned.has(String(p._id)))];
});
</script>
