<template>
    <div class="scim-settings">
        <div class="ah-card scim-card">
            <div class="scim-head">
                <h3 class="ah-h3">{{ $t('Scim.title') }}</h3>
                <label class="scim-switch">
                    <input type="checkbox" class="ah-check" v-model="form.isEnabled" @change="saveConfig" />
                    <span>{{ form.isEnabled ? $t('Scim.enabled') : $t('Scim.disabled') }}</span>
                </label>
            </div>
            <p class="ah-small scim-sub">{{ $t('Scim.subtitle') }}</p>

            <div class="ah-field scim-row">
                <label class="ah-field__label" for="scim-role">{{ $t('Scim.default_role') }}</label>
                <select id="scim-role" v-model.number="form.defaultRoleType" class="ah-input scim-select" @change="saveConfig">
                    <option :value="2">{{ $t('Scim.role_admin') }}</option>
                    <option :value="3">{{ $t('Scim.role_member') }}</option>
                    <option :value="4">{{ $t('Scim.role_guest') }}</option>
                </select>
                <small class="ah-field__hint">{{ $t('Scim.default_role_hint') }}</small>
            </div>

            <div class="scim-urls">
                <div class="scim-url-title">{{ $t('Scim.connect_hint') }}</div>
                <div class="scim-url"><b>{{ $t('Scim.base_url') }}</b><code>{{ baseUrl || '—' }}</code></div>
                <div class="scim-url"><b>{{ $t('Scim.token_label') }}</b>
                    <code v-if="newToken">{{ newToken }}</code>
                    <span v-else-if="hasToken" class="ah-muted">•••• {{ tokenLast4 }} — {{ $t('Scim.token_hidden') }}</span>
                    <span v-else class="ah-muted">{{ $t('Scim.no_token') }}</span>
                </div>
                <div v-if="newToken" class="scim-token-warn">
                    ⚠ {{ $t('Scim.token_once') }}
                    <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="copyToken">{{ copied ? $t('Scim.copied') : $t('Scim.copy') }}</button>
                </div>
            </div>

            <div class="scim-actions">
                <button type="button" class="ah-btn ah-btn--primary" :disabled="busy" @click="rotate">
                    {{ busy ? $t('Scim.working') : (hasToken ? $t('Scim.rotate') : $t('Scim.generate')) }}
                </button>
                <span v-if="msg" class="scim-msg" :class="`scim-msg--${msgType}`">{{ msg }}</span>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest } from '@/services';
import * as env from '@/config/env';

// SEC-05 — admin SCIM provisioning config. Owner/admin only (enforced
// server-side in Modules/Scim). Enable SCIM, choose the default role for
// provisioned users, and mint the bearer token (shown ONCE) to paste into the
// IdP alongside the SCIM base URL.
const { t } = useI18n();
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
        if (body && body.status) { msg.value = body.statusText || t('Scim.saved'); msgType.value = 'ok'; }
        else { msg.value = (body && body.statusText) || t('Scim.failed'); msgType.value = 'err'; }
    } catch (e) { msg.value = t('Scim.failed'); msgType.value = 'err'; }
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
        } else { msg.value = (body && body.statusText) || t('Scim.failed'); msgType.value = 'err'; }
    } catch (e) {
        msg.value = (e && e.response && e.response.data && e.response.data.statusText) || t('Scim.failed'); msgType.value = 'err';
    } finally { busy.value = false; }
};

const copyToken = async () => {
    try { await navigator.clipboard.writeText(newToken.value); copied.value = true; setTimeout(() => (copied.value = false), 1500); } catch (e) { /* clipboard blocked */ }
};

onMounted(load);
</script>

<style scoped>
.scim-settings { padding: var(--page-pad-y, 20px) var(--page-pad-x, 20px); }
.scim-card { padding: var(--card-pad-y, 20px) var(--card-pad-x, 20px); max-width: 720px; }
.scim-head { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-4); flex-wrap: wrap; }
.scim-sub { margin: var(--sp-2) 0 18px; }
.scim-row { margin-bottom: var(--sp-6); }
.ah-input.scim-select { max-width: 280px; }
.scim-switch { display: inline-flex; align-items: center; gap: var(--sp-3); cursor: pointer; font-size: var(--fs-md, 13px); color: var(--ink); margin: 0; }
.scim-urls { background: var(--surface-2); border: 1px solid var(--hairline); border-radius: var(--r-input); padding: var(--sp-5) var(--sp-6); margin: var(--sp-3) 0 var(--sp-7); }
.scim-url-title { font-size: var(--fs-sm, 12px); font-weight: var(--fw-title, 700); color: var(--ink-2); margin-bottom: var(--sp-3); }
.scim-url { font-size: var(--fs-sm, 12px); color: var(--ink); margin-bottom: var(--sp-2); display: flex; flex-direction: column; gap: 2px; }
.scim-url code { background: var(--surface); color: var(--ink); border: 1px solid var(--hairline); border-radius: var(--r-chip); padding: var(--sp-1) var(--sp-3); font-family: var(--font-mono); word-break: break-all; }
.scim-token-warn { font-size: var(--fs-sm, 12px); color: var(--warn-ink); background: var(--warn-bg); border: 1px solid var(--warn); border-radius: var(--r-chip); padding: var(--sp-3) var(--sp-4); margin-top: var(--sp-3); display: flex; align-items: center; gap: var(--sp-4); flex-wrap: wrap; }
.scim-actions { display: flex; align-items: center; gap: var(--sp-5); flex-wrap: wrap; }
.scim-msg { font-size: var(--fs-md, 13px); }
.scim-msg--ok { color: var(--ok-ink); }
.scim-msg--err { color: var(--danger-ink); }
</style>
