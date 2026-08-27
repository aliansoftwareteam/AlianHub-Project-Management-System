<template>
    <div class="dev-chat">
        <!-- Repo bar. A summary that opens for editing, not a live field: this value is
             project-wide and every task and bot job inherits it, so a stray keystroke in
             a permanently-focusable input could redirect all of them. -->
        <!-- `to` keeps a valid selector even when disabled: Teleport resolves its target
             either way, and querySelector('') throws. Disabled renders in place. -->
        <Teleport :to="props.repoTarget || 'body'" :disabled="!repoSlotReady">
            <button class="dev-repo-chip" :class="{ 'is-unset': !repo.trim(), 'in-header': repoSlotReady }"
                :title="repo || 'Set the repository for this project'" @click="openRepoEdit">
                <svg class="dev-repo-mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h7A1.5 1.5 0 0 1 19 10v7.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 3 17.5z" />
                </svg>
                <span class="dev-repo-name">{{ repoLabel }}</span>
                <span v-if="repo.trim()" class="dev-repo-branch">{{ base || 'main' }}</span>
                <svg class="dev-repo-pencil" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
                    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
                </svg>
            </button>
        </Teleport>

        <!-- Editing stays in the body: two inputs and a pair of buttons do not belong in
             a 57px header, and the summary above keeps showing the value being replaced. -->
        <div v-if="editingRepo" class="dev-repo">
            <div class="dev-repo-edit">
                <input ref="repoInputEl" v-model="repoDraft" type="text" class="dev-repo-input"
                    placeholder="Repository — git URL or local path (e.g. https://github.com/org/x.git)"
                    @keydown.enter.prevent="commitRepoEdit" @keydown.esc.stop.prevent="cancelRepoEdit" />
                <input v-model="baseDraft" type="text" class="dev-repo-base" placeholder="main"
                    title="Base branch — for a git repo, the AI checks this out, branches its work from it, and opens the PR against it. Ignored for a plain local folder."
                    @keydown.enter.prevent="commitRepoEdit" @keydown.esc.stop.prevent="cancelRepoEdit" />
                <button class="dev-repo-save" @click="commitRepoEdit">Save</button>
                <button class="dev-repo-cancel" @click="cancelRepoEdit">Cancel</button>
            </div>
        </div>
        <div v-if="editingRepo" class="dev-repo-hint">Saved for the whole project — set it once and every task here (and the AI Bot) reuses it automatically. Branch = the base the AI branches from and opens its PR against (git repo only).</div>

        <!-- conversation -->
        <div ref="listEl" class="dev-messages">
            <div v-if="!messages.length && !loading" class="dev-empty">
                <div class="dev-empty-icon">🤖</div>
                <p>Tell the AI what to build for this task. It develops on a connected computer (Claude Code) and opens a PR — then chat here to iterate. Set the repository above to start.</p>
                <p class="dev-empty-hint">First time? Connect your computer once in <b>Settings → AI Developer</b>.</p>
            </div>
            <div v-for="m in messages" :key="m._id" class="dev-msg" :class="m.role === 'user' ? 'is-user' : 'is-agent'">
                <div class="dev-bubble">
                    <div v-if="!isSupersededLog(m)" class="dev-text">
                        <!-- eslint-disable-next-line vue/no-v-html -->
                        <span v-if="m.role === 'agent'" class="dev-md" v-html="renderBody(m)"></span>
                        <span v-else>{{ m.text }}</span>
                    </div>
                    <details v-if="trailOf(m.text)" class="dev-trail">
                        <summary>{{ trailHead(m.text) }}</summary>
                        <pre>{{ trailBody(m.text) }}</pre>
                    </details>
                    <div v-if="m.attachments && m.attachments.length" class="dev-msg-files">
                        <template v-for="a in m.attachments" :key="a.id">
                            <button v-if="previews[a.id]" class="dev-msg-img"
                                :title="`${a.filename} · ${readableSize(a.size)}`" @click="openPreview(a)">
                                <img :src="previews[a.id]" :alt="a.filename" />
                                <span class="dev-msg-img-name">{{ a.filename }}</span>
                            </button>
                            <span v-else class="dev-msg-file" :title="`${a.filename} · ${readableSize(a.size)}`">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                                    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                    <path d="M21.4 11.05 12.25 20.2a5.5 5.5 0 0 1-7.78-7.78l8.49-8.49a3.67 3.67 0 1 1 5.18 5.18l-8.49 8.49a1.83 1.83 0 1 1-2.59-2.59l7.78-7.78" />
                                </svg>
                                {{ a.filename }}
                            </span>
                        </template>
                    </div>
                    <a v-if="m.prUrl" :href="m.prUrl" target="_blank" rel="noopener" class="dev-pr">🔗 {{ m.prUrl }}</a>
                </div>
                <!-- Outside the bubble: it annotates the message, it is not part of it. -->
                <span v-if="m.createdAt" class="dev-time" :title="absTime(m.createdAt)">{{ relTime(m.createdAt) }}</span>
            </div>
        </div>

        <!-- One status bar for the thread, pinned above the composer: what the job is doing
             and what you can do about it. Both used to sit inside the message bubble, where
             they read as part of what you had written and scrolled out of view with it. -->
        <div v-if="liveStatus" class="dev-live">
            <svg v-if="liveStatus.spin" class="dev-spinner" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true">
                <line x1="12" y1="3.5" x2="12" y2="20.5" />
                <line x1="4.6" y1="7.75" x2="19.4" y2="16.25" />
                <line x1="4.6" y1="16.25" x2="19.4" y2="7.75" />
            </svg>
            <span class="dev-live-head">{{ liveStatus.head }}</span>
            <span v-if="liveStatus.last" class="dev-live-last" :title="liveStatus.last">{{ liveStatus.last }}</span>
            <span class="dev-live-gap"></span>
            <!-- Stop is not here: it lives in the send button's place, because stopping is
                 the one action that replaces sending rather than sitting beside it. -->
            <template v-if="liveJob && liveJob.status === 'awaiting_approval'">
                <button class="dev-act dev-act--go" :disabled="acting" @click="approve(liveJob)">Approve &amp; start</button>
                <button class="dev-act dev-act--stop" :disabled="acting" @click="stopJob(liveJob)">Reject</button>
            </template>
            <button v-else-if="liveJob && liveJob.status === 'awaiting_pr'" class="dev-act dev-act--go"
                :disabled="acting" @click="approve(liveJob)">Create PR</button>
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
                :placeholder="busy ? 'The AI is working — wait for it to finish, or press Stop' : 'Message the AI developer…  (Enter to send, Shift+Enter for a new line)'"
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
                <!-- Stop takes the send button's place while a turn runs: it is the only
                     thing you can do with the composer then, so a disabled arrow beside a
                     Stop elsewhere was two controls saying one thing. -->
                <button v-if="canStop" class="dev-send dev-send--stop" :disabled="acting"
                    title="Stop the AI" aria-label="Stop the AI" @click="stopJob(liveJob)">
                    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <rect x="7" y="7" width="10" height="10" rx="2" />
                    </svg>
                </button>
                <button v-else class="dev-send" :disabled="busy || sending || (!draft.trim() && !pending.length) || !repo.trim()"
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
    /* CSS selector for a slot in an enclosing header to show the repo summary in.
     * The project modal has a header and passes one; the task sidebar has none and
     * leaves this empty, so the summary renders inline above the conversation. */
    repoTarget: { type: String, default: '' },
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
const trailOf = (text) => splitTrail(text).trail;
const trailHead = (text) => (trailOf(text).split('\n')[0] || 'Activity').trim();
const trailBody = (text) => trailOf(text).split('\n').slice(1).join('\n').trim();

/* No ticker behind these: the thread re-renders on every poll, so the relative time
 * refreshes on its own. The exact timestamp is on the title attribute. */
const relTime = (iso) => {
    const then = new Date(iso).getTime();
    if (!then) return '';
    const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (secs < 45) return 'just now';
    const mins = Math.round(secs / 60);
    if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days = Math.round(hours / 24);
    if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
    return new Date(then).toLocaleDateString();
};
const absTime = (iso) => {
    const t = new Date(iso);
    return Number.isNaN(t.getTime()) ? '' : t.toLocaleString();
};

const statusLabel = (s) => ({ awaiting_repo: '📁 needs repo', awaiting_approval: '🟡 needs approval', pending: '⏳ queued', working: '⚙️ working…', awaiting_pr: '🔵 needs PR approval', pending_pr: '⏳ opening PR…', cancelling: '⏹ stopping…', cancelled: '⏹ cancelled', done: '✓ done', error: '⚠️ error' }[s] || s);

// running-state indicators
const activeParents = computed(() => {
    const s = new Set();
    for (const m of messages.value) { if (m.role === 'user' && (m.status === 'pending' || m.status === 'working' || m.status === 'pending_pr')) s.add(m._id); }
    return s;
});
const isWorking = (m) => m.role === 'agent' && !!m.parentId && activeParents.value.has(m.parentId);

/* Once a turn succeeds its live message collapses to just the activity trail.
 *
 * The runner streams the agent's prose onto the "working" message AND posts it again
 * as the final reply, so leaving both bodies rendered showed every answer twice.
 * Only when a reply actually carries the prose, though: on error/cancel the reply is
 * just the failure line, and this body is the only account of the turn there is. */
const answeredParents = computed(() => {
    const s = new Set();
    for (const m of messages.value) { if (m.role === 'user' && (m.status === 'done' || m.status === 'awaiting_pr')) s.add(m._id); }
    return s;
});
const isSupersededLog = (m) => m.role === 'agent' && !!m.parentId
    && !!trailOf(m.text) && answeredParents.value.has(m.parentId);
const renderBody = (m) => md.render(splitTrail(m.text).body || '');
// Live status pinned above the input (see template): always shows the running job's current
// step — even when the history is long and scrolled — so a running job never looks stuck.
/* A turn is in flight. The server refuses a second message in a busy thread —
 * two headless agents in one working folder overwrite each other — so the composer
 * says that up front instead of letting the developer discover it by being
 * rejected. */
const busy = computed(() => messages.value.some((m) => m.role === 'user'
    && ['pending', 'working', 'pending_pr', 'working_pr', 'cancelling'].includes(m.status)));

/* The one job this thread is currently waiting on.
 *
 * One control for the whole thread rather than one per message: the server refuses a
 * second instruction while a turn is in flight, so only one job is ever actionable.
 * The OLDEST match wins — when several bot jobs are queued for approval, the next one
 * up is the one at the front, and messages arrive oldest-first. */
const ACTIONABLE = ['awaiting_repo', 'awaiting_approval', 'awaiting_pr', 'pending', 'working', 'pending_pr', 'working_pr', 'cancelling'];
const RUNNING = ['pending', 'working', 'pending_pr', 'working_pr', 'cancelling'];
const liveJob = computed(() => messages.value.find((m) => m.role === 'user' && ACTIONABLE.includes(m.status)) || null);
const canStop = computed(() => ['pending', 'working'].includes((liveJob.value && liveJob.value.status) || ''));

const liveStatus = computed(() => {
    const job = liveJob.value;
    if (!job) return null;
    // Waiting on a person, not on the agent: no spinner, just what is being asked for.
    if (!RUNNING.includes(job.status)) return { head: statusLabel(job.status), last: '', spin: false };
    const prog = [...messages.value].reverse().find((m) => m.role === 'agent' && isWorking(m));
    if (!prog) return { head: '⚙️ Starting…', last: '', spin: true };
    /* Read the activity trail, never the body. Since prose streams, the body's first
     * line is a sentence of the reply — putting that in a one-line status strip is
     * what pushed this row past the panel edge. */
    const trail = trailOf(prog.text);
    if (!trail) return { head: '⚙️ Working…', last: '', spin: true };
    const lines = trail.split('\n').map((s) => s.trim()).filter(Boolean);
    return { head: lines[0] || '⚙️ Working…', last: lines.length > 1 ? lines[lines.length - 1] : '', spin: true };
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
/* The chip shows the last segment only — a full absolute path or clone URL is far too
 * long to sit above the conversation, and the whole value is on the title attribute. */
const repoLabel = computed(() => {
    const v = repo.value.trim();
    if (!v) return 'Set repository';
    const seg = v.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
    return (seg || v).replace(/\.git$/, '');
});
const editingRepo = ref(false);
const repoDraft = ref('');
const baseDraft = ref('');
const repoInputEl = ref(null);
/* Resolve the header slot once the DOM exists. Teleport drops its content entirely if
 * the target is missing, so the summary falls back to rendering inline rather than
 * vanishing when this component is used somewhere without that header. */
const repoSlotReady = ref(false);
onMounted(async () => {
    await nextTick();
    repoSlotReady.value = !!(props.repoTarget && document.querySelector(props.repoTarget));
});
const openRepoEdit = async () => {
    repoDraft.value = repo.value;
    baseDraft.value = base.value || 'main';
    editingRepo.value = true;
    await nextTick();
    if (repoInputEl.value) repoInputEl.value.focus();
};
const cancelRepoEdit = () => { editingRepo.value = false; };
const commitRepoEdit = async () => {
    repo.value = repoDraft.value.trim();
    base.value = (baseDraft.value || 'main').trim() || 'main';
    editingRepo.value = false;
    await saveProjectRepo();
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

/* Thumbnails for image attachments already sent.
 *
 * The bytes cannot go straight into an <img src>: the download route needs the JWT and
 * the company header, and it sets Content-Disposition: attachment on purpose. So they
 * are fetched as a blob and shown from an object URL, which keeps that route's rule
 * intact — nothing user-supplied is ever served inline from this origin.
 *
 * SVG is left out of the list deliberately. It is the one image format that can carry
 * script, and while an <img> will not run it, widening this beyond raster formats is
 * not worth the argument. Anything not previewed still shows as a file chip. */
const RASTER = /^(png|jpe?g|gif|webp|bmp)$/i;
const isImage = (a) => RASTER.test(String((a && a.extension) || '').replace(/^\./, ''))
    || /^image\/(png|jpeg|gif|webp|bmp)$/i.test(String((a && a.type) || ''));

const previews = ref({});
const previewTried = new Set();

const loadPreview = async (a) => {
    if (!a || !a.id || !isImage(a) || previewTried.has(a.id) || !scopeQuery.value) return;
    previewTried.add(a.id);
    try {
        const res = await apiRequest('get', `${BASE}/attachment?${scopeQuery.value}&id=${encodeURIComponent(a.id)}`,
            null, null, { responseType: 'blob' });
        if (res && res.data) previews.value = { ...previews.value, [a.id]: URL.createObjectURL(res.data) };
    } catch (e) { /* a preview is a nicety — the file still lists as a chip */ }
};

const openPreview = (a) => { const u = previews.value[a.id]; if (u) window.open(u, '_blank', 'noopener'); };

const releasePreviews = () => {
    for (const u of Object.values(previews.value)) {
        try { URL.revokeObjectURL(u); } catch (e) { /* already gone */ }
    }
    previews.value = {};
};

// Fetch on arrival, not on render: the list re-renders on every 3s poll, and
// previewTried keeps one attempt per attachment for the life of the thread.
watch(messages, (rows) => {
    for (const m of rows || []) {
        for (const a of (Array.isArray(m.attachments) ? m.attachments : [])) loadPreview(a);
    }
}, { immediate: true });

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
onBeforeUnmount(() => { if (timer) clearInterval(timer); pending.value.forEach(releasePreview); releasePreviews(); });
</script>

<style scoped>
/* attachments */
/* The composer is one box — attachments, then the text, then the controls — so an
   attached file reads as part of the message being written rather than as
   something floating above the field. */
.dev-file { display: none; }
.dev-box { margin: 10px 2px 12px; border: 1px solid #d7d9e6; border-radius: 16px; background: #fff;
    padding: 10px 10px 7px; box-shadow: 0 1px 2px rgba(28, 26, 80, .05);
    transition: border-color .12s ease, box-shadow .12s ease; }
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
/* Kept off the resting state: a timestamp on every row competes with the messages
   themselves, and on a long thread it turns the column into a ledger. */
.dev-time { font-size: 11px; color: #9aa0b4; padding: 0 2px;
    opacity: 0; transition: opacity .12s ease; }
.dev-msg:hover .dev-time { opacity: 1; }
/* Without a pointer there is no hover to reveal it. */
@media (hover: none) { .dev-time { opacity: 1; } }

.dev-msg-files { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.dev-msg-img { display: block; max-width: 260px; padding: 4px; border: 1px solid #dfe2f0;
    border-radius: 10px; background: #fff; cursor: zoom-in; font-family: inherit; }
.dev-msg-img img { display: block; width: 100%; max-height: 220px; object-fit: cover;
    border-radius: 6px; }
.dev-msg-img-name { display: block; max-width: 100%; margin-top: 4px; padding: 0 2px;
    font-size: 11px; color: #6b7280; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dev-msg-img:hover { border-color: #b9c2e6; }
.dev-msg-file svg { width: 11px; height: 11px; flex: 0 0 11px; }
.dev-msg-file { display: inline-flex; align-items: center; gap: 5px; border: 1px solid #dfe2f0;
    border-radius: 6px; padding: 2px 7px; background: #fff; font-size: 11.5px; color: #6b7280; }

/* One reading column, centred, that every row aligns to.
 *
 * This component renders in two very different frames: a narrow task sidebar and a
 * full-screen project modal. A measure rather than a percentage serves both — in the
 * sidebar it never binds and the column simply fills, while full-screen it stops the
 * conversation sprawling to 1900px and leaving the reader with a wall of empty right. */
.dev-chat { --dev-measure: 780px; display: flex; flex-direction: column; height: 100%; min-height: 400px; font-family: 'Roboto', sans-serif; }
.dev-repo, .dev-repo-hint, .dev-msg, .dev-live, .dev-box, .dev-hint, .dev-err {
    width: 100%; max-width: var(--dev-measure); margin-inline: auto;
}
.dev-repo { display: flex; gap: 8px; padding: 6px 2px 8px; }
/* Collapsed, this should read as a breadcrumb beneath the chat title — context you
   glance at — rather than as a form sitting on top of the conversation. */
.dev-repo-chip { display: inline-flex; align-items: center; gap: 7px; min-width: 0; max-width: 100%;
    align-self: flex-start; margin: 6px 0 8px -8px; padding: 4px 8px;
    border: 1px solid transparent; border-radius: 8px;
    background: none; cursor: pointer; font-family: inherit; font-size: 12.5px; color: #6b7280;
    transition: background .12s ease, border-color .12s ease, color .12s ease; }
.dev-repo-chip:hover { background: #f4f5f9; border-color: #e6e8f2; color: #3b4252; }
/* In the header it is a standing pill beside the chat title, so it carries its own
   surface rather than appearing on hover the way the inline variant does. */
.dev-repo-chip.in-header { margin: 0; padding: 3px 9px; max-width: 360px; border-radius: 7px;
    background: #f1f2f6; border-color: #e9eaf2; font-size: 12px; }
.dev-repo-chip.in-header:hover { background: #e9ebf3; border-color: #dcdfeb; }
.dev-repo-chip.in-header .dev-repo-branch { background: #fff; border: 1px solid #e3e5f0; }
.dev-repo-chip.is-unset { color: #2f3a8f; font-weight: 500; }
.dev-repo-mark { width: 14px; height: 14px; flex: none; opacity: .75; }
.dev-repo-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.dev-repo-branch { flex: none; padding: 1px 8px; border-radius: 20px; background: #eef0f6;
    color: #6b7280; font-size: 11px; font-family: 'Roboto Mono', ui-monospace, Consolas, monospace; }
.dev-repo-pencil { width: 12px; height: 12px; flex: none; opacity: 0; transition: opacity .12s ease; }
.dev-repo-chip:hover .dev-repo-pencil { opacity: .6; }

.dev-repo-edit { display: flex; gap: 8px; width: 100%; }
.dev-repo-input { flex: 1; min-width: 0; border: 1px solid #d7d9e6; border-radius: 8px; padding: 7px 11px; font-size: 13px; color: #3a3f52; font-family: inherit; }
.dev-repo-base { width: 104px; flex: none; border: 1px solid #d7d9e6; border-radius: 8px; padding: 7px 11px; font-size: 13px; color: #3a3f52; font-family: inherit; }
.dev-repo-input:focus, .dev-repo-base:focus { outline: none; border-color: #7b8ce0; box-shadow: 0 0 0 3px rgba(123, 140, 224, .14); }
.dev-repo-save, .dev-repo-cancel { flex: none; padding: 0 13px; border-radius: 8px; font-size: 12.5px; cursor: pointer; font-family: inherit; }
.dev-repo-save { border: none; background: #2f3a8f; color: #fff; }
.dev-repo-cancel { border: 1px solid #d7d9e6; background: #fff; color: #6b7280; }
.dev-repo-hint { font-size: 11px; color: #9aa0b4; padding: 0 2px 8px; line-height: 1.45; }
.dev-messages { flex: 1; overflow-y: auto; padding: 14px 2px 8px; display: flex; flex-direction: column; gap: 22px; }
.dev-empty { text-align: center; color: #9aa0b4; margin: auto; max-width: 420px; padding: 24px; }
.dev-empty-icon { font-size: 34px; margin-bottom: 10px; }
.dev-empty p { font-size: 13px; line-height: 1.55; }
/* A column, so the timestamp can sit under the bubble instead of inside it. */
.dev-msg { display: flex; flex-direction: column; gap: 4px; }
.dev-msg.is-user { align-items: flex-end; }
.dev-msg.is-agent { align-items: flex-start; }
.dev-bubble { font-size: 14px; line-height: 1.62; }
.is-user .dev-bubble { max-width: 82%; background: #eaf0ff; color: #23305f; border-radius: 14px;
    border-top-right-radius: 6px; padding: 10px 14px; }
/* The agent's turn is the page, not a card in it. A bubble here fought the reading
   column: it boxed prose into a narrow grey well and left the rest of the row empty. */
/* Fills the column: as a flex-column child it would otherwise shrink to its content. */
.is-agent .dev-bubble { width: 100%; max-width: 100%; color: #2f3444; }
.dev-text { white-space: pre-wrap; word-break: break-word; }
/* Markdown brings its own block structure, and md.render() puts newlines between the
   tags — under pre-wrap each of those became a rendered blank line. */
.is-agent .dev-text { white-space: normal; }
.dev-pr { display: inline-block; margin-top: 6px; font-size: 12px; color: #2f3a8f; word-break: break-all; }
.dev-act { border: none; border-radius: 6px; padding: 5px 12px; font-size: 12px; cursor: pointer; font-family: inherit; }
.dev-act:disabled { opacity: .5; cursor: default; }
.dev-act--go { background: #2f3a8f; color: #fff; }
.dev-act--stop { background: #fff; color: #c0392b; border: 1px solid #e6bcbc; }
/* The field itself carries no border now — the box around it does. */
.dev-textarea { display: block; width: 100%; border: 0; background: none; padding: 6px 6px 2px;
    font-size: 14px; line-height: 1.55; color: #3a3f52; resize: none; overflow-y: auto;
    font-family: inherit; min-height: 26px; max-height: 220px; }
.dev-textarea:focus { outline: none; }
.dev-send { display: flex; align-items: center; justify-content: center; width: 30px; height: 30px;
    box-sizing: border-box; background: #2f3a8f; color: #fff; border: none; border-radius: 8px;
    font-size: 13px; cursor: pointer; padding: 0; }
.dev-send svg { width: 16px; height: 16px; }
.dev-send:disabled { opacity: .35; cursor: default; }
/* Same footprint as send, so the composer does not shift when a turn starts. */
.dev-send--stop { background: #fff; color: #c0392b; border: 1px solid #e6bcbc; }
.dev-send--stop:hover:not(:disabled) { background: #fdeceb; }
.dev-send--stop svg { width: 13px; height: 13px; }
.dev-hint { font-size: 12px; color: #9aa0b4; padding: 0 2px 6px; }
/* Rendered markdown. Chat-scale spacing, not document-scale: this is a reply in a
   thread, so the rhythm between turns has to stay louder than the rhythm inside one.

   :deep() is not optional here. This subtree arrives through v-html, so it carries
   no scope attribute and a plain descendant selector never matches it — every rule
   below was silently dead, leaving the browser's document defaults (1.5em headings,
   1em paragraph margins, 40px list indents) to style the replies. */
/* Headings are the only blocks below that carry a top margin, so only they need
   the opening-gap reset — a bare :first-child would reach every nesting level. */
.dev-md :deep(h1:first-child), .dev-md :deep(h2:first-child),
.dev-md :deep(h3:first-child), .dev-md :deep(h4:first-child) { margin-top: 0; }
.dev-md :deep(:last-child) { margin-bottom: 0; }
.dev-md :deep(p) { margin: 0 0 11px; }
.dev-md :deep(ul), .dev-md :deep(ol) { margin: 0 0 11px; padding-left: 20px; }
.dev-md :deep(li) { margin-bottom: 5px; }
.dev-md :deep(li > p) { margin-bottom: 4px; }
.dev-md :deep(li > ul), .dev-md :deep(li > ol) { margin: 4px 0 0; }
/* Two steps only — a chat reply is not a document outline. */
.dev-md :deep(h1), .dev-md :deep(h2) { font-size: 16px; font-weight: 600; margin: 20px 0 7px; }
.dev-md :deep(h3), .dev-md :deep(h4) { font-size: 14.5px; font-weight: 600; margin: 16px 0 6px; }
.dev-md :deep(a) { color: #2f3990; word-break: break-word; }
.dev-md :deep(code) {
    font-family: 'Roboto Mono', ui-monospace, Consolas, monospace;
    font-size: .88em;
    background: #eceef6;
    border-radius: 4px;
    padding: 1px 4px;
    word-break: break-word;
}
/* A code block scrolls inside itself — a long line must never widen the thread. */
.dev-md :deep(pre) {
    margin: 0 0 8px;
    padding: 9px 11px;
    background: #f3f4fa;
    border: 1px solid #e3e5f0;
    border-radius: 8px;
    overflow-x: auto;
}
.dev-md :deep(pre code) { background: none; padding: 0; font-size: 12px; line-height: 1.5; white-space: pre; }
.dev-md :deep(blockquote) { margin: 0 0 8px; padding-left: 10px; border-left: 3px solid #dfe2f0; color: #6b7280; }
.dev-md :deep(table) { border-collapse: collapse; margin: 0 0 8px; display: block; overflow-x: auto; }
.dev-md :deep(th), .dev-md :deep(td) { border: 1px solid #e3e5f0; padding: 4px 8px; font-size: 12px; }
.dev-md :deep(hr) { border: 0; border-top: 1px solid #e3e5f0; margin: 10px 0; }

/* The activity trail: present, quiet, closed by default. Now that the agent's turn
   has no bubble behind it this reads as a line of its own, so it sits above the
   prose it produced rather than looking like a chip stuck to a grey box. */
.dev-trail { margin-top: 10px; }
.dev-trail:first-child { margin-top: 0; }
.dev-trail summary {
    font-size: 12px;
    color: #9aa0b4;
    cursor: pointer;
    list-style: none;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border-radius: 5px;
    padding: 1px 5px 1px 3px;
}
.dev-trail summary:hover { background: #f4f5f9; }
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

/* A line of text, not a panel: it sits directly above the composer, and a bordered,
   filled strip there read as a second input box stacked on the real one. */
.dev-live { display: flex; align-items: center; gap: 8px; padding: 4px 2px; font-size: 12px; min-width: 0; overflow: hidden; }
.dev-live .dev-spinner { margin-right: 0; flex: none; }
/* Both labels must be able to shrink, or a long line widens the whole panel. */
.dev-live-head { font-weight: 600; color: #4b5563; white-space: nowrap; flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
/* Shrinks but never grows — the gap after it is what pushes the actions right, so an
   empty activity line does not leave them stranded mid-row. */
.dev-live-last { color: #9aa0b4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 0 1 auto; min-width: 0; }
.dev-live-gap { flex: 1 1 auto; min-width: 8px; }
.dev-live .dev-act { flex: none; padding: 4px 11px; }
.dev-err { font-size: 12px; color: #c0392b; padding: 0 2px 6px; }
.dev-empty-hint { font-size: 12px; color: #9aa0b4; margin-top: 10px; }
/* One running indicator, in the live strip above the composer. The message bubble used
   to pulse its own dot in red as well, which read as an error beside the real one. */
/* An asterisk that turns and breathes, rather than a blinking dot — a dot that flashes
   on and off reads as an alarm, which is the wrong note for "this is going fine". */
.dev-spinner { display: block; width: 13px; height: 13px; flex: none; color: #2f3a8f;
    transform-origin: 50% 50%; animation: dev-star 2.6s ease-in-out infinite; }
@keyframes dev-star {
    0%   { transform: rotate(0deg) scale(.86); opacity: .55; }
    50%  { transform: rotate(180deg) scale(1.06); opacity: 1; }
    100% { transform: rotate(360deg) scale(.86); opacity: .55; }
}
@media (prefers-reduced-motion: reduce) {
    .dev-spinner { animation: none; opacity: .8; }
}
</style>
