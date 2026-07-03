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
                    <button class="aib-btn-ghost" :disabled="loadingAudit" @click="loadAudit">{{ loadingAudit ? 'Loading…' : 'Refresh' }}</button>
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

const fmtTime = (d) => {
    if (!d) return '—';
    try { return new Date(d).toLocaleString(); } catch (e) { return String(d); }
};

const loadSettings = async () => {
    try {
        const body = (await apiRequest('get', `${BASE}/settings`))?.data;
        if (body && body.status && body.data) {
            const d = body.data;
            form.autonomyLevel = Number(d.autonomyLevel) || 0;
            form.killSwitch = !!d.killSwitch;
            form.dailyActionLimit = Number(d.dailyActionLimit) || 0;
            form.spendCapUSD = Number(d.spendCapUSD) || 0;
        }
    } catch (e) { /* no settings yet — defaults stand */ }
};

const saveSettings = async () => {
    if (savingSettings.value) return;
    savingSettings.value = true; settingsMsg.value = '';
    try {
        const body = (await apiRequest('post', `${BASE}/settings`, {
            autonomyLevel: form.autonomyLevel,
            killSwitch: form.killSwitch,
            dailyActionLimit: form.dailyActionLimit,
            spendCapUSD: form.spendCapUSD,
            callerRoleType: roleType.value,
            callerUserId: callerUserId.value,
        }))?.data;
        if (body && body.status) { settingsMsg.value = 'Saved'; settingsMsgType.value = 'ok'; }
        else { settingsMsg.value = (body && body.message) || 'Failed'; settingsMsgType.value = 'err'; }
    } catch (e) {
        settingsMsg.value = 'Failed to save';
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
            inboxMsg.value = decision === 'approve' ? 'Approved' : 'Declined';
            inboxMsgType.value = 'ok';
            await Promise.all([loadInbox(), loadAudit()]);
        } else {
            inboxMsg.value = (body && body.message) || 'Failed';
            inboxMsgType.value = 'err';
        }
    } catch (e) {
        inboxMsg.value = 'Failed';
        inboxMsgType.value = 'err';
    } finally {
        deciding.value = '';
    }
};

const loadAudit = async () => {
    if (loadingAudit.value) return;
    loadingAudit.value = true;
    try {
        const body = (await apiRequest('post', `${BASE}/audit`, { limit: 50 }))?.data;
        audit.value = (body && body.status && body.data) ? body.data : [];
    } catch (e) { audit.value = []; } finally { loadingAudit.value = false; }
};

onMounted(() => {
    if (!isAdmin.value) return;
    loadSettings();
    loadInbox();
    loadAudit();
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
.aib-msg { font-size: 13px; }
.aib-msg.ok { color: #1c7a43; }
.aib-msg.err { color: #c0392b; }
</style>
