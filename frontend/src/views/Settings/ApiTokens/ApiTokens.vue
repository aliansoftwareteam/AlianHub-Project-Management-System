<template>
    <div class="tok">
        <!-- AI Bot developer — hidden: the Development tab and the pairing card
             below no longer depend on this per-user flag. Flip to v-if="true"
             to bring the enable/disable control back. -->
        <div v-if="false" class="tok-card">
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

        <!-- Claude sign-in. Same control as the chat window's banner, in the shape
             that always states where things stand — this is the page you open to
             check, so silence when signed in would be unhelpful here. -->
        <div class="tok-card">
            <div class="tok-head">
                <div>
                    <h3 class="m-0">Claude sign-in</h3>
                    <p class="tok-sub">The AI needs your connected computer to be signed in to Claude. Sign in here and the browser opens on that machine — no terminal needed. If you sign out anywhere, this goes back to showing a Sign in button.</p>
                </div>
            </div>
            <ClaudeAuthStatus variant="row" />
        </div>

        <!-- Connect this computer (one-time per machine) -->
        <div class="tok-card">
            <div class="tok-head">
                <div>
                    <h3 class="m-0">Connect this computer</h3>
                    <p class="tok-sub">One-time setup per machine. Click <b>Connect Computer</b>, then open the file it downloads — the AI dev-agent installs and starts itself, then develops the tasks you assign it (or run from a task's Development tab) right here in the background. Needs Node 18+, the <code>claude</code> CLI (logged in) and <code>gh</code> on this machine.</p>
                </div>
            </div>
            <div class="tok-actions">
                <button class="tok-btn" :disabled="connecting" @click="connectComputer()">{{ connecting ? 'Preparing…' : '⚡ Connect Computer' }}</button>
                <span class="tok-os">or&nbsp;<a href="#" @click.prevent="connectComputer('win')">Windows</a> · <a href="#" @click.prevent="connectComputer('mac')">macOS</a> · <a href="#" @click.prevent="connectComputer('linux')">Linux</a></span>
                <span v-if="connectMsg" class="tok-msg" :class="connectMsgType">{{ connectMsg }}</span>
            </div>
            <p v-if="downloaded" class="tok-note">Downloaded <b>{{ downloadedName }}</b> — open / double-click it to finish. Keep that window running; it develops your assigned tasks in the background. (Your OS may ask you to allow it the first time — choose Open / Run anyway.)</p>
        </div>
    </div>
</template>

<script setup>
import { ref } from 'vue';
import { apiRequest } from '@/services';
import ClaudeAuthStatus from '@/components/molecules/ClaudeAuthStatus/ClaudeAuthStatus.vue';
import { useAiBot } from '@/composable/useAiBot';

const botLoading = ref(false);
const { aiBotEnabled, setAiBotEnabled } = useAiBot(); // per-user, local (not in the DB)
const botMsg = ref('');
const botMsgType = ref('');

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

// ── Connect this computer (one-time) ──────────────────────────────────
// One click: mint a fresh pairing code, then download a pre-filled launcher
// (.cmd on Windows, .command/.sh on macOS/Linux) for the detected OS. The
// developer just opens the file — it fetches the runner and starts the paired
// agent (`--pair` both pairs and begins polling). The launcher endpoint is
// public; the single-use pairing code is the secret.
const connecting = ref(false);
const connectMsg = ref('');
const connectMsgType = ref('');
const downloaded = ref(false);
const downloadedName = ref('');

const detectOs = () => {
    const ua = `${navigator.userAgent || ''} ${navigator.platform || ''}`;
    if (/Win/i.test(ua)) return 'win';
    if (/Mac/i.test(ua)) return 'mac';
    return 'linux';
};

const connectComputer = async (osArg) => {
    if (connecting.value) return;
    connecting.value = true; connectMsg.value = ''; downloaded.value = false;
    try {
        const body = (await apiRequest('post', '/api/v2/dev-agent/pair', {}))?.data;
        if (!(body && body.status && body.data && body.data.code)) {
            connectMsg.value = (body && (body.statusText || body.message)) || 'Could not start pairing';
            connectMsgType.value = 'err';
            return;
        }
        const os = osArg || detectOs();
        const origin = window.location.origin;
        const url = `${origin}/api/v2/dev-agent-launcher?code=${encodeURIComponent(body.data.code)}&os=${os}&base=${encodeURIComponent(origin)}`;
        const name = os === 'win' ? 'connect-alianhub.cmd' : (os === 'mac' ? 'connect-alianhub.command' : 'connect-alianhub.sh');
        const a = document.createElement('a');
        a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
        downloaded.value = true; downloadedName.value = name;
    } catch (e) {
        connectMsg.value = (e && e.response && e.response.data && (e.response.data.statusText || e.response.data.message)) || (e && e.message) || 'Failed';
        connectMsgType.value = 'err';
    } finally { connecting.value = false; }
};
</script>

<style scoped>
.tok { padding: 20px; display: flex; flex-direction: column; gap: 18px; font-family: 'Roboto', sans-serif; }
.tok-card { background: #fff; border: 1px solid #e6e7ee; border-radius: 10px; padding: 20px; }
.tok-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.tok-sub { color: #6b7280; font-size: 13px; margin: 6px 0 16px; max-width: 640px; line-height: 1.5; }
.tok-actions { display: flex; align-items: center; gap: 12px; margin-top: 4px; }
.tok-btn { background: #2f3a8f; color: #fff; border: none; border-radius: 7px; padding: 8px 16px; font-size: 13px; cursor: pointer; }
.tok-btn:disabled { opacity: .55; cursor: default; }
.tok-btn-del { background: #fff; color: #c0392b; border: 1px solid #e6bcbc; border-radius: 6px; padding: 5px 12px; font-size: 12px; cursor: pointer; }
.tok-btn-del:disabled { opacity: .55; cursor: default; }
.tok-msg { font-size: 13px; }
.tok-msg.ok { color: #1c7a43; }
.tok-msg.err { color: #c0392b; }
.tok-os { font-size: 12px; color: #9aa0b4; }
.tok-os a { color: #2f3a8f; cursor: pointer; text-decoration: none; }
.tok-os a:hover { text-decoration: underline; }
.tok-note { font-size: 12px; color: #6b7280; line-height: 1.5; margin: 12px 0 0; background: #f6f8ff; border: 1px solid #e6e9f5; border-radius: 7px; padding: 9px 11px; }
.tok-sub code { background: #eef0f6; padding: 1px 5px; border-radius: 4px; font-size: 12px; }
</style>
