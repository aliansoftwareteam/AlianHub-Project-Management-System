<template>
    <div class="sso-settings">
        <div class="sso-card">
            <div class="sso-head">
                <h3 class="m-0">{{ $t('Sso.title') }}</h3>
                <label class="sso-switch">
                    <input type="checkbox" v-model="form.isEnabled" />
                    <span>{{ form.isEnabled ? $t('Sso.enabled') : $t('Sso.disabled') }}</span>
                </label>
            </div>
            <p class="sso-sub">{{ $t('Sso.subtitle') }}</p>

            <div class="sso-row">
                <label>{{ $t('Sso.provider') }}</label>
                <select v-model="form.provider" class="form-control">
                    <option value="oidc">OIDC (OpenID Connect)</option>
                    <option value="saml">SAML 2.0</option>
                </select>
            </div>

            <template v-if="form.provider === 'oidc'">
                <div class="sso-row"><label>{{ $t('Sso.discovery_url') }}</label><input v-model="form.oidc.discoveryUrl" class="form-control" placeholder="https://idp/.well-known/openid-configuration" /></div>
                <div class="sso-row"><label>{{ $t('Sso.client_id') }}</label><input v-model="form.oidc.clientId" class="form-control" /></div>
                <div class="sso-row"><label>{{ $t('Sso.client_secret') }}</label><input v-model="form.oidc.clientSecret" type="password" class="form-control" /></div>
                <div class="sso-row"><label>{{ $t('Sso.scopes') }}</label><input v-model="form.oidc.scopes" class="form-control" placeholder="openid email profile" /></div>
            </template>
            <template v-else>
                <div class="sso-row"><label>{{ $t('Sso.entry_point') }}</label><input v-model="form.saml.entryPoint" class="form-control" placeholder="https://idp/sso/saml" /></div>
                <div class="sso-row"><label>{{ $t('Sso.entity_id') }}</label><input v-model="form.saml.entityId" class="form-control" /></div>
                <div class="sso-row"><label>{{ $t('Sso.idp_cert') }}</label><textarea v-model="form.saml.idpCert" rows="4" class="form-control" placeholder="-----BEGIN CERTIFICATE-----"></textarea></div>
            </template>

            <div class="sso-row">
                <label class="sso-switch"><input type="checkbox" v-model="form.autoProvisionUsers" /><span>{{ $t('Sso.auto_provision') }}</span></label>
            </div>

            <div class="sso-urls">
                <div class="sso-url-title">{{ $t('Sso.urls_hint') }}</div>
                <div class="sso-url"><b>{{ $t('Sso.login_url') }}</b><code>{{ loginUrl }}</code></div>
                <div class="sso-url" v-if="form.provider === 'oidc'"><b>{{ $t('Sso.redirect_uri') }}</b><code>{{ origin }}/api/v2/sso/oidc/callback</code></div>
                <div class="sso-url" v-if="form.provider === 'saml'"><b>ACS URL</b><code>{{ origin }}/api/v2/sso/saml/acs?companyId={{ cid }}</code></div>
                <div class="sso-url" v-if="form.provider === 'saml'"><b>{{ $t('Sso.metadata') }}</b><code>{{ origin }}/api/v2/sso/saml/metadata?companyId={{ cid }}</code></div>
            </div>

            <div class="sso-actions">
                <button class="btn-primary" :disabled="busy" @click="save">{{ busy ? $t('Sso.saving') : $t('Projects.save') }}</button>
                <span v-if="msg" class="sso-msg" :class="msgType">{{ msg }}</span>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, inject } from 'vue';
import { apiRequest } from '@/services';
import * as env from '@/config/env';

// SEC-02 — admin SSO configuration ("configure the IdP without code"). Owner/
// admin only (enforced server-side in Modules/SSO/config.js). Shows the login /
// callback / ACS / metadata URLs to hand to the IdP + distribute to users.
const companyIdRef = inject('$companyId');
const origin = window.location.origin;
const cid = computed(() => (companyIdRef && companyIdRef.value) || companyIdRef || '');

const busy = ref(false);
const msg = ref('');
const msgType = ref('');
const form = reactive({ provider: 'oidc', isEnabled: false, autoProvisionUsers: true, defaultRoleType: 3, oidc: {}, saml: {} });

const loginUrl = computed(() => `${origin}/api/v2/sso/${form.provider}/initiate?companyId=${cid.value}`);

const load = async () => {
    try {
        const body = (await apiRequest('get', env.SSO_CONFIG))?.data;
        if (body && body.status && body.data) {
            const d = body.data;
            form.provider = d.provider || 'oidc';
            form.isEnabled = !!d.isEnabled;
            form.autoProvisionUsers = d.autoProvisionUsers !== false;
            form.defaultRoleType = d.defaultRoleType || 3;
            form.oidc = d.oidc || {};
            form.saml = d.saml || {};
        }
    } catch (e) { /* no config yet */ }
};

const save = async () => {
    if (busy.value) return;
    busy.value = true; msg.value = '';
    try {
        const body = (await apiRequest('put', env.SSO_CONFIG, {
            provider: form.provider,
            isEnabled: form.isEnabled,
            autoProvisionUsers: form.autoProvisionUsers,
            defaultRoleType: form.defaultRoleType,
            oidc: form.oidc,
            saml: form.saml,
        }))?.data;
        if (body && body.status) { msg.value = body.statusText || 'Saved'; msgType.value = 'ok'; }
        else { msg.value = (body && body.statusText) || 'Failed'; msgType.value = 'err'; }
    } catch (e) {
        msg.value = (e && e.response && e.response.data && e.response.data.statusText) || 'Failed';
        msgType.value = 'err';
    } finally {
        busy.value = false;
    }
};

onMounted(load);
</script>

<style scoped>
.sso-settings { padding: 20px; }
.sso-card { background: #fff; border: 1px solid #e6e7ee; border-radius: 10px; padding: 20px; max-width: 720px; }
.sso-head { display: flex; align-items: center; justify-content: space-between; }
.sso-sub { color: #6b7280; font-size: 13px; margin: 6px 0 18px; }
.sso-row { margin-bottom: 14px; display: flex; flex-direction: column; gap: 5px; }
.sso-row > label { font-size: 13px; font-weight: 600; color: #3a3f52; }
.sso-switch { flex-direction: row !important; align-items: center; gap: 8px; cursor: pointer; font-size: 13px; }
.sso-urls { background: #f7f8fc; border-radius: 8px; padding: 12px 14px; margin: 8px 0 16px; }
.sso-url-title { font-size: 12px; font-weight: 700; color: #3a3f52; margin-bottom: 8px; }
.sso-url { font-size: 12px; margin-bottom: 6px; display: flex; flex-direction: column; gap: 2px; }
.sso-url code { background: #fff; border: 1px solid #e6e7ee; border-radius: 5px; padding: 4px 8px; word-break: break-all; }
.sso-actions { display: flex; align-items: center; gap: 12px; }
.sso-msg.ok { color: #1c7a43; font-size: 13px; }
.sso-msg.err { color: #c0392b; font-size: 13px; }
</style>
