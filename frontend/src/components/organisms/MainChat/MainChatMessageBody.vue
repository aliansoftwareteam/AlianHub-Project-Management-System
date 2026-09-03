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
            <div v-if="gallery.length > 1" class="mc-gallery-hint">{{ $t('ChatV2.lightbox_hint') }}</div>
        </template>

        <span v-else v-html="renderedBody"></span>
    </template>
</template>

<script setup>
import { computed, defineProps, defineEmits } from 'vue';
import { useCustomComposable, useGetterFunctions } from '@/composable';
import MainChatMedia from './MainChatMedia.vue';

const props = defineProps({
    message: { type: Object, required: true },
    siblings: { type: Array, default: () => [] },
});

defineEmits(['preview', 'make-task', 'transcribed']);

const { changeText, checkLink } = useCustomComposable();
const { getUser } = useGetterFunctions();

const isMedia = computed(() => !['text', 'link'].includes(props.message.type));
const gallery = computed(() => [props.message, ...props.siblings]);

// Mentions first so their markup exists, then URLs. Stored text was escaped on write and
// checkLink only wraps http/https/ftp matches, so a javascript: URL cannot get through.
const renderedBody = computed(() => checkLink(changeText(String(props.message.message || '')), true));

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
