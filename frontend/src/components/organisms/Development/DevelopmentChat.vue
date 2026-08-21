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
                    <div class="dev-text">
                        <span v-if="isWorking(m)" class="dev-spinner"></span>
                        <!-- eslint-disable-next-line vue/no-v-html -->
                        <span v-if="m.role === 'agent'" class="dev-md" v-html="renderBody(m.text)"></span>
                        <span v-else>{{ m.text }}</span>
                    </div>
                    <details v-if="trailOf(m.text)" class="dev-trail">
                        <summary>{{ trailHead(m.text) }}</summary>
                        <pre>{{ trailBody(m.text) }}</pre>
                    </details>
                    <div v-if="m.attachments && m.attachments.length" class="dev-msg-files">
                        <span v-for="a in m.attachments" :key="a.id" class="dev-msg-file">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                                stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                <path d="M21.4 11.05 12.25 20.2a5.5 5.5 0 0 1-7.78-7.78l8.49-8.49a3.67 3.67 0 1 1 5.18 5.18l-8.49 8.49a1.83 1.83 0 1 1-2.59-2.59l7.78-7.78" />
                            </svg>
                            {{ a.filename }}
                        </span>
                    </div>
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
        <div class="dev-box" :class="{ 'is-drop': dragging }"
            @dragover.prevent="dragging = true" @dragleave.prevent="dragging = false" @drop.prevent="onDrop">
            <input ref="fileInput" type="file" class="dev-file" :accept="accept" @change="onPick">

            <div v-if="pending.length || uploading" class="dev-atts">
                <div v-for="a in pending" :key="a.id" class="dev-att" :title="`${a.filename} · ${readableSize(a.size)}`">
                    <img v-if="a.preview" :src="a.preview" class="dev-att-thumb" alt="">
                    <span v-else class="dev-att-ext">{{ (a.extension || 'file').toUpperCase() }}</span>
                    <span class="dev-att-name">{{ a.filename }}</span>
                    <button class="dev-att-x" title="Remove" @click="dropAttachment(a.id)">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"
                            stroke-linecap="round" aria-hidden="true">
                            <line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" />
                        </svg>
                    </button>
                </div>
                <div v-if="uploading" class="dev-att is-loading"><span class="dev-att-ext">…</span>
                    <span class="dev-att-name">Uploading…</span>
                </div>
            </div>

            <textarea
                ref="textareaEl"
                v-model="draft"
                class="dev-textarea"
                rows="1"
                :placeholder="busy ? 'The AI is working — wait for it to finish, or press Stop above' : 'Message the AI developer…  (Enter to send, Shift+Enter for a new line)'"
                @keydown.enter.exact="onEnter"
                @input="autosize"
                @paste="onPaste"
            ></textarea>

            <div class="dev-box-foot">
                <button class="dev-icon-btn" :disabled="busy || uploading || !repo.trim()"
                    :title="uploading ? 'Uploading…' : 'Attach a file'" @click="fileInput && fileInput.click()">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M21.4 11.05 12.25 20.2a5.5 5.5 0 0 1-7.78-7.78l8.49-8.49a3.67 3.67 0 1 1 5.18 5.18l-8.49 8.49a1.83 1.83 0 1 1-2.59-2.59l7.78-7.78" />
                    </svg>
                </button>
                <span class="dev-box-spacer"></span>
                <button class="dev-send" :disabled="busy || sending || (!draft.trim() && !pending.length) || !repo.trim()"
                    :title="busy ? 'The AI is still working' : 'Send'" @click="send">
                    <svg v-if="!sending" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <line x1="12" y1="19" x2="12" y2="5" /><polyline points="6 11 12 5 18 11" />
                    </svg>
                    <span v-else>…</span>
                </button>
            </div>
        </div>
        <div v-if="!repo.trim()" class="dev-hint">↑ Set a repository to start.</div>
        <div v-else-if="err" class="dev-err">{{ err }}</div>
    </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick, defineProps } from 'vue';
import markdownit from 'markdown-it';
import { apiRequest } from '@/services';

/* Agent replies are markdown — code fences, lists, links — and were being shown as
 * literal characters.
 *
 * `html: false` is a deliberate departure from the four existing markdown-it call
 * sites in this app, which pass `html: true`. This text is written by an agent that
 * has just read the repository, so a file containing markup can end up quoted in a
 * reply; with raw HTML enabled that markup would execute in the reader's session.
 * Escaping it costs nothing here — nobody writes HTML at a dev-agent on purpose. */
const md = markdownit({ html: false, linkify: true, breaks: true });

// Kept in sync with PROSE_MARK in scripts/dev-agent/dev-agent.js.
const PROSE_MARK = '\u2063---activity---\u2063\n';

const props = defineProps({
    taskId: { type: String, default: '' },
    // Set instead of taskId by the project chat window: a thread with no task.
    conversationId: { type: String, default: '' },
    projectId: { type: String, default: '' },
    sprintId: { type: String, default: '' },
    folderId: { type: String, default: null },
});

// The one place that decides which key this thread is addressed by. The server
// refuses a request carrying both, so exactly one is ever sent.
const scope = computed(() => (props.taskId
    ? { taskId: props.taskId }
    : (props.conversationId ? { conversationId: props.conversationId } : null)));
const scopeQuery = computed(() => (scope.value
    ? Object.entries(scope.value).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
    : ''));

const BASE = '/api/v2/dev-agent';
// Mirrors the server's allow-list. The server checks again — this only spares the
// user a round trip for a file it would refuse anyway.
const accept = '.png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.log,.md,.json,.csv,.zip,.docx,.xlsx';
const messages = ref([]);
const draft = ref('');
const pending = ref([]);      // attachments uploaded but not yet sent with a message
const uploading = ref(false);
const dragging = ref(false);
const fileInput = ref(null);
const textareaEl = ref(null);
const repo = ref('');
const base = ref('main');
const loading = ref(false);
const sending = ref(false);
const err = ref('');
const acting = ref(false); // busy guard for approve / reject / stop actions
const listEl = ref(null);
let timer = null;

/* One live message carries the agent's prose and its activity trail, separated by
 * PROSE_MARK. They are split here so the prose reads as the reply and the trail
 * stays collapsed underneath — the way a desktop client shows tool use. */
const splitTrail = (text) => {
    const raw = String(text || '');
    const at = raw.indexOf(PROSE_MARK);
    if (at === -1) return { body: raw, trail: '' };
    return { body: raw.slice(0, at), trail: raw.slice(at + PROSE_MARK.length) };
};
const renderBody = (text) => md.render(splitTrail(text).body || '');
const trailOf = (text) => splitTrail(text).trail;
const trailHead = (text) => (trailOf(text).split('\n')[0] || 'Activity').trim();
const trailBody = (text) => trailOf(text).split('\n').slice(1).join('\n').trim();

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
/* A turn is in flight. The server refuses a second message in a busy thread —
 * two headless agents in one working folder overwrite each other — so the composer
 * says that up front instead of letting the developer discover it by being
 * rejected. */
const busy = computed(() => messages.value.some((m) => m.role === 'user'
    && ['pending', 'working', 'pending_pr', 'working_pr', 'cancelling'].includes(m.status)));

const liveStatus = computed(() => {
    const running = messages.value.some((m) => m.role === 'user' && (m.status === 'pending' || m.status === 'working' || m.status === 'pending_pr'));
    if (!running) return null;
    const prog = [...messages.value].reverse().find((m) => m.role === 'agent' && isWorking(m));
    if (!prog) return { head: '⚙️ Starting…', last: '' };
    const lines = String(prog.text || '').split('\n').map((s) => s.trim()).filter(Boolean);
    return { head: lines[0] || '⚙️ Working…', last: lines.length > 1 ? lines[lines.length - 1] : '' };
});

/* Follow the conversation only when the reader is already at the bottom.
 *
 * Now that prose streams, the tail changes several times a second — so scrolling
 * on every change meant you could not read anything earlier in the thread while a
 * turn was running. This is the behaviour every chat client has: stick to the
 * bottom if you are there, leave the reader alone if they have scrolled up. */
const NEAR_BOTTOM_PX = 120;
const isNearBottom = () => {
    const el = listEl.value;
    if (!el) return true;
    return (el.scrollHeight - el.scrollTop - el.clientHeight) < NEAR_BOTTOM_PX;
};
const scrollDown = (force) => {
    const stick = force || isNearBottom();
    nextTick(() => { if (stick && listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight; });
};

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
    if (!scope.value) return;
    if (initial) loading.value = true;
    try {
        const body = (await apiRequest('get', `${BASE}/messages?${scopeQuery.value}`))?.data;
        // A refusal or a blip must not wipe the thread. Returning [] here made the
        // whole conversation vanish on one bad poll and reappear on the next.
        if (!body || !body.status || !Array.isArray(body.data)) {
            if (initial) err.value = (body && (body.statusText || body.message)) || 'Could not load this conversation.';
            return;
        }
        const rows = body.data;
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
        if (initial) scrollDown(true);
        else if (changed) scrollDown();
    } catch (e) { /* keep showing what we have */ } finally { if (initial) loading.value = false; }
};

/* Grows with the message, up to a point, then scrolls — a fixed two-row box made
 * anything longer than a sentence feel like a form field. */
const MAX_COMPOSER_PX = 220;
const autosize = () => {
    const el = textareaEl.value;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_COMPOSER_PX)}px`;
};

/* Enter sends — unless an IME is mid-composition, where Enter is how you accept a
 * candidate. Swallowing it there loses the character for anyone typing Japanese,
 * Chinese, Korean, or Indic script with a composing keyboard. */
const onEnter = (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    send();
};

const readableSize = (bytes) => {
    const n = Number(bytes) || 0;
    if (!n) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

/* Uploaded as soon as it is chosen, so the file is already stored by the time the
 * message is sent — the message then just carries its descriptor. */
const uploadFile = async (file) => {
    if (!file || uploading.value) return;
    uploading.value = true; err.value = '';
    try {
        const form = new FormData();
        form.append('file', file);
        Object.entries(scope.value || {}).forEach(([k, v]) => form.append(k, v));
        // The 4th argument picks the multipart axios instance. Without it the
        // default one forces Content-Type: application/json and the file never
        // arrives — the request succeeds and the server sees no file.
        const body = (await apiRequest('post', `${BASE}/attachment`, form, 'form'))?.data;
        if (body && body.status) {
            // Preview from the local file rather than the stored copy: the download
            // endpoint needs an Authorization header, which an <img src> cannot
            // send. Revoked when the attachment goes away.
            const preview = /^image\//.test(file.type) ? URL.createObjectURL(file) : '';
            pending.value = [...pending.value, { ...body.data, preview }];
        }
        else err.value = (body && (body.statusText || body.message)) || 'Attach failed';
    } catch (e) {
        err.value = (e && e.response && e.response.data && (e.response.data.statusText || e.response.data.message))
            || (e && e.message) || 'Attach failed';
    } finally {
        uploading.value = false;
        if (fileInput.value) fileInput.value.value = '';   // let the same file be picked again
    }
};

const onPick = (e) => uploadFile(e.target.files && e.target.files[0]);

const onDrop = (e) => {
    dragging.value = false;
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) uploadFile(file);
};

/* A pasted screenshot is the common case — Ctrl+V straight into the box. */
const onPaste = (e) => {
    const items = (e.clipboardData && e.clipboardData.files) || [];
    if (items.length) { e.preventDefault(); uploadFile(items[0]); }
};

const releasePreview = (a) => { if (a && a.preview) { try { URL.revokeObjectURL(a.preview); } catch (e) { /* already gone */ } } };

const dropAttachment = (id) => {
    const going = pending.value.find((a) => a.id === id);
    releasePreview(going);
    pending.value = pending.value.filter((a) => a.id !== id);
};

const send = async () => {
    const text = draft.value.trim();
    // A file on its own is a valid instruction, so text alone is not required.
    if (sending.value || (!text && !pending.value.length) || !repo.value.trim()) return;
    sending.value = true; err.value = '';
    try {
        const payload = {
            ...(scope.value || {}),
            projectId: props.projectId,
            sprintId: props.sprintId,
            text,
            repo: repo.value.trim(),
            base: (base.value || 'main').trim() || 'main',
            attachments: pending.value,
        };
        const body = (await apiRequest('post', `${BASE}/message`, payload))?.data;
        if (body && body.status) {
            draft.value = '';
            pending.value.forEach(releasePreview);
            pending.value = [];
            nextTick(autosize);
            await load();
            scrollDown(true);
        }
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
    try {
        // These endpoints answer { status: false, statusText } for a refusal, which
        // resolves rather than throws — so without this the button appeared to do
        // nothing at all.
        const body = (await apiRequest('post', `${BASE}/${path}`, { messageId: m._id }))?.data;
        if (body && body.status === false) err.value = body.statusText || body.message || 'That could not be done.';
        else err.value = '';
        await load();
    } catch (e) { err.value = (e && e.response && e.response.data && (e.response.data.statusText || e.response.data.message)) || (e && e.message) || 'Action failed'; }
    finally { acting.value = false; }
}
const approve = (m) => act('approve', m);
const stopJob = (m) => act('cancel', m);

/* Two cadences. While a job runs the message is being rewritten continuously, so a
 * 3s poll made streamed prose arrive in visible jumps; when nothing is running,
 * polling that fast is just noise. */
const IDLE_MS = 3000;
const LIVE_MS = 1000;
let timerMs = 0;
const schedule = (ms) => {
    if (timer && timerMs === ms) return;
    if (timer) clearInterval(timer);
    timerMs = ms;
    timer = setInterval(() => load(false), ms);
};
watch(liveStatus, (live) => schedule(live ? LIVE_MS : IDLE_MS));

onMounted(() => { load(true); schedule(IDLE_MS); });
onBeforeUnmount(() => { if (timer) clearInterval(timer); pending.value.forEach(releasePreview); });
</script>

<style scoped>
/* attachments */
/* The composer is one box — attachments, then the text, then the controls — so an
   attached file reads as part of the message being written rather than as
   something floating above the field. */
.dev-file { display: none; }
.dev-box { margin: 10px 2px; border: 1px solid #d7d9e6; border-radius: 12px; background: #fff;
    padding: 8px 8px 6px; transition: border-color .12s ease, box-shadow .12s ease; }
.dev-box:focus-within { border-color: #7b8ce0; box-shadow: 0 0 0 3px rgba(123, 140, 224, .14); }
.dev-box.is-drop { border-color: #7b8ce0; border-style: dashed; background: #fafbff; }

.dev-atts { display: flex; flex-wrap: wrap; gap: 8px; padding: 2px 2px 8px; }
.dev-att { position: relative; display: flex; align-items: center; gap: 8px; max-width: 240px;
    border: 1px solid #e3e5f0; border-radius: 9px; background: #fafbff; padding: 6px 10px 6px 6px; }
.dev-att.is-loading { opacity: .7; }
.dev-att-thumb { width: 34px; height: 34px; border-radius: 6px; object-fit: cover; display: block;
    background: #eef0f6; }
.dev-att-ext { display: flex; align-items: center; justify-content: center; width: 34px; height: 34px;
    border-radius: 6px; background: #e8ebf7; color: #5a6199; font-size: 10px; font-weight: 700;
    letter-spacing: .02em; }
.dev-att-name { font-size: 12px; color: #3b4252; overflow: hidden; text-overflow: ellipsis;
    white-space: nowrap; }
.dev-att-x { position: absolute; top: -6px; right: -6px; display: flex; align-items: center;
    justify-content: center; width: 18px; height: 18px; border: 1px solid #dfe2f0; border-radius: 50%;
    background: #fff; color: #6b7280; cursor: pointer; padding: 0; }
.dev-att-x svg { width: 9px; height: 9px; }
.dev-att-x:hover { color: #fff; background: #e2645c; border-color: #e2645c; }

.dev-box-foot { display: flex; align-items: center; gap: 6px; padding: 4px 2px 0; }
.dev-box-spacer { flex: 1 1 auto; }
.dev-icon-btn { display: flex; align-items: center; justify-content: center; width: 30px; height: 30px;
    border: 0; border-radius: 8px; background: none; color: #7c8195; cursor: pointer; padding: 0; }
.dev-icon-btn svg { width: 17px; height: 17px; }
.dev-icon-btn:hover:not(:disabled) { background: #f2f3f9; color: #2f3990; }
.dev-icon-btn:disabled { opacity: .45; cursor: default; }
.dev-msg-files { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.dev-msg-file svg { width: 11px; height: 11px; flex: 0 0 11px; }
.dev-msg-file { display: inline-flex; align-items: center; gap: 5px; border: 1px solid #dfe2f0;
    border-radius: 6px; padding: 2px 7px; background: #fff; font-size: 11.5px; color: #6b7280; }

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
/* The field itself carries no border now — the box around it does. */
.dev-textarea { display: block; width: 100%; border: 0; background: none; padding: 6px 6px 2px;
    font-size: 13px; line-height: 1.5; color: #3a3f52; resize: none; overflow-y: auto;
    font-family: inherit; min-height: 26px; max-height: 220px; }
.dev-textarea:focus { outline: none; }
.dev-send { display: flex; align-items: center; justify-content: center; width: 30px; height: 30px;
    background: #2f3a8f; color: #fff; border: none; border-radius: 8px; font-size: 13px; cursor: pointer;
    padding: 0; }
.dev-send svg { width: 16px; height: 16px; }
.dev-send:disabled { opacity: .35; cursor: default; }
.dev-hint { font-size: 12px; color: #9aa0b4; padding: 0 2px 6px; }
/* Rendered markdown inside a bubble. Tight leading and small margins: this sits in
   a chat bubble, not on a page, so document-scale spacing would look broken. */
.dev-md :first-child { margin-top: 0; }
.dev-md :last-child { margin-bottom: 0; }
.dev-md p { margin: 0 0 8px; }
.dev-md ul, .dev-md ol { margin: 0 0 8px; padding-left: 18px; }
.dev-md li { margin-bottom: 3px; }
.dev-md h1, .dev-md h2, .dev-md h3, .dev-md h4 { font-size: 13.5px; font-weight: 500; margin: 10px 0 6px; }
.dev-md a { color: #2f3990; word-break: break-word; }
.dev-md code {
    font-family: 'Roboto Mono', ui-monospace, Consolas, monospace;
    font-size: .88em;
    background: #eceef6;
    border-radius: 4px;
    padding: 1px 4px;
    word-break: break-word;
}
/* A code block scrolls inside itself — a long line must never widen the thread. */
.dev-md pre {
    margin: 0 0 8px;
    padding: 9px 11px;
    background: #f3f4fa;
    border: 1px solid #e3e5f0;
    border-radius: 8px;
    overflow-x: auto;
}
.dev-md pre code { background: none; padding: 0; font-size: 12px; line-height: 1.5; white-space: pre; }
.dev-md blockquote { margin: 0 0 8px; padding-left: 10px; border-left: 3px solid #dfe2f0; color: #6b7280; }
.dev-md table { border-collapse: collapse; margin: 0 0 8px; display: block; overflow-x: auto; }
.dev-md th, .dev-md td { border: 1px solid #e3e5f0; padding: 4px 8px; font-size: 12px; }
.dev-md hr { border: 0; border-top: 1px solid #e3e5f0; margin: 10px 0; }

/* The activity trail: present, quiet, closed by default. */
.dev-trail { margin-top: 8px; }
.dev-trail summary {
    font-size: 11.5px;
    color: #9aa0b4;
    cursor: pointer;
    list-style: none;
    display: inline-flex;
    align-items: center;
    gap: 5px;
}
.dev-trail summary::-webkit-details-marker { display: none; }
.dev-trail summary::before { content: '▸'; font-size: 9px; }
.dev-trail[open] summary::before { content: '▾'; }
.dev-trail summary:hover { color: #6b7280; }
.dev-trail pre {
    margin: 6px 0 0;
    padding: 8px 10px;
    background: #f7f8fc;
    border: 1px solid #e9eaf2;
    border-radius: 7px;
    font-family: 'Roboto Mono', ui-monospace, Consolas, monospace;
    font-size: 11px;
    line-height: 1.6;
    color: #6b7280;
    max-height: 240px;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
}

.dev-live { display: flex; align-items: center; gap: 8px; padding: 7px 12px; margin-top: 4px; border-top: 1px solid #eef0f6; font-size: 12px; background: #fafbff; }
.dev-live .dev-spinner { background: #2f3a8f; margin-right: 0; }
.dev-live-head { font-weight: 600; color: #4b5563; white-space: nowrap; }
.dev-live-last { color: #9aa0b4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
.dev-err { font-size: 12px; color: #c0392b; padding: 0 2px 6px; }
.dev-empty-hint { font-size: 12px; color: #9aa0b4; margin-top: 10px; }
.dev-spinner { display: inline-block; width: 9px; height: 9px; margin-right: 7px; border-radius: 50%; background: #c0392b; vertical-align: middle; animation: dev-pulse 1s ease-in-out infinite; }
@keyframes dev-pulse { 0%, 100% { opacity: .25; transform: scale(.7); } 50% { opacity: 1; transform: scale(1.2); } }
</style>
