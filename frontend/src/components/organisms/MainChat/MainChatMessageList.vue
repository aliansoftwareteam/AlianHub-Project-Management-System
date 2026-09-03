<template>
  <div class="mc-feed-wrap">
    <div class="mc-feed" ref="feed" @scroll.passive="onScroll">
        <div v-if="loading" class="mc-skel">
            <div v-for="n in 5" :key="n" class="mc-skel-row">
                <span class="mc-skel-b mc-skel-b--av"></span>
                <div>
                    <span class="mc-skel-b mc-skel-b--w1" style="display:block"></span>
                    <span class="mc-skel-b mc-skel-b--w2" style="display:block"></span>
                </div>
            </div>
        </div>

        <template v-else>
            <div v-if="hasMore" class="mc-older">
                <button type="button" :disabled="loadingOlder" @click="requestOlder">
                    {{ loadingOlder ? $t('MainChat.loading') : $t('MainChat.load_older') }}
                </button>
            </div>

            <div class="mc-feed-spacer"></div>

            <div v-if="!messages.length" class="mc-empty">
                <b>{{ emptyTitle }}</b>
                <span>{{ $t('MainChat.empty_hint') }}</span>
            </div>

            <template v-for="row in rows" :key="row.key">
                <div v-if="row.kind === 'day'" class="mc-day"><span>{{ row.label }}</span></div>
                <div v-else-if="row.kind === 'unread'" class="mc-unread"><span>{{ row.label }}</span></div>
                <MainChatMessage
                    v-else
                    :message="row.message"
                    :siblings="row.siblings"
                    :continuation="row.continuation"
                    :continued="row.continued"
                    :sender-name="senderName(row.message)"
                    :sender-src="senderSrc(row.message)"
                    :hour12="use12Hour"
                    @reply="$emit('reply', $event)"
                    @copy="$emit('copy', $event)"
                    @remove="$emit('remove', $event)"
                    @retry="$emit('retry', $event)"
                    @preview="$emit('preview', $event)"
                    @react="$emit('react', $event)"
                    @pin="$emit('pin', $event)"
                    @mark-unread="$emit('mark-unread', $event)"
                    @edit="$emit('edit', $event)"
                    @make-task="$emit('make-task', $event)"
                    @save-later="$emit('save-later', $event)"
                    @transcribed="$emit('transcribed', $event)"
                />
            </template>

            <Transition name="mc-typing">
                <div v-if="typingIds.length" class="mc-typing-row" :title="typingLabel">
                    <span class="mc-typing-avs">
                        <MainChatAvatar
                            v-for="id in typingIds.slice(0, 3)"
                            :key="id"
                            :name="typerName(id)"
                            :src="typerSrc(id)"
                            :size="26"
                        />
                    </span>
                    <span class="mc-typing-bub">
                        <i class="mc-typing-dots"><b></b><b></b><b></b></i>
                    </span>
                </div>
            </Transition>
        </template>
    </div>

    <Transition name="mc-jump">
        <button
            v-if="showJump"
            type="button"
            class="mc-jump"
            :title="$t('MainChat.jump_latest')"
            @click="scrollToBottom(true)"
        >
            <MainChatIcon name="chevron-down" :size="14" />
            <span v-if="unseen" class="mc-jump-count">{{ unseen > 99 ? '+99' : unseen }}</span>
        </button>
    </Transition>
  </div>
</template>

<script setup>
/**
 * Scroll + grouping rules for the transcript.
 *
 * Consecutive messages from one author inside GROUP_WINDOW render as continuations, and
 * back-to-back attachments from one author fold into a single gallery row. The viewport
 * only sticks to the bottom when the reader is already there; otherwise a new message
 * raises the jump button instead of yanking them down.
 */
import { computed, defineProps, defineEmits, inject, nextTick, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useStore } from 'vuex';
import { useGetterFunctions } from '@/composable';
import MainChatMessage from './MainChatMessage.vue';
import MainChatAvatar from './MainChatAvatar.vue';
import MainChatIcon from './MainChatIcon.vue';

const GROUP_WINDOW = 5 * 60 * 1000;
const AT_BOTTOM_SLACK = 48;
const NEAR_TOP = 60;
const SHOW_JUMP_AFTER = 260;
const GALLERY_TYPES = ['image', 'video', 'file', 'document', 'pdf', 'zip', 'other'];

const props = defineProps({
    messages: { type: Array, default: () => [] },
    loading: { type: Boolean, default: false },
    loadingOlder: { type: Boolean, default: false },
    hasMore: { type: Boolean, default: false },
    emptyTitle: { type: String, default: '' },
    unreadAnchorId: { type: String, default: '' },
    unreadCount: { type: Number, default: 0 },
    typingIds: { type: Array, default: () => [] },
    typingLabel: { type: String, default: '' },
});

const emit = defineEmits(['load-older', 'reply', 'copy', 'remove', 'retry', 'preview', 'react', 'pin', 'mark-unread', 'edit', 'make-task', 'save-later', 'transcribed']);

const { getUser } = useGetterFunctions();
const { getters } = useStore();
const userId = inject('$userId');
const { t } = useI18n();

const feed = ref(null);
const atBottom = ref(true);
const unseen = ref(0);
const distanceFromBottom = ref(0);

const showJump = computed(() => distanceFromBottom.value > SHOW_JUMP_AFTER || unseen.value > 0);

let anchor = null;
let prevFirstId = '';
let prevLastId = '';

function keyOf(msg) {
    return msg ? String(msg._id || msg.tempId || '') : '';
}

function timeOf(msg) {
    const raw = msg && msg.createdAt;
    if (!raw) return 0;
    const date = new Date(raw.seconds ? raw.seconds * 1000 : raw);
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function dayKey(msg) {
    const ts = timeOf(msg);
    return ts ? new Date(ts).setHours(0, 0, 0, 0) : 0;
}

function dayLabel(ts) {
    const today = new Date().setHours(0, 0, 0, 0);
    const yesterday = today - 86400000;
    if (ts === today) return t('MainChat.today');
    if (ts === yesterday) return t('MainChat.yesterday');
    return new Date(ts).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

const unreadLabel = computed(() => (props.unreadCount === 1
    ? t('MainChat.unread_one')
    : t('MainChat.unread_many', { count: props.unreadCount })));

function isGalleryItem(message) {
    return !!message && !message.isDeleted && !message.hasReply
        && !['text', 'link', 'audio'].includes(message.type)
        && (GALLERY_TYPES.includes(message.type) || !!message.mediaURL);
}

const rows = computed(() => {
    const out = [];
    let lastDay = null;
    let previous = null;
    let previousRow = null;
    // Keys must stay unique or Vue patches against a vnode that was never mounted.
    const seenKeys = new Set();

    props.messages.forEach((message, index) => {
        let key = message._id || message.tempId || `i${index}`;
        if (seenKeys.has(key)) key = `${key}__${index}`;
        seenKeys.add(key);

        const day = dayKey(message);
        if (day && day !== lastDay) {
            out.push({ kind: 'day', key: `day_${day}_${key}`, label: dayLabel(day) });
            lastDay = day;
            previous = null;
            previousRow = null;
        }

        const isAnchor = !!props.unreadAnchorId && keyOf(message) === props.unreadAnchorId;
        if (isAnchor) {
            out.push({ kind: 'unread', key: `unread_${key}`, label: unreadLabel.value });
            previous = null;
            previousRow = null;
        }

        const sameRun = !!previous
            && previous.userId === message.userId
            && !previous.isDeleted
            && !message.isDeleted
            && Math.abs(timeOf(message) - timeOf(previous)) < GROUP_WINDOW;

        if (sameRun && previousRow && isGalleryItem(message) && isGalleryItem(previousRow.message) && !isAnchor) {
            previousRow.siblings.push(message);
            previous = message;
            return;
        }

        const row = { kind: 'msg', key, message, siblings: [], continuation: sameRun, continued: false };
        out.push(row);
        previous = message;
        previousRow = row;
    });

    for (let index = 0; index < out.length; index += 1) {
        if (out[index].kind !== 'msg') continue;
        const next = out[index + 1];
        out[index].continued = !!(next && next.kind === 'msg' && next.continuation);
    }

    return out;
});

const use12Hour = computed(() => String((getUser(userId.value) || {}).timeFormat || '12') !== '24');
const usersLoaded = computed(() => ((getters['users/users'] || []).length > 0));

function isFormerMember(user) {
    return usersLoaded.value && !!(user && user.ghostUser);
}

function senderName(message) {
    if (message.sent) return t('MainChat.you');
    const user = getUser(message.userId) || {};
    if (isFormerMember(user)) return t('MainChat.former_member');
    return user.Employee_Name || '';
}

function typerName(id) {
    return (getUser(id) || {}).Employee_Name || '';
}

function typerSrc(id) {
    const user = getUser(id) || {};
    if (usersLoaded.value && user.ghostUser) return '';
    return user.Employee_profileImageURL || '';
}

watch(() => props.typingIds.length, (now, before) => {
    if (now > (before || 0) && atBottom.value) nextTick(() => scrollToBottom(true));
});

function senderSrc(message) {
    const user = getUser(message.userId) || {};
    if (isFormerMember(user)) return '';
    return user.Employee_profileImageURL || '';
}

function scrollToBottom(smooth = false) {
    const el = feed.value;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    atBottom.value = true;
    unseen.value = 0;
    distanceFromBottom.value = 0;
}

function scrollToOpeningPosition() {
    const el = feed.value;
    if (!el) return scrollToBottom();
    const line = el.querySelector('.mc-unread');
    if (!line) return scrollToBottom();
    el.scrollTop += (line.getBoundingClientRect().top - el.getBoundingClientRect().top) - 24;
    unseen.value = 0;
    measure();
    return undefined;
}

function requestOlder() {
    const el = feed.value;
    if (!el || props.loadingOlder || props.loading || !props.hasMore) return;
    anchor = { scrollHeight: el.scrollHeight, scrollTop: el.scrollTop };
    emit('load-older');
}

function measure() {
    const el = feed.value;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    distanceFromBottom.value = distance;
    atBottom.value = distance <= AT_BOTTOM_SLACK;
    if (atBottom.value) unseen.value = 0;
}

function onScroll() {
    measure();
    const el = feed.value;
    if (el && el.scrollTop <= NEAR_TOP) requestOlder();
}

watch(() => props.messages.length, (now, before) => {
    const el = feed.value;
    const firstId = keyOf(props.messages[0]);
    const lastId = keyOf(props.messages[props.messages.length - 1]);
    const grew = now > before;
    const prepended = grew && !!firstId && firstId !== prevFirstId;
    const appended = grew && !!lastId && lastId !== prevLastId;

    prevFirstId = firstId;
    prevLastId = lastId;

    if (prepended) {
        const saved = anchor;
        anchor = null;
        if (!saved || !el) return;
        nextTick(() => {
            if (!feed.value) return;
            feed.value.scrollTop = feed.value.scrollHeight - saved.scrollHeight + saved.scrollTop;
        });
        return;
    }

    if (!appended) return;

    const latest = props.messages[props.messages.length - 1];
    const mine = latest && (latest.sent || latest.isSending);

    if (mine || atBottom.value) nextTick(() => scrollToBottom());
    else unseen.value += now - before;
});

watch(() => props.loading, (isLoading) => {
    if (isLoading) {
        anchor = null;
        prevFirstId = '';
        prevLastId = '';
        return;
    }
    prevFirstId = keyOf(props.messages[0]);
    prevLastId = keyOf(props.messages[props.messages.length - 1]);
    nextTick(() => scrollToOpeningPosition());
});

onMounted(() => nextTick(() => scrollToOpeningPosition()));

defineExpose({ scrollToBottom });
</script>
