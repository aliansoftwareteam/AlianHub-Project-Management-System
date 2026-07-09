<template>
    <div class="dev-chat">
        <!-- repo bar: temporary, per-conversation (not persisted) -->
        <div class="dev-repo">
            <input v-model="repo" type="text" class="dev-repo-input" placeholder="Repository — git URL or local path (e.g. https://github.com/org/x.git)" @blur="saveProjectRepo" />
            <input v-model="base" type="text" class="dev-repo-base" placeholder="main" title="Base branch — for a git repo, the AI checks this out, branches its work from it, and opens the PR against it. Ignored for a plain local folder." @blur="saveProjectRepo" />
        </div>
        <div class="dev-repo-hint">Saved for the whole project — set it once and every task here (and the AI Bot) reuses it automatically. Branch = the base the AI branches from and opens its PR against (git repo only).</div>

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
                    <div v-if="m.role === 'user' && m.status === 'awaiting_approval'" class="dev-actions">
                        <button class="dev-act dev-act--go" :disabled="acting" @click="approve(m)">✅ Approve &amp; start</button>
                        <button class="dev-act dev-act--stop" :disabled="acting" @click="stopJob(m)">✕ Reject</button>
                    </div>
                    <div v-else-if="m.role === 'user' && (m.status === 'pending' || m.status === 'working')" class="dev-actions">
                        <button class="dev-act dev-act--stop" :disabled="acting" @click="stopJob(m)">⏹ Stop</button>
                    </div>
                    <div v-else-if="m.role === 'user' && m.status === 'awaiting_pr'" class="dev-actions">
                        <button class="dev-act dev-act--go" :disabled="acting" @click="approve(m)">🔀 Create PR</button>
                    </div>
                </div>
            </div>
        </div>

        <!-- live status — pinned above the input so a running job is ALWAYS visible, even
             when the history is long and scrolled (otherwise the working bubble scrolls out
             of view and the job can look stuck). -->
        <div v-if="liveStatus" class="dev-live">
            <span class="dev-spinner"></span>
            <span class="dev-live-head">{{ liveStatus.head }}</span>
            <span v-if="liveStatus.last" class="dev-live-last" :title="liveStatus.last">{{ liveStatus.last }}</span>
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
const acting = ref(false); // busy guard for approve / reject / stop actions
const listEl = ref(null);
let timer = null;

const statusLabel = (s) => ({ awaiting_repo: '📁 needs repo', awaiting_approval: '🟡 needs approval', pending: '⏳ queued', working: '⚙️ working…', awaiting_pr: '🔵 needs PR approval', pending_pr: '⏳ opening PR…', cancelling: '⏹ stopping…', cancelled: '⏹ cancelled', done: '✓ done', error: '⚠️ error' }[s] || s);

// running-state indicators
const activeParents = computed(() => {
    const s = new Set();
    for (const m of messages.value) { if (m.role === 'user' && (m.status === 'pending' || m.status === 'working' || m.status === 'pending_pr')) s.add(m._id); }
    return s;
});
const isWorking = (m) => m.role === 'agent' && !!m.parentId && activeParents.value.has(m.parentId);
// Live status pinned above the input (see template): always shows the running job's current
// step — even when the history is long and scrolled — so a running job never looks stuck.
const liveStatus = computed(() => {
    const running = messages.value.some((m) => m.role === 'user' && (m.status === 'pending' || m.status === 'working' || m.status === 'pending_pr'));
    if (!running) return null;
    const prog = [...messages.value].reverse().find((m) => m.role === 'agent' && isWorking(m));
    if (!prog) return { head: '⚙️ Starting…', last: '' };
    const lines = String(prog.text || '').split('\n').map((s) => s.trim()).filter(Boolean);
    return { head: lines[0] || '⚙️ Working…', last: lines.length > 1 ? lines[lines.length - 1] : '' };
});

const scrollDown = () => { nextTick(() => { if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight; }); };

// The repo is remembered PER-PROJECT: pre-fill from the project's saved binding, and
// persist it (on blur) so every task here + the AI Bot reuse it with no per-task setup.
const loadProjectRepo = async () => {
    if (!props.projectId || repo.value) return;
    try {
        const body = (await apiRequest('get', `${BASE}/project-repo?projectId=${encodeURIComponent(props.projectId)}`))?.data;
        if (body && body.status && body.data && body.data.repo) { repo.value = body.data.repo; base.value = body.data.base || 'main'; }
    } catch (e) { /* no binding yet */ }
};
const saveProjectRepo = async () => {
    const url = repo.value.trim();
    if (!props.projectId || !url) return;
    try {
        const body = (await apiRequest('post', `${BASE}/project-repo`, { projectId: props.projectId, repo: url, base: (base.value || 'main').trim() || 'main' }))?.data;
        if (body && body.data && body.data.resumed) await load(); // a parked bot job just un-parked → refresh
    } catch (e) { /* best-effort */ }
};

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
            else { await loadProjectRepo(); } // else inherit the project's saved repo (set on another task)
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

// Approve a gated bot job (awaiting_approval → pending → the runner develops), or
// reject/stop it. Both re-load so the tab reflects the new state right away.
async function act(path, m) {
    if (acting.value || !m || !m._id) return;
    acting.value = true;
    try { await apiRequest('post', `${BASE}/${path}`, { messageId: m._id }); await load(); }
    catch (e) { err.value = (e && e.response && e.response.data && (e.response.data.statusText || e.response.data.message)) || (e && e.message) || 'Action failed'; }
    finally { acting.value = false; }
}
const approve = (m) => act('approve', m);
const stopJob = (m) => act('cancel', m);

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
.dev-status.st-awaiting_approval { color: #b7791f; border-color: #e6d3a3; }
.dev-status.st-awaiting_pr { color: #2563eb; border-color: #bcd0f5; }
.dev-status.st-pending_pr { color: #b7791f; border-color: #e6d3a3; }
.dev-status.st-cancelled, .dev-status.st-cancelling { color: #6b7280; border-color: #d7d9e6; }
.dev-status.st-awaiting_repo { color: #6b7280; border-color: #d7d9e6; }
.dev-actions { display: flex; gap: 8px; margin-top: 8px; }
.dev-act { border: none; border-radius: 6px; padding: 5px 12px; font-size: 12px; cursor: pointer; font-family: inherit; }
.dev-act:disabled { opacity: .5; cursor: default; }
.dev-act--go { background: #2f3a8f; color: #fff; }
.dev-act--stop { background: #fff; color: #c0392b; border: 1px solid #e6bcbc; }
.dev-input { display: flex; gap: 8px; align-items: flex-end; padding: 10px 2px; border-top: 1px solid #eef0f6; }
.dev-textarea { flex: 1; border: 1px solid #d7d9e6; border-radius: 8px; padding: 9px 12px; font-size: 13px; color: #3a3f52; resize: vertical; font-family: inherit; }
.dev-send { background: #2f3a8f; color: #fff; border: none; border-radius: 8px; padding: 10px 20px; font-size: 13px; cursor: pointer; }
.dev-send:disabled { opacity: .5; cursor: default; }
.dev-hint { font-size: 12px; color: #9aa0b4; padding: 0 2px 6px; }
.dev-live { display: flex; align-items: center; gap: 8px; padding: 7px 12px; margin-top: 4px; border-top: 1px solid #eef0f6; font-size: 12px; background: #fafbff; }
.dev-live .dev-spinner { background: #2f3a8f; margin-right: 0; }
.dev-live-head { font-weight: 600; color: #4b5563; white-space: nowrap; }
.dev-live-last { color: #9aa0b4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
.dev-err { font-size: 12px; color: #c0392b; padding: 0 2px 6px; }
.dev-empty-hint { font-size: 12px; color: #9aa0b4; margin-top: 10px; }
.dev-spinner { display: inline-block; width: 9px; height: 9px; margin-right: 7px; border-radius: 50%; background: #c0392b; vertical-align: middle; animation: dev-pulse 1s ease-in-out infinite; }
@keyframes dev-pulse { 0%, 100% { opacity: .25; transform: scale(.7); } 50% { opacity: 1; transform: scale(1.2); } }
</style>
