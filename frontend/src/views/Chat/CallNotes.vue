<template>
    <div class="ah-page cn">
        <div class="ah-toolbar">
            <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" @click="goBack">
                <ShellIcon name="chevronLeft" :size="15" />{{ $t('Chat.back_to_chat') }}
            </button>
            <div class="ah-toolbar__title">
                <ShellIcon name="mic" :size="16" />
                <span>{{ notes.title || $t('Chat.meeting_notes') }}</span>
                <span v-if="notes.durationSec" class="ah-chip ah-chip--mono">{{ duration }}</span>
            </div>
            <div class="ah-toolbar__spacer"></div>
            <div v-if="participants.length" class="cn__people">
                <span v-for="p in participants" :key="p.id" class="ah-avatar ah-avatar--sm" :class="{ 'ah-avatar--agent': p.isAgent }" :title="p.name">{{ p.initial }}</span>
            </div>
        </div>

        <div v-if="loading" class="cn__body"><div class="ah-empty">{{ $t('Chat.loading_notes') }}</div></div>
        <div v-else-if="error" class="cn__body"><div class="ah-empty">{{ error }}</div></div>

        <div v-else class="cn__body ah-scroll">
            <div class="cn__note ah-small">
                <ShellIcon name="lock" :size="13" />
                <span>{{ $t('Chat.notes_private') }}</span>
            </div>

            <div class="ah-tabs cn__tabs">
                <button type="button" class="ah-tab" :class="{ 'is-active': tab === 'summary' }" @click="tab = 'summary'">{{ $t('Chat.live_notes') }}</button>
                <button type="button" class="ah-tab" :class="{ 'is-active': tab === 'transcript' }" @click="tab = 'transcript'">{{ $t('Chat.transcript') }}</button>
                <button type="button" class="ah-tab" :class="{ 'is-active': tab === 'actions' }" @click="tab = 'actions'">
                    {{ $t('Chat.action_items') }}<span v-if="items.length" class="cn__count ah-mono">{{ items.length }}</span>
                </button>
            </div>

            <template v-if="tab === 'summary'">
                <div class="ah-label">{{ $t('Chat.summary_so_far') }}</div>
                <p v-if="notes.summary" class="cn__summary">{{ notes.summary }}</p>
                <div v-else class="ah-empty">{{ $t('Chat.summary_empty') }}</div>
            </template>

            <template v-else-if="tab === 'transcript'">
                <div class="ah-label">{{ $t('Chat.transcript') }}</div>
                <pre v-if="notes.transcript" class="cn__transcript">{{ notes.transcript }}</pre>
                <div v-else class="ah-empty">{{ $t('Chat.transcript_empty') }}</div>
            </template>

            <template v-else>
                <div class="ah-label">{{ $t('Chat.action_items') }}</div>
                <div v-if="!items.length" class="ah-empty">{{ $t('Chat.no_action_items') }}</div>
                <ul v-else class="cn__items">
                    <li v-for="(item, i) in items" :key="i" class="cn__item">
                        <div class="cn__item-main">
                            <span class="cn__item-title">{{ item.title }}</span>
                            <span class="cn__item-meta ah-mono">
                                <template v-if="item.owner">{{ item.owner }}</template>
                                <template v-if="item.due"> · {{ item.due }}</template>
                                <template v-if="item.at"> · {{ $t('Chat.from_timestamp', { at: item.at }) }}</template>
                            </span>
                        </div>
                        <router-link v-if="item.taskId" class="ah-chip ah-chip--ok" :to="taskRoute(item)">
                            <ShellIcon name="check" :size="12" />{{ $t('Chat.created') }}
                        </router-link>
                        <button v-else type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="draft = { index: i, title: item.title }">
                            {{ $t('Chat.create_task') }}
                        </button>
                    </li>
                </ul>
            </template>
        </div>

        <MakeTaskSheet
            v-if="draft"
            :initialTitle="draft.title"
            :sourceLabel="notes.title || $t('Chat.meeting_notes')"
            :sourceUrl="pageUrl"
            :defaultProjectId="notes.projectId"
            @close="draft = null"
            @created="onTaskCreated"
        />
    </div>
</template>

<script setup>
import { computed, inject, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';
import MakeTaskSheet from '@/components/organisms/MainChat/MakeTaskSheet.vue';
import { useGetterFunctions } from '@/composable';
import { apiRequest } from '@/services';
import * as env from '@/config/env';

defineOptions({ name: 'CallNotesView' });

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const companyId = inject('$companyId');
const { getUser } = useGetterFunctions();

const loading = ref(true);
const error = ref('');
const notes = ref({});
const tab = ref('summary');
const draft = ref(null);

const items = computed(() => notes.value.actionItems || []);
const pageUrl = computed(() => `${window.location.origin}${window.location.pathname}#${route.fullPath}`);

const duration = computed(() => {
    const total = Number(notes.value.durationSec) || 0;
    const m = Math.floor(total / 60);
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
});

const participants = computed(() => (notes.value.participants || []).map((p) => {
    const id = typeof p === 'string' ? p : p.userId || p.id || '';
    const user = getUser(id) || {};
    const name = user.Employee_Name || (typeof p === 'object' && p.name) || '—';
    return { id, name, initial: name.charAt(0).toUpperCase(), isAgent: typeof p === 'object' && p.actorType === 'agent' };
}));

const taskRoute = (item) => ({
    name: 'ProjectSprintTask',
    params: { cid: companyId.value, id: item.projectId || notes.value.projectId, sprintId: item.sprintId || notes.value.sprintId, taskId: item.taskId },
    query: { detailTab: 'task-detail-tab' }
});

const goBack = () => {
    if (notes.value.projectId && notes.value.chatId) {
        router.push({ name: 'chat_project_channel', params: { cid: companyId.value, pid: notes.value.projectId, sid: notes.value.chatId } });
        return;
    }
    router.push({ name: 'chats', params: { cid: companyId.value } });
};

const onTaskCreated = (created) => {
    const index = draft.value?.index;
    draft.value = null;
    if (index === undefined || !created?.id) return;
    const next = items.value.slice();
    next[index] = { ...next[index], taskId: created.id, projectId: created.project?._id, sprintId: created.sprint?._id };
    notes.value = { ...notes.value, actionItems: next };
    apiRequest('patch', `${env.CALL_NOTES}/${route.params.noteId}`, { actionItems: next }).catch(() => {});
};

onMounted(async () => {
    try {
        const res = await apiRequest('get', `${env.CALL_NOTES}/${route.params.noteId}`);
        if (!res?.data?.status) {
            error.value = res?.data?.statusText || t('Chat.notes_not_found');
            return;
        }
        notes.value = res.data.data || {};
        if (!notes.value.summary && items.value.length) tab.value = 'actions';
    } catch (e) {
        error.value = t('Chat.notes_not_found');
    } finally {
        loading.value = false;
    }
});
</script>

<style scoped>
.cn { background: var(--canvas); }
.cn__people { display: flex; gap: -4px; }
.cn__people .ah-avatar { margin-left: -6px; border: 2px solid var(--surface); }
.cn__body { flex: 1; min-height: 0; overflow: auto; padding: 20px 24px; max-width: 820px; width: 100%; }
.cn__note { display: flex; align-items: center; gap: 8px; padding: 9px 12px; border-radius: var(--r-input); background: var(--surface-2); border: 1px solid var(--hairline); margin-bottom: 14px; }
.cn__tabs { margin-bottom: 16px; }
.cn__count { margin-left: 6px; color: var(--ink-2); }
.cn__summary { font: var(--text-body); color: var(--ink); background: var(--surface); border: 1px solid var(--hairline); border-radius: var(--r-card); padding: 14px 16px; margin: 8px 0 0; }
.cn__transcript { font: 400 12.5px/1.6 var(--font-mono); color: var(--ink); background: var(--surface); border: 1px solid var(--hairline); border-radius: var(--r-card); padding: 14px 16px; margin: 8px 0 0; white-space: pre-wrap; word-break: break-word; }
.cn__items { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.cn__item { display: flex; align-items: center; gap: 12px; padding: 11px 14px; background: var(--surface); border: 1px solid var(--hairline); border-radius: var(--r-card); box-shadow: var(--shadow-card); }
.cn__item-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.cn__item-title { font: 500 13px/1.35 var(--font-ui); color: var(--ink); }
.cn__item-meta { color: var(--ink-2); }
@media (max-width: 768px) { .cn__body { padding: 14px; } }
</style>
