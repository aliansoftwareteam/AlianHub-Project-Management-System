<template>
    <button
        type="button"
        class="mc-thread-foot"
        data-test="thread-footer"
        :aria-label="count === 1 ? $t('MainChat.thread_open_one') : $t('MainChat.thread_open_many', { count })"
        @click="$emit('open')"
    >
        <span v-if="repliers.length" class="mc-thread-avs" aria-hidden="true">
            <MainChatAvatar
                v-for="replier in repliers"
                :key="replier.id"
                :name="replier.name"
                :src="replier.src"
                :agent="replier.agent"
                :size="20"
            />
        </span>
        <span class="mc-thread-count">{{ count === 1 ? $t('MainChat.thread_replies_one') : $t('MainChat.thread_replies_many', { count }) }}</span>
        <span v-if="lastReply" class="mc-thread-last">{{ $t('MainChat.thread_last_reply', { when: lastReply }) }}</span>
    </button>
</template>

<script setup>
import { computed, defineProps, defineEmits } from 'vue';
import { useI18n } from 'vue-i18n';
import moment from 'moment';
import { useGetterFunctions } from '@/composable';
import MainChatAvatar from './MainChatAvatar.vue';

const OBJECT_ID = /^[a-f0-9]{24}$/i;

const props = defineProps({
    message: { type: Object, required: true },
    hour12: { type: Boolean, default: true },
});

defineEmits(['open']);

const { t } = useI18n();
const { getUser } = useGetterFunctions();

const count = computed(() => Number(props.message.replyCount || 0));

/* The AI and agents reply under ids that are no member's, so they get the agent mark and no name lookup. */
const repliers = computed(() => (Array.isArray(props.message.replierIds) ? props.message.replierIds : []).map((id) => {
    const user = getUser(id) || {};
    const person = !!user.Employee_Name || OBJECT_ID.test(String(id));
    return {
        id: String(id),
        agent: !person,
        name: person ? (user.Employee_Name || '') : t('Chat.agent'),
        src: person && !user.ghostUser ? (user.Employee_profileImageURL || '') : '',
    };
}));

const lastReply = computed(() => {
    const at = moment(props.message.lastReplyAt || '');
    if (!props.message.lastReplyAt || !at.isValid()) return '';
    if (at.isSame(moment(), 'day')) return at.format(props.hour12 ? 'h:mm A' : 'HH:mm');
    return at.toDate().toLocaleDateString([], { day: 'numeric', month: 'short' });
});
</script>
