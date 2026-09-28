<template>
    <div class="cm-thread" :class="{ 'is-sent': message.sent }">
        <CommentAssignment :comment="message" :people="people" />
        <div class="cm-thread__bar">
            <button
                v-if="count"
                type="button"
                class="cm-thread__toggle"
                data-test="thread-toggle"
                :aria-expanded="open ? 'true' : 'false'"
                :aria-controls="listId"
                @click="toggle"
            >{{ open ? $t('Comments.hide_replies') : $t('Comments.replies_count', { n: count }, count) }}</button>
            <button type="button" class="cm-thread__toggle" data-test="reply-open" @click="startReply">{{ $t('Comments.reply_in_thread') }}</button>
            <span v-if="aiStateKey" class="cm-thread__ai-state" role="status" data-test="ai-state">{{ $t(aiStateKey) }}</span>
        </div>
        <div v-if="open" :id="listId" class="cm-thread__body" role="group" :aria-label="$t('Comments.thread_label')">
            <p v-if="loading" class="cm-thread__hint">{{ $t('Comments.loading_replies') }}</p>
            <p v-else-if="loadError" class="cm-thread__hint" role="alert">{{ loadError }}</p>
            <ol class="cm-thread__list">
                <li v-for="reply in replies" :key="reply._id" class="cm-thread__reply" data-test="reply">
                    <div class="cm-thread__head">
                        <template v-if="aiAuthorOf(reply)">
                            <span class="ah-avatar ah-avatar--sm ah-avatar--agent cm-thread__ai-avatar" aria-hidden="true">{{ AI_MENTION_NAME }}</span>
                            <strong class="cm-thread__name" data-test="ai-author">{{ $t('AiMention.author') }}</strong>
                            <span class="ah-chip ah-chip--agent ah-chip--mono cm-thread__ai-for" data-test="ai-for">{{ $t('AiMention.answered_for', { name: askerName(reply) }) }}</span>
                        </template>
                        <template v-else>
                            <UserProfile
                                :showDot="false"
                                class="cm-thread__avatar"
                                :data="{ id: reply.userId, title: authorName(reply), image: getUser(reply.userId)?.Employee_profileImageURL }"
                                width="22px"
                                :thumbnail="'30x30'"
                            />
                            <strong class="cm-thread__name">{{ authorName(reply) }}</strong>
                        </template>
                        <time class="cm-thread__time" :datetime="reply.createdAt">{{ stamp(reply.createdAt) }}</time>
                    </div>
                    <div v-if="aiAuthorOf(reply)" class="cm-thread__text cm-thread__ai-body" v-html="aiAnswerHtml(reply, { router: routerOf(), companyId: unref(companyId) })" @click="(event) => followCitation(event, reply)"></div>
                    <pre v-else class="cm-thread__text" v-html="commentHtml(reply.message, { links: reply.type === 'link' })"></pre>
                    <CommentAssignment :comment="reply" :people="people" />
                </li>
            </ol>
            <form class="cm-thread__composer" @submit.prevent="send">
                <textarea
                    ref="composer"
                    v-model="draft"
                    class="ah-input ah-textarea cm-thread__input"
                    rows="2"
                    data-test="reply-input"
                    :placeholder="$t('Comments.reply_placeholder')"
                    :aria-label="$t('Comments.reply_placeholder')"
                    @keydown.enter.exact.prevent="send"
                    @keydown.esc.stop="closeComposer"
                ></textarea>
                <div class="cm-thread__actions">
                    <span v-if="sendError" class="cm-thread__error" role="alert">{{ sendError }}</span>
                    <button type="submit" class="ah-btn ah-btn--primary ah-btn--sm" data-test="reply-send" :disabled="sending || !draft.trim()">{{ $t('Comments.send_reply') }}</button>
                </div>
            </form>
        </div>
    </div>
</template>

<script setup>
import { computed, getCurrentInstance, inject, nextTick, ref, unref } from "vue";
import { useI18n } from "vue-i18n";
import { useGetterFunctions } from "@/composable";
import { commentHtml } from "@/utils/commentHtml";
import { useToast } from "vue-toast-notification";
import { AI_MENTION_NAME, AI_MENTION_NOTICES, aiAnswerHtml, aiAskStateOf, aiAuthorOf, citationTarget } from "@/utils/aiMention";
import { loadReplies, repliesOf, replyCountOf, sendReply, threadStore } from "@/composable/commentThreads";
import UserProfile from "@/components/atom/UserProfile/UserProfile.vue";
import CommentAssignment from "./CommentAssignment.vue";

defineOptions({ name: "CommentThread" });

const props = defineProps({
    message: { type: Object, required: true },
    people: { type: Array, default: () => [] }
});

const { t } = useI18n();
const { getUser } = useGetterFunctions();

const open = ref(false);
const loading = ref(false);
const loadError = ref("");
const draft = ref("");
const sending = ref(false);
const sendError = ref("");
const composer = ref(null);

const parentId = computed(() => String(props.message?._id || ""));
const listId = computed(() => `thread_${parentId.value}`);
const replies = computed(() => repliesOf(parentId.value));
const count = computed(() => replyCountOf(props.message));

const authorName = (row) => getUser(row.userId)?.Employee_Name || t("Comments.someone");
const askerName = (row) => getUser(row.aiAskerId)?.Employee_Name || t("Comments.someone");

const companyId = inject("$companyId", "");
const instance = getCurrentInstance();
const routerOf = () => (instance && instance.proxy && instance.proxy.$router) || null;

const AI_STATE_KEYS = { answering: "AiMention.answering", failed: "AiMention.failed" };
const aiStateKey = computed(() => AI_STATE_KEYS[aiAskStateOf(props.message)] || "");

const $toast = useToast();
function noticeAi(ai) {
    const key = AI_MENTION_NOTICES[ai && ai.code];
    if (key) $toast.info(t(key), { position: "top-right" });
}

function followCitation(event, row) {
    const to = citationTarget(event, row, unref(companyId));
    const router = routerOf();
    if (!to || !router) return;
    event.preventDefault();
    router.push(to);
}
const stamp = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

async function ensureLoaded() {
    if (threadStore.loaded[parentId.value]) return;
    loading.value = true;
    loadError.value = "";
    try {
        await loadReplies(parentId.value);
    } catch (e) {
        loadError.value = t("Comments.replies_failed");
    } finally {
        loading.value = false;
    }
}

async function toggle() {
    open.value = !open.value;
    if (open.value) await ensureLoaded();
}

async function startReply() {
    open.value = true;
    await nextTick();
    composer.value?.focus();
    await ensureLoaded();
}

function closeComposer() {
    draft.value = "";
    if (!count.value) open.value = false;
}

async function send() {
    if (sending.value || !draft.value.trim()) return;
    sending.value = true;
    sendError.value = "";
    try {
        await ensureLoaded();
        await sendReply(props.message, draft.value, { onAi: noticeAi });
        draft.value = "";
    } catch (e) {
        sendError.value = e?.response?.data?.message || t("Comments.reply_failed");
    } finally {
        sending.value = false;
    }
}
</script>

<style scoped>
.cm-thread { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; max-width: 100%; min-width: 0; }
.cm-thread.is-sent { align-items: flex-end; }
.cm-thread__bar { display: flex; gap: 8px; flex-wrap: wrap; }
.cm-thread__toggle { background: none; border: 0; padding: 2px 4px; font-size: 12px; font-weight: 600; color: var(--brand); cursor: pointer; border-radius: 4px; }
.cm-thread__toggle:hover { text-decoration: underline; }
.cm-thread__toggle:focus-visible { outline: 2px solid var(--focus, var(--brand)); outline-offset: 1px; }
.cm-thread__body { width: min(560px, 100%); box-sizing: border-box; border-left: 2px solid var(--hairline); padding: 4px 0 4px 10px; display: flex; flex-direction: column; gap: 8px; align-self: stretch; }
.cm-thread__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.cm-thread__reply { background: var(--surface-2); border-radius: 8px; padding: 6px 8px; min-width: 0; }
.cm-thread__head { display: flex; align-items: center; gap: 6px; font-size: 12px; min-width: 0; }
.cm-thread__name { color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cm-thread__time { color: var(--ink-2); white-space: nowrap; }
.cm-thread__text { margin: 4px 0; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; color: var(--ink); }
.cm-thread__hint { margin: 0; font-size: 12px; color: var(--ink-2); }
.cm-thread__composer { display: flex; flex-direction: column; gap: 6px; }
.cm-thread__input { width: 100%; box-sizing: border-box; resize: vertical; }
.cm-thread__actions { display: flex; justify-content: flex-end; align-items: center; gap: 8px; }
.cm-thread__error { color: var(--danger-ink, var(--danger)); font-size: 12px; margin-right: auto; }
.cm-thread__ai-state { font-size: 12px; color: var(--ink-2); padding: 2px 4px; }
.cm-thread__ai-for { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cm-thread__ai-body { white-space: normal; }
.cm-thread__ai-body :deep(p), .cm-thread__ai-body :deep(ul), .cm-thread__ai-body :deep(ol) { margin: 0 0 6px; }
.cm-thread__ai-body :deep(ul), .cm-thread__ai-body :deep(ol) { padding-left: 20px; }
.cm-thread__ai-body :deep(.ask-cite) { color: var(--brand); font-weight: 600; }
.cm-thread__ai-body :deep(a.ask-cite:focus-visible) { outline: 2px solid var(--focus, var(--brand)); outline-offset: 1px; }
</style>
