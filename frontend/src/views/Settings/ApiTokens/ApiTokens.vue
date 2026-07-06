<template>
    <div class="tok">
        <!-- AI Bot developer -->
        <div class="tok-card">
            <div class="tok-head">
                <div>
                    <h3 class="m-0">AI Bot developer</h3>
                    <p class="tok-sub">Enable an assignable "AI Bot" user. Assign it to any task and the dev-agent auto-develops it (using the repo you last set in that task's Development tab) — through the same Development-chat pipeline. Enabling shows it in <b>your</b> assignee picker only — other members won't see it, and it never appears in the Members list.</p>
                </div>
            </div>
            <div class="tok-actions">
                <button v-if="!aiBotEnabled" class="tok-btn" :disabled="botLoading" @click="enableBot">{{ botLoading ? 'Enabling…' : 'Enable AI Bot' }}</button>
                <button v-else class="tok-btn-del" :disabled="botLoading" @click="disableBot">Disable AI Bot</button>
                <span v-if="aiBotEnabled && !botMsg" class="tok-msg ok">✓ Enabled for you — assignable on tasks</span>
                <span v-if="botMsg" class="tok-msg" :class="botMsgType">{{ botMsg }}</span>
            </div>
        </div>

        <!-- Create -->
        <div class="tok-card">
            <div class="tok-head">
                <div>
                    <h3 class="m-0">API Tokens</h3>
                    <p class="tok-sub">Personal access tokens for scripts, integrations and the AI dev-agent. A token is shown only once at creation — copy it right away.</p>
                </div>
            </div>

            <div class="tok-row">
                <label>Token name</label>
                <input v-model="form.name" type="text" class="form-control" placeholder="e.g. dev-agent" />
            </div>
            <div class="tok-scopes">
                <label class="tok-chk"><input v-model="form.read" type="checkbox" /> read</label>
                <label class="tok-chk"><input v-model="form.write" type="checkbox" /> write</label>
                <div class="tok-row tok-exp">
                    <label>Expires in days <span class="tok-hint">(blank = never)</span></label>
                    <input v-model="form.expiresInDays" type="number" min="1" class="form-control" placeholder="never" />
                </div>
            </div>
            <div class="tok-actions">
                <button class="tok-btn" :disabled="creating || !form.name.trim() || (!form.read && !form.write)" @click="createToken">{{ creating ? 'Creating…' : 'Create token' }}</button>
                <span v-if="msg" class="tok-msg" :class="msgType">{{ msg }}</span>
            </div>

            <div v-if="newToken" class="tok-new">
                <div class="tok-new-label">✅ Copy this token now — it won't be shown again:</div>
                <div class="tok-new-row">
                    <code class="tok-token">{{ newToken }}</code>
                    <button class="tok-btn-ghost" @click="copyToken">{{ copied ? 'Copied ✓' : 'Copy' }}</button>
                </div>
            </div>
        </div>

        <!-- List -->
        <div class="tok-card">
            <div class="tok-head">
                <div><h3 class="m-0">Your tokens</h3></div>
                <button class="tok-btn-ghost" :disabled="loading" @click="loadTokens">{{ loading ? 'Loading…' : 'Refresh' }}</button>
            </div>
            <div class="tok-table-wrap">
                <table class="tok-table">
                    <thead>
                        <tr><th>Name</th><th>Prefix</th><th>Scopes</th><th>Created</th><th>Last used</th><th></th></tr>
                    </thead>
                    <tbody>
                        <tr v-for="t in tokens" :key="tid(t)">
                            <td>{{ t.name }}</td>
                            <td><code>{{ t.prefix }}…</code></td>
                            <td>{{ (t.scopes || []).join(', ') || '—' }}</td>
                            <td class="tok-nowrap">{{ fmt(t.createdAt) }}</td>
                            <td class="tok-nowrap">{{ t.lastUsedAt ? fmt(t.lastUsedAt) : '—' }}</td>
                            <td class="tok-right"><button class="tok-btn-del" :disabled="revoking === tid(t)" @click="revoke(t)">Revoke</button></td>
                        </tr>
                        <tr v-if="!tokens.length && !loading"><td colspan="6" class="tok-empty">No tokens yet.</td></tr>
                        <tr v-if="loading && !tokens.length"><td colspan="6" class="tok-empty">Loading…</td></tr>
                    </tbody>
                </table>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, reactive, onMounted, inject } from 'vue';
import { apiRequest } from '@/services';
import { useAiBot } from '@/composable/useAiBot';

const BASE = '/api/v2/api-tokens';
const userIdRef = inject('$userId', ref(''));
const userId = () => ((userIdRef && userIdRef.value) ? String(userIdRef.value) : '');

const tokens = ref([]);
const loading = ref(false);
const form = reactive({ name: '', read: true, write: true, expiresInDays: '' });
const creating = ref(false);
const newToken = ref('');
const copied = ref(false);
const revoking = ref('');
const msg = ref('');
const msgType = ref('');
const botLoading = ref(false);
const { aiBotEnabled, setAiBotEnabled } = useAiBot(); // per-user, local (not in the DB)
const botMsg = ref('');
const botMsgType = ref('');

const tid = (t) => String((t && (t.id || t._id)) || '');
const fmt = (d) => { if (!d) return '—'; try { return new Date(d).toLocaleDateString(); } catch (e) { return String(d); } };

const loadTokens = async () => {
    if (loading.value) return;
    loading.value = true;
    try {
        const body = (await apiRequest('get', BASE))?.data;
        tokens.value = (body && body.status && Array.isArray(body.data)) ? body.data : [];
    } catch (e) { tokens.value = []; } finally { loading.value = false; }
};

const createToken = async () => {
    if (creating.value || !form.name.trim()) return;
    creating.value = true; msg.value = ''; newToken.value = ''; copied.value = false;
    try {
        const scopes = [form.read ? 'read' : null, form.write ? 'write' : null].filter(Boolean);
        const payload = { name: form.name.trim(), scopes, userData: { id: userId() } };
        if (form.expiresInDays) payload.expiresInDays = Number(form.expiresInDays);
        const body = (await apiRequest('post', BASE, payload))?.data;
        if (body && body.status && body.data && body.data.token) {
            newToken.value = body.data.token;
            form.name = '';
            msg.value = 'Created'; msgType.value = 'ok';
            await loadTokens();
        } else {
            msg.value = (body && (body.statusText || body.message)) || 'Failed to create token';
            msgType.value = 'err';
        }
    } catch (e) {
        msg.value = (e && e.response && e.response.data && (e.response.data.statusText || e.response.data.message)) || (e && e.message) || 'Failed';
        msgType.value = 'err';
    } finally { creating.value = false; }
};

const copyToken = async () => {
    try { await navigator.clipboard.writeText(newToken.value); copied.value = true; setTimeout(() => { copied.value = false; }, 2000); } catch (e) { /* clipboard blocked — user can select manually */ }
};

const revoke = async (t) => {
    if (revoking.value) return;
    revoking.value = tid(t);
    try {
        await apiRequest('delete', `${BASE}/${tid(t)}`);
        await loadTokens();
    } catch (e) { /* keep list */ } finally { revoking.value = ''; }
};

// Enabling is per-user + local: we flip a local flag so the bot shows in THIS
// developer's picker only. The one server call just ensures the shared bot user
// exists (idempotent) so task assignments resolve for everyone.
const enableBot = async () => {
    if (botLoading.value) return;
    botLoading.value = true; botMsg.value = '';
    try {
        const body = (await apiRequest('post', '/api/v2/dev-agent/bot', {}))?.data;
        if (body && body.status) { setAiBotEnabled(true); botMsg.value = 'AI Bot enabled for you — assign it to a task to auto-develop.'; botMsgType.value = 'ok'; }
        else { botMsg.value = (body && (body.statusText || body.message)) || 'Failed to enable'; botMsgType.value = 'err'; }
    } catch (e) {
        botMsg.value = (e && e.response && e.response.data && (e.response.data.statusText || e.response.data.message)) || (e && e.message) || 'Failed';
        botMsgType.value = 'err';
    } finally { botLoading.value = false; }
};

// Disabling is purely local — just hide it from THIS developer's picker.
const disableBot = () => {
    setAiBotEnabled(false);
    botMsg.value = 'AI Bot hidden from your picker.'; botMsgType.value = 'ok';
};

onMounted(loadTokens);
</script>

<style scoped>
.tok { padding: 20px; display: flex; flex-direction: column; gap: 18px; font-family: 'Roboto', sans-serif; }
.tok-card { background: #fff; border: 1px solid #e6e7ee; border-radius: 10px; padding: 20px; }
.tok-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.tok-sub { color: #6b7280; font-size: 13px; margin: 6px 0 16px; max-width: 640px; line-height: 1.5; }
.tok-row { display: flex; flex-direction: column; gap: 5px; margin-bottom: 12px; }
.tok-row > label { font-size: 13px; font-weight: 600; color: #3a3f52; }
.tok-hint { font-weight: 400; color: #9aa0b4; }
.tok-scopes { display: flex; align-items: flex-end; gap: 18px; margin-bottom: 8px; flex-wrap: wrap; }
.tok-chk { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #3a3f52; cursor: pointer; }
.tok-exp { margin-bottom: 0; min-width: 220px; }
.tok-actions { display: flex; align-items: center; gap: 12px; margin-top: 4px; }
.tok-btn { background: #2f3a8f; color: #fff; border: none; border-radius: 7px; padding: 8px 16px; font-size: 13px; cursor: pointer; }
.tok-btn:disabled { opacity: .55; cursor: default; }
.tok-btn-ghost { background: #fff; color: #2f3a8f; border: 1px solid #cdd2e6; border-radius: 7px; padding: 7px 14px; font-size: 13px; cursor: pointer; white-space: nowrap; }
.tok-btn-del { background: #fff; color: #c0392b; border: 1px solid #e6bcbc; border-radius: 6px; padding: 5px 12px; font-size: 12px; cursor: pointer; }
.tok-btn-del:disabled { opacity: .55; cursor: default; }
.tok-new { margin-top: 14px; background: #f0f7f2; border: 1px solid #bfe3cd; border-radius: 8px; padding: 12px 14px; }
.tok-new-label { font-size: 13px; font-weight: 600; color: #1c7a43; margin-bottom: 8px; }
.tok-new-row { display: flex; align-items: center; gap: 10px; }
.tok-token { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; background: #fff; border: 1px solid #cfe6d8; border-radius: 6px; padding: 6px 10px; user-select: all; word-break: break-all; flex: 1; }
.tok-table-wrap { overflow-x: auto; border: 1px solid #e6e7ee; border-radius: 8px; margin-top: 4px; }
.tok-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.tok-table th { text-align: left; background: #f7f8fc; color: #3a3f52; font-weight: 700; padding: 10px 12px; border-bottom: 1px solid #e6e7ee; white-space: nowrap; }
.tok-table td { padding: 9px 12px; border-bottom: 1px solid #f0f1f6; color: #3a3f52; vertical-align: middle; }
.tok-table tr:last-child td { border-bottom: none; }
.tok-nowrap { white-space: nowrap; }
.tok-right { text-align: right; }
.tok-empty { text-align: center; color: #9aa0b4; padding: 20px 12px; }
.tok-msg { font-size: 13px; }
.tok-msg.ok { color: #1c7a43; }
.tok-msg.err { color: #c0392b; }
</style>
