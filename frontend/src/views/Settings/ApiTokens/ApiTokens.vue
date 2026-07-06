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
    </div>
</template>

<script setup>
import { ref } from 'vue';
import { apiRequest } from '@/services';
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
</style>
