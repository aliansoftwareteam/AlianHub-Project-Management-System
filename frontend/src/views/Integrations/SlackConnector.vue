<template>
    <section v-if="privileged" class="ah-card slc" data-test="slack-connector" aria-labelledby="slack-connector-title">
        <div id="slack-connector-title" class="slc__title">{{ $t('SlackConnector.title') }}</div>
        <p class="ah-small slc__lead">{{ $t('SlackConnector.lead') }}</p>

        <div v-if="loadError" class="ah-field__error" data-test="slack-load-error">{{ loadError }}</div>
        <div v-else-if="!conn" class="ah-small">{{ $t('SlackConnector.loading') }}</div>
        <div v-else-if="!conn.on" class="auth__banner auth__banner--warn" data-test="slack-off">
            <ShellIcon name="alert" :size="15" />
            <div>
                <div>{{ $t('SlackConnector.off_title') }}</div>
                <ul class="slc__problems">
                    <li v-for="code in conn.problems || []" :key="code">{{ $t(`SlackConnector.problem_${code}`) }}</li>
                </ul>
            </div>
        </div>
        <template v-else>
            <div v-if="conn.status === 'broken'" class="auth__banner auth__banner--warn" data-test="slack-broken">
                <ShellIcon name="alert" :size="15" />
                <span>{{ $t('SlackConnector.broken', { reason: conn.brokenReason || '?', when: when(conn.brokenAt) }) }}</span>
            </div>
            <p v-if="conn.team && conn.team.name" class="ah-small slc__team" data-test="slack-team">{{ $t('SlackConnector.team', { name: conn.team.name }) }}</p>

            <div v-for="key in SECRET_KEYS" :key="key" class="slc__row" :data-test="`slack-secret-${key}`">
                <div>
                    <div class="slc__label">{{ $t(`SlackConnector.secret_${key}`) }}</div>
                    <div class="ah-small slc__state" data-test="secret-state">{{ stateLine(key) }}</div>
                </div>
                <div class="slc__actions">
                    <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="busy" data-test="secret-set" @click="toggle(key)">
                        {{ editing === key ? $t('SlackConnector.cancel') : secretOf(key).set ? $t('SlackConnector.replace') : $t('SlackConnector.set') }}
                    </button>
                    <button v-if="secretOf(key).set" type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :disabled="busy" data-test="secret-remove" @click="remove(key)">{{ $t('SlackConnector.remove') }}</button>
                </div>
            </div>

            <form v-if="editing" class="slc__form" data-test="secret-form" @submit.prevent="save">
                <label class="ah-field__label" for="slack-connector-value">{{ $t(`SlackConnector.new_${editing}`) }}</label>
                <input id="slack-connector-value" v-model="newValue" class="ah-input ah-mono" type="password" autocomplete="new-password" data-test="secret-input" @input="formError = ''" />
                <p class="ah-small slc__state">{{ $t('SlackConnector.value_note') }}</p>
                <div v-if="formError" class="ah-field__error" data-test="secret-error">{{ formError }}</div>
                <div class="slc__actions">
                    <button type="submit" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="busy" data-test="secret-save">{{ busy ? $t('SlackConnector.saving') : $t('SlackConnector.save') }}</button>
                </div>
            </form>

            <div v-if="conn.connected" class="slc__channels" data-test="slack-channels">
                <div class="slc__label">{{ $t('SlackConnector.channels_heading') }}</div>
                <p class="ah-small slc__state">{{ $t('SlackConnector.channels_lead') }}</p>
                <p class="ah-small slc__state">{{ $t('SlackConnector.read_lead') }}</p>
                <p v-if="!conn.channels.length" class="ah-small" data-test="no-channels">{{ $t('SlackConnector.channels_none') }}</p>
                <div v-for="channel in conn.channels" :key="channel.id" class="slc__channel" :data-test="`slack-channel-${channel.id}`">
                    <span class="ah-mono slc__name">#{{ channel.name }}</span>
                    <label v-for="use in USES" :key="use" class="slc__tick">
                        <input
                            type="checkbox"
                            :checked="ticked(channel.id, use)"
                            :disabled="busy"
                            :aria-label="$t(`SlackConnector.${use}_label`, { name: channel.name })"
                            :data-test="`tick-${use}`"
                            @change="tick(channel.id, use, $event.target.checked)"
                        />
                        <span>{{ $t(`SlackConnector.${use}`) }}</span>
                    </label>
                    <span v-if="!channel.member" class="ah-small slc__state">{{ $t('SlackConnector.not_member') }}</span>
                </div>
                <div v-if="channelError" class="ah-field__error" data-test="channel-error">{{ channelError }}</div>
                <div class="slc__actions">
                    <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="busy || !dirty" data-test="channels-save" @click="saveChannels">{{ $t('SlackConnector.channels_save') }}</button>
                    <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :disabled="busy" data-test="channels-refresh" @click="refresh">{{ $t('SlackConnector.channels_refresh') }}</button>
                    <span class="ah-small slc__state">{{ $t('SlackConnector.channels_read', { when: when(conn.channelsFetchedAt) }) }}</span>
                </div>
            </div>
        </template>
    </section>
</template>

<script setup>
defineOptions({ name: 'SlackConnector' });
import { computed, onMounted, ref } from 'vue';
import { useStore } from 'vuex';
import { useI18n } from 'vue-i18n';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { isOwnerOrAdmin } from '@/utils/roles';

const { t } = useI18n();
const { getters } = useStore();

const SECRET_KEYS = ['bot_token', 'signing_secret'];
const BODY_KEY = { bot_token: 'botToken', signing_secret: 'signingSecret' };
const USES = ['read', 'post'];
const BASE = `${env.CONNECTORS}/slack`;

const conn = ref(null);
const loadError = ref('');
const busy = ref(false);
const editing = ref('');
const newValue = ref('');
const formError = ref('');
const channelError = ref('');
const picked = ref({});

const privileged = computed(() => isOwnerOrAdmin(Number(getters['settings/companyUserDetail']?.roleType)));
const when = (d) => (d ? new Date(d).toLocaleString() : t('SlackConnector.never'));
const secretOf = (key) => (conn.value && conn.value.secrets && conn.value.secrets[key]) || { set: false };
const stateLine = (key) => {
    const secret = secretOf(key);
    if (secret.set) return t('SlackConnector.set_on', { when: when(secret.setAt) });
    return secret.revoked ? t('SlackConnector.revoked') : t('SlackConnector.not_set');
};
// A channel allowed before reading existed arrives without ticks and means post only.
const allowed = () => Object.fromEntries(((conn.value && conn.value.allowedChannels) || []).map((c) => [c.id, { read: c.read === true, post: c.post !== false }]));
const chosen = (ticks) => Object.entries(ticks)
    .filter(([, use]) => use.read || use.post)
    .map(([id, use]) => ({ id, read: Boolean(use.read), post: Boolean(use.post) }))
    .sort((a, b) => a.id.localeCompare(b.id));
const dirty = computed(() => JSON.stringify(chosen(picked.value)) !== JSON.stringify(chosen(allowed())));
const ticked = (id, use) => Boolean(picked.value[id] && picked.value[id][use]);
const tick = (id, use, on) => { picked.value = { ...picked.value, [id]: { read: ticked(id, 'read'), post: ticked(id, 'post'), [use]: on } }; };

const problemOf = (e) => e?.response?.data?.statusText || t('SlackConnector.failed');
const take = (res) => {
    if (res?.data?.status !== true) throw Object.assign(new Error('refused'), { response: res });
    conn.value = res.data.data;
    picked.value = allowed();
};

const load = async () => {
    if (!privileged.value) return;
    loadError.value = '';
    try { take(await apiRequest('get', BASE)); } catch (e) { loadError.value = problemOf(e); }
};

const stopEditing = () => { editing.value = ''; newValue.value = ''; formError.value = ''; };
const toggle = (key) => {
    const open = editing.value !== key;
    stopEditing();
    if (open) editing.value = key;
};

const save = async () => {
    const value = newValue.value.trim();
    if (!value) { formError.value = t('SlackConnector.err_value'); return; }
    busy.value = true;
    try {
        take(await apiRequest('put', `${BASE}/secrets`, { [BODY_KEY[editing.value]]: value }));
        stopEditing();
    } catch (e) {
        formError.value = problemOf(e);
    } finally {
        newValue.value = '';
        busy.value = false;
    }
};

const run = async (call) => {
    busy.value = true;
    channelError.value = '';
    try { take(await call()); } catch (e) { channelError.value = problemOf(e); } finally { busy.value = false; }
};

const remove = (key) => {
    if (!window.confirm(t(`SlackConnector.confirm_remove_${key}`))) return undefined;
    if (editing.value === key) stopEditing();
    return run(() => apiRequest('delete', `${BASE}/secrets/${key}`));
};
const saveChannels = () => run(() => apiRequest('put', `${BASE}/channels`, { channels: chosen(picked.value) }));
const refresh = () => run(() => apiRequest('post', `${BASE}/channels/refresh`));

onMounted(load);
</script>

<style scoped>
.slc { padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; max-width: 900px; margin-top: 14px; background: var(--surface); }
.slc__title { font: 600 13px/1.2 var(--font-ui); color: var(--ink); }
.slc__lead, .slc__team { margin: 0; color: var(--ink-2); }
.slc__problems { margin: 6px 0 0; padding-left: 18px; }
.slc__row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; padding: 10px 0; border-bottom: 1px solid var(--hairline); }
.slc__label { font: 600 12.5px/1.3 var(--font-ui); color: var(--ink); }
.slc__state { margin: 0; color: var(--ink-2); }
.slc__actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.slc__form { display: flex; flex-direction: column; gap: 6px; max-width: 520px; }
.slc__channels { display: flex; flex-direction: column; gap: 6px; padding-top: 4px; }
.slc__channel { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; color: var(--ink); min-height: 28px; padding: 4px 0; border-bottom: 1px solid var(--hairline); }
.slc__name { flex: 1 1 160px; min-width: 0; overflow-wrap: anywhere; }
.slc__tick { display: inline-flex; align-items: center; gap: 6px; color: var(--ink); min-height: 28px; }
</style>
