<template>
    <span v-if="message.isDeleted" class="mc-deleted">
        {{ message.sent ? $t('MainChat.deleted_by_you') : $t('MainChat.deleted') }}
    </span>

    <template v-else>
        <div v-if="message.hasReply" class="mc-quote">
            <b>{{ replyAuthor }}</b>
            <span v-if="replyPreview"> · {{ replyPreview }}</span>
        </div>

        <template v-if="isMedia">
            <div v-if="gallery.length > 1" class="mc-gallery">
                <MainChatMedia
                    v-for="item in gallery"
                    :key="item._id || item.tempId"
                    :message="item"
                    tile
                    @preview="$emit('preview', item)"
                />
            </div>
            <MainChatMedia
                v-else
                :message="message"
                @preview="$emit('preview', message)"
                @make-task="$emit('make-task', $event)"
                @transcribed="$emit('transcribed', $event)"
            />
            <div v-if="gallery.length > 1" class="mc-gallery-hint">{{ $t('Chat.lightbox_hint') }}</div>
        </template>

        <div v-else-if="isAi" class="mc-ai-body" v-html="aiBody" @click="followCitation"></div>
        <span v-else v-html="renderedBody"></span>
    </template>
</template>

<script setup>
import { computed, defineProps, defineEmits, getCurrentInstance, inject, unref } from 'vue';
import { useGetterFunctions } from '@/composable';
import { commentHtml, commentPlainText } from '@/utils/commentHtml';
import { aiAnswerHtml, aiAuthorOf, citationTarget } from '@/utils/aiMention';
import MainChatMedia from './MainChatMedia.vue';

const props = defineProps({
    message: { type: Object, required: true },
    siblings: { type: Array, default: () => [] },
});

defineEmits(['preview', 'make-task', 'transcribed']);

const { getUser } = useGetterFunctions();

const isMedia = computed(() => !['text', 'link'].includes(props.message.type));
const gallery = computed(() => [props.message, ...props.siblings]);

const renderedBody = computed(() => commentHtml(props.message.message, { links: true }));

const companyId = inject('$companyId', '');
const instance = getCurrentInstance();
const routerOf = () => (instance && instance.proxy && instance.proxy.$router) || null;
const isAgentAnswer = computed(() => Array.isArray(props.message.agentCitations));
const isAi = computed(() => !!aiAuthorOf(props.message) || isAgentAnswer.value);
const cited = computed(() => (isAgentAnswer.value ? { ...props.message, aiCitations: props.message.agentCitations } : props.message));
const aiBody = computed(() => aiAnswerHtml(cited.value, { router: routerOf(), companyId: unref(companyId) }));

function followCitation(event) {
    const to = citationTarget(event, cited.value, unref(companyId));
    const router = routerOf();
    if (!to || !router) return;
    event.preventDefault();
    router.push(to);
}

const replyAuthor = computed(() => {
    const user = props.message.reply_userId ? getUser(props.message.reply_userId) : null;
    return (user && user.Employee_Name) || props.message.reply_userName || '';
});

const replyPreview = computed(() => {
    const text = props.message.reply_message || props.message.reply_mediaOriginalName || '';
    const plain = commentPlainText(text);
    return plain.length > 70 ? `${plain.slice(0, 70)}…` : plain;
});
</script>

<style scoped>
.mc-ai-body :deep(p),
.mc-ai-body :deep(ul),
.mc-ai-body :deep(ol) {
    margin: 0 0 6px;
}
.mc-ai-body :deep(ul),
.mc-ai-body :deep(ol) {
    padding-left: 20px;
}
.mc-ai-body :deep(.ask-cite) {
    color: var(--brand);
    font-weight: 600;
}
</style>
