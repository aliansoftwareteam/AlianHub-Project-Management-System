<template>
    <div class="aib">
        <!-- Non-admins never see this (nav is permission-gated + backend enforces),
             but guard here too for a clean message. -->
        <div v-if="!isAdmin" class="aib-card">
            <p class="aib-sub">The AI Brain is available to Owners / Admins only.</p>
        </div>

        <template v-else>
            <!-- 1. Autonomy & guardrails -->
            <div class="aib-card">
                <div class="aib-head">
                    <div>
                        <h3 class="m-0">AI Brain — Autonomy &amp; Guardrails</h3>
                        <p class="aib-sub">Control how much the autonomous agent may do on its own. Money, production deploys and deletes always require a human — by design.</p>
                    </div>
                    <label class="aib-switch aib-kill" :title="'Master stop — blocks every AI action'">
                        <input type="checkbox" v-model="form.killSwitch" />
                        <span>{{ form.killSwitch ? 'Kill switch: ON (all AI paused)' : 'Kill switch: off' }}</span>
                    </label>
                </div>

                <div class="aib-row">
                    <label>Autonomy level</label>
                    <select v-model.number="form.autonomyLevel" class="form-control">
                        <option v-for="o in AUTONOMY" :key="o.v" :value="o.v">{{ o.label }}</option>
                    </select>
                </div>

                <div class="aib-grid">
                    <div class="aib-row">
                        <label>Daily action limit <span class="aib-hint">(0 = unlimited)</span></label>
                        <input v-model.number="form.dailyActionLimit" type="number" min="0" class="form-control" />
                    </div>
                    <div class="aib-row">
                        <label>Monthly spend cap (USD) <span class="aib-hint">(0 = none)</span></label>
                        <input v-model.number="form.spendCapUSD" type="number" min="0" class="form-control" />
                    </div>
                </div>

                <div class="aib-actions">
                    <button class="aib-btn" :disabled="savingSettings" @click="saveSettings">{{ savingSettings ? 'Saving…' : 'Save settings' }}</button>
                    <span v-if="settingsMsg" class="aib-msg" :class="settingsMsgType">{{ settingsMsg }}</span>
                </div>
            </div>

            <!-- 1a. Agent capabilities -->
            <div class="aib-card">
                <div class="aib-head">
                    <div>
                        <h3 class="m-0">Agent Capabilities</h3>
                        <p class="aib-sub">Everything the agent is allowed to do. Turn a capability off to block it completely — it won't run or even be proposed, at any autonomy level. Production deploys and deletes always require a human regardless.</p>
                    </div>
                    <span class="aib-caps-summary">{{ enabledCount }} / {{ actions.length }} enabled</span>
                </div>
                <div class="aib-caps">
                    <label v-for="a in actions" :key="a.key" class="aib-cap" :class="{ 'aib-cap-off': capEnabled[a.key] === false }">
                        <input type="checkbox" :checked="capEnabled[a.key] !== false" @change="capEnabled[a.key] = $event.target.checked" />
                        <span class="aib-cap-main">
                            <span class="aib-cap-label">{{ a.label }}</span>
                            <span class="aib-action">{{ a.key }}</span>
                        </span>
                        <span class="aib-cap-meta">
                            <span class="aib-risk" :class="'aib-risk-' + a.riskLevel">{{ a.riskLevel }}</span>
                            <span class="aib-cap-gate">{{ a.neverAuto ? 'always needs approval' : 'auto ≥ L' + a.minAutonomyToAutoRun }}</span>
                        </span>
                    </label>
                    <p v-if="!actions.length" class="aib-empty">Loading capabilities…</p>
                </div>
                <div class="aib-actions" style="margin-top:14px;">
                    <button class="aib-btn" :disabled="savingSettings" @click="saveSettings">{{ savingSettings ? 'Saving…' : 'Save settings' }}</button>
                    <span v-if="settingsMsg" class="aib-msg" :class="settingsMsgType">{{ settingsMsg }}</span>
                </div>
            </div>

            <!-- 1c. Project repositories (Phase B — the dev runner's work location) -->
            <div class="aib-card">
                <div class="aib-head">
                    <div>
                        <h3 class="m-0">Project Repositories</h3>
                        <p class="aib-sub">Point each project at its code repo. Because AlianHub runs in the browser (which can't read your filesystem), you identify the repo by its <b>Git URL</b> — the self-hosted runner clones it and manages the local checkout itself, so you never type a folder path. Local path is optional, only for a repo the runner already has. (A pick-from-a-list selector arrives with the runner.)</p>
                    </div>
                </div>
                <div class="aib-grid">
                    <div class="aib-row">
                        <label>Project</label>
                        <select v-model="repoForm.projectId" class="form-control">
                            <option value="" disabled>Select a project…</option>
                            <option v-for="p in projectOptions" :key="p._id" :value="p._id">{{ p.ProjectName }}</option>
                        </select>
                    </div>
                    <div class="aib-row">
                        <label>Branch</label>
                        <input v-model="repoForm.branch" type="text" class="form-control" placeholder="main" />
                    </div>
                </div>
                <div class="aib-row">
                    <label>Git repository URL</label>
                    <input v-model="repoForm.gitUrl" type="text" class="form-control" placeholder="https://github.com/org/repo.git" />
                </div>
                <div class="aib-row">
                    <label>Local path <span class="aib-hint">(optional — only if the repo is already cloned on the runner machine)</span></label>
                    <input v-model="repoForm.localPath" type="text" class="form-control" placeholder="E:\path\to\repo" />
                </div>
                <div class="aib-actions">
                    <button class="aib-btn" :disabled="savingRepo || !repoForm.projectId || (!repoForm.gitUrl && !repoForm.localPath)" @click="saveRepo">{{ savingRepo ? 'Saving…' : 'Save binding' }}</button>
                    <span v-if="repoMsg" class="aib-msg" :class="repoMsgType">{{ repoMsg }}</span>
                </div>
                <div v-if="Object.keys(repos).length" class="aib-repo-list">
                    <div v-for="(r, pid) in repos" :key="pid" class="aib-repo-row">
                        <span class="aib-repo-name">{{ projectName(pid) }}</span>
                        <span class="aib-action">{{ r.localPath || r.gitUrl }}</span>
                        <span class="aib-repo-branch">{{ r.branch || 'main' }}</span>
                    </div>
                </div>
            </div>

            <!-- 1d. Dev runner (Phase B — runner token + queue a develop job) -->
            <div class="aib-card">
                <div class="aib-head">
                    <div>
                        <h3 class="m-0">Dev Runner</h3>
                        <p class="aib-sub">The self-hosted runner authenticates with a token and polls for approved "develop" jobs. Generate the token for your runner config, then send a task to develop — it lands in the AI Inbox for your approval, and once approved it's queued for the runner to build and open a PR.</p>
                    </div>
                </div>
                <div class="aib-actions">
                    <button class="aib-btn-ghost" :disabled="generatingToken" @click="generateRunnerToken">{{ generatingToken ? 'Generating…' : 'Generate runner token' }}</button>
                    <code v-if="runnerToken" class="aib-token">{{ runnerToken }}</code>
                    <span v-if="tokenMsg" class="aib-msg" :class="tokenMsgType">{{ tokenMsg }}</span>
                </div>

                <div class="aib-grid" style="margin-top: 8px;">
                    <div class="aib-row">
                        <label>Project</label>
                        <select v-model="devForm.projectId" class="form-control">
                            <option value="" disabled>Select a project…</option>
                            <option v-for="p in projectOptions" :key="p._id" :value="p._id">{{ p.ProjectName }}</option>
                        </select>
                    </div>
                    <div class="aib-row">
                        <label>Task ID <span class="aib-hint">(the task's _id to develop)</span></label>
                        <input v-model="devForm.taskId" type="text" class="form-control" placeholder="task _id" />
                    </div>
                </div>
                <div class="aib-actions">
                    <button class="aib-btn" :disabled="sendingDev || !devForm.projectId || !devForm.taskId" @click="sendToDevelop">{{ sendingDev ? 'Sending…' : 'Send to develop' }}</button>
                    <span v-if="devMsg" class="aib-msg" :class="devMsgType">{{ devMsg }}</span>
                </div>

                <template v-if="queuedJobs.length">
                    <div class="aib-section-sub">Queued for the runner ({{ queuedJobs.length }})</div>
                    <div class="aib-repo-list">
                        <div v-for="j in queuedJobs" :key="j._id" class="aib-repo-row">
                            <span class="aib-action">develop_task</span>
                            <span class="aib-repo-name">{{ j.taskId }}</span>
                            <span class="aib-repo-branch">{{ j.status }}</span>
                        </div>
                    </div>
                </template>
            </div>

            <!-- 1b. Run a skill -->
            <div class="aib-card">
                <div class="aib-head">
                    <div>
                        <h3 class="m-0">Run a Skill</h3>
                        <p class="aib-sub">Point a skill at a project. It reviews the project and proposes follow-ups into the AI inbox below — nothing changes until you approve.</p>
                    </div>
                </div>
                <div class="aib-grid">
                    <div class="aib-row">
                        <label>Skill</label>
                        <select v-model="run.skill" class="form-control">
                            <option value="" disabled>Select a skill…</option>
                            <option v-for="s in skills" :key="s.key" :value="s.key">{{ s.label }}</option>
                        </select>
                    </div>
                    <div class="aib-row">
                        <label>Project</label>
                        <select v-model="run.projectId" class="form-control">
                            <option value="" disabled>Select a project…</option>
                            <option v-for="p in projectOptions" :key="p._id" :value="p._id">{{ p.ProjectName }}</option>
                        </select>
                    </div>
                </div>
                <p v-if="selectedSkillDesc" class="aib-sub" style="margin-top:0">{{ selectedSkillDesc }}</p>
                <div class="aib-actions">
                    <button class="aib-btn" :disabled="running || !run.skill || !run.projectId" @click="runSkill">{{ running ? 'Running…' : 'Run skill' }}</button>
                    <span v-if="runMsg" class="aib-msg" :class="runMsgType">{{ runMsg }}</span>
                </div>
                <div v-if="runResult" class="aib-run-result">
                    <div v-if="runResult.summary" class="aib-run-summary">💡 {{ runResult.summary }}<span v-if="runResult.model" class="aib-run-model"> · {{ runResult.model }}</span></div>
                    Found <b>{{ runResult.found.overdue }}</b> overdue, <b>{{ runResult.found.stale }}</b> stale, <b>{{ runResult.found.unassigned }}</b> unassigned →
                    <b>{{ runResult.proposed }}</b> proposed<span v-if="runResult.executed">, <b>{{ runResult.executed }}</b> auto-run</span><span v-if="runResult.failed">, <b>{{ runResult.failed }}</b> failed</span><span v-if="runResult.blocked">, <b>{{ runResult.blocked }}</b> blocked</span><span v-if="runResult.skipped">, {{ runResult.skipped }} already handled</span>.
                    <div v-if="runResult.failed" class="aib-run-note">“Failed” = the action ran but errored — open Recent Activity below for the exact reason.</div>
                </div>
            </div>

            <!-- 2. AI inbox -->
            <div class="aib-card">
                <div class="aib-head">
                    <div>
                        <h3 class="m-0">AI Inbox <span v-if="inbox.length" class="aib-badge-count">{{ inbox.length }}</span></h3>
                        <p class="aib-sub">Actions the agent proposed that need your decision.</p>
                    </div>
                    <button class="aib-btn-ghost" :disabled="loadingInbox" @click="loadInbox">{{ loadingInbox ? 'Loading…' : 'Refresh' }}</button>
                </div>
                <div class="aib-table-wrap">
                    <table class="aib-table">
                        <thead>
                            <tr><th>Action</th><th>Why</th><th>Project / Task</th><th>Risk</th><th>Proposed</th><th></th></tr>
                        </thead>
                        <tbody>
                            <tr v-for="row in inbox" :key="row._id">
                                <td><span class="aib-action">{{ row.actionKey }}</span></td>
                                <td class="aib-why" :title="row.reason">{{ row.reason || '—' }}</td>
                                <td class="aib-nowrap">{{ row.projectId || '—' }}<span v-if="row.taskId"> / {{ row.taskId }}</span></td>
                                <td><span class="aib-risk" :class="'aib-risk-' + (row.riskLevel || 'low')">{{ row.riskLevel || 'low' }}</span></td>
                                <td class="aib-nowrap">{{ fmtTime(row.createdAt) }}</td>
                                <td class="aib-decide">
                                    <button class="aib-btn-sm" :disabled="deciding === String(row._id)" @click="decide(row, 'approve')">Approve</button>
                                    <button class="aib-btn-sm aib-btn-decline" :disabled="deciding === String(row._id)" @click="decide(row, 'decline')">Decline</button>
                                </td>
                            </tr>
                            <tr v-if="!inbox.length && !loadingInbox"><td colspan="6" class="aib-empty">Nothing waiting — the AI inbox is clear.</td></tr>
                            <tr v-if="loadingInbox && !inbox.length"><td colspan="6" class="aib-empty">Loading…</td></tr>
                        </tbody>
                    </table>
                </div>
                <span v-if="inboxMsg" class="aib-msg" :class="inboxMsgType">{{ inboxMsg }}</span>
            </div>

            <!-- 3. Recent activity (audit) -->
            <div class="aib-card">
                <div class="aib-head">
                    <div>
                        <h3 class="m-0">Recent AI Activity</h3>
                        <p class="aib-sub">Every decision and action the agent made — "AI did X because Y".</p>
                    </div>
                    <button class="aib-btn-ghost" :disabled="loadingAudit" @click="loadAudit(0)">{{ loadingAudit ? 'Loading…' : 'Refresh' }}</button>
                </div>
                <div class="aib-table-wrap">
                    <table class="aib-table">
                        <thead>
                            <tr><th>Time</th><th>Action</th><th>Status</th><th>Why</th><th>By</th></tr>
                        </thead>
                        <tbody>
                            <tr v-for="row in audit" :key="row._id">
                                <td class="aib-nowrap">{{ fmtTime(row.createdAt) }}</td>
                                <td><span class="aib-action">{{ row.actionKey || '—' }}</span></td>
                                <td><span class="aib-status" :class="'aib-status-' + (row.status || 'logged')">{{ row.status || 'logged' }}</span></td>
                                <td class="aib-why" :title="row.reason || row.error">{{ row.error || row.reason || '—' }}</td>
                                <td class="aib-nowrap">{{ row.actorType === 'user' ? 'Human' : 'AI' }}</td>
                            </tr>
                            <tr v-if="!audit.length && !loadingAudit"><td colspan="5" class="aib-empty">No AI activity yet.</td></tr>
                            <tr v-if="loadingAudit && !audit.length"><td colspan="5" class="aib-empty">Loading…</td></tr>
                        </tbody>
                    </table>
                </div>
                <div v-if="audit.length || auditPage > 0" class="aib-pager">
                    <button class="aib-btn-ghost" :disabled="auditPage === 0 || loadingAudit" @click="auditPrev">Prev</button>
                    <span class="aib-pager-info">Page {{ auditPage + 1 }}</span>
                    <button class="aib-btn-ghost" :disabled="!auditHasMore || loadingAudit" @click="auditNext">Next</button>
                </div>
            </div>
        </template>
    </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, inject } from 'vue';
import { useStore } from 'vuex';
import { apiRequest } from '@/services';

// AHE-3792 — AI Brain admin page (Phase 1: the safe spine). Owner/Admin only
// (nav is permission-gated and the backend enforces roleType 1/2). Read-only
// endpoints + settings/inbox mutations; touches no existing functionality.
const BASE = '/api/v1/ai-brain';

const { getters } = useStore();
const userIdRef = inject('$userId', ref(''));
const companyUserDetail = computed(() => getters['settings/companyUserDetail'] || {});
const roleType = computed(() => Number(companyUserDetail.value.roleType) || 3);
const isAdmin = computed(() => roleType.value === 1 || roleType.value === 2);
const callerUserId = computed(() => (userIdRef && userIdRef.value) ? String(userIdRef.value) : '');

const AUTONOMY = [
    { v: 0, label: 'L0 · Assist — manual only' },
    { v: 1, label: 'L1 · Suggest — proposes to the AI inbox' },
    { v: 2, label: 'L2 · Act in bounds — auto low-risk, proposes the rest' },
    { v: 3, label: 'L3 · Scheduled — runs on a cadence' },
    { v: 4, label: 'L4 · Lifecycle — end-to-end, humans only at the gates' },
];

const form = reactive({ autonomyLevel: 0, killSwitch: false, dailyActionLimit: 0, spendCapUSD: 0 });
const savingSettings = ref(false);
const settingsMsg = ref('');
const settingsMsgType = ref('');

const inbox = ref([]);
const loadingInbox = ref(false);
const deciding = ref('');
const inboxMsg = ref('');
const inboxMsgType = ref('');

const audit = ref([]);
const loadingAudit = ref(false);
const auditPage = ref(0);
const auditHasMore = ref(false);
const AUDIT_PAGE_SIZE = 10;

// Skills (Think step) — run a skill against a project.
const skills = ref([]);
const run = reactive({ skill: '', projectId: '' });
const running = ref(false);
const runResult = ref(null);
const runMsg = ref('');
const runMsgType = ref('');
const projectOptions = ref([]);
// Phase B — per-project repo bindings ("work location" for the dev runner).
const repos = ref({});
const repoForm = reactive({ projectId: '', gitUrl: '', branch: 'main', localPath: '' });
const savingRepo = ref(false);
const repoMsg = ref('');
const repoMsgType = ref('');
const projectName = (pid) => {
    const p = projectOptions.value.find((x) => String(x._id) === String(pid));
    return p ? p.ProjectName : pid;
};
// Phase B — dev runner token + "send a task to develop" trigger + queued jobs.
const runnerToken = ref('');
const generatingToken = ref(false);
const tokenMsg = ref('');
const tokenMsgType = ref('');
const devForm = reactive({ projectId: '', taskId: '' });
const sendingDev = ref(false);
const devMsg = ref('');
const devMsgType = ref('');
const queuedJobs = ref([]);
const selectedSkillDesc = computed(() => {
    const s = skills.value.find((x) => x.key === run.skill);
    return s ? s.description : '';
});

// Agent capabilities — the action registry ("hands") + a per-company on/off
// allow-list. An empty allow-list means "all capabilities enabled" (this
// matches the dispatcher, which treats an empty list as "all allowed").
const actions = ref([]);
const capEnabled = reactive({});     // { [actionKey]: boolean }  (false = disabled)
const savedAllowed = ref([]);        // allowedActions from the saved settings
const enabledCount = computed(() => actions.value.filter((a) => capEnabled[a.key] !== false).length);
const allCapsOn = computed(() => actions.value.length > 0 && actions.value.every((a) => capEnabled[a.key] !== false));
// Re-derive the checkboxes from the registry + saved allow-list. Safe to call
// after EITHER the actions or the settings load finishes (order-independent).
const syncCaps = () => {
    const allow = Array.isArray(savedAllowed.value) ? savedAllowed.value : [];
    actions.value.forEach((a) => { capEnabled[a.key] = allow.length === 0 ? true : allow.includes(a.key); });
};

const fmtTime = (d) => {
    if (!d) return '—';
    try { return new Date(d).toLocaleString(); } catch (e) { return String(d); }
};

// Pull the exact error out of a failed response / axios exception so the user
// sees the real cause, not a generic "failed".
const errText = (e, fallback) => (e && e.response && e.response.data && (e.response.data.error || e.response.data.message)) || (e && e.message) || fallback;

const loadSettings = async () => {
    try {
        const body = (await apiRequest('get', `${BASE}/settings`))?.data;
        if (body && body.status && body.data) {
            const d = body.data;
            form.autonomyLevel = Number(d.autonomyLevel) || 0;
            form.killSwitch = !!d.killSwitch;
            form.dailyActionLimit = Number(d.dailyActionLimit) || 0;
            form.spendCapUSD = Number(d.spendCapUSD) || 0;
            savedAllowed.value = Array.isArray(d.allowedActions) ? d.allowedActions.map(String) : [];
            syncCaps();
        }
    } catch (e) { /* no settings yet — defaults stand */ }
};

const saveSettings = async () => {
    if (savingSettings.value) return;
    savingSettings.value = true; settingsMsg.value = '';
    try {
        // All-on saves an empty list (= all allowed); any-off saves the
        // allow-list of the capabilities that stay enabled.
        const allowedActions = allCapsOn.value ? [] : actions.value.filter((a) => capEnabled[a.key] !== false).map((a) => a.key);
        const body = (await apiRequest('post', `${BASE}/settings`, {
            autonomyLevel: form.autonomyLevel,
            killSwitch: form.killSwitch,
            dailyActionLimit: form.dailyActionLimit,
            spendCapUSD: form.spendCapUSD,
            allowedActions,
            callerRoleType: roleType.value,
            callerUserId: callerUserId.value,
        }))?.data;
        if (body && body.status) { settingsMsg.value = 'Saved'; settingsMsgType.value = 'ok'; savedAllowed.value = allowedActions; }
        else { settingsMsg.value = (body && (body.error || body.message)) || 'Failed'; settingsMsgType.value = 'err'; }
    } catch (e) {
        settingsMsg.value = errText(e, 'Failed to save');
        settingsMsgType.value = 'err';
    } finally {
        savingSettings.value = false;
    }
};

const loadInbox = async () => {
    if (loadingInbox.value) return;
    loadingInbox.value = true;
    try {
        const body = (await apiRequest('get', `${BASE}/inbox?status=pending`))?.data;
        inbox.value = (body && body.status && body.data) ? body.data : [];
    } catch (e) { inbox.value = []; } finally { loadingInbox.value = false; }
};

const decide = async (row, decision) => {
    if (deciding.value) return;
    deciding.value = String(row._id);
    inboxMsg.value = '';
    try {
        const body = (await apiRequest('post', `${BASE}/inbox/decide`, {
            inboxId: String(row._id),
            decision,
            callerRoleType: roleType.value,
            callerUserId: callerUserId.value,
        }))?.data;
        if (body && body.status) {
            const oc = body.outcome;
            if (decision === 'approve' && oc && oc.status === 'queued') {
                inboxMsg.value = 'Approved — queued for the dev runner';
                inboxMsgType.value = 'ok';
            } else if (decision === 'approve' && oc && oc.status !== 'executed') {
                inboxMsg.value = oc.error || `Action ${oc.status}`;
                inboxMsgType.value = 'err';
            } else {
                inboxMsg.value = decision === 'approve' ? 'Approved' : 'Declined';
                inboxMsgType.value = 'ok';
            }
            await Promise.all([loadInbox(), loadAudit(), loadQueuedJobs()]);
        } else {
            inboxMsg.value = (body && (body.error || body.message)) || 'Failed';
            inboxMsgType.value = 'err';
        }
    } catch (e) {
        inboxMsg.value = errText(e, 'Failed');
        inboxMsgType.value = 'err';
    } finally {
        deciding.value = '';
    }
};

const loadAudit = async (page = 0) => {
    if (loadingAudit.value) return;
    loadingAudit.value = true;
    try {
        // Fetch one extra row to know whether a next page exists (no count query).
        const body = (await apiRequest('post', `${BASE}/audit`, { limit: AUDIT_PAGE_SIZE + 1, skip: page * AUDIT_PAGE_SIZE }))?.data;
        const rows = (body && body.status && body.data) ? body.data : [];
        auditHasMore.value = rows.length > AUDIT_PAGE_SIZE;
        audit.value = rows.slice(0, AUDIT_PAGE_SIZE);
        auditPage.value = page;
    } catch (e) { audit.value = []; auditHasMore.value = false; } finally { loadingAudit.value = false; }
};
const auditPrev = () => { if (auditPage.value > 0 && !loadingAudit.value) loadAudit(auditPage.value - 1); };
const auditNext = () => { if (auditHasMore.value && !loadingAudit.value) loadAudit(auditPage.value + 1); };

const loadSkills = async () => {
    try {
        const body = (await apiRequest('get', `${BASE}/skills`))?.data;
        skills.value = (body && body.status && body.data) ? body.data : [];
    } catch (e) { skills.value = []; }
};

const loadActions = async () => {
    try {
        const body = (await apiRequest('get', `${BASE}/actions`))?.data;
        actions.value = (body && body.status && body.data) ? body.data : [];
    } catch (e) { actions.value = []; }
    syncCaps();
};

// Projects for the picker — fetched directly (the projectData store isn't
// populated on the settings route). Active projects only.
const loadProjects = async () => {
    try {
        const body = (await apiRequest('get', '/api/v1/project'))?.data;
        const list = Array.isArray(body) ? body : (body && body.data) || [];
        projectOptions.value = list.filter((p) => p && p.statusType !== 'close' && !p.deletedStatusKey);
    } catch (e) { projectOptions.value = []; }
};

const loadRepos = async () => {
    try {
        const body = (await apiRequest('get', `${BASE}/repos`))?.data;
        repos.value = (body && body.status && body.data) ? body.data : {};
    } catch (e) { repos.value = {}; }
};

const saveRepo = async () => {
    if (savingRepo.value || !repoForm.projectId) return;
    savingRepo.value = true; repoMsg.value = '';
    try {
        const body = (await apiRequest('post', `${BASE}/repos`, {
            projectId: repoForm.projectId,
            gitUrl: repoForm.gitUrl,
            branch: repoForm.branch,
            localPath: repoForm.localPath,
            callerRoleType: roleType.value,
            callerUserId: callerUserId.value,
        }))?.data;
        if (body && body.status) {
            repos.value = body.data || repos.value;
            repoMsg.value = 'Saved';
            repoMsgType.value = 'ok';
        } else {
            repoMsg.value = (body && (body.error || body.message)) || 'Failed';
            repoMsgType.value = 'err';
        }
    } catch (e) {
        repoMsg.value = errText(e, 'Failed to save binding');
        repoMsgType.value = 'err';
    } finally {
        savingRepo.value = false;
    }
};

const generateRunnerToken = async () => {
    if (generatingToken.value) return;
    generatingToken.value = true; tokenMsg.value = '';
    try {
        const body = (await apiRequest('post', `${BASE}/runner-token`, { callerRoleType: roleType.value, callerUserId: callerUserId.value }))?.data;
        if (body && body.status && body.data) {
            runnerToken.value = body.data.runnerToken || '';
            tokenMsg.value = 'Generated — copy it now (shown once).';
            tokenMsgType.value = 'ok';
        } else {
            tokenMsg.value = (body && (body.error || body.message)) || 'Failed';
            tokenMsgType.value = 'err';
        }
    } catch (e) { tokenMsg.value = errText(e, 'Failed'); tokenMsgType.value = 'err'; }
    finally { generatingToken.value = false; }
};

const loadQueuedJobs = async () => {
    try {
        const body = (await apiRequest('get', `${BASE}/inbox?status=queued`))?.data;
        queuedJobs.value = (body && body.status && body.data) ? body.data : [];
    } catch (e) { queuedJobs.value = []; }
};

const sendToDevelop = async () => {
    if (sendingDev.value || !devForm.projectId || !devForm.taskId) return;
    sendingDev.value = true; devMsg.value = '';
    try {
        const body = (await apiRequest('post', `${BASE}/propose`, {
            actionKey: 'develop_task',
            projectId: devForm.projectId,
            taskId: devForm.taskId,
            reason: 'Manual: develop this task end-to-end.',
            callerUserId: callerUserId.value,
        }))?.data;
        if (body && body.status) {
            devMsg.value = 'Sent — approve it in the AI Inbox below to queue it for the runner.';
            devMsgType.value = 'ok';
            await Promise.all([loadInbox(), loadQueuedJobs()]);
        } else {
            devMsg.value = (body && (body.error || body.message)) || 'Failed';
            devMsgType.value = 'err';
        }
    } catch (e) { devMsg.value = errText(e, 'Failed to send'); devMsgType.value = 'err'; }
    finally { sendingDev.value = false; }
};

const runSkill = async () => {
    if (running.value || !run.skill || !run.projectId) return;
    running.value = true; runMsg.value = ''; runResult.value = null;
    try {
        const body = (await apiRequest('post', `${BASE}/skills/run`, {
            skill: run.skill,
            projectId: run.projectId,
            callerRoleType: roleType.value,
            callerUserId: callerUserId.value,
        }))?.data;
        if (body && body.status && body.data && body.data.status === 'ok') {
            runResult.value = body.data;
            runMsg.value = 'Done';
            runMsgType.value = 'ok';
            await Promise.all([loadInbox(), loadAudit()]);
        } else {
            runMsg.value = (body && body.data && body.data.error) || (body && (body.error || body.message)) || 'Failed';
            runMsgType.value = 'err';
        }
    } catch (e) {
        runMsg.value = errText(e, 'Failed to run skill');
        runMsgType.value = 'err';
    } finally {
        running.value = false;
    }
};

onMounted(() => {
    if (!isAdmin.value) return;
    loadSettings();
    loadInbox();
    loadAudit();
    loadSkills();
    loadActions();
    loadProjects();
    loadRepos();
    loadQueuedJobs();
});
</script>

<style scoped>
.aib { padding: 20px; display: flex; flex-direction: column; gap: 18px; }
.aib-card { background: #fff; border: 1px solid #e6e7ee; border-radius: 10px; padding: 20px; }
.aib-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.aib-sub { color: #6b7280; font-size: 13px; margin: 6px 0 16px; max-width: 640px; line-height: 1.5; }
.aib-row { margin-bottom: 14px; display: flex; flex-direction: column; gap: 5px; }
.aib-row > label { font-size: 13px; font-weight: 600; color: #3a3f52; }
.aib-hint { font-weight: 400; color: #9aa0b4; }
.aib-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.aib-switch { display: flex; flex-direction: row; align-items: center; gap: 8px; cursor: pointer; font-size: 13px; white-space: nowrap; }
.aib-kill { color: #c0392b; font-weight: 600; }
.aib-actions { display: flex; align-items: center; gap: 12px; margin-top: 4px; }
.aib-run-result { margin-top: 12px; font-size: 13px; color: #3a3f52; background: #f7f8fc; border-radius: 8px; padding: 10px 12px; }
.aib-run-note { margin-top: 6px; font-size: 12px; color: #9aa0b4; line-height: 1.5; }
.aib-run-summary { font-size: 13px; color: #2f3a8f; font-weight: 600; margin-bottom: 8px; line-height: 1.5; }
.aib-run-model { font-weight: 400; color: #9aa0b4; font-size: 12px; }
.aib-caps { display: flex; flex-direction: column; gap: 8px; }
.aib-cap { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border: 1px solid #e6e7ee; border-radius: 8px; cursor: pointer; }
.aib-cap:hover { background: #fafbff; }
.aib-cap-off { opacity: .55; }
.aib-cap > input { margin: 0; width: 16px; height: 16px; cursor: pointer; flex: none; }
.aib-cap-main { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; flex: 1; min-width: 0; }
.aib-cap-label { font-size: 13px; font-weight: 600; color: #3a3f52; }
.aib-cap-meta { display: flex; align-items: center; gap: 10px; white-space: nowrap; }
.aib-cap-gate { font-size: 11px; color: #9aa0b4; }
.aib-caps-summary { font-size: 12px; color: #6b7280; white-space: nowrap; }
.aib-repo-list { margin-top: 14px; display: flex; flex-direction: column; gap: 6px; }
.aib-repo-row { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border: 1px solid #eceef5; border-radius: 8px; font-size: 12px; }
.aib-repo-name { font-weight: 600; color: #3a3f52; min-width: 140px; }
.aib-repo-branch { color: #6b7280; margin-left: auto; }
.aib-token { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; background: #f1f2f6; color: #3a3f52; border-radius: 6px; padding: 4px 8px; user-select: all; word-break: break-all; }
.aib-section-sub { font-size: 12px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: .03em; margin: 16px 0 8px; }
.aib-btn { background: #2f3a8f; color: #fff; border: none; border-radius: 7px; padding: 8px 16px; font-size: 13px; cursor: pointer; }
.aib-btn:disabled { opacity: .55; cursor: default; }
.aib-btn-ghost { background: #fff; color: #2f3a8f; border: 1px solid #cdd2e6; border-radius: 7px; padding: 7px 14px; font-size: 13px; cursor: pointer; white-space: nowrap; }
.aib-btn-ghost:disabled { opacity: .5; cursor: default; }
.aib-btn-sm { background: #1c7a43; color: #fff; border: none; border-radius: 6px; padding: 5px 12px; font-size: 12px; cursor: pointer; margin-left: 6px; }
.aib-btn-sm:disabled { opacity: .55; cursor: default; }
.aib-btn-decline { background: #fff; color: #c0392b; border: 1px solid #e6bcbc; }
.aib-badge-count { background: #2f3a8f; color: #fff; border-radius: 10px; font-size: 11px; padding: 1px 8px; margin-left: 6px; vertical-align: middle; }
.aib-table-wrap { overflow-x: auto; border: 1px solid #e6e7ee; border-radius: 8px; }
.aib-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.aib-table th { text-align: left; background: #f7f8fc; color: #3a3f52; font-weight: 700; padding: 10px 12px; border-bottom: 1px solid #e6e7ee; white-space: nowrap; }
.aib-table td { padding: 9px 12px; border-bottom: 1px solid #f0f1f6; color: #3a3f52; vertical-align: middle; }
.aib-table tr:last-child td { border-bottom: none; }
.aib-nowrap { white-space: nowrap; }
.aib-why { max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.aib-decide { text-align: right; white-space: nowrap; }
.aib-action { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; background: #eef1fb; color: #2f3a8f; border-radius: 5px; padding: 2px 7px; }
.aib-risk { font-size: 11px; border-radius: 5px; padding: 2px 8px; text-transform: capitalize; }
.aib-risk-low { background: #e7f5ec; color: #1c7a43; }
.aib-risk-medium { background: #fff3e0; color: #b26a00; }
.aib-risk-high { background: #fdeaea; color: #c0392b; }
.aib-risk-critical { background: #c0392b; color: #fff; }
.aib-status { font-size: 11px; border-radius: 5px; padding: 2px 8px; text-transform: capitalize; }
.aib-status-executed { background: #e7f5ec; color: #1c7a43; }
.aib-status-proposed { background: #eef1fb; color: #2f3a8f; }
.aib-status-declined { background: #f1f2f6; color: #6b7280; }
.aib-status-blocked, .aib-status-failed { background: #fdeaea; color: #c0392b; }
.aib-empty { text-align: center; color: #9aa0b4; padding: 22px 12px; }
.aib-pager { display: flex; align-items: center; justify-content: flex-end; gap: 12px; margin-top: 12px; }
.aib-pager-info { font-size: 12px; color: #6b7280; }
.aib-msg { font-size: 13px; }
.aib-msg.ok { color: #1c7a43; }
.aib-msg.err { color: #c0392b; }
</style>
