<template>
    <div class="scim-settings">
        <div class="scim-card">
            <div class="scim-head">
                <h3 class="m-0">{{ $t('Scim.title') }}</h3>
                <label class="scim-switch">
                    <input type="checkbox" v-model="form.isEnabled" @change="saveConfig" />
                    <span>{{ form.isEnabled ? $t('Scim.enabled') : $t('Scim.disabled') }}</span>
                </label>
            </div>
            <p class="scim-sub">{{ $t('Scim.subtitle') }}</p>

            <div class="scim-row">
                <label>{{ $t('Scim.default_role') }}</label>
                <select v-model.number="form.defaultRoleType" class="form-control" @change="saveConfig">
                    <option :value="2">{{ $t('Scim.role_admin') }}</option>
                    <option :value="3">{{ $t('Scim.role_member') }}</option>
                    <option :value="4">{{ $t('Scim.role_guest') }}</option>
                </select>
                <small class="scim-hint">{{ $t('Scim.default_role_hint') }}</small>
            </div>

            <div class="scim-urls">
                <div class="scim-url-title">{{ $t('Scim.connect_hint') }}</div>
                <div class="scim-url"><b>{{ $t('Scim.base_url') }}</b><code>{{ baseUrl || '—' }}</code></div>
                <div class="scim-url"><b>{{ $t('Scim.token_label') }}</b>
                    <code v-if="newToken">{{ newToken }}</code>
                    <span v-else-if="hasToken" class="scim-muted">•••• {{ tokenLast4 }} — {{ $t('Scim.token_hidden') }}</span>
                    <span v-else class="scim-muted">{{ $t('Scim.no_token') }}</span>
                </div>
                <div v-if="newToken" class="scim-token-warn">
                    ⚠ {{ $t('Scim.token_once') }}
                    <button class="scim-btn-ghost" @click="copyToken">{{ copied ? $t('Scim.copied') : $t('Scim.copy') }}</button>
                </div>
            </div>

            <div class="scim-actions">
                <button class="scim-btn" :disabled="busy" @click="rotate">
                    {{ busy ? $t('Scim.working') : (hasToken ? $t('Scim.rotate') : $t('Scim.generate')) }}
                </button>
                <span v-if="msg" class="scim-msg" :class="msgType">{{ msg }}</span>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { apiRequest } from '@/services';
import * as env from '@/config/env';

// SEC-05 — admin SCIM provisioning config. Owner/admin only (enforced
// server-side in Modules/Scim). Enable SCIM, choose the default role for
// provisioned users, and mint the bearer token (shown ONCE) to paste into the
// IdP alongside the SCIM base URL.
const busy = ref(false);
const msg = ref(''); const msgType = ref('');
const baseUrl = ref(''); const hasToken = ref(false); const tokenLast4 = ref('');
const newToken = ref(''); const copied = ref(false);
const form = reactive({ isEnabled: false, defaultRoleType: 3 });

const load = async () => {
    try {
        const body = (await apiRequest('get', env.SCIM_CONFIG))?.data;
        if (body && body.status && body.data) {
            form.isEnabled = !!body.data.isEnabled;
            form.defaultRoleType = body.data.defaultRoleType || 3;
            hasToken.value = !!body.data.hasToken;
            tokenLast4.value = body.data.tokenLast4 || '';
            baseUrl.value = body.data.baseUrl || '';
        }
    } catch (e) { /* not configured yet */ }
};

const saveConfig = async () => {
    try {
        const body = (await apiRequest('put', env.SCIM_CONFIG, { isEnabled: form.isEnabled, defaultRoleType: form.defaultRoleType }))?.data;
        if (body && body.status) { msg.value = body.statusText || 'Saved'; msgType.value = 'ok'; }
        else { msg.value = (body && body.statusText) || 'Failed'; msgType.value = 'err'; }
    } catch (e) { msg.value = 'Failed'; msgType.value = 'err'; }
};

const rotate = async () => {
    if (busy.value) return;
    busy.value = true; msg.value = ''; newToken.value = '';
    try {
        const body = (await apiRequest('post', env.SCIM_TOKEN, {}))?.data;
        if (body && body.status && body.data) {
            newToken.value = body.data.token;
            baseUrl.value = body.data.baseUrl || baseUrl.value;
            hasToken.value = true;
            msg.value = body.statusText || ''; msgType.value = 'ok';
        } else { msg.value = (body && body.statusText) || 'Failed'; msgType.value = 'err'; }
    } catch (e) {
        msg.value = (e && e.response && e.response.data && e.response.data.statusText) || 'Failed'; msgType.value = 'err';
    } finally { busy.value = false; }
};

const copyToken = async () => {
    try { await navigator.clipboard.writeText(newToken.value); copied.value = true; setTimeout(() => (copied.value = false), 1500); } catch (e) { /* clipboard blocked */ }
};

onMounted(load);
</script>

<style scoped>
.scim-settings { padding: 20px; }
.scim-card { background: #fff; border: 1px solid #e6e7ee; border-radius: 10px; padding: 20px; max-width: 720px; }
.scim-head { display: flex; align-items: center; justify-content: space-between; }
.scim-sub { color: #6b7280; font-size: 13px; margin: 6px 0 18px; }
.scim-row { margin-bottom: 14px; display: flex; flex-direction: column; gap: 5px; }
.scim-row > label { font-size: 13px; font-weight: 600; color: #3a3f52; }
.scim-row .form-control { max-width: 280px; }
.scim-hint { color: #9aa0b4; font-size: 12px; }
.scim-switch { flex-direction: row !important; align-items: center; gap: 8px; cursor: pointer; font-size: 13px; }
.scim-urls { background: #f7f8fc; border-radius: 8px; padding: 12px 14px; margin: 8px 0 16px; }
.scim-url-title { font-size: 12px; font-weight: 700; color: #3a3f52; margin-bottom: 8px; }
.scim-url { font-size: 12px; margin-bottom: 6px; display: flex; flex-direction: column; gap: 2px; }
.scim-url code { background: #fff; border: 1px solid #e6e7ee; border-radius: 5px; padding: 4px 8px; word-break: break-all; }
.scim-muted { color: #9aa0b4; }
.scim-token-warn { font-size: 12px; color: #9a6b00; background: #fff8e6; border: 1px solid #f3e2b3; border-radius: 6px; padding: 8px 10px; margin-top: 8px; display: flex; align-items: center; gap: 10px; }
.scim-actions { display: flex; align-items: center; gap: 12px; }
.scim-btn { background: #2f3a8f; color: #fff; border: none; border-radius: 7px; padding: 8px 16px; font-size: 13px; cursor: pointer; }
.scim-btn:disabled { opacity: .55; cursor: default; }
.scim-btn-ghost { background: #fff; color: #2f3a8f; border: 1px solid #cdd2e6; border-radius: 6px; padding: 5px 12px; font-size: 12px; cursor: pointer; }
.scim-msg.ok { color: #1c7a43; font-size: 13px; }
.scim-msg.err { color: #c0392b; font-size: 13px; }
</style>
