<template>
    <aside class="mc-info">
        <div class="mc-info-top">
            <span class="mc-info-title">{{ isChannel ? $t('MainChat.channel_info') : $t('MainChat.user_info') }}</span>
            <button type="button" class="mc-icon-btn" :title="$t('MainChat.cancel')" @click="$emit('close')"><MainChatIcon name="close" :size="15" /></button>
        </div>

        <div class="mc-info-body">
            <!-- identity -->
            <div class="mc-info-id">
                <MainChatConversationIcon
                    class="mc-info-ico"
                    :title="title"
                    :avatar-src="avatarSrc"
                    :is-channel="isChannel"
                    :icon="icon"
                    :size="34"
                />
                <span class="mc-info-name">{{ title }}</span>
                <span v-if="role" class="mc-info-role">{{ role }}</span>
            </div>

            <!-- facts we actually hold; nothing is rendered when unknown -->
            <dl v-if="facts.length" class="mc-info-facts">
                <template v-for="fact in facts" :key="fact.label">
                    <dt>{{ fact.label }}</dt>
                    <dd>{{ fact.value }}</dd>
                </template>
            </dl>

            <!-- Shared content, from the loaded transcript. Every item is listed —
                 each section scrolls internally instead of being truncated, so the
                 count in the header always matches what you can actually reach. -->
            <div class="mc-info-section">
                <div class="mc-info-section-head">
                    <span>{{ $t('MainChat.photos_media') }}</span>
                    <span class="mc-info-count">{{ media.length }}</span>
                </div>
                <div v-if="media.length" class="mc-info-grid style-scroll">
                    <div
                        v-for="item in media"
                        :key="item._id || item.tempId"
                        class="mc-info-tile"
                        :title="item.mediaOriginalName"
                        @click="$emit('preview', item)"
                    >
                        <MainChatMedia :message="item" />
                    </div>
                </div>
                <p v-else class="mc-info-none">{{ $t('MainChat.nothing_shared') }}</p>
            </div>

            <div class="mc-info-section">
                <div class="mc-info-section-head">
                    <span>{{ $t('MainChat.documents') }}</span>
                    <span class="mc-info-count">{{ documents.length }}</span>
                </div>
                <ul v-if="documents.length" class="mc-info-docs style-scroll">
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
                <p v-else class="mc-info-none">{{ $t('MainChat.nothing_shared') }}</p>
            </div>

            <!-- channel members -->
            <div v-if="isChannel && members.length" class="mc-info-section">
                <div class="mc-info-section-head">
                    <span>{{ $t('MainChat.members') }}</span>
                    <span class="mc-info-count">{{ members.length }}</span>
                </div>
                <ul class="mc-info-members style-scroll">
                    <li v-for="member in members" :key="member.id">
                        <MainChatAvatar :name="member.name" :src="member.image" :size="28" />
                        <span class="mc-info-member-name">{{ member.name }}</span>
                    </li>
                </ul>
            </div>
        </div>
    </aside>
</template>

<script setup>
/**
 * The conversation detail pane (third column).
 *
 * Deliberately shows only facts we already hold — the person's name, their
 * profile details when present, and the media/documents visible in the loaded
 * transcript. Nothing is faked: an unknown field is omitted rather than shown
 * empty, and the media counts describe the messages actually loaded rather than
 * claiming a total the client has not fetched.
 */
import { computed, defineProps, defineEmits } from 'vue';
import { useI18n } from 'vue-i18n';
import { useGetterFunctions } from '@/composable';
import MainChatAvatar from './MainChatAvatar.vue';
import MainChatConversationIcon from './MainChatConversationIcon.vue';
import MainChatIcon from './MainChatIcon.vue';
import MainChatMedia from './MainChatMedia.vue';

const props = defineProps({
    title: { type: String, default: '' },
    avatarSrc: { type: String, default: '' },
    isChannel: { type: Boolean, default: false },
    // The channel's own image / glyph, when it has one.
    icon: { type: Object, default: () => ({}) },
    // the other participant in a DM
    peerId: { type: String, default: '' },
    // every participant id (channels)
    participants: { type: Array, default: () => [] },
    messages: { type: Array, default: () => [] },
});

defineEmits(['close', 'preview']);

const { t } = useI18n();
const { getUser } = useGetterFunctions();

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

// Only active company members are listed. getUser() flags anyone who has left as
// `ghostUser` — either missing from the users store entirely ("Ghost User") or
// marked isDelete, in which case their name is replaced by their email address.
const members = computed(() => props.participants
    .map((id) => {
        const user = getUser(id) || {};
        return { id, name: user.Employee_Name || '', image: user.Employee_profileImageURL || '', ghost: !!user.ghostUser };
    })
    .filter((m) => m.name && !m.ghost));

function ext(item) {
    const name = item.mediaOriginalName || item.mediaName || '';
    const parts = String(name).split('.');
    return parts.length > 1 ? parts.pop().toLowerCase() : 'file';
}
</script>
