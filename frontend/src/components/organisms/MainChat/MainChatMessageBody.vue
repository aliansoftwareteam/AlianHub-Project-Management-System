<template>
    <!-- deleted -->
    <span v-if="message.isDeleted" class="mc-deleted">
        {{ message.sent ? $t('MainChat.deleted_by_you') : $t('MainChat.deleted') }}
    </span>

    <template v-else>
        <!-- quoted reply: a left rule and one muted line, never a nested card -->
        <div v-if="message.hasReply" class="mc-quote">
            <b>{{ replyAuthor }}</b>
            <span v-if="replyPreview"> · {{ replyPreview }}</span>
        </div>

        <!-- any attachment: image, audio, video or file -->
        <MainChatMedia v-if="isMedia" :message="message" @preview="$emit('preview')" />

        <!-- text / link — rendered exactly as the existing comment renderer does:
             stored text is HTML-escaped on write, changeText() turns mention
             tokens into markup, and v-html renders the entities back as text. -->
        <span v-else v-html="renderedBody"></span>
    </template>
</template>

<script setup>
import { computed, defineProps, defineEmits } from 'vue';
import { useCustomComposable, useGetterFunctions } from '@/composable';
import MainChatMedia from './MainChatMedia.vue';

const props = defineProps({
    message: { type: Object, required: true },
});

defineEmits(['preview']);

const { changeText, checkLink } = useCustomComposable();
const { getUser } = useGetterFunctions();

const isMedia = computed(() => !['text', 'link'].includes(props.message.type));

/**
 * The message body: mentions rendered, then URLs turned into anchors.
 *
 * Linkified for EVERY text message, not just `type === 'link'`. Nothing in the send
 * path ever writes that type — so the old condition was unreachable and a pasted URL
 * always rendered as dead text. Doing it here also covers a link sitting among other
 * words, which a type flag on the whole message never could.
 *
 * Order matters: changeText() first, so mention markup exists, then checkLink() over
 * the result. Safe because the stored text was HTML-escaped on write, and checkLink
 * only wraps http/https/ftp matches — a `javascript:` URL cannot match its pattern.
 */
const renderedBody = computed(() => {
    const rendered = changeText(String(props.message.message || ''));
    return checkLink(rendered, true);
});

const replyAuthor = computed(() => {
    const user = props.message.reply_userId ? getUser(props.message.reply_userId) : null;
    return (user && user.Employee_Name) || props.message.reply_userName || '';
});

const replyPreview = computed(() => {
    const text = props.message.reply_message || props.message.reply_mediaOriginalName || '';
    const plain = String(text).replace(/<[^>]*>/g, '');
    return plain.length > 70 ? `${plain.slice(0, 70)}…` : plain;
});
</script>
