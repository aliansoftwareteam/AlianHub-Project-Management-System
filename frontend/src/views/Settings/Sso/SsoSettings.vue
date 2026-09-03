<template>
    <div class="sso">
        <div class="sso__main">
            <div>
                <h1 class="ah-h1">{{ $t('SettingsV2.sso_title') }}</h1>
                <div class="ah-small">{{ $t('SettingsV2.sso_subtitle', { host }) }}</div>
            </div>

            <section class="ah-card sso__providers">
                <div class="sso__provider">
                    <AhSwitch :modelValue="true" disabled :label="$t('SettingsV2.sso_email_password')" />
                    <ShellIcon name="mail" :size="16" class="sso__provider-icon" />
                    <span class="sso__provider-name">{{ $t('SettingsV2.sso_email_password') }}</span>
                    <span class="ah-small">{{ $t('SettingsV2.sso_email_hint') }}</span>
                </div>
                <div v-for="p in oauthProviders" :key="p.key" class="sso__provider" :class="{ 'is-off': !p.on }">
                    <AhSwitch :modelValue="p.on" disabled :label="p.name" />
                    <ShellIcon :name="p.icon" :size="16" class="sso__provider-icon" />
                    <span class="sso__provider-name">{{ p.name }}</span>
                    <span class="ah-small sso__provider-status">
                        <template v-if="p.on">{{ $t('SettingsV2.sso_env_on') }} · <code class="ah-mono">{{ p.env }}</code></template>
                        <template v-else>{{ $t('SettingsV2.sso_hidden_from_login') }} · <code class="ah-mono">{{ p.env }}</code></template>
                    </span>
                </div>
                <div class="sso__env-hint ah-small">{{ $t('SettingsV2.sso_env_hint') }}</div>
            </section>

            <section class="ah-card">
                <div class="ah-card__body sso__idp">
                    <div class="sso__idp-head">
                        <AhSwitch v-model="form.isEnabled" :label="$t('SettingsV2.sso_enable')" />
                        <span class="sso__provider-name">{{ $t('SettingsV2.sso_card_title') }}</span>
                        <span v-if="savedConfig && savedConfig.isEnabled" class="ah-chip ah-chip--ok ah-chip--mono">{{ (savedConfig.displayName || savedConfig.provider || '').toUpperCase() }} · {{ $t('SettingsV2.sso_connected') }}</span>
                        <span v-else class="ah-chip ah-chip--mono">{{ $t('SettingsV2.sso_not_configured') }}</span>
                        <button type="button" class="sso__link" :disabled="!savedConfig" @click="testSignIn()">{{ $t('SettingsV2.sso_test') }}</button>
                    </div>

                    <div class="sso__form-grid">
                        <div class="ah-field">
                            <label class="ah-field__label" for="sso-provider">{{ $t('Sso.provider') }}</label>
                            <select id="sso-provider" class="ah-input" v-model="form.provider">
                                <option value="oidc">OIDC (OpenID Connect)</option>
                                <option value="saml">SAML 2.0</option>
                            </select>
                        </div>
                        <div class="ah-field">
                            <label class="ah-field__label" for="sso-name">{{ $t('SettingsV2.sso_display_name') }}</label>
                            <input id="sso-name" class="ah-input" v-model.trim="form.displayName" maxlength="80" :placeholder="$t('SettingsV2.sso_display_name_ph')" />
                        </div>

                        <template v-if="form.provider === 'oidc'">
                            <div class="ah-field sso__span">
                                <label class="ah-field__label" for="sso-disc">{{ $t('Sso.discovery_url') }}</label>
                                <input id="sso-disc" class="ah-input ah-mono" :class="{ 'ah-input--error': errors.discoveryUrl }" v-model.trim="form.oidc.discoveryUrl" placeholder="https://idp/.well-known/openid-configuration" @input="errors.discoveryUrl = ''" />
                                <div v-if="errors.discoveryUrl" class="ah-field__error">{{ errors.discoveryUrl }}</div>
                            </div>
                            <div class="ah-field">
                                <label class="ah-field__label" for="sso-cid">{{ $t('Sso.client_id') }}</label>
                                <input id="sso-cid" class="ah-input ah-mono" :class="{ 'ah-input--error': errors.clientId }" v-model.trim="form.oidc.clientId" @input="errors.clientId = ''" />
                                <div v-if="errors.clientId" class="ah-field__error">{{ errors.clientId }}</div>
                            </div>
                            <div class="ah-field">
                                <label class="ah-field__label" for="sso-secret">{{ $t('Sso.client_secret') }}</label>
                                <input id="sso-secret" class="ah-input ah-mono" :class="{ 'ah-input--error': errors.clientSecret }" type="password" autocomplete="new-password" v-model.trim="form.oidc.clientSecret" @input="errors.clientSecret = ''" />
                                <div v-if="errors.clientSecret" class="ah-field__error">{{ errors.clientSecret }}</div>
                            </div>
                            <div class="ah-field sso__span">
                                <label class="ah-field__label" for="sso-scopes">{{ $t('Sso.scopes') }}</label>
                                <input id="sso-scopes" class="ah-input ah-mono" v-model.trim="form.oidc.scopes" placeholder="openid email profile" />
                            </div>
                        </template>
                        <template v-else>
                            <div class="ah-field sso__span">
                                <label class="ah-field__label" for="sso-entry">{{ $t('Sso.entry_point') }}</label>
                                <input id="sso-entry" class="ah-input ah-mono" :class="{ 'ah-input--error': errors.entryPoint }" v-model.trim="form.saml.entryPoint" placeholder="https://idp/sso/saml" @input="errors.entryPoint = ''" />
                                <div v-if="errors.entryPoint" class="ah-field__error">{{ errors.entryPoint }}</div>
                            </div>
                            <div class="ah-field sso__span">
                                <label class="ah-field__label" for="sso-idp-entity">{{ $t('Sso.entity_id') }}</label>
                                <input id="sso-idp-entity" class="ah-input ah-mono" v-model.trim="form.saml.entityId" />
                            </div>
                            <div class="ah-field sso__span">
                                <label class="ah-field__label" for="sso-cert">{{ $t('Sso.idp_cert') }}</label>
                                <textarea id="sso-cert" class="ah-input ah-textarea ah-mono" :class="{ 'ah-input--error': errors.idpCert }" rows="4" v-model.trim="form.saml.idpCert" placeholder="-----BEGIN CERTIFICATE-----" @input="errors.idpCert = ''"></textarea>
                                <div v-if="errors.idpCert" class="ah-field__error">{{ errors.idpCert }}</div>
                            </div>
                        </template>

                        <div class="sso__values sso__span">
                            <div v-for="v in copyValues" :key="v.label" class="sso__value">
                                <span class="sso__value-label">{{ v.label }}</span>
                                <span class="sso__value-text">{{ v.value }}</span>
                                <button type="button" class="sso__link" @click="copy(v.value)">{{ $t('SettingsV2.copy') }}</button>
                            </div>
                            <div class="sso__value">
                                <span class="sso__value-label">{{ $t('SettingsV2.sso_attributes') }}</span>
                                <span class="sso__value-text">email · firstName · lastName</span>
                            </div>
                        </div>

                        <div class="ah-field sso__span">
                            <label class="ah-field__label" for="sso-domain">{{ $t('SettingsV2.sso_domains') }}<span class="ah-small">{{ $t('SettingsV2.sso_domains_hint') }}</span></label>
                            <div class="sso__chips">
                                <span v-for="d in form.domains" :key="d" class="ah-chip ah-chip--brand">
                                    {{ d }}
                                    <button type="button" class="sso__chip-x" :aria-label="$t('SettingsV2.sso_remove', { d })" @click="removeDomain(d)">×</button>
                                </span>
                                <input id="sso-domain" class="sso__chip-input" v-model.trim="domainDraft" :placeholder="$t('SettingsV2.sso_domain_ph')" @keydown.enter.prevent="addDomain()" @input="onDomainInput" @blur="addDomain()" />
                            </div>
                            <div v-if="errors.domains" class="ah-field__error">{{ errors.domains }}</div>
                        </div>
                    </div>
                </div>
            </section>
        </div>

        <aside class="sso__side">
            <section class="ah-card">
                <div class="ah-card__body sso__enf">
                    <h2 class="ah-h3">{{ $t('SettingsV2.sso_enforcement') }}</h2>
                    <label v-for="opt in enforcementOptions" :key="opt.value" class="sso__radio" :class="{ 'is-active': form.enforcement === opt.value }">
                        <input type="radio" name="sso-enforcement" :value="opt.value" v-model="form.enforcement" />
                        <span>
                            <span class="sso__radio-title">{{ $t(opt.label) }}</span>
                            <span class="ah-small sso__radio-hint">{{ $t(opt.hint) }}</span>
                        </span>
                    </label>
                    <div v-if="form.enforcement !== 'optional'" class="sso__warn">{{ $t('SettingsV2.sso_enf_warn') }}</div>
                </div>
            </section>

            <section class="ah-card">
                <div class="ah-card__body sso__prov">
                    <h2 class="ah-h3">{{ $t('SettingsV2.sso_provisioning') }}</h2>
                    <label class="sso__prov-row">
                        <span>{{ $t('Sso.auto_provision') }}</span>
                        <AhSwitch v-model="form.autoProvisionUsers" :label="$t('Sso.auto_provision')" />
                    </label>
                    <div class="sso__prov-row">
                        <label for="sso-role">{{ $t('SettingsV2.sso_default_role') }}</label>
                        <select id="sso-role" class="ah-input sso__role" v-model.number="form.defaultRoleType" :disabled="!form.autoProvisionUsers">
                            <option v-for="r in assignableRoles" :key="r.key" :value="r.key">{{ r.name }}</option>
                        </select>
                    </div>
                </div>
            </section>

            <div class="sso__actions">
                <button type="button" class="ah-btn ah-btn--primary sso__save" :disabled="busy" @click="save()">{{ busy ? $t('Sso.saving') : $t('Projects.save') }}</button>
                <a class="ah-btn ah-btn--secondary" :href="loginPreviewUrl" target="_blank" rel="noopener">{{ $t('SettingsV2.sso_preview_login') }}</a>
            </div>
            <div v-if="saveError" class="ah-field__error">{{ saveError }}</div>
            <div v-else-if="saveOk" class="ah-small sso__ok"><ShellIcon name="check" :size="14" />{{ $t('SettingsV2.sso_saved') }}</div>
        </aside>
    </div>
</template>

<script setup>
import { computed, inject, onMounted, reactive, ref } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import * as env from "@/config/env";
import { apiRequest } from "@/services";
import AhSwitch from "@/components/molecules/Setting/AhSwitch.vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";

defineOptions({ name: "SsoSettingsView" });

const { t } = useI18n();
const $toast = useToast();
const { getters } = useStore();
const companyIdRef = inject("$companyId");
const cid = computed(() => (companyIdRef && companyIdRef.value) || "");
const origin = window.location.origin;
const host = window.location.host;

const DOMAIN_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/i;

const busy = ref(false);
const saveError = ref("");
const saveOk = ref(false);
const savedConfig = ref(null);
const domainDraft = ref("");
const errors = reactive({ discoveryUrl: "", clientId: "", clientSecret: "", entryPoint: "", idpCert: "", domains: "" });
const form = reactive({
    provider: "oidc", isEnabled: false, autoProvisionUsers: true, defaultRoleType: 3,
    displayName: "", domains: [], enforcement: "optional", oidc: {}, saml: {}
});

const oauthProviders = computed(() => [
    { key: "google", name: "Google", icon: "google", env: "GOOGLE_CLIENT_ID", on: !!process.env.VUE_APP_GOOGLE_CLIENT_ID },
    { key: "github", name: "GitHub", icon: "github", env: "GITHUB_CLIENT_ID", on: !!process.env.VUE_APP_GITHUB_CLIENT_ID },
    { key: "gitlab", name: "GitLab", icon: "gitlab", env: "GITLAB_CLIENT_ID", on: !!process.env.VUE_APP_GITLAB_CLIENT_ID }
]);

const enforcementOptions = [
    { value: "optional", label: "SettingsV2.sso_enf_optional", hint: "SettingsV2.sso_enf_optional_hint" },
    { value: "required_except_guests", label: "SettingsV2.sso_enf_required_except", hint: "SettingsV2.sso_enf_required_except_hint" },
    { value: "required", label: "SettingsV2.sso_enf_required", hint: "SettingsV2.sso_enf_required_hint" }
];

const assignableRoles = computed(() => (getters["settings/roles"] || []).filter((r) => r.key !== 1 && !r.isDelete));

const copyValues = computed(() => {
    if (form.provider === "oidc") {
        return [{ label: t("SettingsV2.sso_callback_url"), value: `${origin}/api/v2/sso/oidc/callback` }];
    }
    return [
        { label: t("SettingsV2.sso_acs_url"), value: `${origin}/api/v2/sso/saml/acs?companyId=${cid.value}` },
        { label: t("SettingsV2.sso_metadata_url"), value: `${origin}/api/v2/sso/saml/metadata?companyId=${cid.value}` },
        { label: t("SettingsV2.sso_entity_id"), value: `${origin}/api/v2/sso/saml/metadata?companyId=${cid.value}` }
    ];
});

const initiateUrl = computed(() => `${origin}/api/v2/sso/${(savedConfig.value && savedConfig.value.provider) || form.provider}/initiate?companyId=${cid.value}`);
const loginPreviewUrl = computed(() => `${origin}/#/login`);

function addDomain() {
    const d = domainDraft.value.replace(/,+$/, "").trim().toLowerCase();
    if (!d) return;
    if (!DOMAIN_RE.test(d)) { errors.domains = t("SettingsV2.sso_domain_invalid", { d }); return; }
    errors.domains = "";
    if (!form.domains.includes(d)) form.domains.push(d);
    domainDraft.value = "";
}
const removeDomain = (d) => { form.domains = form.domains.filter((x) => x !== d); };
const onDomainInput = () => { if (domainDraft.value.includes(",")) addDomain(); };

function validate() {
    Object.keys(errors).forEach((k) => { errors[k] = ""; });
    const req = t("SettingsV2.required_field");
    if (form.provider === "oidc") {
        if (!form.oidc.discoveryUrl && !form.oidc.issuer) errors.discoveryUrl = req;
        if (!form.oidc.clientId) errors.clientId = req;
        if (!form.oidc.clientSecret) errors.clientSecret = req;
    } else {
        if (!form.saml.entryPoint) errors.entryPoint = req;
        if (!form.saml.idpCert) errors.idpCert = req;
    }
    return !Object.values(errors).some(Boolean);
}

async function load() {
    try {
        const body = (await apiRequest("get", env.SSO_CONFIG))?.data;
        if (body?.status && body.data) {
            const d = body.data;
            savedConfig.value = d;
            form.provider = d.provider || "oidc";
            form.isEnabled = !!d.isEnabled;
            form.autoProvisionUsers = d.autoProvisionUsers !== false;
            form.defaultRoleType = d.defaultRoleType || 3;
            form.displayName = d.displayName || "";
            form.domains = Array.isArray(d.domains) ? [...d.domains] : [];
            form.enforcement = d.enforcement || "optional";
            form.oidc = { ...(d.oidc || {}) };
            form.saml = { ...(d.saml || {}) };
        }
    } catch (error) {
        savedConfig.value = null;
    }
}

async function save() {
    if (busy.value) return;
    addDomain();
    if (!validate()) return;
    busy.value = true;
    saveError.value = "";
    saveOk.value = false;
    try {
        const body = (await apiRequest("put", env.SSO_CONFIG, {
            provider: form.provider,
            isEnabled: form.isEnabled,
            autoProvisionUsers: form.autoProvisionUsers,
            defaultRoleType: form.defaultRoleType,
            displayName: form.displayName,
            domains: form.domains,
            enforcement: form.enforcement,
            oidc: form.oidc,
            saml: form.saml
        }))?.data;
        if (body?.status) { savedConfig.value = body.data || savedConfig.value; saveOk.value = true; }
        else saveError.value = body?.statusText || t("Toast.something_went_wrong");
    } catch (error) {
        saveError.value = error?.response?.data?.statusText || error?.response?.data?.message || t("Toast.something_went_wrong");
    } finally {
        busy.value = false;
    }
}

function testSignIn() {
    window.open(initiateUrl.value, "_blank", "noopener");
}

async function copy(text) {
    try {
        await navigator.clipboard.writeText(text);
        $toast.success(t("SettingsV2.copied"), { position: "top-right" });
    } catch (error) {
        $toast.error(t("Toast.something_went_wrong"), { position: "top-right" });
    }
}

onMounted(load);
</script>

<style scoped>
.sso { display: grid; grid-template-columns: minmax(0, 1fr) 330px; gap: 16px; align-items: start; }
.sso__main, .sso__side { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.sso__providers { overflow: hidden; }
.sso__provider { display: flex; align-items: center; gap: 10px; padding: 11px 14px; border-bottom: 1px solid var(--hairline); font: var(--text-body); }
.sso__provider.is-off { color: var(--ink-2); }
.sso__provider-icon { flex: none; }
.sso__provider-name { font-weight: 600; color: var(--ink); }
.sso__provider.is-off .sso__provider-name { color: var(--ink-label); }
.sso__provider-status { margin-left: auto; text-align: right; }
.sso__provider > .ah-small:last-child { margin-left: auto; }
.sso__env-hint { padding: 9px 14px; background: var(--surface-2); }
.sso__idp { display: flex; flex-direction: column; gap: 12px; }
.sso__idp-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.sso__idp-head .sso__link { margin-left: auto; }
.sso__link { border: 0; background: transparent; color: var(--brand); font: 600 12px/1 var(--font-ui); cursor: pointer; padding: 4px 2px; }
.sso__link:disabled { color: var(--ink-3); cursor: not-allowed; }
.sso__link:focus-visible { outline: none; box-shadow: var(--focus); border-radius: 4px; }
.sso__form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.sso__span { grid-column: 1 / -1; }
.sso__values { padding: 10px 12px; background: var(--surface-2); border-radius: 8px; display: flex; flex-direction: column; gap: 5px; font: 400 11.5px/1.4 var(--font-mono); color: var(--ink-label); }
.sso__value { display: flex; align-items: center; gap: 8px; min-width: 0; }
.sso__value-label { width: 110px; flex: none; color: var(--ink-3); }
.sso__value-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink); }
.sso__chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; min-height: 38px; padding: 5px 8px; border: 1.5px solid var(--border); border-radius: var(--r-input); background: var(--surface); }
.sso__chips:focus-within { border-color: var(--brand); box-shadow: var(--focus); }
.sso__chip-x { border: 0; background: transparent; color: inherit; font-size: 13px; line-height: 1; cursor: pointer; padding: 0 2px; }
.sso__chip-input { flex: 1; min-width: 140px; border: 0; background: transparent; color: var(--ink); font: 400 13px/1 var(--font-ui); height: 26px; }
.sso__chip-input:focus { outline: none; }
.sso__chip-input::placeholder { color: var(--ink-3); }
.sso__enf { display: flex; flex-direction: column; gap: 8px; }
.sso__radio { display: flex; align-items: flex-start; gap: 8px; padding: 6px 8px; border-radius: 8px; cursor: pointer; color: var(--ink-label); font: var(--text-small); }
.sso__radio input { margin: 3px 0 0; accent-color: var(--brand); flex: none; }
.sso__radio.is-active { color: var(--ink); background: var(--brand-tint); }
.sso__radio-title { display: block; font-weight: 600; }
.sso__radio-hint { display: block; line-height: 1.45; }
.sso__warn { padding: 9px 11px; background: var(--warn-bg); border-radius: 8px; font: var(--text-small); line-height: 1.45; color: var(--warn-ink); }
.sso__prov { display: flex; flex-direction: column; gap: 10px; }
.sso__prov-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; font: var(--text-small); color: var(--ink-label); }
.sso__role { width: 150px; height: 32px; }
.sso__actions { display: flex; gap: 8px; }
.sso__save { flex: 1; }
.sso__actions a { text-decoration: none; }
.sso__ok { display: inline-flex; align-items: center; gap: 6px; color: var(--ok-ink); }
@media (max-width: 1279px) { .sso { grid-template-columns: 1fr; } }
@media (max-width: 767px) { .sso__form-grid { grid-template-columns: 1fr; } .sso__provider-status { text-align: left; margin-left: 0; width: 100%; } }
</style>
