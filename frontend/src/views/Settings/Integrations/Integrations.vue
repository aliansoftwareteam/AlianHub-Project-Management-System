<template>
    <div class="position-re mySettingsWrapper p-1">
        <SpinnerComp :is-spinner="isSpinner" />
        <div class="my-settings-main">
            <div class="row">
                <div class="col-md-2 settingprofile">
                    <div class="col-md-10 settingprofileform setting_profile_mobile_responsive">
                        <div class="profileform">
                            <div class="intg-head">
                                <h3 class="intg-title">{{ $t('Integrations.title') }}</h3>
                                <p class="intg-desc">{{ $t('Integrations.desc') }}</p>
                            </div>

                            <!-- One-time secret (shown only right after create) -->
                            <div v-if="newSecret" class="intg-secret">
                                <p class="intg-secret-title">{{ $t('Integrations.secret_title') }}</p>
                                <p class="intg-secret-desc">{{ $t('Integrations.secret_desc') }}</p>
                                <div class="intg-secret-row">
                                    <code class="intg-secret-code">{{ newSecret }}</code>
                                    <button type="button" class="btn_btn intg-ghost-btn" @click="copySecret">{{ $t('Integrations.copy') }}</button>
                                    <button type="button" class="btn_btn intg-ghost-btn" @click="newSecret = ''">{{ $t('Integrations.done') }}</button>
                                </div>
                            </div>

                            <!-- Add / edit webhook -->
                            <form class="intg-form" @submit.prevent="submitForm">
                                <h4 class="intg-section-title">{{ editingId ? $t('Integrations.edit_webhook') : $t('Integrations.add_webhook') }}</h4>

                                <div class="inputfield">
                                    <label>{{ $t('Integrations.destination') }}</label>
                                    <div class="intg-format-tabs">
                                        <button type="button" v-for="opt in formatOptions" :key="opt.value"
                                            class="intg-format-tab" :class="{ 'is-active': form.format === opt.value }"
                                            @click="form.format = opt.value">{{ opt.label }}</button>
                                    </div>
                                </div>

                                <div class="inputfield position-re">
                                    <label>{{ $t('Integrations.name') }} *</label>
                                    <input type="text" class="logininput" v-model.trim="form.name" :placeholder="$t('Integrations.name_ph')" maxlength="80" />
                                    <div class="invalid-feedback red pt-5px">{{ formError.name }}</div>
                                </div>

                                <div class="inputfield position-re">
                                    <label>{{ urlLabel }} *</label>
                                    <input type="text" class="logininput" v-model.trim="form.url" :placeholder="urlPlaceholder" />
                                    <div class="intg-hint" v-if="form.format === 'slack'">{{ $t('Integrations.slack_hint') }}</div>
                                    <div class="intg-hint" v-else-if="form.format === 'discord'">{{ $t('Integrations.discord_hint') }}</div>
                                    <div class="invalid-feedback red pt-5px">{{ formError.url }}</div>
                                </div>

                                <div class="inputfield position-re">
                                    <label>{{ $t('Integrations.events') }} *</label>
                                    <label class="intg-check">
                                        <input type="checkbox" :checked="allEvents" @change="toggleAllEvents($event)" />
                                        <span>{{ $t('Integrations.all_events') }}</span>
                                    </label>
                                    <div class="intg-events" v-if="!allEvents">
                                        <label class="intg-check" v-for="ev in eventCatalogue" :key="ev">
                                            <input type="checkbox" :value="ev" v-model="form.events" />
                                            <span>{{ eventLabel(ev) }}</span>
                                        </label>
                                    </div>
                                    <div class="invalid-feedback red pt-5px">{{ formError.events }}</div>
                                </div>

                                <div class="mysetiing_save d-flex" style="gap:10px; flex-wrap:wrap;">
                                    <button type="submit" class="btn_btn mysetting_save_btn" :disabled="isSpinner">
                                        {{ editingId ? $t('Integrations.save') : (form.format === 'slack' ? $t('Integrations.send_to_slack') : $t('Integrations.create')) }}
                                    </button>
                                    <button v-if="editingId" type="button" class="btn_btn intg-ghost-btn" @click="resetForm">{{ $t('Integrations.cancel') }}</button>
                                </div>
                            </form>

                            <!-- Existing webhooks -->
                            <div class="intg-list-wrap">
                                <h4 class="intg-section-title">
                                    {{ $t('Integrations.your_webhooks') }}
                                    <span class="intg-count" v-if="webhooks.length">{{ webhooks.length }}</span>
                                </h4>
                                <p v-if="!webhooks.length" class="intg-empty">{{ $t('Integrations.empty') }}</p>

                                <div v-for="hook in webhooks" :key="hook._id" class="intg-row">
                                    <div class="intg-row-top">
                                        <div class="intg-row-main">
                                            <span class="intg-badge" :class="'is-' + (hook.format || 'json')">{{ (hook.format || 'json').toUpperCase() }}</span>
                                            <div class="intg-row-text">
                                                <div class="intg-row-name">{{ hook.name }}</div>
                                                <div class="intg-row-url" :title="hook.url">{{ shortUrl(hook.url) }}</div>
                                                <div class="intg-row-meta">{{ eventsSummary(hook.events) }} · {{ lastDeliveryLabel(hook) }}</div>
                                            </div>
                                        </div>
                                        <div class="intg-row-actions">
                                            <label class="intg-switch" :title="hook.active ? $t('Integrations.active') : $t('Integrations.paused')">
                                                <input type="checkbox" :checked="hook.active" @change="toggleActive(hook)" />
                                                <span class="intg-slider"></span>
                                            </label>
                                            <button type="button" class="intg-link" @click="viewLogs(hook)">{{ $t('Integrations.logs') }}</button>
                                            <button type="button" class="intg-link" @click="editWebhook(hook)">{{ $t('Integrations.edit') }}</button>
                                            <button type="button" class="intg-link intg-danger" @click="removeWebhook(hook)">{{ $t('Integrations.delete') }}</button>
                                        </div>
                                    </div>

                                    <div v-if="logsFor === hook._id" class="intg-logs">
                                        <p v-if="!logs.length" class="intg-empty">{{ $t('Integrations.no_logs') }}</p>
                                        <table v-else class="intg-logs-table">
                                            <thead>
                                                <tr>
                                                    <th>{{ $t('Integrations.event') }}</th>
                                                    <th>{{ $t('Integrations.status') }}</th>
                                                    <th>{{ $t('Integrations.duration') }}</th>
                                                    <th>{{ $t('Integrations.when') }}</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                <tr v-for="(log, i) in logs" :key="i">
                                                    <td>{{ log.event }}</td>
                                                    <td :class="log.success ? 'intg-ok' : 'intg-fail'">
                                                        {{ log.success ? (log.statusCode || 'OK') : (log.statusCode || 'fail') }}<span v-if="log.attempt > 1"> ({{ $t('Integrations.retry') }})</span>
                                                    </td>
                                                    <td>{{ log.durationMs != null ? log.durationMs + 'ms' : '—' }}</td>
                                                    <td>{{ formatTime(log.createdAt) }}</td>
                                                </tr>
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>

                            <!-- ───────────────────────────────────────────────
                                 AHE-3838 — cloud storage for attachments.
                                 Workspace-level app registration per provider.
                                 Each person then connects their OWN account,
                                 because everyone has their own drive.
                            ──────────────────────────────────────────────── -->
                            <div class="intg-list-wrap intg-cloud">
                                <h4 class="intg-section-title">{{ $t('Integrations.cloud_title') }}</h4>
                                <p class="intg-desc">{{ $t('Integrations.cloud_desc') }}</p>

                                <div v-if="cloudRedirectUri" class="intg-cloud-redirect">
                                    <span class="intg-cloud-redirect-lbl">{{ $t('Integrations.cloud_redirect_uri') }}</span>
                                    <code class="intg-secret-code">{{ cloudRedirectUri }}</code>
                                    <button type="button" class="btn_btn intg-ghost-btn" @click="copyRedirectUri">{{ $t('Integrations.copy') }}</button>
                                    <div class="intg-hint">{{ $t('Integrations.cloud_redirect_hint') }}</div>
                                </div>

                                <div v-for="p in cloudProviders" :key="p.provider" class="intg-row intg-cloud-row">
                                    <div class="intg-row-top">
                                        <div class="intg-row-main">
                                            <span class="intg-cloud-ic">{{ p.icon }}</span>
                                            <div class="intg-row-text">
                                                <div class="intg-row-name">
                                                    {{ p.name }}
                                                    <span v-if="p.configured" class="intg-cloud-pill on">{{ $t('Integrations.cloud_ready') }}</span>
                                                    <span v-else class="intg-cloud-pill">{{ $t('Integrations.cloud_not_setup') }}</span>
                                                </div>
                                                <div class="intg-row-meta">
                                                    <template v-if="p.configured && p.oauth">
                                                        <span v-if="p.connected">{{ $t('Integrations.cloud_your_account') }}: {{ p.accountEmail || $t('Integrations.cloud_connected') }}</span>
                                                        <span v-else-if="p.connectionStatus === 'reauth_required'">{{ $t('Integrations.cloud_reauth') }}</span>
                                                        <span v-else>{{ $t('Integrations.cloud_not_connected') }}</span>
                                                    </template>
                                                    <span v-else-if="p.configured">{{ $t('Integrations.cloud_no_signin_needed') }}</span>
                                                    <span v-else>{{ p.setupHint }}</span>
                                                </div>
                                                <button
                                                    v-if="p.requirements && p.requirements.length"
                                                    type="button" class="intg-link intg-cloud-stepstoggle"
                                                    @click="toggleCloudSteps(p)"
                                                >{{ isCloudStepsOpen(p) ? $t('Integrations.cloud_hide_steps') : $t('Integrations.cloud_show_steps', { count: p.requirements.length }) }}</button>
                                            </div>
                                        </div>
                                        <div class="intg-row-actions">
                                            <!-- Per-user connect: available to everyone once an admin
                                                 has entered the workspace credentials. -->
                                            <button
                                                v-if="p.configured && p.oauth && !p.connected"
                                                type="button" class="intg-link" @click="connectCloud(p)"
                                            >{{ $t('Integrations.cloud_connect') }}</button>
                                            <button
                                                v-if="p.configured && p.oauth && p.connected"
                                                type="button" class="intg-link intg-danger" @click="disconnectCloud(p)"
                                            >{{ $t('Integrations.cloud_disconnect') }}</button>
                                            <button
                                                type="button" class="intg-link" @click="toggleCloudForm(p)"
                                            >{{ cloudEditing === p.provider ? $t('Integrations.cancel') : (p.configured ? $t('Integrations.edit') : $t('Integrations.cloud_setup')) }}</button>
                                            <button
                                                v-if="p.configured"
                                                type="button" class="intg-link intg-danger" @click="removeCloud(p)"
                                            >{{ $t('Integrations.delete') }}</button>
                                        </div>
                                    </div>

                                    <!-- Per-provider setup checklist. Each line is
                                         something whose omission silently breaks a
                                         specific capability. -->
                                    <ol v-if="isCloudStepsOpen(p) && p.requirements && p.requirements.length" class="intg-cloud-reqs">
                                        <li v-for="(req, i) in p.requirements" :key="i" v-html="formatRequirement(req)"></li>
                                        <li v-if="p.needsRedirectUri" class="intg-cloud-reqs__uri">
                                            {{ $t('Integrations.cloud_redirect_uri') }}:
                                            <code>{{ cloudRedirectUri }}</code>
                                            <button type="button" class="intg-link" @click="copyRedirectUri">{{ $t('Integrations.copy') }}</button>
                                        </li>
                                    </ol>

                                    <div v-if="cloudEditing === p.provider" class="intg-cloud-form">
                                        <div v-for="f in p.fields" :key="f.key" class="inputfield position-re">
                                            <label>{{ f.label }}</label>
                                            <input
                                                class="logininput"
                                                :type="f.secret ? 'password' : 'text'"
                                                autocomplete="off"
                                                v-model.trim="cloudForm[f.key]"
                                                :placeholder="f.secret && p.secrets && p.secrets[f.key] ? $t('Integrations.cloud_secret_set') : ''"
                                            />
                                        </div>
                                        <div class="mysetiing_save d-flex" style="gap:10px; flex-wrap:wrap;">
                                            <button type="button" class="btn_btn mysetting_save_btn" :disabled="isSpinner" @click="saveCloud(p)">{{ $t('Integrations.save') }}</button>
                                            <button type="button" class="btn_btn intg-ghost-btn" @click="cloudEditing = ''">{{ $t('Integrations.cancel') }}</button>
                                        </div>
                                    </div>
                                </div>

                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script>
// Named (multi-word) to satisfy vue/multi-word-component-names; the route and
// file stay "Integrations".
export default { name: 'IntegrationsSettings' };
</script>

<script setup>
import * as env from '@/config/env';
import { useToast } from 'vue-toast-notification';
import { ref, computed, inject, onMounted } from 'vue';
import SpinnerComp from '@/components/atom/SpinnerComp/SpinnerComp.vue';
import { apiRequest } from '../../../services';
import { useI18n } from 'vue-i18n';
import {
    fetchCloudSettings,
    saveCloudSettings,
    clearCloudSettings,
    connectCloudProvider,
    disconnectCloudProvider,
} from '@/composable/cloudPicker';

const { t } = useI18n();
const $toast = useToast();
const userId = inject('$userId');

const isSpinner = ref(false);
const webhooks = ref([]);
const eventCatalogue = ref(['task.created', 'task.updated', 'task.deleted', 'task.archived', 'task.restored']);
const newSecret = ref('');
const editingId = ref('');
const logsFor = ref('');
const logs = ref([]);

const formatOptions = [
    { value: 'slack', label: 'Slack' },
    { value: 'discord', label: 'Discord' },
    { value: 'json', label: 'JSON' },
];
const EVENT_LABEL_KEY = {
    'task.created': 'ev_created',
    'task.updated': 'ev_updated',
    'task.deleted': 'ev_deleted',
    'task.archived': 'ev_archived',
    'task.restored': 'ev_restored',
};

const blankForm = () => ({ name: '', url: '', format: 'slack', events: ['*'] });
const form = ref(blankForm());
const formError = ref({ name: '', url: '', events: '' });

const allEvents = computed(() => form.value.events.length === 1 && form.value.events[0] === '*');
const urlLabel = computed(() =>
    form.value.format === 'slack' ? t('Integrations.slack_url')
    : form.value.format === 'discord' ? t('Integrations.discord_url')
    : t('Integrations.url'));
const urlPlaceholder = computed(() =>
    form.value.format === 'slack' ? 'https://hooks.slack.com/services/...'
    : form.value.format === 'discord' ? 'https://discord.com/api/webhooks/...'
    : 'https://example.com/webhook');

const eventLabel = (ev) => (EVENT_LABEL_KEY[ev] ? t(`Integrations.${EVENT_LABEL_KEY[ev]}`) : ev);
const eventsSummary = (events) => (events && events.includes('*')) ? t('Integrations.all_events') : (events || []).map(eventLabel).join(', ');
const shortUrl = (url) => { const u = String(url || ''); return u.length > 52 ? u.slice(0, 52) + '…' : u; };
const formatTime = (d) => { try { return new Date(d).toLocaleString(); } catch (e) { return ''; } };
const lastDeliveryLabel = (hook) => hook.lastDeliveredAt
    ? `${t('Integrations.last')}: ${hook.lastStatus || '—'} · ${formatTime(hook.lastDeliveredAt)}`
    : t('Integrations.no_deliveries');

const ok = (res) => Boolean(res && res.data && res.data.status);

const toggleAllEvents = (e) => { form.value.events = e.target.checked ? ['*'] : []; };

const fetchEvents = async () => {
    try {
        const res = await apiRequest('get', env.WEBHOOK_EVENTS);
        if (ok(res) && Array.isArray(res.data.data) && res.data.data.length) eventCatalogue.value = res.data.data;
    } catch (e) { /* keep the built-in fallback list */ }
};
const fetchWebhooks = async () => {
    try {
        isSpinner.value = true;
        const res = await apiRequest('get', env.WEBHOOKS);
        webhooks.value = ok(res) ? (res.data.data || []) : [];
    } catch (e) {
        $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
    } finally {
        isSpinner.value = false;
    }
};

const validate = () => {
    const err = { name: '', url: '', events: '' };
    if (!form.value.name || !form.value.name.trim()) err.name = t('Integrations.err_name');
    if (!/^https?:\/\/.+/i.test(form.value.url || '')) err.url = t('Integrations.err_url');
    if (!form.value.events || !form.value.events.length) err.events = t('Integrations.err_events');
    formError.value = err;
    return !err.name && !err.url && !err.events;
};

const submitForm = async () => {
    if (!validate()) return;
    const body = {
        name: form.value.name.trim(),
        url: form.value.url.trim(),
        events: form.value.events,
        format: form.value.format,
    };
    try {
        isSpinner.value = true;
        let res;
        if (editingId.value) {
            res = await apiRequest('put', `${env.WEBHOOKS}/${editingId.value}`, body);
        } else {
            res = await apiRequest('post', env.WEBHOOKS, { ...body, userData: { id: userId.value } });
        }
        if (!ok(res)) {
            $toast.error((res && res.data && res.data.statusText) || t('Toast.something_went_wrong'), { position: 'top-right' });
            return;
        }
        if (!editingId.value && res.data.data && res.data.data.secret) newSecret.value = res.data.data.secret;
        $toast.success(editingId.value ? t('Toast.webhook_updated') : t('Toast.webhook_created'), { position: 'top-right' });
        resetForm();
        await fetchWebhooks();
    } catch (e) {
        $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
    } finally {
        isSpinner.value = false;
    }
};

const editWebhook = (hook) => {
    editingId.value = hook._id;
    form.value = { name: hook.name || '', url: hook.url || '', format: hook.format || 'json', events: [...(hook.events || ['*'])] };
    formError.value = { name: '', url: '', events: '' };
    window.scrollTo({ top: 0, behavior: 'smooth' });
};
const resetForm = () => { editingId.value = ''; form.value = blankForm(); formError.value = { name: '', url: '', events: '' }; };

const toggleActive = async (hook) => {
    try {
        isSpinner.value = true;
        const res = await apiRequest('put', `${env.WEBHOOKS}/${hook._id}`, { active: !hook.active });
        if (!ok(res)) $toast.error((res && res.data && res.data.statusText) || t('Toast.something_went_wrong'), { position: 'top-right' });
        await fetchWebhooks();
    } catch (e) {
        $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
    } finally {
        isSpinner.value = false;
    }
};

const removeWebhook = async (hook) => {
    if (!window.confirm(t('Integrations.confirm_delete'))) return;
    try {
        isSpinner.value = true;
        const res = await apiRequest('delete', `${env.WEBHOOKS}/${hook._id}`);
        if (ok(res)) {
            $toast.success(t('Toast.webhook_deleted'), { position: 'top-right' });
            if (logsFor.value === hook._id) logsFor.value = '';
            if (editingId.value === hook._id) resetForm();
        } else {
            $toast.error((res && res.data && res.data.statusText) || t('Toast.something_went_wrong'), { position: 'top-right' });
        }
        await fetchWebhooks();
    } catch (e) {
        $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
    } finally {
        isSpinner.value = false;
    }
};

const viewLogs = async (hook) => {
    if (logsFor.value === hook._id) { logsFor.value = ''; return; }
    try {
        isSpinner.value = true;
        const res = await apiRequest('get', `${env.WEBHOOKS}/${hook._id}/logs`);
        logs.value = ok(res) ? (res.data.data || []) : [];
        logsFor.value = hook._id;
    } catch (e) {
        $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
    } finally {
        isSpinner.value = false;
    }
};

const copySecret = async () => {
    try { await navigator.clipboard.writeText(newSecret.value); $toast.success(t('Integrations.secret_copied'), { position: 'top-right' }); }
    catch (e) { /* ignore */ }
};

// ── AHE-3838 · cloud storage for attachments ───────────────────────────────
//
// Two levels here, and the UI keeps them visibly separate:
//   the app registration  workspace-wide, owner/admin only
//   the account grant     per user, because everyone has their own drive
const cloudProviders = ref([]);
const cloudRedirectUri = ref('');
const cloudEditing = ref('');
const cloudForm = ref({});

const loadCloudSettings = async () => {
    try {
        const data = await fetchCloudSettings();
        cloudProviders.value = data.providers || [];
        cloudRedirectUri.value = data.redirectUri || '';
    } catch (error) {
        // Non-fatal: the webhooks half of this page must still work.
        console.error('Could not load cloud storage settings', error);
        cloudProviders.value = [];
    }
};

const toggleCloudForm = (p) => {
    if (cloudEditing.value === p.provider) { cloudEditing.value = ''; return; }
    // Prefill the non-secret values. Secrets are never sent to us, so their
    // inputs start blank and a blank one means "keep what's stored".
    cloudForm.value = { ...(p.config || {}) };
    cloudEditing.value = p.provider;
};

const saveCloud = async (p) => {
    isSpinner.value = true;
    try {
        await saveCloudSettings(p.provider, cloudForm.value);
        cloudEditing.value = '';
        await loadCloudSettings();
        $toast.success(t('Integrations.cloud_saved', { provider: p.name }), { position: 'top-right' });
    } catch (error) {
        $toast.error(error?.message || t('Toast.something_went_wrong'), { position: 'top-right' });
    } finally {
        isSpinner.value = false;
    }
};

const removeCloud = async (p) => {
    // Only ever the caller's own credentials and grant — nobody else is affected.
    if (!window.confirm(t('Integrations.cloud_confirm_remove', { provider: p.name }))) return;
    isSpinner.value = true;
    try {
        await clearCloudSettings(p.provider);
        await loadCloudSettings();
        $toast.success(t('Integrations.cloud_removed', { provider: p.name }), { position: 'top-right' });
    } catch (error) {
        $toast.error(error?.message || t('Toast.something_went_wrong'), { position: 'top-right' });
    } finally {
        isSpinner.value = false;
    }
};

const connectCloud = async (p) => {
    try {
        // Full-page redirect to the provider; we come back to this same page.
        await connectCloudProvider(p.provider);
    } catch (error) {
        $toast.error(error?.message || t('Toast.something_went_wrong'), { position: 'top-right' });
    }
};

const disconnectCloud = async (p) => {
    isSpinner.value = true;
    try {
        await disconnectCloudProvider(p.provider);
        await loadCloudSettings();
        $toast.success(t('Integrations.cloud_disconnected', { provider: p.name }), { position: 'top-right' });
    } catch (error) {
        $toast.error(error?.message || t('Toast.something_went_wrong'), { position: 'top-right' });
    } finally {
        isSpinner.value = false;
    }
};

// Setup steps are collapsed for a provider that's already working, and open by
// default for one that still needs configuring — that's when you need them.
const cloudStepsOpen = ref({});
const toggleCloudSteps = (p) => { cloudStepsOpen.value[p.provider] = !isCloudStepsOpen(p); };
const isCloudStepsOpen = (p) => {
    const explicit = cloudStepsOpen.value[p.provider];
    return explicit === undefined ? !p.configured : explicit;
};

/**
 * Render the light markup used in provider requirement strings: **bold** and
 * `code`. HTML is escaped FIRST, so even though these strings are our own
 * constants today, the renderer can never emit markup that came from data.
 */
const formatRequirement = (text) => String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');

const copyRedirectUri = async () => {
    try {
        await navigator.clipboard.writeText(cloudRedirectUri.value);
        $toast.success(t('Integrations.copied'), { position: 'top-right' });
    } catch (error) {
        $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
    }
};

onMounted(() => {
    fetchEvents();
    fetchWebhooks();
    loadCloudSettings();
    // Coming back from a provider's consent screen — reflect the result and
    // strip the query so a reload doesn't re-announce it.
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get('cloudStorage');
    if (outcome === 'connected') {
        $toast.success(t('Integrations.cloud_connected_toast'), { position: 'top-right' });
    } else if (outcome === 'error') {
        $toast.error(params.get('reason') || t('Toast.something_went_wrong'), { position: 'top-right' });
    }
    if (outcome) {
        params.delete('cloudStorage'); params.delete('reason'); params.delete('provider');
        const qs = params.toString();
        window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));
    }
});
</script>

<style scoped>
@import '../MySettings/style.css';
.intg-head { margin-bottom: 18px; }
.intg-title { font-size: 18px; font-weight: 600; color: #1F212A; margin: 0 0 4px; }
.intg-desc { font-size: 13px; color: #6B7280; margin: 0; max-width: 560px; line-height: 1.5; }
.intg-section-title { font-size: 15px; font-weight: 600; color: #1F212A; margin: 22px 0 10px; display: flex; align-items: center; gap: 8px; }
.intg-count { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; padding: 0 6px; background: #EEF0FE; color: #6473E8; border-radius: 9px; font-size: 11px; font-weight: 600; }

.intg-secret { background: #FBFCFF; border: 1px dashed #C9D0F8; border-radius: 8px; padding: 12px 14px; margin-bottom: 16px; }
.intg-secret-title { font-weight: 600; color: #1F212A; margin: 0 0 2px; }
.intg-secret-desc { font-size: 12px; color: #6B7280; margin: 0 0 8px; }
.intg-secret-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.intg-secret-code { font-family: monospace; font-size: 13px; background: #F1F3F7; padding: 6px 10px; border-radius: 6px; word-break: break-all; flex: 1; min-width: 200px; }

.intg-form { max-width: 560px; }
.intg-format-tabs { display: inline-flex; gap: 6px; }
.intg-format-tab { padding: 6px 14px; border: 1px solid #DFE1E6; background: #fff; border-radius: 6px; cursor: pointer; font-size: 13px; color: #4B5563; }
.intg-format-tab.is-active { background: #2f3990; border-color: #2f3990; color: #fff; }
.intg-hint { font-size: 11px; color: #8A909C; margin-top: 4px; }
.intg-check { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: #374151; cursor: pointer; white-space: nowrap; }
.intg-check input[type="checkbox"] { width: 15px; height: 15px; margin: 0; flex-shrink: 0; cursor: pointer; }
.intg-events { margin-top: 10px; display: flex; flex-wrap: wrap; gap: 10px 20px; }

/* .btn_btn forces a navy background (!important), so secondary buttons (Cancel,
   Copy, Done) just need readable white text — same as the primary button. */
.intg-ghost-btn { color: #fff; }

.intg-list-wrap { max-width: 720px; }
.intg-empty { font-size: 13px; color: #8A909C; padding: 8px 0; }
.intg-row { border: 1px solid #EDF0F7; border-radius: 8px; padding: 12px 14px; margin-bottom: 10px; background: #fff; }
.intg-row-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.intg-row-main { display: flex; gap: 10px; min-width: 0; }
.intg-badge { flex-shrink: 0; height: 20px; padding: 0 8px; display: inline-flex; align-items: center; border-radius: 5px; font-size: 10px; font-weight: 700; letter-spacing: 0.4px; color: #fff; background: #6473E8; }
.intg-badge.is-slack { background: #4A154B; }
.intg-badge.is-discord { background: #5865F2; }
.intg-badge.is-json { background: #6B7280; }
.intg-row-text { min-width: 0; }
.intg-row-name { font-size: 14px; font-weight: 600; color: #1F212A; }
.intg-row-url { font-size: 12px; color: #6473E8; font-family: monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.intg-row-meta { font-size: 12px; color: #8A909C; margin-top: 2px; }
.intg-row-actions { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
.intg-link { background: none; border: none; padding: 0; cursor: pointer; font-size: 13px; color: #2f3990; }
.intg-link.intg-danger { color: #E5484D; }

.intg-switch { position: relative; display: inline-block; width: 34px; height: 18px; }
.intg-switch input { opacity: 0; width: 0; height: 0; }
.intg-slider { position: absolute; inset: 0; background: #C9CDD6; border-radius: 18px; transition: 0.2s; cursor: pointer; }
.intg-slider::before { content: ''; position: absolute; height: 14px; width: 14px; left: 2px; bottom: 2px; background: #fff; border-radius: 50%; transition: 0.2s; }
.intg-switch input:checked + .intg-slider { background: #1CB303; }
.intg-switch input:checked + .intg-slider::before { transform: translateX(16px); }

.intg-logs { margin-top: 12px; border-top: 1px solid #EDF0F7; padding-top: 10px; }
.intg-logs-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.intg-logs-table th { text-align: left; color: #8A909C; font-weight: 600; padding: 4px 8px; }
.intg-logs-table td { padding: 4px 8px; color: #1F212A; border-top: 1px solid #F2F4F8; }
.intg-ok { color: #1B7F3B; }
.intg-fail { color: #E5484D; }

/* AHE-3838 — cloud storage for attachments */
.intg-cloud { margin-top: 30px; padding-top: 22px; border-top: 1px solid #EDEFF5; }
.intg-cloud .intg-desc { margin-bottom: 14px; }
.intg-cloud-redirect {
    background: #FBFCFF;
    border: 1px dashed #C9D0F8;
    border-radius: 8px;
    padding: 12px 14px;
    margin-bottom: 16px;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
}
.intg-cloud-redirect-lbl { font-size: 12.5px; font-weight: 600; color: #1F212A; }
.intg-cloud-redirect .intg-hint { flex-basis: 100%; margin: 0; }
.intg-cloud-row { display: block; }
/* Keep the actions pinned top-right regardless of how long the provider's hint
   is. `.intg-row-top` wraps by default and `.intg-row-main` has no flex-basis, so
   Google's longer setup hint pushed the buttons onto their own line while
   Dropbox's shorter one happened to fit — the two rows disagreed. Scoped to cloud
   rows so the webhook rows above keep their existing wrapping behaviour. */
.intg-cloud-row .intg-row-top { flex-wrap: nowrap; align-items: flex-start; }
.intg-cloud-row .intg-row-main { flex: 1 1 auto; min-width: 0; }
.intg-cloud-row .intg-row-actions { flex: 0 0 auto; align-items: flex-start; white-space: nowrap; }
@media (max-width: 640px) {
    /* Too narrow to hold both columns — let it stack rather than crush the text. */
    .intg-cloud-row .intg-row-top { flex-wrap: wrap; }
}
.intg-cloud-ic {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    flex: none;
    font-size: 17px;
    background: #F4F5FB;
    border-radius: 8px;
}
.intg-cloud-pill {
    display: inline-flex;
    align-items: center;
    margin-left: 8px;
    padding: 1px 8px;
    font-size: 10.5px;
    font-weight: 600;
    color: #6B7280;
    background: #F1F2F6;
    border-radius: 999px;
    vertical-align: middle;
}
.intg-cloud-pill.on { color: #1B7F3B; background: #E4F5EA; }
.intg-cloud-form {
    margin-top: 12px;
    padding: 14px;
    background: #FBFCFF;
    border: 1px solid #EDEFF5;
    border-radius: 8px;
}
.intg-cloud-form .inputfield { margin-bottom: 12px; }

.intg-cloud-stepstoggle {
    margin-top: 4px;
    padding: 0;
    font-size: 12px;
}
.intg-cloud-reqs {
    margin: 10px 0 0;
    padding: 12px 14px 12px 32px;
    background: #FBFCFF;
    border: 1px solid #EDEFF5;
    border-radius: 8px;
    font-size: 12.5px;
    line-height: 1.65;
    color: #4A4B63;
}
.intg-cloud-reqs li { margin-bottom: 5px; }
.intg-cloud-reqs li:last-child { margin-bottom: 0; }
.intg-cloud-reqs strong { color: #1F212A; font-weight: 600; }
.intg-cloud-reqs code {
    padding: 1px 5px;
    background: #EEF0FE;
    border-radius: 4px;
    font-size: 11.5px;
    color: #2F3990;
    word-break: break-all;
}
.intg-cloud-reqs__uri { padding-top: 4px; }
.intg-cloud-reqs__uri .intg-link { margin-left: 6px; }
</style>
