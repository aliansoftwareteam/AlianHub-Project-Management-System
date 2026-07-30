<template>
  <!--
    The scroller is wrapped so the jump button can be positioned against the VISIBLE
    bottom of the feed. Absolutely positioning it inside the scroller measured from
    the bottom of the content instead, i.e. off-screen precisely when the reader has
    scrolled up and needs it.
  -->
  <div class="mc-feed-wrap">
    <div class="mc-feed" ref="feed" @scroll.passive="onScroll">
        <!-- skeleton instead of an empty white panel while switching conversation -->
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

            <!-- pushes a short transcript to the bottom so it never floats mid-panel -->
            <div class="mc-feed-spacer"></div>

            <div v-if="!messages.length" class="mc-empty">
                <b>{{ emptyTitle }}</b>
                <span>{{ $t('MainChat.empty_hint') }}</span>
            </div>

            <template v-for="row in rows" :key="row.key">
                <div v-if="row.kind === 'day'" class="mc-day"><span>{{ row.label }}</span></div>
                <!-- "where you left off": everything below this line arrived while
                     you were away -->
                <div v-else-if="row.kind === 'unread'" class="mc-unread"><span>{{ row.label }}</span></div>
                <MainChatMessage
                    v-else
                    :message="row.message"
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
                />
            </template>
        </template>

    </div>

    <!-- Back to the newest message. One control for both jobs: it appears once you
         have scrolled up a fair way, and carries the unseen count when messages
         arrived while you were reading back — rather than two overlapping affordances
         competing for the same corner. -->
    <Transition name="mc-jump">
        <button
            v-if="showJump"
            type="button"
            class="mc-jump"
            :title="$t('MainChat.jump_latest')"
            @click="scrollToBottom(true)"
        >
            <MainChatIcon name="chevron-down" :size="15" />
            <span v-if="unseen" class="mc-jump-count">{{ unseen > 99 ? '+99' : unseen }}</span>
        </button>
    </Transition>
  </div>
</template>

<script setup>
/**
 * Scroll + grouping rules for the transcript.
 *
 * Grouping: consecutive messages from the same author inside GROUP_WINDOW render
 * as continuations (no repeated avatar / name / timestamp).
 *
 * Scrolling follows the agreed contract: we only auto-stick to the bottom when
 * the reader is already there. An incoming message while they are reading
 * history leaves the position alone and offers a "new messages" pill instead —
 * yanking the viewport is the single most annoying chat behaviour.
 */
import { computed, defineProps, defineEmits, inject, nextTick, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useStore } from 'vuex';
import { useGetterFunctions } from '@/composable';
import MainChatMessage from './MainChatMessage.vue';
import MainChatIcon from './MainChatIcon.vue';

const GROUP_WINDOW = 5 * 60 * 1000; // 5 minutes
const AT_BOTTOM_SLACK = 48;         // px from the bottom still counts as "at bottom"
const NEAR_TOP = 60;                // px from the top triggers an older page
// Comfortably past AT_BOTTOM_SLACK, so the button does not blink in and out on the
// small scrolls that happen while reading the last few messages.
const SHOW_JUMP_AFTER = 260;        // px from the bottom before the jump button appears

const props = defineProps({
    messages: { type: Array, default: () => [] },
    loading: { type: Boolean, default: false },
    loadingOlder: { type: Boolean, default: false },
    hasMore: { type: Boolean, default: false },
    emptyTitle: { type: String, default: '' },
    // Where the reader left off. Anchored to a message ID rather than an offset so
    // sending a message, or paging in older ones, cannot make the line drift.
    unreadAnchorId: { type: String, default: '' },
    unreadCount: { type: Number, default: 0 },
});

const emit = defineEmits(['load-older', 'reply', 'copy', 'remove', 'retry', 'preview', 'react', 'pin', 'mark-unread', 'edit']);

const { getUser } = useGetterFunctions();
const { getters } = useStore();
const userId = inject('$userId');
const { t } = useI18n();

const feed = ref(null);
const atBottom = ref(true);
const unseen = ref(0);
const distanceFromBottom = ref(0);

// Shown on a deliberate scroll back, or whenever something arrived unseen — in which
// case even a small scroll up should still offer the way back.
const showJump = computed(() => distanceFromBottom.value > SHOW_JUMP_AFTER || unseen.value > 0);

// Scroll anchoring for prepended pages, plus the edge ids used to tell a
// prepend from an append. Plain variables: they must not trigger re-renders.
let anchor = null;
let prevFirstId = '';
let prevLastId = '';

function keyOf(msg) {
    if (!msg) return '';
    return String(msg._id || msg.tempId || '');
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
    return new Date(ts).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' });
}

const unreadLabel = computed(() => (props.unreadCount === 1
    ? t('MainChat.unread_one')
    : t('MainChat.unread_many', { count: props.unreadCount })));

/** Flattened render list: day + unread dividers interleaved with messages. */
const rows = computed(() => {
    const out = [];
    let lastDay = null;
    let previous = null;
    // Keys must be unique or Vue patches a keyed child against a vnode that was never
    // mounted — "Cannot read properties of null (reading 'emitsOptions')", which takes
    // the whole view down. Duplicates should not happen, but a crash is far too high a
    // price for a list that briefly holds the same id twice, so collisions are made
    // unique here. Stable in the normal case: only a repeat gets the suffix.
    const seenKeys = new Set();

    props.messages.forEach((message, index) => {
        let key = message._id || message.tempId || `i${index}`;
        if (seenKeys.has(key)) key = `${key}__${index}`;
        seenKeys.add(key);

        const day = dayKey(message);

        if (day && day !== lastDay) {
            out.push({ kind: 'day', key: `day_${day}_${key}`, label: dayLabel(day) });
            lastDay = day;
            previous = null; // a divider always breaks a run
        }

        if (props.unreadAnchorId && keyOf(message) === props.unreadAnchorId) {
            out.push({ kind: 'unread', key: `unread_${key}`, label: unreadLabel.value });
            previous = null; // and so does this one
        }

        const continuation = !!previous
            && previous.userId === message.userId
            && !previous.isDeleted
            && !message.isDeleted
            && Math.abs(timeOf(message) - timeOf(previous)) < GROUP_WINDOW;

        out.push({ kind: 'msg', key, message, continuation, continued: false });
        previous = message;
    });

    // Second pass for the OTHER end of a run: `continuation` says a message follows
    // one from the same author, but the bubble corners also need to know whether the
    // run carries on BELOW it. Cheaper to look forward once here than to have every
    // bubble reach into its siblings.
    for (let index = 0; index < out.length; index += 1) {
        if (out[index].kind !== 'msg') continue;
        const next = out[index + 1];
        out[index].continued = !!(next && next.kind === 'msg' && next.continuation);
    }

    return out;
});

/**
 * Has this author left the company?
 *
 * getUser() reports EVERYONE as a ghost until the users store has loaded, which
 * would relabel the whole transcript for a moment on open — hence the guard.
 */
/**
 * The reader's clock preference, resolved once for the whole transcript rather than in
 * every bubble. Stored per user as '12' | '24' with 12-hour as the base — the timesheet
 * views read it the same way, converting to 24-hour only when it says so.
 */
const use12Hour = computed(() => String((getUser(userId.value) || {}).timeFormat || '12') !== '24');

const usersLoaded = computed(() => ((getters['users/users'] || []).length > 0));

function isFormerMember(user) {
    return usersLoaded.value && !!(user && user.ghostUser);
}

function senderName(message) {
    if (message.sent) return t('MainChat.you');
    const user = getUser(message.userId) || {};
    // Their messages stay — deleting history would be far worse — but they are
    // labelled neutrally instead of exposing the "Ghost User" placeholder, or the
    // raw email address getUser() substitutes for a deleted member's name.
    if (isFormerMember(user)) return t('MainChat.former_member');
    return user.Employee_Name || '';
}

function senderSrc(message) {
    const user = getUser(message.userId) || {};
    // '' falls back to initials, so the ghost graphic is never rendered either.
    if (isFormerMember(user)) return '';
    return user.Employee_profileImageURL || '';
}

function scrollToBottom(smooth = false) {
    const el = feed.value;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    atBottom.value = true;
    unseen.value = 0;
    // Hide the button immediately rather than waiting out a smooth scroll's events.
    distanceFromBottom.value = 0;
}

/**
 * Where to land when a conversation opens.
 *
 * On the unread divider when there is one — the point of the line is to be the
 * first thing you see, so opening at the newest message and making the reader
 * scroll back up would defeat it. Otherwise, the bottom.
 *
 * Measured with rects rather than offsetTop, which is relative to the nearest
 * positioned ancestor and would be wrong here.
 */
function scrollToOpeningPosition() {
    const el = feed.value;
    if (!el) return scrollToBottom();

    const line = el.querySelector('.mc-unread');
    if (!line) return scrollToBottom();

    el.scrollTop += (line.getBoundingClientRect().top - el.getBoundingClientRect().top) - 24;
    unseen.value = 0;
    // Landing on the divider usually leaves plenty of transcript below, so let the
    // measurement decide whether the jump button belongs on screen.
    measure();
    return undefined;
}

/**
 * Ask for an older page, remembering where the reader currently is.
 *
 * Older messages are PREPENDED, which grows the content above the viewport — so
 * without this the browser keeps the same scrollTop and the reader appears to
 * jump backwards. Capturing scrollHeight/scrollTop here lets us re-anchor once
 * the new rows are in the DOM.
 */
function requestOlder() {
    const el = feed.value;
    if (!el || props.loadingOlder || props.loading || !props.hasMore) return;
    anchor = { scrollHeight: el.scrollHeight, scrollTop: el.scrollTop };
    emit('load-older');
}

/** Read the scroll position once and derive everything that depends on it. */
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
    if (el && el.scrollTop <= NEAR_TOP) {
        requestOlder();
    }
}

/**
 * The list can grow at either end, and the two cases need opposite handling:
 *
 *   PREPEND (an older page)  -> keep the reader exactly where they were.
 *   APPEND  (a new message)  -> follow it only if it is mine, or if they are
 *                               already at the bottom; otherwise offer the pill.
 *
 * They are told apart by whether the FIRST or the LAST id changed. The previous
 * version only looked at the length and then inspected the last message, so a
 * prepended page whose newest existing message happened to be mine was treated
 * as "I just sent something" and scrolled to the bottom — which is why loading
 * older messages always jumped down.
 */
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
        // Restore before the browser paints, so there is no visible jump.
        nextTick(() => {
            if (!feed.value) return;
            feed.value.scrollTop = feed.value.scrollHeight - saved.scrollHeight + saved.scrollTop;
        });
        return;
    }

    if (!appended) return;

    const latest = props.messages[props.messages.length - 1];
    const mine = latest && (latest.sent || latest.isSending);

    if (mine || atBottom.value) {
        nextTick(() => scrollToBottom());
    } else {
        unseen.value += now - before;
    }
});

watch(() => props.loading, (isLoading) => {
    if (isLoading) {
        // switching conversation: any anchor from the previous one is meaningless
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
