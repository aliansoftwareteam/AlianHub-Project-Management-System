<template>
    <aside class="mc-info mc-srch">
        <div class="mc-info-top">
            <span class="mc-info-title">{{ isPinned ? $t('MainChat.pinned_messages') : $t('MainChat.search') }}</span>
            <button type="button" class="mc-icon-btn" :title="$t('MainChat.cancel')" @click="$emit('close')">
                <MainChatIcon name="close" :size="15" />
            </button>
        </div>

        <div v-if="!isPinned" class="mc-srch-box">
            <input
                ref="field"
                v-model="query"
                type="text"
                class="mc-srch-input"
                :placeholder="$t('MainChat.search_placeholder')"
                @keydown.esc="query ? (query = '') : $emit('close')"
            />
            <button v-if="query" type="button" class="mc-srch-clear" :title="$t('MainChat.cancel')" @click="query = ''">
                <MainChatIcon name="close" :size="13" />
            </button>
        </div>

        <div class="mc-srch-body style-scroll" ref="body" @scroll.passive="onScroll">
            <!-- search only: nothing typed yet -->
            <p v-if="!isPinned && !term" class="mc-srch-hint">{{ $t('MainChat.search_hint') }}</p>

            <!-- first page in flight -->
            <div v-else-if="loading && !results.length" class="mc-srch-skel">
                <span v-for="n in 5" :key="n"></span>
            </div>

            <p v-else-if="!results.length" class="mc-srch-hint">
                {{ isPinned ? $t('MainChat.pinned_none') : $t('MainChat.search_none') }}
            </p>

            <template v-else>
                <p class="mc-srch-count">{{ countLabel }}</p>

                <div v-for="item in results" :key="item._id" class="mc-srch-item">
                <button
                    type="button"
                    class="mc-srch-row"
                    @click="$emit('open', item)"
                >
                    <MainChatAvatar :name="senderName(item)" :src="senderSrc(item)" :size="28" />
                    <span class="mc-srch-main">
                        <span class="mc-srch-meta">
                            <b>{{ senderName(item) }}</b>
                            <i>{{ when(item) }}</i>
                        </span>

                        <!-- attachment hit: the file itself, opened in the previewer -->
                        <span v-if="isAttachment(item)" class="mc-srch-file">
                            <span class="mc-file-ic">{{ ext(item) }}</span>
                            <span class="mc-srch-file-name" v-html="highlight(fileName(item))"></span>
                        </span>

                        <!-- text hit: one line, match marked -->
                        <span v-else class="mc-srch-text" v-html="snippet(item)"></span>
                    </span>
                </button>

                    <!-- Unpin without leaving the list: finding a pinned message and
                         releasing it are the same task. -->
                    <button
                        v-if="isPinned"
                        type="button"
                        class="mc-srch-unpin"
                        :title="$t('MainChat.unpin')"
                        @click.stop="unpin(item)"
                    ><MainChatIcon name="close" :size="12" /></button>
                </div>

                <div v-if="loading" class="mc-srch-more">{{ $t('MainChat.loading') }}</div>
            </template>
        </div>
    </aside>
</template>

<script setup>
/**
 * Search within the open conversation.
 *
 * Occupies the same right-hand column as the details pane (the two are mutually
 * exclusive) and reuses its chrome, so the header strips line up.
 *
 * Server-side, not a filter over the loaded transcript: matches have to include
 * messages far older than what is on screen. Uses the existing
 * comments/get-searched-messages endpoint — the same one the legacy filter
 * sidebar calls — which matches message text, the stored filename and the
 * original upload filename.
 */
import { computed, defineProps, defineEmits, nextTick, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useStore } from 'vuex';
import { useConvertDate, useCustomComposable, useGetterFunctions } from '@/composable';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import MainChatAvatar from './MainChatAvatar.vue';
import MainChatIcon from './MainChatIcon.vue';

const PER_PAGE = 25;

const props = defineProps({
    projectId: { type: String, default: '' },
    sprintId: { type: String, default: '' },
    taskId: { type: String, default: '' },
    // Reset back to a blank search when the conversation changes.
    conversationKey: { type: String, default: '' },
    // 'search' = free-text lookup driven by the input; 'pinned' = the conversation's
    // pinned messages, loaded on open with no input at all. Both read the same
    // endpoint (it already takes isPinnedMessage) and render identical rows, so they
    // share this component rather than duplicating the fetch, paging and row markup.
    mode: { type: String, default: 'search' },
});

const emit = defineEmits(['close', 'open', 'unpin']);

const { t } = useI18n();
const { getters } = useStore();
const { getUser } = useGetterFunctions();
const { debounce, changeText } = useCustomComposable();
const { convertDateFormat } = useConvertDate();

const field = ref(null);
const body = ref(null);
const query = ref('');
const results = ref([]);
const loading = ref(false);
const page = ref(1);
const exhausted = ref(false);

const term = computed(() => query.value.trim());
const isPinned = computed(() => props.mode === 'pinned');

const countLabel = computed(() => {
    if (isPinned.value) return t('MainChat.pinned_count', { count: results.value.length });
    return results.value.length === 1
        ? t('MainChat.search_result_one')
        : t('MainChat.search_result_many', { count: results.value.length });
});

onMounted(() => {
    if (isPinned.value) {
        fetchPage(true);
        return;
    }
    nextTick(() => field.value && field.value.focus());
});

/* ------------------------------------------------------------------ *
 * fetching
 * ------------------------------------------------------------------ */
function fetchPage(reset = false) {
    // An unstarted direct message has no task yet, so there is nothing to look in.
    if (!props.projectId || !props.taskId) return;
    // Search needs something typed; the pinned list is driven by the flag alone.
    if (!isPinned.value && !term.value) return;
    if (loading.value) return;
    if (!reset && exhausted.value) return;

    if (reset) {
        page.value = 1;
        exhausted.value = false;
        results.value = [];
    }

    loading.value = true;
    const url = `${env.API_COMMENTS}/get-searched-messages`
        + `?searchText=${encodeURIComponent(term.value)}`
        + `&projectId=${props.projectId}`
        + `&sprintId=${props.sprintId}`
        + `&taskId=${props.taskId}`
        + `&isPinnedMessage=${isPinned.value}`
        + `&sort=desc`
        + `&skip=${PER_PAGE * (page.value - 1)}`
        + `&limit=${PER_PAGE}`;

    // Remembered so a stale response from a previous term cannot overwrite the
    // current one — typing fast produces overlapping requests.
    const issuedFor = term.value;

    apiRequest('get', url)
        .then((response) => {
            if (issuedFor !== term.value) return;
            const batch = (response && response.data && response.data.data) || [];
            // Paging by skip: a message arriving mid-paging shifts the window and
            // can repeat a row, which Vue would flag as a duplicate key.
            const seen = new Set(results.value.map((x) => String(x._id)));
            results.value = [...results.value, ...batch.filter((x) => !seen.has(String(x._id)))];
            if (batch.length < PER_PAGE) exhausted.value = true;
            else page.value += 1;
        })
        .catch((error) => {
            console.error('MainChat: message search failed', error);
            exhausted.value = true;
        })
        .finally(() => {
            if (issuedFor === term.value) loading.value = false;
        });
}

watch(query, debounce(() => {
    if (!term.value) {
        results.value = [];
        exhausted.value = false;
        page.value = 1;
        return;
    }
    fetchPage(true);
}, 400));

// Switching conversation makes the current results meaningless.
watch(() => props.conversationKey, () => {
    query.value = '';
    results.value = [];
    exhausted.value = false;
    page.value = 1;
    // The pinned list has no input to re-trigger it, so reload for the new conversation.
    if (isPinned.value) fetchPage(true);
});

/**
 * Release a pin and drop the row.
 *
 * Removed locally rather than re-fetched: the parent has already told the server, and
 * a re-fetch would make the row linger for a round trip before disappearing.
 */
function unpin(item) {
    if (!item) return;
    emit('unpin', item);
    results.value = results.value.filter((x) => String(x._id) !== String(item._id));
}

const onScroll = debounce(() => {
    const el = body.value;
    if (!el || loading.value || exhausted.value) return;
    if (el.scrollTop >= el.scrollHeight - el.clientHeight - 200) fetchPage();
}, 200);

/* ------------------------------------------------------------------ *
 * presentation
 * ------------------------------------------------------------------ */
const usersLoaded = computed(() => ((getters['users/users'] || []).length > 0));

function senderName(message) {
    const user = getUser(message.userId) || {};
    // Matches the transcript: someone who has left the company is anonymised
    // rather than shown as the "Ghost User" placeholder or their raw email.
    if (usersLoaded.value && user.ghostUser) return t('MainChat.former_member');
    return user.Employee_Name || '';
}

function senderSrc(message) {
    const user = getUser(message.userId) || {};
    if (usersLoaded.value && user.ghostUser) return '';
    return user.Employee_profileImageURL || '';
}

function when(message) {
    return message.createdAt ? convertDateFormat(message.createdAt) : '';
}

function isAttachment(message) {
    return !['text', 'link'].includes(message.type);
}

function fileName(message) {
    return message.mediaOriginalName || message.mediaName || '';
}

function ext(message) {
    const parts = String(fileName(message)).split('.');
    return parts.length > 1 ? parts.pop().toLowerCase() : 'file';
}

/**
 * Mark the matched run inside a value.
 *
 * Callers must pass TAG-FREE text: the term is injected as `<mark>`, so matching
 * over markup could otherwise split an element. Regex metacharacters in the term
 * are escaped — a search containing `(` used to throw here.
 */
function highlight(value) {
    const text = String(value || '');
    if (!term.value) return text;
    const escaped = term.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return text.replace(new RegExp(`(${escaped})`, 'gi'), '<mark>$1</mark>');
}

/**
 * One line of the message body.
 *
 * changeText() renders mention tokens as markup; stripping the tags afterwards
 * leaves plain "@Name" text and — importantly — nothing for highlight() to break.
 * Character entities are left encoded because the stored message is escaped on
 * write, and v-html decodes them back to the right characters.
 */
function snippet(message) {
    const rendered = changeText(String(message.message || ''));
    const plain = String(rendered).replace(/<[^>]*>/g, '').trim();
    const capped = plain.length > 220 ? `${plain.slice(0, 220)}…` : plain;
    return highlight(capped);
}
</script>
