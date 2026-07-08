<template>
    <div class="dev-chat">
        <!-- repo bar: temporary, per-conversation (not persisted) -->
        <div class="dev-repo">
            <input v-model="repo" type="text" class="dev-repo-input" placeholder="Repository — git URL or local path (e.g. https://github.com/org/x.git)" />
            <input v-model="base" type="text" class="dev-repo-base" placeholder="main" title="Base branch — for a git repo, the AI checks this out, branches its work from it, and opens the PR against it. Ignored for a plain local folder." />
        </div>
        <div class="dev-repo-hint">Branch = the base the AI starts from and opens its PR against — used only for a git repo (a plain local folder ignores it).</div>

        <!-- conversation -->
        <div ref="listEl" class="dev-messages">
            <div v-if="!messages.length && !loading" class="dev-empty">
                <div class="dev-empty-icon">🤖</div>
                <p>Tell the AI what to build for this task. It develops on a connected computer (Claude Code) and opens a PR — then chat here to iterate. Set the repository above to start.</p>
                <p class="dev-empty-hint">First time? Connect your computer once in <b>Settings → AI Developer</b>.</p>
            </div>
            <div v-for="m in messages" :key="m._id" class="dev-msg" :class="m.role === 'user' ? 'is-user' : 'is-agent'">
                <div class="dev-bubble">
                    <div class="dev-text"><span v-if="isWorking(m)" class="dev-spinner"></span>{{ m.text }}</div>
                    <a v-if="m.prUrl" :href="m.prUrl" target="_blank" rel="noopener" class="dev-pr">🔗 {{ m.prUrl }}</a>
                    <span v-if="m.role === 'user' && m.status" class="dev-status" :class="'st-' + m.status">{{ statusLabel(m.status) }}</span>
                </div>
            </div>
            <div v-if="awaitingAgent" class="dev-msg is-agent">
                <div class="dev-bubble"><span class="dev-spinner"></span>Starting…</div>
            </div>
        </div>

        <!-- input -->
        <div class="dev-input">
            <textarea v-model="draft" class="dev-textarea" rows="2" placeholder="Message the AI developer…  (Enter to send, Shift+Enter for a new line)" @keydown.enter.exact.prevent="send"></textarea>
            <button class="dev-send" :disabled="sending || !draft.trim() || !repo.trim()" @click="send">{{ sending ? '…' : 'Send' }}</button>
        </div>
        <div v-if="!repo.trim()" class="dev-hint">↑ Set a repository to start.</div>
        <div v-else-if="err" class="dev-err">{{ err }}</div>
    </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick, defineProps } from 'vue';
import { apiRequest } from '@/services';

const props = defineProps({
    taskId: { type: String, default: '' },
    projectId: { type: String, default: '' },
    sprintId: { type: String, default: '' },
    folderId: { type: String, default: null },
});

const BASE = '/api/v2/dev-agent';
const messages = ref([]);
const draft = ref('');
const repo = ref('');
const base = ref('main');
const loading = ref(false);
const sending = ref(false);
const err = ref('');
const listEl = ref(null);
let timer = null;

const statusLabel = (s) => ({ pending: '⏳ queued', working: '⚙️ working…', done: '✓ done', error: '⚠️ error' }[s] || s);

// running-state indicators
const activeParents = computed(() => {
    const s = new Set();
    for (const m of messages.value) { if (m.role === 'user' && (m.status === 'pending' || m.status === 'working')) s.add(m._id); }
    return s;
});
const isWorking = (m) => m.role === 'agent' && !!m.parentId && activeParents.value.has(m.parentId);
const awaitingAgent = computed(() => {
    const last = messages.value[messages.value.length - 1];
    return !!(last && last.role === 'user' && (last.status === 'pending' || last.status === 'working'));
});

const scrollDown = () => { nextTick(() => { if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight; }); };

const load = async (initial) => {
    if (!props.taskId) return;
    if (initial) loading.value = true;
    try {
        const body = (await apiRequest('get', `${BASE}/messages?taskId=${encodeURIComponent(props.taskId)}`))?.data;
        const rows = (body && body.status && Array.isArray(body.data)) ? body.data : [];
        const prev = messages.value;
        const prevTail = prev[prev.length - 1];
        const newTail = rows[rows.length - 1];
        // follow the conversation when a row is added OR the tail's text changed
        // (live progress edits the "working" message in place — no new row).
        const changed = rows.length !== prev.length || (!!newTail && !!prevTail && (newTail._id !== prevTail._id || newTail.text !== prevTail.text));
        messages.value = rows;
        // seed the repo field ONCE (first load), so a later poll can't re-fill it while the user edits.
        if (initial && !repo.value) {
            const withRepo = [...rows].reverse().find((r) => r.repo);
            if (withRepo) { repo.value = withRepo.repo; base.value = withRepo.base || 'main'; }
        }
        if (changed || initial) scrollDown();
    } catch (e) { /* keep showing what we have */ } finally { if (initial) loading.value = false; }
};

const send = async () => {
    const text = draft.value.trim();
    if (sending.value || !text || !repo.value.trim()) return;
    sending.value = true; err.value = '';
    try {
        const payload = {
            taskId: props.taskId,
            projectId: props.projectId,
            sprintId: props.sprintId,
            text,
            repo: repo.value.trim(),
            base: (base.value || 'main').trim() || 'main',
        };
        const body = (await apiRequest('post', `${BASE}/message`, payload))?.data;
        if (body && body.status) { draft.value = ''; await load(); scrollDown(); }
        else { err.value = (body && (body.statusText || body.message)) || 'Failed to send'; }
    } catch (e) {
        err.value = (e && e.response && e.response.data && (e.response.data.statusText || e.response.data.message)) || (e && e.message) || 'Failed';
    } finally { sending.value = false; }
};

onMounted(() => { load(true); timer = setInterval(() => load(false), 3000); });
onBeforeUnmount(() => { if (timer) clearInterval(timer); });
</script>

<style scoped>
.dev-chat { display: flex; flex-direction: column; height: 100%; min-height: 400px; font-family: 'Roboto', sans-serif; }
.dev-repo { display: flex; gap: 8px; padding: 10px 2px 12px; }
.dev-repo-input { flex: 1; border: 1px solid #d7d9e6; border-radius: 7px; padding: 8px 12px; font-size: 13px; color: #3a3f52; }
.dev-repo-base { width: 110px; border: 1px solid #d7d9e6; border-radius: 7px; padding: 8px 12px; font-size: 13px; color: #3a3f52; }
.dev-repo-hint { font-size: 11px; color: #9aa0b4; padding: 0 2px 8px; line-height: 1.45; }
.dev-messages { flex: 1; overflow-y: auto; padding: 8px 2px; display: flex; flex-direction: column; gap: 10px; }
.dev-empty { text-align: center; color: #9aa0b4; margin: auto; max-width: 420px; padding: 24px; }
.dev-empty-icon { font-size: 34px; margin-bottom: 10px; }
.dev-empty p { font-size: 13px; line-height: 1.55; }
.dev-msg { display: flex; }
.dev-msg.is-user { justify-content: flex-end; }
.dev-msg.is-agent { justify-content: flex-start; }
.dev-bubble { max-width: 78%; border-radius: 12px; padding: 9px 13px; font-size: 13px; line-height: 1.5; }
.is-user .dev-bubble { background: #eaf0ff; color: #23305f; border-top-right-radius: 4px; }
.is-agent .dev-bubble { background: #f4f5f9; color: #2f3444; border-top-left-radius: 4px; }
.dev-text { white-space: pre-wrap; word-break: break-word; }
.dev-pr { display: inline-block; margin-top: 6px; font-size: 12px; color: #2f3a8f; word-break: break-all; }
.dev-status { display: inline-block; margin-top: 6px; font-size: 11px; padding: 1px 8px; border-radius: 10px; background: #fff; border: 1px solid #d7d9e6; color: #6b7280; }
.dev-status.st-working { color: #b7791f; border-color: #e6d3a3; }
.dev-status.st-done { color: #1c7a43; border-color: #bfe3cd; }
.dev-status.st-error { color: #c0392b; border-color: #e6bcbc; }
.dev-input { display: flex; gap: 8px; align-items: flex-end; padding: 10px 2px; border-top: 1px solid #eef0f6; }
.dev-textarea { flex: 1; border: 1px solid #d7d9e6; border-radius: 8px; padding: 9px 12px; font-size: 13px; color: #3a3f52; resize: vertical; font-family: inherit; }
.dev-send { background: #2f3a8f; color: #fff; border: none; border-radius: 8px; padding: 10px 20px; font-size: 13px; cursor: pointer; }
.dev-send:disabled { opacity: .5; cursor: default; }
.dev-hint { font-size: 12px; color: #9aa0b4; padding: 0 2px 6px; }
.dev-err { font-size: 12px; color: #c0392b; padding: 0 2px 6px; }
.dev-empty-hint { font-size: 12px; color: #9aa0b4; margin-top: 10px; }
.dev-spinner { display: inline-block; width: 9px; height: 9px; margin-right: 7px; border-radius: 50%; background: #c0392b; vertical-align: middle; animation: dev-pulse 1s ease-in-out infinite; }
@keyframes dev-pulse { 0%, 100% { opacity: .25; transform: scale(.7); } 50% { opacity: 1; transform: scale(1.2); } }
</style>
