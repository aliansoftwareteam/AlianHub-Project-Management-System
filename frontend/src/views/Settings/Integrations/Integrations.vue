<template>
    <div class="ig" :class="{ 'ig--busy': isSpinner }">
        <SpinnerComp :is-spinner="isSpinner" />
        <div class="ig__head">
            <h2 class="ah-h3 ig__title">{{ $t('Integrations.title') }}</h2>
            <span class="ah-label">{{ $t('SettingsV2.connected_count', { n: connectedCount }) }}</span>
            <div class="ig__head-actions">
                <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="toggleWebhookForm()"><ShellIcon name="plus" :size="14" />{{ $t('SettingsV2.webhook') }}</button>
                <router-link v-if="apiTokensRoute" class="ah-btn ah-btn--secondary ah-btn--sm" :to="apiTokensRoute">{{ $t('SettingsV2.api_keys') }}</router-link>
            </div>
        </div>

        <section v-if="newSecret" class="ah-card ig__secret">
            <div class="ah-card__body">
                <strong>{{ $t('Integrations.secret_title') }}</strong>
                <div class="ah-small">{{ $t('Integrations.secret_desc') }}</div>
                <div class="ig__secret-row">
                    <code class="ah-mono ig__code">{{ newSecret }}</code>
                    <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="copySecret"><ShellIcon name="copy" :size="14" />{{ $t('Integrations.copy') }}</button>
                    <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" @click="newSecret = ''">{{ $t('Integrations.done') }}</button>
                </div>
            </div>
        </section>

        <section v-if="showWebhookForm || editingId" class="ah-card">
            <div class="ah-card__head">
                <h3 class="ah-h3">{{ editingId ? $t('Integrations.edit_webhook') : $t('Integrations.add_webhook') }}</h3>
                <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :aria-label="$t('Integrations.cancel')" @click="closeWebhookForm()"><ShellIcon name="x" :size="16" /></button>
            </div>
            <form class="ah-card__body ig__form" @submit.prevent="submitForm">
                <div class="ah-field">
                    <span class="ah-field__label">{{ $t('Integrations.destination') }}</span>
                    <div class="ah-tabs" role="radiogroup">
                        <button v-for="opt in formatOptions" :key="opt.value" type="button" class="ah-tab" :class="{ 'is-active': form.format === opt.value }" role="radio" :aria-checked="form.format === opt.value" @click="form.format = opt.value">{{ opt.label }}</button>
                    </div>
                </div>
                <div class="ig__form-grid">
                    <div class="ah-field">
                        <label class="ah-field__label" for="ig-name">{{ $t('Integrations.name') }}</label>
                        <input id="ig-name" class="ah-input" :class="{ 'ah-input--error': formError.name }" v-model.trim="form.name" :placeholder="$t('Integrations.name_ph')" maxlength="80" @input="formError.name = ''" />
                        <div v-if="formError.name" class="ah-field__error">{{ formError.name }}</div>
                    </div>
                    <div class="ah-field">
                        <label class="ah-field__label" for="ig-url">{{ urlLabel }}</label>
                        <input id="ig-url" class="ah-input ah-mono" :class="{ 'ah-input--error': formError.url }" v-model.trim="form.url" :placeholder="urlPlaceholder" @input="formError.url = ''" />
                        <div v-if="form.format === 'slack'" class="ah-field__hint">{{ $t('Integrations.slack_hint') }}</div>
                        <div v-else-if="form.format === 'discord'" class="ah-field__hint">{{ $t('Integrations.discord_hint') }}</div>
                        <div v-if="formError.url" class="ah-field__error">{{ formError.url }}</div>
                    </div>
                </div>
                <div class="ah-field">
                    <span class="ah-field__label">{{ $t('Integrations.events') }}</span>
                    <label class="ig__check"><input type="checkbox" class="ah-check" :checked="allEvents" @change="toggleAllEvents($event)" /><span>{{ $t('Integrations.all_events') }}</span></label>
                    <div v-if="!allEvents" class="ig__events">
                        <label v-for="ev in eventCatalogue" :key="ev" class="ig__check"><input type="checkbox" class="ah-check" :value="ev" v-model="form.events" /><span>{{ eventLabel(ev) }}</span></label>
                    </div>
                    <div v-if="formError.events" class="ah-field__error">{{ formError.events }}</div>
                </div>
                <div class="ig__actions">
                    <button type="submit" class="ah-btn ah-btn--primary" :disabled="isSpinner">{{ editingId ? $t('Integrations.save') : (form.format === 'slack' ? $t('Integrations.send_to_slack') : $t('Integrations.create')) }}</button>
                    <button type="button" class="ah-btn ah-btn--secondary" @click="closeWebhookForm()">{{ $t('Integrations.cancel') }}</button>
                </div>
            </form>
        </section>

        <div class="ig__list">
            <div v-for="p in connectedProviders" :key="p.provider" class="ah-card ig__row">
                <div class="ig__row-main">
                    <span class="ig__mark" aria-hidden="true">{{ p.icon }}</span>
                    <div class="ig__row-text">
                        <div class="ig__row-name">{{ p.name }}</div>
                        <div class="ah-small">
                            <template v-if="p.oauth && p.connected">{{ $t('Integrations.cloud_your_account') }}: {{ p.accountEmail || $t('Integrations.cloud_connected') }}</template>
                            <template v-else-if="p.oauth && p.connectionStatus === 'reauth_required'">{{ $t('Integrations.cloud_reauth') }}</template>
                            <template v-else-if="p.oauth">{{ $t('Integrations.cloud_not_connected') }}</template>
                            <template v-else>{{ $t('Integrations.cloud_no_signin_needed') }}</template>
                        </div>
                    </div>
                    <span class="ig__status ah-small">
                        <span class="ah-dot" :class="p.connected || !p.oauth ? 'ah-dot--ok' : 'ah-dot--warn'"></span>
                        {{ p.connected || !p.oauth ? $t('Integrations.cloud_ready') : $t('Integrations.cloud_not_connected') }}
                    </span>
                    <div class="ig__row-actions">
                        <button v-if="p.oauth && !p.connected" type="button" class="ig__link" @click="connectCloud(p)">{{ $t('Integrations.cloud_connect') }}</button>
                        <button v-if="p.oauth && p.connected" type="button" class="ig__link ig__link--danger" @click="disconnectCloud(p)">{{ $t('Integrations.cloud_disconnect') }}</button>
                        <button type="button" class="ig__link" @click="toggleCloudForm(p)">{{ cloudEditing === p.provider ? $t('Integrations.cancel') : $t('SettingsV2.configure') }}</button>
                        <button type="button" class="ig__link ig__link--danger" @click="removeCloud(p)">{{ $t('Integrations.delete') }}</button>
                    </div>
                </div>
            </div>

            <div v-for="hook in webhooks" :key="hook._id" class="ah-card ig__row" :class="{ 'is-paused': !hook.active }">
                <div class="ig__row-main">
                    <span class="ig__mark ig__mark--hook" :class="'is-' + (hook.format || 'json')" aria-hidden="true">{{ (hook.format || 'json').slice(0, 1).toUpperCase() }}</span>
                    <div class="ig__row-text">
                        <div class="ig__row-name">{{ hook.name }} <span class="ah-chip ah-chip--mono">{{ (hook.format || 'json').toUpperCase() }}</span></div>
                        <div class="ah-small" :title="hook.url">{{ shortUrl(hook.url) }} · {{ eventsSummary(hook.events) }} · {{ lastDeliveryLabel(hook) }}</div>
                    </div>
                    <span class="ig__status ah-small">
                        <span class="ah-dot" :class="hook.active ? 'ah-dot--ok' : 'ah-dot--warn'"></span>{{ hook.active ? $t('Integrations.active') : $t('Integrations.paused') }}
                    </span>
                    <div class="ig__row-actions">
                        <AhSwitch small :modelValue="!!hook.active" :label="hook.active ? $t('Integrations.active') : $t('Integrations.paused')" @update:modelValue="toggleActive(hook)" />
                        <button type="button" class="ig__link" @click="viewLogs(hook)">{{ $t('Integrations.logs') }}</button>
                        <button type="button" class="ig__link" @click="editWebhook(hook)">{{ $t('Integrations.edit') }}</button>
                        <button type="button" class="ig__link ig__link--danger" @click="removeWebhook(hook)">{{ $t('Integrations.delete') }}</button>
                    </div>
                </div>
                <div v-if="logsFor === hook._id" class="ig__logs">
                    <div v-if="!logs.length" class="ah-empty">{{ $t('Integrations.no_logs') }}</div>
                    <div v-else class="ig__logs-scroll">
                        <table class="ig__logs-table">
                            <thead><tr><th>{{ $t('Integrations.event') }}</th><th>{{ $t('Integrations.status') }}</th><th>{{ $t('Integrations.duration') }}</th><th>{{ $t('Integrations.when') }}</th></tr></thead>
                            <tbody>
                                <tr v-for="(log, i) in logs" :key="i">
                                    <td class="ah-mono">{{ log.event }}</td>
                                    <td><span class="ah-chip ah-chip--mono" :class="log.success ? 'ah-chip--ok' : 'ah-chip--danger'">{{ log.success ? (log.statusCode || 'OK') : (log.statusCode || 'fail') }}<template v-if="log.attempt > 1"> · {{ $t('Integrations.retry') }}</template></span></td>
                                    <td class="ah-mono">{{ log.durationMs != null ? log.durationMs + 'ms' : '—' }}</td>
                                    <td class="ah-mono">{{ formatTime(log.createdAt) }}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    <button v-if="logsHasMore" type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="logsBusy" @click="loadMoreLogs">{{ logsBusy ? $t('Integrations.loading') : $t('Integrations.load_more') }}</button>
                </div>
            </div>

            <div v-if="!connectedProviders.length && !webhooks.length && !isSpinner" class="ah-empty">{{ $t('SettingsV2.integrations_empty') }}</div>
        </div>

        <div class="ah-label">{{ $t('SettingsV2.available') }}</div>
        <div class="ig__chips">
            <button v-for="p in availableProviders" :key="p.provider" type="button" class="ig__chip" :class="{ 'is-active': cloudEditing === p.provider }" @click="toggleCloudForm(p)"><span aria-hidden="true">{{ p.icon }}</span> {{ p.name }}</button>
            <button v-for="opt in formatOptions" :key="opt.value" type="button" class="ig__chip" @click="toggleWebhookForm(opt.value)">{{ opt.label }} {{ $t('SettingsV2.webhook').toLowerCase() }}</button>
        </div>

        <section v-if="editingProvider" class="ah-card">
            <div class="ah-card__head">
                <h3 class="ah-h3">{{ $t('SettingsV2.set_up_provider', { provider: editingProvider.name }) }}</h3>
                <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :aria-label="$t('Integrations.cancel')" @click="cloudEditing = ''"><ShellIcon name="x" :size="16" /></button>
            </div>
            <div class="ah-card__body ig__form">
                <div v-if="cloudRedirectUri" class="ig__redirect">
                    <span class="ah-small">{{ $t('Integrations.cloud_redirect_uri') }}</span>
                    <code class="ah-mono ig__code">{{ cloudRedirectUri }}</code>
                    <button type="button" class="ig__link" @click="copyRedirectUri">{{ $t('Integrations.copy') }}</button>
                    <div class="ah-field__hint">{{ $t('Integrations.cloud_redirect_hint') }}</div>
                </div>
                <ol v-if="editingProvider.requirements && editingProvider.requirements.length" class="ig__reqs">
                    <li v-for="(req, i) in editingProvider.requirements" :key="i" v-html="formatRequirement(req)"></li>
                </ol>
                <div class="ig__form-grid">
                    <div v-for="f in editingProvider.fields" :key="f.key" class="ah-field">
                        <label class="ah-field__label" :for="'ig-cloud-' + f.key">{{ f.label }}</label>
                        <input :id="'ig-cloud-' + f.key" class="ah-input ah-mono" :type="f.secret ? 'password' : 'text'" autocomplete="off" v-model.trim="cloudForm[f.key]" :placeholder="f.secret && editingProvider.secrets && editingProvider.secrets[f.key] ? $t('Integrations.cloud_secret_set') : ''" />
                    </div>
                </div>
                <div class="ig__actions">
                    <button type="button" class="ah-btn ah-btn--primary" :disabled="isSpinner" @click="saveCloud(editingProvider)">{{ $t('Integrations.save') }}</button>
                    <button type="button" class="ah-btn ah-btn--secondary" @click="cloudEditing = ''">{{ $t('Integrations.cancel') }}</button>
                </div>
            </div>
        </section>

        <div class="ah-card ig__note">
            <ShellIcon name="agent" :size="16" class="ig__note-icon" />
            <span>{{ $t('SettingsV2.integrations_agent_note') }}</span>
        </div>
    </div>
</template>

<script setup>
defineOptions({ name: "IntegrationsSettings" });
import * as env from '@/config/env';
import { useToast } from 'vue-toast-notification';
import { ref, computed, onMounted } from 'vue';
import SpinnerComp from '@/components/atom/SpinnerComp/SpinnerComp.vue';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';
import AhSwitch from '@/components/molecules/Setting/AhSwitch.vue';
import { useRouter } from 'vue-router';
import { inject } from 'vue';
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

const isSpinner = ref(false);
const webhooks = ref([]);
const eventCatalogue = ref(['task.created', 'task.updated', 'task.deleted', 'task.archived', 'task.restored']);
const newSecret = ref('');
const showWebhookForm = ref(false);
const router = useRouter();
const companyId = inject('$companyId');
const apiTokensRoute = computed(() => (router.hasRoute('ApiTokens') ? { name: 'ApiTokens', params: { cid: companyId.value } } : null));
const toggleWebhookForm = (format) => {
    if (format) { form.value.format = format; showWebhookForm.value = true; return; }
    showWebhookForm.value = !showWebhookForm.value;
};
const closeWebhookForm = () => { showWebhookForm.value = false; resetForm(); };
const editingId = ref('');
const logsFor = ref('');
const logs = ref([]);
const logsHasMore = ref(false);
const logsNextSkip = ref(0);
const logsBusy = ref(false);

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
            // No userData: the server takes the owner from the session token now, since a
            // caller-supplied id would decide whose integrations it can later read.
            res = await apiRequest('post', env.WEBHOOKS, body);
        }
        if (!ok(res)) {
            $toast.error((res && res.data && res.data.statusText) || t('Toast.something_went_wrong'), { position: 'top-right' });
            return;
        }
        if (!editingId.value && res.data.data && res.data.data.secret) newSecret.value = res.data.data.secret;
        $toast.success(editingId.value ? t('Toast.webhook_updated') : t('Toast.webhook_created'), { position: 'top-right' });
        resetForm();
        showWebhookForm.value = false;
        await fetchWebhooks();
    } catch (e) {
        $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
    } finally {
        isSpinner.value = false;
    }
};

const editWebhook = (hook) => {
    editingId.value = hook._id;
    showWebhookForm.value = true;
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

// Delivery logs are paged: a webhook firing on every task event builds thousands of rows,
// and the panel shows a handful. LOGS_PAGE must match nothing on the server — it caps the
// request there — this is only what we ask for.
const LOGS_PAGE = 10;

const loadLogs = async (hookId, append = false) => {
    try {
        if (append) logsBusy.value = true; else isSpinner.value = true;
        const skip = append ? logsNextSkip.value : 0;
        const res = await apiRequest('get', `${env.WEBHOOKS}/${hookId}/logs?skip=${skip}&limit=${LOGS_PAGE}`);
        if (!ok(res)) return;
        const page = res.data.data || [];
        logs.value = append ? [...logs.value, ...page] : page;
        // Trust the server's own count rather than inferring from page length: a full page
        // is not evidence of more, and a short one is not proof there is nothing left.
        logsHasMore.value = res.data.hasMore === true;
        logsNextSkip.value = typeof res.data.nextSkip === 'number' ? res.data.nextSkip : logs.value.length;
    } catch (e) {
        $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
    } finally {
        isSpinner.value = false;
        logsBusy.value = false;
    }
};

const viewLogs = async (hook) => {
    if (logsFor.value === hook._id) { logsFor.value = ''; return; }
    // Opening a different webhook starts a fresh list — carrying the previous one's rows
    // or its paging offset would show one hook's deliveries under another's name.
    logs.value = [];
    logsHasMore.value = false;
    logsNextSkip.value = 0;
    await loadLogs(hook._id, false);
    logsFor.value = hook._id;
};

const loadMoreLogs = () => {
    if (logsBusy.value || !logsHasMore.value || !logsFor.value) return;
    loadLogs(logsFor.value, true);
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
const connectedProviders = computed(() => cloudProviders.value.filter((p) => p.configured));
const availableProviders = computed(() => cloudProviders.value.filter((p) => !p.configured));
const editingProvider = computed(() => cloudProviders.value.find((p) => p.provider === cloudEditing.value) || null);
const connectedCount = computed(() => connectedProviders.value.length + webhooks.value.filter((h) => h.active).length);

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
.ig { display: flex; flex-direction: column; gap: 12px; max-width: 860px; position: relative; }
.ig--busy { pointer-events: none; }
.ig__head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ig__title { font-size: 15px; }
.ig__head-actions { margin-left: auto; display: flex; gap: 6px; }
.ig__head-actions a { text-decoration: none; }
.ig__secret { border-color: var(--brand); }
.ig__secret-row { display: flex; align-items: center; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
.ig__code { padding: 6px 9px; background: var(--surface-2); border-radius: 6px; word-break: break-all; color: var(--ink); }
.ig__form { display: flex; flex-direction: column; gap: 12px; }
.ig__form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.ig__events { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 6px; }
.ig__check { display: flex; align-items: center; gap: 7px; font: var(--text-small); color: var(--ink-label); cursor: pointer; }
.ig__actions { display: flex; gap: 8px; }
.ig__list { display: flex; flex-direction: column; gap: 7px; }
.ig__row { padding: 11px 13px; display: flex; flex-direction: column; gap: 10px; }
.ig__row.is-paused { opacity: .75; }
.ig__row-main { display: flex; align-items: center; gap: 11px; flex-wrap: wrap; }
.ig__mark { width: 30px; height: 30px; border-radius: 8px; background: var(--surface-2); border: 1px solid var(--hairline); display: grid; place-items: center; font-size: 15px; flex: none; }
.ig__mark--hook { font: 600 12px/1 var(--font-mono); color: #fff; border: 0; background: var(--rail); }
.ig__mark--hook.is-slack { background: #4a154b; }
.ig__mark--hook.is-discord { background: #5865f2; }
.ig__row-text { flex: 1; min-width: 200px; }
.ig__row-name { font: 600 13px/1.3 var(--font-ui); color: var(--ink); display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.ig__status { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
.ig__row-actions { display: flex; align-items: center; gap: 10px; }
.ig__link { border: 0; background: transparent; color: var(--brand); font: 600 12px/1 var(--font-ui); cursor: pointer; padding: 4px 2px; }
.ig__link--danger { color: var(--danger-ink); }
.ig__link:focus-visible { outline: none; box-shadow: var(--focus); border-radius: 4px; }
.ig__logs { display: flex; flex-direction: column; gap: 8px; border-top: 1px solid var(--hairline); padding-top: 10px; }
.ig__logs-scroll { overflow-x: auto; }
.ig__logs-table { width: 100%; border-collapse: collapse; font: var(--text-small); }
.ig__logs-table th { text-align: left; font: var(--text-label); text-transform: uppercase; letter-spacing: .06em; color: var(--ink-3); padding: 4px 8px; border-bottom: 1px solid var(--hairline); }
.ig__logs-table td { padding: 6px 8px; border-bottom: 1px solid var(--hairline); color: var(--ink); }
.ig__chips { display: flex; gap: 6px; flex-wrap: wrap; }
.ig__chip { padding: 6px 11px; border-radius: 8px; background: var(--surface); border: 1px solid var(--border); color: var(--ink); font: 400 12px/1 var(--font-ui); cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: border-color var(--t-state) var(--ease); }
.ig__chip:hover, .ig__chip.is-active { border-color: var(--brand); color: var(--brand); }
.ig__chip:focus-visible { outline: none; box-shadow: var(--focus); }
.ig__redirect { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ig__redirect .ah-field__hint { width: 100%; }
.ig__reqs { margin: 0; padding-left: 18px; font: var(--text-small); color: var(--ink-label); line-height: 1.5; }
.ig__note { padding: 10px 12px; border-color: rgba(47, 57, 144, .25); font: 400 12px/1.5 var(--font-ui); color: var(--ink); display: flex; align-items: flex-start; gap: 8px; }
.ig__note-icon { color: var(--agent); flex: none; margin-top: 1px; }
@media (max-width: 767px) {
    .ig__form-grid { grid-template-columns: 1fr; }
    .ig__head-actions { margin-left: 0; }
    .ig__link, .ig__chip { min-height: 44px; }
}
</style>
